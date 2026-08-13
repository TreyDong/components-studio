/**
 * Runtime 测试共享 fakes：FakeRegistry / FakeDocumentPort / FakeHostStore /
 * FakePlatformPort / 可配置 CapabilityBroker / 快照与节点构建器。
 */
import { createElement } from "react";
import { createRuntimeServices, HostStateStore } from "../../src/runtime/index";
import type { ComponentDefinition, RegisteredComponentDefinition, RegistryRegistration } from "../../src/registry/definition";
import type { ComponentRegistry } from "../../src/registry/ComponentRegistry";
import type { CodecRegistry } from "../../src/document/types";
import type {
  ComponentRendererProps,
  DocumentSnapshot,
  HostSnapshot,
  RuntimeDocumentPort,
  RuntimeDocumentStatus,
  RuntimeHostStore,
  RuntimeServices,
} from "../../src/runtime/types";
import type { ActionTrigger } from "../../src/runtime/action-types";
import type {
  Capability,
  CapabilityBroker,
  CapabilityDecision,
  CapabilitySubject,
} from "../../src/runtime/capability-types";
import type {
  PlatformPort,
  ThemeSnapshot,
} from "../../src/platform/ports";
import type {
  ComponentId,
  ComponentType,
  DocumentId,
  JsonObject,
  Result,
  VaultId,
} from "@ocs/contracts";
import { ERROR_CODES, DEFAULT_CHILD_PLACEMENT_V1, DEFAULT_NODE_STYLE_V1 } from "@ocs/contracts";
import type {
  ChildRefV1,
  ComponentNodeV1,
  EventSequenceV1,
  PermissionManifestV1,
} from "@ocs/contracts/document";

export const TEST_VAULT: VaultId = "vault-test" as VaultId;
export const TEST_DOCUMENT: DocumentId = "00000000-0000-4000-8000-0000000000aa" as DocumentId;

export function fakeTheme(): ThemeSnapshot {
  return {
    mode: "light",
    accentColor: "#4285f4",
    fontScale: 1,
    reducedMotion: false,
    highContrast: false,
    tokens: {
      background: "#ffffff",
      surface: "#f5f5f5",
      "surface-hover": "#eeeeee",
      text: "#111111",
      "text-muted": "#666666",
      border: "#dddddd",
      accent: "#4285f4",
      danger: "#d93025",
      success: "#188038",
      warning: "#f9ab00",
    },
  };
}

// ---------------------------------------------------------------------------
// 文档快照构建
// ---------------------------------------------------------------------------

export interface FakeNodeOptions {
  id: string;
  type: string;
  specVersion?: number;
  enabled?: boolean;
  props?: JsonObject;
  children?: Array<{ nodeId: string; slot?: string }>;
  events?: Record<string, EventSequenceV1>;
  hidden?: boolean;
  styleVisibility?: "visible" | "hidden";
}

export function makeNode(opts: FakeNodeOptions): ComponentNodeV1 {
  const children = opts.children ?? [];
  const slots: Record<string, ChildRefV1[]> = {};
  for (const child of children) {
    const slot = child.slot ?? "children";
    if (!slots[slot]) slots[slot] = [];
    slots[slot]!.push({
      nodeId: child.nodeId as ComponentId,
      placement: DEFAULT_CHILD_PLACEMENT_V1,
    });
  }
  return {
    id: opts.id as ComponentId,
    type: opts.type as ComponentType,
    specVersion: opts.specVersion ?? 1,
    enabled: opts.enabled ?? true,
    label: null,
    props: opts.props ?? {},
    style: {
      ...DEFAULT_NODE_STYLE_V1,
      visibility: opts.styleVisibility ?? (opts.hidden ? "hidden" : "visible"),
    },
    slots,
    bindings: [],
    events: opts.events ?? {},
    extensions: {},
  };
}

export interface FakeSnapshotOptions {
  documentId?: DocumentId;
  sourcePath?: string;
  sessionVersion?: number;
  revision?: number;
  rootId: string;
  nodes: ComponentNodeV1[];
  permissions?: PermissionManifestV1;
}

