/**
 * core.data-table 测试（《运行时与 SDK 协议 v1》第 9 节）。
 * 覆盖：Schema 正反例（列 key/label 必填、align 枚举、行标量）、
 * 渲染表头 / 行 / 对齐 / 空态 / 布尔格式化。
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { CoreDataTableRenderer } from "../../src/widgets/core-data-table/Renderer";
import { coreDataTableDefinition, dataTableDefaultProps } from "../../src/widgets/core-data-table";
import type { DataTableProps } from "../../src/widgets/core-data-table";
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

function renderTable(props: DataTableProps): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(createElement(CoreDataTableRenderer, {
    id: "c0000000-0000-4000-8000-000000000001" as ComponentId,
    props,
    mode: "view",
    sourcePath: "Dashboard/示例.components",
    location: { parentId: null, slotName: null, childIndex: null, placement: null, depth: 0, ancestry: [] },
    slots: { has: () => false, getChildren: () => [], render: () => null, renderChild: () => null },
    runtime: {} as never,
    visibility: { isVisible: () => true, subscribe: () => () => {} },
  } as unknown as ComponentRendererProps<DataTableProps>));
  });
  return container;
}

const BASE: DataTableProps = {
  title: "本周任务",
  showHeader: true,
  columns: [
    { key: "name", label: "任务" },
    { key: "status", label: "状态" },
    { key: "priority", label: "优先级", align: "right" },
  ],
  rows: [
    { name: "设计评审", status: "进行中", priority: "高" },
    { name: "API 联调", status: "待办", priority: 1 },
  ],
  emptyText: "暂无数据",
  striped: true,
};

describe("core.data-table Schema", () => {
  it("接受合法 Props", () => {
    expect(coreDataTableDefinition.validate(BASE).ok).toBe(true);
  });

  it("接受空行（空态）", () => {
    const result = coreDataTableDefinition.validate({ ...BASE, rows: [] });
    expect(result.ok).toBe(true);
  });

  it("拒绝缺 showHeader/columns", () => {
    const result = coreDataTableDefinition.validate({ title: "t", rows: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const pointers = result.issues.map((issue) => issue.pointer);
      expect(pointers).toContain("/showHeader");
      expect(pointers).toContain("/columns");
    }
  });

  it("拒绝缺列 key/label", () => {
    const result = coreDataTableDefinition.validate({
      ...BASE,
      columns: [{ key: "only-key" } as never],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.pointer).toBe("/columns/0/label");
    }
  });

  it("拒绝非法 align 枚举", () => {
    const result = coreDataTableDefinition.validate({
      ...BASE,
      columns: [{ key: "name", label: "任务", align: "middle" as never }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]!.pointer).toBe("/columns/0/align");
    }
  });

  it("默认 Props 可通过校验", () => {
    expect(coreDataTableDefinition.validate(dataTableDefaultProps()).ok).toBe(true);
  });
});

describe("core.data-table Renderer", () => {
  it("渲染标题、表头与行", () => {
    const container = renderTable(BASE);
    const text = container.textContent ?? "";
    expect(text).toContain("本周任务");
    expect(text).toContain("任务");
    expect(text).toContain("设计评审");
    expect(text).toContain("API 联调");
    expect(container.querySelectorAll("tbody tr").length).toBe(2);
  });

  it("列对齐写入样式", () => {
    const container = renderTable(BASE);
    const header = container.querySelector("thead th:last-child") as HTMLElement;
    expect(header.style.textAlign).toBe("right");
  });

  it("布尔单元格格式化为 ✓/✗，null 为空串", () => {
    const container = renderTable({
      ...BASE,
      columns: [{ key: "ok", label: "完成" }],
      rows: [{ ok: true }, { ok: false }, { ok: null }],
    });
    const cells = [...container.querySelectorAll("tbody td")].map((cell) => cell.textContent);
    expect(cells).toEqual(["✓", "✗", ""]);
  });

  it("空行渲染空态文案", () => {
    const container = renderTable({ ...BASE, rows: [] });
    expect(container.querySelector(".ocs-data-table-empty")!.textContent).toBe("暂无数据");
    expect(container.querySelector("table")).toBeNull();
  });

  it("showHeader=false 不渲染表头", () => {
    const container = renderTable({ ...BASE, showHeader: false });
    expect(container.querySelector("thead")).toBeNull();
  });
});
