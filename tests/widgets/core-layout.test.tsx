/**
 * core.layout 测试（《运行时与 SDK 协议 v1》第 9.1 节）。
 * 覆盖：Schema 正反例、五种 mode 渲染（stack/columns/grid/tabs/vertical-tabs）、
 * Grid 绝对定位、Tabs 切换。使用 ReactDOM.createRoot + act 渲染到 jsdom。
 */

import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { CoreLayoutRenderer } from "../../src/widgets/core-layout/Renderer";
import { coreLayoutDefinition, coreLayoutDefaultProps } from "../../src/widgets/core-layout";
import type { CoreLayoutProps } from "../../src/widgets/core-layout";
import type { ComponentRendererProps } from "../../src/registry/definition";
import type { ChildRef, SlotRenderer, NodeVisibilityPort, ComponentRuntimeApi } from "../../src/runtime/types";
import type { ComponentId } from "@ocs/contracts";

const mounted: { root: Root; container: HTMLDivElement }[] = [];

afterEach(() => {
  for (const { root, container } of mounted) {
    root.unmount();
    container.remove();
  }
  mounted.length = 0;
});

function placement(index: number): ChildRef["placement"] {
  return {
    tab: { title: `标签 ${index + 1}`, icon: null, disabled: false },
    column: { basisBp: 5000, grow: 0, shrink: 1, minWidthPx: 0, maxWidthPx: null },
    grid: {
      compact: { x: 0, y: index, w: 1, h: 1, minW: 1, maxW: null, minH: 1, maxH: null },
      regular: { x: index % 2, y: index, w: 2, h: 1, minW: 1, maxW: null, minH: 1, maxH: null },
      wide: { x: index, y: index, w: 3, h: 1, minW: 1, maxW: null, minH: 1, maxH: null },
    },
    extensions: {},
  };
}

function makeSlots(count: number): SlotRenderer {
  const children: ChildRef[] = Array.from({ length: count }, (_, i) => ({
    nodeId: `child-${i}` as ComponentId,
    placement: placement(i),
  }));
  return {
    has: (name) => name === "children",
    getChildren: (name) => (name === "children" ? children : []),
    render: (name, options) => {
      if (name !== "children") return null;
      if (children.length === 0 && options?.empty !== undefined) return options.empty;
      const wrapper = options?.wrapper ?? "div";
      return children.map((child) =>
        createElement(wrapper, { key: child.nodeId, className: options?.childClassName, "data-node": child.nodeId }),
      );
    },
    renderChild: (child) =>
      createElement("div", { key: child.nodeId, "data-node": child.nodeId }, `child-${child.nodeId}`),
  };
}

function visibility(): NodeVisibilityPort {
  return {
    getSnapshot: () => ({
      hostVisible: true,
      ancestorVisible: true,
      nodeEnabled: true,
      nodeStyleVisible: true,
      activeInLayout: true,
      effectiveVisible: true,
    }),
    subscribe: () => () => {},
  };
}

function renderLayout(props: Partial<ComponentRendererProps<CoreLayoutProps>> = {}) {
  const base: ComponentRendererProps<CoreLayoutProps> = {
    id: "c1" as ComponentId,
    props: coreLayoutDefaultProps(),
    mode: "view",
    sourcePath: "home.components",
    location: {
      parentId: null,
      slotName: null,
      childIndex: null,
      placement: null,
      depth: 0,
      ancestry: [],
    },
    slots: makeSlots(2),
    runtime: {} as unknown as ComponentRuntimeApi,
    visibility: visibility(),
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(CoreLayoutRenderer, { ...base, ...props }));
  });
  mounted.push({ root, container });
  return { container };
}

