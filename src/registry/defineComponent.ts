/**
 * defineComponent（《运行时与 SDK 协议 v1》第 2.5 节规则 7）。
 *
 * 在构建期与运行时共同验证 ComponentDefinition：
 * type 形状、Manifest 字段、propsSchema（受控子集 + $defs）、Slot/Event 唯一性、
 * Migration 连续性（连续 N→N+1 链、按 from 升序）、bindableTargets、默认 Props、
 * 配套数据源 draft。
 *
 * 校验失败统一抛 REGISTRY_DEFINITION_INVALID（defineComponent 签名不返回 Result）；
 * ComponentRegistry.register() 复用同一校验并返回 Result 形式。
 */

import {
  ERROR_CODES,
  isComponentType,
  SLOT_NAME_PATTERN,
} from "@ocs/contracts/common";
import type { ProtocolError } from "@ocs/contracts/common";
import type {
  CompanionDraftContext,
  ComponentDefinition,
  CreateComponentContext,
  NewDataSourceDraft,
} from "./definition";
import { compileSchema } from "../schema/validator";
import type { JsonObjectSchema } from "../schema/validator";
import { defaultIdFactory, newComponentId, newDocumentId } from "../shared/id";

/** 严格 SemVer：主.次.补丁，可选 -prerelease 或 +build。packageMajor=主版本。 */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** IconName 形状（与 schema validator 的 icon-name format 一致）。 */
const ICON_NAME_PATTERN = /^[a-z0-9-]+$/;

/** Slot 名（运行时协议第 2.2 节）：小写 kebab。 */
const SLOT_NAME_PATTERN_STRICT = /^[a-z][a-z0-9-]{0,63}$/;

/** 静态类别表（运行时协议第 2.1 节）。 */
const CATEGORIES: Record<string, true> = {
  layout: true,
  content: true,
  data: true,
  time: true,
  action: true,
  integration: true,
  custom: true,
};

interface LiteIssue {
  readonly pointer: string;
  readonly message: string;
}

type ValidationOutcome =
  | { ok: true }
  | { ok: false; error: ProtocolError };

function definitionError(issues: readonly LiteIssue[]): ProtocolError {
  const first = issues[0];
  return {
    code: ERROR_CODES.REGISTRY_DEFINITION_INVALID,
    message: `组件定义非法: ${first?.message ?? "未知原因"}`,
    scope: "registry",
    recoverable: true,
    retryable: false,
    details: {
      issues: issues.map((i) => ({ pointer: i.pointer, message: i.message })),
    },
  };
}

