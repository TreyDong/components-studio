/**
 * @ocs/contracts/common
 *
 * 公共 JSON 值、ID、Result、Validation 与 Error 的唯一 TypeScript 定义。
 * 本文件是《技术规格 v1》第 5.1 节与《运行时与 SDK 协议 v1》第 1 章冻结的唯一声明。
 * contracts 只能依赖其他 contracts，不得依赖 React、Obsidian、Runtime 或 Adapter。
 */

// ---------------------------------------------------------------------------
// JSON 值
// ---------------------------------------------------------------------------

export type JsonPrimitive = string | number | boolean | null;

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

/** RFC 6901 JSON Pointer 字符串。 */
export type JsonPointer = string;

/** JSON Pointer 模式串（Definition.bindableTargets 使用）。 */
export type JsonPointerPattern = string;

// ---------------------------------------------------------------------------
// 品牌字符串与 ID
// ---------------------------------------------------------------------------

type Brand<T, B extends string> = T & { readonly __brand: B };

export type VaultId = Brand<string, "VaultId">;
export type DocumentId = Brand<string, "DocumentId">;
export type ComponentId = Brand<string, "ComponentId">;
export type DataSourceId = Brand<string, "DataSourceId">;
export type ActionId = Brand<string, "ActionId">;
export type EventId = Brand<string, "EventId">;
export type QueryId = Brand<string, "QueryId">;
export type RequestId = Brand<string, "RequestId">;
export type BindingId = Brand<string, "BindingId">;
export type CommandId = Brand<string, "CommandId">;
export type ConflictId = Brand<string, "ConflictId">;
export type TransactionId = Brand<string, "TransactionId">;
export type SubscriptionId = Brand<string, "SubscriptionId">;
export type PathKey = Brand<string, "PathKey">;
export type TaskRowId = Brand<string, "TaskRowId">;
export type Generation = Brand<number, "Generation">;
export type IndexRevision = Brand<number, "IndexRevision">;
export type IconName = Brand<string, "IconName">;
export type UtcIsoDateTime = Brand<string, "UtcIsoDateTime">;
export type ISODateTime = string;

/**
 * 类型名（ComponentType / DataSourceType / ActionType）与扩展键的统一形状：
 * `^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$`
 */
export type ComponentType = Brand<string, "ComponentType">;
export type NamespacedKey = Brand<string, "NamespacedKey">;

/** 保留命名空间：Component / Extension。 */
export const RESERVED_COMPONENT_NAMESPACES = [
  "core",
  "data",
  "time",
  "action",
  "system",
  "legacy",
] as const;

/** 保留命名空间：Extension 键。 */
export const RESERVED_EXTENSION_NAMESPACES = [
  "core",
  "system",
  "components-studio",
] as const;

export const TYPE_NAMESPACE_PATTERN =
  /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

export const SLOT_NAME_PATTERN = /^[a-z][a-zA-Z0-9-]{0,63}$/;

export const RESULT_KEY_PATTERN = /^[a-z][a-zA-Z0-9_]{0,63}$/;

export const ALIAS_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export const CLASS_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/;

/** 小写 UUID v4 形状。 */
export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidV4(value: string): boolean {
  return UUID_V4_PATTERN.test(value);
}

export function isComponentType(value: string): value is ComponentType {
  return TYPE_NAMESPACE_PATTERN.test(value);
}

export function isNamespacedKey(value: string): value is NamespacedKey {
  return TYPE_NAMESPACE_PATTERN.test(value);
}

export function isUtcIsoDateTime(value: string): value is UtcIsoDateTime {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

export function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

export function isSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value);
}

export function isLiteralColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value);
}

/**
 * 打开位置。合法值只以本 contracts 为准。
 */
export type OpenDisposition = "current-tab" | "new-tab" | "split";

// ---------------------------------------------------------------------------
// 错误代码（单一来源常量）
// ---------------------------------------------------------------------------

/**
 * 全部稳定错误码的唯一来源。文档、Session、Binding/Query/Worker、
 * Action/Capability 与 Runtime 的错误码都汇聚在此常量；
 * 实现不得在调用点临时拼接或另行声明局部字符串联合。
 */