describe("core.layout Schema", () => {
  it("默认 Props 通过；正例：grid 模式合法 Props 通过", () => {
    expect(coreLayoutDefinition.validate(coreLayoutDefaultProps()).ok).toBe(true);
    const grid = {
      ...coreLayoutDefaultProps(),
      mode: "grid",
      grid: { columns: { compact: 4, regular: 12, wide: 24 }, rowHeight: 240, dense: false, allowOverlap: false },
    } as unknown as CoreLayoutProps;
    expect(coreLayoutDefinition.validate(grid).ok).toBe(true);
  });

  it("反例：非法 mode / 负 gap / allowOverlap=true / 缺字段失败", () => {
    const badMode = { ...coreLayoutDefaultProps(), mode: "bogus" } as unknown as CoreLayoutProps;
    expect(coreLayoutDefinition.validate(badMode).ok).toBe(false);

    const badGap = { ...coreLayoutDefaultProps(), gap: -1 } as unknown as CoreLayoutProps;
    expect(coreLayoutDefinition.validate(badGap).ok).toBe(false);

    const badOverlap = {
      ...coreLayoutDefaultProps(),
      grid: { ...coreLayoutDefaultProps().grid, allowOverlap: true },
    } as unknown as CoreLayoutProps;
    expect(coreLayoutDefinition.validate(badOverlap).ok).toBe(false);

    const missing = { ...coreLayoutDefaultProps() } as unknown as Record<string, unknown>;
    delete missing.tabs;
    expect(coreLayoutDefinition.validate(missing).ok).toBe(false);
  });
});

describe("core.layout Renderer", () => {
  it("stack：垂直容器渲染两个子组件", () => {
    const { container } = renderLayout();
    const stack = container.querySelector(".ocs-layout-stack");
    expect(stack).not.toBeNull();
    expect(stack?.getAttribute("style")).toContain("gap: 12px");
    expect(container.querySelectorAll("[data-node]").length).toBe(2);
  });

  it("columns：flex 容器 + wrap 类 + 子项带列类", () => {
    const { container } = renderLayout({ props: { ...coreLayoutDefaultProps(), mode: "columns" } });
    const columns = container.querySelector(".ocs-layout-columns");
    expect(columns).not.toBeNull();
    expect(columns?.className).toContain("wrap");
    expect(columns?.className).not.toContain("equal");
    expect(container.querySelectorAll(".ocs-layout-col").length).toBe(2);
  });

  it("grid：按当前断点（wide=12 列）绝对定位，DOM 顺序为 Slot 顺序", () => {
    const { container } = renderLayout({ props: { ...coreLayoutDefaultProps(), mode: "grid" } });
    const cells = container.querySelectorAll(".ocs-layout-grid-cell");
    expect(cells.length).toBe(2);
    const first = cells[0] as HTMLElement | null;
    const second = cells[1] as HTMLElement | null;
    expect(first?.style.position).toBe("absolute");
    expect(first?.style.left).toBe("0%");
    expect(first?.style.width).toBe(`${(3 / 12) * 100}%`);
    expect(second?.style.left).toBe(`${(1 / 12) * 100}%`);
    // 行数 = max(y+h) = 2，rowHeight=80 → minHeight 160px
    const grid = container.querySelector(".ocs-layout-grid") as HTMLElement | null;
    expect(grid?.style.minHeight).toBe("160px");
    // 每个 cell 内含一个 data-node 子元素
    expect(first?.querySelectorAll("[data-node]").length).toBe(1);
  });

  it("tabs：tablist/tab/tabpanel，点击切换活动页", () => {
    const { container } = renderLayout({ props: { ...coreLayoutDefaultProps(), mode: "tabs" } });
    const tabs = container.querySelectorAll('button[role="tab"]');
    expect(tabs.length).toBe(2);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("false");

    const panels = container.querySelectorAll('[role="tabpanel"]');
    expect(panels.length).toBe(2);
    expect(panels[0]?.hasAttribute("hidden")).toBe(false);
    expect(panels[1]?.hasAttribute("hidden")).toBe(true);

    act(() => {
      (tabs[1] as HTMLButtonElement).click();
    });
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("false");
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
    expect(panels[0]?.hasAttribute("hidden")).toBe(true);
    expect(panels[1]?.hasAttribute("hidden")).toBe(false);
  });

  it("vertical-tabs：wide 断点下 placement=left 呈纵向", () => {
    const { container } = renderLayout({
      props: {
        ...coreLayoutDefaultProps(),
        mode: "vertical-tabs",
        tabs: { activation: "automatic", placement: "left" },
      },
    });
    const tabs = container.querySelector(".ocs-layout-tabs");
    expect(tabs?.className).toContain("vertical");
  });
});
