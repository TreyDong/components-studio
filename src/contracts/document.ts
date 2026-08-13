/**
 * @ocs/contracts/document
 *
 * 《文档与会话协议 v1》冻结的所有 `*V1` 文档、Command、Migration、Storage、
 * Session DTO 的唯一 TypeScript 定义。只依赖 @ocs/contracts/common。
 */

import type {
  ActionId,
  BindingId,
  CommandId,
  ComponentId,
  ComponentType,
  ConflictId,
  DataSourceId,
  DeepReadonly,
  DocumentId,
  ErrorCode,
  JsonObject,
  JsonPointer,
  JsonPointerPattern,
  JsonValue,
  NamespacedKey,
  Result,
  TransactionId,
  UtcIsoDateTime,
  ValidationIssue,
  ValidationResult,
} from "./common";

export type { ValidationIssue, ValidationResult };

// ---------------------------------------------------------------------------
// 别名与运行期 Schema
// ---------------------------------------------------------------------------

/** 兼容早期命名；唯一结构由 common 导出。 */
export type ValidationIssueV1 = ValidationIssue;

/** 兼容早期命名；工程中由 common 的 ERROR_CODES 常量生成。 */
export type ErrorCodeV1 = ErrorCode;

/** Runtime Registry 中的 Schema 对象采用 JSON Schema 2020-12 受控子集；必须可 JSON 序列化。 */
export type RuntimeJsonSchema = JsonObject;

// ---------------------------------------------------------------------------
// 标识符
// ---------------------------------------------------------------------------

export type BindingIdV1 = BindingId;
export type CommandIdV1 = CommandId;
export type ConflictIdV1 = ConflictId;
export type TransactionIdV1 = TransactionId;
export type DataSourceType = string & { readonly __brand: "DataSourceType" };

// ---------------------------------------------------------------------------
// 顶层文档
// ---------------------------------------------------------------------------

export type CapabilityV1 =
  | "vault:read"
  | "vault:create"
  | "vault:modify"
  | "workspace:navigate"
  | "command:execute"
  | "clipboard:write"
  | "external-url:open"
  | "query:read"
  | "timer:use"
  | "network:request";

export interface CapabilityRequestV1 {
  capability: CapabilityV1;
  reason: string;
}

export interface PermissionManifestV1 {
  requested: CapabilityRequestV1[];
}

export interface DocumentMetadataV1 {
  title: string;
  description: string;
  tags: string[];
}

export interface ComponentsDocumentV1 {
  kind: "components-studio/document";
  formatVersion: 1;

  documentId: DocumentId;
  revision: number;
  createdAt: UtcIsoDateTime;
  updatedAt: UtcIsoDateTime;

  rootId: ComponentId;
  nodes: Record<ComponentId, ComponentNodeV1>;
  dataSources: Record<DataSourceId, PersistedDataSourceSpecV1>;

  permissions: PermissionManifestV1;
  metadata: DocumentMetadataV1;
  extensions: Record<NamespacedKey, JsonValue>;
}

// ---------------------------------------------------------------------------
// 通用样式
// ---------------------------------------------------------------------------

