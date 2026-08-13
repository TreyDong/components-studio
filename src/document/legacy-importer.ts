/**
 * LegacyComponents25Importer（《文档与会话协议 v1》第 8 章）。
 *
 * 旧格式（rootComponentId + components[]）没有 kind/formatVersion，
 * 不是 Format Migration，必须经本 Importer 显式导入：
 * - 不覆盖旧文件；不运行旧脚本/动作/命令/表达式。
 * - multi → core.layout；其他类型 → legacy.components-2-5 只读占位。
 * - 确定性 ID：stableId(fixedNamespace, "components-2.5/document/"+sourceRawHash)
 *   与 stableId(documentId, "component/"+oldId)，重复导入结果一致。
 */

import type {
  ChildPlacementV1,
  ComponentsDocumentV1,
  DiagnosticV1,
  LegacyComponents25Document,
  LegacyImportInputV1,
  LegacyImportReportV1,
  LegacyComponents25ImporterV1,
  Result,
} from "@ocs/contracts";
import {
  DEFAULT_CHILD_PLACEMENT_V1,
  ERROR_CODES,
} from "@ocs/contracts";
import type { ComponentId, JsonObject, JsonValue } from "@ocs/contracts";
import { stableUuidV4 } from "../shared/id";
import { sha256HexSync } from "../shared/hash";

/** 8.4 固定 Namespace 字符串。 */
const FIXED_NAMESPACE = "7d967f3e-43be-5d4b-b0ec-68088d9ab68b";

/** 8.6 新导入 Layout 列数固定：Compact 4 / Regular 6 / Wide 12。 */
const IMPORT_GRID_COLUMNS = { compact: 4, regular: 6, wide: 12 } as const;

const LAYOUT_TYPE_MAP: Record<string, string> = {
  tab: "tabs",
  verticalTab: "vertical-tabs",
  column: "columns",
  list: "stack",
  grid: "grid",
};

interface OldNode {
  id: string;
  type: string;
  [key: string]: JsonValue;
}

function err<T>(code: string, message: string): Result<T> {
  return {
    ok: false,
    error: {
      code: code as never,
      message,
      scope: "import",
      recoverable: true,
      retryable: false,
    },
  };
}

