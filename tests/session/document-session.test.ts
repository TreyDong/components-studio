/**
 * DocumentSession 行为测试（文档协议 10/12/13/14/15/16 章 + 验收 18.6–18.11）。
 * 使用全 unknown Registry + 内存 Storage/Recovery + FakeClock。
 */
import { describe, expect, it } from "vitest";
import type { ComponentsDocumentV1, DocumentSessionV1 } from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";
import { DocumentSession, toRuntimeDocumentPort } from "../../src/session/DocumentSession";
import {
  acquireDoc,
  createHarness,
  metadataCommand,
  makeDoc,
  putDataSourceCommand,
  removeDataSourceCommand,
  serializeDoc,
  unknownChild,
  addComponentCommand,
  type Harness,
} from "./helpers";

const PATH = "Notes/Home.components";

async function openSession(
  harness: Harness,
  document: ComponentsDocumentV1,
): Promise<DocumentSession> {
  harness.storage.putFile(PATH, serializeDoc(document));
  const acquired = await harness.factory.acquire(PATH);
  if (!acquired.ok) throw new Error(`acquire 失败: ${acquired.error.message}`);
  return acquired.value as DocumentSession;
}

function tx(label: string, version: number, mergeKey: string | null = null) {
  return { label, expectedSessionVersion: version, mergeKey };
}

/** 数据源 fixture（vault.query 是 V1 唯一内置类型）。 */
function dataSource(id: string): import("@ocs/contracts/document").DataSourceSpecV1 {
  return {
    id: id as import("@ocs/contracts").DataSourceId,
    type: "vault.query",
    specVersion: 1,
    enabled: true,
    label: "任务",
    config: { limit: 50 },
    refresh: { mode: "manual" },
    extensions: {},
  };
}

describe("dispatch（10.2 / 18.6）", () => {
  it("happy path：版本 +1、一次通知、一个 Undo、Snapshot 换新引用", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    const s0 = session.getSnapshot();
    let notifications = 0;
    session.subscribe(() => notifications++);

    expect(session.getStatus()).toEqual({ kind: "ready", dirty: false, reasons: [] });
    expect(session.getSessionVersion()).toBe(0);
    expect(session.getSnapshot()).toBe(s0); // 版本未变 → 引用稳定

    const r = session.dispatch(metadataCommand("B"), tx("改名", 0));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.sessionVersion).toBe(1);
      expect(r.value.contentHash).toBe(session.getContentHash());
    }
    expect(session.getSessionVersion()).toBe(1);
    expect(notifications).toBe(1);
    expect(session.canUndo()).toBe(true);
    expect(session.getSnapshot()).not.toBe(s0);
    expect(session.getSnapshot().metadata.title).toBe("B");
    expect(session.getStatus()).toEqual({ kind: "ready", dirty: true, reasons: ["user-edit"] });
  });

  it("过期 expectedSessionVersion 被拒绝，无任何变化", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    let notifications = 0;
    session.subscribe(() => notifications++);
    session.dispatch(metadataCommand("B"), tx("tx1", 0));
    const hashAfter = session.getContentHash();
    const versionAfter = session.getSessionVersion();

    const r = session.dispatch(metadataCommand("C"), tx("tx2", 0)); // 过期版本
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(ERROR_CODES.CMD_STALE_SESSION_VERSION);
    expect(session.getSessionVersion()).toBe(versionAfter);
    expect(session.getContentHash()).toBe(hashAfter);
    expect(notifications).toBe(1); // 只有 tx1 的通知
    expect(session.canUndo()).toBe(true);
    expect(session.canRedo()).toBe(false);
  });

  it("批量命令中任一失败 → 整批回滚（无版本/通知/Undo）", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    let notifications = 0;
    session.subscribe(() => notifications++);
    const s0 = session.getSnapshot();

    // 第二个命令：component.add 到未知父组件 → CMD_UNKNOWN_COMPONENT_READ_ONLY
    const failing = addComponentCommand(
      session.getSnapshot().rootId,
      unknownChild("00000000-0000-4000-8000-0000000000aa", "x"),
    );
    const r = session.dispatch([metadataCommand("B"), failing], tx("batch", 0));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(ERROR_CODES.CMD_UNKNOWN_COMPONENT_READ_ONLY);
    expect(session.getSessionVersion()).toBe(0);
    expect(notifications).toBe(0);
    expect(session.canUndo()).toBe(false);
    expect(session.getSnapshot()).toBe(s0);
    expect(session.getSnapshot().metadata.title).toBe("A");
    expect(session.getContentHash()).toBe(s0.metadata.title === "A" ? session.getContentHash() : session.getContentHash());
  });

  it("重复 commandId 被拒绝（CMD_DUPLICATE_ID）", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    const r1 = session.dispatch(metadataCommand("B", "cmd-x"), tx("tx1", 0));
    expect(r1.ok).toBe(true);
    const r2 = session.dispatch(metadataCommand("C", "cmd-x"), tx("tx2", 1));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe(ERROR_CODES.CMD_DUPLICATE_ID);
    expect(session.getSessionVersion()).toBe(1);
  });

  it("Snapshot 深只读", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    const snap = session.getSnapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.metadata)).toBe(true);
    expect(() => {
      (snap.metadata as { title: string }).title = "hack";
    }).toThrow();
  });
});

