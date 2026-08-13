/**
 * React Runtime 协议（《运行时与 SDK 协议 v1》第 3 章）。
 * Runtime 只获得只读 Document Port；编辑器通过独立 Command Port 写入。
 */

import type {
  ComponentId,
  ComponentType,
  DataSourceId,
  Disposable,
  DocumentId,
  JsonObject,
  JsonValue,
  NamespacedKey,
  OpenDisposition,
  PersistedDataSourceSpecV1,
  ProtocolError,
  Result,
  ValidationIssue,
} from "@ocs/contracts";
import type { ElementType, ReactNode } from "react";
import type { ActionSpec } from "./action-types";
import type { Capability, CapabilityDecision } from "./capability-types";
import type { ChildPlacement } from "../registry/definition";
import type {
  DocumentMetadataV1,
  PermissionManifestV1,
  EventSequenceV1,
  ComponentNodeV1,
} from "@ocs/contracts/document";
import type {
  QueryOverlay,
  QueryPageRequest,
  QueryResult,
  VaultQueryDataSourceV1,
} from "@ocs/contracts/query";
import type {
  ActionSequenceResult,
  EventDispatcher,
  ActionRunner,
} from "./action-types";
import type {
  CapabilityBroker,
} from "./capability-types";
import type { PlatformPort, TextFileSnapshot } from "../platform/ports";
import type { ComponentRegistry } from "../registry/ComponentRegistry";
import type { DataSourceStore, QueryPort } from "./query-types";

export type RuntimeMode = "view" | "edit" | "preview" | "embedded" | "thumbnail";
export type ResponsiveMode = "compact" | "regular" | "wide";

export interface DocumentSnapshot {
  readonly documentId: DocumentId;
  readonly sourcePath: string;
  readonly sessionVersion: number;
  readonly revision: number;
  readonly rootId: ComponentId;
  readonly nodes: ReadonlyMap<ComponentId, ComponentNodeV1>;
  readonly dataSources: ReadonlyMap<DataSourceId, PersistedDataSourceSpecV1>;
  readonly permissions: PermissionManifestV1;
  readonly metadata: DocumentMetadataV1;
}

export interface RuntimeDocumentPort {
  getSnapshot(): DocumentSnapshot;
  subscribe(listener: () => void): () => void;
  getStatus(): RuntimeDocumentStatus;
}

export type RuntimeDocumentStatus =
  | { readonly kind: "ready"; readonly dirty: boolean }
  | { readonly kind: "saving"; readonly dirty: boolean }
  | { readonly kind: "conflict" }
  | { readonly kind: "invalid-external" }
  | { readonly kind: "missing" }
  | { readonly kind: "read-only"; readonly reason: string }
  | { readonly kind: "disposed" };

export interface PerformanceDiagnostic {
  readonly name: string;
  readonly durationMs: number;
  readonly componentId?: ComponentId;
  readonly details?: JsonObject;
}

export interface DiagnosticPort {
  report(error: ProtocolError): void;
  warning(issue: ValidationIssue): void;
  markPerformance(entry: PerformanceDiagnostic): void;
}

export interface RuntimeServices {
  readonly platform: PlatformPort;
  readonly registry: ComponentRegistry;
  readonly document: RuntimeDocumentPort;
  readonly host: RuntimeHostStore;
  readonly hostState: HostStateStore;
  readonly query: QueryPort;
  readonly dataSources: DataSourceStore;
  readonly actions: ActionRunner;
  readonly events: EventDispatcher;
  readonly capabilities: CapabilityBroker;
  readonly diagnostics: DiagnosticPort;
}

