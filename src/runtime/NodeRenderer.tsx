/**
 * NodeRenderer（《运行时与 SDK 协议 v1》第 3.8 节递归算法）。
 *
 * renderNode(id, location)：
 *  1. Host 未 dispose（RuntimeRoot 状态机保证）
 *  2. depth <= 128
 *  3. ancestry 不含 id
 *  4. snapshot.nodes 读取节点
 *  5. enabled/style visibility/mode 检查
 *  6. Registry.resolveForRender(type, specVersion)
 *  7. 校验 Slot 名与 ChildRef
 *  8. Binding 求出 effectiveProps（Phase 0：静态 props；BindingEvaluator seam）
 *  9. Definition.validate(effectiveProps)
 * 10. 创建 capability-scoped Runtime API
 * 11. 创建 NodeVisibilityPort
 * 12. NodeFrame（edit）+ NodeErrorBoundary
 * 13. Definition.Renderer
 * 14. Renderer 通过 SlotRenderer 递归
 */
import { useContext, useEffect, useMemo, useRef } from "react";
import type { JSX, ReactNode } from "react";
import type {
  ComponentEventApi,
  ComponentRendererProps,
  ComponentRenderLocation,
  ComponentRuntimeApi,
  DocumentSnapshot,
  HostSnapshot,
  NodeVisibilityPort,
  NodeVisibilitySnapshot,
  RuntimeMode,
  RuntimeServices,
  UiGestureHandle,
} from "./types";
import type {
  ComponentEvent,
  VerifiedActionTrigger,
} from "./action-types";
import type {
  Capability,
  CapabilityDecision,
  CapabilitySubject,
} from "./capability-types";
import type {
  ChildPlacement,
  RegisteredComponentDefinition,
} from "../registry/definition";
import type {
  ComponentId,
  ActionId,
  ErrorCode,
  JsonObject,
  ProtocolError,
  Result,
  VaultId,
} from "@ocs/contracts";
import { ERROR_CODES, isErrorCode } from "@ocs/contracts";
import type { ChildPlacementV1, ComponentNodeV1 } from "@ocs/contracts/document";
import type { VaultQueryDataSourceV1 } from "@ocs/contracts/query";
import { sha256HexSync } from "../shared/hash";
import { EventDispatcher } from "./EventDispatcher";
import {
  AncestorVisibilityContext,
  ComponentRuntimeApiContext,
  NodeVisibilityContext,
  useDocumentSnapshot,
  useHostSnapshot,
  useRuntimeMode,
  useRuntimeServices,
} from "./RuntimeContext";
import { createSlotRenderer } from "./SlotRenderer";
import { NodeErrorBoundary } from "./NodeErrorBoundary";
import { SystemError, SystemUnknown } from "./system";
import type { MarkdownRenderOwner } from "../platform/ports";

export const MAX_RENDER_DEPTH = 128;

function renderError(code: string, message: string): ProtocolError {
  return {
    // 运行期错误码来自 ERROR_CODES 常量或脱敏后的 thrown 值；断言为 ErrorCode。
    code: code as ErrorCode,
    message,
    scope: "runtime",
    recoverable: false,
    retryable: false,
  };
}

function sequenceFailed(error: ProtocolError): {
  status: "failed";
  results: readonly [
    {
      actionId: ActionId;
      status: "failed";
      startedAtMs: number;
      finishedAtMs: number;
      error: ProtocolError;
    },
  ];
} {
  const now = Date.now();
  return {
    status: "failed",
    results: [
      {
        // 序列级错误无对应 Action；空 ID 占位（不是文档 ActionId）。
        actionId: "" as ActionId,
        status: "failed",
        startedAtMs: now,
        finishedAtMs: now,
        error,
      },
    ],
  };
}

function modeForbidEdit(mode: RuntimeMode): ProtocolError | null {
  if (mode === "edit") {
    return renderError(
      ERROR_CODES.RUNTIME_MODE_FORBIDDEN,
      "编辑模式下禁用该操作（Navigation/Action/Clipboard/Command/外部 URL/Vault 写入）",
    );
  }
  return null;
}