export function buildSnapshot(opts: FakeSnapshotOptions): DocumentSnapshot {
  return {
    documentId: opts.documentId ?? TEST_DOCUMENT,
    sourcePath: opts.sourcePath ?? "home.components",
    sessionVersion: opts.sessionVersion ?? 1,
    revision: opts.revision ?? 0,
    rootId: opts.rootId as ComponentId,
    nodes: new Map(opts.nodes.map((n) => [n.id, n])),
    dataSources: new Map(),
    permissions: opts.permissions ?? { requested: [] },
    metadata: { title: "测试文档", description: "", tags: [] },
  };
}

// ---------------------------------------------------------------------------
// FakeRegistry
// ---------------------------------------------------------------------------

/** 把 ComponentDefinition 转换成 RegisteredComponentDefinition（镜像 registry 转换）。 */
export function registeredFrom<P extends object>(
  definition: ComponentDefinition<P>,
): RegisteredComponentDefinition {
  return {
    manifest: definition.manifest,
    propsSchema: definition.propsSchema,
    slots: definition.slots as unknown as RegisteredComponentDefinition["slots"],
    events: definition.events,
    bindableTargets: definition.bindableTargets,
    migrations: definition.migrations,
    createCompanionDataSources: (ctx) => definition.createCompanionDataSources(ctx),
    createDefaultPropsUnknown: (ctx) => definition.createDefaultProps(ctx),
    validateUnknown: (input) => definition.validate(input),
    renderUnknown: (props) =>
      createElement(definition.Renderer, props as unknown as ComponentRendererProps<P>),
    inspectUnknown: () => null,
    ...(definition.Preview
      ? {
          previewUnknown: (props: never) =>
            createElement(definition.Preview as never, props as never),
        }
      : {}),
  };
}

export class FakeRegistry implements ComponentRegistry {
  private defs = new Map<string, RegisteredComponentDefinition>();

  register<P extends object>(definition: ComponentDefinition<P>): Result<RegistryRegistration> {
    const type = definition.manifest.type;
    if (this.defs.has(type)) {
      return {
        ok: false,
        error: {
          code: ERROR_CODES.REGISTRY_TYPE_CONFLICT,
          message: `重复注册: ${type}`,
          scope: "registry",
          recoverable: false,
          retryable: false,
        },
      };
    }
    this.defs.set(type, registeredFrom(definition));
    return {
      ok: true,
      value: {
        type,
        dispose: () => {
          this.defs.delete(type);
        },
      },
    };
  }

  /** 直接放入已构建的 RegisteredComponentDefinition（跳过 ComponentDefinition 转换）。 */
  putDirect(definition: RegisteredComponentDefinition): void {
    this.defs.set(definition.manifest.type, definition);
  }

  has(type: ComponentType): boolean {
    return this.defs.has(type);
  }

  get(type: ComponentType): RegisteredComponentDefinition | null {
    return this.defs.get(type) ?? null;
  }

  resolveForRender(
    type: ComponentType,
    storedVersion: number,
  ): Result<
    | { kind: "known"; definition: RegisteredComponentDefinition }
    | { kind: "unknown"; type: ComponentType }
    | {
        kind: "future";
        definition: RegisteredComponentDefinition;
        fileSpecVersion: number;
        supportedSpecVersion: number;
      }
  > {
    const definition = this.defs.get(type);
    if (!definition) return { ok: true, value: { kind: "unknown", type } };
    if (storedVersion > definition.manifest.specVersion) {
      return {
        ok: true,
        value: {
          kind: "future",
          definition,
          fileSpecVersion: storedVersion,
          supportedSpecVersion: definition.manifest.specVersion,
        },
      };
    }
    if (storedVersion < definition.manifest.specVersion) {
      // 旧版本：Runtime 不迁移（Codec 已迁移），按 unknown 处理。
      return { ok: true, value: { kind: "unknown", type } };
    }
    return { ok: true, value: { kind: "known", definition } };
  }

  resolveForMigration(): Result<never> {
    return {
      ok: false,
      error: {
        code: ERROR_CODES.MIGRATION_PATH_MISSING,
        message: "测试 Registry 不执行 Migration",
        scope: "registry",
        recoverable: false,
        retryable: false,
      },
    };
  }

  list(): readonly RegisteredComponentDefinition[] {
    return Array.from(this.defs.values());
  }

  subscribe(): () => void {
    return () => {};
  }