/** 从 SemVer 提取主版本号（调用前须已通过 SEMVER_PATTERN）。 */
export function packageMajorOf(packageVersion: string): number {
  const major = packageVersion.split(".")[0];
  const n = Number.parseInt(major ?? "", 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 校验 ComponentDefinition；失败返回 REGISTRY_DEFINITION_INVALID。
 * defineComponent 抛错；register() 返回 Result。
 */
export function validateComponentDefinition<P extends object>(
  definition: ComponentDefinition<P>,
): ValidationOutcome {
  if (definition === null || typeof definition !== "object") {
    return { ok: false, error: definitionError([{ pointer: "$", message: "Definition 必须是对象" }]) };
  }

  const issues: LiteIssue[] = [];

  const manifest = definition.manifest;
  const type: unknown = manifest.type;
  if (typeof type !== "string" || !isComponentType(type)) {
    issues.push({ pointer: "/manifest/type", message: `非法组件类型: ${String(type)}` });
  }
  if (typeof manifest.displayName !== "string" || manifest.displayName.trim() === "") {
    issues.push({ pointer: "/manifest/displayName", message: "displayName 不能为空" });
  }
  if (typeof manifest.description !== "string" || manifest.description.trim() === "") {
    issues.push({ pointer: "/manifest/description", message: "description 不能为空" });
  }
  if (typeof manifest.icon !== "string" || !ICON_NAME_PATTERN.test(manifest.icon)) {
    issues.push({ pointer: "/manifest/icon", message: `非法 icon 名称: ${String(manifest.icon)}` });
  }
  if (
    typeof manifest.specVersion !== "number" ||
    !Number.isSafeInteger(manifest.specVersion) ||
    manifest.specVersion < 1
  ) {
    issues.push({ pointer: "/manifest/specVersion", message: "specVersion 必须是 >=1 的整数" });
  }
  if (typeof manifest.vendor !== "string" || manifest.vendor.trim() === "") {
    issues.push({ pointer: "/manifest/vendor", message: "vendor 不能为空" });
  }
  if (typeof manifest.packageVersion !== "string" || !SEMVER_PATTERN.test(manifest.packageVersion)) {
    issues.push({
      pointer: "/manifest/packageVersion",
      message: `非法 SemVer: ${String(manifest.packageVersion)}`,
    });
  }
  if (typeof manifest.category !== "string" || !CATEGORIES[manifest.category]) {
    issues.push({ pointer: "/manifest/category", message: `未知组件类别: ${String(manifest.category)}` });
  }

  // --- propsSchema：顶层 object + additionalProperties:false，受控子集编译通过 ---
  const schema: unknown = definition.propsSchema;
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    issues.push({ pointer: "/propsSchema", message: "顶层 Schema 必须为 object" });
  } else {
    const obj = schema as JsonObjectSchema;
    if (obj.type !== "object") {
      issues.push({ pointer: "/propsSchema", message: "顶层 Schema 必须为 object" });
    }
    if (obj.additionalProperties !== false) {
      issues.push({ pointer: "/propsSchema/additionalProperties", message: "顶层必须 additionalProperties: false" });
    }
    const compiled = compileSchema(obj);
    if (!compiled.ok) {
      const first = compiled.issues[0];
      issues.push({
        pointer: `/propsSchema${first?.pointer && first.pointer !== "$" ? first.pointer : ""}`,
        message: `Schema 编译失败: ${first?.message ?? "未知原因"}`,
      });
    }
  }

  // --- slots：唯一 + 严格小写模式 + displayName 非空 ---
  const slotNames = new Set<string>();
  definition.slots.forEach((slot, i) => {
    const ptr = `/slots/${i}`;
    if (typeof slot.name !== "string" || !SLOT_NAME_PATTERN_STRICT.test(slot.name)) {
      issues.push({ pointer: `${ptr}/name`, message: `非法 slot 名: ${String(slot.name)}` });
    } else if (slotNames.has(slot.name)) {
      issues.push({ pointer: `${ptr}/name`, message: `slot 名重复: ${slot.name}` });
    } else {
      slotNames.add(slot.name);
    }
    if (typeof slot.displayName !== "string" || slot.displayName.trim() === "") {
      issues.push({ pointer: `${ptr}/displayName`, message: "slot displayName 不能为空" });
    }
  });

  // --- events：唯一 + 名称模式 ---
  const eventNames = new Set<string>();
  definition.events.forEach((event, i) => {
    if (typeof event.name !== "string" || !SLOT_NAME_PATTERN.test(event.name)) {
      issues.push({ pointer: `/events/${i}/name`, message: `非法事件名: ${String(event.name)}` });
    } else if (eventNames.has(event.name)) {
      issues.push({ pointer: `/events/${i}/name`, message: `事件名重复: ${event.name}` });
    } else {
      eventNames.add(event.name);
    }
  });

  // --- migrations：连续 N→N+1 纯函数链，按 from 升序 ---
  const migrations = definition.migrations;
  const seenFrom = new Set<number>();
  let sorted = true;
  migrations.forEach((m, i) => {
    const ptr = `/migrations/${i}`;
    if (m.type !== type) {
      issues.push({ pointer: `${ptr}/type`, message: `迁移类型与 manifest.type 不一致: ${m.type}` });
    }
    if (!Number.isSafeInteger(m.from) || !Number.isSafeInteger(m.to) || m.to !== m.from + 1) {
      issues.push({ pointer: ptr, message: `迁移必须为连续 N→N+1: ${m.from}→${m.to}` });
    }
    if (seenFrom.has(m.from)) {
      issues.push({ pointer: ptr, message: `重复的迁移起点: ${m.from}` });
    }
    seenFrom.add(m.from);
    if (i > 0) {
      const prev = migrations[i - 1]!;
      if (m.from <= prev.from) sorted = false;
      if (prev.to !== m.from) {
        issues.push({
          pointer: ptr,
          message: `迁移链断裂: ${prev.from}→${prev.to} 之后缺少 ${prev.to}→${prev.to + 1}`,
        });
      }
    }
  });
  if (!sorted && migrations.length > 1) {
    issues.push({ pointer: "/migrations", message: "迁移必须按 from 升序排列" });
  }

  // --- bindableTargets：非空 RFC 6901 Pointer（相对 node.props）---
  definition.bindableTargets.forEach((target, i) => {
    if (typeof target !== "string" || target === "" || !target.startsWith("/")) {
      issues.push({ pointer: `/bindableTargets/${i}`, message: `非法绑定目标指针: ${String(target)}` });
    } else if (/~(?![01])/.test(target)) {
      issues.push({ pointer: `/bindableTargets/${i}`, message: `指针含未转义的 ~: ${target}` });
    }
  });

  // --- 默认 Props：输出必须通过 Definition.validate ---
  const context = syntheticContext();
  let defaults: unknown;
  try {
    defaults = definition.createDefaultProps(context);
  } catch (err) {
    issues.push({
      pointer: "/createDefaultProps",
      message: `createDefaultProps 抛出异常: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  if (defaults !== undefined) {
    const result = definition.validate(defaults);
    if (!result.ok) {
      const first = result.issues[0];
      issues.push({
        pointer: `/createDefaultProps${first?.pointer ?? ""}`,
        message: `默认 Props 校验失败: ${first?.message ?? "未知原因"}`,
      });
    }
  }

  // --- 配套数据源：key 唯一 + type vault.query ---
  const draftContext: CompanionDraftContext = {
    documentId: context.documentId,
    componentId: context.componentId,
    parentId: null,
    sourcePath: "",
    locale: "system",
    createdAt: context.createdAt,
    ids: defaultIdFactory,
  };
  let drafts: readonly NewDataSourceDraft[] | undefined;
  try {
    drafts = definition.createCompanionDataSources(draftContext);
  } catch (err) {
    issues.push({
      pointer: "/createCompanionDataSources",
      message: `createCompanionDataSources 抛出异常: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  if (drafts) {
    const keys = new Set<string>();
    drafts.forEach((draft, i) => {
      const ptr = `/createCompanionDataSources/${i}`;
      if (typeof draft.key !== "string") {
        issues.push({ pointer: `${ptr}/key`, message: "draft 缺少字符串 key" });
      } else if (keys.has(draft.key)) {
        issues.push({ pointer: `${ptr}/key`, message: `draft key 重复: ${draft.key}` });
      } else {
        keys.add(draft.key);
      }
      if (draft.type !== "vault.query") {
        issues.push({ pointer: `${ptr}/type`, message: `配套数据源类型必须为 vault.query，实际: ${draft.type}` });
      }
    });
  }

  if (issues.length > 0) {
    return { ok: false, error: definitionError(issues) };
  }
  return { ok: true };
}

/**
 * defineComponent：校验通过后原样返回 Definition（不变形、不冻结；
 * 深冻结发生在 register() 第 2.5 节规则 5）。非法定义抛 ProtocolError。
 */
export function defineComponent<P extends object>(
  definition: ComponentDefinition<P>,
): ComponentDefinition<P> {
  const outcome = validateComponentDefinition(definition);
  if (!outcome.ok) {
    throw outcome.error;
  }
  return definition;
}

function syntheticContext(): CreateComponentContext {
  return {
    documentId: newDocumentId(),
    componentId: newComponentId(),
    parentId: null,
    sourcePath: "",
    locale: "system",
    createdAt: new Date().toISOString(),
    ids: defaultIdFactory,
    companions: {},
  };
}
