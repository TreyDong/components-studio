/**
 * Document Codec（《文档与会话协议 v1》第 6–7 章）。
 *
 * 加载顺序（第 6.3 节）：
 * 1. 字节大小 → 2. 严格 UTF-8 → 3. rawHash → 4. 重复键/危险键检测解析 →
 * 5. 最小信封 → 6. Format Migration → 7. 顶层 Schema →
 * 8. 逐组件/数据源/动作 Migration → 9. 已知类型 Schema →
 * 10. Binding/Event/Action/Capability 校验 → 11. 树不变量 →
 * 12. 规范化序列化 → 13. semanticHash/contentHash → 14. 深冻结。
 */

import type {
  ActionSpecV1,
  ComponentsDocumentV1,
  DeepReadonly,
  DiagnosticV1,
  ErrorCode,
  MigratedTypeRecordV1,
  ParsedDocumentV1,
  ProtocolError,
  Result,
  ValidationIssue,
  ValidationResult,
} from "@ocs/contracts";
import {
  DOCUMENT_LIMITS,
  ERROR_CODES,
} from "@ocs/contracts";
import type {
  ActionMigrationV1,
  ComponentMigrationV1,
  DeterministicMigrationContextV1,
  FormatMigrationV1,
  PersistedActionSpecV1,
  PersistedDataSourceSpecV1,
} from "@ocs/contracts/document";
import { sha256HexSync } from "../shared/hash";
import { stableUuidV4 } from "../shared/id";
import {
  canonicalSerializeDocument,
  contentProjectionText,
} from "./canonical";
import { validateTreeInvariants } from "./invariants";
import { parseJsonStrict } from "./json-parse";
import type { CodecRegistry } from "./types";
import { deepFreeze, validateDocumentShape } from "./validate";
import { validateAgainstSchema } from "../schema/validator";
import type { JsonSchema } from "../schema/validator";

const ERROR_SCOPE = "document" as const;

function docError(
  code: ErrorCode,
  message: string,
  pointer: string,
): { ok: false; error: ProtocolError } {
  return {
    ok: false,
    error: {
      code,
      message,
      scope: ERROR_SCOPE,
      recoverable: true,
      retryable: false,
      details: { pointer },
    },
  };
}

function collectIssues(
  issues: ValidationIssue[],
): readonly ValidationIssue[] {
  return issues;
}

export class DocumentCodec {
  constructor(private readonly registry: CodecRegistry) {}