export class LegacyComponents25Importer implements LegacyComponents25ImporterV1 {
  inspect(bytes: Uint8Array): Result<LegacyComponents25Document> {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return err(ERROR_CODES.DOC_INVALID_UTF8, "旧文件不是合法 UTF-8");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return err(ERROR_CODES.DOC_INVALID_JSON, "旧文件不是合法 JSON");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return err(ERROR_CODES.LEGACY_NOT_RECOGNIZED, "顶层必须是对象");
    }
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.rootComponentId !== "string" || !Array.isArray(obj.components)) {
      return err(
        ERROR_CODES.LEGACY_NOT_RECOGNIZED,
        "缺少 String rootComponentId 与 Array components；这不是 Components 2.5 文件",
      );
    }
    const components = obj.components as unknown as JsonValue[];
    for (let i = 0; i < components.length; i++) {
      const c = components[i];
      if (c === null || typeof c !== "object" || Array.isArray(c)) {
        return err(ERROR_CODES.LEGACY_GRAPH_INVALID, `components[${i}] 不是对象`);
      }
      const node = c as Record<string, unknown>;
      if (typeof node.id !== "string" || node.id.length === 0) {
        return err(ERROR_CODES.LEGACY_GRAPH_INVALID, `components[${i}] 缺少非空 id`);
      }
      if (typeof node.type !== "string" || node.type.length === 0) {
        return err(ERROR_CODES.LEGACY_GRAPH_INVALID, `components[${i}] 缺少非空 type`);
      }
    }
    return {
      ok: true,
      value: { rootComponentId: obj.rootComponentId, components: components as unknown as import("@ocs/contracts").JsonObject[] },
    };
  }

  convert(input: LegacyImportInputV1): Result<{
    document: ComponentsDocumentV1;
    report: LegacyImportReportV1;
  }> {
    const inspected = this.inspect(input.sourceBytes);
    if (!inspected.ok) return inspected;
    const legacy = inspected.value;

    // ---- 图校验（8.3）----
    const nodes = new Map<string, OldNode>();
    for (const raw of legacy.components) {
      const node = raw as OldNode;
      if (nodes.has(node.id)) {
        return err(ERROR_CODES.LEGACY_DUPLICATE_ID, `重复旧 ID: ${node.id}`);
      }
      nodes.set(node.id, node);
    }
    if (!nodes.has(legacy.rootComponentId)) {
      return err(ERROR_CODES.LEGACY_ROOT_MISSING, "rootComponentId 不存在");
    }
    const childrenOf = new Map<string, string[]>();
    for (const node of nodes.values()) {
      const kids: string[] = [];
      const raw = node.components;
      if (Array.isArray(raw)) {
        for (const ref of raw) {
          if (ref === null || typeof ref !== "object" || Array.isArray(ref)) {
            return err(ERROR_CODES.LEGACY_DANGLING_REFERENCE, `${node.id} 的子引用不是对象`);
          }
          const componentId = (ref as Record<string, unknown>).componentId;
          if (typeof componentId !== "string") {
            return err(ERROR_CODES.LEGACY_DANGLING_REFERENCE, `${node.id} 的子引用缺少 componentId`);
          }
          kids.push(componentId);
        }
      }
      childrenOf.set(node.id, kids);
    }
    // 可达性 + 唯一父 + 无环：从 root DFS
    const parentOf = new Map<string, string>();
    const visited = new Set<string>();
    const stack: Array<{ id: string; parent: string | null }> = [
      { id: legacy.rootComponentId, parent: null },
    ];
    while (stack.length > 0) {
      const { id, parent } = stack.pop()!;
      if (visited.has(id)) {
        return err(ERROR_CODES.LEGACY_GRAPH_INVALID, `检测到环或多父: ${id}`);
      }
      visited.add(id);
      if (parent !== null) parentOf.set(id, parent);
      for (const childId of childrenOf.get(id) ?? []) {
        if (!nodes.has(childId)) {
          return err(ERROR_CODES.LEGACY_DANGLING_REFERENCE, `悬空引用: ${childId}`);
        }
        stack.push({ id: childId, parent: id });
      }
    }
    if (visited.size !== nodes.size) {
      return err(ERROR_CODES.LEGACY_GRAPH_INVALID, "存在孤立节点（不可达）");
    }

    // ---- 确定性 ID（8.4）----
    const sourceRawHash = sha256HexSync(input.sourceBytes);
    const documentId = stableUuidV4(
      FIXED_NAMESPACE,
      `components-2.5/document/${sourceRawHash}`,
    ) as import("@ocs/contracts").DocumentId;
    const newIdOf = new Map<string, ComponentId>();
    for (const id of nodes.keys()) {
      newIdOf.set(id, stableUuidV4(documentId, `component/${id}`) as ComponentId);
    }

    const warnings: DiagnosticV1[] = [];
    const converted: Array<LegacyImportReportV1["converted"][number]> = [];
    const preservedAsLegacy: Array<LegacyImportReportV1["preservedAsLegacy"][number]> = [];

    // ---- 转换（8.5/8.6）----
    const v1Nodes: Record<ComponentId, import("@ocs/contracts").ComponentNodeV1> = {};

    const convertNode = (oldNode: OldNode): import("@ocs/contracts").ComponentNodeV1 => {
      const newId = newIdOf.get(oldNode.id)!;
      const base = {
        id: newId,
        specVersion: 1,
        enabled: true,
        label: null,
        style: defaultStyle(),
        bindings: [],
        events: {},
        extensions: {
          "legacy.components-2-5": oldNode as unknown as JsonObject,
        } as Record<import("@ocs/contracts").NamespacedKey, JsonValue>,
      };

      if (oldNode.type === "multi") {
        const kids = childrenOf.get(oldNode.id) ?? [];
        const layoutType =
          typeof oldNode.layoutType === "string" ? oldNode.layoutType : "";
        const mode = LAYOUT_TYPE_MAP[layoutType] ?? "stack";
        if (!LAYOUT_TYPE_MAP[layoutType] && layoutType !== "") {
          warnings.push({
            code: ERROR_CODES.LEGACY_GRAPH_INVALID,
            severity: "warning",
            message: `未知 layoutType "${layoutType}" 映射为 stack`,
            pointer: `/components/${oldNode.id}`,
            componentId: newId,
            recoverable: true,
            details: {},
          });
        }
        // 权重分配 Column basisBp（8.6）
        const weights = kids.map((childId) => {
          const child = nodes.get(childId)!;
          const w = child.widthRatio;
          if (typeof w === "number" && Number.isFinite(w) && w > 0) return w;
          if (typeof w === "number" && (w === -1 || w === 0 || w < 0)) return 1;
          return 1;
        });
        const basis = distributeBasis(weights);
        const children = kids.map((childId, index) => {
          const child = nodes.get(childId)!;
          const grid = oldGridPlacement(child);
          if (!grid) {
            warnings.push({
              code: ERROR_CODES.LEGACY_GRAPH_INVALID,
              severity: "warning",
              message: `子节点 ${childId} 缺少 Grid Rect，使用默认值`,
              pointer: `/components/${oldNode.id}/components/${index}`,
              componentId: newId,
              recoverable: true,
              details: {},
            });
          }
          const tabTitle =
            typeof child.tabTitle === "string" && child.tabTitle.length > 0
              ? child.tabTitle
              : null;
          const placement: ChildPlacementV1 = {
            tab: { title: tabTitle, icon: null, disabled: false },
            column: {
              basisBp: basis[index]!,
              grow: 0,
              shrink: 1,
              minWidthPx: 0,
              maxWidthPx: null,
            },
            grid: grid ?? structuredClonePlacement(DEFAULT_CHILD_PLACEMENT_V1).grid,
            extensions: {},
          };
          return {
            nodeId: newIdOf.get(childId)!,
            placement,
          };
        });
        converted.push({
          oldId: oldNode.id,
          newId,
          oldType: "multi",
          newType: "core.layout" as import("@ocs/contracts").ComponentType,
        });
        return {
          ...base,
          type: "core.layout" as import("@ocs/contracts").ComponentType,
          props: {
            mode,
            gap: 12,
            padding: 0,
            locked: oldNode.locked === true,
            grid: {
              columns: { ...IMPORT_GRID_COLUMNS },
              rowHeight: 80,
              dense: false,
              allowOverlap: false,
            },
            columns: { wrap: true, equalWidth: false },
            tabs: { activation: "automatic", placement: "top" },
          },
          slots: { children },
        } as import("@ocs/contracts").ComponentNodeV1;
      }

      // 其他所有类型 → legacy.components-2-5 只读占位（8.5）
      preservedAsLegacy.push({
        oldId: oldNode.id,
        newId,
        oldType: oldNode.type,
        reason: "无 V1 受控定义；保留原始 JSON 为只读占位",
      });
      return {
        ...base,
        type: "legacy.components-2-5" as import("@ocs/contracts").ComponentType,
        props: {
          legacyType: oldNode.type,
          legacyNode: oldNode as unknown as JsonObject,
          sourceRawHash,
        },
        slots: {},
      } as import("@ocs/contracts").ComponentNodeV1;
    };

    // 按父子关系后序转换（子先于父，保证 ChildRef 指向已存在的节点；顺序无关紧要，
    // 因为最终 map 一次性构建——但 multi 的 children 引用的是 newIdOf，不依赖顺序）。
    for (const node of nodes.values()) {
      v1Nodes[newIdOf.get(node.id)!] = convertNode(node);
    }

    const rootId = newIdOf.get(legacy.rootComponentId)!;
    // Root 必须是 core.layout：旧 root 若非 multi（如 custom），无法作为 V1 root。
    if (v1Nodes[rootId]!.type !== "core.layout") {
      return err(
        ERROR_CODES.LEGACY_GRAPH_INVALID,
        "旧 root 不是 multi，无法转换（V1 Root 必须为 core.layout）",
      );
    }

    const document: ComponentsDocumentV1 = {
      kind: "components-studio/document",
      formatVersion: 1,
      documentId,
      revision: 0,
      createdAt: input.now,
      updatedAt: input.now,
      rootId,
      nodes: v1Nodes,
      dataSources: {},
      permissions: { requested: [] },
      metadata: { title: "", description: "", tags: [] },
      extensions: {},
    };

    const report: LegacyImportReportV1 = {
      sourceRawHash,
      targetDocumentId: documentId,
      mappedIds: Object.fromEntries(
        [...newIdOf.entries()].map(([oldId, newId]) => [oldId, newId]),
      ),
      converted,
      preservedAsLegacy,
      warnings,
    };

    return { ok: true, value: { document, report } };
  }
}

