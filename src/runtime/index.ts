/**
 * src/runtime 公共出口 + RuntimeServices 装配工厂。
 *
 * createRuntimeServices 把外部 Port（platform/registry/document/host/
 * hostState/query/diagnostics）装配成完整 RuntimeServices：内部构建
 * CapabilityBroker、ActionRunner（自动注册 8 个 MVP Handler）、
 * EventDispatcher 与 Phase-0 DataSourceStore。
 */
import type {
  ComponentRegistry,
} from "../registry/ComponentRegistry";
import type {
  DiagnosticPort,
  HostStateStore as HostStateStorePort,
  RuntimeDocumentPort,
  RuntimeHostStore as RuntimeHostStorePort,
  RuntimeServices,
} from "./types";
import type { PlatformPort } from "../platform/ports";
import type { QueryPort } from "./query-types";
import type { Result } from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";
import { CapabilityBroker, InMemoryCapabilityGrantStore } from "./CapabilityBroker";
import { ActionRunner } from "./ActionRunner";
import { EventDispatcher } from "./EventDispatcher";
import { DataSourceStore } from "./DataSourceStore";
import { registerMvpActionHandlers } from "./actions";

export interface CreateRuntimeServicesInput {
  readonly platform: PlatformPort;
  readonly registry: ComponentRegistry;
  readonly document: RuntimeDocumentPort;
  readonly host: RuntimeHostStorePort;
  readonly hostState: HostStateStorePort;
  /** Phase 0 可选：默认 NoopQueryPort。 */
  readonly query?: QueryPort;
  /** Phase 0 可选：默认 NoopDiagnosticPort。 */
  readonly diagnostics?: DiagnosticPort;
}

/** Phase 0 占位 QueryPort：全部返回错误（Phase 2 由 Query Store 替换）。 */
export function createNoopQueryPort(): QueryPort {
  const unavailable = (): Result<never> => ({
    ok: false,
    error: {
      code: ERROR_CODES.DATASOURCE_NOT_FOUND,
      message: "Query 引擎尚未就绪（Phase 2）",
      scope: "query",
      recoverable: false,
      retryable: false,
    },
  });
  return {
    execute: async () => unavailable(),
    subscribe: () => unavailable(),
  };
}

/** Phase 0 占位 DiagnosticPort：静默丢弃（Phase 2 接入插件日志/通知）。 */
export function createNoopDiagnosticPort(): DiagnosticPort {
  return {
    report: () => {},
    warning: () => {},
    markPerformance: () => {},
  };
}

export function createRuntimeServices(input: CreateRuntimeServicesInput): RuntimeServices {
  const { platform, registry, document, host, hostState } = input;
  const query = input.query ?? createNoopQueryPort();
  const diagnostics = input.diagnostics ?? createNoopDiagnosticPort();
  const vaultId = platform.getPlatformInfo().vaultId;

  const capabilities = new CapabilityBroker({
    registry,
    document,
    confirmations: platform.confirmations,
    commands: platform.commands,
    grants: new InMemoryCapabilityGrantStore(),
    vaultId,
  });

  const actions = new ActionRunner({
    capabilities,
    confirmations: platform.confirmations,
    clock: platform.clock,
    commands: platform.commands,
    diagnostics,
    vaultId,
  });
  registerMvpActionHandlers(actions, platform);

  const events = new EventDispatcher({
    runner: actions,
    registry,
    document,
    host,
    diagnostics,
  });

  const dataSources = new DataSourceStore();

  return {
    platform,
    registry,
    document,
    host,
    hostState,
    query,
    dataSources,
    actions,
    events,
    capabilities,
    diagnostics,
  };
}

export { RuntimeRoot, RuntimeFatalBoundary } from "./RuntimeRoot";
export { RuntimeHostStore } from "./RuntimeHostStore";
export type { RuntimeHostStoreOptions } from "./RuntimeHostStore";
export { HostStateStore } from "./HostStateStore";
export { DataSourceStore } from "./DataSourceStore";
export { CapabilityBroker, InMemoryCapabilityGrantStore } from "./CapabilityBroker";
export { ActionRunner } from "./ActionRunner";
export { EventDispatcher } from "./EventDispatcher";
export { NodeRenderer, MarkdownOwnerRegistry, MAX_RENDER_DEPTH } from "./NodeRenderer";
export { NodeErrorBoundary } from "./NodeErrorBoundary";
export { createSlotRenderer } from "./SlotRenderer";
export { SystemUnknown, SystemError } from "./system";
export { evaluateExpr, resolveJsonPointer, jsonValueEqual } from "./expr";
export { registerMvpActionHandlers } from "./actions";
export {
  useRuntime,
  useRuntimeServices,
  useRuntimeState,
  useRuntimeMode,
  useNodeVisibility,
  useDocumentSnapshot,
  useHostSnapshot,
} from "./RuntimeContext";
export {
  useTheme,
  useVisibility,
  useReducedMotion,
  useHostState,
  useComponentQuery,
  useVaultText,
  useActionRunner,
} from "./hooks";

// 冻结类型 re-export（签名不变；与类导出重名的类型不再重复导出）。
export type {
  RuntimeServices,
  RuntimeRootProps,
  RuntimeState,
  RuntimeMode,
  ResponsiveMode,
  HostSnapshot,
  RuntimeDocumentPort,
  DocumentSnapshot,
  RuntimeDocumentStatus,
  NodeVisibilityPort,
  NodeVisibilitySnapshot,
  ComponentRenderLocation,
  SlotRenderer,
  ChildRef,
  ComponentRendererProps,
  ComponentRuntimeApi,
  ComponentIdentity,
  UiGestureHandle,
  ContentHookState,
  Size,
  HostStateValue,
  PerformanceDiagnostic,
  DiagnosticPort,
} from "./types";
export type {
  EventDispatcher as EventDispatcherPort,
  ActionRunner as ActionRunnerPort,
  ActionDefinition,
  ActionHandler,
  ActionSpec,
  ActionContext,
  ActionExecutionResult,
  ActionSequenceResult,
  ActionTrigger,
  VerifiedActionTrigger,
  ComponentEvent,
  EventSequence,
  ConfirmationSpec,
  ActionType,
  ActionResolution,
} from "./action-types";
export type {
  Capability,
  CapabilitySubject,
  CapabilityDecision,
  CapabilityDecisionSource,
  CapabilityGrant,
  CapabilityGrantStore,
} from "./capability-types";
export type {
  QueryPort,
  QueryHookSnapshot,
  DataSourceExecutionContext,
} from "./query-types";
