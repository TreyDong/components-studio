/**
 * time.calendar 测试：Schema 正反例、月历网格算法、渲染结构、导航与今日高亮。
 */
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { createElement } from "react";
import type { ComponentId } from "@ocs/contracts";
import type { ComponentRendererProps } from "../../src/registry/definition";
import {
  timeCalendarDefinition,
  calendarDefaultProps,
  buildMonthGrid,
  formatMonthTitle,
  weekdayShortNames,
} from "../../src/widgets/time-calendar";
import { TimeCalendarRenderer } from "../../src/widgets/time-calendar/Renderer";
import { validateCalendarProps } from "../../src/widgets/time-calendar/schema";

describe("time.calendar Schema", () => {
  it("默认 Props 通过校验", () => {
    const r = validateCalendarProps(calendarDefaultProps());
    expect(r.ok).toBe(true);
  });

  it("firstDayOfWeek 越界失败", () => {
    const r = validateCalendarProps({ ...calendarDefaultProps(), firstDayOfWeek: 7 });
    expect(r.ok).toBe(false);
  });

  it("多余字段失败", () => {
    const r = validateCalendarProps({ ...calendarDefaultProps(), extra: 1 });
    expect(r.ok).toBe(false);
  });

  it("缺必填字段失败", () => {
    const bad = { ...calendarDefaultProps() } as Record<string, unknown>;
    delete bad.label;
    const r = validateCalendarProps(bad);
    expect(r.ok).toBe(false);
  });

  it("无效 locale 字段级失败", () => {
    const r = validateCalendarProps({ ...calendarDefaultProps(), locale: "not a locale!!!" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.pointer === "$/locale")).toBe(true);
    }
  });
});

describe("buildMonthGrid 算法", () => {
  const today = new Date(2026, 7, 13); // 2026-08-13

  it("固定 6 行 42 格", () => {
    const grid = buildMonthGrid(2026, 7, 1, today);
    expect(grid).toHaveLength(6);
    for (const row of grid) expect(row).toHaveLength(7);
  });

  it("2026-08 周一为起始：8月1日（周六）lead=5", () => {
    // 2026-08-01 是周六；firstDayOfWeek=1（周一）→ lead = (6-1+7)%7 = 5
    const grid = buildMonthGrid(2026, 7, 1, today);
    expect(grid[0]![5]!.adjacent).toBe(false);
    expect(grid[0]![5]!.day).toBe(1);
    expect(grid[0]![5]!.date.getMonth()).toBe(7);
    // 前 5 格是相邻月（7 月尾）
    for (let i = 0; i < 5; i++) {
      expect(grid[0]![i]!.adjacent).toBe(true);
    }
    // 8 月有 31 天 → 第 36 格（row5 col0）是 31 日
    expect(grid[5]![0]!.day).toBe(31);
    // 剩余是 9 月
    expect(grid[5]![1]!.adjacent).toBe(true);
  });

  it("今日标记正确", () => {
    const grid = buildMonthGrid(2026, 7, 1, today);
    const todayCell = grid
      .flat()
      .find((cell) => cell.date.getDate() === 13 && !cell.adjacent);
    expect(todayCell?.isToday).toBe(true);
  });

  it("周数递增且正确", () => {
    const grid = buildMonthGrid(2026, 7, 1, today);
    // 2026-07-27（周一）是第 31 周（ISO）
    expect(grid[0]![0]!.weekNumber).toBe(31);
  });
});

describe("formatMonthTitle / weekdayShortNames", () => {
  it("本地化标题", () => {
    expect(formatMonthTitle(2026, 7, "system")).toBeTruthy();
    expect(formatMonthTitle(2026, 7, "zh-CN")).toContain("2026");
  });

  it("周名按 firstDayOfWeek 排列", () => {
    const names = weekdayShortNames("zh-CN", 1);
    expect(names).toHaveLength(7);
    // 第一个是"一"
    expect(names[0]).toContain("一");
  });
});

