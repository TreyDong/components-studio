/**
 * NodeFactoryImpl 测试（《运行时与 SDK 协议 v1》第 2.6 节固定顺序）。
 * 覆盖：默认 Props 深复制、initialProps 完整替换（不做合并）、空集合初始化、
 * specVersion/enabled/label/默认样式、完整节点校验、createFromRegistered。
 */

import { describe, expect, it } from "vitest";
import { NodeFactoryImpl } from "../../src/registry/NodeFactory";
import { ComponentRegistryImpl } from "../../src/registry/ComponentRegistry";
import { coreLayoutDefinition, coreLayoutDefaultProps } from "../../src/widgets/core-layout";
import { DEFAULT_NODE_STYLE_V1, ERROR_CODES } from "@ocs/contracts";
import type { ComponentType } from "@ocs/contracts";
import type { CreateComponentContext } from "../../src/registry/definition";
import { defaultIdFactory } from "../../src/shared/id";

const LAYOUT = "core.layout" as ComponentType;

function context(overrides: Partial<CreateComponentContext> = {}): CreateComponentContext {
  return {
    documentId: defaultIdFactory.documentId(),
    componentId: defaultIdFactory.componentId(),
    parentId: null,
    sourcePath: "home.components",
    locale: "system",
    createdAt: "2026-08-13T09:00:00.000Z",
    ids: defaultIdFactory,
    companions: {},
    ...overrides,
  };
}

describe("create", () => {
  it("固定字段：enabled=true、label=null、默认 NodeStyle、当前 specVersion、空集合", () => {
    const factory = new NodeFactoryImpl();
    const result = factory.create({ definition: coreLayoutDefinition, context: context() });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const node = result.value;
      expect(node.type).toBe(LAYOUT);
      expect(node.specVersion).toBe(1);
      expect(node.enabled).toBe(true);
      expect(node.label).toBeNull();
      expect(node.style).toEqual(DEFAULT_NODE_STYLE_V1);
      expect(node.slots).toEqual({ children: [] });
      expect(node.bindings).toEqual([]);
      expect(node.events).toEqual({});
      expect(node.extensions).toEqual({});
      expect(node.props).toEqual(coreLayoutDefaultProps());
    }
  });

  it("默认 Props 深复制：修改返回节点不影响后续创建", () => {
    const factory = new NodeFactoryImpl();
    const a = factory.create({ definition: coreLayoutDefinition, context: context() });
    const b = factory.create({ definition: coreLayoutDefinition, context: context() });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      (a.value.props as { gap: number }).gap = 999;
      (a.value.props as { grid: { rowHeight: number } }).grid.rowHeight = 999;
      expect((b.value.props as { gap: number }).gap).toBe(12);
      expect((b.value.props as { grid: { rowHeight: number } }).grid.rowHeight).toBe(80);
    }
  });

  it("initialProps 作为完整替换值：合法替换生效", () => {
    const factory = new NodeFactoryImpl();
    const initialProps = {
      mode: "grid",
      gap: 5,
      padding: 2,
      locked: true,
      grid: {
        columns: { compact: 1, regular: 2, wide: 3 },
        rowHeight: 100,
        dense: true,
        allowOverlap: false,
      },
      columns: { wrap: false, equalWidth: true },
      tabs: { activation: "manual", placement: "left" },
    };
    const result = factory.create({
      definition: coreLayoutDefinition,
      context: context(),
      initialProps,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.props).toEqual(initialProps);
      expect((result.value.props as { mode: string }).mode).toBe("grid");
      expect((result.value.props as { gap: number }).gap).toBe(5);
    }
  });

  it("initialProps 不做合并：缺字段（非默认值兜底）导致校验失败", () => {
    const factory = new NodeFactoryImpl();
    const partial = factory.create({
      definition: coreLayoutDefinition,
      context: context(),
      initialProps: { mode: "grid" },
    });
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.error.code).toBe(ERROR_CODES.COMPONENT_PROPS_INVALID);
  });

  it("非法 initialProps 返回 COMPONENT_PROPS_INVALID", () => {
    const factory = new NodeFactoryImpl();
    const result = factory.create({
      definition: coreLayoutDefinition,
      context: context(),
      initialProps: { mode: "bogus" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ERROR_CODES.COMPONENT_PROPS_INVALID);
  });

  it("节点使用 context.componentId", () => {
    const factory = new NodeFactoryImpl();
    const id = defaultIdFactory.componentId();
    const result = factory.create({ definition: coreLayoutDefinition, context: context({ componentId: id }) });
    expect(result.ok && result.value.id).toBe(id);
  });
});

describe("createFromRegistered", () => {
  it("经注册定义创建完整节点", () => {
    const registry = new ComponentRegistryImpl();
    registry.register(coreLayoutDefinition);
    const registered = registry.get(LAYOUT);
    expect(registered).not.toBeNull();
    if (registered) {
      const factory = new NodeFactoryImpl();
      const result = factory.createFromRegistered({ definition: registered, context: context() });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe(LAYOUT);
        expect(result.value.props).toEqual(coreLayoutDefaultProps());
        expect(result.value.slots).toEqual({ children: [] });
      }
    }
  });
});