export interface EdgeInsetsV1 {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type ThemeColorTokenV1 =
  | "background"
  | "surface"
  | "surface-hover"
  | "text"
  | "text-muted"
  | "border"
  | "accent"
  | "danger"
  | "success"
  | "warning";

export type ColorRefV1 =
  | { kind: "token"; value: ThemeColorTokenV1 }
  | { kind: "literal"; value: string };

export interface BorderStyleV1 {
  widthPx: number;
  style: "solid" | "dashed" | "dotted";
  color: ColorRefV1;
  radiusPx: number;
}

export interface NodeStyleV1 {
  visibility: "visible" | "hidden";
  classNames: string[];
  width: "auto" | "fill";
  minHeightPx: number | null;
  paddingPx: EdgeInsetsV1;
  marginPx: EdgeInsetsV1;
  background: ColorRefV1 | null;
  color: ColorRefV1 | null;
  border: BorderStyleV1 | null;
  shadow: "none" | "sm" | "md" | "lg";
}

// ---------------------------------------------------------------------------
// Child Placement
// ---------------------------------------------------------------------------

export interface TabPlacementV1 {
  title: string | null;
  icon: string | null;
  disabled: boolean;
}

export interface ColumnPlacementV1 {
  basisBp: number;
  grow: number;
  shrink: number;
  minWidthPx: number;
  maxWidthPx: number | null;
}

export interface GridRectV1 {
  x: number;
  y: number;
  w: number;
  h: number;
  minW: number;
  maxW: number | null;
  minH: number;
  maxH: number | null;
}

export interface ResponsiveGridPlacementV1 {
  compact: GridRectV1;
  regular: GridRectV1;
  wide: GridRectV1;
}

export interface ChildPlacementV1 {
  tab: TabPlacementV1;
  column: ColumnPlacementV1;
  grid: ResponsiveGridPlacementV1;
  extensions: Record<NamespacedKey, JsonValue>;
}

export interface ChildRefV1 {
  nodeId: ComponentId;
  placement: ChildPlacementV1;
}

// ---------------------------------------------------------------------------
// 组件节点
// ---------------------------------------------------------------------------

export interface ComponentNodeV1 {
  id: ComponentId;
  type: ComponentType;
  specVersion: number;

  enabled: boolean;
  label: string | null;

  props: JsonObject;
  style: NodeStyleV1;

  slots: Record<string, ChildRefV1[]>;
  bindings: BindingSpecV1[];
  events: Record<string, EventSequenceV1>;