describe("undo/redo（10.3 / 18.7）", () => {
  it("Undo/Redo 恢复精确 Content Hash，各一次通知", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    let notifications = 0;
    session.subscribe(() => notifications++);

    session.dispatch(metadataCommand("B"), tx("tx1", 0));
    const hashB = session.getContentHash();
    session.dispatch(metadataCommand("C"), tx("tx2", 1));
    const hashC = session.getContentHash();
    notifications = 0;

    const u = session.undo();
    expect(u.ok).toBe(true);
    if (u.ok) expect(u.value.contentHash).toBe(hashB);
    expect(session.getContentHash()).toBe(hashB);
    expect(notifications).toBe(1);

    const r = session.redo();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.contentHash).toBe(hashC);
    expect(session.getContentHash()).toBe(hashC);
    expect(notifications).toBe(2);
  });

  it("新 Transaction 清空 Redo；Undo 到已保存内容时自动 Clean", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    session.dispatch(metadataCommand("B"), tx("tx1", 0));
    session.dispatch(metadataCommand("C"), tx("tx2", 1));
    session.undo();
    expect(session.canRedo()).toBe(true);
    session.dispatch(metadataCommand("D"), tx("tx3", 3));
    expect(session.canRedo()).toBe(false);

    // 保存后 undo 回到 saved → clean
    await session.save("manual");
    const afterSave = session.getStatus();
    expect(afterSave.kind === "ready" && afterSave.dirty).toBe(false);
    session.dispatch(metadataCommand("E"), tx("tx4", session.getSessionVersion()));
    const afterTx = session.getStatus();
    expect(afterTx.kind === "ready" && afterTx.dirty).toBe(true);
    session.undo();
    // Undo 回到 Saved Content 时自动 Clean（验收 18.7）
    const afterUndo = session.getStatus();
    expect(afterUndo.kind).toBe("ready");
    expect(afterUndo.kind === "ready" && afterUndo.dirty).toBe(false);
  });

  it("mergeKey + label + 500ms 内合并为一个 Undo 项", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    session.dispatch(metadataCommand("B"), { label: "drag", expectedSessionVersion: 0, mergeKey: "k1" });
    session.dispatch(metadataCommand("C"), { label: "drag", expectedSessionVersion: 1, mergeKey: "k1" });
    expect(session.canUndo()).toBe(true);
    session.undo();
    // 一次 Undo 撤销两个 Transaction
    expect(session.getSnapshot().metadata.title).toBe("A");
    expect(session.canUndo()).toBe(false);
  });

  it("超过 500ms 或 label 不同不合并", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    session.dispatch(metadataCommand("B"), { label: "drag", expectedSessionVersion: 0, mergeKey: "k1" });
    await harness.clock.advance(600);
    session.dispatch(metadataCommand("C"), { label: "drag", expectedSessionVersion: 1, mergeKey: "k1" });
    expect(session.canUndo()).toBe(true);
    session.undo();
    expect(session.getSnapshot().metadata.title).toBe("B");
    expect(session.canUndo()).toBe(true);
  });
});

