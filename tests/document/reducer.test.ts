/**
 * Document Command reducer 测试（文档协议第 9 章 / 验收 18.6）。
 */
import { describe, expect, it } from "vitest";
import { applyCommands } from "../../src/document/reducer";
import type { CodecRegistry } from "../../src/document/types";
import { minimalDocument, ROOT_ID } from "../fixtures/minimal-document";

const nullRegistry: CodecRegistry = {
  resolveComponentType: () => ({ kind: "unknown" }),
  resolveDataSourceType: () => ({ kind: "unknown" }),
  resolveActionType: () => ({ kind: "unknown" }),
};

/** 认识 core.layout（children many 槽）的测试 Registry。 */
const layoutRegistry: CodecRegistry = {
  ...nullRegistry,
  resolveComponentType: (type) =>
    type === "core.layout"
      ? {
          kind: "known",
          descriptor: {
            currentSpecVersion: 1,
            propsSchema: {
              type: "object",
              properties: {},
              required: [],
              additionalProperties: true,
            },
            schemaDefs: {},
            migrations: [],
            slots: [
              {
                name: "children",
                cardinality: { kind: "many" },
                accepts: { types: [], excludeTypes: [] },
              },
            ],
            events: [],
            bindableTargets: [],
          },
        }
      : { kind: "unknown" },
};

const defaultPlacement = {
  tab: { title: null, icon: null, disabled: false },
  column: { basisBp: 10000, grow: 0, shrink: 1, minWidthPx: 0, maxWidthPx: null },
  grid: {
    compact: { x: 0, y: 0, w: 1, h: 4, minW: 1, maxW: null, minH: 1, maxH: null },
    regular: { x: 0, y: 0, w: 3, h: 4, minW: 1, maxW: null, minH: 1, maxH: null },
    wide: { x: 0, y: 0, w: 4, h: 4, minW: 1, maxW: null, minH: 1, maxH: null },
  },
  extensions: {},
};

const CHILD_ID = "11111111-2222-4333-8444-555555555555" as import("@ocs/contracts").ComponentId;

function childNode(id: string = CHILD_ID): import("@ocs/contracts/document").ComponentNodeV1 {
  const root = minimalDocument().nodes[ROOT_ID]!;
  return {
    ...root,
    id: id as import("@ocs/contracts").ComponentId,
    props: { mode: "stack", gap: 12, padding: 0, locked: false } as import("@ocs/contracts").JsonObject,
  };
}

