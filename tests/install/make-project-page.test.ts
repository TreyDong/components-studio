/**
 * 一次性生成"项目管理首页"示例文档（真实 Codec + 全部内置组件）。
 * 输出到测试库 Dashboard/项目首页.components，并写入 src/preview/preview-data.json
 * 供浏览器预览页使用。
 */
import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ComponentRegistryImpl } from "../../src/registry/ComponentRegistry";
import { DocumentCodec } from "../../src/document/codec";
import { coreLayoutDefinition } from "../../src/widgets/core-layout";
import { coreMarkdownDefinition } from "../../src/widgets/core-markdown";
import { coreNavListDefinition } from "../../src/widgets/core-nav-list";
import { timeClockDefinition } from "../../src/widgets/time-clock";
import { timeCalendarDefinition } from "../../src/widgets/time-calendar";
import { canonicalSerializeDocument } from "../../src/document/canonical";
import type { ComponentsDocumentV1, ComponentId, JsonObject } from "@ocs/contracts";
import type { ComponentNodeV1, NodeStyleV1, ChildPlacementV1 } from "@ocs/contracts/document";

const TARGET = process.env.PAGE_TARGET ?? "";

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
    metrics: "c0000000-0000-4000-8000-000000000003",
    board: "c0000000-0000-4000-8000-000000000004",
    tasks: "c0000000-0000-4000-8000-000000000005",
    calendar: "c0000000-0000-4000-8000-000000000006",
    clock: "c0000000-0000-4000-8000-000000000007",
  };

  const md = (content: string): JsonObject => ({
    source: { kind: "inline", content },
    showSourceTitle: false,
    emptyText: "",
  });

  // 宽屏 12 列布局：导航全宽；指标 3 卡；看板 7 + 日历 5；任务 8 + 时钟 4。
  const layout: Array<{ id: string; type: string; props: JsonObject; x: number; y: number; w: number; h: number }> = [
    {
      id: ids.nav,
      type: "core.nav-list",
      props: {
        title: "项目导航",
        items: [
          { label: "总览", icon: "layout", link: "[[项目首页.components]]" },
          { label: "看板", icon: "columns", link: "[[项目首页.components]]" },
          { label: "任务", icon: "check", link: "[[项目首页.components]]" },
          { label: "日历", icon: "calendar", link: "[[项目首页.components]]" },
        ],
        showIcons: true,
        emptyText: "暂无导航项",
        rainbowBackground: true,
        itemBackground: "",
      },
      x: 0, y: 0, w: 12, h: 2,
    },
    {
      id: ids.metrics,
      type: "core.markdown",
      props: md("### 📊 项目指标\n\n| 指标 | 数值 |\n|---|---|\n| 项目总数 | 12 |\n| 进行中 | 5 |\n| 本周完成 | 3 |\n| 逾期 | 1 |\n\n*静态示例：真实数据由 Phase 2 数据组件提供*"),
      x: 0, y: 2, w: 3, h: 3,
    },
    {
      id: ids.board,
      type: "core.markdown",
      props: md("### 🗂 看板\n\n**待办**\n- [ ] 设计评审\n- [ ] API 联调\n\n**进行中**\n- [ ] 组件库重构\n- [ ] 首页性能优化\n\n**已完成**\n- [x] 项目初始化\n- [x] 需求冻结"),
      x: 0, y: 5, w: 7, h: 8,
    },
    {
      id: ids.tasks,
      type: "core.markdown",
      props: md("### ✅ 本周任务\n\n1. 周一：看板组件落地\n2. 周二：日历排期联调\n3. 周三：指标卡样式\n4. 周四：整体走查\n5. 周五：发布预览"),
      x: 0, y: 13, w: 8, h: 6,
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
      x: 8, y: 13, w: 4, h: 3,
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
    documentId: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1" as import("@ocs/contracts").DocumentId,
    revision: 0,
    createdAt: "2026-08-13T09:00:00.000Z" as import("@ocs/contracts").UtcIsoDateTime,
    updatedAt: "2026-08-13T09:00:00.000Z" as import("@ocs/contracts").UtcIsoDateTime,
    rootId,
    nodes,
    dataSources: {},
    permissions: {
      requested: [
        { capability: "timer:use", reason: "时钟组件需要" },
        { capability: "workspace:navigate", reason: "导航列表打开笔记" },
      ],
    },
    metadata: { title: "项目管理首页", description: "看板 / 任务 / 日历 / 数据展示", tags: ["project", "dashboard"] },
    extensions: {},
  };
}

describe("生成项目管理首页", () => {
  it("生成并通过 Codec 校验", () => {
    const registry = new ComponentRegistryImpl();
    for (const d of [coreLayoutDefinition, coreMarkdownDefinition, coreNavListDefinition, timeClockDefinition, timeCalendarDefinition]) {
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
    writeFileSync("src/preview/preview-data.json", text, "utf8");
    if (TARGET) {
      mkdirSync(dirname(TARGET), { recursive: true });
      writeFileSync(TARGET, text, "utf8");
    }
    expect(text.length).toBeGreaterThan(1000);
  });
});