  extensions: Record<NamespacedKey, JsonValue>;
}

// ---------------------------------------------------------------------------
// DataSource
// ---------------------------------------------------------------------------

export type DataSourceRefreshV1 =
  | { mode: "on-vault-change" }
  | { mode: "manual" }
  | { mode: "interval"; intervalMs: number };

export interface DataSourceSpecV1 {
  id: DataSourceId;
  type: "vault.query";
  specVersion: number;
  enabled: boolean;
  label: string | null;
  config: JsonObject;
  refresh: DataSourceRefreshV1;
  extensions: Record<NamespacedKey, JsonValue>;
}

export interface OpaqueDataSourceSpecV1 {
  id: DataSourceId;
  type: string;
  specVersion: number;
  raw: JsonObject;
  classification: "unknown" | "future";
}

export type PersistedDataSourceSpecV1 =
  | DataSourceSpecV1
  | OpaqueDataSourceSpecV1;

export interface DataSourceMigrationV1 {
  readonly type: string;
  readonly from: number;
  readonly to: number;
  migrate(
    input: DeepReadonly<DataSourceSpecV1>,
    context: DeterministicMigrationContextV1,
  ): Result<DataSourceSpecV1>;
}

export interface DataSourceDefinitionV1 {
  type: "vault.query";
  currentSpecVersion: number;
  configSchema: RuntimeJsonSchema;
  outputSchema: RuntimeJsonSchema;
  migrations: readonly DataSourceMigrationV1[];
}

// ---------------------------------------------------------------------------
// Binding 与安全表达式
// ---------------------------------------------------------------------------

export type BuiltinFunctionV1 =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "and"
  | "or"
  | "not"
  | "coalesce"
  | "concat"
  | "lower"
  | "upper"
  | "trim"
  | "length"
  | "includes"
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "round"
  | "min"
  | "max"
  | "formatDate";

export type ExpressionContextNameV1 =
  | "document"
  | "currentFile"
  | "node"
  | "state"
  | "event"
  | "outputs";

export type ExprV1 =
  | { op: "literal"; value: JsonValue }
  | { op: "context"; name: ExpressionContextNameV1 }
  | { op: "source"; sourceId: DataSourceId }
  | { op: "get"; value: ExprV1; pointer: string }
  | { op: "call"; fn: BuiltinFunctionV1; args: ExprV1[] }
  | { op: "if"; condition: ExprV1; then: ExprV1; else: ExprV1 }
  | { op: "array"; items: ExprV1[] }
  | { op: "object"; entries: Record<string, ExprV1> };

export interface BindingSpecV1 {
  id: BindingId;
  target: string;
  expr: ExprV1;
  pendingValue: JsonValue;
  fallbackValue: JsonValue;
  onError: "use-fallback" | "use-static" | "hide-node" | "show-error";
}

// ---------------------------------------------------------------------------
// Event 与 Action
// ---------------------------------------------------------------------------

export type ActionTypeV1 =
  | "file.open"
  | "url.open"
  | "command.execute"
  | "file.create"
  | "frontmatter.update"
  | "markdown.task.update"
  | "clipboard.copy"
  | "notice.show";

export interface ConfirmationSpecV1 {
  mode: "never" | "if-untrusted" | "always";
  title: string | null;
  message: string | null;
  confirmLabel: string | null;
  cancelLabel: string | null;
  danger: boolean;
}

export interface BaseActionSpecV1 {
  id: ActionId;
  type: ActionTypeV1;
  specVersion: number;
  enabled: boolean;
  label: string | null;
  when: ExprV1 | null;
  resultKey: string | null;
  timeoutMs: number;
  confirmation: ConfirmationSpecV1;
  onError: "stop" | "continue";
  extensions: Record<NamespacedKey, JsonValue>;
}

export interface OpenFileActionV1 extends BaseActionSpecV1 {
  type: "file.open";
  path: ExprV1;
  disposition: "current-tab" | "new-tab" | "split";
  line: ExprV1 | null;
  column: ExprV1 | null;
}

export interface OpenUrlActionV1 extends BaseActionSpecV1 {
  type: "url.open";
  url: ExprV1;
}

export interface ExecuteCommandActionV1 extends BaseActionSpecV1 {
  type: "command.execute";
  commandId: ExprV1;
}

export interface CreateFileActionV1 extends BaseActionSpecV1 {
  type: "file.create";
  path: ExprV1;
  content: ExprV1;
  createParents: boolean;
  ifExists: "error" | "open-existing" | "append-number";
  openAfterCreate: boolean;
}

export type FrontmatterPatchSpecV1 =
  | { op: "set"; key: ExprV1; value: ExprV1 }
  | { op: "delete"; key: ExprV1 }
  | { op: "append"; key: ExprV1; value: ExprV1; unique: boolean };

export interface UpdateFrontmatterActionV1 extends BaseActionSpecV1 {
  type: "frontmatter.update";
  path: ExprV1;
  patches: FrontmatterPatchSpecV1[];
}

export interface MarkdownTaskLocatorSpecV1 {
  path: ExprV1;
  expectedRawHash: ExprV1;
  line: ExprV1;
  expectedLineText: ExprV1;
  expectedStatus: ExprV1;
  blockId: ExprV1 | null;
}

export interface UpdateMarkdownTaskActionV1 extends BaseActionSpecV1 {
  type: "markdown.task.update";
  locator: MarkdownTaskLocatorSpecV1;
  nextStatus: ExprV1;
}

export interface CopyTextActionV1 extends BaseActionSpecV1 {
  type: "clipboard.copy";
  text: ExprV1;
  successMessage: ExprV1 | null;
}

export interface ShowNoticeActionV1 extends BaseActionSpecV1 {
  type: "notice.show";
  message: ExprV1;
  level: "info" | "success" | "warning" | "error";
  durationMs: number;
}

export type ActionSpecV1 =
  | OpenFileActionV1
  | OpenUrlActionV1
  | ExecuteCommandActionV1
  | CreateFileActionV1
  | UpdateFrontmatterActionV1
  | UpdateMarkdownTaskActionV1
  | CopyTextActionV1
  | ShowNoticeActionV1;

export interface OpaqueActionSpecV1 {
  id: ActionId;
  type: string;
  specVersion: number;
  raw: JsonObject;
  classification: "unknown" | "future";
}

export type PersistedActionSpecV1 = ActionSpecV1 | OpaqueActionSpecV1;

export interface EventSequenceV1 {
  concurrency: "drop" | "restart" | "queue";
  maxQueue: number;
  preventDefault: boolean;
  stopPropagation: boolean;
  actions: PersistedActionSpecV1[];
}

export interface EventDefinitionV1 {
  name: string;
  payloadSchema: RuntimeJsonSchema;
}

export interface ActionDefinitionV1 {
  type: ActionTypeV1;
  currentSpecVersion: number;
  persistedSchema: RuntimeJsonSchema;
  evaluatedInputSchema: RuntimeJsonSchema;
  outputSchema: RuntimeJsonSchema;
  migrations: readonly ActionMigrationV1[];
  minimumConfirmation: "never" | "if-untrusted" | "always";
  requiredCapabilities(evaluatedInput: JsonObject): readonly CapabilityV1[];
}

export interface ActionMigrationV1 {
  readonly type: string;
  readonly from: number;
  readonly to: number;
  migrate(
    input: DeepReadonly<ActionSpecV1>,
    context: DeterministicMigrationContextV1,
  ): Result<ActionSpecV1>;
}

// ---------------------------------------------------------------------------
// Registry 解析结果
// ---------------------------------------------------------------------------

export type ComponentResolutionV1 =
  | {
      kind: "known";
      definition: unknown;
    }
  | {
      kind: "unknown";
      type: ComponentType;
    }
  | {
      kind: "future";
      definition: unknown;
      fileSpecVersion: number;
      supportedSpecVersion: number;
    };

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------

export interface MigratedTypeRecordV1 {
  type: string;
  from: number;
  to: number;
}

export interface ParsedDocumentV1 {
  document: DeepReadonly<ComponentsDocumentV1>;
  originalText: string;
  rawHash: string;
  semanticHash: string;
  contentHash: string;
  migratedFromFormatVersion: number | null;
  migratedTypes: readonly MigratedTypeRecordV1[];
  diagnostics: readonly DiagnosticV1[];
}

export interface DocumentCodecV1 {
  parseUtf8(bytes: Uint8Array): Result<ParsedDocumentV1>;
  serialize(document: DeepReadonly<ComponentsDocumentV1>): Result<string>;
  validate(document: unknown): ValidationResult<ComponentsDocumentV1>;
  semanticHash(document: DeepReadonly<ComponentsDocumentV1>): Result<string>;
  contentHash(document: DeepReadonly<ComponentsDocumentV1>): Result<string>;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export interface DeterministicMigrationContextV1 {
  readonly documentId: DocumentId;
  readonly sourceRawHash: string;
  stableId(scope: string, oldIdentity: string): string;
}

export interface FormatMigrationV1 {
  readonly from: number;
  readonly to: number;
  migrate(
    input: DeepReadonly<JsonObject>,
    context: DeterministicMigrationContextV1,
  ): Result<JsonObject>;
}

export interface ComponentMigrationV1 {
  readonly type: ComponentType;
  readonly from: number;
  readonly to: number;
  migrate(
    input: DeepReadonly<ComponentNodeV1>,
    context: DeterministicMigrationContextV1,
  ): Result<ComponentNodeV1>;
}

export type MigrationKind = "format" | "component" | "data-source" | "action";

export interface Migration<T> {
  from: number;
  to: number;
  migrate(input: Readonly<T>, context: DeterministicMigrationContextV1): Result<T>;
}

// ---------------------------------------------------------------------------
// DocumentBuilder
// ---------------------------------------------------------------------------

export interface CreateDocumentInputV1 {
  title: string;
  description: string;
  tags: string[];
  now: UtcIsoDateTime;
}

export interface DocumentBuilderV1 {
  create(input: CreateDocumentInputV1): Result<ComponentsDocumentV1>;
  clone(
    source: DeepReadonly<ComponentsDocumentV1>,
    input: { documentId: DocumentId; now: UtcIsoDateTime },
  ): Result<ComponentsDocumentV1>;
}

// ---------------------------------------------------------------------------
// Legacy Importer
// ---------------------------------------------------------------------------

export interface LegacyComponents25Document {
  rootComponentId: string;
  components: JsonObject[];
}

export interface LegacyImportInputV1 {
  sourcePath: string;
  sourceBytes: Uint8Array;
  targetPath: string;
  now: UtcIsoDateTime;
}

export interface LegacyImportReportV1 {
  sourceRawHash: string;
  targetDocumentId: DocumentId;
  mappedIds: Record<string, ComponentId>;
  converted: readonly {
    oldId: string;
    newId: ComponentId;
    oldType: string;
    newType: ComponentType;
  }[];
  preservedAsLegacy: readonly {
    oldId: string;
    newId: ComponentId;
    oldType: string;
    reason: string;
  }[];
  warnings: readonly DiagnosticV1[];
}

export interface LegacyComponents25ImporterV1 {
  inspect(bytes: Uint8Array): Result<LegacyComponents25Document>;
  convert(input: LegacyImportInputV1): Result<{
    document: ComponentsDocumentV1;
    report: LegacyImportReportV1;
  }>;
}

export interface LegacyComponents25PropsV1 {
  legacyType: string;
  legacyNode: JsonObject;
  sourceRawHash: string;
}

// ---------------------------------------------------------------------------
// Document Command 协议
// ---------------------------------------------------------------------------

export interface CommandBaseV1 {
  commandId: CommandId;
}

export interface AddComponentCommandV1 extends CommandBaseV1 {
  kind: "component.add";
  parentId: ComponentId;
  slot: string;
  index: number;
  node: ComponentNodeV1;
  placement: ChildPlacementV1;
}

export interface RemoveComponentCommandV1 extends CommandBaseV1 {
  kind: "component.remove";
  componentId: ComponentId;
}

export interface DuplicateComponentCommandV1 extends CommandBaseV1 {
  kind: "component.duplicate";
  sourceId: ComponentId;
  targetParentId: ComponentId;
  targetSlot: string;
  targetIndex: number;
  targetPlacement: ChildPlacementV1;
}

export interface MoveComponentCommandV1 extends CommandBaseV1 {
  kind: "component.move";
  componentId: ComponentId;
  targetParentId: ComponentId;
  targetSlot: string;
  targetIndex: number;
  targetPlacement: ChildPlacementV1;
}

export interface ReorderComponentsCommandV1 extends CommandBaseV1 {
  kind: "component.reorder";
  parentId: ComponentId;
  slot: string;
  orderedComponentIds: ComponentId[];
}

export interface ReplaceComponentPropsCommandV1 extends CommandBaseV1 {
  kind: "component.props.replace";
  componentId: ComponentId;
  props: JsonObject;
}

export interface SetComponentStyleCommandV1 extends CommandBaseV1 {
  kind: "component.style.set";
  componentId: ComponentId;
  style: NodeStyleV1;
}

export interface SetComponentEnabledCommandV1 extends CommandBaseV1 {
  kind: "component.enabled.set";
  componentId: ComponentId;
  enabled: boolean;
}

export interface SetComponentLabelCommandV1 extends CommandBaseV1 {
  kind: "component.label.set";
  componentId: ComponentId;
  label: string | null;
}

export interface SetChildPlacementCommandV1 extends CommandBaseV1 {
  kind: "component.child-placement.set";
  parentId: ComponentId;
  slot: string;
  childId: ComponentId;
  placement: ChildPlacementV1;
}

export interface PutBindingCommandV1 extends CommandBaseV1 {
  kind: "binding.put";
  componentId: ComponentId;
  binding: BindingSpecV1;
}

export interface RemoveBindingCommandV1 extends CommandBaseV1 {
  kind: "binding.remove";
  componentId: ComponentId;
  bindingId: BindingId;
}

export interface PutEventSequenceCommandV1 extends CommandBaseV1 {
  kind: "event.put";
  componentId: ComponentId;
  eventName: string;
  sequence: EventSequenceV1;
}

export interface RemoveEventSequenceCommandV1 extends CommandBaseV1 {
  kind: "event.remove";
  componentId: ComponentId;
  eventName: string;
}

export interface PutDataSourceCommandV1 extends CommandBaseV1 {
  kind: "data-source.put";
  source: DataSourceSpecV1;
}

export interface RemoveDataSourceCommandV1 extends CommandBaseV1 {
  kind: "data-source.remove";
  sourceId: DataSourceId;
}

export interface ReplaceMetadataCommandV1 extends CommandBaseV1 {
  kind: "document.metadata.replace";
  metadata: DocumentMetadataV1;
}

export interface ReplacePermissionRequestsCommandV1 extends CommandBaseV1 {
  kind: "document.permissions.replace";
  permissions: PermissionManifestV1;
}

export type DocumentCommandV1 =
  | AddComponentCommandV1
  | RemoveComponentCommandV1
  | DuplicateComponentCommandV1
  | MoveComponentCommandV1
  | ReorderComponentsCommandV1
  | ReplaceComponentPropsCommandV1
  | SetComponentStyleCommandV1
  | SetComponentEnabledCommandV1
  | SetComponentLabelCommandV1
  | SetChildPlacementCommandV1
  | PutBindingCommandV1
  | RemoveBindingCommandV1
  | PutEventSequenceCommandV1
  | RemoveEventSequenceCommandV1
  | PutDataSourceCommandV1
  | RemoveDataSourceCommandV1
  | ReplaceMetadataCommandV1
  | ReplacePermissionRequestsCommandV1;

export interface CommandResultV1 {
  transactionId: TransactionId;
  sessionVersion: number;
  contentHash: string;
  createdComponentIds: readonly ComponentId[];
  changedComponentIds: readonly ComponentId[];
  deletedComponentIds: readonly ComponentId[];
  changedDataSourceIds: readonly DataSourceId[];
  idMap: Readonly<Record<string, string>>;
  diagnostics: readonly DiagnosticV1[];
}

// ---------------------------------------------------------------------------
// Transaction 与 Session
// ---------------------------------------------------------------------------

export interface TransactionOptionsV1 {
  label: string;
  expectedSessionVersion: number;
  mergeKey: string | null;
}

export type DirtyReasonV1 = "user-edit" | "migration" | "external-merge";

export type SessionStatusV1 =
  | { kind: "loading" }
  | { kind: "ready"; dirty: boolean; reasons: readonly DirtyReasonV1[] }
  | { kind: "saving"; dirty: boolean; reasons: readonly DirtyReasonV1[] }
  | {
      kind: "save-error";
      dirty: true;
      storageState: "confirmed-base" | "unknown";
      error: RuntimeErrorV1;
    }
  | { kind: "conflict"; context: PendingConflictV1 }
  | {
      kind: "invalid-external";
      remote: FileSnapshotV1;
      diagnostics: readonly DiagnosticV1[];
    }
  | { kind: "missing"; lastKnownPath: string }
  | {
      kind: "read-only";
      reason: "future-format" | "future-root-type" | "storage-read-only";
    }
  | { kind: "error"; error: RuntimeErrorV1 }
  | { kind: "disposed" };

export interface DocumentSessionV1 {
  readonly documentId: DocumentId;

