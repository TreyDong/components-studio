/**
 * @ocs/contracts/query
 *
 * 《数据索引与查询协议 v1》的 DataSource、Query、Worker、Cache 与
 * Query Store 可序列化 DTO 的唯一 TypeScript 定义。只依赖 @ocs/contracts/common。
 */

import type {
  DataSourceId,
  Generation,
  IndexRevision,
  JsonObject,
  JsonValue,
  NamespacedKey,
  PathKey,
  ProtocolError,
  QueryId,
  RequestId,
  SubscriptionId,
  TaskRowId,
} from "./common";

export type { PathKey, TaskRowId, Generation, IndexRevision };

// ---------------------------------------------------------------------------
// 行域与字段
// ---------------------------------------------------------------------------

export type QuerySource = "pages" | "tasks";

export type FileFieldName =
  | "basename"
  | "path"
  | "parent"
  | "extension"
  | "ctime"
  | "mtime"
  | "size"
  | "chars"
  | "words"
  | "aliases"
  | "tags"
  | "outgoingLinks"
  | "backlinks";

export type TaskFieldName =
  | "rowId"
  | "line"
  | "status"
  | "checked"
  | "text"
  | "parentLine"
  | "blockId";

export type FieldRef =
  | { scope: "file"; name: FileFieldName }
  | { scope: "property"; path: string[] }
  | { scope: "task"; name: TaskFieldName };

export type PropertyType =
  | "null"
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "path"
  | "text[]"
  | "number[]"
  | "boolean[]"
  | "date[]"
  | "datetime[]"
  | "path[]"
  | "json"
  | "mixed";

export interface ResolvedField {
  exists: boolean;
  value: JsonValue | undefined;
  type: PropertyType | "missing";
}

// ---------------------------------------------------------------------------
// PageRecord 与附属记录
// ---------------------------------------------------------------------------

export interface NormalizedFrontmatter {
  values: JsonObject;
  types: Record<string, PropertyType>;
}

export interface RawPosition {
  startOffset: number;
  endOffset: number;
  startLine?: number;
  endLine?: number;
}

export interface HeadingRecord {
  heading: string;
  level: number;
  position?: RawPosition;
}

export interface LinkRecord {
  original: string;
  resolvedPath: string | null;
  resolvedPathKey: PathKey | null;
  display?: string;
  embed: boolean;
  position?: RawPosition;
}

export interface TaskRecord {
  rowId: TaskRowId;
  line: number;
  status: string;
  checked: boolean;
  text: string;
  parentLine: number | null;
  blockId: string | null;
  fields: Record<string, string>;
}

export type PageDiagnosticCode =
  | "PAGE_FORBIDDEN_KEY"
  | "PAGE_VALUE_COERCED_TO_NULL"
  | "PAGE_NON_FINITE_NUMBER"
  | "PAGE_INVALID_DATE"
  | "PAGE_MIXED_ARRAY"
  | "PAGE_NESTED_VALUE_UNINDEXED"
  | "PAGE_UNRESOLVED_LINK"
  | "PAGE_TASK_PARSE_PARTIAL";

export interface PageDiagnostic {
  id: string;
  code: PageDiagnosticCode;
  severity: "warning" | "error";
  fieldPath?: string[];
  message: string;
}

export interface PageRecord {
  schemaVersion: 1;
  generation: Generation;

  path: string;
  pathKey: PathKey;
  basename: string;
  basenameNormalized: string;
  extension: string;
  parentPath: string;
  parentPathKey: PathKey;

  ctimeMs: number;
  mtimeMs: number;
  sizeBytes: number;

  frontmatter: JsonObject;
  propertyTypes: Record<string, PropertyType>;
  aliases: string[];
  tags: string[];
  headings: HeadingRecord[];
  outgoingLinks: LinkRecord[];
  backlinks: PathKey[];
  tasks: TaskRecord[];
  textStats: { chars: number; words: number };

  fingerprint: {
    mtimeMs: number;
    sizeBytes: number;
    metadataHash: string;
  };

  recordRevision: IndexRevision;
  diagnostics: PageDiagnostic[];
}

// ---------------------------------------------------------------------------
// RawPageSnapshot（主线程 → Worker）
// ---------------------------------------------------------------------------

export type RawPropertyTypeHint =
  | "text"
  | "number"
  | "checkbox"
  | "date"
  | "datetime"
  | "path"
  | "unknown";

export interface RawLink {
  original: string;
  resolvedPath: string | null;
  display?: string;
  embed: boolean;
  position?: RawPosition;
}

export interface RawHeading {
  heading: string;
  level: number;
  position?: RawPosition;
}

