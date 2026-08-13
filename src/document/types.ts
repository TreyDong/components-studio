/**
 * Document 模块内部类型：Codec 与 Registry 之间的最小适配接口。
 * ComponentRegistry 结构化满足本接口；Document Codec 只通过本接口消费
 * 组件/数据源/动作的类型描述，不 import registry 实现。
 */

import type {
  ComponentMigrationV1,
  ComponentNodeV1,
  DataSourceMigrationV1,
  DataSourceSpecV1,
  ActionSpecV1,
  DeterministicMigrationContextV1,
  EventDefinitionV1,
  PersistedActionSpecV1,
} from "@ocs/contracts/document";
import type {
  ComponentType,
  JsonObject,
  JsonPointerPattern,
  Result,
} from "@ocs/contracts/common";
import type {
  JsonObjectSchema,
  JsonSchema,
} from "../schema/validator";

export interface SlotDescriptor {
  readonly name: string;
  readonly cardinality:
    | { readonly kind: "one"; readonly required: boolean }
    | { readonly kind: "many"; readonly min?: number; readonly max?: number };
  readonly accepts?: {
    readonly types?: readonly ComponentType[];
    readonly categories?: readonly string[];
    readonly excludeTypes?: readonly ComponentType[];
    readonly excludeCategories?: readonly string[];
    readonly requireUserCreatable?: boolean;
  };
}

export interface ComponentTypeDescriptor {
  readonly currentSpecVersion: number;
  readonly propsSchema: JsonObjectSchema;
  readonly schemaDefs: Readonly<Record<string, JsonSchema>>;
  readonly migrations: readonly ComponentMigrationV1[];
  readonly slots: readonly SlotDescriptor[];
  readonly events: readonly EventDefinitionV1[];
  readonly bindableTargets: readonly JsonPointerPattern[];
}

export type ComponentTypeResolution =
  | { readonly kind: "known"; readonly descriptor: ComponentTypeDescriptor }
  | { readonly kind: "unknown" }
  | {
      readonly kind: "future";
      readonly descriptor: ComponentTypeDescriptor;
      readonly fileSpecVersion: number;
    };

export interface DataSourceTypeDescriptor {
  readonly currentSpecVersion: number;
  readonly configSchema: JsonObjectSchema;
  readonly migrations: readonly DataSourceMigrationV1[];
}

export type DataSourceTypeResolution =
  | { readonly kind: "known"; readonly descriptor: DataSourceTypeDescriptor }
  | { readonly kind: "unknown" }
  | {
      readonly kind: "future";
      readonly descriptor: DataSourceTypeDescriptor;
      readonly fileSpecVersion: number;
    };

export interface ActionTypeDescriptor {
  readonly currentSpecVersion: number;
  readonly persistedSchema: JsonObjectSchema;
  readonly migrations: readonly import("@ocs/contracts/document").ActionMigrationV1[];
}

export type ActionTypeResolution =
  | { readonly kind: "known"; readonly descriptor: ActionTypeDescriptor }
  | { readonly kind: "unknown" }
  | {
      readonly kind: "future";
      readonly descriptor: ActionTypeDescriptor;
      readonly fileSpecVersion: number;
    };

/** Document Codec 消费的最小 Registry 视图。 */
export interface CodecRegistry {
  resolveComponentType(
    type: ComponentType,
    specVersion: number,
  ): ComponentTypeResolution;
  resolveDataSourceType(
    type: string,
    specVersion: number,
  ): DataSourceTypeResolution;
  resolveActionType(type: string, specVersion: number): ActionTypeResolution;
}

export type { JsonObject, JsonPointerPattern, Result };
export type { ComponentNodeV1, DataSourceSpecV1, ActionSpecV1, PersistedActionSpecV1, DeterministicMigrationContextV1 };
