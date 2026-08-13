/**
 * HostStateStore（《运行时与 SDK 协议 v1》第 3.2 节）。
 *
 * 保存不进入 `.components` 的会话状态，键必须带组件 ID，例如
 * `component/<id>/active-tab`。不同 View/Embed 的 HostState 不共享；
 * 同一 Host 重渲染时保留，Host dispose 后删除。
 */
import type { HostStateStore as HostStateStorePort, HostStateValue } from "./types";

export class HostStateStore implements HostStateStorePort {
  private readonly values = new Map<string, HostStateValue>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private disposed = false;

  get<T extends HostStateValue>(key: string, fallback: T): T {
    if (this.disposed || !this.values.has(key)) {
      return fallback;
    }
    return this.values.get(key) as T;
  }

  set<T extends HostStateValue>(key: string, value: T): void {
    if (this.disposed) return;
    this.values.set(key, value);
    this.notify(key);
  }

  remove(key: string): void {
    if (this.disposed) return;
    if (this.values.delete(key)) {
      this.notify(key);
    }
  }

  subscribe(key: string, listener: () => void): () => void {
    if (this.disposed) {
      return () => {};
    }
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      set!.delete(listener);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.values.clear();
    this.listeners.clear();
  }

  private notify(key: string): void {
    const set = this.listeners.get(key);
    if (!set) return;
    // 快照拷贝：监听器内 remove 自身不会导致遍历跳变。
    for (const listener of Array.from(set)) {
      listener();
    }
  }
}