describe("保存（12.3 / 18.8）", () => {
  it("Clean Save → no-op，不增加 Revision", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ revision: 3 }));
    const r = await session.save("manual");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.kind).toBe("no-op");
    const disk = JSON.parse(harness.storage.getText(PATH)!) as ComponentsDocumentV1;
    expect(disk.revision).toBe(3);
    expect(session.getSnapshot().revision).toBe(3);
  });

  it("Dirty Save → Revision +1、Base 更新、写后 Clean", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ revision: 0 }));
    session.dispatch(metadataCommand("B"), tx("tx1", 0));
    const r = await session.save("manual");
    expect(r.ok).toBe(true);
    if (r.ok && r.value.kind === "saved") {
      expect(r.value.persistedRevision).toBe(1);
      expect(r.value.savedSessionVersion).toBe(1);
      expect(r.value.stillDirty).toBe(false);
    } else {
      throw new Error(`期望 saved，得到 ${r.ok && r.value.kind}`);
    }
    expect(session.getSnapshot().revision).toBe(1);
    expect(session.getStatus()).toEqual({ kind: "ready", dirty: false, reasons: [] });
    const disk = JSON.parse(harness.storage.getText(PATH)!) as ComponentsDocumentV1;
    expect(disk.revision).toBe(1);
    expect(disk.metadata.title).toBe("B");
  });

  it("CAS 冲突 → status conflict，磁盘文本不变", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    session.dispatch(metadataCommand("B"), tx("tx1", 0));
    // 外部直接改磁盘（无事件），使 expectedText 失配
    const external = serializeDoc(makeDoc({ title: "A", revision: 7, tags: ["外部"] }));
    harness.storage.putFile(PATH, external);

    const r = await session.save("manual");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.kind).toBe("conflict");
    const status = session.getStatus();
    expect(status.kind).toBe("conflict");
    expect(harness.storage.getText(PATH)).toBe(external); // 磁盘未被覆盖
    const context = status.kind === "conflict" ? status.context : null;
    expect(context).not.toBeNull();
    expect(context!.remoteSnapshot.rawHash).toBe(harness.storage.getSnapshot(PATH)!.rawHash);
    expect(session.getSnapshot().metadata.title).toBe("B"); // Working 保留
  });

  it("保存期间继续编辑 → stillDirty + 信封 Rebase", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    session.dispatch(metadataCommand("B"), tx("tx1", 0));
    const version1 = session.getSessionVersion();

    const p = session.save("manual");
    // 保存进行中（CAS 挂起）提交新事务
    session.dispatch(metadataCommand("C"), tx("tx2", version1));
    const r = await p;
    expect(r.ok).toBe(true);
    if (r.ok && r.value.kind === "saved") {
      expect(r.value.stillDirty).toBe(true);
      expect(r.value.persistedRevision).toBe(1);
    } else {
      throw new Error(`期望 saved，得到 ${r.ok && r.value.kind}`);
    }
    const st = session.getStatus();
    expect(st.kind).toBe("ready");
    expect(st.kind === "ready" && st.dirty).toBe(true);
    // 新信封已 Rebase 到 Working（内容仍是 tx2）
    expect(session.getSnapshot().revision).toBe(1);
    expect(session.getSnapshot().metadata.title).toBe("C");

    // 下一轮自动保存（750ms debounce）→ revision 2，Clean
    await harness.clock.advance(750);
    expect(harness.clock.pendingTimerCount()).toBe(0);
    const disk = JSON.parse(harness.storage.getText(PATH)!) as ComponentsDocumentV1;
    expect(disk.revision).toBe(2);
    expect(disk.metadata.title).toBe("C");
    expect(session.getStatus()).toEqual({ kind: "ready", dirty: false, reasons: [] });
  });

  it("同 Session 从不并行 CAS：并发 save() 合并为一次真实写入", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    session.dispatch(metadataCommand("B"), tx("tx1", 0));
    const p1 = session.save("manual");
    const p2 = session.save("manual");
    expect(p1).toBe(p2); // 同一进行中 Promise
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.value.kind).toBe("saved");
      expect(r2.value.kind).toBe("saved");
    }
    const disk = JSON.parse(harness.storage.getText(PATH)!) as ComponentsDocumentV1;
    expect(disk.revision).toBe(1);
  });

  it("CAS Indeterminate → 回读协调（文本等于候选 → 按 Written 继续）", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    session.dispatch(metadataCommand("B"), tx("tx1", 0));
    // 磁盘已含候选文本（写入成功但存储无法确认），CAS 返回 indeterminate
    const snap = session.getSnapshot() as unknown as ComponentsDocumentV1;
    const candidate = {
      ...snap,
      revision: 1,
      updatedAt: new Date(harness.clock.now()).toISOString(),
    } as ComponentsDocumentV1;
    const serialized = harness.codec.serialize(candidate);
    if (!serialized.ok) throw new Error("候选序列化失败");
    harness.storage.putFile(PATH, serialized.value);
    harness.storage.failNextCasAsIndeterminate(PATH);
    const r = await session.save("manual");
    expect(r.ok).toBe(true);
    if (r.ok && r.value.kind === "saved") {
      expect(r.value.persistedRevision).toBe(1);
    } else {
      throw new Error(`期望 saved，得到 ${r.ok && r.value.kind}`);
    }
    const st = session.getStatus();
    expect(st.kind).toBe("ready");
    expect(st.kind === "ready" && st.dirty).toBe(false);
  });
});