  /** 解析并校验磁盘字节（同步；哈希使用同步 SHA-256）。 */
  parseUtf8(bytes: Uint8Array): Result<ParsedDocumentV1> {
    // 1. 大小
    if (bytes.length > DOCUMENT_LIMITS.maxFileBytes) {
      return docError(ERROR_CODES.DOC_TOO_LARGE, "文件超过 10 MiB", "");
    }
    // 2. UTF-8
    const text = decodeStrict(bytes);
    if (text === null) {
      return docError(ERROR_CODES.DOC_INVALID_UTF8, "非法 UTF-8 或包含 BOM", "");
    }
    // 3. rawHash
    const rawHash = sha256HexSync(text);
    // 4. 解析（重复键/危险键检测）
    const parsed = parseJsonStrict(text);
    if (!parsed.ok) {
      const issue = parsed.issue;
      return docError(
        issue.code as (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
        issue.message,
        issue.pointer,
      );
    }
    const value = parsed.value;
    // 5. 最小信封
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return docError(ERROR_CODES.DOC_SCHEMA_INVALID, "顶层必须是 JSON 对象", "$");
    }
    const obj = value as Record<string, unknown>;
    if (obj.kind !== "components-studio/document") {
      return docError(ERROR_CODES.DOC_KIND_MISMATCH, "kind 必须为 components-studio/document", "/kind");
    }
    if (obj.formatVersion !== 1) {
      if (typeof obj.formatVersion === "number" && obj.formatVersion > 1) {
        return docError(ERROR_CODES.DOC_FORMAT_UNSUPPORTED_FUTURE, "未来 formatVersion，整份只读", "/formatVersion");
      }
      return docError(ERROR_CODES.DOC_SCHEMA_INVALID, "formatVersion 必须为 1", "/formatVersion");
    }

    // 6. Format Migration（V1 无迁移；未来版本在前面已拒绝）
    // 7. 顶层 Schema + 通用字段
    const shape = validateDocumentShape(value);
    if (!shape.ok) {
      return docError(ERROR_CODES.DOC_SCHEMA_INVALID, "文档结构校验失败", firstPointer(shape.issues));
    }

    let document = shape.value;

    // 8. 逐类型 Migration（Registry 提供连续链；V1 为空）
    const migratedTypes: MigratedTypeRecordV1[] = [];
    const migrationContext: DeterministicMigrationContextV1 = {
      documentId: document.documentId,
      sourceRawHash: rawHash,
      stableId: (scope: string, oldIdentity: string) =>
        stableIdFor(scope, oldIdentity, document.documentId, rawHash),
    };
    const migrationResult = this.runTypeMigrations(document, migrationContext, migratedTypes);
    if (!migrationResult.ok) return migrationResult;
    document = migrationResult.value;

    // 9. 已知类型 Schema 校验
    const typeIssues: ValidationIssue[] = [];
    this.validateKnownTypes(document, typeIssues);
    if (typeIssues.length > 0) {
      return docError(ERROR_CODES.DOC_SCHEMA_INVALID, "已知类型 Schema 校验失败", firstPointer(typeIssues));
    }

    // 10. Binding / Action / Capability 校验（结构已在 validateDocumentShape 完成；
    //    这里补充 bindableTargets 与 DataSource 引用存在性）
    const refIssues: ValidationIssue[] = [];
    this.validateBindingsAndRefs(document, refIssues);
    if (refIssues.length > 0) {
      return docError(
        refIssues[0]!.code,
        "Binding/Action 引用校验失败",
        firstPointer(refIssues),
      );
    }

    // 11. 树不变量
    const tree = validateTreeInvariants(document, {
      resolveType: (type, specVersion) => this.registry.resolveComponentType(type, specVersion),
    });
    if (!tree.ok) {
      return docError(ERROR_CODES.DOC_SCHEMA_INVALID, "树不变量校验失败", firstPointer(tree.issues));
    }

    // 12–13. 规范化序列化与哈希
    const semanticText = canonicalSerializeDocument(document);
    const semanticHash = sha256HexSync(semanticText);
    const contentHash = sha256HexSync(contentProjectionText(document));

    const frozen = deepFreeze(document);

    return {
      ok: true,
      value: {
        document: frozen,
        originalText: text,
        rawHash,
        semanticHash,
        contentHash,
        migratedFromFormatVersion: null,
        migratedTypes,
        diagnostics: [] as readonly DiagnosticV1[],
      },
    };
  }

  serialize(document: DeepReadonly<ComponentsDocumentV1>): Result<string> {
    const validation = this.validate(document);
    if (!validation.ok) {
      return docError(ERROR_CODES.DOC_SCHEMA_INVALID, "序列化前校验失败", firstPointer(validation.issues));
    }
    return { ok: true, value: canonicalSerializeDocument(document) };
  }

  validate(document: unknown): ValidationResult<ComponentsDocumentV1> {
    const shape = validateDocumentShape(document);
    if (!shape.ok) {
      return { ok: false, issues: shape.issues };
    }
    const value = shape.value;
    const typeIssues: ValidationIssue[] = [];
    this.validateKnownTypes(value, typeIssues);
    if (typeIssues.length > 0) {
      return { ok: false, issues: collectIssues(typeIssues) };
    }
    const refIssues: ValidationIssue[] = [];
    this.validateBindingsAndRefs(value, refIssues);
    if (refIssues.length > 0) {
      return { ok: false, issues: collectIssues([...typeIssues, ...refIssues]) };
    }
    const tree = validateTreeInvariants(value, {
      resolveType: (type, specVersion) => this.registry.resolveComponentType(type, specVersion),
    });
    if (!tree.ok) {
      return { ok: false, issues: collectIssues([...tree.issues]) };
    }
    return { ok: true, value, warnings: [] };
  }

  semanticHash(document: DeepReadonly<ComponentsDocumentV1>): Result<string> {
    return { ok: true, value: sha256HexSync(canonicalSerializeDocument(document)) };
  }

