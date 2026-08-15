/**
 * 一次性生成"个人工作台"主页示例文档（真实 Codec + 全部内置组件）。
 * 覆盖新组件 core.stat-card / core.data-table。
 * 输出到测试库 Dashboard/个人工作台.components（HOME_PAGE_TARGET），
 * 并写入 src/preview/homepage.components 供浏览器预览页使用。
 */
import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ComponentRegistryImpl } from "../../src/registry/ComponentRegistry";
import { DocumentCodec } from "../../src/document/codec";
import { coreLayoutDefinition } from "../../src/widgets/core-layout";
import { coreMarkdownDefinition } from "../../src/widgets/core-markdown";
import { coreNavListDefinition } from "../../src/widgets/core-nav-list";
import { coreStatCardDefinition } from "../../src/widgets/core-stat-card";
import { coreDataTableDefinition } from "../../src/widgets/core-data-table";
import { timeClockDefinition } from "../../src/widgets/time-clock";
import { timeCalendarDefinition } from "../../src/widgets/time-calendar";
import { canonicalSerializeDocument } from "../../src/document/canonical";
import type { ComponentsDocumentV1, ComponentId, DocumentId, JsonObject, UtcIsoDateTime } from "@ocs/contracts";
import type { ComponentNodeV1, NodeStyleV1, ChildPlacementV1 } from "@ocs/contracts/document";

const TARGET = process.env.HOME_PAGE_TARGET ?? "";

function style(): NodeStyleV1 {
  return {
    visibility: "visible",
    classNames: [],
    width: "auto",
    minHeightPx: null,
    paddingPx: { top: 12, right: 12, bottom: 12, left: 12 },
    marginPx: { top: 0, right: 0, bottom: 0, left: 0 },
    background: { kind: "token", value: "surface" },
    color: null,
    border: { widthPx: 1, style: "solid", color: { kind: "token", value: "border" }, radiusPx: 8 },
    shadow: "sm",
  };
}

function placement(x: number, y: number, w: number, h: number): ChildPlacementV1 {
  return {
    tab: { title: null, icon: null, disabled: false },
    column: { basisBp: 10000, grow: 1, shrink: 1, minWidthPx: 0, maxWidthPx: null },
    grid: {
      compact: { x: 0, y, w: 1, h, minW: 1, maxW: null, minH: 1, maxH: null },
      regular: { x: Math.min(x, 5), y, w: Math.min(w, 6), h, minW: 1, maxW: null, minH: 1, maxH: null },
      wide: { x, y, w, h, minW: 1, maxW: null, minH: 1, maxH: null },
    },
    extensions: {},
  };
}

function node(id: string, type: string, props: JsonObject): ComponentNodeV1 {
  return {
    id: id as ComponentId,
    type: type as ComponentNodeV1["type"],
    specVersion: 1,
    enabled: true,
    label: null,
    props,
    style: style(),
    slots: {},
    bindings: [],
    events: {},
    extensions: {},
  } as ComponentNodeV1;
}

