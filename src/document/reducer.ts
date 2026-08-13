/**
 * Document Command 协议（《文档与会话协议 v1》第 9 章）的纯函数 reducer。
 * 在不可变 Draft 上依次应用命令；不校验、不写文件、不发布事件。
 * 完整校验由 Session 在事务提交前执行。
 */

import type {
  ActionId,
  BindingId,
  ChildPlacementV1,
  ComponentId,
  ComponentNodeV1,
  ComponentsDocumentV1,
  DataSourceId,
  DocumentCommandV1,
  ErrorCode,
} from "@ocs/contracts";
import { ERROR_CODES, UUID_V4_PATTERN } from "@ocs/contracts";
import type { JsonObject } from "@ocs/contracts";
import { newUuidV4 } from "../shared/id";
import type { CodecRegistry } from "./types";

export interface ReducerFailure {
  ok: false;
  code: ErrorCode;
  message: string;
  componentId?: ComponentId;
}

export interface ReducerSuccess {
  ok: true;
  document: ComponentsDocumentV1;
  createdComponentIds: ComponentId[];
  changedComponentIds: ComponentId[];
  deletedComponentIds: ComponentId[];
  changedDataSourceIds: DataSourceId[];
  idMap: Record<string, string>;
}

export type ReducerResult = ReducerSuccess | ReducerFailure;

export interface ReducerContext {
  readonly registry: CodecRegistry;
}

const fail = (code: ErrorCode, message: string, componentId?: ComponentId): ReducerFailure => ({
  ok: false,
  code,
  message,
  componentId,
});

function cloneNode(node: ComponentNodeV1): ComponentNodeV1 {
  return JSON.parse(JSON.stringify(node)) as ComponentNodeV1;
}

function cloneDocument(doc: ComponentsDocumentV1): ComponentsDocumentV1 {
  // 结构化深拷贝：文档被验证为纯 JSON。
  return JSON.parse(JSON.stringify(doc)) as ComponentsDocumentV1;
}

/** 复制整个子树（含递归子节点）。 */
function duplicateSubtreeDeep(
  sourceId: ComponentId,
  document: ComponentsDocumentV1,
  idMap: Record<string, string>,
): { nodes: Record<ComponentId, ComponentNodeV1> } {
  const source = document.nodes[sourceId];
  if (!source) throw new Error(`复制源节点不存在: ${sourceId}`);
  const out: Record<ComponentId, ComponentNodeV1> = {};
  const stack: ComponentNodeV1[] = [cloneNode(source)];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const newId = newUuidV4();
    idMap[node.id] = newId;
    const copy = { ...node, id: newId as ComponentId };
    copy.bindings = copy.bindings.map((b) => {
      const nb = { ...b, id: newUuidV4() as BindingId };
      idMap[b.id] = nb.id;
      return nb;
    });
    const newEvents: ComponentNodeV1["events"] = {};
    for (const [eventName, seq] of Object.entries(copy.events)) {
      newEvents[eventName] = {
        ...seq,
        actions: seq.actions.map((a) => {
          const na = { ...a, id: newUuidV4() as ActionId };
          idMap[a.id] = na.id;
          return na;
        }),
      };
    }
    copy.events = newEvents;
    const newSlots: ComponentNodeV1["slots"] = {};
    for (const [slotName, refs] of Object.entries(copy.slots)) {
      newSlots[slotName] = refs.map((ref) => ({ ...ref, nodeId: ref.nodeId })); // 重写由循环后处理
    }
    copy.slots = newSlots;
    out[copy.id] = copy;
    // 收集子节点继续复制（保持新 ID 映射）
    for (const refs of Object.values(node.slots)) {
      for (const ref of refs) {
        const child = document.nodes[ref.nodeId];
        if (child) stack.push(cloneNode(child));
      }
    }
  }
  // 第二轮：重写内部 ChildRef 到新 ID
  const seen = new Set<string>();
  const rewrite = (node: ComponentNodeV1): void => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    for (const refs of Object.values(node.slots)) {
      for (const ref of refs) {
        const mapped = idMap[ref.nodeId];
        if (mapped) {
          ref.nodeId = mapped as ComponentId;
          const child = out[mapped as ComponentId];
          if (child) rewrite(child);
        }
      }
    }
  };
  for (const node of Object.values(out)) {
    rewrite(node);
  }
  return { nodes: out };
}