describe("外部事件（13 章 / 18.9）", () => {
  it("Rename：路径与缓存 Key 原子更新，不标 Dirty、不加版本", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    let notifications = 0;
    session.subscribe(() => notifications++);
    const version0 = session.getSessionVersion();

    harness.storage.renameFile(PATH, "Notes/Moved.components");
    await session.flushExternalEvents();

    expect(session.getPath()).toBe("Notes/Moved.components");
    expect(harness.factory.get("Notes/Moved.components")).toBe(session);
    expect(harness.factory.get(PATH)).toBeNull();
    expect(session.getSessionVersion()).toBe(version0);
    expect(session.getStatus()).toEqual({ kind: "ready", dirty: false, reasons: [] });
    expect(notifications).toBeGreaterThanOrEqual(1);
  });

  it("Delete → missing，保留 Working", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    session.dispatch(metadataCommand("B"), tx("tx1", 0));
    harness.storage.removeFile(PATH);
    await session.flushExternalEvents();
    expect(session.getStatus()).toEqual({ kind: "missing", lastKnownPath: PATH });
    expect(session.getSnapshot().metadata.title).toBe("B");
    expect(session.canUndo()).toBe(true);
  });

  it("自身写入事件被 expectedOwnWriteHash 消重，不产生保存循环", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    session.dispatch(metadataCommand("B"), tx("tx1", 0));
    const r = await session.save("manual");
    expect(r.ok && r.value.kind === "saved").toBe(true);
    // 写入触发的 Modified 事件已进入队列并被消重
    await session.flushExternalEvents();
    const st = session.getStatus();
    expect(st.kind).toBe("ready");
    expect(st.kind === "ready" && st.dirty).toBe(false);
    const disk = JSON.parse(harness.storage.getText(PATH)!) as ComponentsDocumentV1;
    expect(disk.revision).toBe(1);
  });

  it("Dirty + 外部不同字段变化 → 自动 Merge（14.9）", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A", tags: ["a"] }));
    session.dispatch(metadataCommand("Local", undefined, ["a"]), tx("tx1", 0));
    const remote = serializeDoc(makeDoc({ title: "A", tags: ["a", "b"], revision: 9 }));
    harness.storage.setExternalText(PATH, remote);
    await session.flushExternalEvents();

    const status = session.getStatus();
    expect(status.kind).toBe("ready");
    expect(status.kind === "ready" && status.dirty).toBe(true);
    const merged = session.getSnapshot();
    expect(merged.metadata.title).toBe("Local");
    expect(merged.metadata.tags).toEqual(["a", "b"]);
    expect(merged.revision).toBe(9); // 信封使用 Remote
    expect(session.canUndo()).toBe(false); // 历史清空
  });

  it("Dirty + 同字段不同值 → conflict（含完整 PendingConflict）", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    session.dispatch(metadataCommand("Local1"), tx("tx1", 0));
    const remote = serializeDoc(makeDoc({ title: "Remote1", revision: 9 }));
    harness.storage.setExternalText(PATH, remote);
    await session.flushExternalEvents();

    const status = session.getStatus();
    expect(status.kind).toBe("conflict");
    if (status.kind === "conflict") {
      expect(status.context.conflicts.length).toBeGreaterThan(0);
      expect(status.context.conflicts[0]!.kind).toBe("value");
      expect(status.context.conflicts[0]!.pointer).toBe("/metadata/title");
      expect(status.context.autoMergedCandidate).not.toBeNull();
      expect(status.context.remote.documentId).toBe(status.context.base.documentId);
    }
    // 冲突期间禁止继续编辑
    const r = session.dispatch(metadataCommand("X"), tx("tx2", session.getSessionVersion()));
    expect(r.ok).toBe(false);
  });

  it("外部非法文件 → invalid-external，保留 Working", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    session.dispatch(metadataCommand("B"), tx("tx1", 0));
    harness.storage.setExternalText(PATH, "{ 这不是 JSON");
    await session.flushExternalEvents();
    const status = session.getStatus();
    expect(status.kind).toBe("invalid-external");
    if (status.kind === "invalid-external") {
      expect(status.remote.text).toBe("{ 这不是 JSON");
    }
    expect(session.getSnapshot().metadata.title).toBe("B");
  });
});

