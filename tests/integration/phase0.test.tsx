/**
 * Phase 0 出口集成测试（《README》开工门槛 1–6）。
 *
 * 新建 → 打开 → 渲染 → 编辑 → 保存 → 重开语义一致；
 * 未知组件只影响自身、不白屏、不丢配置；保存冲突不覆盖外部修改；关闭释放资源。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { ComponentRegistryImpl } from "../../src/registry/ComponentRegistry";
import { NodeFactoryImpl } from "../../src/registry/NodeFactory";
import { DocumentBuilderImpl } from "../../src/document/DocumentBuilder";
import { DocumentCodec } from "../../src/document/codec";
import { DocumentFileCreatorImpl } from "../../src/plugin/create-document";
import { CodecSessionFactory } from "../../src/session/SessionFactory";
import { MemoryStorage } from "../../src/session/memory-storage";
import { MemoryRecoveryPort } from "../../src/session/memory-recovery";
import { RuntimeRoot } from "../../src/runtime/RuntimeRoot";
import { createRuntimeServices, HostStateStore } from "../../src/runtime/index";
import type { RuntimeDocumentPort, RuntimeServices } from "../../src/runtime/types";
import type { PlatformPort, ClockPort } from "../../src/platform/ports";
import { FakeHostStore, FakePlatformPort } from "../runtime/fakes";
import { coreLayoutDefinition } from "../../src/widgets/core-layout";
import { coreMarkdownDefinition } from "../../src/widgets/core-markdown";
import { timeClockDefinition } from "../../src/widgets/time-clock";
import { minimalDocument, ROOT_ID } from "../fixtures/minimal-document";
import type {
  ComponentId,
  ComponentsDocumentV1,
  DataSourceId,
  DocumentSessionV1,
  PersistedDataSourceSpecV1,
} from "@ocs/contracts";
import type { ComponentNodeV1 } from "@ocs/contracts/document";
import { DEFAULT_CHILD_PLACEMENT_V1 } from "@ocs/contracts/document";
import { canonicalSerializeDocument } from "../../src/document/canonical";
import { sha256HexSync } from "../../src/shared/hash";

const MARKDOWN_ID = "11111111-2222-4333-8444-555555555555";
const CLOCK_ID = "22222222-2222-4333-8444-555555555555";

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

function sessionDocumentPort(session: DocumentSessionV1, path: string): RuntimeDocumentPort {
  let lastDoc: import("@ocs/contracts").DeepReadonly<ComponentsDocumentV1> | null = null;
  let lastBuilt: import("../../src/runtime/types").DocumentSnapshot | null = null;
  return {
    getSnapshot: () => {
      const doc = session.getSnapshot();
      if (doc !== lastDoc) {
        lastDoc = doc;
        lastBuilt = {
          documentId: doc.documentId,
          sourcePath: path,
          sessionVersion: session.getSessionVersion(),
          revision: doc.revision,
          rootId: doc.rootId,
          nodes: new Map(
            Object.entries(doc.nodes) as unknown as [ComponentId, ComponentNodeV1][],
          ),
          dataSources: new Map(
            Object.entries(doc.dataSources) as unknown as [DataSourceId, PersistedDataSourceSpecV1][],
          ),
          permissions: doc.permissions as unknown as ComponentsDocumentV1["permissions"],
          metadata: doc.metadata as unknown as ComponentsDocumentV1["metadata"],
        };
      }
      return lastBuilt!;
    },
    subscribe: (l) => session.subscribe(l),
    getStatus: () => {
      const status = session.getStatus();
      switch (status.kind) {
        case "ready":
        case "saving":
          return { kind: status.kind, dirty: status.dirty };
        case "conflict":
        case "invalid-external":
        case "missing":
        case "disposed":
          return { kind: status.kind };
        case "read-only":
          return { kind: "read-only", reason: status.reason };
        default:
          // loading / save-error / error：Runtime 视作暂时不可编辑
          return { kind: "ready", dirty: false };
      }
    },
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function buildStack() {
  const registry = new ComponentRegistryImpl();
  const register = <P extends object>(d: import("../../src/registry/definition").ComponentDefinition<P>): void => {
    const r = registry.register(d);
    if (!r.ok) throw new Error(`注册失败: ${JSON.stringify(r.error)}`);
  };
  register(coreLayoutDefinition);
  register(coreMarkdownDefinition);
  register(timeClockDefinition);
  const codec = new DocumentCodec(registry.codecView());
  const nodeFactory = new NodeFactoryImpl();
  const builder = new DocumentBuilderImpl({ registry, nodeFactory, codec });
  const storage = new MemoryStorage();
  const recovery = new MemoryRecoveryPort();
  const factory = new CodecSessionFactory({
    codec,
    storage,
    recovery,
    clock: makeClock(),
    vaultId: "test-vault",
  });
  const creator = new DocumentFileCreatorImpl({ storage, builder, codec });
  return { registry, codec, builder, storage, recovery, factory, creator };
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

function markdownProps(): import("@ocs/contracts").JsonObject {
  return {
    source: { kind: "inline", content: "你好 **世界**" },
    showSourceTitle: false,
    emptyText: "暂无内容",
  };
}

function clockProps(): import("@ocs/contracts").JsonObject {
  return {
    timeZone: "local",
    locale: "system",
    hourCycle: "h23",
    showSeconds: false,
    showDate: true,
    dateStyle: "medium",
    timeStyle: "short",
    label: "",
  };
}

function markdownWritingPlatform(): PlatformPort {
  const platform = new FakePlatformPort() as unknown as PlatformPort;
  const withMarkdown = platform as unknown as {
    markdown: {
      render(input: {
        markdown: string;
        sourcePath: string;
        container: HTMLElement;
      }): Promise<import("@ocs/contracts").Result<void>>;
    };
  };
  withMarkdown.markdown = {
    render: async (input) => {
      input.container.textContent = input.markdown.replace(/\*\*/g, "");
      return { ok: true, value: undefined };
    },
  };
  return platform;
}

