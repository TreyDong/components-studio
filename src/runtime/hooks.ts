/**
 * SDK Hooks（《运行时与 SDK 协议 v1》第 3.6 节）。
 *
 * Hooks 只能在 Renderer 内调用（useRuntime/useVisibility/useActionRunner
 * 需要 scoped ComponentRuntimeApi / NodeVisibilityPort 上下文）。
 */
import { useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { DataSourceId, JsonObject } from "@ocs/contracts";
import type { QueryResult, QueryHookState, QueryHookOptions } from "@ocs/contracts/query";
import type { TextFileSnapshot, ThemeSnapshot } from "../platform/ports";
import type {
  ComponentActionApi,
  ContentHookState,
  HostStateStore,
  HostStateValue,
  ResponsiveMode,
  RuntimeMode,
} from "./types";
import { NodeVisibilityContext, useRuntime } from "./RuntimeContext";
import {
  useDataSourceStore,
  useHostStateStore,
  useThemeFromContext,
} from "./Providers";

export { useRuntime } from "./RuntimeContext";

/** 当前主题 + 响应式断点（来自 Host 快照）。 */
export function useTheme(): { theme: ThemeSnapshot; responsiveMode: ResponsiveMode } {
  return useThemeFromContext();
}

/** 当前节点 effectiveVisible（读 NodeVisibilityPort，不只读 Host 可见性）。 */
export function useVisibility(): boolean {
  const port = useContext(NodeVisibilityContext);
  if (port === null) {
    throw new Error("useVisibility 必须在组件 Renderer 内调用");
  }
  return useSyncExternalStore(port.subscribe, port.getSnapshot).effectiveVisible;
}

/** 当前主题是否启用 reduced-motion。 */
export function useReducedMotion(): boolean {
  return useThemeFromContext().theme.reducedMotion;
}

/** HostState 会话状态（键必须带组件 ID；Host dispose 后清除）。 */
export function useHostState<T extends HostStateValue>(
  key: string,
  initial: T,
): readonly [T, (next: T) => void] {
  const store = useHostStateStore();
  const value = useSyncExternalStore(
    useCallback((listener: () => void) => store.subscribe(key, listener), [store, key]),
    useCallback(() => store.get(key, initial), [store, key, initial]),
  );
  const set = useCallback(
    (next: T) => {
      store.set(key, next);
    },
    [store, key],
  );
  return [value, set];
}

/**
 * DataSource → 组件状态（Phase 0 seam）。
 *
 * Phase 2 由真实 Query Store 替换：Worker 去重、缓存、取消与订阅推送，
 * 本实现固定返回 idle 状态，`refresh` 为 no-op。
 */
export function useComponentQuery<T = QueryResult>(
  _dataSourceId: DataSourceId,
  _options?: QueryHookOptions<T>,
): QueryHookState<T> {
  const store = useDataSourceStore();
  void _dataSourceId;
  void _options;
  // Phase 0：返回 idle 快照；Phase 2 改为
  // useSyncExternalStore(store.subscribe(id, …), () => store.getSnapshot(id))。
  const refresh = useCallback(() => {
    void store.refresh(_dataSourceId);
  }, [store, _dataSourceId]);
  const snapshot = { status: "idle" as const, data: null as T | null, isStale: false, error: null, refresh };
  return snapshot;
}

/** 读取 Vault 文本并订阅其变化（vault:read 能力由 CapabilityBroker 决定）。 */
export function useVaultText(
  path: string,
  options?: { readonly enabled?: boolean },
): ContentHookState<TextFileSnapshot> {
  const runtime = useRuntime();
  const enabled = options?.enabled ?? true;
  const [generation, setGeneration] = useState(0);
  const [snapshot, setSnapshot] = useState<ContentHookState<TextFileSnapshot>>({
    status: "idle",
    data: null,
    error: null,
    isStale: false,
    refresh: () => {},
  });

  useEffect(() => {
    if (!enabled) {
      setSnapshot({ status: "idle", data: null, error: null, isStale: false, refresh: () => {} });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setSnapshot((prev) => ({
      status: "loading",
      data: prev.data,
      error: null,
      isStale: prev.data !== null,
      refresh: () => {},
    }));
    void runtime.content.readText(path, { signal: controller.signal }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setSnapshot({ status: "success", data: result.value, error: null, isStale: false, refresh: () => {} });
      } else {
        setSnapshot({ status: "error", data: null, error: result.error, isStale: false, refresh: () => {} });
      }
    });
    const unsubscribe = runtime.content.subscribe(path, () => setGeneration((g) => g + 1));
    return () => {
      cancelled = true;
      controller.abort();
      unsubscribe();
    };
  }, [runtime, path, enabled, generation]);

  const refresh = useCallback(() => {
    setGeneration((g) => g + 1);
  }, []);

  return { ...snapshot, refresh };
}

/** 当前节点 scoped 的 ActionRunner（模式安全由 scoped API 保证）。 */
export function useActionRunner(): ComponentActionApi["run"] {
  return useRuntime().actions.run;
}

export type { HostStateStore, RuntimeMode, JsonObject };