export interface RawTask {
  line: number;
  status: string;
  text: string;
  parentLine: number | null;
  blockId: string | null;
  fields: Record<string, string>;
}

export interface RawPageSnapshot {
  snapshotVersion: 1;
  eventToken: string;
  eventSequence: number;
  path: string;
  extension: string;
  parentPath: string;
  basename: string;
  ctimeMs: number;
  mtimeMs: number;
  sizeBytes: number;

  frontmatter: JsonObject;
  propertyTypeHints: Record<string, RawPropertyTypeHint>;
  aliases: string[];
  tags: string[];
  headings: RawHeading[];
  outgoingLinks: RawLink[];
  tasks: RawTask[];
  textStats: { chars: number; words: number };

  metadataHash: string;
  sourceReadAtMs: number;
}

// ---------------------------------------------------------------------------
// DataSource 单一路径
// ---------------------------------------------------------------------------

export interface VaultQueryDataSourceConfigV1 {
  query: PageQueryV1;
}

export interface VaultQueryDataSourceV1 {
  id: DataSourceId;
  type: "vault.query";
  specVersion: 1;
  enabled: boolean;
  label: string | null;
  config: VaultQueryDataSourceConfigV1;
  refresh:
    | { mode: "on-vault-change" }
    | { mode: "manual" }
    | { mode: "interval"; intervalMs: number };
  extensions: Record<NamespacedKey, JsonValue>;
}

export type PersistedDataSourceV1 = VaultQueryDataSourceV1;

export interface DataSourceConsumerProps {
  dataSourceId: DataSourceId;
}

export interface QueryOverlay {
  where?: QueryNode;
  orderBy?: SortClause[];
}

// ---------------------------------------------------------------------------
// Query DSL v1
// ---------------------------------------------------------------------------

export type RelativeDateAnchor =
  | "$now"
  | "$startOfToday"
  | "$endOfToday"
  | "$tomorrow"
  | "$yesterday"
  | "$startOfWeek"
  | "$endOfWeek"
  | "$startOfMonth"
  | "$endOfMonth"
  | "$startOfQuarter"
  | "$endOfQuarter"
  | "$startOfYear"
  | "$endOfYear";

export interface RelativeDateValue {
  anchor: RelativeDateAnchor;
  offset?: {
    amount: number;
    unit: "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year";
  };
}

export type QueryLiteral =
  | { type: "null" }
  | { type: "text"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "path"; value: string }
  | {
      type: "date";
      value:
        | { kind: "absolute"; iso: string }
        | { kind: "relative"; spec: RelativeDateValue };
    }
  | {
      type: "datetime";
      value:
        | { kind: "absolute"; iso: string }
        | { kind: "relative"; spec: RelativeDateValue };
    };

export type QueryOperand = QueryLiteral | QueryLiteral[];

export type QueryOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "contains_any"
  | "not_contains"
  | "set_equals"
  | "greater_than"
  | "greater_than_or_equal"
  | "less_than"
  | "less_than_or_equal"
  | "has_value"
  | "no_value"
  | "exists"
  | "not_exists"
  | "checked"
  | "unchecked"
  | "regex_match"
  | "time_after"
  | "time_after_or_equal"
  | "time_before"
  | "time_before_or_equal"
  | "path_under"
  | "path_child_of"
  | "path_basename_eq";

export interface QueryGroup {
  kind: "group";
  id: string;
  operator: "and" | "or";
  children: QueryNode[];
}

export interface QueryPredicate {
  kind: "predicate";
  id: string;
  field: FieldRef;
  operator: QueryOperator;
  value?: QueryOperand;
  quantifier?: "any" | "all";
  options?: {
    caseSensitive?: boolean;
    regexFlags?: string;
  };
}

export interface QueryExtensionPredicate {
  kind: "extension";
  id: string;
  extensionId: NamespacedKey;
  exportName: string;
  args: JsonValue;
}

export type QueryNode = QueryGroup | QueryPredicate | QueryExtensionPredicate;

export interface SearchSpec {
  text: string;
  fields: FieldRef[];
  caseSensitive: boolean;
}

export interface ProjectionSpec {
  alias: string;
  field: FieldRef;
}

export interface GroupBySpec {
  id: string;
  field: FieldRef;
  arrayMode: "first" | "join" | "explode";
  nullLabel: string;
}

export type AggregateOperation =
  | "count"
  | "count_values"
  | "distinct_count"
  | "sum"
  | "average"
  | "min"
  | "max";

export interface AggregateSpec {
  id: string;
  operation: AggregateOperation;
  field?: FieldRef;
  arrayMode?: "flatten" | "count" | "first";
}