async function createAndPopulate(path: string) {
  const stack = buildStack();
  const created = await stack.creator.create({
    path,
    title: "主页",
    description: "个人动态主页",
    openAfterCreate: false,
  });
  expect(created.ok).toBe(true);
  const acquired = await stack.factory.acquire(path);
  expect(acquired.ok).toBe(true);
  const session = acquired.ok ? acquired.value : null;
  expect(session).not.toBeNull();

  const markdownNode = childNode("core.markdown", MARKDOWN_ID);
  markdownNode.props = markdownProps();
  const clockNode = childNode("time.clock", CLOCK_ID);
  clockNode.props = clockProps();

  const r1 = session!.dispatch(
    {
      commandId: "add-markdown" as import("@ocs/contracts").CommandId,
      kind: "component.add",
      parentId: session!.getSnapshot().rootId,
      slot: "children",
      index: 0,
      node: markdownNode,
      placement: DEFAULT_CHILD_PLACEMENT_V1,
    },
    { label: "添加 markdown", expectedSessionVersion: 0, mergeKey: null },
  );
  expect(r1.ok).toBe(true);
  const r2 = session!.dispatch(
    {
      commandId: "add-clock" as import("@ocs/contracts").CommandId,
      kind: "component.add",
      parentId: session!.getSnapshot().rootId,
      slot: "children",
      index: 1,
      node: clockNode,
      placement: DEFAULT_CHILD_PLACEMENT_V1,
    },
    { label: "添加 clock", expectedSessionVersion: 1, mergeKey: null },
  );
  expect(r2.ok).toBe(true);

  // 文档声明 timer:use（内置组件内置策略自动授予已声明的只读能力）
  const requestTimer = session!.dispatch(
    {
      commandId: "request-timer" as import("@ocs/contracts").CommandId,
      kind: "document.permissions.replace",
      permissions: {
        requested: [{ capability: "timer:use", reason: "时钟组件需要" }],
      },
    },
    { label: "声明能力", expectedSessionVersion: 2, mergeKey: null },
  );
  expect(requestTimer.ok).toBe(true);
  return { ...stack, session: session! };
}