function nodeContentHash(node: ComponentNodeV1): string {
  return sha256HexSync(JSON.stringify({ props: node.props, slots: node.slots }));
}

/** 文档 ChildPlacementV1 → registry ChildPlacement（唯一差异是 tab.icon 品牌字符串）。 */
function toChildPlacement(placement: ChildPlacementV1 | null): ChildPlacement | null {
  if (placement === null) return null;
  return placement as unknown as ChildPlacement;
}

/**
 * Markdown Render Owner 生命周期：按 componentId 持有，
 * 同组件下一次 render、Abort 或 Host dispose 先释放旧 Owner。
 */
export class MarkdownOwnerRegistry {
  private readonly owners = new Map<ComponentId, MarkdownRenderOwner>();

  create(componentId: ComponentId): MarkdownRenderOwner {
    const previous = this.owners.get(componentId);
    if (previous) {
      void previous.dispose();
      this.owners.delete(componentId);
    }
    const disposables = new Set<{ dispose(): void | Promise<void> }>();
    const owner: MarkdownRenderOwner = {
      register: (disposable) => {
        disposables.add(disposable);
      },
      dispose: () => {
        for (const d of disposables) {
          void d.dispose();
        }
        disposables.clear();
        if (this.owners.get(componentId) === owner) {
          this.owners.delete(componentId);
        }
      },
    };
    this.owners.set(componentId, owner);
    return owner;
  }

  disposeAll(): void {
    for (const owner of this.owners.values()) {
      void owner.dispose();
    }
    this.owners.clear();
  }
}

export interface ComponentApiParams {
  readonly services: RuntimeServices;
  readonly snapshot: DocumentSnapshot;
  readonly node: ComponentNodeV1;
  readonly definition: RegisteredComponentDefinition | null;
  readonly mode: RuntimeMode;
  readonly sourcePath: string;
  readonly ownerRegistry: MarkdownOwnerRegistry;
}

