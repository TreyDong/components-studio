/**
 * 一次性迁移脚本：旧 2.5 目录列表文件 → V1。
 * 使用 LegacyComponents25Importer 转换（multi→core.layout、custom→占位），
 * 并从旧 custom 的 data.settings.menuItems 生成 core.nav-list 受控节点。
 *
 * 用法：LEGACY_SRC=<旧文件绝对路径> LEGACY_TARGET=<新文件绝对路径> npx vitest run tests/install/migrate-legacy.test.ts
 * 不覆盖旧文件；目标存在时跳过写入。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LegacyComponents25Importer, distributeBasis } from "../../src/document/legacy-importer";
import { DocumentCodec } from "../../src/document/codec";
import { ComponentRegistryImpl } from "../../src/registry/ComponentRegistry";
import { legacyComponents25Definition } from "../../src/widgets/legacy-components-2-5";
import { coreNavListDefinition } from "../../src/widgets/core-nav-list";
import { coreLayoutDefinition } from "../../src/widgets/core-layout";
import { coreMarkdownDefinition } from "../../src/widgets/core-markdown";
import { timeClockDefinition } from "../../src/widgets/time-clock";
import { timeCalendarDefinition } from "../../src/widgets/time-calendar";
import { minimalDocument, ROOT_ID } from "../fixtures/minimal-document";
import { canonicalSerializeDocument } from "../../src/document/canonical";
import type { ComponentId, ComponentsDocumentV1, JsonObject } from "@ocs/contracts";
import type { ComponentNodeV1 } from "@ocs/contracts/document";

const SRC = process.env.LEGACY_SRC ?? "";
const TARGET = process.env.LEGACY_TARGET ?? "";

function buildRegistry() {
  const registry = new ComponentRegistryImpl();
  for (const d of [
    coreLayoutDefinition,
    coreMarkdownDefinition,
    timeClockDefinition,
    timeCalendarDefinition,
    legacyComponents25Definition,
    coreNavListDefinition,
  ]) {
    const r = registry.register(d as never);
    if (!r.ok) throw new Error(`注册失败: ${JSON.stringify(r.error)}`);
  }
  return registry;
}

/** 从 legacy custom 节点提取导航数据并生成 core.nav-list 节点。 */
function navListNodeFromLegacy(
  legacyNode: JsonObject,
  _documentId: string,
): ComponentNodeV1 | null {
  const data = legacyNode.data as
    | { settings?: Record<string, unknown> }
    | undefined;
  const menuItems = data?.settings?.menuItems;
  if (!Array.isArray(menuItems)) return null;
  const items = menuItems
    .filter((m): m is { label: string; icon?: string; link?: string } =>
      m !== null && typeof m === "object" && typeof (m as { label?: unknown }).label === "string",
    )
    .map((m) => ({
      label: m.label,
      icon: typeof m.icon === "string" ? m.icon : "",
      link: typeof m.link === "string" ? m.link : "",
    }))
    .filter((m) => m.link.length > 0);
  if (items.length === 0) return null;

  const root = minimalDocument().nodes[ROOT_ID]!;
  const settings = data?.settings;
  const rainbowBackground = settings?.enableRainbowBackground === true;
  const rawItemBg =
    settings && typeof settings.navItemBackgroundColor === "string"
      ? settings.navItemBackgroundColor
      : "";
  // 只接受 #RRGGBB/#RRGGBBAA；旧值如 "transparent" 不迁移。
  const itemBackground = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(rawItemBg)
    ? rawItemBg
    : "";
  return {
    ...root,
    id: "6d5d6d6d-6d6d-4d6d-8d6d-6d6d6d6d6d6d" as ComponentId,
    type: "core.nav-list" as ComponentNodeV1["type"],
    props: {
      title: "目录",
      items,
      showIcons: true,
      emptyText: "暂无导航项",
      rainbowBackground,
      itemBackground,
    },
    slots: {},
  } as ComponentNodeV1;
}

