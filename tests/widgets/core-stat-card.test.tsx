/**
 * core.stat-card 测试（《运行时与 SDK 协议 v1》第 9 节）。
 * 覆盖：Schema 正反例（必填 / trend 枚举 / accent 颜色格式 / icon 格式）、
 * 渲染输出标题与数值、trend 徽标与 accent 内联变量、缺省 trend 不渲染徽标。
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { CoreStatCardRenderer } from "../../src/widgets/core-stat-card/Renderer";
import { coreStatCardDefinition, statCardDefaultProps } from "../../src/widgets/core-stat-card";
import type { StatCardProps } from "../../src/widgets/core-stat-card";
import type { ComponentRendererProps } from "../../src/registry/definition";
import type { ComponentId } from "@ocs/contracts";

const mounted: { root: Root; container: HTMLDivElement }[] = [];

afterEach(() => {
  for (const { root, container } of mounted) {
    root.unmount();
    container.remove();
  }
  mounted.length = 0;
});

function renderCard(props: StatCardProps): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(createElement(CoreStatCardRenderer, {
    id: "c0000000-0000-4000-8000-000000000001" as ComponentId,
    props,
    mode: "view",
    sourcePath: "Dashboard/示例.components",
    location: { parentId: null, slotName: null, childIndex: null, placement: null, depth: 0, ancestry: [] },
    slots: { has: () => false, getChildren: () => [], render: () => null, renderChild: () => null },
    runtime: {} as never,
    visibility: { isVisible: () => true, subscribe: () => () => {} },
  } as unknown as ComponentRendererProps<StatCardProps>));
  });
  return container;
}

describe("core.stat-card Schema", () => {
  it("接受最小合法 Props", () => {
    const result = coreStatCardDefinition.validate({ title: "今日待办", value: "12" });
    expect(result.ok).toBe(true);
  });

  it("接受全部字段", () => {
    const result = coreStatCardDefinition.validate({
      title: "进行中",
      value: "3",
      unit: "个",
      trend: "up",
      trendLabel: "较上周 +1",
      accent: "#4d96ff",
      note: "来自 Tasks 目录",
      icon: "trending-up",
    });
    expect(result.ok).toBe(true);
  });

  it("拒绝缺 title/value", () => {
    const result = coreStatCardDefinition.validate({ value: "12" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const pointers = result.issues.map((issue) => issue.pointer);
      expect(pointers).toContain("/title");
    }
  });

  it("拒绝非法 trend 枚举", () => {
    const result = coreStatCardDefinition.validate({ title: "t", value: "1", trend: "sideways" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.pointer).toBe("/trend");
    }
  });

  it("拒绝非法 accent 颜色格式", () => {
    const result = coreStatCardDefinition.validate({ title: "t", value: "1", accent: "blue" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.pointer).toBe("/accent");
    }
  });

  it("拒绝额外属性", () => {
    const result = coreStatCardDefinition.validate({ title: "t", value: "1", surprise: true });
    expect(result.ok).toBe(false);
  });

  it("默认 Props 可通过校验", () => {
    expect(coreStatCardDefinition.validate(statCardDefaultProps()).ok).toBe(true);
  });
});

describe("core.stat-card Renderer", () => {
  it("渲染标题、数值与单位", () => {
    const container = renderCard({ title: "本周完成", value: "8", unit: "项" });
    const text = container.textContent ?? "";
    expect(text).toContain("本周完成");
    expect(text).toContain("8");
    expect(text).toContain("项");
  });

  it("渲染 trend 徽标与 label", () => {
    const container = renderCard({ title: "进行中", value: "3", trend: "down", trendLabel: "较上周 -2" });
    const card = container.querySelector(".ocs-stat-card")!;
    expect(card.getAttribute("data-trend")).toBe("down");
    expect(card.querySelector(".ocs-stat-card-trend")!.textContent).toContain("▼");
    expect(card.querySelector(".ocs-stat-card-trend-label")!.textContent).toBe("较上周 -2");
  });

  it("无 trend 时不渲染徽标容器", () => {
    const container = renderCard({ title: "进行中", value: "3" });
    expect(container.querySelector(".ocs-stat-card-trend")).toBeNull();
    expect(container.querySelector(".ocs-stat-card-foot")).toBeNull();
  });

  it("accent 写入内联 CSS 变量", () => {
    const container = renderCard({ title: "进行中", value: "3", accent: "#30a46c" });
    const card = container.querySelector(".ocs-stat-card") as HTMLElement;
    expect(card.style.getPropertyValue("--ocs-stat-accent")).toBe("#30a46c");
  });
});