/** 创建 capability-scoped ComponentRuntimeApi（协议 3.5）。 */
export function createComponentRuntimeApi(params: ComponentApiParams): ComponentRuntimeApi {
  const { services, snapshot, node, definition, mode, sourcePath, ownerRegistry } = params;
  const identity = {
    documentId: snapshot.documentId,
    componentId: node.id,
    type: node.type,
    specVersion: node.specVersion,
    vendor: definition?.manifest.vendor ?? "components-studio",
    packageVersion: definition?.manifest.packageVersion ?? "0.0.0",
  };
  const vaultId: VaultId = services.platform.getPlatformInfo().vaultId;
  const dispatcher = services.events instanceof EventDispatcher ? services.events : null;

  const consume = (gesture: UiGestureHandle): Result<VerifiedActionTrigger> => {
    if (!dispatcher) {
      return {
        ok: false,
        error: renderError(ERROR_CODES.EVENT_TRIGGER_DROPPED, "事件分发器不可用"),
      };
    }
    return dispatcher.consumeHandle(gesture);
  };

  const subject = (): CapabilitySubject => ({
    vaultId,
    documentId: identity.documentId,
    componentId: identity.componentId,
    componentType: identity.type,
    vendor: identity.vendor,
    packageVersion: identity.packageVersion,
  });

  const events: ComponentEventApi = {
    capture: (nativeEvent) => {
      const forbid = modeForbidEdit(mode);
      if (forbid) return { ok: false, error: forbid };
      if (!dispatcher) {
        return {
          ok: false,
          error: renderError(ERROR_CODES.EVENT_TRIGGER_DROPPED, "事件分发器不可用"),
        };
      }
      return dispatcher.capture(nativeEvent);
    },
    emit: async (eventName, payload, gesture) => {
      const forbid = modeForbidEdit(mode);
      if (forbid) return sequenceFailed(forbid);
      const verified = consume(gesture);
      if (!verified.ok) return sequenceFailed(verified.error);
      const control =
        dispatcher?.controlFor(gesture) ?? { preventDefault: () => {}, stopPropagation: () => {} };
      const event: ComponentEvent = {
        eventName,
        component: identity,
        payload,
        trigger: {
          kind: verified.value.kind,
          timestampMs: verified.value.timestampMs,
          verifiedGesture: verified.value,
        },
        mode,
        control,
      };
      return dispatcher
        ? dispatcher.emit(event)
        : sequenceFailed(renderError(ERROR_CODES.EVENT_TRIGGER_DROPPED, "事件分发器不可用"));
    },
  };

  return {
    identity,
    mode,
    sourcePath,
    theme: {
      getSnapshot: () => services.host.getSnapshot().theme,
      subscribe: (listener) => services.host.subscribe(listener),
    },
    navigation: {
      openFile: async (path, options) => {
        const forbid = modeForbidEdit(mode);
        if (forbid) return { ok: false, error: forbid };
        if (options?.gesture) {
          const verified = consume(options.gesture);
          if (!verified.ok) return { ok: false, error: verified.error };
        }
        return services.platform.workspace.openFile(path, {
          ...(options?.disposition ? { disposition: options.disposition } : {}),
        });
      },
    },
    content: {
      readText: (path, options) => services.platform.vaultRead.readText(path, options?.signal),
      subscribe: (path, listener) =>
        services.platform.vaultRead.subscribe((event) => {
          const touches =
            event.kind === "renamed"
              ? event.oldPath === path || event.newPath === path
              : event.path === path;
          if (touches) listener();
        }),
    },
    markdown: {
      render: async (input) => {
        const owner = ownerRegistry.create(identity.componentId);
        return services.platform.markdown.render({
          markdown: input.markdown,
          sourcePath: input.sourcePath,
          container: input.container,
          owner,
          signal: input.signal,
        });
      },
    },
    query: {
      getDataSource: (id) => {
        const spec = snapshot.dataSources.get(id);
        if (!spec || spec.type !== "vault.query" || !("config" in spec)) {
          return null;
        }
        return spec as unknown as VaultQueryDataSourceV1;
      },
      execute: (id, options) => {
        const ds = snapshot.dataSources.get(id);
        if (!ds || ds.type !== "vault.query" || !("config" in ds)) {
          return Promise.resolve({
            ok: false,
            error: renderError(ERROR_CODES.DATASOURCE_NOT_FOUND, `数据源不存在: ${id}`),
          });
        }
        return services.query.execute(ds as unknown as VaultQueryDataSourceV1, options);
      },
      refresh: (id) => {
        void services.dataSources.refresh(id);
      },
    },
    actions: {
      run: async (actions, options) => {
        const forbid = modeForbidEdit(mode);
        if (forbid) return sequenceFailed(forbid);
        const verified = consume(options.gesture);
        if (!verified.ok) return sequenceFailed(verified.error);
        return services.actions.run({
          actions,
          context: {
            component: identity,
            sourcePath,
            componentProps: node.props,
            eventPayload: options.eventPayload ?? {},
            trigger: {
              kind: verified.value.kind,
              timestampMs: verified.value.timestampMs,
              verifiedGesture: verified.value,
            },
            mode,
          },
          signal: options.signal,
        });
      },
    },
    events,
    timers: {
      nowMs: () => services.platform.clock.now(),
      timeout: (callback, delayMs) => services.platform.clock.timeout(callback, delayMs),
      interval: (callback, intervalMs) => services.platform.clock.interval(callback, intervalMs),
      aligned: (callback, unit) => services.platform.clock.aligned(callback, unit),
    },
    diagnostics: {
      warning: (code, message) => {
        services.diagnostics.warning({
          pointer: `component/${node.id}`,
          code: isErrorCode(code) ? code : (ERROR_CODES.EXPR_SCHEMA_INVALID as ErrorCode),
          message,
          severity: "warning",
        });
      },
      error: (error) => {
        services.diagnostics.report(error);
      },
    },
    getCapability: (capability: Capability): CapabilityDecision =>
      services.capabilities.evaluate(subject(), capability, mode),
    requestCapability: async (capability, reason, gesture) => {
      const verified = consume(gesture);
      if (!verified.ok) {
        return {
          capability,
          granted: false,
          source: "runtime-mode-deny",
          reason: verified.error.message,
        };
      }
      return services.capabilities.requestGrant({
        subject: subject(),
        capability,
        reason,
        mode,
        trigger: {
          kind: verified.value.kind,
          timestampMs: verified.value.timestampMs,
          verifiedGesture: verified.value,
        },
      });
    },
  };
}