export type QueryRowIdentity =
  | { source: "pages"; pathKey: PathKey }
  | { source: "tasks"; pathKey: PathKey; taskRowId: TaskRowId };

export interface PageQueryV1 {
  dslVersion: 1;
  id: QueryId;
  from: QuerySource;
  search: SearchSpec | null;
  where: QueryNode | null;
  orderBy: SortClause[];
  manualOrder: QueryRowIdentity[];
  select: ProjectionSpec[];
  groupBy: GroupBySpec[];
  aggregates: AggregateSpec[];
  includeRows: boolean;
}

export interface SortClause {
  field: FieldRef;
  direction: "asc" | "desc";
  nulls: "first" | "last";
  mode: "auto" | "text" | "number" | "date" | "path";
  arrayMode?: "min" | "max" | "count" | "join";
}

export type QueryPageRequest =
  | { kind: "first"; limit: number }
  | { kind: "cursor"; limit: number; cursor: string }
  | { kind: "offset"; limit: number; offset: number };

export interface CursorPayloadV1 {
  version: 1;
  planHash: string;
  generation: Generation;
  revision: IndexRevision;
  lastSortTuple: JsonValue[];
  lastRowIdentity: QueryRowIdentity;
  checksum: string;
}

// ---------------------------------------------------------------------------
// 查询依赖与计划
// ---------------------------------------------------------------------------

export interface QueryDependencies {
  membershipFields: string[];
  orderFields: string[];
  projectionFields: string[];
  groupingFields: string[];
  aggregateFields: string[];
  global: Array<
    | "backlinks"
    | "relative-time"
    | "extension-all"
    | "full-text"
    | "task-rows"
  >;
}

export interface CanonicalPlanIdentity {
  queryDslVersion: 1;
  pageSchemaVersion: 1;
  parserVersion: string;
  identityHash: string;
  workerExtensionSetHash: string;
  canonicalQuery: JsonObject;
}

export interface WorkerPredicateManifest {
  extensionId: NamespacedKey;
  exportName: string;
  declaredDependencies: FieldRef[] | "all";
}

// ---------------------------------------------------------------------------
// Query Request / Result
// ---------------------------------------------------------------------------

export interface QueryRequest {
  requestId: RequestId;
  subscriptionId: SubscriptionId;
  queryVersion: number;
  canonicalQueryKey: string;
  expectedGeneration: Generation;
  expectedRevision: IndexRevision;
  evaluatedAtMs: number;
  spec: PageQueryV1;
  overlay: QueryOverlay | null;
  page: QueryPageRequest;
}

export interface QueryRowBase {
  identity: QueryRowIdentity;
  pathKey: PathKey;
  recordRevision: IndexRevision;
  values: Readonly<Record<string, JsonValue>>;
}

export interface TaskLocatorSeed {
  path: string;
  taskRowId: TaskRowId;
  line: number;
  expectedStatus: string;
  expectedTaskText: string;
  blockId: string | null;
}

export type QueryRow =
  | (QueryRowBase & {
      identity: { source: "pages"; pathKey: PathKey };
      taskLocatorSeed: null;
    })
  | (QueryRowBase & {
      identity: {
        source: "tasks";
        pathKey: PathKey;
        taskRowId: TaskRowId;
      };
      taskLocatorSeed: TaskLocatorSeed;
    });

export interface AggregateResult {
  id: string;
  value: JsonValue;
  ignoredValueCount: number;
}

export interface QueryGroupResult {
  key: QueryGroupKey[];
  label: string;
  rowCount: number;
  aggregates: readonly AggregateResult[];
}

export type QueryGroupKey =
  | { state: "missing" }
  | { state: "value"; type: PropertyType; value: JsonValue };

export interface QueryWarning {
  code: string;
  message: string;
  details?: JsonObject;
}