export const ERROR_CODES = {
  // --- Document / Session ---
  DOC_TOO_LARGE: "DOC_TOO_LARGE",
  DOC_INVALID_UTF8: "DOC_INVALID_UTF8",
  DOC_BOM_FORBIDDEN: "DOC_BOM_FORBIDDEN",
  DOC_INVALID_JSON: "DOC_INVALID_JSON",
  DOC_DUPLICATE_KEY: "DOC_DUPLICATE_KEY",
  DOC_FORBIDDEN_KEY: "DOC_FORBIDDEN_KEY",
  DOC_KIND_MISMATCH: "DOC_KIND_MISMATCH",
  DOC_SCHEMA_INVALID: "DOC_SCHEMA_INVALID",
  DOC_FORMAT_UNSUPPORTED_FUTURE: "DOC_FORMAT_UNSUPPORTED_FUTURE",
  DOC_ID_INVALID: "DOC_ID_INVALID",
  DOC_ID_KEY_MISMATCH: "DOC_ID_KEY_MISMATCH",
  DOC_REVISION_OVERFLOW: "DOC_REVISION_OVERFLOW",
  DOC_ROOT_MISSING: "DOC_ROOT_MISSING",
  DOC_ROOT_TYPE_INVALID: "DOC_ROOT_TYPE_INVALID",
  DOC_ROOT_VERSION_UNSUPPORTED: "DOC_ROOT_VERSION_UNSUPPORTED",
  DOC_DANGLING_REFERENCE: "DOC_DANGLING_REFERENCE",
  DOC_CYCLE_DETECTED: "DOC_CYCLE_DETECTED",
  DOC_MULTIPLE_PARENTS: "DOC_MULTIPLE_PARENTS",
  DOC_ORPHAN_NODE: "DOC_ORPHAN_NODE",
  DOC_TREE_TOO_DEEP: "DOC_TREE_TOO_DEEP",
  DOC_SLOT_UNKNOWN: "DOC_SLOT_UNKNOWN",
  DOC_SLOT_SET_MISMATCH: "DOC_SLOT_SET_MISMATCH",
  DOC_SLOT_CARDINALITY: "DOC_SLOT_CARDINALITY",
  DOC_CHILD_TYPE_REJECTED: "DOC_CHILD_TYPE_REJECTED",
  DOC_PLACEMENT_INVALID: "DOC_PLACEMENT_INVALID",
  DOC_COLUMN_BASIS_INVALID: "DOC_COLUMN_BASIS_INVALID",
  DOC_GRID_OVERLAP: "DOC_GRID_OVERLAP",

  COMPONENT_TYPE_UNKNOWN: "COMPONENT_TYPE_UNKNOWN",
  COMPONENT_VERSION_UNSUPPORTED: "COMPONENT_VERSION_UNSUPPORTED",
  COMPONENT_PROPS_INVALID: "COMPONENT_PROPS_INVALID",
  COMPONENT_MIGRATION_FAILED: "COMPONENT_MIGRATION_FAILED",
  COMPONENT_RENDER_FAILED: "COMPONENT_RENDER_FAILED",

  DATA_SOURCE_TYPE_UNKNOWN: "DATA_SOURCE_TYPE_UNKNOWN",
  DATA_SOURCE_VERSION_UNSUPPORTED: "DATA_SOURCE_VERSION_UNSUPPORTED",
  DATA_SOURCE_CONFIG_INVALID: "DATA_SOURCE_CONFIG_INVALID",

  ACTION_TYPE_UNKNOWN: "ACTION_TYPE_UNKNOWN",
  ACTION_VERSION_UNSUPPORTED: "ACTION_VERSION_UNSUPPORTED",
  ACTION_VERSION_FUTURE: "ACTION_VERSION_FUTURE",
  ACTION_MIGRATION_FAILED: "ACTION_MIGRATION_FAILED",
  ACTION_INPUT_INVALID: "ACTION_INPUT_INVALID",
  ACTION_INPUT_EVALUATION_FAILED: "ACTION_INPUT_EVALUATION_FAILED",
  ACTION_INPUT_SCHEMA_INVALID: "ACTION_INPUT_SCHEMA_INVALID",
  ACTION_OUTPUT_SCHEMA_INVALID: "ACTION_OUTPUT_SCHEMA_INVALID",
  ACTION_ID_DUPLICATE: "ACTION_ID_DUPLICATE",
  ACTION_RESULT_KEY_DUPLICATE: "ACTION_RESULT_KEY_DUPLICATE",
  ACTION_RESULT_INVALID: "ACTION_RESULT_INVALID",
  ACTION_RESULT_NOT_SERIALIZABLE: "ACTION_RESULT_NOT_SERIALIZABLE",
  ACTION_CAPABILITY_DENIED: "ACTION_CAPABILITY_DENIED",
  ACTION_CONFIRMATION_REJECTED: "ACTION_CONFIRMATION_REJECTED",
  ACTION_TIMEOUT: "ACTION_TIMEOUT",
  ACTION_EXECUTION_FAILED: "ACTION_EXECUTION_FAILED",
  ACTION_CANCELLED: "ACTION_CANCELLED",
  ACTION_QUEUE_FULL: "ACTION_QUEUE_FULL",
  ACTION_TASK_CONFLICT: "ACTION_TASK_CONFLICT",
  ACTION_FRONTMATTER_CONFLICT: "ACTION_FRONTMATTER_CONFLICT",
  ACTION_USER_GESTURE_REQUIRED: "ACTION_USER_GESTURE_REQUIRED",
  ACTION_URL_SCHEME_DENIED: "ACTION_URL_SCHEME_DENIED",
  ACTION_COMMAND_DENIED: "ACTION_COMMAND_DENIED",
  ACTION_TASK_LOCATOR_STALE: "ACTION_TASK_LOCATOR_STALE",

  EVENT_SCHEMA_INVALID: "EVENT_SCHEMA_INVALID",
  EVENT_QUEUE_FULL: "EVENT_QUEUE_FULL",
  EVENT_PAYLOAD_INVALID: "EVENT_PAYLOAD_INVALID",
  EVENT_TRIGGER_DROPPED: "EVENT_TRIGGER_DROPPED",

  BINDING_ID_DUPLICATE: "BINDING_ID_DUPLICATE",
  BINDING_TARGET_DUPLICATE: "BINDING_TARGET_DUPLICATE",
  BINDING_TARGET_OVERLAP: "BINDING_TARGET_OVERLAP",
  BINDING_TARGET_INVALID: "BINDING_TARGET_INVALID",
  BINDING_SOURCE_MISSING: "BINDING_SOURCE_MISSING",
  BINDING_RESULT_INVALID: "BINDING_RESULT_INVALID",

  EXPR_SCHEMA_INVALID: "EXPR_SCHEMA_INVALID",
  EXPR_CONTEXT_UNAVAILABLE: "EXPR_CONTEXT_UNAVAILABLE",
  EXPR_TYPE_MISMATCH: "EXPR_TYPE_MISMATCH",
  EXPR_PATH_NOT_FOUND: "EXPR_PATH_NOT_FOUND",
  EXPR_DIVIDE_BY_ZERO: "EXPR_DIVIDE_BY_ZERO",
  EXPR_BUDGET_EXCEEDED: "EXPR_BUDGET_EXCEEDED",

  MIGRATION_PATH_MISSING: "MIGRATION_PATH_MISSING",
  MIGRATION_FAILED: "MIGRATION_FAILED",
  MIGRATION_OUTPUT_INVALID: "MIGRATION_OUTPUT_INVALID",
  MIGRATION_BACKUP_FAILED: "MIGRATION_BACKUP_FAILED",

  LEGACY_NOT_RECOGNIZED: "LEGACY_NOT_RECOGNIZED",
  LEGACY_DUPLICATE_ID: "LEGACY_DUPLICATE_ID",
  LEGACY_ROOT_MISSING: "LEGACY_ROOT_MISSING",
  LEGACY_DANGLING_REFERENCE: "LEGACY_DANGLING_REFERENCE",
  LEGACY_GRAPH_INVALID: "LEGACY_GRAPH_INVALID",
  LEGACY_TARGET_EXISTS: "LEGACY_TARGET_EXISTS",

  CMD_SESSION_NOT_EDITABLE: "CMD_SESSION_NOT_EDITABLE",
  CMD_SESSION_DISPOSED: "CMD_SESSION_DISPOSED",
  CMD_STALE_SESSION_VERSION: "CMD_STALE_SESSION_VERSION",
  CMD_DUPLICATE_ID: "CMD_DUPLICATE_ID",
  CMD_COMPONENT_NOT_FOUND: "CMD_COMPONENT_NOT_FOUND",
  CMD_PARENT_NOT_FOUND: "CMD_PARENT_NOT_FOUND",
  CMD_COMPONENT_ALREADY_EXISTS: "CMD_COMPONENT_ALREADY_EXISTS",
  CMD_INDEX_OUT_OF_RANGE: "CMD_INDEX_OUT_OF_RANGE",
  CMD_ROOT_DELETE_FORBIDDEN: "CMD_ROOT_DELETE_FORBIDDEN",
  CMD_ROOT_MOVE_FORBIDDEN: "CMD_ROOT_MOVE_FORBIDDEN",
  CMD_WOULD_CREATE_CYCLE: "CMD_WOULD_CREATE_CYCLE",
  CMD_UNKNOWN_COMPONENT_READ_ONLY: "CMD_UNKNOWN_COMPONENT_READ_ONLY",
  CMD_BINDING_NOT_FOUND: "CMD_BINDING_NOT_FOUND",
  CMD_EVENT_NOT_FOUND: "CMD_EVENT_NOT_FOUND",
  CMD_REFERENCED_SOURCE_DELETE: "CMD_REFERENCED_SOURCE_DELETE",
  TX_VALIDATION_FAILED: "TX_VALIDATION_FAILED",

  STORAGE_READ_FAILED: "STORAGE_READ_FAILED",
  STORAGE_WRITE_FAILED: "STORAGE_WRITE_FAILED",
  STORAGE_SUBSCRIBE_FAILED: "STORAGE_SUBSCRIBE_FAILED",
  SAVE_CONFLICT: "SAVE_CONFLICT",
  SAVE_IO_FAILED: "SAVE_IO_FAILED",
  SAVE_VERIFY_FAILED: "SAVE_VERIFY_FAILED",
  SAVE_READ_ONLY: "SAVE_READ_ONLY",
  SAVE_TARGET_EXISTS: "SAVE_TARGET_EXISTS",
  SAVE_COPY_FAILED: "SAVE_COPY_FAILED",
  EXTERNAL_FILE_INVALID: "EXTERNAL_FILE_INVALID",
  EXTERNAL_FILE_DELETED: "EXTERNAL_FILE_DELETED",
  MERGE_CONFLICT: "MERGE_CONFLICT",
  MERGE_RESULT_INVALID: "MERGE_RESULT_INVALID",

  RECOVERY_WRITE_FAILED: "RECOVERY_WRITE_FAILED",
  RECOVERY_READ_FAILED: "RECOVERY_READ_FAILED",
  RECOVERY_VERIFY_FAILED: "RECOVERY_VERIFY_FAILED",
  RECOVERY_NOT_FOUND: "RECOVERY_NOT_FOUND",
  RECOVERY_DELETE_FAILED: "RECOVERY_DELETE_FAILED",
  RECOVERY_QUOTA_EXCEEDED: "RECOVERY_QUOTA_EXCEEDED",

  // --- Registry / NodeFactory ---
  REGISTRY_DEFINITION_INVALID: "REGISTRY_DEFINITION_INVALID",
  REGISTRY_TYPE_CONFLICT: "REGISTRY_TYPE_CONFLICT",
  REGISTRY_COMPANION_DRAFT_INVALID: "REGISTRY_COMPANION_DRAFT_INVALID",
  REGISTRY_COMPANION_KEY_DUPLICATE: "REGISTRY_COMPANION_KEY_DUPLICATE",
  NODE_COMPANION_MISSING: "NODE_COMPANION_MISSING",
  NODE_DATASOURCE_REFERENCE_INVALID: "NODE_DATASOURCE_REFERENCE_INVALID",

  // --- Index / Query / Worker / Cache ---
  IDX_DB_OPEN_FAILED: "IDX_DB_OPEN_FAILED",
  IDX_DB_BLOCKED: "IDX_DB_BLOCKED",
  IDX_SCHEMA_MISMATCH: "IDX_SCHEMA_MISMATCH",
  IDX_VAULT_MISMATCH: "IDX_VAULT_MISMATCH",
  IDX_IDENTITY_CHANGED: "IDX_IDENTITY_CHANGED",
  IDX_CORRUPT_RECORD: "IDX_CORRUPT_RECORD",
  IDX_PARSE_FAILED: "IDX_PARSE_FAILED",
  IDX_WRITE_FAILED: "IDX_WRITE_FAILED",
  IDX_GENERATION_CONFLICT: "IDX_GENERATION_CONFLICT",
  IDX_REVISION_CONFLICT: "IDX_REVISION_CONFLICT",
  IDX_REBUILD_REQUIRED: "IDX_REBUILD_REQUIRED",

  QRY_DSL_VERSION_UNSUPPORTED: "QRY_DSL_VERSION_UNSUPPORTED",
  QRY_INVALID_AST: "QRY_INVALID_AST",
  QRY_UNKNOWN_FIELD: "QRY_UNKNOWN_FIELD",
  QRY_FIELD_SOURCE_MISMATCH: "QRY_FIELD_SOURCE_MISMATCH",
  QRY_ROW_SOURCE_MISMATCH: "QRY_ROW_SOURCE_MISMATCH",
  QRY_UNKNOWN_OPERATOR: "QRY_UNKNOWN_OPERATOR",
  QRY_TYPE_MISMATCH: "QRY_TYPE_MISMATCH",
  QRY_OPERAND_REQUIRED: "QRY_OPERAND_REQUIRED",
  QRY_OPERAND_FORBIDDEN: "QRY_OPERAND_FORBIDDEN",
  QRY_ARRAY_QUANTIFIER_REQUIRED: "QRY_ARRAY_QUANTIFIER_REQUIRED",
  QRY_INVALID_DATE: "QRY_INVALID_DATE",
  QRY_INVALID_REGEX: "QRY_INVALID_REGEX",
  QRY_INVALID_SORT: "QRY_INVALID_SORT",
  QRY_DUPLICATE_MANUAL_ORDER: "QRY_DUPLICATE_MANUAL_ORDER",
  QRY_LIMIT_EXCEEDED: "QRY_LIMIT_EXCEEDED",
  QRY_OFFSET_TOO_LARGE: "QRY_OFFSET_TOO_LARGE",
  QRY_CURSOR_INVALID: "QRY_CURSOR_INVALID",
  QRY_CURSOR_STALE: "QRY_CURSOR_STALE",
  QRY_GROUP_LIMIT_EXCEEDED: "QRY_GROUP_LIMIT_EXCEEDED",
  QRY_EXTENSION_UNKNOWN: "QRY_EXTENSION_UNKNOWN",
  QRY_EXTENSION_FAILED: "QRY_EXTENSION_FAILED",
  QRY_ABORTED: "QRY_ABORTED",

  WRK_PROTOCOL_MISMATCH: "WRK_PROTOCOL_MISMATCH",
  WRK_NOT_READY: "WRK_NOT_READY",
  WRK_INIT_FAILED: "WRK_INIT_FAILED",
  WRK_CRASHED: "WRK_CRASHED",
  WRK_TIMEOUT: "WRK_TIMEOUT",
  WRK_SERIALIZE_FAILED: "WRK_SERIALIZE_FAILED",
  WRK_RESTART_EXHAUSTED: "WRK_RESTART_EXHAUSTED",

  CACHE_READ_FAILED: "CACHE_READ_FAILED",
  CACHE_WRITE_FAILED: "CACHE_WRITE_FAILED",
  CACHE_QUOTA_EXCEEDED: "CACHE_QUOTA_EXCEEDED",
  CACHE_INVALIDATED: "CACHE_INVALIDATED",

  // --- DataSource ---
  DATASOURCE_TYPE_UNKNOWN: "DATASOURCE_TYPE_UNKNOWN",
  DATASOURCE_VERSION_UNSUPPORTED: "DATASOURCE_VERSION_UNSUPPORTED",
  DATASOURCE_CONFIG_INVALID: "DATASOURCE_CONFIG_INVALID",
  DATASOURCE_EXECUTION_FAILED: "DATASOURCE_EXECUTION_FAILED",
  DATASOURCE_NOT_FOUND: "DATASOURCE_NOT_FOUND",
  DATASOURCE_DISABLED: "DATASOURCE_DISABLED",
  DATASOURCE_TYPE_UNSUPPORTED: "DATASOURCE_TYPE_UNSUPPORTED",
  DATASOURCE_PROJECTION_MISSING: "DATASOURCE_PROJECTION_MISSING",
  DATASOURCE_AGGREGATE_MISSING: "DATASOURCE_AGGREGATE_MISSING",
  DATASOURCE_INTERVAL_INVALID: "DATASOURCE_INTERVAL_INVALID",

  // --- Runtime / Host / Editor ---
  HOST_OWNER_DOCUMENT_MISSING: "HOST_OWNER_DOCUMENT_MISSING",
  HOST_OBSERVER_FAILED: "HOST_OBSERVER_FAILED",
  RUNTIME_NODE_NOT_FOUND: "RUNTIME_NODE_NOT_FOUND",
  RUNTIME_MODE_FORBIDDEN: "RUNTIME_MODE_FORBIDDEN",
  RUNTIME_MARKDOWN_CYCLE: "RUNTIME_MARKDOWN_CYCLE",
  RUNTIME_MARKDOWN_DEPTH_EXCEEDED: "RUNTIME_MARKDOWN_DEPTH_EXCEEDED",
  RUNTIME_REMOTE_RESOURCE_BLOCKED: "RUNTIME_REMOTE_RESOURCE_BLOCKED",

  EDITOR_PLACEMENT_COLLISION: "EDITOR_PLACEMENT_COLLISION",
  EDITOR_PLACEMENT_OUT_OF_BOUNDS: "EDITOR_PLACEMENT_OUT_OF_BOUNDS",
  EDITOR_SLOT_CAPACITY_EXCEEDED: "EDITOR_SLOT_CAPACITY_EXCEEDED",
  EDITOR_STALE_VERSION: "EDITOR_STALE_VERSION",

  CAPABILITY_DENIED: "CAPABILITY_DENIED",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as Readonly<Record<string, string>>)[value] !== undefined;
}

