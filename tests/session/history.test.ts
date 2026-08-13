/**
 * 历史栈测试（文档协议 10.3 / 验收 18.7 部分）。
 */
import { describe, expect, it } from "vitest";
import {
  HISTORY_MAX_ITEMS,
  HISTORY_MAX_BYTES,
  HistoryStack,
  type HistoryEntry,
} from "../../src/session/history";
import { makeDoc } from "./helpers";

function entry(
  revision: number,
  opts: {
    label?: string;
    mergeKey?: string | null;
    atMs?: number;
    bytes?: number;
  } = {},
): HistoryEntry {
  const doc = makeDoc({ revision, title: `r${revision}` });
  return {
    document: doc,
    contentHash: `hash-${revision}`,
    sessionVersion: revision,
    label: opts.label ?? "tx",
    mergeKey: opts.mergeKey ?? null,
    atMs: opts.atMs ?? 1_000_000 + revision * 100,
    bytes: opts.bytes ?? 1_000,
  };
}

describe("HistoryStack.push", () => {
  it("顺序压入并可从栈顶弹出撤销目标", () => {
    const h = new HistoryStack();
    h.push(entry(0), { mayMerge: false });
    h.push(entry(1), { mayMerge: false });
    expect(h.canUndo).toBe(true);
    expect(h.undoTop?.contentHash).toBe("hash-1");
    expect(h.undoCount).toBe(2);
  });

  it("相同非空 mergeKey + label + 500ms 内合并为单条", () => {
    const h = new HistoryStack();
    const base = 1_000_000;
    h.push(entry(0, { label: "drag", mergeKey: "k1", atMs: base }), { mayMerge: true });
    h.push(entry(1, { label: "drag", mergeKey: "k1", atMs: base + 300 }), { mayMerge: true });
    expect(h.undoCount).toBe(1);
    // 合并后 Undo 恢复较早（事务前）状态
    expect(h.undoTop?.contentHash).toBe("hash-0");
  });

  it("label 不同不合并", () => {
    const h = new HistoryStack();
    h.push(entry(0, { label: "a", mergeKey: "k" }), { mayMerge: true });
    h.push(entry(1, { label: "b", mergeKey: "k" }), { mayMerge: true });
    expect(h.undoCount).toBe(2);
  });

  it("mergeKey 为空不合并", () => {
    const h = new HistoryStack();
    h.push(entry(0, { label: "a", mergeKey: null }), { mayMerge: true });
    h.push(entry(1, { label: "a", mergeKey: null }), { mayMerge: true });
    expect(h.undoCount).toBe(2);
  });

  it("超过 500ms 不合并", () => {
    const h = new HistoryStack();
    const base = 1_000_000;
    h.push(entry(0, { label: "a", mergeKey: "k", atMs: base }), { mayMerge: true });
    h.push(entry(1, { label: "a", mergeKey: "k", atMs: base + 501 }), { mayMerge: true });
    expect(h.undoCount).toBe(2);
  });

  it("mayMerge=false（中间有 Save/Undo/外部事件）不合并", () => {
    const h = new HistoryStack();
    h.push(entry(0, { label: "a", mergeKey: "k" }), { mayMerge: true });
    h.push(entry(1, { label: "a", mergeKey: "k" }), { mayMerge: false });
    expect(h.undoCount).toBe(2);
  });
});

describe("HistoryStack.undo/redo", () => {
  it("Undo 把当前状态压入 Redo；Redo 恢复相同 Content Hash", () => {
    const h = new HistoryStack();
    h.push(entry(0), { mayMerge: false });
    h.push(entry(1), { mayMerge: false });

    const undone = h.popUndoPushRedo(entry(2));
    expect(undone?.contentHash).toBe("hash-1");
    expect(h.canRedo).toBe(true);
    expect(h.redoTop?.contentHash).toBe("hash-2");

    const redone = h.popRedoPushUndo(entry(3));
    expect(redone?.contentHash).toBe("hash-2");
    expect(h.canRedo).toBe(false);
    expect(h.undoTop?.contentHash).toBe("hash-3");
  });

  it("新 Transaction 清空 Redo（Session 侧调用 clear 语义由 pop 后不再产生）", () => {
    const h = new HistoryStack();
    h.push(entry(0), { mayMerge: false });
    h.popUndoPushRedo(entry(1));
    expect(h.canRedo).toBe(true);
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it("数量超限从最旧项淘汰", () => {
    const h = new HistoryStack();
    for (let i = 0; i < HISTORY_MAX_ITEMS + 10; i++) {
      h.push(entry(i), { mayMerge: false });
    }
    expect(h.undoCount).toBe(HISTORY_MAX_ITEMS);
    // 最旧 10 条被淘汰，栈顶保留最新
    expect(h.undoTop?.contentHash).toBe(`hash-${HISTORY_MAX_ITEMS + 9}`);
  });

  it("字节超限从最旧项淘汰", () => {
    const h = new HistoryStack();
    const bigBytes = Math.floor(HISTORY_MAX_BYTES / 3) + 1;
    for (let i = 0; i < 4; i++) {
      h.push(entry(i, { bytes: bigBytes }), { mayMerge: false });
    }
    // 4 × (MAX/3 + 1) > MAX → 至少淘汰 1 条
    expect(h.undoCount).toBeLessThanOrEqual(3);
    expect(h.undoCount).toBeGreaterThan(0);
  });
});