/**
 * 组件作用域帧：所有模式（view/embedded/preview/edit）都渲染
 * `.ocs-component[data-component-type]` 根作用域（规格 9.6）；
 * 只有 edit 模式拦截点击（只选择，不动作）。
 */
function NodeFrame(props: {
  node: ComponentNodeV1;
  locked: boolean;
  interactive: boolean;
  children: ReactNode;
}): JSX.Element {
  const { node, locked, interactive, children } = props;
  return (
    <div
      data-component-type={node.type}
      data-component-id={node.id}
      data-node-locked={locked ? "true" : undefined}
      data-node-enabled={node.enabled ? "true" : "false"}
      className="ocs-component ocs-node-frame"
      onClick={
        interactive
          ? (event) => {
              event.stopPropagation();
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

export interface NodeRendererProps {
  readonly nodeId: ComponentId;
  readonly location: ComponentRenderLocation;
}

/**
 * 递归节点渲染器（wrapper：只做检查，无 hooks；错误路径直接渲染 fallback）。
 * SlotRenderer 通过 NodeRendererBody 递归子节点。
 */
export function NodeRenderer(props: NodeRendererProps): JSX.Element | null {
  const { nodeId, location } = props;
  const services = useRuntimeServices();
  const snapshot = useDocumentSnapshot();
  const host = useHostSnapshot();
  const mode = useRuntimeMode();
  const ancestorVisible = useContext(AncestorVisibilityContext);

  // 2. depth <= 128
  if (location.depth > MAX_RENDER_DEPTH) {
    return (
      <SystemError
        code={ERROR_CODES.DOC_TREE_TOO_DEEP}
        message={`渲染深度超过 ${MAX_RENDER_DEPTH}，该分支被隔离`}
        componentId={nodeId}
        type={null}
        specVersion={null}
        issues={null}
      />
    );
  }
  // 3. ancestry 不含 id（循环）
  if (location.ancestry.includes(nodeId)) {
    return (
      <SystemError
        code={ERROR_CODES.DOC_CYCLE_DETECTED}
        message="检测到祖先循环引用，该分支被隔离"
        componentId={nodeId}
        type={null}
        specVersion={null}
        issues={null}
      />
    );
  }
  // 4. 读取节点
  const node = snapshot.nodes.get(nodeId);
  if (!node) {
    return (
      <SystemError
        code={ERROR_CODES.RUNTIME_NODE_NOT_FOUND}
        message={`节点不存在: ${nodeId}`}
        componentId={nodeId}
        type={null}
        specVersion={null}
        issues={null}
      />
    );
  }
  // 5. style visibility：view 不占位、不渲染子树（协议 3.3）
  if (node.style.visibility === "hidden") {
    return null;
  }

  // 6. Registry 解析
  const resolution = services.registry.resolveForRender(node.type, node.specVersion);
  if (!resolution.ok) {
    return (
      <SystemError
        code={resolution.error.code}
        message={resolution.error.message}
        componentId={node.id}
        type={node.type}
        specVersion={node.specVersion}
        issues={null}
      />
    );
  }
  if (resolution.value.kind === "unknown") {
    return <UnknownNode node={node} supportedSpecVersion={null} mode={mode} />;
  }
  if (resolution.value.kind === "future") {
    return (
      <UnknownNode
        node={node}
        supportedSpecVersion={resolution.value.supportedSpecVersion}
        mode={mode}
      />
    );
  }
  const definition = resolution.value.definition;

  // 7. Slot 名与 ChildRef 校验（非致命，进入诊断）
  for (const slotName of Object.keys(node.slots)) {
    if (!definition.slots.some((slot) => slot.name === slotName)) {
      services.diagnostics.warning({
        pointer: `component/${node.id}/slots/${slotName}`,
        code: ERROR_CODES.DOC_SLOT_UNKNOWN,
        message: `节点声明了未定义的 Slot: ${slotName}`,
        severity: "warning",
      });
    }
    for (const child of node.slots[slotName] ?? []) {
      if (!snapshot.nodes.has(child.nodeId)) {
        services.diagnostics.warning({
          pointer: `component/${node.id}/slots/${slotName}`,
          code: ERROR_CODES.DOC_DANGLING_REFERENCE,
          message: `Slot ${slotName} 引用不存在的节点: ${child.nodeId}`,
          severity: "warning",
        });
      }
    }
  }

  // 8. Binding → effectiveProps（Phase 0：不评估绑定，直接传静态 props；
  //    BindingEvaluator 接缝在 Phase 2 接入 evaluateExpr 结果。）
  const effectiveProps = node.props as Readonly<object>;

  // 9. Definition.validate
  const validation = definition.validateUnknown(effectiveProps);
  if (!validation.ok) {
    return (
      <SystemError
        code={ERROR_CODES.COMPONENT_PROPS_INVALID}
        message={`Props 未通过 ${node.type} 的 propsSchema（${validation.issues.length} 个问题）`}
        componentId={node.id}
        type={node.type}
        specVersion={node.specVersion}
        issues={validation.issues}
      />
    );
  }

  const effectiveVisible =
    host.isHostVisible && ancestorVisible && node.enabled && node.style.visibility === "visible";

  return (
    <NodeRendererBody
      services={services}
      snapshot={snapshot}
      host={host}
      mode={mode}
      node={node}
      definition={definition}
      sourcePath={snapshot.sourcePath}
      location={location}
      ancestorVisible={ancestorVisible}
      effectiveVisible={effectiveVisible}
    />
  );
}

interface NodeRendererBodyProps {
  readonly services: RuntimeServices;
  readonly snapshot: DocumentSnapshot;
  readonly host: HostSnapshot;
  readonly mode: RuntimeMode;
  readonly node: ComponentNodeV1;
  readonly definition: RegisteredComponentDefinition;
  readonly sourcePath: string;
  readonly location: ComponentRenderLocation;
  readonly ancestorVisible: boolean;
  readonly effectiveVisible: boolean;
}

/** 主渲染路径（hooks 无条件调用，顺序稳定）。 */
function NodeRendererBody(props: NodeRendererBodyProps): JSX.Element {
  const {
    services,
    snapshot,
    host,
    mode,
    node,
    definition,
    sourcePath,
    location,
    ancestorVisible,
    effectiveVisible,
  } = props;

  const ownerRegistryRef = useRef<MarkdownOwnerRegistry | null>(null);
  if (!ownerRegistryRef.current) {
    ownerRegistryRef.current = new MarkdownOwnerRegistry();
  }
  useEffect(() => {
    const registry = ownerRegistryRef.current;
    return () => {
      registry?.disposeAll();
    };
  }, []);

  const api = useMemo(
    () =>
      createComponentRuntimeApi({
        services,
        snapshot,
        node,
        definition,
        mode,
        sourcePath,
        ownerRegistry: ownerRegistryRef.current!,
      }),
    [services, snapshot, node, definition, mode, sourcePath],
  );

  // useSyncExternalStore 要求 getSnapshot 在输入不变时返回同一引用；
  // port 实例随 useMemo deps 重建，闭包内缓存保证引用稳定。
  const visibilityPort: NodeVisibilityPort = useMemo(() => {
    let cached: {
      hostVisible: boolean;
      ancestorVisible: boolean;
      nodeEnabled: boolean;
      nodeStyleVisible: boolean;
      activeInLayout: boolean;
      effectiveVisible: boolean;
    } | null = null;
    const build = (): NodeVisibilitySnapshot => {
      const next = {
        hostVisible: host.isHostVisible,
        ancestorVisible,
        nodeEnabled: node.enabled,
        nodeStyleVisible: node.style.visibility === "visible",
        activeInLayout: true,
        effectiveVisible,
      };
      cached = next;
      return next;
    };
    return {
      getSnapshot: () => cached ?? build(),
      subscribe: (listener) => services.host.subscribe(listener),
    };
  }, [host.isHostVisible, ancestorVisible, node.enabled, node.style.visibility, effectiveVisible, services]);

  const slots = useMemo(
    () =>
      createSlotRenderer({
        node,
        definition,
        renderChildNode: (child, slotName, index) => (
          <AncestorVisibilityContext.Provider value={effectiveVisible}>
            <NodeRenderer
              nodeId={child.nodeId}
              location={{
                parentId: node.id,
                slotName,
                childIndex: index,
                placement: toChildPlacement(child.placement),
                depth: location.depth + 1,
                ancestry: [...location.ancestry, node.id],
              }}
            />
          </AncestorVisibilityContext.Provider>
        ),
      }),
    [node, definition, effectiveVisible, location.depth, location.ancestry],
  );

  const rendererProps: ComponentRendererProps<object> = {
    id: node.id,
    props: effectivePropsOf(node),
    mode,
    sourcePath,
    location,
    slots,
    runtime: api,
    visibility: visibilityPort,
  };

  const onReport = (error: { code: string; message: string }): void => {
    services.diagnostics.report(renderError(error.code, error.message));
  };
  const onCopyDiagnostics = (text: string): void => {
    void services.platform.clipboard.writeText(text);
  };
  const locked = (node.props as JsonObject).locked === true;

  let rendererElement: ReactNode;
  if (mode === "thumbnail") {
    // thumbnail：只调用安全 Preview；无 Preview 时静态图标和名称（协议 3.8）。
    if (definition.previewUnknown) {
      const Preview = definition.previewUnknown;
      rendererElement = (
        <Preview props={effectivePropsOf(node)} theme={host.theme} responsiveMode={host.responsiveMode} />
      );
    } else {
      rendererElement = (
        <div data-component-type={node.type} className="ocs-thumbnail-placeholder">
          {node.type}
        </div>
      );
    }
  } else {
    const Renderer = definition.renderUnknown;
    rendererElement = <Renderer {...rendererProps} />;
  }

  const resetKey = `${node.id}|${node.type}|${node.specVersion}|${nodeContentHash(node)}`;
  // thumbnail 已有自己的占位容器（带 data-component-type），不再包 NodeFrame。
  const wrapped =
    mode !== "thumbnail" ? (
      <NodeFrame node={node} locked={locked} interactive={mode === "edit"}>
        {rendererElement}
      </NodeFrame>
    ) : (
      rendererElement
    );

  return (
    <NodeVisibilityContext.Provider value={visibilityPort}>
      <NodeErrorBoundary
        key={resetKey}
        resetKey={resetKey}
        componentId={node.id}
        type={node.type}
        specVersion={node.specVersion}
        onReport={onReport}
        onCopyDiagnostics={onCopyDiagnostics}
      >
        <ComponentRuntimeApiContext.Provider value={api}>
          {wrapped}
        </ComponentRuntimeApiContext.Provider>
      </NodeErrorBoundary>
    </NodeVisibilityContext.Provider>
  );
}

/** Phase 0 effectiveProps：静态 props（BindingEvaluator seam）。 */
function effectivePropsOf(node: ComponentNodeV1): Readonly<object> {
  return node.props as Readonly<object>;
}

function UnknownNode(props: {
  node: ComponentNodeV1;
  supportedSpecVersion: number | null;
  mode: RuntimeMode;
}): JSX.Element {
  const { node, supportedSpecVersion, mode } = props;
  return (
    <SystemUnknown
      componentId={node.id}
      type={node.type}
      specVersion={node.specVersion}
      supportedSpecVersion={supportedSpecVersion}
      editable={mode === "edit"}
    />
  );
}

export type {
  ComponentId,
  ComponentRuntimeApi,
  DocumentSnapshot,
  ErrorCode,
  JsonObject,
  UiGestureHandle,
};