  contentHash(document: DeepReadonly<ComponentsDocumentV1>): Result<string> {
    return { ok: true, value: sha256HexSync(contentProjectionText(document)) };
  }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  private runTypeMigrations(
    document: ComponentsDocumentV1,
    context: DeterministicMigrationContextV1,
    migratedTypes: MigratedTypeRecordV1[],
  ): Result<ComponentsDocumentV1> {
    let doc = document;
    // 组件
    const nodes: ComponentsDocumentV1["nodes"] = { ...doc.nodes };
    for (const [nodeId, node] of Object.entries(nodes)) {
      const resolution = this.registry.resolveComponentType(node.type, node.specVersion);
      if (resolution.kind !== "known") continue; // unknown/future 保留
      const migrations = resolution.descriptor.migrations;
      if (migrations.length === 0) continue;
      const path = resolveMigrationPath(migrations, node.specVersion, resolution.descriptor.currentSpecVersion);
      if (!path) {
        return docError(ERROR_CODES.MIGRATION_PATH_MISSING, `缺少迁移路径: ${node.type}`, `/nodes/${nodeId}/specVersion`);
      }
      let current = node;
      for (const m of path) {
        const result = m.migrate(current, context);
        if (!result.ok) {
          return docError(ERROR_CODES.MIGRATION_FAILED, `组件迁移失败: ${node.type}`, `/nodes/${nodeId}`);
        }
        current = result.value;
        migratedTypes.push({ type: node.type, from: m.from, to: m.to });
        // 每步立即校验输出
        const revalidate = validateDocumentShape({
          ...doc,
          nodes: { ...nodes, [nodeId]: current },
        });
        if (!revalidate.ok) {
          return docError(ERROR_CODES.MIGRATION_OUTPUT_INVALID, `迁移输出非法: ${node.type}`, `/nodes/${nodeId}`);
        }
      }
      nodes[nodeId as import("@ocs/contracts").ComponentId] = current;
    }
    doc = { ...doc, nodes };

    // 数据源
    const dataSources: ComponentsDocumentV1["dataSources"] = {};
    for (const [dsId, ds] of Object.entries(doc.dataSources)) {
      let current = ds;
      if (!("classification" in current)) {
        const resolution = this.registry.resolveDataSourceType(current.type, current.specVersion);
        if (resolution.kind === "known" && resolution.descriptor.migrations.length > 0) {
          const path = resolveMigrationPath(
            resolution.descriptor.migrations as unknown as readonly { from: number; to: number }[],
            current.specVersion,
            resolution.descriptor.currentSpecVersion,
          );
          if (!path) {
            return docError(ERROR_CODES.MIGRATION_PATH_MISSING, `缺少数据源迁移路径: ${current.type}`, `/dataSources/${dsId}`);
          }
          for (const m of path) {
            const result = (m as unknown as { migrate(i: unknown, c: unknown): Result<unknown> }).migrate(
              current,
              context,
            );
            if (!result.ok) {
              return docError(ERROR_CODES.MIGRATION_FAILED, `数据源迁移失败: ${current.type}`, `/dataSources/${dsId}`);
            }
            current = result.value as PersistedDataSourceSpecV1;
            migratedTypes.push({ type: current.type, from: m.from, to: m.to });
          }
        }
      }
      dataSources[dsId as import("@ocs/contracts").DataSourceId] = current;
    }
    doc = { ...doc, dataSources };

    // 动作
    const nodes2: ComponentsDocumentV1["nodes"] = {};
    for (const [nodeId, node] of Object.entries(doc.nodes)) {
      const events: Record<string, import("@ocs/contracts/document").EventSequenceV1> = {};
      for (const [eventName, seq] of Object.entries(node.events)) {
        events[eventName] = {
          ...seq,
          actions: seq.actions.map((action) => {
            if ("classification" in action) return action;
            const resolution = this.registry.resolveActionType(action.type, action.specVersion);
            if (resolution.kind !== "known" || resolution.descriptor.migrations.length === 0) {
              return action;
            }
            const path = resolveMigrationPath(
              resolution.descriptor.migrations as unknown as readonly { from: number; to: number }[],
              action.specVersion,
              resolution.descriptor.currentSpecVersion,
            );
            if (!path) {
              // 无迁移路径：按未知保留
              return action;
            }
            let current: PersistedActionSpecV1 = action;
            for (const m of path) {
              const result = (m as unknown as { migrate(i: unknown, c: unknown): Result<unknown> }).migrate(
                current,
                context,
              );
              if (!result.ok) return action;
              current = result.value as PersistedActionSpecV1;
              migratedTypes.push({ type: current.type, from: m.from, to: m.to });
            }
            return current;
          }),
        };
      }
      nodes2[nodeId as import("@ocs/contracts").ComponentId] = { ...node, events };
    }
    doc = { ...doc, nodes: nodes2 };
    return { ok: true, value: doc };
  }

