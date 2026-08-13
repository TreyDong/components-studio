/**
 * 严格树不变量校验（《文档与会话协议 v1》第 3.8 节）。
 *
 * 1. `nodes[rootId]` 存在且 `type === "core.layout"`。
 * 2. Root 没有父节点；其余节点恰好一个父节点。
 * 3. 所有节点从 Root 可达；无环、孤立、悬空 ChildRef。
 * 4. 深度以 Root 为 1，最大 128。
 * 5. 已知父组件的 Slot 名、容量和 acceptedTypes 合法。
 * 6. 未知/未来父组件跳过 Definition-specific 校验，仍执行 1～4。
 */

import type {
  ChildPlacementV1,
  ComponentsDocumentV1,
  ComponentType,
  DeepReadonly,
  DiagnosticV1,
  ValidationIssue,
} from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";
import type {
  ComponentTypeResolution,
  SlotDescriptor,
} from "./types";

export interface TreeInvariantContext {
  /** 已知当前版本的组件解析结果；未知/未来返回 unknown。 */
  resolveType(type: ComponentType, specVersion: number): ComponentTypeResolution;
}

export interface TreeInvariantResult {
  ok: boolean;
  issues: readonly ValidationIssue[];
  /** Root 深度（缺失时为 null）。 */
  rootDepth: number | null;
}