describe("legacy 迁移", () => {
  it("转换并写入新文件", async () => {
    if (!SRC || !TARGET) {
      expect(true).toBe(true);
      return;
    }
    const bytes = readFileSync(SRC);
    const importer = new LegacyComponents25Importer();
    const converted = importer.convert({
      sourcePath: SRC,
      sourceBytes: bytes,
      targetPath: TARGET,
      now: new Date().toISOString() as import("@ocs/contracts").UtcIsoDateTime,
    });
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;

    const document = converted.value.document as ComponentsDocumentV1;
    const registry = buildRegistry();
    const codec = new DocumentCodec(registry.codecView());

    // 从 legacy custom 节点提取导航数据
    let navNode: ComponentNodeV1 | null = null;
    for (const node of Object.values(document.nodes)) {
      if (node.type === "legacy.components-2-5") {
        const legacyNode = (node.props as { legacyNode: JsonObject }).legacyNode;
        navNode = navListNodeFromLegacy(legacyNode, document.documentId);
        if (navNode) break;
      }
    }

    // nav-list 需要 workspace:navigate 文档声明（四重 AND 授权）；无 nav-list 不声明。
    if (navNode) {
      document.permissions = {
        requested: [
          {
            capability: "workspace:navigate",
            reason: "导航列表打开笔记",
          },
        ],
      };
    }

    // 从 legacy custom 的 settings 生成带强调色的 time.calendar（迷你日历迁移）。
    let calendarNode: ComponentNodeV1 | null = null;
    for (const node of Object.values(document.nodes)) {
      if (node.type === "legacy.components-2-5") {
        const legacyNode = (node.props as { legacyNode: JsonObject }).legacyNode;
        const settings = (legacyNode.data as { settings?: Record<string, unknown> } | undefined)
          ?.settings;
        // 仅当存在日历特征配置时才生成 time.calendar（避免给导航类组件误加）。
        const hasCalendarConfig =
          settings !== undefined &&
          (typeof settings.accentColor === "string" ||
            typeof settings.imageFilePath === "string" ||
            typeof settings.imageUrl === "string" ||
            typeof settings.backgroundBlur === "number");
        const accent =
          settings && typeof settings.accentColor === "string" &&
          /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(settings.accentColor)
            ? settings.accentColor
            : null;
        if (hasCalendarConfig) {
          const root = minimalDocument().nodes[ROOT_ID]!;
          calendarNode = {
            ...root,
            id: "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a" as ComponentId,
            type: "time.calendar" as ComponentNodeV1["type"],
            props: {
              locale: "system",
              firstDayOfWeek: 1,
              showWeekNumbers: false,
              showToday: true,
              showAdjacentDays: true,
              label: "迷你日历",
              accent,
            },
            slots: {},
          } as ComponentNodeV1;
        }
        break;
      }
    }

    // columns 模式：追加节点后重新均分基点（总和严格 10000）。
    const rebalanceColumns = (root: ComponentNodeV1): ComponentNodeV1 => {
      if (root.props.mode !== "columns") return root;
      const children = root.slots.children ?? [];
      if (children.length === 0) return root;
      const basis = distributeBasis(children.map(() => 1));
      return {
        ...root,
        slots: {
          children: children.map((c, i) => ({
            ...c,
            placement: {
              ...c.placement,
              column: { ...c.placement.column, basisBp: basis[i]! },
            },
          })),
        },
      };
    };

    const extraNodes: ComponentNodeV1[] = [];
    if (navNode) extraNodes.push(navNode);
    if (calendarNode) extraNodes.push(calendarNode);
    for (const extra of extraNodes) {
      const root = document.nodes[document.rootId]!;
      const rootIdKey = document.rootId;
      const nextRoot = {
        ...root,
        slots: {
          children: [
            ...(root.slots.children ?? []),
            {
              nodeId: extra.id,
              placement: {
                tab: { title: null, icon: null, disabled: false },
                column: { basisBp: 10000, grow: 0, shrink: 1, minWidthPx: 0, maxWidthPx: null },
                grid: {
                  compact: { x: 0, y: 0, w: 4, h: 6, minW: 1, maxW: null, minH: 1, maxH: null },
                  regular: { x: 0, y: 0, w: 6, h: 6, minW: 1, maxW: null, minH: 1, maxH: null },
                  wide: { x: 0, y: 0, w: 4, h: 6, minW: 1, maxW: null, minH: 1, maxH: null },
                },
                extensions: {},
              },
            },
          ],
        },
      };
      document.nodes = {
        ...document.nodes,
        [extra.id]: extra,
        [rootIdKey]: rebalanceColumns(nextRoot),
      };
    }

    // 全量 Codec 校验（含新组件）
    const validated = codec.validate(document);
    expect(validated.ok, `校验失败: ${JSON.stringify(validated.ok ? [] : validated.issues.slice(0, 8))}`).toBe(true);
    if (!validated.ok) {
      return;
    }

    if (existsSync(TARGET)) {
      console.log(`目标已存在，跳过写入: ${TARGET}`);
      return;
    }
    mkdirSync(dirname(TARGET), { recursive: true });
    const text = canonicalSerializeDocument(document);
    writeFileSync(TARGET, text, "utf8");
    // 写后回读验证
    const reread = codec.parseUtf8(new TextEncoder().encode(readFileSync(TARGET, "utf8")));
    expect(reread.ok).toBe(true);
    console.log(`迁移完成: ${SRC} → ${TARGET}（nodes=${Object.keys(document.nodes).length}）`);
  });
});