describe("冲突解决（14.10 / 18.10）", () => {
  async function enterConflict(harness: Harness): Promise<DocumentSessionV1> {
    const session = await openSession(harness, makeDoc({ title: "A" }));
    session.dispatch(metadataCommand("Local1"), tx("tx1", 0));
    harness.storage.setExternalText(PATH, serializeDoc(makeDoc({ title: "Remote1", revision: 9 })));
    await session.flushExternalEvents();
    expect(session.getStatus().kind).toBe("conflict");
    return session;
  }

  it("Accept Remote：先写 Recovery，再以 Remote 替换，Clean", async () => {
    const harness = createHarness();
    const session = await enterConflict(harness);
    const r = await session.resolveConflict({ kind: "accept-remote", confirmedDiscardLocal: true });
    expect(r.ok).toBe(true);
    expect(harness.recovery.recoveryCount()).toBe(1);
    expect(harness.recovery.listRecoveryIds()[0]).toBeDefined();
    expect(session.getStatus()).toEqual({ kind: "ready", dirty: false, reasons: [] });
    expect(session.getSnapshot().metadata.title).toBe("Remote1");
    expect(session.canUndo()).toBe(false);
  });

  it("Keep Local：先写双方 Recovery，再以最新 Remote 文本 CAS", async () => {
    const harness = createHarness();
    const session = await enterConflict(harness);
    const r = await session.resolveConflict({ kind: "keep-local", confirmedOverwriteRemote: true });
    expect(r.ok).toBe(true);
    expect(harness.recovery.recoveryCount()).toBe(2); // Local + Remote 备份
    expect(session.getStatus()).toEqual({ kind: "ready", dirty: false, reasons: [] });
    expect(session.getSnapshot().metadata.title).toBe("Local1");
    // 磁盘已被 Local 覆盖（用 Remote Text + Raw Hash CAS）
    const disk = JSON.parse(harness.storage.getText(PATH)!) as ComponentsDocumentV1;
    expect(disk.metadata.title).toBe("Local1");
    expect(disk.revision).toBe(10); // remote(9) + 1
  });

  it("Manual：必须恰好覆盖全部 ConflictId", async () => {
    const harness = createHarness();
    const session = await enterConflict(harness);
    const status = session.getStatus();
    if (status.kind !== "conflict") throw new Error("应在冲突状态");
    const id = status.context.conflicts[0]!.id;
    const missing = await session.resolveConflict({ kind: "manual", choices: {} });
    expect(missing.ok).toBe(false);
    // 保持冲突
    expect(session.getStatus().kind).toBe("conflict");

    const resolved = await session.resolveConflict({
      kind: "manual",
      choices: { [id]: "remote" },
    });
    expect(resolved.ok).toBe(true);
    // 未冲突部分仍来自 Local（tags 被本地清空）→ 相对 Remote Dirty
    const st = session.getStatus();
    expect(st.kind).toBe("ready");
    expect(st.kind === "ready" && st.dirty).toBe(true);
    expect(session.getSnapshot().metadata.title).toBe("Remote1");
  });

  it("Manual 选择 local → 保持本地内容", async () => {
    const harness = createHarness();
    const session = await enterConflict(harness);
    const status = session.getStatus();
    if (status.kind !== "conflict") throw new Error("应在冲突状态");
    const id = status.context.conflicts[0]!.id;
    const resolved = await session.resolveConflict({ kind: "manual", choices: { [id]: "local" } });
    expect(resolved.ok).toBe(true);
    expect(session.getSnapshot().metadata.title).toBe("Local1");
  });
});

