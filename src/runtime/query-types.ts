/**
 * Query / DataSource Runtime Port（《数据索引与查询协议 v1》第 9、16 章）。
 */

import type {
  DataSourceId,
  Disposable,
  Result,
} from "@ocs/contracts";
import type {
  QueryOverlay,
  QueryPageRequest,
  QueryResult,
  QuerySubscription,
  VaultQueryDataSourceV1,
} from "@ocs/contracts/query";
import type { ClockPort } from "../platform/ports";

export interface QueryPort {
  execute(
    dataSource: VaultQueryDataSourceV1,
    options?: {
      readonly overlay?: QueryOverlay | null;
      readonly page?: QueryPageRequest;
      readonly signal?: AbortSignal;
    },
  ): Promise<Result<QueryResult>>;
  subscribe(
    dataSource: VaultQueryDataSourceV1,
    options?: {
      readonly overlay?: QueryOverlay | null;
      readonly page?: QueryPageRequest;
    },
  ): Result<QuerySubscription<QueryResult>>;
}

export interface DataSourceExecutionContext {
  readonly documentId: import("@ocs/contracts").DocumentId;
  readonly sourcePath: string;
  readonly query: QueryPort;
  readonly clock: ClockPort;
  readonly signal: AbortSignal;
}

export interface DataSourceDefinition<C extends object = object, O = unknown> {
  readonly type: string;
  readonly specVersion: number;
  readonly configSchema: import("../schema/validator").JsonObjectSchema;
  readonly outputSchema: import("../schema/validator").JsonSchema;
  readonly migrations: readonly import("@ocs/contracts/document").DataSourceMigrationV1[];
  validate(config: unknown): import("@ocs/contracts").ValidationResult<C>;
  execute(
    config: Readonly<C>,
    context: DataSourceExecutionContext,
  ): Promise<Result<O>>;
}

export interface RegisteredDataSourceDefinition {
  readonly type: string;
  readonly specVersion: number;
  readonly configSchema: import("../schema/validator").JsonObjectSchema;
  readonly outputSchema: import("../schema/validator").JsonSchema;
  readonly migrations: readonly import("@ocs/contracts/document").DataSourceMigrationV1[];
  executeUnknown(
    input: unknown,
    context: DataSourceExecutionContext,
  ): Promise<Result<unknown>>;
}

export interface DataSourceRegistry {
  register<C extends object, O>(
    definition: DataSourceDefinition<C, O>,
  ): Result<Disposable>;
  resolve(type: string, specVersion: number): Result<DataSourceResolution>;
}

export type DataSourceResolution =
  | { readonly kind: "known"; readonly definition: RegisteredDataSourceDefinition }
  | { readonly kind: "unknown"; readonly type: string }
  | {
      readonly kind: "future";
      readonly definition: RegisteredDataSourceDefinition;
      readonly fileSpecVersion: number;
      readonly supportedSpecVersion: number;
    };

export interface QueryHookSnapshot {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly data: QueryResult | null;
  readonly isStale: boolean;
  readonly error: import("@ocs/contracts").ProtocolError | null;
}

export interface DataSourceStore extends Disposable {
  getSnapshot(id: DataSourceId): QueryHookSnapshot;
  subscribe(id: DataSourceId, listener: () => void): () => void;
  ensureStarted(id: DataSourceId): Result<void>;
  refresh(id: DataSourceId): Promise<Result<void>>;
}