export interface RuntimeRootProps {
  readonly services: RuntimeServices;
  readonly initialMode: RuntimeMode;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface HostSnapshot {
  readonly hostId: string;
  readonly sourcePath: string;
  readonly ownerDocument: Document;
  readonly ownerWindow: Window;
  readonly containerSize: Size;
  readonly responsiveMode: ResponsiveMode;
  readonly isAttached: boolean;
  readonly isHostVisible: boolean;
  readonly theme: import("../platform/ports").ThemeSnapshot;
}

export interface RuntimeHostStore extends Disposable {
  getSnapshot(): HostSnapshot;
  subscribe(listener: () => void): () => void;
}

export type HostStateValue = JsonValue;

export interface HostStateStore extends Disposable {
  get<T extends HostStateValue>(key: string, fallback: T): T;
  set<T extends HostStateValue>(key: string, value: T): void;
  remove(key: string): void;
  subscribe(key: string, listener: () => void): () => void;
}

export interface NodeVisibilitySnapshot {
  readonly hostVisible: boolean;
  readonly ancestorVisible: boolean;
  readonly nodeEnabled: boolean;
  readonly nodeStyleVisible: boolean;
  readonly activeInLayout: boolean;
  readonly effectiveVisible: boolean;
}

export interface NodeVisibilityPort {
  getSnapshot(): NodeVisibilitySnapshot;
  subscribe(listener: () => void): () => void;
}

export interface ComponentRenderLocation {
  readonly parentId: ComponentId | null;
  readonly slotName: string | null;
  readonly childIndex: number | null;
  readonly placement: ChildPlacement | null;
  readonly depth: number;
  readonly ancestry: readonly ComponentId[];
}

export interface ChildRef {
  readonly nodeId: ComponentId;
  readonly placement: ChildPlacement;
}

export interface SlotRenderer {
  has(slotName: string): boolean;
  getChildren(slotName: string): readonly ChildRef[];
  render(
    slotName: string,
    options?: {
      readonly wrapper?: ElementType;
      readonly empty?: ReactNode;
      readonly childClassName?: string;
    },
  ): ReactNode;
  renderChild(
    child: ChildRef,
    options?: { readonly className?: string },
  ): ReactNode;
}

export interface ComponentRendererProps<P extends object> {
  readonly id: ComponentId;
  readonly props: Readonly<P>;
  readonly mode: RuntimeMode;
  readonly sourcePath: string;
  readonly location: ComponentRenderLocation;
  readonly slots: SlotRenderer;
  readonly runtime: ComponentRuntimeApi;
  readonly visibility: NodeVisibilityPort;
}

export interface ComponentIdentity {
  readonly documentId: DocumentId;
  readonly componentId: ComponentId;
  readonly type: ComponentType;
  readonly specVersion: number;
  readonly vendor: string;
  readonly packageVersion: string;
}

export interface ComponentThemeApi {
  getSnapshot(): import("../platform/ports").ThemeSnapshot;
  subscribe(listener: () => void): () => void;
}

export interface ComponentNavigationApi {
  openFile(
    path: string,
    options?: {
      readonly disposition?: OpenDisposition;
      readonly gesture?: UiGestureHandle;
    },
  ): Promise<Result<void>>;
}

export interface ComponentContentApi {
  readText(
    path: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<Result<TextFileSnapshot>>;
  subscribe(path: string, listener: () => void): () => void;
}

export interface ComponentMarkdownApi {
  render(input: {
    readonly markdown: string;
    readonly sourcePath: string;
    readonly container: HTMLElement;
    readonly signal?: AbortSignal;
  }): Promise<Result<void>>;
}

export interface ComponentQueryApi {
  getDataSource(id: DataSourceId): VaultQueryDataSourceV1 | null;
  execute(
    id: DataSourceId,
    options?: {
      readonly overlay?: QueryOverlay | null;
      readonly page?: QueryPageRequest;
      readonly signal?: AbortSignal;
    },
  ): Promise<Result<QueryResult>>;
  refresh(id: DataSourceId): void;
}

export interface ComponentActionApi {
  run(
    actions: readonly ActionSpec[],
    options: {
      readonly gesture: UiGestureHandle;
      readonly eventPayload?: JsonObject;
      readonly signal?: AbortSignal;
    },
  ): Promise<ActionSequenceResult>;
}

export interface ComponentEventApi {
  capture(nativeEvent: Event): Result<UiGestureHandle>;
  emit(
    eventName: string,
    payload: JsonObject,
    gesture: UiGestureHandle,
  ): Promise<ActionSequenceResult>;
}

export interface ComponentTimerApi {
  nowMs(): number;
  timeout(callback: () => void, delayMs: number): Disposable;
  interval(callback: () => void, intervalMs: number): Disposable;
  aligned(callback: () => void, unit: "second" | "minute"): Disposable;
}

export interface ComponentDiagnosticApi {
  warning(code: string, message: string, details?: JsonObject): void;
  error(error: ProtocolError): void;
}

export interface ComponentRuntimeApi {
  readonly identity: ComponentIdentity;
  readonly mode: RuntimeMode;
  readonly sourcePath: string;
  readonly theme: ComponentThemeApi;
  readonly navigation: ComponentNavigationApi;
  readonly content: ComponentContentApi;
  readonly markdown: ComponentMarkdownApi;
  readonly query: ComponentQueryApi;
  readonly actions: ComponentActionApi;
  readonly events: ComponentEventApi;
  readonly timers: ComponentTimerApi;
  readonly diagnostics: ComponentDiagnosticApi;
  getCapability(capability: Capability): CapabilityDecision;
  requestCapability(
    capability: Capability,
    reason: string,
    gesture: UiGestureHandle,
  ): Promise<CapabilityDecision>;
}

export interface UiGestureHandle {
  readonly __opaque: unique symbol;
}

export interface ContentHookState<T> {
  readonly status: "idle" | "loading" | "success" | "error";
  readonly data: T | null;
  readonly error: ProtocolError | null;
  readonly isStale: boolean;
  refresh(): void;
}

export type RuntimeState =
  | { readonly phase: "booting" }
  | { readonly phase: "ready"; readonly documentVersion: number }
  | { readonly phase: "degraded"; readonly reason: ProtocolError }
  | { readonly phase: "fatal"; readonly error: ProtocolError }
  | { readonly phase: "disposed" };

export type { EventSequenceV1, NamespacedKey };