/** 收集节点子树内的全部后代 ID。 */
function subtreeIds(document: ComponentsDocumentV1, rootId: ComponentId): Set<ComponentId> {
  const ids = new Set<ComponentId>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    const node = document.nodes[id];
    if (!node) continue;
    for (const refs of Object.values(node.slots)) {
      for (const ref of refs) stack.push(ref.nodeId);
    }
  }
  return ids;
}

/** 查找节点的父位置（parentId + slot + index）。 */
function findParent(
  document: ComponentsDocumentV1,
  componentId: ComponentId,
): { parentId: ComponentId; slot: string; index: number } | null {
  for (const [parentId, parent] of Object.entries(document.nodes)) {
    for (const [slotName, refs] of Object.entries(parent.slots)) {
      for (let i = 0; i < refs.length; i++) {
        if (refs[i]!.nodeId === componentId) {
          return { parentId: parentId as ComponentId, slot: slotName, index: i };
        }
      }
    }
  }
  return null;
}

function isUnknownOrFuture(
  registry: CodecRegistry,
  node: ComponentNodeV1,
): boolean {
  return registry.resolveComponentType(node.type, node.specVersion).kind !== "known";
}

function slotExistsAndAccepts(
  registry: CodecRegistry,
  document: ComponentsDocumentV1,
  parentId: ComponentId,
  slot: string,
  childType: ComponentNodeV1["type"],
  index: number,
): ReducerFailure | null {
  const parent = document.nodes[parentId];
  if (!parent) return fail(ERROR_CODES.CMD_PARENT_NOT_FOUND, `父节点不存在: ${parentId}`, parentId);
  const resolution = registry.resolveComponentType(parent.type, parent.specVersion);
  if (resolution.kind !== "known") {
    return fail(ERROR_CODES.CMD_UNKNOWN_COMPONENT_READ_ONLY, "未知/未来父组件不可编辑", parentId);
  }
  const slotDef = resolution.descriptor.slots.find((s) => s.name === slot);
  if (!slotDef) return fail(ERROR_CODES.DOC_SLOT_UNKNOWN, `未知 Slot: ${slot}`, parentId);
  const refs = parent.slots[slot] ?? [];
  if (index < 0 || index > refs.length) {
    return fail(ERROR_CODES.CMD_INDEX_OUT_OF_RANGE, `index 越界: ${index}`, parentId);
  }
  if (slotDef.cardinality.kind === "one" && refs.length >= 1) {
    return fail(ERROR_CODES.DOC_SLOT_CARDINALITY, `Slot 容量为 one: ${slot}`, parentId);
  }
  if (slotDef.cardinality.kind === "many" && slotDef.cardinality.max !== undefined && refs.length >= slotDef.cardinality.max) {
    return fail(ERROR_CODES.DOC_SLOT_CARDINALITY, `Slot 容量超限: ${slot}`, parentId);
  }
  const rule = slotDef.accepts;
  if (rule?.types && rule.types.length > 0 && !rule.types.includes(childType)) {
    return fail(ERROR_CODES.DOC_CHILD_TYPE_REJECTED, `Slot ${slot} 不接受类型 ${childType}`, parentId);
  }
  return null;
}

