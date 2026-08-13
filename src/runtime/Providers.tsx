/**
 * Runtime Provider 栈（《运行时与 SDK 协议 v1》第 3.7 节）。
 *
 * RuntimeFatalBoundary → PlatformProvider → CapabilityProvider → ThemeProvider
 * → HostProvider → HostStateProvider → DocumentProvider → QueryProvider →
 * DataSourceProvider → ActionProvider → EventProvider → EditorProvider（仅
 * edit/preview）→ RuntimeCanvas
 */
import { createContext, useCallback, useContext, useMemo } from "react";
import type { JSX, ReactNode } from "react";
import type { PlatformPort, ThemePort } from "../platform/ports";
import type {
  CapabilityBroker,
} from "./capability-types";
import type {
  ActionRunner,
  EventDispatcher,
} from "./action-types";
import type { DataSourceStore, QueryPort } from "./query-types";
import type {
  HostStateStore,
  ResponsiveMode,
  RuntimeDocumentPort,
  RuntimeHostStore,
} from "./types";
import type { ThemeSnapshot } from "../platform/ports";
import { useRuntimeServices } from "./RuntimeContext";
import { useSyncExternalStore } from "react";

export const PlatformContext = createContext<PlatformPort | null>(null);
export const CapabilitiesContext = createContext<CapabilityBroker | null>(null);
export const ThemeContext = createContext<{
  readonly theme: ThemeSnapshot;
  readonly responsiveMode: ResponsiveMode;
} | null>(null);
export const HostContext = createContext<RuntimeHostStore | null>(null);
export const HostStateContext = createContext<HostStateStore | null>(null);
export const DocumentContext = createContext<RuntimeDocumentPort | null>(null);
export const QueryContext = createContext<QueryPort | null>(null);
export const DataSourcesContext = createContext<DataSourceStore | null>(null);
export const ActionsContext = createContext<ActionRunner | null>(null);
export const EventsContext = createContext<EventDispatcher | null>(null);
export const EditorContext = createContext<{ readonly mode: "edit" | "preview" } | null>(null);

export function PlatformProvider(props: { children: ReactNode }): JSX.Element {
  const services = useRuntimeServices();
  return <PlatformContext.Provider value={services.platform}>{props.children}</PlatformContext.Provider>;
}

export function CapabilityProvider(props: { children: ReactNode }): JSX.Element {
  const services = useRuntimeServices();
  return (
    <CapabilitiesContext.Provider value={services.capabilities}>
      {props.children}
    </CapabilitiesContext.Provider>
  );
}

export function ThemeProvider(props: { children: ReactNode }): JSX.Element {
  const services = useRuntimeServices();
  const subscribe = useCallback(
    (listener: () => void) => services.host.subscribe(listener),
    [services.host],
  );
  const getSnapshot = useCallback(() => services.host.getSnapshot(), [services.host]);
  const host = useSyncExternalStore(subscribe, getSnapshot);
  const value = useMemo(
    () => ({ theme: host.theme, responsiveMode: host.responsiveMode }),
    [host.theme, host.responsiveMode],
  );
  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>;
}

export function HostProvider(props: { children: ReactNode }): JSX.Element {
  const services = useRuntimeServices();
  return <HostContext.Provider value={services.host}>{props.children}</HostContext.Provider>;
}

export function HostStateProvider(props: { children: ReactNode }): JSX.Element {
  const services = useRuntimeServices();
  return (
    <HostStateContext.Provider value={services.hostState}>
      {props.children}
    </HostStateContext.Provider>
  );
}

export function DocumentProvider(props: { children: ReactNode }): JSX.Element {
  const services = useRuntimeServices();
  return (
    <DocumentContext.Provider value={services.document}>
      {props.children}
    </DocumentContext.Provider>
  );
}

export function QueryProvider(props: { children: ReactNode }): JSX.Element {
  const services = useRuntimeServices();
  return <QueryContext.Provider value={services.query}>{props.children}</QueryContext.Provider>;
}

export function DataSourceProvider(props: { children: ReactNode }): JSX.Element {
  const services = useRuntimeServices();
  return (
    <DataSourcesContext.Provider value={services.dataSources}>
      {props.children}
    </DataSourcesContext.Provider>
  );
}

export function ActionProvider(props: { children: ReactNode }): JSX.Element {
  const services = useRuntimeServices();
  return (
    <ActionsContext.Provider value={services.actions}>
      {props.children}
    </ActionsContext.Provider>
  );
}

export function EventProvider(props: { children: ReactNode }): JSX.Element {
  const services = useRuntimeServices();
  return (
    <EventsContext.Provider value={services.events}>
      {props.children}
    </EventsContext.Provider>
  );
}

/** EditorProvider 仅在 edit/preview 模式下提供 Editor 上下文。 */
export function EditorProvider(props: {
  mode: "edit" | "preview";
  children: ReactNode;
}): JSX.Element {
  const value = useMemo(() => ({ mode: props.mode }), [props.mode]);
  return (
    <EditorContext.Provider value={value}>{props.children}</EditorContext.Provider>
  );
}

export function useThemeFromContext(): { theme: ThemeSnapshot; responsiveMode: ResponsiveMode } {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error("useTheme 必须在 ThemeProvider 内调用");
  }
  return value;
}

export function useHostStateStore(): HostStateStore {
  const store = useContext(HostStateContext);
  if (store === null) {
    throw new Error("useHostState 必须在 HostStateProvider 内调用");
  }
  return store;
}

export function useDataSourceStore(): DataSourceStore {
  const store = useContext(DataSourcesContext);
  if (store === null) {
    throw new Error("useComponentQuery 必须在 DataSourceProvider 内调用");
  }
  return store;
}

export function useQueryPort(): QueryPort {
  const port = useContext(QueryContext);
  if (port === null) {
    throw new Error("Query 上下文不可用");
  }
  return port;
}

export type { ThemePort };