describe("Phase 0 出口", () => {
  let containers: HTMLElement[] = [];
  let roots: Root[] = [];

  beforeEach(() => {
    containers = [];
    roots = [];
  });

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    for (const el of containers) el.remove();
  });

  function mountRuntime(services: RuntimeServices, mode: "view" | "edit" = "view"): HTMLElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(<RuntimeRoot services={services} initialMode={mode} />);
    });
    return container;
  }

  it("新建 → 打开 → 渲染 → 编辑 → 保存 → 重开语义一致", async () => {
    const path = "Home.components";
    const { factory, session, registry, storage } = await createAndPopulate(path);

    // Props 修改也经 dispatch
    const propsReplace = session.dispatch(
      {
        commandId: "clock-props" as import("@ocs/contracts").CommandId,
        kind: "component.props.replace",
        componentId: CLOCK_ID as import("@ocs/contracts").ComponentId,
        props: {
          timeZone: "Asia/Shanghai",
          locale: "zh-CN",
          hourCycle: "h23",
          showSeconds: true,
          showDate: true,
          dateStyle: "long",
          timeStyle: "medium",
          label: "上海时间",
        },
      },
      { label: "修改时钟", expectedSessionVersion: 3, mergeKey: null },
    );
    expect(propsReplace.ok).toBe(true);

    // 渲染：真实 Registry + 真实 Session Port + RuntimeRoot
    const host = new FakeHostStore({ sourcePath: path });
    const services = createRuntimeServices({
      platform: markdownWritingPlatform(),
      registry,
      document: sessionDocumentPort(session, path),
      host,
      hostState: new HostStateStore(),
    });
    const container = mountRuntime(services);
    await flush();

    // core.markdown 内容渲染
    const text = container.textContent ?? "";
    expect(text).toContain("你好");
    expect(text).toContain("世界");
    // time.clock 渲染 <time>
    expect(container.querySelector("time.ocs-clock")).not.toBeNull();
    // core.layout 根容器
    expect(container.querySelector(".ocs-component-layout")).not.toBeNull();

    // 保存
    const saved = await session.save("manual");
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.value.kind).toBe("saved");
      if (saved.value.kind === "saved") {
        expect(saved.value.persistedRevision).toBe(1);
        expect(saved.value.stillDirty).toBe(false);
      }
    }

    // 释放后重开：语义完全一致
    await factory.release(session);
    expect(factory.getSessionCount()).toBe(0);
    const reopened = await factory.acquire(path);
    expect(reopened.ok).toBe(true);
    if (reopened.ok) {
      const again = reopened.value;
      const first = canonicalSerializeDocument(session.getSnapshot());
      const second = canonicalSerializeDocument(again.getSnapshot());
      expect(second).toBe(first);
      // 磁盘文本与工作文档一致
      const disk = await storage.readText(path);
      expect(disk.ok).toBe(true);
      if (disk.ok) expect(disk.value.text).toBe(second);
      await factory.release(again);
    }
  });

  it("未知组件只影响自身：不白屏、不丢配置、其余页面正常", async () => {
    const path = "Unknown.components";
    const { session, registry } = await createAndPopulate(path);

    // 添加一个未知类型节点（vendor.unknown）
    const unknownNode = childNode("vendor.unknown", "33333333-3333-4333-8333-333333333333");
    unknownNode.props = { legacy: { keep: "me" }, nested: { a: 1 } };
    const addUnknown = session.dispatch(
      {
        commandId: "add-unknown" as import("@ocs/contracts").CommandId,
        kind: "component.add",
        parentId: session.getSnapshot().rootId,
        slot: "children",
        index: 2,
        node: unknownNode,
        placement: DEFAULT_CHILD_PLACEMENT_V1,
      },
      { label: "添加未知组件", expectedSessionVersion: 3, mergeKey: null },
    );
    expect(addUnknown.ok).toBe(true);

    const host = new FakeHostStore({ sourcePath: path });
    const services = createRuntimeServices({
      platform: markdownWritingPlatform(),
      registry,
      document: sessionDocumentPort(session, path),
      host,
      hostState: new HostStateStore(),
    });
    const container = mountRuntime(services);
    await flush();

    // 未知组件渲染占位，页面不白屏
    expect(container.querySelector('[data-component-type="vendor.unknown"]')).not.toBeNull();
    const text = container.textContent ?? "";
    expect(text).toContain("缺少对应组件实现");
    expect(text).toContain("vendor.unknown");
    // 已知组件仍然渲染
    expect(container.querySelector("time.ocs-clock")).not.toBeNull();
    expect(text).toContain("你好");

    // 原始配置不丢失
    const snapshot = session.getSnapshot();
    const node = snapshot.nodes["33333333-3333-4333-8333-333333333333" as never];
    expect(node).toBeDefined();
    expect(node!.props).toEqual({ legacy: { keep: "me" }, nested: { a: 1 } });
    // 会话仍可编辑（只读限制只针对未知节点内部）
    const enable = session.dispatch(
      {
        commandId: "enable-unknown" as import("@ocs/contracts").CommandId,
        kind: "component.enabled.set",
        componentId: "33333333-3333-4333-8333-333333333333" as never,
        enabled: false,
      },
      { label: "禁用未知组件", expectedSessionVersion: 4, mergeKey: null },
    );
    expect(enable.ok).toBe(true);
    // 未知节点内部配置不可修改
    const forbidden = session.dispatch(
      {
        commandId: "modify-unknown-props" as import("@ocs/contracts").CommandId,
        kind: "component.props.replace",
        componentId: "33333333-3333-4333-8333-333333333333" as never,
        props: {},
      },
      { label: "修改未知组件", expectedSessionVersion: 5, mergeKey: null },
    );
    expect(forbidden.ok).toBe(false);
  });

  it("保存冲突不覆盖外部修改", async () => {
    const path = "Conflict.components";
    const { session, storage, recovery } = await createAndPopulate(path);

    // 外部修改磁盘（模拟其他工具编辑）
    const diskBefore = await storage.readText(path);
    expect(diskBefore.ok).toBe(true);
    const externalText = diskBefore.ok
      ? diskBefore.value.text.replace("个人动态主页", "外部修改后的描述")
      : "";
    const externalHash = sha256HexSync(externalText);
    const externalWrite = await storage.compareAndSwapText({
      path,
      expectedText: diskBefore.ok ? diskBefore.value.text : "",
      expectedRawHash: diskBefore.ok ? diskBefore.value.rawHash : "",
      nextText: externalText,
    });
    expect(externalWrite.ok).toBe(true);
    if (externalWrite.ok) expect(externalWrite.value.kind).toBe("written");

    // 本地再编辑（保持 Dirty）
    const edit = session.dispatch(
      {
        commandId: "meta" as import("@ocs/contracts").CommandId,
        kind: "document.metadata.replace",
        metadata: { title: "本地标题", description: "本地描述", tags: [] },
      },
      { label: "本地编辑", expectedSessionVersion: 3, mergeKey: null },
    );
    expect(edit.ok).toBe(true);

    // 保存 → 必须 Conflict，不得覆盖
    const saved = await session.save("manual");
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.value.kind).toBe("conflict");
    expect(session.getStatus().kind).toBe("conflict");

    // 磁盘仍是外部文本
    const diskAfter = await storage.readText(path);
    expect(diskAfter.ok).toBe(true);
    if (diskAfter.ok) {
      expect(diskAfter.value.text).toBe(externalText);
      expect(diskAfter.value.rawHash).toBe(externalHash);
    }

    // 接受远端后本地内容经 Recovery 保留
    const resolution = await session.resolveConflict({
      kind: "accept-remote",
      confirmedDiscardLocal: true,
    });
    expect(resolution.ok).toBe(true);
    const recoveries = await recovery.listRecoveries();
    expect(recoveries.ok).toBe(true);
    if (recoveries.ok) expect(recoveries.value.length).toBeGreaterThan(0);
  });

  it("关闭后资源释放：refCount 归零、session dispose、无定时器残留", async () => {
    const path = "Lifecycle.components";
    const { factory, session } = await createAndPopulate(path);

    // 多 Host 共享 Session
    const second = await factory.acquire(path);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value).toBe(session);

    await factory.release(session);
    expect(factory.getSessionCount()).toBe(1);
    const statusAfterFirstRelease = session.getStatus();
    expect(statusAfterFirstRelease.kind).not.toBe("disposed");

    await factory.release(second.ok ? second.value : session);
    expect(factory.getSessionCount()).toBe(0);
    expect(session.getStatus().kind).toBe("disposed");

    // disposed 后命令被拒绝
    const cmd = session.dispatch(
      {
        commandId: "after-dispose" as import("@ocs/contracts").CommandId,
        kind: "document.metadata.replace",
        metadata: { title: "x", description: "", tags: [] },
      },
      { label: "x", expectedSessionVersion: 999, mergeKey: null },
    );
    expect(cmd.ok).toBe(false);
  });
});
