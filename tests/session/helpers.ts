/**
 * Session 测试共享设施：全 unknown 测试 Registry、FakeClock、
 * 文档 fixture 构造器与 Session 装配辅助。
 */

import type {
  ChildPlacementV1,
  ComponentsDocumentV1,
  ComponentNodeV1,
  DocumentCommandV1,
  DocumentId,
  DocumentSessionV1,
  Result,
  UtcIsoDateTime,
} from "@ocs/contracts";
import { DEFAULT_CHILD_PLACEMENT_V1, DEFAULT_NODE_STYLE_V1 } from "@ocs/contracts";
import { DocumentCodec } from "../../src/document/codec";
import type { CodecRegistry } from "../../src/document/types";
import type { ClockPort, ComponentsStoragePort } from "../../src/platform/ports";
import type { RecoveryPortV1 } from "@ocs/contracts/document";
import { MemoryRecoveryPort } from "../../src/session/memory-recovery";
import { MemoryStorage } from "../../src/session/memory-storage";
import { CodecSessionFactory } from "../../src/session/SessionFactory";
import type { SessionFactory } from "../../src/session/SessionFactory";

// ---------------------------------------------------------------------------
// 测试 Registry：全 unknown（真实 Registry 由 Agent B 提供）。
// 已知类型校验（props/slot）由 Registry 集成测试覆盖；Session 测试只验证
// 事务/保存/外部协调逻辑，文档 fixture 全部使用 core.layout 空 children。
// ---------------------------------------------------------------------------

export const unknownRegistry: CodecRegistry = {
  resolveComponentType: () => ({ kind: "unknown" }),
  resolveDataSourceType: () => ({ kind: "unknown" }),
  resolveActionType: () => ({ kind: "unknown" }),
};

export const nullCodec = new DocumentCodec(unknownRegistry);

// ---------------------------------------------------------------------------
// FakeClock：可控时间 + 可触发的 timeout 队列（autosave debounce/backoff）。
// ---------------------------------------------------------------------------

interface FakeTimer {
  readonly at: number;
  readonly cb: () => void;
  readonly id: number;
}

export class FakeClock implements ClockPort {
  nowMs: number;
  private readonly timers: FakeTimer[] = [];
  private nextId = 1;

  constructor(startMs: number = Date.parse("2026-08-13T09:24:31.428Z")) {
    this.nowMs = startMs;
  }

  now(): number {
    return this.nowMs;
  }

  timeout(callback: () => void, delayMs: number): { dispose(): void } {
    const timer: FakeTimer = { at: this.nowMs + delayMs, cb: callback, id: this.nextId++ };
    this.timers.push(timer);
    return {
      dispose: () => {
        const index = this.timers.indexOf(timer);
        if (index >= 0) this.timers.splice(index, 1);
      },
    };
  }

  interval(): { dispose(): void } {
    throw new Error("FakeClock.interval 未实现");
  }

  aligned(): { dispose(): void } {
    throw new Error("FakeClock.aligned 未实现");
  }

  /** 推进时间并触发到期 Timer；返回是否触发过 Timer。 */
  async advance(ms: number): Promise<boolean> {
    this.nowMs += ms;
    return this.fireDue();
  }

  /** 触发所有已到期的 Timer（含回调期间新安排的即时 Timer）。 */
  async fireDue(): Promise<boolean> {
    let fired = false;
    for (;;) {
      const due = this.timers
        .filter((t) => t.at <= this.nowMs)
        .sort((a, b) => a.at - b.at);
      if (due.length === 0) return fired;
      fired = true;
      for (const timer of due) {
        const index = this.timers.indexOf(timer);
        if (index >= 0) this.timers.splice(index, 1);
        timer.cb();
      }
      await tick();
    }
  }

  pendingTimerCount(): number {
    return this.timers.length;
  }
}

/** 让微任务/宏任务排空（内存存储的 Promise 即时结算）。 */
export function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// 文档 fixture 构造器
// ---------------------------------------------------------------------------

export const ROOT_ID = "c51f659b-e69c-4286-a0dd-f338b865e68c";
export const DOC_ID = "27b57616-c2d3-4762-ad6f-fe066b072c95";
export const DOC_ID_OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

export interface DocOverrides {
  readonly title?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly revision?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly documentId?: string;
  readonly children?: readonly ComponentNodeV1[];
  readonly dataSources?: ComponentsDocumentV1["dataSources"];
  readonly permissions?: ComponentsDocumentV1["permissions"];
  readonly extensions?: Record<string, unknown>;
}

function fixedIso(ms: number): UtcIsoDateTime {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, ".000Z") as UtcIsoDateTime;
}