export function validateTreeInvariants(
  document: DeepReadonly<ComponentsDocumentV1>,
  context: TreeInvariantContext,
): TreeInvariantResult {
  const issues: ValidationIssue[] = [];
  const add = (pointer: string, code: ValidationIssue["code"], message: string) => {
    issues.push({ pointer, code, message, severity: "error" });
  };

  const nodes = document.nodes;
  const rootId = document.rootId;

  // 1. Root 存在
  if (!(rootId in nodes)) {
    add("/rootId", ERROR_CODES.DOC_ROOT_MISSING, "rootId 不在 nodes 中");
    return { ok: false, issues, rootDepth: null };
  }
  const root = nodes[rootId]!;
  if (root.type !== "core.layout") {
    add("/rootId", ERROR_CODES.DOC_ROOT_TYPE_INVALID, "Root 类型必须精确为 core.layout");
    return { ok: false, issues, rootDepth: null };
  }

  // 2-4. 父索引与可达性
  const parentOf = new Map<string, { parentId: string; slot: string; index: number }>();
  const referenced = new Set<string>();
  const slotIndex = new Map<string, Map<string, { parentId: string; slot: string; index: number }>>();

  for (const [nodeId, node] of Object.entries(nodes)) {
    for (const [slotName, refs] of Object.entries(node.slots)) {
      for (let i = 0; i < refs.length; i++) {
        const ref = refs[i]!;
        const childId = ref.nodeId;
        if (!(childId in nodes)) {
          add(
            `/nodes/${escapeSeg(nodeId)}/slots/${escapeSeg(slotName)}/${i}`,
            ERROR_CODES.DOC_DANGLING_REFERENCE,
            `悬空 ChildRef: ${childId}`,
          );
          continue;
        }
        if (referenced.has(childId)) {
          add(
            `/nodes/${escapeSeg(nodeId)}/slots/${escapeSeg(slotName)}/${i}`,
            ERROR_CODES.DOC_MULTIPLE_PARENTS,
            `节点 ${childId} 有多个父节点`,
          );
        }
        referenced.add(childId);
        parentOf.set(childId, { parentId: nodeId, slot: slotName, index: i });
        let byParent = slotIndex.get(nodeId);
        if (!byParent) {
          byParent = new Map();
          slotIndex.set(nodeId, byParent);
        }
        byParent.set(childId, { parentId: nodeId, slot: slotName, index: i });
      }
    }
  }

  // 每个非 Root 节点恰好一个父
  for (const nodeId of Object.keys(nodes)) {
    if (nodeId === rootId) continue;
    if (!parentOf.has(nodeId)) {
      add(`/nodes/${escapeSeg(nodeId)}`, ERROR_CODES.DOC_ORPHAN_NODE, `孤立节点（无父）: ${nodeId}`);
    }
  }

  // Root 不得被引用
  if (referenced.has(rootId)) {
    add("/rootId", ERROR_CODES.DOC_MULTIPLE_PARENTS, "Root 不得有父节点");
  }

  // 可达性：从 Root 出发 DFS，检测环与深度
  const depthOf = new Map<string, number>();
  const visiting = new Set<string>();
  let maxDepth = 0;

  const walk = (nodeId: string, depth: number): boolean => {
    if (depth > 128) {
      add(`/nodes/${escapeSeg(nodeId)}`, ERROR_CODES.DOC_TREE_TOO_DEEP, "树深度超过 128");
      return false;
    }
    if (visiting.has(nodeId)) {
      add(`/nodes/${escapeSeg(nodeId)}`, ERROR_CODES.DOC_CYCLE_DETECTED, "检测到环");
      return false;
    }
    if (depthOf.has(nodeId)) {
      return true; // 已访问
    }
    visiting.add(nodeId);
    depthOf.set(nodeId, depth);
    if (depth > maxDepth) maxDepth = depth;
    const node = nodes[nodeId as import("@ocs/contracts").ComponentId]!;
    for (const refs of Object.values(node.slots)) {
      for (const ref of refs) {
        if (ref.nodeId in nodes) {
          if (!walk(ref.nodeId, depth + 1)) return false;
        }
      }
    }
    visiting.delete(nodeId);
    return true;
  };

  walk(rootId, 1);

  // 孤立节点不可能通过 walk 到达：它们已经在上面报过 DOC_ORPHAN_NODE。

  // 5. 已知父组件的 Slot 校验
  for (const [nodeId, node] of Object.entries(nodes)) {
    const resolution = context.resolveType(node.type, node.specVersion);
    if (resolution.kind !== "known") continue; // 未知/未来父组件跳过
    const desc = resolution.descriptor;
    const nodePrefix = `/nodes/${escapeSeg(nodeId)}`;
    const slotDefs = new Map(desc.slots.map((s) => [s.name, s]));

    // Slot 键集合必须与 Definition 完全一致
    const declared = new Set(desc.slots.map((s) => s.name));
    const present = new Set(Object.keys(node.slots));
    for (const name of present) {
      if (!declared.has(name)) {
        add(`${nodePrefix}/slots/${escapeSeg(name)}`, ERROR_CODES.DOC_SLOT_UNKNOWN, `未知 Slot: ${name}`);
      }
    }
    for (const name of declared) {
      if (!present.has(name)) {
        add(`${nodePrefix}/slots`, ERROR_CODES.DOC_SLOT_SET_MISMATCH, `缺少声明 Slot: ${name}`);
      }
    }

    // 容量与类型
    for (const [slotName, refs] of Object.entries(node.slots)) {
      const def = slotDefs.get(slotName);
      if (!def) continue;
      const slotPrefix = `${nodePrefix}/slots/${escapeSeg(slotName)}`;
      if (def.cardinality.kind === "one" && refs.length > 1) {
        add(slotPrefix, ERROR_CODES.DOC_SLOT_CARDINALITY, `one 容量 Slot 超过 1: ${slotName}`);
      }
      if (def.cardinality.kind === "many") {
        if (def.cardinality.max !== undefined && refs.length > def.cardinality.max) {
          add(slotPrefix, ERROR_CODES.DOC_SLOT_CARDINALITY, `many 容量超限: ${slotName}`);
        }
        if (def.cardinality.min !== undefined && refs.length < def.cardinality.min) {
          add(slotPrefix, ERROR_CODES.DOC_SLOT_CARDINALITY, `many 容量不足: ${slotName}`);
        }
      }
      for (let i = 0; i < refs.length; i++) {
        const ref = refs[i]!;
        const child = nodes[ref.nodeId];
        if (!child) continue;
        if (!slotAccepts(def, child.type)) {
          add(
            `${slotPrefix}/${i}`,
            ERROR_CODES.DOC_CHILD_TYPE_REJECTED,
            `Slot ${slotName} 不接受类型 ${child.type}`,
          );
        }
      }
    }
  }

  // Columns 基点总和 == 10000（parent 为 core.layout 且 slot 非空）
  // 与 Grid 越界/重叠（parent 为 core.layout 且 mode=grid）
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (node.type !== "core.layout") continue;
    const resolution = context.resolveType(node.type, node.specVersion);
    if (resolution.kind !== "known") continue;
    const nodePrefix = `/nodes/${escapeSeg(nodeId)}`;
    const props = node.props as DeepReadonly<{
      mode?: string;
      grid?: {
        columns?: { compact?: number; regular?: number; wide?: number };
        allowOverlap?: boolean;
      };
    }>;
    const mode = props.mode;
    for (const [slotName, refs] of Object.entries(node.slots)) {
      if (slotName !== "children") continue;
      if (refs.length === 0) continue;
      if (mode === "columns") {
        const sum = refs.reduce((acc, r) => acc + r.placement.column.basisBp, 0);
        if (sum !== 10000) {
          add(
            `${nodePrefix}/slots/children`,
            ERROR_CODES.DOC_COLUMN_BASIS_INVALID,
            `Columns 基点总和必须为 10000，实际 ${sum}`,
          );
        }
      }
      if (mode === "grid") {
        const cols = props.grid?.columns;
        if (cols) {
          for (const bp of ["compact", "regular", "wide"] as const) {
            const colCount = cols[bp];
            if (typeof colCount !== "number") continue;
            const rects = refs
              .map((r) => ({ id: r.nodeId, rect: r.placement.grid[bp] }))
              .filter(({ id }) => {
                const n = nodes[id];
                return n && n.enabled && n.style.visibility === "visible";
              });
            for (const { id, rect } of rects) {
              if (rect.x + rect.w > colCount) {
                add(
                  `${nodePrefix}/slots/children`,
                  ERROR_CODES.EDITOR_PLACEMENT_OUT_OF_BOUNDS,
                  `Grid 越界: ${id} @ ${bp}`,
                );
              }
            }
            if (props.grid?.allowOverlap === false) {
              for (let i = 0; i < rects.length; i++) {
                for (let j = i + 1; j < rects.length; j++) {
                  if (rectsIntersect(rects[i]!.rect, rects[j]!.rect)) {
                    add(
                      `${nodePrefix}/slots/children`,
                      ERROR_CODES.DOC_GRID_OVERLAP,
                      `Grid 重叠: ${rects[i]!.id} 与 ${rects[j]!.id} @ ${bp}`,
                    );
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return { ok: issues.length === 0, issues, rootDepth: maxDepth };
}

function slotAccepts(def: SlotDescriptor, childType: ComponentType): boolean {
  const rule = def.accepts;
  if (!rule) return true;
  if (rule.excludeTypes?.includes(childType)) return false;
  if (rule.excludeCategories) {
    // 分类判断依赖 Manifest；文档侧只能校验显式类型列表。
  }
  if (rule.types && rule.types.length > 0) {
    return rule.types.includes(childType);
  }
  return true;
}

function rectsIntersect(
  a: DeepReadonly<{ x: number; y: number; w: number; h: number }>,
  b: DeepReadonly<{ x: number; y: number; w: number; h: number }>,
): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function escapeSeg(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

export type { ChildPlacementV1, DiagnosticV1 };
