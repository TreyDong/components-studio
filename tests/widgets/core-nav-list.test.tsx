/**
 * core.nav-list 测试：Schema、链接解析、渲染、点击打开、edit 模式禁动作。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { createElement } from "react";
import type { ComponentId } from "@ocs/contracts";
import type { ComponentRendererProps } from "../../src/registry/definition";
import {
  coreNavListDefinition,
  navListDefaultProps,
  resolveNavLink,
  validateNavListProps,
} from "../../src/widgets/core-nav-list";
import { NavListRenderer } from "../../src/widgets/core-nav-list";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ITEMS = [
  { label: "主页", icon: "house", link: "[[home.components]]" },
  { label: "日记", icon: "calendar", link: "journal/2026-08-13.md" },
];

function renderNav(
  overrides: Partial<ComponentRendererProps<import("../../src/widgets/core-nav-list").NavListProps>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const openFile = vi.fn(async () => ({ ok: true as const, value: undefined }));
  const runtime = {
    mode: "view",
    navigation: { openFile },
  } as never;
  const props: ComponentRendererProps<import("../../src/widgets/core-nav-list").NavListProps> = {
    id: "c1" as ComponentId,
    props: { ...navListDefaultProps(), items: ITEMS },
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
    slots: {
      has: () => false,
      getChildren: () => [],
      render: () => null,
      renderChild: () => null,
    },
    runtime,
    visibility: {
      getSnapshot: () => ({
        hostVisible: true,
        ancestorVisible: true,
        nodeEnabled: true,
        nodeStyleVisible: true,
        activeInLayout: true,
        effectiveVisible: true,
      }),
      subscribe: () => () => {},
    },
    ...overrides,
  };
  act(() => {
    root.render(createElement(NavListRenderer, props));
  });
  return { container, root, openFile };
}

describe("core.nav-list Schema", () => {
  it("默认 Props 通过校验", () => {
    expect(validateNavListProps(navListDefaultProps()).ok).toBe(true);
  });

  it("items 缺 label 失败", () => {
    const r = validateNavListProps({
      ...navListDefaultProps(),
      items: [{ label: "", icon: "", link: "a.md" }],
    });
    expect(r.ok).toBe(false);
  });

  it("多余字段失败", () => {
    const r = validateNavListProps({ ...navListDefaultProps(), x: 1 });
    expect(r.ok).toBe(false);
  });

  it("items 超过 50 项失败", () => {
    const items = Array.from({ length: 51 }, (_, i) => ({
      label: `项 ${i}`,
      icon: "",
      link: `${i}.md`,
    }));
    const r = validateNavListProps({ ...navListDefaultProps(), items });
    expect(r.ok).toBe(false);
  });
});

describe("resolveNavLink", () => {
  it("内部链接去括号", () => {
    expect(resolveNavLink("[[home.components]]")).toBe("home.components");
  });
  it("普通路径原样", () => {
    expect(resolveNavLink("journal/2026-08-13.md")).toBe("journal/2026-08-13.md");
  });
});

describe("NavListRenderer", () => {
  let roots: Root[] = [];

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    document.body.innerHTML = "";
    roots = [];
  });

  it("渲染列表项并点击打开文件", async () => {
    const { container, openFile } = renderNav();
    const buttons = container.querySelectorAll(".ocs-nav-item-btn");
    expect(buttons.length).toBe(2);
    const first = buttons[0] as HTMLButtonElement;
    act(() => first.click());
    await new Promise((r) => setTimeout(r, 0));
    expect(openFile).toHaveBeenCalledWith("home.components", { disposition: "current-tab" });
  });

  it("edit 模式点击不打开", async () => {
    const openFile = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const { container } = renderNav({
      mode: "edit",
      runtime: { mode: "edit", navigation: { openFile } } as never,
    });
    const first = container.querySelector(".ocs-nav-item-btn") as HTMLButtonElement;
    act(() => first.click());
    await new Promise((r) => setTimeout(r, 0));
    expect(openFile).not.toHaveBeenCalled();
  });

  it("空列表显示 emptyText", () => {
    const { container } = renderNav({
      props: { ...navListDefaultProps(), items: [] },
    });
    expect(container.querySelector(".ocs-nav-empty")?.textContent).toBe("暂无导航项");
  });

  it("打开失败显示错误", async () => {
    const openFile = vi.fn(async () => ({
      ok: false as const,
      error: { code: "X", message: "打不开", scope: "platform" as const, recoverable: true, retryable: false },
    }));
    const { container } = renderNav({
      runtime: { mode: "view", navigation: { openFile } } as never,
    });
    const first = container.querySelector(".ocs-nav-item-btn") as HTMLButtonElement;
    act(() => first.click());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector(".ocs-nav-error")?.textContent).toContain("主页");
  });

  it("rainbowBackground 渲染彩虹类名", () => {
    const { container } = renderNav({
      props: { ...navListDefaultProps(), items: ITEMS, rainbowBackground: true },
    });
    expect(container.querySelector(".ocs-nav-list.ocs-nav-rainbow")).not.toBeNull();
  });

  it("默认无彩虹类名", () => {
    const { container } = renderNav();
    expect(container.querySelector(".ocs-nav-list")?.className).not.toContain("ocs-nav-rainbow");
  });

  it("itemBackground 应用到按钮样式", () => {
    const { container } = renderNav({
      props: {
        ...navListDefaultProps(),
        items: ITEMS,
        itemBackground: "#ff6b6b",
      },
    });
    const btn = container.querySelector(".ocs-nav-item-btn") as HTMLElement;
    expect(btn.style.getPropertyValue("--ocs-nav-item-bg")).toBe("#ff6b6b");
  });

  it("非法 itemBackground 校验失败", () => {
    const r = validateNavListProps({
      ...navListDefaultProps(),
      itemBackground: "red",
    });
    expect(r.ok).toBe(false);
  });

  it("组件可注册且声明 workspace:navigate", () => {
    expect(coreNavListDefinition.manifest.type).toBe("core.nav-list");
    expect(coreNavListDefinition.manifest.declaredCapabilities).toContain("workspace:navigate");
    expect(coreNavListDefinition.manifest.userCreatable).toBe(true);
  });
});