function buildDocument(): ComponentsDocumentV1 {
  const rootId = "c0000000-0000-4000-8000-000000000001" as ComponentId;
  const ids = {
    nav: "c0000000-0000-4000-8000-000000000002",
    todo: "c0000000-0000-4000-8000-000000000003",
    done: "c0000000-0000-4000-8000-000000000004",
    projects: "c0000000-0000-4000-8000-000000000005",
    focus: "c0000000-0000-4000-8000-000000000006",
    table: "c0000000-0000-4000-8000-000000000007",
    calendar: "c0000000-0000-4000-8000-000000000008",
    clock: "c0000000-0000-4000-8000-000000000009",
    notes: "c0000000-0000-4000-8000-00000000000a",
  };

  const md = (content: string): JsonObject => ({
    source: { kind: "inline", content },
    showSourceTitle: false,
    emptyText: "",
  });

  // 宽屏 12 列：导航全宽；4 指标卡（3+3+3+3）；表格 7 + 日历 5；时钟 4 + 速记 8。
  const layout: Array<{ id: string; type: string; props: JsonObject; x: number; y: number; w: number; h: number }> = [
    {
      id: ids.nav,
      type: "core.nav-list",
      props: {
        title: "个人工作台",
        items: [
          { label: "总览", icon: "layout", link: "[[个人工作台.components]]" },
          { label: "待办", icon: "check", link: "[[个人工作台.components]]" },
          { label: "日历", icon: "calendar", link: "[[个人工作台.components]]" },
          { label: "速记", icon: "file-text", link: "[[个人工作台.components]]" },
        ],
        showIcons: true,
        emptyText: "暂无导航项",
        rainbowBackground: true,
        itemBackground: "",
      },
      x: 0, y: 0, w: 12, h: 2,
    },
    {
      id: ids.todo,
      type: "core.stat-card",
      props: {
        title: "今日待办",
        value: "5",
        unit: "项",
        trend: "up",
        trendLabel: "较昨日 +2",
        accent: "#4d96ff",
        icon: "list-check",
        note: "Tasks 目录 task 标签",
      },
      x: 0, y: 2, w: 3, h: 3,
    },
    {
      id: ids.done,
      type: "core.stat-card",
      props: {
        title: "本周完成",
        value: "12",
        unit: "项",
        trend: "up",
        trendLabel: "较上周 +4",
        accent: "#30a46c",
        icon: "check-circle",
        note: "本周一至今日",
      },
      x: 3, y: 2, w: 3, h: 3,
    },
    {
      id: ids.projects,
      type: "core.stat-card",
      props: {
        title: "进行中项目",
        value: "3",
        unit: "个",
        trend: "flat",
        trendLabel: "与上周持平",
        accent: "#ffb224",
        icon: "folder-kanban",
      },
      x: 6, y: 2, w: 3, h: 3,
    },
    {
      id: ids.focus,
      type: "core.stat-card",
      props: {
        title: "连续专注",
        value: "6",
        unit: "天",
        trend: "up",
        trendLabel: "历史新高",
        accent: "#e5484d",
        icon: "flame",
      },
      x: 9, y: 2, w: 3, h: 3,
    },
    {
      id: ids.table,
      type: "core.data-table",
      props: {
        title: "本周任务清单",
        showHeader: true,
        columns: [
          { key: "task", label: "任务" },
          { key: "status", label: "状态" },
          { key: "priority", label: "优先级", align: "center" },
          { key: "due", label: "截止", align: "right" },
        ],
        rows: [
          { task: "设计评审", status: "进行中", priority: "高", due: "08-16" },
          { task: "API 联调", status: "待办", priority: "高", due: "08-18" },
          { task: "组件库重构", status: "进行中", priority: "中", due: "08-20" },
          { task: "首页性能优化", status: "待办", priority: "中", due: "08-21" },
          { task: "发布预览", status: "已完成", priority: "低", due: "08-15" },
        ],
        emptyText: "本周暂无任务",
        striped: true,
      },
      x: 0, y: 5, w: 7, h: 8,
    },
    {
      id: ids.calendar,
      type: "time.calendar",
      props: {
        locale: "system",
        firstDayOfWeek: 1,
        showWeekNumbers: false,
        showToday: true,
        showAdjacentDays: true,
        label: "排期",
        accent: "#4d96ff",
      },
      x: 7, y: 5, w: 5, h: 8,
    },
    {
      id: ids.clock,
      type: "time.clock",
      props: {
        timeZone: "local",
        locale: "system",
        hourCycle: "h23",
        showSeconds: true,
        showDate: true,
        dateStyle: "medium",
        timeStyle: "medium",
        label: "当前时间",
      },
      x: 0, y: 13, w: 4, h: 3,
    },
    {
      id: ids.notes,
      type: "core.markdown",
      props: md("### 📝 今日速记\n\n- **高优先级**：完成看板组件落地，阻塞明日联调\n- 明日安排：日历排期联调 + 指标卡样式走查\n- 灵感：数据表格支持单元格点击动作（Phase 2）\n- 复盘：本周发布节奏偏慢，下周提前一天冻结需求"),
      x: 4, y: 13, w: 8, h: 5,
    },
  ];

  const nodes: Record<ComponentId, ComponentNodeV1> = {};

  // 断点独立布局：compact 单列堆叠；regular 两列堆叠；wide 使用页面坐标。
  const compactColY = [0];
  const regularColY = [0, 0];
  const gridChildren = layout.map((c, index) => {
    const p = placement(c.x, c.y, c.w, c.h);
    p.grid.compact = { x: 0, y: compactColY[0]!, w: 1, h: c.h, minW: 1, maxW: null, minH: 1, maxH: null };
    compactColY[0]! += c.h;
    const col = index % 2;
    const rw = Math.min(c.w, 3);
    const rx = col * 3;
    const ry = regularColY[col]!;
    p.grid.regular = { x: rx, y: ry, w: rw, h: c.h, minW: 1, maxW: null, minH: 1, maxH: null };
    regularColY[col]! += c.h;
    return { nodeId: c.id as ComponentId, placement: p };
  });

  const rootNode: ComponentNodeV1 = {
    id: rootId,
    type: "core.layout",
    specVersion: 1,
    enabled: true,
    label: null,
    props: {
      mode: "grid",
      gap: 12,
      padding: 16,
      locked: false,
      grid: { columns: { compact: 1, regular: 6, wide: 12 }, rowHeight: 80, dense: false, allowOverlap: false },
      columns: { wrap: true, equalWidth: false },
      tabs: { activation: "automatic", placement: "top" },
    },
    style: {
      visibility: "visible",
      classNames: [],
      width: "fill",
      minHeightPx: 400,
      paddingPx: { top: 0, right: 0, bottom: 0, left: 0 },
      marginPx: { top: 0, right: 0, bottom: 0, left: 0 },
      background: null,
      color: null,
      border: null,
      shadow: "none",
    },
    slots: { children: gridChildren },
    bindings: [],
    events: {},
    extensions: {},
  } as unknown as ComponentNodeV1;
  nodes[rootId] = rootNode;
  for (const c of layout) {
    nodes[c.id as ComponentId] = node(c.id, c.type, c.props);
  }

  return {
    kind: "components-studio/document",
    formatVersion: 1,
    documentId: "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2" as DocumentId,
    revision: 0,
    createdAt: "2026-08-15T09:00:00.000Z" as UtcIsoDateTime,
    updatedAt: "2026-08-15T09:00:00.000Z" as UtcIsoDateTime,
    rootId,
    nodes,
    dataSources: {},
    permissions: {
      requested: [
        { capability: "timer:use", reason: "时钟组件需要" },
        { capability: "workspace:navigate", reason: "导航列表打开笔记" },
      ],
    },
    metadata: { title: "个人工作台", description: "个人总览 / 待办清单 / 日历 / 今日速记", tags: ["home", "personal", "workspace"] },
    extensions: {},
  };
}

describe("生成个人工作台主页", () => {
  it("生成并通过 Codec 校验", () => {
    const registry = new ComponentRegistryImpl();
    for (const d of [
      coreLayoutDefinition,
      coreMarkdownDefinition,
      coreNavListDefinition,
      coreStatCardDefinition,
      coreDataTableDefinition,
      timeClockDefinition,
      timeCalendarDefinition,
    ]) {
      const r = registry.register(d as never);
      if (!r.ok) throw new Error(`注册失败: ${JSON.stringify(r.error)}`);
    }
    const codec = new DocumentCodec(registry.codecView());
    const document = buildDocument();
    const validated = codec.validate(document);
    expect(validated.ok, JSON.stringify(validated.ok ? [] : validated.issues.slice(0, 6))).toBe(true);
    if (!validated.ok) return;

    const text = canonicalSerializeDocument(document);
    mkdirSync("src/preview", { recursive: true });
    writeFileSync("src/preview/homepage.components", text, "utf8");
    if (TARGET) {
      mkdirSync(dirname(TARGET), { recursive: true });
      writeFileSync(TARGET, text, "utf8");
    }
    expect(text.length).toBeGreaterThan(1000);
  });
});