  getPath(): string;
  getStatus(): SessionStatusV1;
  getSnapshot(): DeepReadonly<ComponentsDocumentV1>;
  getSessionVersion(): number;
  getContentHash(): string;

  subscribe(listener: () => void): () => void;

  dispatch(
    commands: DocumentCommandV1 | readonly DocumentCommandV1[],
    options: TransactionOptionsV1,
  ): Result<CommandResultV1>;

  canUndo(): boolean;
  canRedo(): boolean;
  undo(): Result<CommandResultV1>;
  redo(): Result<CommandResultV1>;

  save(reason: "manual" | "autosave" | "close"): Promise<Result<SaveResultV1>>;
  resolveConflict(resolution: ConflictResolutionV1): Promise<Result<void>>;
  saveCopy(path: string): Promise<Result<FileSnapshotV1>>;
  dispose(): Promise<Result<void>>;
}

// ---------------------------------------------------------------------------
// StoragePort 与严格文本 CAS
// ---------------------------------------------------------------------------

export interface FileSnapshotV1 {
  path: string;
  text: string;
  rawHash: string;
  mtimeMs: number;
  sizeBytes: number;
}

export type StorageEventV1 =
  | { kind: "modified"; path: string }
  | { kind: "renamed"; oldPath: string; newPath: string }
  | { kind: "deleted"; path: string }
  | { kind: "created"; path: string };

export type CasTextResultV1 =
  | { kind: "written"; snapshot: FileSnapshotV1 }
  | { kind: "conflict"; current: FileSnapshotV1 }
  | { kind: "missing" }
  | {
      kind: "indeterminate";
      current: FileSnapshotV1 | null;
      error: RuntimeErrorV1;
    };

export interface StoragePortV1 {
  readText(path: string): Promise<Result<FileSnapshotV1>>;

