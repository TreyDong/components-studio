/**
 * RuntimeRoot / NodeRenderer 渲染测试（协议 3.7–3.8、10.1–10.2）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { ReactNode } from "react";
import { RuntimeRoot } from "../../src/runtime/index";
import type {
  ComponentRendererProps,
  RuntimeMode,
  RuntimeServices,
} from "../../src/runtime/types";
import type { RegisteredComponentDefinition, SlotDefinition } from "../../src/registry/definition";
import type { Capability } from "../../src/runtime/capability-types";
import type { ValidationResult } from "@ocs/contracts";
import type { IconName, JsonObject } from "@ocs/contracts";
import { coreLayoutDefinition, coreLayoutDefaultProps } from "../../src/widgets/core-layout/index";
import { timeClockDefinition } from "../../src/widgets/time-clock/index";
import { clockDefaultProps } from "../../src/widgets/time-clock/schema";
import {
  FakeDiagnostics,
  FakeDocumentPort,
  FakeHostStore,
  FakePlatformPort,
  FakeRegistry,
  assembleServices,
  buildSnapshot,
  makeNode,
} from "./fakes";

// React 19 需要显式声明 act 环境（jsdom）。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

function renderApp(services: RuntimeServices, mode: RuntimeMode = "view"): void {
  act(() => {
    root.render(<RuntimeRoot services={services} initialMode={mode} />);
  });
}

function loosePropsSchema() {
  return { type: "object", properties: {}, required: [], additionalProperties: true } as const;
}

function slot(name: string): SlotDefinition<object> {
  return {
    name,
    displayName: name,
    cardinality: { kind: "many" },
    accepts: {},
    deletionPolicy: "delete-subtree",
    createDefaultPlacement: () => ({
      tab: { title: null, icon: null, disabled: false },
      column: { basisBp: 10000, grow: 0, shrink: 1, minWidthPx: 0, maxWidthPx: null },
      grid: {
        compact: { x: 0, y: 0, w: 1, h: 1, minW: 1, maxW: null, minH: 1, maxH: null },
        regular: { x: 0, y: 0, w: 1, h: 1, minW: 1, maxW: null, minH: 1, maxH: null },
        wide: { x: 0, y: 0, w: 1, h: 1, minW: 1, maxW: null, minH: 1, maxH: null },
      },
      extensions: {},
    }),
    validatePlacement: (placement) => ({ ok: true, value: placement, warnings: [] }),
    emptyState: { label: "空" },
  };
}

function fakeRegistered(options: {
  type: string;
  specVersion?: number;
  slots?: readonly SlotDefinition<object>[];
  declaredCapabilities?: readonly Capability[];
  vendor?: string;
  packageVersion?: string;
  render: (props: ComponentRendererProps<object>) => ReactNode;
  validate?: (input: unknown) => ValidationResult<object>;
}): RegisteredComponentDefinition {
  return {
    manifest: {
      type: options.type as never,
      specVersion: options.specVersion ?? 1,
      displayName: options.type,
      description: "",
      category: "custom",
      icon: "cube" as IconName,
      keywords: [],
      vendor: options.vendor ?? "components-studio",
      packageVersion: options.packageVersion ?? "0.1.0",
      rootAllowed: true,
      userCreatable: true,
      declaredCapabilities: options.declaredCapabilities ?? [],
    },
    propsSchema: loosePropsSchema() as never,
    slots: options.slots ?? [],
    events: [],
    bindableTargets: [],
    migrations: [],
    createCompanionDataSources: () => [],
    createDefaultPropsUnknown: () => ({}),
    validateUnknown:
      options.validate ??
      ((input: unknown) => ({ ok: true, value: input as object, warnings: [] })),
    renderUnknown: options.render,
    inspectUnknown: () => null,
  };
}

describe("RuntimeRoot 渲染", () => {
  it("用真实 core.layout + time.clock 渲染最小文档", () => {
    const registry = new FakeRegistry();
    registry.register(coreLayoutDefinition);
    registry.register(timeClockDefinition);
    const layoutNode = makeNode({
      id: "00000000-0000-4000-8000-000000000001",
      type: "core.layout",
      props: { ...coreLayoutDefaultProps(), mode: "stack", gap: 8, padding: 0 } as unknown as JsonObject,
    });
    const clockNode = makeNode({
      id: "00000000-0000-4000-8000-000000000002",
      type: "time.clock",
      props: clockDefaultProps() as unknown as JsonObject,
    });
    const rootNode = makeNode({
      id: "00000000-0000-4000-8000-000000000003",
      type: "core.layout",
      props: { ...coreLayoutDefaultProps(), mode: "stack", gap: 8, padding: 0 } as unknown as JsonObject,
      children: [
        { nodeId: layoutNode.id },
        { nodeId: clockNode.id },
      ],
    });
    const document = new FakeDocumentPort(
      buildSnapshot({
        rootId: rootNode.id,
        nodes: [rootNode, layoutNode, clockNode],
        permissions: { requested: [{ capability: "timer:use", reason: "时钟" }] },
      }),
    );
    const platform = new FakePlatformPort();
    const services = assembleServices({
      platform,
      registry,
      document,
      host: new FakeHostStore(),
      diagnostics: new FakeDiagnostics(),
    });
    renderApp(services);

    // 根布局以 stack 渲染两个 Slot 子节点。
    expect(container.querySelector(".ocs-layout-stack")).not.toBeNull();
    expect(container.querySelectorAll("[data-ocs-slot-child]").length).toBe(2);
    // 时钟渲染 <time>（timer:use 已由文档声明 + 内置策略授权）。
    expect(container.querySelector("time.ocs-clock")).not.toBeNull();
    // 空布局渲染 emptyState。
    expect(container.querySelector(".ocs-layout-empty")).not.toBeNull();
  });

  it("未知组件类型渲染 system.unknown 且不白屏", () => {
    const registry = new FakeRegistry();
    registry.register(coreLayoutDefinition);
    const rootNode = makeNode({
      id: "00000000-0000-4000-8000-000000000011",
      type: "core.layout",
      props: { ...coreLayoutDefaultProps(), mode: "stack", gap: 8, padding: 0 } as unknown as JsonObject,
      children: [{ nodeId: "00000000-0000-4000-8000-000000000012" }],
    });
    const unknownNode = makeNode({
      id: "00000000-0000-4000-8000-000000000012",
      type: "foo.bar",
      specVersion: 3,
      props: { anything: true },
    });
    const document = new FakeDocumentPort(
      buildSnapshot({ rootId: rootNode.id, nodes: [rootNode, unknownNode] }),
    );
    const services = assembleServices({
      platform: new FakePlatformPort(),
      registry,
      document,
      host: new FakeHostStore(),
    });
    renderApp(services);

    const placeholder = container.querySelector('[data-system="system.unknown"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.textContent).toContain("缺少对应组件实现");
    expect(placeholder!.textContent).toContain("foo.bar");
    expect(placeholder!.textContent).toContain("3");
    expect(placeholder!.textContent).toContain(unknownNode.id);
    // 页面没有白屏：布局与占位都存在。
    expect(container.querySelector(".ocs-layout-stack")).not.toBeNull();
    expect(container.querySelectorAll("[data-ocs-slot-child]").length).toBe(1);
  });

  it("NodeErrorBoundary：抛错节点被隔离，兄弟节点仍渲染；Props 修复后恢复", () => {
    const registry = new FakeRegistry();
    registry.putDirect(
      fakeRegistered({
        type: "test.root",
        slots: [slot("children")],
        render: (props) => <div data-testid="root">{props.slots.render("children")}</div>,
      }),
    );
    registry.putDirect(
      fakeRegistered({
        type: "test.bad",
        render: (props) => {
          const p = props.props as { shouldThrow?: boolean };
          if (p.shouldThrow) {
            throw new Error("boom");
          }
          return <div data-testid="bad-ok" />;
        },
      }),
    );
    registry.putDirect(
      fakeRegistered({
        type: "test.ok",
        render: (props) => <div data-testid={`ok-${props.id}`} />,
      }),
    );
    const bad = makeNode({ id: "bad-1", type: "test.bad", props: { shouldThrow: true } });
    const ok = makeNode({ id: "ok-1", type: "test.ok" });
    const rootNode = makeNode({
      id: "root-1",
      type: "test.root",
      children: [{ nodeId: bad.id }, { nodeId: ok.id }],
    });
    const document = new FakeDocumentPort(
      buildSnapshot({ rootId: rootNode.id, nodes: [rootNode, bad, ok] }),
    );
    const services = assembleServices({
      platform: new FakePlatformPort(),
      registry,
      document,
      host: new FakeHostStore(),
    });
    renderApp(services);

    // 抛错节点 → system.error；兄弟节点仍然渲染。
    const error = container.querySelector('[data-system="system.error"]');
    expect(error).not.toBeNull();
    expect(error!.textContent).toContain("COMPONENT_RENDER_FAILED");
    expect(container.querySelector('[data-testid="ok-ok-1"]')).not.toBeNull();

    // 修复 Props（contentHash 变化 → reset key 变化 → 边界重建）。
    const fixedBad = makeNode({ id: "bad-1", type: "test.bad", props: { shouldThrow: false } });
    act(() => {
      document.update(
        buildSnapshot({ rootId: rootNode.id, nodes: [rootNode, fixedBad, ok] }),
      );
    });
    expect(container.querySelector('[data-system="system.error"]')).toBeNull();
    expect(container.querySelector('[data-testid="bad-ok"]')).not.toBeNull();
  });

  it("深度 129 只隔离超深分支，不崩溃", () => {
    const registry = new FakeRegistry();
    registry.putDirect(
      fakeRegistered({
        type: "test.chain",
        slots: [slot("children")],
        render: (props) => <div data-testid="chain">{props.slots.render("children")}</div>,
      }),
    );
    const nodes = [];
    const ids = [];
    for (let i = 0; i < 130; i++) {
      ids.push(`chain-${i}`);
    }
    for (let i = 0; i < 130; i++) {
      nodes.push(
        makeNode({
          id: ids[i]!,
          type: "test.chain",
          children: i < 129 ? [{ nodeId: ids[i + 1]! }] : [],
        }),
      );
    }
    const document = new FakeDocumentPort(
      buildSnapshot({ rootId: ids[0]!, nodes }),
    );
    const services = assembleServices({
      platform: new FakePlatformPort(),
      registry,
      document,
      host: new FakeHostStore(),
    });
    renderApp(services);

    // 深度 129 的节点被隔离为 system.error（DOC_TREE_TOO_DEEP），不崩溃。
    const error = container.querySelector('[data-system="system.error"]');
    expect(error).not.toBeNull();
    expect(error!.textContent).toContain("DOC_TREE_TOO_DEEP");
    // 浅层链仍正常渲染。
    expect(container.querySelector('[data-testid="chain"]')).not.toBeNull();
  });

  it("edit 模式：Renderer 收到 mode=edit，NodeFrame 包装，动作按钮不发射", () => {
    const registry = new FakeRegistry();
    registry.putDirect(
      fakeRegistered({
        type: "test.root",
        slots: [slot("children")],
        render: (props) => <div data-testid="root">{props.slots.render("children")}</div>,
      }),
    );
    let lastCapture: string | null = null;
    registry.putDirect(
      fakeRegistered({
        type: "test.button",
        render: (props) => (
          <button
            data-testid="btn"
            onClick={(event) => {
              const r = props.runtime.events.capture(event.nativeEvent);
              lastCapture = r.ok ? "captured" : r.error.code;
            }}
          >
            go
          </button>
        ),
      }),
    );
    const button = makeNode({ id: "btn-1", type: "test.button" });
    const rootNode = makeNode({
      id: "root-1",
      type: "test.root",
      children: [{ nodeId: button.id }],
    });
    const document = new FakeDocumentPort(
      buildSnapshot({ rootId: rootNode.id, nodes: [rootNode, button] }),
    );
    const platform = new FakePlatformPort();
    const services = assembleServices({
      platform,
      registry,
      document,
      host: new FakeHostStore(),
    });
    renderApp(services, "edit");

    // NodeFrame 包装：data-component-type div 存在。
    expect(container.querySelector('[data-component-type="test.button"]')).not.toBeNull();
    // 点击按钮：edit 模式 capture 返回 RUNTIME_MODE_FORBIDDEN，不产生动作。
    const btn = container.querySelector('[data-testid="btn"]') as HTMLButtonElement;
    act(() => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(lastCapture).toBe("RUNTIME_MODE_FORBIDDEN");
    // 平台没有产生任何副作用。
    expect(platform.openedUrls).toEqual([]);
    expect(platform.notices.shown).toEqual([]);
    expect(platform.executedCommands).toEqual([]);
  });
});