describe("time.calendar Renderer", () => {
  const containers: HTMLElement[] = [];
  const roots: Root[] = [];

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    for (const el of containers) el.remove();
  });

  function renderCalendar(overrides: Partial<ComponentRendererProps<import("../../src/widgets/time-calendar").CalendarProps>> = {}) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    const props: ComponentRendererProps<import("../../src/widgets/time-calendar").CalendarProps> = {
      id: "c1" as ComponentId,
      props: calendarDefaultProps(),
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
      runtime: undefined as never,
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
      root.render(createElement(TimeCalendarRenderer, props));
    });
    return container;
  }

  it("渲染真实 table、标题与导航按钮", () => {
    const container = renderCalendar();
    expect(container.querySelector("table.ocs-calendar-grid")).not.toBeNull();
    expect(container.querySelectorAll("thead th").length).toBeGreaterThanOrEqual(7);
    expect(container.querySelectorAll("tbody tr").length).toBe(6);
    expect(container.querySelector(".ocs-calendar-title")?.textContent).toBeTruthy();
    expect(container.querySelector('button[aria-label="上个月"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="下个月"]')).not.toBeNull();
  });

  it("导航按钮切换月份", () => {
    const container = renderCalendar();
    const prev = container.querySelector('button[aria-label="上个月"]') as HTMLButtonElement;
    act(() => prev.click());
    const grid = container.querySelector(".ocs-calendar");
    expect(grid?.getAttribute("data-view-month")).toBe(String(new Date().getMonth() - 1 < 0 ? 11 : new Date().getMonth() - 1));
    expect(container.querySelector('button.ocs-calendar-today-btn')).not.toBeNull();
    const todayBtn = container.querySelector('button.ocs-calendar-today-btn') as HTMLButtonElement;
    act(() => todayBtn.click());
    expect(container.querySelector(".ocs-calendar")?.getAttribute("data-view-month")).toBe(String(new Date().getMonth()));
  });

  it("今日高亮", () => {
    const container = renderCalendar();
    const today = new Date();
    const cell = container.querySelector(".ocs-calendar-day.ocs-calendar-today");
    expect(cell).not.toBeNull();
    expect(cell?.getAttribute("aria-current")).toBe("date");
    expect(cell?.textContent).toBe(String(today.getDate()));
  });

  it("showToday=false 不高亮", () => {
    const container = renderCalendar({
      props: { ...calendarDefaultProps(), showToday: false },
    });
    expect(container.querySelector(".ocs-calendar-day.ocs-calendar-today")).toBeNull();
  });

  it("showAdjacentDays=false 时相邻月为空格；true 时显示", () => {
    const off = renderCalendar({
      props: { ...calendarDefaultProps(), showAdjacentDays: false },
    });
    const emptyCells = off.querySelectorAll(".ocs-calendar-day.ocs-calendar-adjacent");
    expect(emptyCells.length).toBeGreaterThan(0);
    for (const cell of Array.from(emptyCells)) {
      expect(cell.textContent).toBe("");
    }
    const on = renderCalendar({
      props: { ...calendarDefaultProps(), showAdjacentDays: true },
    });
    const filled = on.querySelectorAll(".ocs-calendar-day.ocs-calendar-adjacent");
    for (const cell of Array.from(filled)) {
      expect(cell.textContent).not.toBe("");
    }
  });

  it("showWeekNumbers 显示周数列", () => {
    const container = renderCalendar({
      props: { ...calendarDefaultProps(), showWeekNumbers: true },
    });
    expect(container.querySelectorAll(".ocs-calendar-weeknum").length).toBe(6);
  });

  it("组件可注册", () => {
    expect(timeCalendarDefinition.manifest.type).toBe("time.calendar");
    expect(timeCalendarDefinition.manifest.declaredCapabilities).toEqual([]);
    expect(timeCalendarDefinition.slots).toEqual([]);
  });
});
