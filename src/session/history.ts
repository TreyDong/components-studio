/**
 * Undo/Redo 历史栈（《文档与会话协议 v1》第 10.3 节）。
 *
 * - 一个成功 Transaction 对应一个 Undo 项；Undo/Redo 各自维护对侧栈。
 * - 合并规则：两个 Transaction 满足「非空 mergeKey 相同 + label 相同 +
 *   可信 Session Clock 间隔 <= 500ms + 中间无其他操作」时，新条目被丢弃，
 *   较早条目的撤销目标（事务前状态）保持不变。
 * - 上限：最多 100 项或 20 MiB（字节按条目记录，由 Session 提供），
 *   任一先达到即从最旧项淘汰。
 */

import type { ComponentsDocumentV1, DeepReadonly } from "@ocs/contracts";

/** 一条历史条目：`document` 是事务前的完整工作快照。 */
export interface HistoryEntry {
  readonly document: DeepReadonly<ComponentsDocumentV1>;
  readonly contentHash: string;
  /** 该快照对应的 Session Version（仅用于诊断；Undo 不恢复版本号）。 */
  readonly sessionVersion: number;
  readonly label: string;
  readonly mergeKey: string | null;
  /** 可信 Session Clock 时间戳（毫秒）。 */
  readonly atMs: number;
  /** 估算内存字节数（调用方提供，用于 20 MiB 上限）。 */
  readonly bytes: number;
}

export interface PushOptions {
  /**
   * 是否允许与上一条目合并。由 Session 保证中间没有
   * Transaction、Undo、Redo、Save 或外部事件。
   */
  readonly mayMerge: boolean;
}

export const HISTORY_MAX_ITEMS = 100;
export const HISTORY_MAX_BYTES = 20 * 1024 * 1024;
export const HISTORY_MERGE_WINDOW_MS = 500;

export class HistoryStack {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private undoBytes = 0;

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoCount(): number {
    return this.undoStack.length;
  }

  get redoCount(): number {
    return this.redoStack.length;
  }

  get undoTop(): HistoryEntry | null {
    return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1]! : null;
  }

  get redoTop(): HistoryEntry | null {
    return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1]! : null;
  }

  /**
   * 压入一条新条目。若满足合并条件则丢弃新条目（返回 true），
   * 否则追加并淘汰超限的最旧条目（返回 false）。
   */
  push(entry: HistoryEntry, options: PushOptions): boolean {
    const last = this.undoTop;
    if (
      options.mayMerge &&
      last !== null &&
      entry.mergeKey !== null &&
      last.mergeKey === entry.mergeKey &&
      last.label === entry.label &&
      entry.atMs - last.atMs <= HISTORY_MERGE_WINDOW_MS
    ) {
      return true;
    }
    this.undoStack.push(entry);
    this.undoBytes += entry.bytes;
    this.evict();
    return false;
  }

  /** 弹出撤销栈顶并把当前状态压入 Redo；无撤销项时返回 null。 */
  popUndoPushRedo(current: HistoryEntry): HistoryEntry | null {
    const popped = this.undoStack.pop();
    if (!popped) return null;
    this.undoBytes -= popped.bytes;
    this.redoStack.push(current);
    return popped;
  }

  /** 弹出 Redo 栈顶并把当前状态压入 Undo；无 Redo 项时返回 null。 */
  popRedoPushUndo(current: HistoryEntry): HistoryEntry | null {
    const popped = this.redoStack.pop();
    if (!popped) return null;
    this.undoStack.push(current);
    this.undoBytes += current.bytes;
    this.evict();
    return popped;
  }

  /** 清空 Redo（新 Transaction 提交时调用，10.3）。 */
  clearRedo(): void {
    this.redoStack = [];
  }

  /** 清空全部历史（外部 Reload / 自动 Merge / Conflict Resolution 后调用）。 */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.undoBytes = 0;
  }

  private evict(): void {
    while (
      (this.undoStack.length > HISTORY_MAX_ITEMS || this.undoBytes > HISTORY_MAX_BYTES) &&
      this.undoStack.length > 0
    ) {
      const oldest = this.undoStack.shift();
      if (!oldest) break;
      this.undoBytes -= oldest.bytes;
    }
  }
}