describe("reducer 基础命令", () => {
  it("add 插入节点与 ChildRef", () => {
    const doc = minimalDocument();
    const r = applyCommands(
      doc,
      [
        {
          commandId: "c1" as import("@ocs/contracts").CommandId,
          kind: "component.add",
          parentId: ROOT_ID,
          slot: "children",
          index: 0,
          node: childNode(),
          placement: defaultPlacement,
        },
      ],
      { registry: layoutRegistry },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.document.nodes[CHILD_ID]).toBeDefined();
      expect(r.document.nodes[ROOT_ID]!.slots.children).toHaveLength(1);
      expect(r.createdComponentIds).toContain(CHILD_ID);
    }
  });

  it("add 重复 ID 失败", () => {
    const doc = minimalDocument();
    const first = applyCommands(
      doc,
      [{ commandId: "c1" as import("@ocs/contracts").CommandId, kind: "component.add", parentId: ROOT_ID, slot: "children", index: 0, node: childNode(), placement: defaultPlacement }],
      { registry: layoutRegistry },
    );
    expect(first.ok).toBe(true);
    const second = applyCommands(
      first.ok ? first.document : doc,
      [{ commandId: "c2" as import("@ocs/contracts").CommandId, kind: "component.add", parentId: ROOT_ID, slot: "children", index: 0, node: childNode(), placement: defaultPlacement }],
      { registry: layoutRegistry },
    );
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("CMD_COMPONENT_ALREADY_EXISTS");
  });

  it("remove 删除整棵子树并从父 Slot 移除", () => {
    const doc = minimalDocument();
    const added = applyCommands(
      doc,
      [{ commandId: "c1" as import("@ocs/contracts").CommandId, kind: "component.add", parentId: ROOT_ID, slot: "children", index: 0, node: childNode(), placement: defaultPlacement }],
      { registry: layoutRegistry },
    );
    expect(added.ok).toBe(true);
    const r = applyCommands(
      added.ok ? added.document : doc,
      [{ commandId: "c2" as import("@ocs/contracts").CommandId, kind: "component.remove", componentId: CHILD_ID }],
      { registry: layoutRegistry },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.document.nodes[CHILD_ID]).toBeUndefined();
      expect(r.document.nodes[ROOT_ID]!.slots.children).toHaveLength(0);
      expect(r.deletedComponentIds).toContain(CHILD_ID);
    }
  });

  it("remove Root 被禁止", () => {
    const r = applyCommands(
      minimalDocument(),
      [{ commandId: "c1" as import("@ocs/contracts").CommandId, kind: "component.remove", componentId: ROOT_ID }],
      { registry: layoutRegistry },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CMD_ROOT_DELETE_FORBIDDEN");
  });

  it("remove 不存在的节点失败", () => {
    const r = applyCommands(
      minimalDocument(),
      [{ commandId: "c1" as import("@ocs/contracts").CommandId, kind: "component.remove", componentId: "99999999-9999-4999-8999-999999999999" as never }],
      { registry: layoutRegistry },
    );
    expect(r.ok).toBe(false);
  });

  it("move 到自身后代被拒绝", () => {
    const doc = minimalDocument();
    const added = applyCommands(
      doc,
      [{ commandId: "c1" as import("@ocs/contracts").CommandId, kind: "component.add", parentId: ROOT_ID, slot: "children", index: 0, node: childNode(), placement: defaultPlacement }],
      { registry: layoutRegistry },
    );
    expect(added.ok).toBe(true);
    const r = applyCommands(
      added.ok ? added.document : doc,
      [{ commandId: "c2" as import("@ocs/contracts").CommandId, kind: "component.move", componentId: ROOT_ID, targetParentId: CHILD_ID, targetSlot: "children", targetIndex: 0, targetPlacement: defaultPlacement }],
      { registry: layoutRegistry },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CMD_ROOT_MOVE_FORBIDDEN");
  });

  it("props.replace 完整替换", () => {
    const doc = minimalDocument();
    const added = applyCommands(
      doc,
      [{ commandId: "c1" as import("@ocs/contracts").CommandId, kind: "component.add", parentId: ROOT_ID, slot: "children", index: 0, node: childNode(), placement: defaultPlacement }],
      { registry: layoutRegistry },
    );
    expect(added.ok).toBe(true);
    const r = applyCommands(
      added.ok ? added.document : doc,
      [
        {
          commandId: "c2" as import("@ocs/contracts").CommandId,
          kind: "component.props.replace",
          componentId: CHILD_ID,
          props: { source: { kind: "inline", content: "changed" }, showSourceTitle: true, emptyText: "" },
        },
      ],
      { registry: layoutRegistry },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.document.nodes[CHILD_ID]!.props).toEqual({
        source: { kind: "inline", content: "changed" },
        showSourceTitle: true,
        emptyText: "",
      });
    }
  });

  it("enabled.set 与 label.set 生效", () => {
    const doc = minimalDocument();
    const r = applyCommands(
      doc,
      [
        { commandId: "c1" as import("@ocs/contracts").CommandId, kind: "component.enabled.set", componentId: ROOT_ID, enabled: false },
        { commandId: "c2" as import("@ocs/contracts").CommandId, kind: "component.label.set", componentId: ROOT_ID, label: "新标签" },
      ],
      { registry: layoutRegistry },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.document.nodes[ROOT_ID]!.enabled).toBe(false);
      expect(r.document.nodes[ROOT_ID]!.label).toBe("新标签");
    }
  });

  it("reorder 集合不一致失败", () => {
    const doc = minimalDocument();
    const added = applyCommands(
      doc,
      [{ commandId: "c1" as import("@ocs/contracts").CommandId, kind: "component.add", parentId: ROOT_ID, slot: "children", index: 0, node: childNode(), placement: defaultPlacement }],
      { registry: layoutRegistry },
    );
    expect(added.ok).toBe(true);
    const r = applyCommands(
      added.ok ? added.document : doc,
      [{ commandId: "c2" as import("@ocs/contracts").CommandId, kind: "component.reorder", parentId: ROOT_ID, slot: "children", orderedComponentIds: ["11111111-2222-4333-8444-555555555555", "22222222-2222-4333-8444-555555555555"] as never[] }],
      { registry: layoutRegistry },
    );
    expect(r.ok).toBe(false);
  });

  it("reorder 改变顺序", () => {
    const doc = minimalDocument();
    const childA = childNode("11111111-2222-4333-8444-555555555555");
    const childB = childNode("22222222-2222-4333-8444-555555555555");
    const added = applyCommands(
      doc,
      [
        { commandId: "c1" as import("@ocs/contracts").CommandId, kind: "component.add", parentId: ROOT_ID, slot: "children", index: 0, node: childA, placement: defaultPlacement },
        { commandId: "c2" as import("@ocs/contracts").CommandId, kind: "component.add", parentId: ROOT_ID, slot: "children", index: 1, node: childB, placement: defaultPlacement },
      ],
      { registry: layoutRegistry },
    );
    expect(added.ok).toBe(true);
    const r = applyCommands(
      added.ok ? added.document : doc,
      [
        {
          commandId: "c3" as import("@ocs/contracts").CommandId,
          kind: "component.reorder",
          parentId: ROOT_ID,
          slot: "children",
          orderedComponentIds: [childB.id, childA.id],
        },
      ],
      { registry: layoutRegistry },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.document.nodes[ROOT_ID]!.slots.children ?? []).map((x) => x.nodeId)).toEqual([childB.id, childA.id]);
    }
  });

  it("data-source.put 与 remove 引用检查", () => {
    const doc = minimalDocument();
    const dsId = "33333333-3333-4333-8333-333333333333" as import("@ocs/contracts").DataSourceId;
    const r1 = applyCommands(
      doc,
      [
        {
          commandId: "c1" as import("@ocs/contracts").CommandId,
          kind: "data-source.put",
          source: {
            id: dsId,
            type: "vault.query",
            specVersion: 1,
            enabled: true,
            label: null,
            config: {},
            refresh: { mode: "manual" },
            extensions: {},
          },
        },
      ],
      { registry: layoutRegistry },
    );
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.document.dataSources[dsId]).toBeDefined();

    // 无引用时删除成功
    const r2 = applyCommands(
      r1.ok ? r1.document : doc,
      [{ commandId: "c2" as import("@ocs/contracts").CommandId, kind: "data-source.remove", sourceId: dsId }],
      { registry: layoutRegistry },
    );
    expect(r2.ok).toBe(true);
  });

  it("metadata.replace 完整替换", () => {
    const r = applyCommands(
      minimalDocument(),
      [
        {
          commandId: "c1" as import("@ocs/contracts").CommandId,
          kind: "document.metadata.replace",
          metadata: { title: "新标题", description: "d", tags: [] },
        },
      ],
      { registry: layoutRegistry },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.document.metadata.title).toBe("新标题");
      expect(r.document.metadata.tags).toEqual([]);
    }
  });

  it("事务中任一命令失败则整体失败（不产生部分应用）", () => {
    const doc = minimalDocument();
    const r = applyCommands(
      doc,
      [
        { commandId: "c1" as import("@ocs/contracts").CommandId, kind: "component.enabled.set", componentId: ROOT_ID, enabled: false },
        { commandId: "c2" as import("@ocs/contracts").CommandId, kind: "component.remove", componentId: "99999999-9999-4999-8999-999999999999" as never },
      ],
      { registry: layoutRegistry },
    );
    expect(r.ok).toBe(false);
    // 无副作用
    expect(r).not.toHaveProperty("document");
  });

  it("duplicate 生成新 ID 并重写子树引用", () => {
    const doc = minimalDocument();
    const childA = childNode("11111111-2222-4333-8444-555555555555");
    const childB = childNode("22222222-2222-4333-8444-555555555555");
    const added = applyCommands(
      doc,
      [
        { commandId: "c1" as import("@ocs/contracts").CommandId, kind: "component.add", parentId: ROOT_ID, slot: "children", index: 0, node: childA, placement: defaultPlacement },
        { commandId: "c2" as import("@ocs/contracts").CommandId, kind: "component.add", parentId: ROOT_ID, slot: "children", index: 1, node: childB, placement: defaultPlacement },
      ],
      { registry: layoutRegistry },
    );
    expect(added.ok).toBe(true);
    const r = applyCommands(
      added.ok ? added.document : doc,
      [
        {
          commandId: "c3" as import("@ocs/contracts").CommandId,
          kind: "component.duplicate",
          sourceId: childA.id,
          targetParentId: ROOT_ID,
          targetSlot: "children",
          targetIndex: 2,
          targetPlacement: defaultPlacement,
        },
      ],
      { registry: layoutRegistry },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const newId = r.idMap[childA.id]!;
      expect(newId).toBeDefined();
      expect(newId).not.toBe(childA.id);
      expect(r.document.nodes[newId as import("@ocs/contracts").ComponentId]).toBeDefined();
      expect(r.document.nodes[ROOT_ID]!.slots.children).toHaveLength(3);
      expect(r.createdComponentIds).toContain(newId);
    }
  });
});
