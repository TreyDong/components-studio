/**
 * DataSourceStore（Phase 0 seam，见《数据索引与查询协议 v1》第 9、16 章）。
 *
 * 实现 DataSourceStore 接口，但只维护 per-id 的 idle/loading 快照，
 * ensureStarted/refresh 为 no-op。Phase 2 由真实 Query Store 替换
 * （Worker 去重、缓存、取消、订阅推送）。
 */
import type {
  DataSourceId,
  ProtocolError,
  Result,
} from "@ocs/contracts";
import type {
  DataSourceStore as DataSourceStorePort,
  QueryHookSnapshot,
} from "./query-types";

const IDLE_SNAPSHOT: QueryHookSnapshot = Object.freeze({
  status: "idle",
  data: null,
  isStale: false,
  error: null,
});

const LOADING_SNAPSHOT: QueryHookSnapshot = Object.freeze({
  status: "loading",
  data: null,
  isStale: false,
  error: null,
});

export class DataSourceStore implements DataSourceStorePort {
  private readonly snapshots = new Map<DataSourceId, QueryHookSnapshot>();
  private readonly listeners = new Map<DataSourceId, Set<() => void>>();
  private disposed = false;

  getSnapshot(id: DataSourceId): QueryHookSnapshot {
    return this.snapshots.get(id) ?? IDLE_SNAPSHOT;
  }

  subscribe(id: DataSourceId, listener: () => void): () => void {
    if (this.disposed) {
      return () => {};
    }
    let set = this.listeners.get(id);
    if (!set) {
      set = new Set();
      this.listeners.set(id, set);
    }
    set.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      set!.delete(listener);
    };
  }

  ensureStarted(id: DataSourceId): Result<void> {
    if (this.disposed) {
      return { ok: false, error: this.disposedError() };
    }
    this.snapshots.set(id, LOADING_SNAPSHOT);
    this.notify(id);
    return { ok: true, value: undefined };
  }

  async refresh(_id: DataSourceId): Promise<Result<void>> {
    if (this.disposed) {
      return { ok: false, error: this.disposedError() };
    }
    // Phase 0：无实际刷新；Phase 2 触发 Query Store 重跑。
    return { ok: true, value: undefined };
  }

  dispose(): void {
    this.disposed = true;
    this.snapshots.clear();
    this.listeners.clear();
  }

  private notify(id: DataSourceId): void {
    const set = this.listeners.get(id);
    if (!set) return;
    for (const listener of Array.from(set)) {
      listener();
    }
  }

  private disposedError(): ProtocolError {
    return {
      code: "DATASOURCE_NOT_FOUND",
      message: "DataSourceStore 已 dispose",
      scope: "data-source",
      recoverable: false,
      retryable: false,
    };
  }
}