// ---------------------------------------------------------------------------
// Result / Validation / ProtocolError
// ---------------------------------------------------------------------------

export type Result<T, E = ProtocolError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface ValidationIssue {
  pointer: string;
  code: ErrorCode;
  message: string;
  severity: "warning" | "error";
}

export type ValidationResult<T> =
  | { ok: true; value: T; warnings: readonly ValidationIssue[] }
  | { ok: false; issues: readonly ValidationIssue[] };

export type ProtocolErrorScope =
  | "document"
  | "session"
  | "storage"
  | "migration"
  | "import"
  | "recovery"
  | "registry"
  | "node-factory"
  | "runtime"
  | "host"
  | "platform"
  | "editor"
  | "binding"
  | "data-source"
  | "index"
  | "query"
  | "worker"
  | "cache"
  | "event"
  | "action"
  | "capability";

export interface ProtocolError {
  code: ErrorCode;
  message: string;
  scope: ProtocolErrorScope;
  recoverable: boolean;
  retryable: boolean;
  documentId?: DocumentId;
  componentId?: ComponentId;
  path?: string;
  requestId?: RequestId;
  details?: JsonObject;
  cause?: unknown;
}

// ---------------------------------------------------------------------------
// 生命周期与 ID 工厂
// ---------------------------------------------------------------------------

export interface Disposable {
  dispose(): void | Promise<void>;
}

export interface IdFactory {
  componentId(): ComponentId;
  documentId(): DocumentId;
  dataSourceId(): DataSourceId;
  actionId(): ActionId;
  eventId(): EventId;
  queryId(): QueryId;
  requestId(): RequestId;
}

// ---------------------------------------------------------------------------
// DeepReadonly
// ---------------------------------------------------------------------------

export type DeepReadonly<T> = T extends JsonPrimitive
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;