  compareAndSwapText(input: {
    path: string;
    expectedText: string;
    expectedRawHash: string;
    nextText: string;
  }): Promise<Result<CasTextResultV1>>;

  writeNewText(path: string, text: string): Promise<Result<FileSnapshotV1>>;

  subscribe(
    path: string,
    listener: (event: StorageEventV1) => void,
  ): () => void;
}

// ---------------------------------------------------------------------------
// SaveResult
// ---------------------------------------------------------------------------

export type SaveResultV1 =
  | {
      kind: "no-op";
      reason: "clean";
      snapshot: FileSnapshotV1;
    }
  | {
      kind: "saved";
      snapshot: FileSnapshotV1;
      persistedRevision: number;
      savedSessionVersion: number;
      stillDirty: boolean;
    }
  | {
      kind: "conflict";
      current: FileSnapshotV1;
    }
  | {
      kind: "missing";
      lastKnownPath: string;
    }
  | {
      kind: "indeterminate";
      current: FileSnapshotV1 | null;
      error: RuntimeErrorV1;
    };

// ---------------------------------------------------------------------------
// 三方 Merge 与 Conflict
// ---------------------------------------------------------------------------

export interface PendingConflictV1 {
  base: DeepReadonly<ComponentsDocumentV1>;
  local: DeepReadonly<ComponentsDocumentV1>;
  remote: DeepReadonly<ComponentsDocumentV1>;
  remoteSnapshot: FileSnapshotV1;
  autoMergedCandidate: DeepReadonly<ComponentsDocumentV1> | null;
  conflicts: readonly MergeConflictV1[];
}

export type MaybeJsonValueV1 =
  | { kind: "missing" }
  | { kind: "value"; value: JsonValue };

export interface MergeConflictV1 {
  id: ConflictId;
  kind:
    | "value"
    | "delete-modify"
    | "duplicate-add"
    | "move-move"
    | "delete-move"
    | "order-order"
    | "document-identity"
    | "type-version";
  pointer: string;
  componentId: ComponentId | null;
  base: MaybeJsonValueV1;
  local: MaybeJsonValueV1;
  remote: MaybeJsonValueV1;
}

export type ConflictResolutionV1 =
  | { kind: "accept-remote"; confirmedDiscardLocal: true }
  | { kind: "keep-local"; confirmedOverwriteRemote: true }
  | { kind: "manual"; choices: Record<ConflictId, "local" | "remote"> };

// ---------------------------------------------------------------------------
// RecoveryPort 与迁移备份
// ---------------------------------------------------------------------------

export type RecoveryReasonV1 =
  | "close-save-failed"
  | "accept-remote-discard-local"
  | "keep-local-before-overwrite"
  | "invalid-external-overwrite"
  | "plugin-unload-dirty"
  | "manual";

export interface RecoveryRecordV1 {
  kind: "components-studio/recovery";
  recordVersion: 1;
  recordId: string;
  vaultId: string;
  documentId: DocumentId;
  originPath: string;
  baseRawHash: string | null;
  contentHash: string;
  createdAt: UtcIsoDateTime;
  reason: RecoveryReasonV1;
  documentText: string;
}

export interface MigrationBackupRecordV1 {
  kind: "components-studio/migration-backup";
  recordVersion: 1;
  recordId: string;
  vaultId: string;
  documentId: DocumentId | null;
  originPath: string;
  sourceRawHash: string;
  sourceFormat: "components-studio" | "components-2.5";
  sourceFormatVersion: number | null;
  createdAt: UtcIsoDateTime;
  originalText: string;
}

export interface RecoveryPortV1 {
  writeRecovery(record: RecoveryRecordV1): Promise<Result<RecoveryRecordV1>>;
  writeMigrationBackup(
    record: MigrationBackupRecordV1,
  ): Promise<Result<MigrationBackupRecordV1>>;
  listRecoveries(
    documentId?: DocumentId,
  ): Promise<Result<readonly RecoveryRecordV1[]>>;
  readRecovery(recordId: string): Promise<Result<RecoveryRecordV1>>;
  deleteRecovery(recordId: string): Promise<Result<void>>;
}

// ---------------------------------------------------------------------------
// 错误与诊断
// ---------------------------------------------------------------------------

export interface RuntimeErrorV1 {
  code: ErrorCode;
  message: string;
  scope:
    | "document"
    | "session"
    | "storage"
    | "migration"
    | "import"
    | "recovery";
  recoverable: boolean;
  retryable: boolean;
  pointer: string | null;
  componentId: ComponentId | null;
  details: JsonObject;
}

export interface DiagnosticV1 {
  code: ErrorCode;
  severity: "info" | "warning" | "error" | "fatal";
  message: string;
  pointer: string | null;
  componentId: ComponentId | null;
  recoverable: boolean;
  details: JsonObject;
}

// ---------------------------------------------------------------------------
// 位置与常量辅助
// ---------------------------------------------------------------------------

/** 默认 NodeStyle（文档协议第 5.2 节冻结）。 */
export const DEFAULT_NODE_STYLE_V1: NodeStyleV1 = Object.freeze({
  visibility: "visible",
  classNames: [],
  width: "auto",
  minHeightPx: null,
  paddingPx: { top: 0, right: 0, bottom: 0, left: 0 },
  marginPx: { top: 0, right: 0, bottom: 0, left: 0 },
  background: null,
  color: null,
  border: null,
  shadow: "none",
});

/** 默认 ChildPlacement（文档协议第 3.7 节冻结）。 */
export const DEFAULT_CHILD_PLACEMENT_V1: ChildPlacementV1 = Object.freeze({
  tab: { title: null, icon: null, disabled: false },
  column: {
    basisBp: 10000,
    grow: 0,
    shrink: 1,
    minWidthPx: 0,
    maxWidthPx: null,
  },
  grid: {
    compact: { x: 0, y: 0, w: 1, h: 4, minW: 1, maxW: null, minH: 1, maxH: null },
    regular: { x: 0, y: 0, w: 3, h: 4, minW: 1, maxW: null, minH: 1, maxH: null },
    wide: { x: 0, y: 0, w: 4, h: 4, minW: 1, maxW: null, minH: 1, maxH: null },
  },
  extensions: {},
});

/**
 * 响应式断点按 Host 容器宽度（非全局窗口）：
 * compact: 0..479 / regular: 480..839 / wide: 840+
 */
export type ResponsiveMode = "compact" | "regular" | "wide";

export function responsiveModeForWidth(width: number): ResponsiveMode {
  if (width < 480) return "compact";
  if (width < 840) return "regular";
  return "wide";
}

/** Column 基点总和必须严格等于 10,000。 */
export const COLUMN_BASIS_TOTAL = 10_000;

export const DOCUMENT_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxNodes: 10_000,
  maxDataSources: 1_000,
  maxPropsBytes: 1024 * 1024,
  maxBindingsPerNode: 256,
  maxActionsPerEvent: 100,
  maxEventsPerNode: 64,
  maxTreeDepth: 128,
  maxStringCodePoints: 1_048_576,
  maxExprAstNodes: 256,
  maxExprDepth: 32,
  maxExprOperations: 10_000,
  maxExprOutputBytes: 1_048_576,
} as const;

export type { JsonPointer, JsonPointerPattern };
