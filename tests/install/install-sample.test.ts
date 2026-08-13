/**
 * 一次性安装脚本：生成校验通过的示例 .components 页面（测试 Vault 用）。
 * 走真实 DocumentFileCreator + DocumentSession + save 管线，保证文件合法。
 */
import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ComponentRegistryImpl } from "../../src/registry/ComponentRegistry";
import { NodeFactoryImpl } from "../../src/registry/NodeFactory";
import { DocumentBuilderImpl } from "../../src/document/DocumentBuilder";
import { DocumentCodec } from "../../src/document/codec";
import { DocumentFileCreatorImpl } from "../../src/plugin/create-document";
import { CodecSessionFactory } from "../../src/session/SessionFactory";
import { MemoryStorage } from "../../src/session/memory-storage";
import { MemoryRecoveryPort } from "../../src/session/memory-recovery";
import { coreLayoutDefinition } from "../../src/widgets/core-layout";
import { coreMarkdownDefinition } from "../../src/widgets/core-markdown";
import { timeClockDefinition } from "../../src/widgets/time-clock";
import { minimalDocument, ROOT_ID } from "../fixtures/minimal-document";
import type { ComponentNodeV1 } from "@ocs/contracts/document";
import { DEFAULT_CHILD_PLACEMENT_V1 } from "@ocs/contracts/document";
import type { ClockPort } from "../../src/platform/ports";

const TARGET = process.env.INSTALL_TARGET ?? "";

function makeClock(): ClockPort {
  return {
    now: () => Date.now(),
    timeout: (cb: () => void, ms: number) => {
      const t = setTimeout(cb, ms);
      return { dispose: () => clearTimeout(t) };
    },
    interval: (cb: () => void, ms: number) => {
      const t = setInterval(cb, ms);
      return { dispose: () => clearInterval(t) };
    },
    aligned: (cb: () => void) => {
      const t = setInterval(cb, 1000);
      return { dispose: () => clearInterval(t) };
    },
  };
}

function childNode(type: string, id: string): ComponentNodeV1 {
  const root = minimalDocument().nodes[ROOT_ID]!;
  return {
    ...root,
    id: id as ComponentNodeV1["id"],
    type: type as ComponentNodeV1["type"],
    props: {},
    slots: {},
  };
}

describe("install-sample", () => {
  it("生成示例 .components 到测试 Vault", async () => {
    if (!TARGET) {
      // 未指定 INSTALL_TARGET 时跳过写入（安装脚本专用）。
      expect(true).toBe(true);
      return;
    }    const registry = new ComponentRegistryImpl();
    for (const d of [coreLayoutDefinition, coreMarkdownDefinition, timeClockDefinition]) {
      const r = registry.register(d as never);
      if (!r.ok) throw new Error(`注册失败: ${JSON.stringify(r.error)}`);
    }
    const codec = new DocumentCodec(registry.codecView());
    const builder = new DocumentBuilderImpl({
      registry,
      nodeFactory: new NodeFactoryImpl(),
      codec,
    });
    const storage = new MemoryStorage();
    const factory = new CodecSessionFactory({
      codec,
      storage,
      recovery: new MemoryRecoveryPort(),
      clock: makeClock(),
      vaultId: "install-vault",
    });
    const creator = new DocumentFileCreatorImpl({ storage, builder, codec });

    const created = await creator.create({
      path: "Dashboard/Home.components",
      title: "Components Studio 示例",
      description: "Phase 0 演示页面",
      openAfterCreate: false,
    });
    expect(created.ok).toBe(true);

    const acquired = await factory.acquire("Dashboard/Home.components");
    expect(acquired.ok).toBe(true);
    const session = acquired.ok ? acquired.value : null;
    expect(session).not.toBeNull();
    if (!session) return;

    const markdownNode = childNode("core.markdown", "11111111-2222-4333-8444-555555555555");
    markdownNode.props = {
      source: {
        kind: "inline",
        content: "# 欢迎使用 Components Studio\n\n这是一个 **Phase 0** 示例页面。\n\n- 上面是 core.markdown 渲染的内容\n- 右下角是 time.clock 时钟\n\n改这个文件的 JSON 再保存，页面会实时更新。",
      },
      showSourceTitle: false,
      emptyText: "暂无内容",
    };
    const clockNode = childNode("time.clock", "22222222-2222-4333-8444-555555555555");
    clockNode.props = {
      timeZone: "local",
      locale: "system",
      hourCycle: "h23",
      showSeconds: true,
      showDate: true,
      dateStyle: "medium",
      timeStyle: "medium",
      label: "本地时间",
    };

    const r1 = session.dispatch(
      {
        commandId: "add-markdown" as import("@ocs/contracts").CommandId,
        kind: "component.add",
        parentId: session.getSnapshot().rootId,
        slot: "children",
        index: 0,
        node: markdownNode,
        placement: DEFAULT_CHILD_PLACEMENT_V1,
      },
      { label: "添加 markdown", expectedSessionVersion: 0, mergeKey: null },
    );
    expect(r1.ok).toBe(true);
    const r2 = session.dispatch(
      {
        commandId: "add-clock" as import("@ocs/contracts").CommandId,
        kind: "component.add",
        parentId: session.getSnapshot().rootId,
        slot: "children",
        index: 1,
        node: clockNode,
        placement: DEFAULT_CHILD_PLACEMENT_V1,
      },
      { label: "添加 clock", expectedSessionVersion: 1, mergeKey: null },
    );
    expect(r2.ok).toBe(true);
    const calendarNode = childNode("time.calendar", "44444444-4444-4444-8444-444444444444");
    calendarNode.props = {
      locale: "system",
      firstDayOfWeek: 1,
      showWeekNumbers: false,
      showToday: true,
      showAdjacentDays: false,
      label: "",
    };
    const r3 = session.dispatch(
      {
        commandId: "add-calendar" as import("@ocs/contracts").CommandId,
        kind: "component.add",
        parentId: session.getSnapshot().rootId,
        slot: "children",
        index: 2,
        node: calendarNode,
        placement: DEFAULT_CHILD_PLACEMENT_V1,
      },
      { label: "添加日历", expectedSessionVersion: 2, mergeKey: null },
    );
    expect(r3.ok).toBe(true);
    const r4 = session.dispatch(
      {
        commandId: "request-timer" as import("@ocs/contracts").CommandId,
        kind: "document.permissions.replace",
        permissions: { requested: [{ capability: "timer:use", reason: "时钟组件需要" }] },
      },
      { label: "声明能力", expectedSessionVersion: 3, mergeKey: null },
    );
    expect(r4.ok).toBe(true);

    const saved = await session.save("manual");
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.value.kind).toBe("saved");

    const disk = await storage.readText("Dashboard/Home.components");
    expect(disk.ok).toBe(true);
    if (!disk.ok) return;

    // 写入测试 Vault
    const targetPath = `${TARGET}/Dashboard/Home.components`;
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, disk.value.text, "utf8");
    // 同时写一份 Markdown 嵌入示例
    const embed = "```components\nsrc: Dashboard/Home.components\nmode: view\n```\n";
    writeFileSync(`${TARGET}/嵌入示例.md`, embed, "utf8");
    // 再次读回验证
    const reread = await factory.acquire("Dashboard/Home.components");
    expect(reread.ok).toBe(true);
    expect(TARGET.length > 0).toBe(true);
  });
});