  private validateKnownTypes(document: ComponentsDocumentV1, issues: ValidationIssue[]): void {
    for (const [nodeId, node] of Object.entries(document.nodes)) {
      const resolution = this.registry.resolveComponentType(node.type, node.specVersion);
      if (resolution.kind !== "known") continue;
      const desc = resolution.descriptor;
      const nodePointer = `/nodes/${escapeSeg(nodeId)}`;
      // Props Schema
      validateAgainstSchema(node.props, desc.propsSchema, desc.schemaDefs, issues, `${nodePointer}/props`);
      if (issues.length > 0) break;
    }
    for (const [dsId, ds] of Object.entries(document.dataSources)) {
      if ("classification" in ds) continue;
      const resolution = this.registry.resolveDataSourceType(ds.type, ds.specVersion);
      if (resolution.kind !== "known") continue;
      validateAgainstSchema(
        ds.config,
        resolution.descriptor.configSchema,
        {},
        issues,
        `/dataSources/${escapeSeg(dsId)}/config`,
      );
      if (issues.length > 0) break;
    }
    for (const [nodeId, node] of Object.entries(document.nodes)) {
      for (const [eventName, seq] of Object.entries(node.events)) {
        for (let i = 0; i < seq.actions.length; i++) {
          const action = seq.actions[i]!;
          if ("classification" in action) continue;
          const resolution = this.registry.resolveActionType(action.type, action.specVersion);
          if (resolution.kind !== "known") continue;
          validateAgainstSchema(
            action as unknown as Record<string, unknown>,
            resolution.descriptor.persistedSchema,
            {},
            issues,
            `/nodes/${escapeSeg(nodeId)}/events/${escapeSeg(eventName)}/actions/${i}`,
          );
          if (issues.length > 0) return;
        }
      }
    }
  }

  private validateBindingsAndRefs(document: ComponentsDocumentV1, issues: ValidationIssue[]): void {
    const dataSourceIds = new Set(Object.keys(document.dataSources));
    for (const [nodeId, node] of Object.entries(document.nodes)) {
      const resolution = this.registry.resolveComponentType(node.type, node.specVersion);
      const bindableTargets =
        resolution.kind === "known" ? resolution.descriptor.bindableTargets : [];
      for (let i = 0; i < node.bindings.length; i++) {
        const binding = node.bindings[i]!;
        const pointer = `/nodes/${escapeSeg(nodeId)}/bindings/${i}`;
        if (bindableTargets.length > 0 && !matchesBindableTarget(binding.target, bindableTargets)) {
          issues.push({
            pointer: `${pointer}/target`,
            code: ERROR_CODES.BINDING_TARGET_INVALID,
            message: `target 不在 bindableTargets 中: ${binding.target}`,
            severity: "error",
          });
        }
        const missing = findMissingSourceRefs(binding.expr, dataSourceIds);
        for (const sourceId of missing) {
          issues.push({
            pointer: `${pointer}/expr`,
            code: ERROR_CODES.BINDING_SOURCE_MISSING,
            message: `Binding 引用不存在的 DataSource: ${sourceId}`,
            severity: "error",
          });
        }
      }
    }
  }
}

function decodeStrict(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return null;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\uFFFD")) return null;
    return text;
  } catch {
    return null;
  }
}

function firstPointer(issues: readonly ValidationIssue[]): string {
  return issues[0]?.pointer ?? "";
}

function escapeSeg(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function matchesBindableTarget(target: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/*")) {
      return target.startsWith(pattern.slice(0, -1));
    }
    return target === pattern;
  });
}

function findMissingSourceRefs(expr: unknown, known: Set<string>): string[] {
  const missing: string[] = [];
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    if (obj.op === "source" && typeof obj.sourceId === "string" && !known.has(obj.sourceId)) {
      missing.push(obj.sourceId);
    }
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) {
        for (const x of v) walk(x);
      } else {
        walk(v);
      }
    }
  };
  walk(expr);
  return missing;
}

/** 解析连续 N→N+1 迁移路径。 */
function resolveMigrationPath<T extends { from: number; to: number }>(
  migrations: readonly T[],
  fromVersion: number,
  toVersion: number,
): readonly T[] | null {
  if (fromVersion >= toVersion) return [];
  const byFrom = new Map<number, T>();
  for (const m of migrations) byFrom.set(m.from, m);
  const path: T[] = [];
  let current = fromVersion;
  const guard = new Set<number>();
  while (current < toVersion) {
    if (guard.has(current)) return null;
    guard.add(current);
    const m = byFrom.get(current);
    if (!m || m.to !== current + 1) return null;
    path.push(m);
    current = m.to;
  }
  return path;
}

function stableIdFor(
  scope: string,
  oldIdentity: string,
  _documentId: string,
  sourceRawHash: string,
): string {
  const namespace = `components-studio-migration/${sourceRawHash}/${scope}`;
  return stableUuidV4(namespace, oldIdentity);
}

export type { ActionSpecV1, ComponentMigrationV1, FormatMigrationV1, ActionMigrationV1, JsonSchema };