export interface QueryResult {
  requestId: RequestId;
  subscriptionId: SubscriptionId;
  queryVersion: number;
  planHash: string;
  generation: Generation;
  revision: IndexRevision;
  rows: readonly QueryRow[];
  rowTotal: number;
  aggregates: readonly AggregateResult[];
  groups: readonly QueryGroupResult[];
  nextCursor: string | null;
  nextInvalidAtMs: number | null;
  warnings: readonly QueryWarning[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// 可序列化错误
// ---------------------------------------------------------------------------

export interface SerializedCause {
  name: string;
  message: string;
  stack?: string;
}

export interface DataRuntimeError {
  code: string;
  message: string;
  scope: "index" | "query" | "worker" | "cache" | "datasource";
  recoverable: boolean;
  retryable: boolean;
  requestId?: RequestId;
  pathKey?: PathKey;
  details?: JsonObject;
  cause?: SerializedCause;
}

// ---------------------------------------------------------------------------
// Index、Delta 与 IndexedDB
// ---------------------------------------------------------------------------

export interface IndexIdentity {
  vaultId: string;
  caseSensitivity: "sensitive" | "insensitive";
  locale: string;
  timeZone: string;
  weekStart: 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

export type IndexMutation =
  | { kind: "upsert"; snapshot: RawPageSnapshot }
  | { kind: "delete"; pathKey: PathKey; eventSequence: number }
  | { kind: "rename"; oldPathKey: PathKey; snapshot: RawPageSnapshot };

export interface ApplyMutationBatch {
  batchId: string;
  expectedGeneration: Generation;
  expectedRevision: IndexRevision;
  mutations: IndexMutation[];
}

export type ChangedFieldKey = string;

export interface IndexDeltaChange {
  kind: "create" | "update" | "rename" | "delete";
  pathKey: PathKey;
  previousPathKey?: PathKey;
  changedFields: ChangedFieldKey[];
  recordRevision?: IndexRevision;
  deletedAtRevision?: IndexRevision;
}

export interface IndexDelta {
  generation: Generation;
  fromRevision: IndexRevision;
  toRevision: IndexRevision;
  batchId: string;
  fullInvalidation: boolean;
  changes: IndexDeltaChange[];
}

export interface IndexMetaRecord {
  key: "index";
  dbSchemaVersion: 1;
  pageSchemaVersion: 1;
  rawSnapshotVersion: 1;
  parserVersion: string;
  queryDslVersion: 1;
  workerProtocolVersion: 1;
  workerExtensionSetHash: string;

  vaultId: string;
  identityHash: string;
  activeGeneration: Generation | null;
  buildingGeneration: Generation | null;
  revision: IndexRevision;
  status: "empty" | "ready" | "building" | "failed";
  fileCount: number;
  builtAtMs: number | null;
  updatedAtMs: number;
  lastError?: DataRuntimeError;
}

// ---------------------------------------------------------------------------
// Worker 协议
// ---------------------------------------------------------------------------

export interface WorkerEnvelope<TType extends string, TPayload> {
  protocolVersion: 1;
  type: TType;
  messageId: string;
  sentAtMs: number;
  payload: TPayload;
}

export type ClientToWorkerMessage =
  | WorkerEnvelope<
      "HELLO",
      {
        pluginVersion: string;
        workerProtocolVersion: 1;
        rawSnapshotVersion: 1;
        pageSchemaVersion: 1;
        queryDslVersion: 1;
        dbSchemaVersion: 1;
        parserVersion: string;
        workerExtensionSetHash: string;
      }
    >
  | WorkerEnvelope<
      "INIT",
      {
        identity: IndexIdentity;
        identityHash: string;
        resultCacheMaxEntries: number;
        resultCacheMaxBytes: number;
      }
    >
  | WorkerEnvelope<"APPLY_BATCH", ApplyMutationBatch>
  | WorkerEnvelope<"REBUILD_BEGIN", { rebuildId: string; expectedFileCount: number }>
  | WorkerEnvelope<
      "REBUILD_BATCH",
      { rebuildId: string; batchNo: number; snapshots: RawPageSnapshot[] }
    >
  | WorkerEnvelope<
      "REBUILD_COMMIT",
      {
        rebuildId: string;
        finalBatchNo: number;
        expectedFileCount: number;
        barrierEventSequence: number;
      }
    >
  | WorkerEnvelope<"REBUILD_ABORT", { rebuildId: string; reason: string }>
  | WorkerEnvelope<"QUERY", QueryRequest>
  | WorkerEnvelope<
      "CANCEL_QUERY",
      {
        requestId: RequestId;
        queryVersion: number;
        reason: "superseded" | "released" | "user" | "dispose";
      }
    >
  | WorkerEnvelope<"RELEASE_QUERY", { canonicalQueryKey: string }>
  | WorkerEnvelope<"PING", { nonce: string }>
  | WorkerEnvelope<"DISPOSE", { reason: string }>;

export type WorkerToClientMessage =
  | WorkerEnvelope<
      "HELLO_ACK",
      {
        accepted: boolean;
        workerProtocolVersion: 1;
        parserVersion: string;
        workerExtensionSetHash: string;
        error?: DataRuntimeError;
      }
    >
  | WorkerEnvelope<
      "READY",
      {
        mode: "persistent" | "memory-only";
        generation: Generation | null;
        revision: IndexRevision;
        fileCount: number;
        requiresRebuild: boolean;
      }
    >
  | WorkerEnvelope<
      "INDEX_ERROR",
      {
        operation:
          | "apply"
          | "rebuild-begin"
          | "rebuild-batch"
          | "rebuild-commit"
          | "rebuild-abort";
        batchId?: string;
        rebuildId?: string;
        error: DataRuntimeError;
      }
    >
  | WorkerEnvelope<
      "APPLY_ACK",
      {
        batchId: string;
        generation: Generation;
        revision: IndexRevision;
        changedCount: number;
        duplicate: boolean;
      }
    >
  | WorkerEnvelope<"INDEX_DELTA", IndexDelta>
  | WorkerEnvelope<
      "REBUILD_PROGRESS",
      {
        rebuildId: string;
        phase:
          | "receiving"
          | "normalizing"
          | "postings"
          | "validating"
          | "committing"
          | "gc";
        processed: number;
        total: number;
      }
    >
  | WorkerEnvelope<"REBUILD_ABORTED", { rebuildId: string; generation: Generation | null }>
  | WorkerEnvelope<
      "GENERATION_CHANGED",
      {
        previousGeneration: Generation | null;
        generation: Generation;
        revision: IndexRevision;
        fileCount: number;
      }
    >
  | WorkerEnvelope<
      "QUERY_STARTED",
      {
        requestId: RequestId;
        subscriptionId: SubscriptionId;
        queryVersion: number;
        generation: Generation;
        revision: IndexRevision;
        candidateCount: number;
      }
    >
  | WorkerEnvelope<"QUERY_RESULT", QueryResult>
  | WorkerEnvelope<
      "QUERY_ERROR",
      {
        requestId: RequestId;
        subscriptionId: SubscriptionId;
        queryVersion: number;
        error: DataRuntimeError;
      }
    >
  | WorkerEnvelope<
      "QUERY_CANCELLED",
      {
        requestId: RequestId;
        subscriptionId: SubscriptionId;
        queryVersion: number;
        acknowledgedAtMs: number;
      }
    >
  | WorkerEnvelope<
      "PONG",
      {
        nonce: string;
        state:
          | "created"
          | "handshaking"
          | "initializing"
          | "ready"
          | "rebuilding"
          | "disposing"
          | "disposed";
        activeQueries: number;
      }
    >
  | WorkerEnvelope<"FATAL", { error: DataRuntimeError; restartSafe: boolean }>;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

export interface ResultCacheEntry {
  cacheKey: string;
  planHash: string;
  pageSignature: string;
  generation: Generation;
  computedRevision: IndexRevision;
  validatedRevision: IndexRevision;
  dependencies: QueryDependencies;
  result: QueryResult;
  nextInvalidAtMs: number | null;
  estimatedBytes: number;
}

// ---------------------------------------------------------------------------
// Shared Query Store
// ---------------------------------------------------------------------------

export interface QuerySubscriptionSnapshot<T> {
  status: "idle" | "loading" | "ready" | "error";
  data: T | null;
  isStale: boolean;
  error: ProtocolError | null;
}

export type QueryHookSnapshot = QuerySubscriptionSnapshot<QueryResult>;

export interface QueryEntry {
  key: string;
  dataSourceId: DataSourceId;
  requestId: RequestId | null;
  queryVersion: number;
  refCount: number;
  status: "idle" | "loading" | "ready" | "error";
  snapshot: QuerySubscriptionSnapshot<QueryResult>;
  subscribers: Set<() => void>;
}

export interface QueryExecutionOptions {
  overlay?: QueryOverlay | null;
  page?: QueryPageRequest;
}

export interface QueryHookOptions<T = QueryResult>
  extends QueryExecutionOptions {
  enabled?: boolean;
  keepPreviousData?: boolean;
  selector?: (result: QueryResult) => T;
}

export interface QueryHookState<T> {
  status: "idle" | "loading" | "ready" | "error";
  data: T | null;
  isStale: boolean;
  error: ProtocolError | null;
  refresh(): void;
}

export interface QuerySubscription<T> {
  getSnapshot(): QuerySubscriptionSnapshot<T>;
  subscribe(listener: () => void): () => void;
  refresh(): void;
  dispose(): void;
}

export interface QueryRecordView {
  source: QuerySource;
  page: PageRecord;
  task: TaskRecord | null;
}

// ---------------------------------------------------------------------------
// Task 写回 helper 纯函数签名
// ---------------------------------------------------------------------------

export interface MarkdownTaskLocator {
  path: string;
  expectedRawHash: string;
  line: number;
  expectedLineText: string;
  expectedStatus: string;
  blockId: string | null;
}