function defaultStyle(): import("@ocs/contracts").NodeStyleV1 {
  return {
    visibility: "visible",
    classNames: [],
    width: "auto",
    minHeightPx: null,
    paddingPx: { top: 0, right: 0, bottom: 0, left: 0 },
    marginPx: { top: 0, right: 0, bottom: 0, left: 0 },
    background: null,
    color: null,
    border: null,
    shadow: "none",
  };
}

function structuredClonePlacement<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 均分/权重分配：先 floor，余数按小数余数从大到小、相同则按数组顺序分配，
 * 最终严格等于 10000（文档协议 3.7 / 8.6）。
 */
export function distributeBasis(weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const total = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (10000 * w) / total);
  const floors = exact.map(Math.floor);
  let remaining = 10000 - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ frac: v - floors[i]!, index: i }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  const out = [...floors];
  for (const { index } of order) {
    if (remaining <= 0) break;
    out[index] = out[index]! + 1;
    remaining--;
  }
  return out;
}

interface OldGridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 旧 Grid：mobile → compact，laptop → wide，regular 由 laptop 12 列等比缩放到 6 列。 */
function oldGridPlacement(child: OldNode): ChildPlacementV1["grid"] | null {
  const grid = child.grid;
  if (grid === null || typeof grid !== "object" || Array.isArray(grid)) {
    return null;
  }
  const g = grid as Record<string, unknown>;
  const mobile = g.mobile as OldGridRect | undefined;
  const laptop = g.laptop as OldGridRect | undefined;
  const compact = rectOf(mobile) ?? rectOf(laptop);
  const wide = rectOf(laptop) ?? rectOf(mobile);
  const regular = wide
    ? {
        x: Math.min(5, Math.max(0, Math.round((wide.x * 6) / 12))),
        y: wide.y,
        w: Math.min(6, Math.max(1, Math.round((wide.w * 6) / 12))),
        h: wide.h,
      }
    : null;
  if (!compact && !wide) return null;
  return {
    compact: withMinMax(compact ?? defaultRect(1)),
    regular: withMinMax(regular ?? defaultRect(3)),
    wide: withMinMax(wide ?? defaultRect(4)),
  };
}

function rectOf(v: unknown): OldGridRect | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const num = (k: string): number =>
    typeof r[k] === "number" && Number.isFinite(r[k] as number) ? (r[k] as number) : -1;
  const x = num("x");
  const y = num("y");
  const w = num("w");
  const h = num("h");
  if (x < 0 || y < 0 || w < 1 || h < 1) return null;
  return { x, y, w, h };
}

function defaultRect(w: number): OldGridRect {
  return { x: 0, y: 0, w, h: 4 };
}

function withMinMax(
  rect: OldGridRect,
): ChildPlacementV1["grid"]["compact"] {
  return {
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    minW: 1,
    maxW: null,
    minH: 1,
    maxH: null,
  };
}