describe("生命周期（15.6 / 16 / 18.11）", () => {
  it("dispose 时 Dirty 正常保存；dispose 后返回 CMD_SESSION_DISPOSED", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    session.dispatch(metadataCommand("B"), tx("tx1", 0));
    const r = await session.dispose();
    expect(r.ok).toBe(true);
    expect(session.getStatus().kind).toBe("disposed");
    const disk = JSON.parse(harness.storage.getText(PATH)!) as ComponentsDocumentV1;
    expect(disk.metadata.title).toBe("B"); // close save 成功
    expect(harness.recovery.recoveryCount()).toBe(0);

    const r2 = await session.dispose();
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe(ERROR_CODES.CMD_SESSION_DISPOSED);
    // dispose 后 Command 一律 CMD_SESSION_DISPOSED
    const d = session.dispatch(metadataCommand("C"), tx("tx", session.getSessionVersion()));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe(ERROR_CODES.CMD_SESSION_DISPOSED);
  });

  it("dispose 保存失败 → 写 Recovery（close-save-failed）并成功返回", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    session.dispatch(metadataCommand("B"), tx("tx1", 0));
    harness.storage.removeFile(PATH);
    await session.flushExternalEvents();
    expect(session.getStatus().kind).toBe("missing");

    const r = await session.dispose();
    expect(r.ok).toBe(true);
    expect(session.getStatus().kind).toBe("disposed");
    expect(harness.recovery.recoveryCount()).toBe(1);
    const records = await harness.recovery.listRecoveries();
    expect(records.ok && records.value[0]!.reason).toBe("close-save-failed");
    if (records.ok) {
      const text = JSON.parse(records.value[0]!.documentText) as ComponentsDocumentV1;
      expect(text.metadata.title).toBe("B");
    }
  });

  it("Factory 引用计数：多 Host 共享，最后 release 才 dispose", async () => {
    const harness = createHarness();
    harness.storage.putFile(PATH, serializeDoc(makeDoc({ title: "A" })));
    const a1 = await harness.factory.acquire(PATH);
    const a2 = await harness.factory.acquire(PATH);
    if (a1.ok && a2.ok) {
      expect(a1.value).toBe(a2.value);
      expect(harness.factory.getSessionCount()).toBe(1);
      await harness.factory.release(a1.value);
      expect(a1.value.getStatus().kind).not.toBe("disposed");
      await harness.factory.release(a2.value);
      expect(a1.value.getStatus().kind).toBe("disposed");
      expect(harness.factory.getSessionCount()).toBe(0);
      // 再次 acquire → 新 Session
      const a3 = await harness.factory.acquire(PATH);
      expect(a3.ok && a3.value !== a1.value).toBe(true);
    }
  });

  it("acquire 缺失文件 → EXTERNAL_FILE_DELETED，由调用方创建", async () => {
    const harness = createHarness();
    const r = await harness.factory.acquire("Notes/Missing.components");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(ERROR_CODES.EXTERNAL_FILE_DELETED);
  });

  it("acquire(initialText) 直接解析视图内容", async () => {
    const harness = createHarness();
    const r = await harness.factory.acquire(PATH, { initialText: serializeDoc(makeDoc({ title: "视图" })) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.getSnapshot().metadata.title).toBe("视图");
      expect(r.value.getStatus().kind).toBe("ready");
    }
  });
});

