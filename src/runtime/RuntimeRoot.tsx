/**
 * RuntimeRoot（《运行时与 SDK 协议 v1》第 3.7 节）。
 *
 * Provider 顺序固定：
 *   RuntimeFatalBoundary → PlatformProvider → CapabilityProvider → ThemeProvider
 *   → HostProvider → HostStateProvider → DocumentProvider → QueryProvider →
 *   DataSourceProvider → ActionProvider → EventProvider → EditorProvider（仅
 *   edit/preview）→ RuntimeCanvas
 *
 * 状态机：booting → ready/degraded/fatal → disposed。
 */
import { Component, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { JSX, ReactNode } from "react";
import type { ErrorCode, ProtocolError } from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";
import type {
  DocumentSnapshot,
  RuntimeRootProps,
  RuntimeState,
} from "./types";
import { NodeRenderer } from "./NodeRenderer";
import {
  RuntimeModeContext,
  RuntimeServicesContext,
  RuntimeStateContext,
} from "./RuntimeContext";
import {
  ActionProvider,
  CapabilityProvider,
  DataSourceProvider,
  DocumentProvider,
  EditorProvider,
  EventProvider,
  HostProvider,
  HostStateProvider,
  PlatformProvider,
  QueryProvider,
  ThemeProvider,
} from "./Providers";

export function RuntimeRoot(props: RuntimeRootProps): JSX.Element {
  const { services, initialMode } = props;
  const [state, setState] = useState<RuntimeState>({ phase: "booting" });
  const [fatal, setFatal] = useState<ProtocolError | null>(null);

  useEffect(() => {
    const update = (): void => {
      const status = services.document.getStatus();
      if (status.kind === "disposed") {
        setState({ phase: "disposed" });
        return;
      }
      if (status.kind === "missing" || status.kind === "invalid-external") {
        setState({
          phase: "degraded",
          reason: {
            code: ERROR_CODES.DOC_ROOT_MISSING,
            message: `文档不可用（${status.kind}）`,
            scope: "document",
            recoverable: true,
            retryable: true,
          },
        });
        return;
      }
      setState({
        phase: "ready",
        documentVersion: services.document.getSnapshot().sessionVersion,
      });
    };
    update();
    const unsubscribeDocument = services.document.subscribe(update);
    return () => {
      unsubscribeDocument();
      setState({ phase: "disposed" });
    };
  }, [services]);

  if (fatal !== null) {
    return <FatalScreen error={fatal} />;
  }

  const editorOnly = initialMode === "edit" || initialMode === "preview";

  return (
    <RuntimeServicesContext.Provider value={services}>
      <RuntimeStateContext.Provider value={state}>
        <RuntimeFatalBoundary onFatal={setFatal}>
          <RuntimeModeContext.Provider value={initialMode}>
            <PlatformProvider>
              <CapabilityProvider>
                <ThemeProvider>
                  <HostProvider>
                    <HostStateProvider>
                      <DocumentProvider>
                        <QueryProvider>
                          <DataSourceProvider>
                            <ActionProvider>
                              <EventProvider>
                                {editorOnly ? (
                                  <EditorProvider mode={initialMode}>
                                    <RuntimeCanvas />
                                  </EditorProvider>
                                ) : (
                                  <RuntimeCanvas />
                                )}
                              </EventProvider>
                            </ActionProvider>
                          </DataSourceProvider>
                        </QueryProvider>
                      </DocumentProvider>
                    </HostStateProvider>
                  </HostProvider>
                </ThemeProvider>
              </CapabilityProvider>
            </PlatformProvider>
          </RuntimeModeContext.Provider>
        </RuntimeFatalBoundary>
      </RuntimeStateContext.Provider>
    </RuntimeServicesContext.Provider>
  );
}

export interface RuntimeFatalBoundaryProps {
  readonly onFatal: (error: ProtocolError) => void;
  readonly children: ReactNode;
}

interface RuntimeFatalBoundaryState {
  readonly error: ProtocolError | null;
}

/**
 * 顶层致命边界：Provider/Canvas 渲染异常 → fatal 状态机（整页 fallback）。
 * 单节点错误由 NodeErrorBoundary 隔离，不会到达这里。
 */
export class RuntimeFatalBoundary extends Component<RuntimeFatalBoundaryProps, RuntimeFatalBoundaryState> {
  override state: RuntimeFatalBoundaryState = { error: null };

  static getDerivedStateFromError(thrown: unknown): RuntimeFatalBoundaryState {
    const code =
      thrown !== null && typeof thrown === "object" && typeof (thrown as { code?: unknown }).code === "string"
        ? ((thrown as { code: string }).code as ErrorCode)
        : ERROR_CODES.COMPONENT_RENDER_FAILED;
    const message =
      thrown !== null && typeof thrown === "object" && typeof (thrown as { message?: unknown }).message === "string"
        ? ((thrown as { message: string }).message)
        : thrown instanceof Error
          ? thrown.message
          : "运行时致命错误";
    return {
      error: {
        code,
        message,
        scope: "runtime",
        recoverable: false,
        retryable: false,
      },
    };
  }

  override componentDidCatch(): void {
    if (this.state.error) {
      this.props.onFatal(this.state.error);
    }
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return <FatalScreen error={this.state.error} />;
    }
    return this.props.children;
  }
}

function FatalScreen(props: { error: ProtocolError }): JSX.Element {
  return (
    <div data-system="runtime-fatal" role="alert" className="ocs-runtime-fatal">
      <div className="ocs-runtime-fatal-code">{props.error.code}</div>
      <div className="ocs-runtime-fatal-message">{props.error.message}</div>
    </div>
  );
}

/** RuntimeCanvas：渲染文档根节点；缺失根 → system.error RUNTIME_NODE_NOT_FOUND。 */
function RuntimeCanvas(): JSX.Element | null {
  const state = useContext(RuntimeStateContext);
  if (state.phase === "booting") return null;
  if (state.phase === "disposed") return null;
  if (state.phase === "fatal") return null;
  if (state.phase === "degraded") {
    return (
      <div data-system="runtime-degraded" role="alert" className="ocs-runtime-degraded">
        文档不可用（{state.reason.code}）
      </div>
    );
  }
  return <RootRenderer />;
}

function RootRenderer(): JSX.Element | null {
  const snapshot = useDocumentSnapshotInternal();
  const root = snapshot.nodes.get(snapshot.rootId);
  if (!root) {
    return (
      <div data-system="system.error" role="alert" className="ocs-system-error">
        <div className="ocs-system-error-code">{ERROR_CODES.RUNTIME_NODE_NOT_FOUND}</div>
        <div className="ocs-system-error-message">根节点不存在: {snapshot.rootId}</div>
      </div>
    );
  }
  return (
    <NodeRenderer
      nodeId={snapshot.rootId}
      location={{
        parentId: null,
        slotName: null,
        childIndex: null,
        placement: null,
        depth: 0,
        ancestry: [],
      }}
    />
  );
}

function useDocumentSnapshotInternal(): DocumentSnapshot {
  const services = useContext(RuntimeServicesContext);
  if (services === null) {
    throw new Error("RuntimeServicesContext 不可用");
  }
  return useSyncExternalStore(
    (listener) => services.document.subscribe(listener),
    () => services.document.getSnapshot(),
  );
}

export type { RuntimeState };