  codecView(): CodecRegistry {
    return {
      resolveComponentType: () => ({ kind: "unknown" }),
      resolveDataSourceType: () => ({ kind: "unknown" }),
      resolveActionType: () => ({ kind: "unknown" }),
    };
  }
}

// ---------------------------------------------------------------------------
// FakeDocumentPort / FakeHostStore
// ---------------------------------------------------------------------------

export class FakeDocumentPort implements RuntimeDocumentPort {
  private snapshot: DocumentSnapshot;
  private status: RuntimeDocumentStatus = { kind: "ready", dirty: false };
  private readonly listeners = new Set<() => void>();

  constructor(snapshot: DocumentSnapshot) {
    this.snapshot = snapshot;
  }

  getSnapshot = (): DocumentSnapshot => {
    return this.snapshot;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  };

  getStatus(): RuntimeDocumentStatus {
    return this.status;
  }

  setStatus(status: RuntimeDocumentStatus): void {
    this.status = status;
  }

  update(snapshot: DocumentSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }
}

export class FakeHostStore implements RuntimeHostStore {
  private snapshot: HostSnapshot;
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(overrides: Partial<HostSnapshot> = {}) {
    this.snapshot = {
      hostId: "host-1",
      sourcePath: "home.components",
      ownerDocument: document,
      ownerWindow: window,
      containerSize: { width: 1000, height: 800 },
      responsiveMode: "wide",
      isAttached: true,
      isHostVisible: true,
      theme: fakeTheme(),
      ...overrides,
    };
  }

  getSnapshot = (): HostSnapshot => {
    return this.snapshot;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  };

  update(partial: Partial<HostSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}

// ---------------------------------------------------------------------------
// FakePlatformPort
// ---------------------------------------------------------------------------

export class FakePlatformPort {
  readonly notices = {
    shown: [] as Array<{ message: string; level?: string; timeoutMs?: number }>,
    show: (message: string, options?: { level?: string; timeoutMs?: number }): void => {
      this.notices.shown.push({ message, ...options });
    },
  };
  readonly openedFiles: Array<{ path: string; options?: Record<string, unknown> }> = [];
  readonly openedUrls: string[] = [];
  readonly executedCommands: string[] = [];
  readonly writtenClipboard: string[] = [];
  readonly createdFiles: Array<{ path: string; text: string }> = [];
  readonly frontmatterUpdates: Array<{ path: string; patch: unknown }> = [];
  readonly taskUpdates: Array<{ locator: unknown; nextStatus: string }> = [];
  readonly diagnostics = { reported: [] as unknown[], warnings: [] as unknown[] };

  confirmResult = true;
  commandAllowlist = new Set<string>();

