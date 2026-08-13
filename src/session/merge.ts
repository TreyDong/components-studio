/**
 * 三方 Merge 与 Conflict（《文档与会话协议 v1》第 14 章）。
 *
 * 输入 Base/Local/Remote 均为成功校验的 V1 文档。算法按 14.3–14.8 逐逻辑字段合并：
 * - 顶层字段：14.3 通用三方规则；revision/updatedAt 取 Remote；createdAt 特判。
 * - 文档身份：14.4 documentId 三方必须相同，否则中止（document-identity）。
 * - Node 存在性：14.5 存在性表；delete-modify / duplicate-add。
 * - Node 字段：14.6 逐字段（props/style/extensions 递归按键）；
 *   type/specVersion 两侧不同变更 → type-version。
 * - Binding/Action：14.7 按 BindingId/ActionId 为逻辑键；顺序规则 + Info Diagnostic。
 * - Parent/Move/Slot 顺序：14.8；move-move / delete-move / order-order；
 *   Placement 按普通对象字段合并。
 *
 * `resolve` 回调（可选）把冲突现场就地解析为 local/remote/base 一侧：
 * 无回调（或返回 null）时用 Base 作为确定性占位，冲突仍被完整记录。
 * 手工 Resolution 用相同的冲突 id 重跑本算法（seedConflicts 复用 id），
 * 保证 choices 与 PendingConflict.conflicts 一一对应。
 */

import type {
  ComponentId,
  ComponentsDocumentV1,
  ConflictId,
  DeepReadonly,
  DiagnosticV1,
  FileSnapshotV1,
  JsonObject,
  JsonValue,
  MaybeJsonValueV1,
  MergeConflictV1,
  PersistedDataSourceSpecV1,
} from "@ocs/contracts";
import { newUuidV4 } from "../shared/id";

export type MergeSide = "local" | "remote" | "base";

export interface MergeInput {
  readonly base: DeepReadonly<ComponentsDocumentV1>;
  readonly local: DeepReadonly<ComponentsDocumentV1>;
  readonly remote: DeepReadonly<ComponentsDocumentV1>;
  readonly remoteSnapshot: FileSnapshotV1;
}

export interface MergeOptions {
  /** 冲突就地解析回调；返回 null/base 时使用 Base 占位。 */
  readonly resolve?: (conflict: MergeConflictV1) => MergeSide | null;
  /** 复用手工 Resolution 的既有冲突 id（按 kind+pointer 匹配）。 */
  readonly seedConflicts?: readonly MergeConflictV1[];
}

export interface MergeOutcome {
  /** document-identity 中止：不产生候选，只含身份冲突。 */
  readonly aborted: boolean;
  /** 无身份冲突时的合并候选（含冲突占位）；身份冲突时为 null。 */
  readonly candidate: DeepReadonly<ComponentsDocumentV1> | null;
  readonly conflicts: readonly MergeConflictV1[];
  readonly diagnostics: readonly DiagnosticV1[];
}

type Maybe = { kind: "missing" } | { kind: "value"; value: JsonValue };

function mb(value: JsonValue | undefined): MaybeJsonValueV1 {
  return value === undefined ? { kind: "missing" } : { kind: "value", value };
}

function _toMaybe(value: JsonValue | undefined): Maybe {
  return value === undefined ? { kind: "missing" } : { kind: "value", value };
}

function _fromMaybe(m: Maybe): JsonValue | undefined {
  return m.kind === "missing" ? undefined : m.value;
}

/** 规范化深等：对象按键集合（与插入顺序无关）。 */
export function jsonDeepEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!jsonDeepEqual(a[i]!, b[i]!)) return false;
      }
      return true;
    }
    const aObj = a as Record<string, JsonValue>;
    const bObj = b as Record<string, JsonValue>;
    const aKeys = Object.keys(aObj).sort();
    const bKeys = Object.keys(bObj).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) {
      if (aKeys[i] !== bKeys[i]) return false;
      if (!jsonDeepEqual(aObj[aKeys[i]!]!, bObj[aKeys[i]!]!)) return false;
    }
    return true;
  }
  return false;
}

function isPlainJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return (
    value !== undefined &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

interface ParentLocation {
  readonly parentId: ComponentId;
  readonly slot: string;
}

interface ResolvedNode {
  readonly id: ComponentId;
  readonly present: boolean;
  /** 合并后的节点内容（不含 slots；slots 由顺序/位置算法重建）。 */
  readonly content: JsonObject;
  readonly location: ParentLocation | null;
}

class Merger {
  readonly conflicts: MergeConflictV1[] = [];
  readonly diagnostics: DiagnosticV1[] = [];
  private readonly seedIds = new Map<string, ConflictId>();
  private readonly resolve: (conflict: MergeConflictV1) => MergeSide | null;
  private readonly base: ComponentsDocumentV1;
  private readonly local: ComponentsDocumentV1;
  private readonly remote: ComponentsDocumentV1;
  private readonly remoteSnapshot: FileSnapshotV1;

  constructor(input: MergeInput, options: MergeOptions) {
    this.base = input.base as unknown as ComponentsDocumentV1;
    this.local = input.local as unknown as ComponentsDocumentV1;
    this.remote = input.remote as unknown as ComponentsDocumentV1;
    this.remoteSnapshot = input.remoteSnapshot;
    this.resolve = options.resolve ?? (() => null);
    for (const seed of options.seedConflicts ?? []) {
      this.seedIds.set(`${seed.kind}\u0000${seed.pointer}`, seed.id);
    }
  }

  private conflictId(kind: MergeConflictV1["kind"], pointer: string): ConflictId {
    const seeded = this.seedIds.get(`${kind}\u0000${pointer}`);
    return seeded ?? (newUuidV4() as ConflictId);
  }

  private record(
    kind: MergeConflictV1["kind"],
    pointer: string,
    componentId: ComponentId | null,
    base: JsonValue | undefined,
    local: JsonValue | undefined,
    remote: JsonValue | undefined,
  ): MergeConflictV1 {
    const conflict: MergeConflictV1 = {
      id: this.conflictId(kind, pointer),
      kind,
      pointer,
      componentId,
      base: mb(base),
      local: mb(local),
      remote: mb(remote),
    };
    this.conflicts.push(conflict);
    return conflict;
  }

  private chosen(base: JsonValue | undefined, local: JsonValue | undefined, remote: JsonValue | undefined, conflict: MergeConflictV1 | null): JsonValue | undefined {
    if (!conflict) return base;
    const side = this.resolve(conflict);
    if (side === "local") return local;
    if (side === "remote") return remote;
    return base;
  }

  private warning(code: DiagnosticV1["code"], message: string, pointer: string): void {
    this.diagnostics.push({
      code,
      severity: "info",
      message,
      pointer,
      componentId: null,
      recoverable: true,
      details: {},
    });
  }

  /** 14.3 通用三方值合并；不可自动合并时记录 value Conflict 并取 Base 占位。 */
  mergeValue(
    pointer: string,
    componentId: ComponentId | null,
    base: JsonValue | undefined,
    local: JsonValue | undefined,
    remote: JsonValue | undefined,
    kind: MergeConflictV1["kind"] = "value",
  ): JsonValue | undefined {
    if (local === undefined && remote === undefined) return undefined;
    if (local === undefined || remote === undefined) {
      // 一侧删除/新增：Base 无则取存在侧；与 Base 相同则视为双方删除；否则冲突
      if (local === undefined) {
        if (base === undefined) return remote;
        if (remote !== undefined && jsonDeepEqual(remote, base)) return undefined;
      } else if (base === undefined) {
        return local;
      } else if (jsonDeepEqual(local, base)) {
        return undefined;
      }
      const conflict = this.record(kind, pointer, componentId, base, local, remote);
      return this.chosen(base, local, remote, conflict);
    }
    if (base !== undefined && jsonDeepEqual(local, base)) return remote;
    if (base !== undefined && jsonDeepEqual(remote, base)) return local;
    if (jsonDeepEqual(local, remote)) return local;
    if (isPlainJsonObject(base) && isPlainJsonObject(local) && isPlainJsonObject(remote)) {
      return this.mergeObjects(pointer, componentId, base, local, remote);
    }
    const conflict = this.record(kind, pointer, componentId, base, local, remote);
    return this.chosen(base, local, remote, conflict);
  }

  /** 普通对象递归按键合并（14.3 / 14.6）。 */
  private mergeObjects(
    pointer: string,
    componentId: ComponentId | null,
    base: Record<string, JsonValue>,
    local: Record<string, JsonValue>,
    remote: Record<string, JsonValue>,
  ): Record<string, JsonValue> {
    const out: Record<string, JsonValue> = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    for (const key of [...keys].sort()) {
      const merged = this.mergeValue(
        `${pointer}/${escapeSeg(key)}`,
        componentId,
        key in base ? base[key] : undefined,
        key in local ? local[key] : undefined,
        key in remote ? remote[key] : undefined,
      );
      if (merged !== undefined) out[key] = merged;
    }
    return out;
  }

  /**
   * 14.7 按逻辑键合并数组（Binding 按 BindingId、Action 按 ActionId）。
   * 顺序规则：最终列表双方相同取任一；只有一侧相对 Base 改变取该侧；
   * 双方都改且不同 → order-order；Base 无顺序信息且双方新增不同 ID 时
   * 以 Remote 为基线按 Local 相对顺序追加并记录 Info Diagnostic。
   * 存在性冲突（delete-modify / duplicate-add）每个 key 只记录一次。
   */
  mergeKeyedArray(
    pointer: string,
    componentId: ComponentId | null,
    base: readonly JsonObject[],
    local: readonly JsonObject[],
    remote: readonly JsonObject[],
    keyOf: (item: JsonObject) => string,
  ): JsonObject[] {
    const byKey = (list: readonly JsonObject[]): Map<string, JsonObject> => {
      const m = new Map<string, JsonObject>();
      for (const item of list) m.set(keyOf(item), item);
      return m;
    };
    const bm = byKey(base);
    const lm = byKey(local);
    const rm = byKey(remote);
    const keys = new Set([...bm.keys(), ...lm.keys(), ...rm.keys()]);

    // 单趟：存在性（14.5 表）→ 冲突只记一次 → 合并值
    const survival = new Map<string, boolean>();
    const mergedByKey = new Map<string, JsonObject>();
    for (const key of [...keys].sort()) {
      const b = bm.get(key);
      const l = lm.get(key);
      const r = rm.get(key);
      const itemPointer = `${pointer}/${escapeSeg(key)}`;
      if (l === undefined && r === undefined) {
        survival.set(key, false);
        continue;
      }
      if (l === undefined || r === undefined) {
        const baseVal = b as JsonValue | undefined;
        const localVal = l as JsonValue | undefined;
        const remoteVal = r as JsonValue | undefined;
        if (l === undefined && baseVal !== undefined && remoteVal !== undefined && jsonDeepEqual(remoteVal, baseVal)) {
          survival.set(key, false);
          continue;
        }
        if (r === undefined && baseVal !== undefined && localVal !== undefined && jsonDeepEqual(localVal, baseVal)) {
          survival.set(key, false);
          continue;
        }
        const conflict = this.record("delete-modify", itemPointer, componentId, baseVal, localVal, remoteVal);
        const side = this.resolve(conflict);
        survival.set(key, side === "local" ? l !== undefined : side === "remote" ? r !== undefined : true);
        const picked = side === "local" ? localVal : side === "remote" ? remoteVal : baseVal;
        if (picked !== undefined) mergedByKey.set(key, picked as JsonObject);
        continue;
      }
      if (b === undefined) {
        if (jsonDeepEqual(l as JsonValue, r as JsonValue)) {
          survival.set(key, true);
          mergedByKey.set(key, l);
          continue;
        }
        const conflict = this.record("duplicate-add", itemPointer, componentId, undefined, l as JsonValue, r as JsonValue);
        const side = this.resolve(conflict);
        survival.set(key, side === "local" || side === "remote");
        mergedByKey.set(key, (side === "remote" ? r : l) as JsonObject);
        continue;
      }
      survival.set(key, true);
      const merged = this.mergeValue(itemPointer, componentId, b as JsonValue, l as JsonValue, r as JsonValue);
      if (merged !== undefined) mergedByKey.set(key, merged as JsonObject);
    }

    // 顺序
    const survivorIds = (list: readonly JsonObject[]): string[] =>
      list.map((i) => keyOf(i)).filter((k) => survival.get(k) === true);
    const baseOrder = survivorIds(base);
    const localOrder = survivorIds(local);
    const remoteOrder = survivorIds(remote);
    const arraysEqual = (a: readonly string[], b: readonly string[]): boolean =>
      a.length === b.length && a.every((v, i) => v === b[i]);

    let order: string[];
    if (arraysEqual(localOrder, remoteOrder)) {
      order = localOrder;
    } else if (arraysEqual(localOrder, baseOrder)) {
      order = remoteOrder;
    } else if (arraysEqual(remoteOrder, baseOrder)) {
      order = localOrder;
    } else if (baseOrder.length === 0 && localOrder.length > 0 && remoteOrder.length > 0) {
      // 14.7：双方新增不同 ID 且 Base 无顺序信息
      const localAdded = localOrder.filter((k) => !remoteOrder.includes(k));
      order = [...remoteOrder, ...localAdded];
      this.warning(
        "MERGE_CONFLICT",
        "双方分别新增不同逻辑键，以 Remote 顺序为基线按 Local 相对顺序追加",
        pointer,
      );
    } else {
      const conflict = this.record(
        "order-order",
        pointer,
        componentId,
        baseOrder as unknown as JsonValue,
        localOrder as unknown as JsonValue,
        remoteOrder as unknown as JsonValue,
      );
      const side = this.resolve(conflict);
      order = side === "local" ? localOrder : side === "remote" ? remoteOrder : baseOrder;
    }
    const out: JsonObject[] = [];
    for (const key of order) {
      const item = mergedByKey.get(key);
      if (item) out.push(item);
    }
    return out;
  }

  /**
   * 存在性表（14.5），返回节点最终形态：
   * - "delete"：两侧删除或一侧删除另一侧未变 → 删除。
   * - "take-*"：只在一侧存在/新增 → 取该侧。
   * - "merge"：两侧都改 → 字段合并。
   * - "conflict"：delete-modify / duplicate-add。
   */
  private nodePresence(
    id: ComponentId,
    b: JsonObject | undefined,
    l: JsonObject | undefined,
    r: JsonObject | undefined,
  ): "delete" | "take-local" | "take-remote" | "merge" | "conflict" {
    if (l === undefined && r === undefined) return "delete";
    if (l === undefined) {
      // base 无：仅 remote 新增 → 取 remote；base 有：remote 未变 → 删除；否则冲突
      if (b === undefined) return "take-remote";
      if (r !== undefined && jsonDeepEqual(r as JsonValue, b as JsonValue)) return "delete";
      return "conflict";
    }
    if (r === undefined) {
      if (b === undefined) return "take-local";
      if (jsonDeepEqual(l as JsonValue, b as JsonValue)) return "delete";
      return "conflict";
    }
    if (b === undefined) {
      if (jsonDeepEqual(l as JsonValue, r as JsonValue)) return "take-local";
      return "conflict";
    }
    if (jsonDeepEqual(l as JsonValue, b as JsonValue)) return "take-remote";
    if (jsonDeepEqual(r as JsonValue, b as JsonValue)) return "take-local";
    if (jsonDeepEqual(l as JsonValue, r as JsonValue)) return "take-local";
    return "merge";
  }

  run(): MergeOutcome {
    const base = this.base;
    const local = this.local;
    const remote = this.remote;

    // 14.4 文档身份
    if (base.documentId !== local.documentId || base.documentId !== remote.documentId) {
      this.record("document-identity", "/documentId", null, base.documentId, local.documentId, remote.documentId);
      return { aborted: true, candidate: null, conflicts: this.conflicts, diagnostics: this.diagnostics };
    }

    const parentIndex = (doc: ComponentsDocumentV1): Map<string, ParentLocation> => {
      const m = new Map<string, ParentLocation>();
      for (const [nodeId, node] of Object.entries(doc.nodes)) {
        for (const [slotName, refs] of Object.entries(node.slots)) {
          for (const ref of refs) {
            m.set(ref.nodeId, { parentId: nodeId as ComponentId, slot: slotName });
          }
        }
      }
      return m;
    };
    const pb = parentIndex(base);
    const pl = parentIndex(local);
    const pr = parentIndex(remote);
    const locOf = (index: Map<string, ParentLocation>, id: string): ParentLocation | null =>
      index.get(id) ?? null;
    const locsEqual = (a: ParentLocation | null, b: ParentLocation | null): boolean =>
      a !== null && b !== null && a.parentId === b.parentId && a.slot === b.slot;

    const allIds = new Set<string>([
      ...Object.keys(base.nodes),
      ...Object.keys(local.nodes),
      ...Object.keys(remote.nodes),
    ]);

    const plans = new Map<string, ResolvedNode>();
    const baseNodeVal = (id: string): JsonObject | undefined => base.nodes[id as ComponentId] as unknown as JsonObject | undefined;
    const localNodeVal = (id: string): JsonObject | undefined => local.nodes[id as ComponentId] as unknown as JsonObject | undefined;
    const remoteNodeVal = (id: string): JsonObject | undefined => remote.nodes[id as ComponentId] as unknown as JsonObject | undefined;

    for (const id of [...allIds].sort()) {
      const b = baseNodeVal(id);
      const l = localNodeVal(id);
      const r = remoteNodeVal(id);
      const cid = id as ComponentId;
      const nodePointer = `/nodes/${escapeSeg(id)}`;

      const presence = this.nodePresence(cid, b, l, r);
      if (presence === "delete") {
        plans.set(id, { id: cid, present: false, content: {}, location: null });
        continue;
      }

      // 内容来源（14.5）与位置（14.8）分开解析：
      // 内容只决定字段取值；位置按三方 ParentLocation 独立合并。
      let contentSrc: JsonObject | undefined;
      let conflictSide: "local" | "remote" | null = null;
      let fieldMerge = false;
      if (presence === "take-local") {
        contentSrc = l;
      } else if (presence === "take-remote") {
        contentSrc = r;
      } else if (presence === "merge") {
        contentSrc = b;
        fieldMerge = true;
      } else {
        // delete-modify / delete-move / duplicate-add
        const localMissing = l === undefined;
        const remoteMissing = r === undefined;
        let kind: MergeConflictV1["kind"];
        if (localMissing || remoteMissing) {
          // 一侧删除：内容不同 → delete-modify；仅位置不同 → delete-move
          const otherContent = localMissing ? r : l;
          const contentChanged = b === undefined || !jsonDeepEqual(otherContent as JsonValue, b as JsonValue);
          kind = contentChanged ? "delete-modify" : "delete-move";
        } else {
          kind = "duplicate-add";
        }
        const presenceConflict = this.record(kind, nodePointer, cid, b as JsonValue | undefined, l as JsonValue | undefined, r as JsonValue | undefined);
        const side = this.resolve(presenceConflict);
        if (side === "local") {
          if (l === undefined) {
            plans.set(id, { id: cid, present: false, content: {}, location: null });
            continue;
          }
          contentSrc = l;
          conflictSide = "local";
        } else if (side === "remote") {
          if (r === undefined) {
            plans.set(id, { id: cid, present: false, content: {}, location: null });
            continue;
          }
          contentSrc = r;
          conflictSide = "remote";
        } else {
          // Base 占位：Base 无节点时用 Local（duplicate-add 无可参考的 Base）
          contentSrc = b ?? l ?? r;
        }
      }

      // 位置解析（14.8）：三方 ParentLocation 都存在时一律按规则合并，
      // 与内容来源（take-local/take-remote/merge/conflict）解耦。
      const lb = locOf(pb, id);
      const ll = locOf(pl, id);
      const lr = locOf(pr, id);
      const locVal = (loc: ParentLocation): JsonValue =>
        ({ parentId: loc.parentId, slot: loc.slot }) as unknown as JsonValue;
      let location: ParentLocation | null;
      if (lb !== null && ll !== null && lr !== null) {
        if (locsEqual(ll, lr)) {
          location = ll;
        } else if (locsEqual(ll, lb)) {
          location = lr;
        } else if (locsEqual(lr, lb)) {
          location = ll;
        } else {
          const moveConflict = this.record("move-move", nodePointer, cid, locVal(lb), locVal(ll), locVal(lr));
          const side = this.resolve(moveConflict);
          location = side === "local" ? ll : side === "remote" ? lr : lb;
        }
      } else if (presence === "take-local" || conflictSide === "local") {
        location = ll ?? lr ?? lb;
      } else if (presence === "take-remote" || conflictSide === "remote") {
        location = lr ?? ll ?? lb;
      } else {
        // Base 占位（delete-modify / delete-move）或两侧新增
        location = lb ?? ll ?? lr;
      }

      // 字段合并（14.6）或整侧内容
      let content: JsonObject;
      if (fieldMerge) {
        const bNode = (b ?? ({} as JsonObject)) as JsonObject;
        const lNode = (l ?? ({} as JsonObject)) as JsonObject;
        const rNode = (r ?? ({} as JsonObject)) as JsonObject;
        const type = this.mergeValue(`${nodePointer}/type`, cid, bNode.type, lNode.type, rNode.type, "type-version");
        const specVersion = this.mergeValue(`${nodePointer}/specVersion`, cid, bNode.specVersion, lNode.specVersion, rNode.specVersion, "type-version");
        const enabled = this.mergeValue(`${nodePointer}/enabled`, cid, bNode.enabled, lNode.enabled, rNode.enabled);
        const label = this.mergeValue(`${nodePointer}/label`, cid, bNode.label, lNode.label, rNode.label);
        const props = this.mergeValue(`${nodePointer}/props`, cid, bNode.props, lNode.props, rNode.props);
        const style = this.mergeValue(`${nodePointer}/style`, cid, bNode.style, lNode.style, rNode.style);
        const bindings = this.mergeKeyedArray(
          `${nodePointer}/bindings`,
          cid,
          (bNode.bindings ?? []) as JsonObject[],
          (lNode.bindings ?? []) as JsonObject[],
          (rNode.bindings ?? []) as JsonObject[],
          (item) => String(item.id),
        );
        const events = this.mergeEventsMap(nodePointer, cid, bNode.events as JsonObject | undefined, lNode.events as JsonObject | undefined, rNode.events as JsonObject | undefined);
        const extensions = this.mergeValue(`${nodePointer}/extensions`, cid, bNode.extensions, lNode.extensions, rNode.extensions);

        content = {};
        const put = (key: string, value: JsonValue | undefined): void => {
          if (value !== undefined) content[key] = value;
        };
        put("id", id);
        put("type", type);
        put("specVersion", specVersion);
        put("enabled", enabled);
        put("label", label);
        put("props", props);
        put("style", style);
        put("slots", {});
        put("bindings", bindings as unknown as JsonValue);
        put("events", events as unknown as JsonValue);
        put("extensions", extensions);
      } else {
        content = { ...(contentSrc ?? {}) };
      }

      plans.set(id, { id: cid, present: true, content, location });
    }

    // 14.8 Slot 顺序
    const slotKeys = new Set<string>();
    for (const [nodeId, node] of [...Object.entries(base.nodes), ...Object.entries(local.nodes), ...Object.entries(remote.nodes)]) {
      for (const slot of Object.keys(node.slots)) {
        slotKeys.add(`${nodeId}\u0000${slot}`);
      }
    }
    const slotChildren = (doc: ComponentsDocumentV1, nodeId: string, slot: string): string[] => {
      const node = doc.nodes[nodeId as ComponentId];
      if (!node) return [];
      return (node.slots[slot] ?? []).map((ref) => ref.nodeId);
    };
    const mergedSlotsByOwner = new Map<string, Record<string, JsonValue>>();
    for (const key of [...slotKeys].sort()) {
      const [nodeId, slot] = key.split("\u0000") as [string, string];
      const ownerId = nodeId as ComponentId;
      const slotPointer = `/nodes/${escapeSeg(nodeId)}/slots/${escapeSeg(slot)}`;
      const baseList = slotChildren(base, nodeId, slot);
      const localList = slotChildren(local, nodeId, slot);
      const remoteList = slotChildren(remote, nodeId, slot);

      const survivorOf = (list: readonly string[]): string[] =>
        list.filter((childId) => {
          const plan = plans.get(childId);
          return plan !== undefined && plan.present && plan.location !== null &&
            plan.location.parentId === ownerId && plan.location.slot === slot;
        });
      const bS = survivorOf(baseList);
      const lS = survivorOf(localList);
      const rS = survivorOf(remoteList);
      const arraysEqual = (a: readonly string[], b: readonly string[]): boolean =>
        a.length === b.length && a.every((v, i) => v === b[i]);

      let order: string[];
      if (arraysEqual(lS, rS)) {
        order = lS;
      } else if (arraysEqual(lS, bS)) {
        order = rS;
      } else if (arraysEqual(rS, bS)) {
        order = lS;
      } else {
        const conflict = this.record("order-order", slotPointer, ownerId, bS as unknown as JsonValue, lS as unknown as JsonValue, rS as unknown as JsonValue);
        const side = this.resolve(conflict);
        order = side === "local" ? lS : side === "remote" ? rS : bS;
      }

      // Placement 合并
      const placementOf = (doc: ComponentsDocumentV1, childId: string): JsonValue | undefined => {
        const node = doc.nodes[nodeId as ComponentId];
        if (!node) return undefined;
        for (const ref of node.slots[slot] ?? []) {
          if (ref.nodeId === childId) return ref.placement as unknown as JsonValue;
        }
        return undefined;
      };
      const refs: JsonValue[] = [];
      order.forEach((childId, index) => {
        const placement = this.mergeValue(
          `${slotPointer}/${index}/placement`,
          childId as ComponentId,
          placementOf(base, childId),
          placementOf(local, childId),
          placementOf(remote, childId),
        );
        refs.push({ nodeId: childId, placement: placement ?? placementOf(base, childId) ?? { tab: { title: null, icon: null, disabled: false }, column: {}, grid: {}, extensions: {} } });
      });

      const existing = mergedSlotsByOwner.get(nodeId) ?? {};
      existing[slot] = refs as unknown as JsonValue;
      mergedSlotsByOwner.set(nodeId, existing);
    }

    // 组装节点
    const mergedNodes: Record<string, JsonObject> = {};
    for (const [id, plan] of plans) {
      if (!plan.present) continue;
      const content: JsonObject = { ...plan.content };
      content.slots = mergedSlotsByOwner.get(id) ?? {};
      mergedNodes[id] = content;
    }

    // 顶层字段
    const rootId = this.mergeValue("/rootId", null, base.rootId, local.rootId, remote.rootId);
    const createdAt = this.mergeCreatedAt();
    const metadata = this.mergeValue("/metadata", null, base.metadata as unknown as JsonValue, local.metadata as unknown as JsonValue, remote.metadata as unknown as JsonValue);
    const permissions = this.mergeValue("/permissions", null, base.permissions as unknown as JsonValue, local.permissions as unknown as JsonValue, remote.permissions as unknown as JsonValue);
    const extensions = this.mergeValue("/extensions", null, base.extensions as unknown as JsonValue, local.extensions as unknown as JsonValue, remote.extensions as unknown as JsonValue);
    const dataSources = this.mergeDataSources();

    const candidate: JsonObject = {
      kind: "components-studio/document",
      formatVersion: 1,
      documentId: base.documentId,
      revision: remote.revision,
      updatedAt: remote.updatedAt,
      createdAt: createdAt ?? base.createdAt,
      rootId: rootId ?? base.rootId,
      nodes: mergedNodes as unknown as JsonValue,
      dataSources: dataSources as unknown as JsonValue,
      permissions: (permissions ?? base.permissions) as unknown as JsonValue,
      metadata: (metadata ?? base.metadata) as unknown as JsonValue,
      extensions: extensions ?? base.extensions,
    };

    return {
      aborted: false,
      candidate: candidate as unknown as DeepReadonly<ComponentsDocumentV1>,
      conflicts: this.conflicts,
      diagnostics: this.diagnostics,
    };
  }

  /** createdAt 特判（14.3）：任一侧改变都记 Info Warning；无明确来源时取 Base。 */
  private mergeCreatedAt(): JsonValue | undefined {
    const b = this.base.createdAt;
    const l = this.local.createdAt;
    const r = this.remote.createdAt;
    if (l === b && r === b) return b;
    const localChanged = l !== b;
    const remoteChanged = r !== b;
    if (localChanged && remoteChanged && l !== r) {
      this.warning("MERGE_CONFLICT", "createdAt 两侧不同变更，取 Base", "/createdAt");
      return b;
    }
    this.warning("MERGE_CONFLICT", "createdAt 被单侧修改", "/createdAt");
    if (localChanged && !remoteChanged) return l;
    if (remoteChanged && !localChanged) return r;
    return l !== undefined ? l : b;
  }

  private mergeDataSources(): Record<string, JsonValue> {
    const b = this.base.dataSources;
    const l = this.local.dataSources;
    const r = this.remote.dataSources;
    const keys = new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)]);
    const out: Record<string, JsonValue> = {};
    for (const key of [...keys].sort()) {
      const pointer = `/dataSources/${escapeSeg(key)}`;
      const bv = b[key as import("@ocs/contracts").DataSourceId] as unknown as JsonValue | undefined;
      const lv = l[key as import("@ocs/contracts").DataSourceId] as unknown as JsonValue | undefined;
      const rv = r[key as import("@ocs/contracts").DataSourceId] as unknown as JsonValue | undefined;
      const merged = this.mergeValue(pointer, null, bv, lv, rv);
      if (merged !== undefined) out[key] = merged;
    }
    return out;
  }

  /** Event map：按事件名存在性 + 序列字段合并，actions 按 ActionId。 */
  private mergeEventsMap(
    nodePointer: string,
    componentId: ComponentId,
    base: JsonObject | undefined,
    local: JsonObject | undefined,
    remote: JsonObject | undefined,
  ): Record<string, JsonValue> {
    const out: Record<string, JsonValue> = {};
    const keys = new Set([
      ...Object.keys(base ?? {}),
      ...Object.keys(local ?? {}),
      ...Object.keys(remote ?? {}),
    ]);
    for (const name of [...keys].sort()) {
      const eventPointer = `${nodePointer}/events/${escapeSeg(name)}`;
      const bv = base ? (base[name] as JsonObject | undefined) : undefined;
      const lv = local ? (local[name] as JsonObject | undefined) : undefined;
      const rv = remote ? (remote[name] as JsonObject | undefined) : undefined;
      if (lv === undefined && rv === undefined) continue;
      if (lv === undefined || rv === undefined) {
        const merged = this.mergeValue(eventPointer, componentId, bv as unknown as JsonValue, lv as unknown as JsonValue, rv as unknown as JsonValue);
        if (merged !== undefined) out[name] = merged;
        continue;
      }
      if (bv === undefined) {
        if (jsonDeepEqual(lv as unknown as JsonValue, rv as unknown as JsonValue)) {
          out[name] = lv as unknown as JsonValue;
          continue;
        }
        const conflict = this.record("duplicate-add", eventPointer, componentId, undefined, lv as unknown as JsonValue, rv as unknown as JsonValue);
        const side = this.resolve(conflict);
        out[name] = (side === "remote" ? rv : lv) as unknown as JsonValue;
        continue;
      }
      // 字段合并（actions 按 ActionId）
      const sequence: JsonObject = {};
      for (const field of ["concurrency", "maxQueue", "preventDefault", "stopPropagation"] as const) {
        const merged = this.mergeValue(`${eventPointer}/${field}`, componentId, bv[field], lv[field], rv[field]);
        if (merged !== undefined) sequence[field] = merged;
      }
      const actions = this.mergeKeyedArray(
        `${eventPointer}/actions`,
        componentId,
        (bv.actions ?? []) as JsonObject[],
        (lv.actions ?? []) as JsonObject[],
        (rv.actions ?? []) as JsonObject[],
        (item) => String(item.id),
      );
      sequence.actions = actions as unknown as JsonValue;
      out[name] = sequence as unknown as JsonValue;
    }
    return out;
  }
}

export function threeWayMerge(input: MergeInput, options: MergeOptions = {}): MergeOutcome {
  return new Merger(input, options).run();
}

export function escapeSeg(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

export type { PersistedDataSourceSpecV1 };