export function applyCommands(
  initial: ComponentsDocumentV1,
  commands: readonly DocumentCommandV1[],
  context: ReducerContext,
): ReducerResult {
  let document = cloneDocument(initial);
  const createdComponentIds: ComponentId[] = [];
  const changedComponentIds: ComponentId[] = [];
  const deletedComponentIds: ComponentId[] = [];
  const changedDataSourceIds: DataSourceId[] = [];
  const idMap: Record<string, string> = {};

  const markChanged = (id: ComponentId) => {
    if (!changedComponentIds.includes(id)) changedComponentIds.push(id);
  };

  for (const command of commands) {
    switch (command.kind) {
      case "component.add": {
        if (command.node.id in document.nodes) {
          return fail(ERROR_CODES.CMD_COMPONENT_ALREADY_EXISTS, `节点已存在: ${command.node.id}`, command.node.id);
        }
        if (!UUID_V4_PATTERN.test(command.node.id)) {
          return fail(ERROR_CODES.DOC_ID_INVALID, "节点 ID 必须是 UUID v4", command.node.id);
        }
        const slotErr = slotExistsAndAccepts(
          context.registry,
          document,
          command.parentId,
          command.slot,
          command.node.type,
          command.index,
        );
        if (slotErr) return slotErr;
        const parent = document.nodes[command.parentId]!;
        const refs = [...(parent.slots[command.slot] ?? [])];
        refs.splice(command.index, 0, { nodeId: command.node.id, placement: command.placement });
        const nodes = { ...document.nodes, [command.node.id]: cloneNode(command.node) };
        const parents: Record<ComponentId, ComponentNodeV1> = {
          ...document.nodes,
          [command.parentId]: { ...parent, slots: { ...parent.slots, [command.slot]: refs } },
        };
        document = { ...document, nodes: { ...nodes, ...parents } };
        createdComponentIds.push(command.node.id);
        markChanged(command.parentId);
        break;
      }
      case "component.remove": {
        if (command.componentId === document.rootId) {
          return fail(ERROR_CODES.CMD_ROOT_DELETE_FORBIDDEN, "Root 不得删除", command.componentId);
        }
        const node = document.nodes[command.componentId];
        if (!node) return fail(ERROR_CODES.CMD_COMPONENT_NOT_FOUND, `节点不存在: ${command.componentId}`, command.componentId);
        const location = findParent(document, command.componentId);
        if (!location) return fail(ERROR_CODES.CMD_COMPONENT_NOT_FOUND, "节点没有父位置", command.componentId);
        const ids = subtreeIds(document, command.componentId);
        const nodes: Record<ComponentId, ComponentNodeV1> = {};
        for (const [id, n] of Object.entries(document.nodes)) {
          if (!ids.has(id as ComponentId)) nodes[id as ComponentId] = n;
        }
        const parent = nodes[location.parentId]!;
        const refs = (parent.slots[location.slot] ?? []).filter((r) => r.nodeId !== command.componentId);
        nodes[location.parentId] = { ...parent, slots: { ...parent.slots, [location.slot]: refs } };
        document = { ...document, nodes };
        for (const id of ids) deletedComponentIds.push(id);
        markChanged(location.parentId);
        break;
      }
      case "component.duplicate": {
        const source = document.nodes[command.sourceId];
        if (!source) return fail(ERROR_CODES.CMD_COMPONENT_NOT_FOUND, `源节点不存在: ${command.sourceId}`, command.sourceId);
        const slotErr = slotExistsAndAccepts(
          context.registry,
          document,
          command.targetParentId,
          command.targetSlot,
          source.type,
          command.targetIndex,
        );
        if (slotErr) return slotErr;
        const copy = duplicateSubtreeDeep(command.sourceId, document, idMap);
        const newRootId = idMap[command.sourceId] as ComponentId;
        const parent = document.nodes[command.targetParentId]!;
        const refs = [...(parent.slots[command.targetSlot] ?? [])];
        refs.splice(command.targetIndex, 0, { nodeId: newRootId, placement: command.targetPlacement });
        document = {
          ...document,
          nodes: {
            ...document.nodes,
            ...copy.nodes,
            [command.targetParentId]: { ...parent, slots: { ...parent.slots, [command.targetSlot]: refs } },
          },
        };
        createdComponentIds.push(newRootId);
        markChanged(command.targetParentId);
        break;
      }
      case "component.move": {
        if (command.componentId === document.rootId) {
          return fail(ERROR_CODES.CMD_ROOT_MOVE_FORBIDDEN, "Root 不得移动", command.componentId);
        }
        const node = document.nodes[command.componentId];
        if (!node) return fail(ERROR_CODES.CMD_COMPONENT_NOT_FOUND, `节点不存在: ${command.componentId}`, command.componentId);
        // 目标不得是自身或后代
        if (command.componentId === command.targetParentId) {
          return fail(ERROR_CODES.CMD_WOULD_CREATE_CYCLE, "不能移动到自身", command.componentId);
        }
        if (subtreeIds(document, command.componentId).has(command.targetParentId)) {
          return fail(ERROR_CODES.CMD_WOULD_CREATE_CYCLE, "不能移动到后代", command.componentId);
        }
        const location = findParent(document, command.componentId);
        if (!location) return fail(ERROR_CODES.CMD_COMPONENT_NOT_FOUND, "节点没有父位置", command.componentId);
        const slotErr = slotExistsAndAccepts(
          context.registry,
          document,
          command.targetParentId,
          command.targetSlot,
          node.type,
          command.targetIndex,
        );
        if (slotErr) return slotErr;

        // 从旧父移除（同父同 Slot 时按移除后的数组解释 index）
        const oldParent = document.nodes[location.parentId]!;
        const oldRefs = (oldParent.slots[location.slot] ?? []).filter((r) => r.nodeId !== command.componentId);
        let index = command.targetIndex;
        if (location.parentId === command.targetParentId && location.slot === command.targetSlot) {
          if (location.index < command.targetIndex) index = command.targetIndex - 1;
        }
        const newParent = document.nodes[command.targetParentId]!;
        const newRefs = [...(newParent.slots[command.targetSlot] ?? [])];
        newRefs.splice(index, 0, { nodeId: command.componentId, placement: command.targetPlacement });

        const nodes: Record<ComponentId, ComponentNodeV1> = {};
        for (const [id, n] of Object.entries(document.nodes)) {
          if (id === location.parentId) {
            nodes[id as ComponentId] = { ...n, slots: { ...n.slots, [location.slot]: oldRefs } };
          } else if (id === command.targetParentId && command.targetParentId !== location.parentId) {
            nodes[id as ComponentId] = { ...n, slots: { ...n.slots, [command.targetSlot]: newRefs } };
          } else {
            nodes[id as ComponentId] = n;
          }
        }
        if (command.targetParentId === location.parentId) {
          nodes[command.targetParentId] = {
            ...nodes[command.targetParentId]!,
            slots: { ...nodes[command.targetParentId]!.slots, [command.targetSlot]: newRefs },
          };
        }
        document = { ...document, nodes };
        markChanged(command.componentId);
        markChanged(location.parentId);
        markChanged(command.targetParentId);
        break;
      }
      case "component.reorder": {
        const parent = document.nodes[command.parentId];
        if (!parent) return fail(ERROR_CODES.CMD_PARENT_NOT_FOUND, `父节点不存在: ${command.parentId}`, command.parentId);
        const refs = parent.slots[command.slot];
        if (!refs) return fail(ERROR_CODES.DOC_SLOT_UNKNOWN, `未知 Slot: ${command.slot}`, command.parentId);
        const current = refs.map((r) => r.nodeId).sort();
        const ordered = [...command.orderedComponentIds].sort();
        if (current.length !== ordered.length || current.some((v, i) => v !== ordered[i])) {
          return fail(ERROR_CODES.CMD_INDEX_OUT_OF_RANGE, "reorder 输入集合必须与当前 Slot 完全一致", command.parentId);
        }
        const byId = new Map(refs.map((r) => [r.nodeId, r]));
        const newRefs = command.orderedComponentIds.map((id) => byId.get(id)!);
        document = {
          ...document,
          nodes: {
            ...document.nodes,
            [command.parentId]: { ...parent, slots: { ...parent.slots, [command.slot]: newRefs } },
          },
        };
        markChanged(command.parentId);
        break;
      }
      case "component.props.replace": {
        const node = document.nodes[command.componentId];
        if (!node) return fail(ERROR_CODES.CMD_COMPONENT_NOT_FOUND, `节点不存在: ${command.componentId}`, command.componentId);
        if (isUnknownOrFuture(context.registry, node)) {
          return fail(ERROR_CODES.CMD_UNKNOWN_COMPONENT_READ_ONLY, "未知/未来组件内部配置不可修改", command.componentId);
        }
        document = {
          ...document,
          nodes: {
            ...document.nodes,
            [command.componentId]: { ...node, props: command.props as JsonObject },
          },
        };
        markChanged(command.componentId);
        break;
      }
      case "component.style.set": {
        const node = document.nodes[command.componentId];
        if (!node) return fail(ERROR_CODES.CMD_COMPONENT_NOT_FOUND, `节点不存在: ${command.componentId}`, command.componentId);
        if (isUnknownOrFuture(context.registry, node)) {
          return fail(ERROR_CODES.CMD_UNKNOWN_COMPONENT_READ_ONLY, "未知/未来组件内部配置不可修改", command.componentId);
        }
        document = {
          ...document,
          nodes: {
            ...document.nodes,
            [command.componentId]: { ...node, style: command.style },
          },
        };
        markChanged(command.componentId);
        break;
      }
      case "component.enabled.set": {
        const node = document.nodes[command.componentId];
        if (!node) return fail(ERROR_CODES.CMD_COMPONENT_NOT_FOUND, `节点不存在: ${command.componentId}`, command.componentId);
        document = {
          ...document,
          nodes: {
            ...document.nodes,
            [command.componentId]: { ...node, enabled: command.enabled },
          },
        };
        markChanged(command.componentId);
        break;
      }
      case "component.label.set": {
        const node = document.nodes[command.componentId];
        if (!node) return fail(ERROR_CODES.CMD_COMPONENT_NOT_FOUND, `节点不存在: ${command.componentId}`, command.componentId);
        document = {
          ...document,
          nodes: {
            ...document.nodes,
            [command.componentId]: { ...node, label: command.label },
          },
        };
        markChanged(command.componentId);
        break;
      }
      case "component.child-placement.set": {
        const parent = document.nodes[command.parentId];
        if (!parent) return fail(ERROR_CODES.CMD_PARENT_NOT_FOUND, `父节点不存在: ${command.parentId}`, command.parentId);
        const refs = parent.slots[command.slot];
        if (!refs) return fail(ERROR_CODES.DOC_SLOT_UNKNOWN, `未知 Slot: ${command.slot}`, command.parentId);
        const idx = refs.findIndex((r) => r.nodeId === command.childId);
        if (idx < 0) return fail(ERROR_CODES.CMD_COMPONENT_NOT_FOUND, "目标不是该 Slot 的直接 ChildRef", command.childId);
        const newRefs = refs.map((r, i) =>
          i === idx ? { ...r, placement: command.placement as ChildPlacementV1 } : r,
        );
        document = {
          ...document,
          nodes: {
            ...document.nodes,
            [command.parentId]: { ...parent, slots: { ...parent.slots, [command.slot]: newRefs } },
          },
        };
        markChanged(command.parentId);
        markChanged(command.childId);
        break;
      }
      case "binding.put": {
        const node = document.nodes[command.componentId];
        if (!node) return fail(ERROR_CODES.CMD_COMPONENT_NOT_FOUND, `节点不存在: ${command.componentId}`, command.componentId);
        if (isUnknownOrFuture(context.registry, node)) {
          return fail(ERROR_CODES.CMD_UNKNOWN_COMPONENT_READ_ONLY, "未知/未来组件内部配置不可修改", command.componentId);
        }
        const exists = node.bindings.some((b) => b.id === command.binding.id);
        const bindings = exists
          ? node.bindings.map((b) => (b.id === command.binding.id ? command.binding : b))
          : [...node.bindings, command.binding];
        document = {
          ...document,
          nodes: { ...document.nodes, [command.componentId]: { ...node, bindings } },
        };
        markChanged(command.componentId);
        break;
      }
      case "binding.remove": {
        const node = document.nodes[command.componentId];
        if (!node) return fail(ERROR_CODES.CMD_COMPONENT_NOT_FOUND, `节点不存在: ${command.componentId}`, command.componentId);
        const bindings = node.bindings.filter((b) => b.id !== command.bindingId);
        if (bindings.length === node.bindings.length) {
          return fail(ERROR_CODES.CMD_BINDING_NOT_FOUND, `Binding 不存在: ${command.bindingId}`, command.componentId);
        }
        document = {
          ...document,
          nodes: { ...document.nodes, [command.componentId]: { ...node, bindings } },
        };
        markChanged(command.componentId);
        break;
      }
      case "event.put": {
        const node = document.nodes[command.componentId];
        if (!node) return fail(ERROR_CODES.CMD_COMPONENT_NOT_FOUND, `节点不存在: ${command.componentId}`, command.componentId);
        if (isUnknownOrFuture(context.registry, node)) {
          return fail(ERROR_CODES.CMD_UNKNOWN_COMPONENT_READ_ONLY, "未知/未来组件内部配置不可修改", command.componentId);
        }
        document = {
          ...document,
          nodes: {
            ...document.nodes,
            [command.componentId]: { ...node, events: { ...node.events, [command.eventName]: command.sequence } },
          },
        };
        markChanged(command.componentId);
        break;
      }
      case "event.remove": {
        const node = document.nodes[command.componentId];
        if (!node) return fail(ERROR_CODES.CMD_COMPONENT_NOT_FOUND, `节点不存在: ${command.componentId}`, command.componentId);
        if (!(command.eventName in node.events)) {
          return fail(ERROR_CODES.CMD_EVENT_NOT_FOUND, `事件不存在: ${command.eventName}`, command.componentId);
        }
        const events = { ...node.events };
        delete events[command.eventName];
        document = {
          ...document,
          nodes: { ...document.nodes, [command.componentId]: { ...node, events } },
        };
        markChanged(command.componentId);
        break;
      }
      case "data-source.put": {
        const existing = document.dataSources[command.source.id];
        if (existing && "classification" in existing) {
          return fail(
            ERROR_CODES.CMD_UNKNOWN_COMPONENT_READ_ONLY,
            "未知/未来 DataSource 不允许修改",
            command.source.id as unknown as ComponentId,
          );
        }
        document = {
          ...document,
          dataSources: { ...document.dataSources, [command.source.id]: command.source },
        };
        if (!changedDataSourceIds.includes(command.source.id)) changedDataSourceIds.push(command.source.id);
        break;
      }
      case "data-source.remove": {
        if (!(command.sourceId in document.dataSources)) {
          return fail(
            ERROR_CODES.CMD_COMPONENT_NOT_FOUND,
            `DataSource 不存在: ${command.sourceId}`,
            command.sourceId as unknown as ComponentId,
          );
        }
        // 检查 Binding/Action Expr 引用
        for (const node of Object.values(document.nodes)) {
          for (const binding of node.bindings) {
            if (exprReferencesSource(binding.expr, command.sourceId)) {
              return fail(
                ERROR_CODES.CMD_REFERENCED_SOURCE_DELETE,
                `DataSource 仍被 Binding 引用: ${command.sourceId}`,
                node.id,
              );
            }
          }
          for (const seq of Object.values(node.events)) {
            for (const action of seq.actions) {
              if ("raw" in action && action.raw && typeof action.raw === "object") {
                if (exprInJsonReferencesSource(action.raw, command.sourceId)) {
                  return fail(
                    ERROR_CODES.CMD_REFERENCED_SOURCE_DELETE,
                    `DataSource 仍被 Action 引用: ${command.sourceId}`,
                    node.id,
                  );
                }
              } else if (exprInJsonReferencesSource(action as unknown as JsonObject, command.sourceId)) {
                return fail(
                  ERROR_CODES.CMD_REFERENCED_SOURCE_DELETE,
                  `DataSource 仍被 Action 引用: ${command.sourceId}`,
                  node.id,
                );
              }
            }
          }
        }
        const dataSources = { ...document.dataSources };
        delete dataSources[command.sourceId];
        document = { ...document, dataSources };
        changedDataSourceIds.push(command.sourceId);
        break;
      }
      case "document.metadata.replace":
        document = { ...document, metadata: command.metadata };
        break;
      case "document.permissions.replace":
        document = { ...document, permissions: command.permissions };
        break;
      default: {
        const exhaustive: never = command;
        return fail(ERROR_CODES.CMD_SESSION_NOT_EDITABLE, `未知命令: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  return {
    ok: true,
    document,
    createdComponentIds: [...new Set(createdComponentIds)].sort(),
    changedComponentIds: [...new Set(changedComponentIds)].sort(),
    deletedComponentIds: [...new Set(deletedComponentIds)].sort(),
    changedDataSourceIds: [...new Set(changedDataSourceIds)].sort(),
    idMap,
  };
}

function exprReferencesSource(expr: unknown, sourceId: DataSourceId): boolean {
  if (expr === null || typeof expr !== "object") return false;
  const obj = expr as Record<string, unknown>;
  if (obj.op === "source" && obj.sourceId === sourceId) return true;
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) {
      if (v.some((x) => exprReferencesSource(x, sourceId))) return true;
    } else if (exprReferencesSource(v, sourceId)) {
      return true;
    }
  }
  return false;
}

function exprInJsonReferencesSource(value: JsonObject, sourceId: DataSourceId): boolean {
  return exprReferencesSource(value, sourceId);
}