export function makeDoc(overrides: DocOverrides = {}): ComponentsDocumentV1 {
  const createdAt = overrides.createdAt ?? "2026-08-13T09:24:31.428Z";
  const updatedAt = overrides.updatedAt ?? createdAt;
  const children = overrides.children ?? [];
  const root: ComponentNodeV1 = {
    id: ROOT_ID as ComponentsDocumentV1["rootId"],
    type: "core.layout" as ComponentNodeV1["type"],
    specVersion: 1,
    enabled: true,
    label: "根布局",
    props: { mode: "stack", gap: 12, padding: 0, locked: false },
    style: JSON.parse(JSON.stringify(DEFAULT_NODE_STYLE_V1)) as ComponentNodeV1["style"],
    slots: { children: children.map((child) => ({ nodeId: child.id, placement: JSON.parse(JSON.stringify(DEFAULT_CHILD_PLACEMENT_V1)) as ChildPlacementV1 })) },
    bindings: [],
    events: {},
    extensions: {},
  };
  const nodes = { [ROOT_ID]: root } as unknown as ComponentsDocumentV1["nodes"];
  for (const child of children) nodes[child.id] = child;

  return {
    kind: "components-studio/document",
    formatVersion: 1,
    documentId: (overrides.documentId ?? DOC_ID) as DocumentId,
    revision: overrides.revision ?? 0,
    createdAt: fixedIso(Date.parse(createdAt)),
    updatedAt: fixedIso(Date.parse(updatedAt)),
    rootId: ROOT_ID as ComponentsDocumentV1["rootId"],
    nodes,
    dataSources: overrides.dataSources ?? {},
    permissions: overrides.permissions ?? { requested: [] },
    metadata: {
      title: overrides.title ?? "主页",
      description: overrides.description ?? "个人动态主页",
      tags: [...(overrides.tags ?? ["dashboard"])],
    },
    extensions: (overrides.extensions ?? {}) as ComponentsDocumentV1["extensions"],
  };
}

/** 深拷贝默认 ChildPlacement。 */
export function placement(): ChildPlacementV1 {
  return JSON.parse(JSON.stringify(DEFAULT_CHILD_PLACEMENT_V1)) as ChildPlacementV1;
}

/** 未知类型子节点（legacy 占位）：props/extensions 必须原样保留。 */
export function unknownChild(id: string, marker: string): ComponentNodeV1 {
  return {
    id: id as ComponentNodeV1["id"],
    type: "legacy.components-2-5" as ComponentNodeV1["type"],
    specVersion: 1,
    enabled: true,
    label: null,
    props: { raw: { kind: "legacy", marker } },
    style: JSON.parse(JSON.stringify(DEFAULT_NODE_STYLE_V1)) as ComponentNodeV1["style"],
    slots: {},
    bindings: [],
    events: {},
    extensions: { "legacy.components-2-5": { marker } } as ComponentNodeV1["extensions"],
  };
}

export function serializeDoc(document: ComponentsDocumentV1): string {
  return JSON.stringify(document, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// 命令构造器
// ---------------------------------------------------------------------------

let commandSeq = 0;

export function metadataCommand(
  title: string,
  commandId?: string,
  tags: readonly string[] = [],
): DocumentCommandV1 {
  return {
    kind: "document.metadata.replace",
    commandId: (commandId ?? `cmd-${++commandSeq}`) as DocumentCommandV1["commandId"],
    metadata: { title, description: "d", tags: [...tags] },
  };
}

export function addComponentCommand(
  parentId: string,
  node: ComponentNodeV1,
  commandId?: string,
): DocumentCommandV1 {
  return {
    kind: "component.add",
    commandId: (commandId ?? `cmd-${++commandSeq}`) as DocumentCommandV1["commandId"],
    parentId: parentId as ComponentNodeV1["id"],
    slot: "children",
    index: 0,
    node,
    placement: JSON.parse(JSON.stringify(DEFAULT_CHILD_PLACEMENT_V1)) as ChildPlacementV1,
  };
}

export function putDataSourceCommand(
  source: import("@ocs/contracts/document").DataSourceSpecV1,
  commandId?: string,
): DocumentCommandV1 {
  return {
    kind: "data-source.put",
    commandId: (commandId ?? `cmd-${++commandSeq}`) as DocumentCommandV1["commandId"],
    source,
  };
}

export function removeDataSourceCommand(
  sourceId: string,
  commandId?: string,
): DocumentCommandV1 {
  return {
    kind: "data-source.remove",
    commandId: (commandId ?? `cmd-${++commandSeq}`) as DocumentCommandV1["commandId"],
    sourceId: sourceId as import("@ocs/contracts").DataSourceId,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

export interface Harness {
  readonly storage: MemoryStorage;
  readonly recovery: MemoryRecoveryPort;
  readonly clock: FakeClock;
  readonly codec: DocumentCodec;
  readonly factory: SessionFactory;
}

export function createHarness(startMs: number = Date.parse("2026-08-13T09:24:31.428Z")): Harness {
  const storage = new MemoryStorage();
  const recovery = new MemoryRecoveryPort();
  const clock = new FakeClock(startMs);
  const codec = new DocumentCodec(unknownRegistry);
  const factory = new CodecSessionFactory({
    codec,
    storage,
    recovery,
    clock,
    vaultId: "vault-1",
  });
  return { storage, recovery, clock, codec, factory };
}

export async function acquireDoc(
  harness: Harness,
  document: ComponentsDocumentV1,
  path = "Notes/Home.components",
): Promise<Result<DocumentSessionV1>> {
  harness.storage.putFile(path, serializeDoc(document));
  return harness.factory.acquire(path);
}

export type { ComponentsStoragePort, RecoveryPortV1 };