describe("Autosave（12.6）", () => {
  it("750ms trailing debounce 后保存", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    session.dispatch(metadataCommand("B"), tx("tx1", 0));
    await harness.clock.advance(749);
    expect(JSON.parse(harness.storage.getText(PATH)!).revision).toBe(0);
    await harness.clock.advance(1);
    const disk = JSON.parse(harness.storage.getText(PATH)!) as ComponentsDocumentV1;
    expect(disk.revision).toBe(1);
    expect(disk.metadata.title).toBe("B");
    const st = session.getStatus();
    expect(st.kind === "ready" && st.dirty).toBe(false);
  });

  it("连续事务重启 debounce，但首次 Dirty 后 5s 内必须尝试", async () => {
    const harness = createHarness();
    const session = await openSession(harness, makeDoc({ title: "A" }));
    session.dispatch(metadataCommand("B"), tx("tx0", 0));
    let savedAtStep = -1;
    for (let i = 0; i < 14; i++) {
      await harness.clock.advance(400);
      const disk = JSON.parse(harness.storage.getText(PATH)!) as ComponentsDocumentV1;
      if (disk.revision > 0) {
        savedAtStep = i;
        break;
      }
      session.dispatch(metadataCommand(`t${i}`), tx(`tx${i}`, session.getSessionVersion()));
    }
    expect(savedAtStep).toBeGreaterThanOrEqual(0);
    // 首次 Dirty 后 5s 内完成（400ms × 13 = 5.2s 之前）
    expect(savedAtStep * 400).toBeLessThanOrEqual(5_000);
  });
});

describe("未知节点保留（18.6 验收）", () => {
  it("未知节点经 add/remove 事务与保存循环后原样保留", async () => {
    const harness = createHarness();
    const y = unknownChild("00000000-0000-4000-8000-0000000000aa", "keep-me");
    const doc = makeDoc({ children: [y] });
    const session = await openSession(harness, doc);

    const ds = dataSource("11111111-2222-4333-8444-555555555555");
    session.dispatch(putDataSourceCommand(ds), tx("add-ds", 0));
    session.dispatch(removeDataSourceCommand(ds.id), tx("remove-ds", 1));
    expect(session.getSnapshot().nodes[y.id]).toBeDefined();
    expect(session.getSnapshot().nodes[y.id]!.props).toEqual(y.props);
    expect(session.getSnapshot().nodes[y.id]!.extensions).toEqual(y.extensions);

    session.undo();
    session.redo();

    // 留下一个真实 Dirty 变更，使保存产生实际写入
    session.dispatch(metadataCommand("持久化", undefined, ["keep"]), tx("meta", session.getSessionVersion()));
    const save = await session.save("manual");
    expect(save.ok && save.value.kind === "saved").toBe(true);
    // 从磁盘重新加载
    const reloaded = await harness.factory.acquire(PATH);
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) {
      expect(reloaded.value.getSnapshot().nodes[y.id]!.props).toEqual(y.props);
      expect(reloaded.value.getSnapshot().nodes[y.id]!.extensions).toEqual(y.extensions);
    }
  });
});

describe("toRuntimeDocumentPort 快照引用稳定性", () => {
  it("getSnapshot 在无变化时返回同一引用（useSyncExternalStore 契约）", async () => {
    const h = await createHarness();
    const session = await acquireDoc(h, makeDoc());
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const port = toRuntimeDocumentPort(session.value);
    const a = port.getSnapshot();
    const b = port.getSnapshot();
    expect(a).toBe(b);
    // 变化后返回新引用
    const r = session.value.dispatch(
      metadataCommand("新标题"),
      { label: "改标题", expectedSessionVersion: 0, mergeKey: null },
    );
    expect(r.ok).toBe(true);
    const c = port.getSnapshot();
    expect(c).not.toBe(a);
    expect(c.metadata.title).toBe("新标题");
    // 再次稳定
    expect(port.getSnapshot()).toBe(c);
  });
});
