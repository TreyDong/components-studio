/**
 * Runtime React Context（《运行时与 SDK 协议 v1》第 3 章）。
 * 提供服务上下文、每节点 scoped ComponentRuntimeApi 上下文、状态机上下文
 * 与可见性上下文；`useRuntime()` 返回 scoped ComponentRuntimeApi。
 */
import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import type {
  ComponentRuntimeApi,
  DocumentSnapshot,
  HostSnapshot,
  NodeVisibilityPort,
  RuntimeMode,
  RuntimeServices,
  RuntimeState,
} from "./types";

export const RuntimeServicesContext = createContext<RuntimeServices | null>(null);
export const ComponentRuntimeApiContext = createContext<ComponentRuntimeApi | null>(null);
export const RuntimeStateContext = createContext<RuntimeState>({ phase: "booting" });
export const RuntimeModeContext = createContext<RuntimeMode>("view");
export const NodeVisibilityContext = createContext<NodeVisibilityPort | null>(null);
/** 祖先链上的 effectiveVisible（NodeRenderer 向下传播）。 */
export const AncestorVisibilityContext = createContext<boolean>(true);

/**
 * 返回当前节点的 scoped ComponentRuntimeApi。
 * 只能在 Renderer（或 Renderer 的子孙 hook）内调用。
 */
export function useRuntime(): ComponentRuntimeApi {
  const api = useContext(ComponentRuntimeApiContext);
  if (api === null) {
    throw new Error("useRuntime 必须在组件 Renderer 内调用");
  }
  return api;
}

export function useRuntimeServices(): RuntimeServices {
  const services = useContext(RuntimeServicesContext);
  if (services === null) {
    throw new Error("useRuntimeServices 必须在 RuntimeRoot 内调用");
  }
  return services;
}

export function useRuntimeState(): RuntimeState {
  return useContext(RuntimeStateContext);
}

/** 当前 RuntimeMode（view/edit/preview/embedded/thumbnail）。 */
export function useRuntimeMode(): RuntimeMode {
  return useContext(RuntimeModeContext);
}

/** 读取当前节点的 NodeVisibilityPort（同 props.visibility）。 */
export function useNodeVisibility(): NodeVisibilityPort {
  const port = useContext(NodeVisibilityContext);
  if (port === null) {
    throw new Error("useNodeVisibility 必须在组件 Renderer 内调用");
  }
  return port;
}

/** 文档快照（useSyncExternalStore 订阅 RuntimeDocumentPort）。 */
export function useDocumentSnapshot(): DocumentSnapshot {
  const services = useRuntimeServices();
  const subscribe = useCallback(
    (listener: () => void) => services.document.subscribe(listener),
    [services.document],
  );
  const getSnapshot = useCallback(() => services.document.getSnapshot(), [services.document]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Host 快照（useSyncExternalStore 订阅 RuntimeHostStore）。 */
export function useHostSnapshot(): HostSnapshot {
  const services = useRuntimeServices();
  // 包装方法引用：useSyncExternalStore 要求 subscribe/getSnapshot 是稳定函数
  // 且不依赖 this 绑定（宿主实现可能是 class 方法）。
  const subscribe = useCallback(
    (listener: () => void) => services.host.subscribe(listener),
    [services.host],
  );
  const getSnapshot = useCallback(() => services.host.getSnapshot(), [services.host]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