  readonly componentsStorage = {
    paths: {
      normalize: (input: string) => ({ ok: true as const, value: input }),
      resolve: (input: string) => ({ ok: true as const, value: input }),
      isInsideVault: () => true,
    },
  };
  readonly vaultRead = {
    paths: {
      normalize: (input: string) => ({ ok: true as const, value: input }),
      resolve: (input: string) => ({ ok: true as const, value: input }),
      isInsideVault: () => true,
    },
    stat: async () => ({ ok: true as const, value: null }),
    readText: async (path: string) => ({
      ok: true as const,
      value: { path, text: "# 测试\n", rawHash: "hash", mtimeMs: 0, sizeBytes: 0 },
    }),
    list: async () => ({ ok: true as const, value: [] }),
    subscribe: () => () => {},
  };
  readonly vaultMutation = {
    createText: async (input: { path: string; text: string }) => {
      this.createdFiles.push({ path: input.path, text: input.text });
      return { ok: true as const, value: { path: input.path, text: input.text, rawHash: "h", mtimeMs: 0, sizeBytes: 0 } };
    },
    updateFrontmatter: async (input: { path: string; patch: unknown }) => {
      this.frontmatterUpdates.push({ path: input.path, patch: input.patch });
      return { ok: true as const, value: { path: input.path, text: "", rawHash: "h", mtimeMs: 0, sizeBytes: 0 } };
    },
    updateMarkdownTask: async (input: { locator: unknown; nextStatus: string }) => {
      this.taskUpdates.push({ locator: input.locator, nextStatus: input.nextStatus });
      return { ok: true as const, value: { path: "", text: "", rawHash: "h", mtimeMs: 0, sizeBytes: 0 } };
    },
  };
  readonly workspace = {
    getActiveFile: () => null,
    openFile: async (path: string, options?: Record<string, unknown>) => {
      this.openedFiles.push({ path, options });
      return { ok: true as const, value: undefined };
    },
    revealFile: async () => ({ ok: true as const, value: undefined }),
    openComponentsDocument: async () => ({ ok: true as const, value: undefined }),
  };
  readonly markdown = {
    render: async () => ({ ok: true as const, value: undefined }),
  };
  readonly commands = {
    list: () => [],
    execute: async (commandId: string) => {
      this.executedCommands.push(commandId);
      return { ok: true as const, value: undefined };
    },
    isAllowlisted: (commandId: string) => this.commandAllowlist.has(commandId),
  };
  readonly theme = {
    getSnapshot: () => fakeTheme(),
    subscribe: () => () => {},
  };
  readonly clipboard = {
    writeText: async (text: string) => {
      this.writtenClipboard.push(text);
      return { ok: true as const, value: undefined };
    },
  };
  readonly clock = {
    now: () => Date.now(),
    timeout: (callback: () => void, delayMs: number) => {
      const id = setTimeout(callback, delayMs);
      return { dispose: () => clearTimeout(id) };
    },
    interval: (callback: () => void, intervalMs: number) => {
      const id = setInterval(callback, intervalMs);
      return { dispose: () => clearInterval(id) };
    },
    aligned: (callback: () => void) => {
      const id = setTimeout(callback, 1000);
      return { dispose: () => clearTimeout(id) };
    },
  };
  readonly externalUrls = {
    open: async (url: string) => {
      this.openedUrls.push(url);
      return { ok: true as const, value: undefined };
    },
  };
  readonly confirmations = {
    confirm: async () => this.confirmResult,
  };

  getPlatformInfo() {
    return {
      kind: "obsidian" as const,
      appVersion: "1.0",
      pluginVersion: "0.1.0",
      locale: "zh-CN",
      vaultId: TEST_VAULT,
      isDesktop: true,
      isMobile: false,
    };
  }
}

// ---------------------------------------------------------------------------
// 可配置 CapabilityBroker / Diagnostics
// ---------------------------------------------------------------------------

export class ConfigurableCapabilities implements CapabilityBroker {
  decision: CapabilityDecision;
  requestGrantCalls: Array<{ capability: Capability; trigger: ActionTrigger }> = [];

  constructor(decision: CapabilityDecision) {
    this.decision = decision;
  }

  evaluate(
    _subject: CapabilitySubject,
    capability: Capability,
  ): CapabilityDecision {
    return { ...this.decision, capability };
  }

  requestGrant(input: {
    capability: Capability;
    trigger: ActionTrigger;
  }): Promise<CapabilityDecision> {
    this.requestGrantCalls.push({ capability: input.capability, trigger: input.trigger });
    return Promise.resolve({ ...this.decision, capability: input.capability });
  }

  assert(
    _subject: CapabilitySubject,
    capability: Capability,
  ): Result<void> {
    return this.decision.granted
      ? { ok: true, value: undefined }
      : {
          ok: false,
          error: {
            code: ERROR_CODES.CAPABILITY_DENIED,
            message: capability,
            scope: "capability",
            recoverable: false,
            retryable: false,
          },
        };
  }

  revoke(): Promise<Result<void>> {
    return Promise.resolve({ ok: true, value: undefined });
  }
}

export class FakeDiagnostics {
  reported: Array<{ code: string; message: string }> = [];
  warnings: Array<{ code: string; message: string }> = [];
  report = (error: { code: string; message: string }): void => {
    this.reported.push(error);
  };
  warning = (issue: { code: string; message: string }): void => {
    this.warnings.push(issue);
  };
  markPerformance = (): void => {};
}

export function assembleServices(input: {
  platform: FakePlatformPort;
  registry: FakeRegistry;
  document: FakeDocumentPort;
  host: FakeHostStore;
  diagnostics?: FakeDiagnostics;
}): RuntimeServices {
  return createRuntimeServices({
    platform: input.platform as unknown as PlatformPort,
    registry: input.registry,
    document: input.document,
    host: input.host,
    hostState: new HostStateStore(),
    diagnostics: input.diagnostics,
  });
}
