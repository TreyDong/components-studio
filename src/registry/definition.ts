/**
 * Registry、Definition 与 NodeFactory（《运行时与 SDK 协议 v1》第 2 章）。
 * 一个 Component Definition 同时服务 Codec、Runtime、Inspector、Palette 与 Capability。
 */

import type {
  ComponentId,
  ComponentType,
  DataSourceId,
  DeepReadonly,
  Disposable,
  DocumentId,
  IconName,
  JsonObject,
  JsonPointerPattern,
  JsonValue,
  NamespacedKey,
  Result,
  ValidationResult,
  ISODateTime,
  OpenDisposition,
} from "@ocs/contracts";
import type {
  BindingSpecV1,
  ComponentMigrationV1,
  ComponentNodeV1,
  EventDefinitionV1,
  EventSequenceV1,
} from "@ocs/contracts/document";
import type {
  JsonObjectSchema,
} from "../schema/validator";
import type {
  ComponentRenderLocation,
  ComponentRuntimeApi,
  NodeVisibilityPort,
  RuntimeMode,
} from "../runtime/types";
import type { ResponsiveMode } from "../runtime/types";
import type { Capability } from "../runtime/capability-types";
import type { ThemeSnapshot } from "../platform/ports";

export type ComponentCategory =
  | "layout"
  | "content"
  | "data"
  | "time"
  | "action"
  | "integration"
  | "custom";

export interface ComponentManifest {
  readonly type: ComponentType;
  readonly specVersion: number;
  readonly displayName: string;
  readonly description: string;
  readonly category: ComponentCategory;
  readonly icon: IconName;
  readonly keywords: readonly string[];
  readonly vendor: string;
  readonly packageVersion: string;
  readonly rootAllowed: boolean;
  readonly userCreatable: boolean;
  readonly declaredCapabilities: readonly Capability[];
  readonly deprecation?: {
    readonly deprecated: true;
    readonly replacementType?: ComponentType;
    readonly message: string;
  };
}

export interface ComponentAcceptRule {
  readonly types?: readonly ComponentType[];
  readonly categories?: readonly ComponentCategory[];
  readonly excludeTypes?: readonly ComponentType[];
  readonly excludeCategories?: readonly ComponentCategory[];
  readonly requireUserCreatable?: boolean;
}

export type SlotCardinality =
  | { readonly kind: "one"; readonly required: boolean }
  | {
      readonly kind: "many";
      readonly min?: number;
      readonly max?: number;
    };

export interface GridRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly minW: number;
  readonly maxW: number | null;
  readonly minH: number;
  readonly maxH: number | null;
}

export interface ChildPlacement {
  readonly tab: {
    readonly title: string | null;
    readonly icon: IconName | null;
    readonly disabled: boolean;
  };
  readonly column: {
    readonly basisBp: number;
    readonly grow: number;
    readonly shrink: number;
    readonly minWidthPx: number;
    readonly maxWidthPx: number | null;
  };
  readonly grid: {
    readonly compact: GridRect;
    readonly regular: GridRect;
    readonly wide: GridRect;
  };
  readonly extensions: Readonly<Record<NamespacedKey, JsonValue>>;
}

export interface SlotDefinition<P extends object = object> {
  readonly name: string;
  readonly displayName: string;
  readonly description?: string;
  readonly cardinality: SlotCardinality;
  readonly accepts: ComponentAcceptRule;
  readonly deletionPolicy: "delete-subtree";
  createDefaultPlacement(input: {
    readonly parent: ComponentNode<P>;
    readonly childType: ComponentType;
    readonly index: number;
  }): ChildPlacement;
  validatePlacement(
    placement: ChildPlacement,
    context: {
      readonly responsiveMode: ResponsiveMode;
      readonly columnCount: number;
    },
  ): ValidationResult<ChildPlacement>;
  readonly emptyState?: {
    readonly label: string;
    readonly icon?: IconName;
  };
}

export interface CreateComponentContext {
  readonly documentId: DocumentId;
  readonly componentId: ComponentId;
  readonly parentId: ComponentId | null;
  readonly sourcePath: string;
  readonly locale: string;
  readonly createdAt: ISODateTime;
  readonly ids: import("@ocs/contracts").IdFactory;
  readonly companions: Readonly<Record<string, DataSourceId>>;
}

export interface NewDataSourceDraft {
  readonly key: string;
  readonly type: "vault.query";
  readonly specVersion: 1;
  readonly enabled: boolean;
  readonly label: string | null;
  readonly config: JsonObject;
  readonly refresh:
    | { readonly mode: "on-vault-change" }
    | { readonly mode: "manual" }
    | { readonly mode: "interval"; readonly intervalMs: number };
  readonly extensions: Readonly<Record<NamespacedKey, JsonValue>>;
}

export type CompanionDraftContext = Omit<CreateComponentContext, "companions">;

export interface InspectorCommitOptions {
  readonly label: string;
  readonly mergeKey?: string;
  readonly save: "debounced" | "immediate";
}

export interface InspectorController<P extends object> {
  getCurrent(): Readonly<P>;
  set(
    pointer: string,
    value: JsonValue,
    options: InspectorCommitOptions,
  ): Result<void>;
  remove(pointer: string, options: InspectorCommitOptions): Result<void>;
  replace(next: P, options: InspectorCommitOptions): Result<void>;
}

export interface ComponentInspectorProps<P extends object> {
  readonly componentId: ComponentId;
  readonly value: Readonly<P>;
  readonly issues: readonly import("@ocs/contracts").ValidationIssue[];
  readonly controller: InspectorController<P>;
  readonly fields: InspectorFieldKit;
}

export interface ComponentPreviewProps<P extends object> {
  readonly props: Readonly<P>;
  readonly theme: ThemeSnapshot;
  readonly responsiveMode: ResponsiveMode;
}

export interface ComponentRendererProps<P extends object> {
  readonly id: ComponentId;
  readonly props: Readonly<P>;
  readonly mode: RuntimeMode;
  readonly sourcePath: string;
  readonly location: ComponentRenderLocation;
  readonly slots: import("../runtime/types").SlotRenderer;
  readonly runtime: ComponentRuntimeApi;
  readonly visibility: NodeVisibilityPort;
}

export interface ComponentDefinition<P extends object = object> {
  readonly manifest: ComponentManifest;
  readonly propsSchema: JsonObjectSchema;
  readonly slots: readonly SlotDefinition<P>[];
  readonly events: readonly EventDefinitionV1[];
  readonly bindableTargets: readonly JsonPointerPattern[];
  readonly migrations: readonly ComponentMigrationV1[];

  createCompanionDataSources(
    context: CompanionDraftContext,
  ): readonly NewDataSourceDraft[];
  createDefaultProps(context: CreateComponentContext): P;
  validate(input: unknown): ValidationResult<P>;

  readonly Renderer: import("react").ComponentType<ComponentRendererProps<P>>;
  readonly Inspector:
    | import("react").ComponentType<ComponentInspectorProps<P>>
    | null;
  readonly Preview?: import("react").ComponentType<ComponentPreviewProps<P>>;
}

export interface RegistryFilter {
  readonly category?: ComponentCategory;
  readonly userCreatable?: boolean;
  readonly rootAllowed?: boolean;
  readonly search?: string;
}

export interface RegisteredComponentDefinition {
  readonly manifest: ComponentManifest;
  readonly propsSchema: JsonObjectSchema;
  readonly slots: readonly SlotDefinition<object>[];
  readonly events: readonly EventDefinitionV1[];
  readonly bindableTargets: readonly JsonPointerPattern[];
  readonly migrations: readonly ComponentMigrationV1[];
  createCompanionDataSources(
    context: CompanionDraftContext,
  ): readonly NewDataSourceDraft[];
  createDefaultPropsUnknown(context: CreateComponentContext): object;
  validateUnknown(input: unknown): ValidationResult<object>;
  renderUnknown(props: ComponentRendererProps<object>): import("react").ReactNode;
  inspectUnknown(props: ComponentInspectorProps<object>): import("react").ReactNode;
  previewUnknown?(props: ComponentPreviewProps<object>): import("react").ReactNode;
}

export interface MigrationResolution {
  readonly definition: RegisteredComponentDefinition;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly path: readonly ComponentMigrationV1[];
}

export type ComponentResolution =
  | { readonly kind: "known"; readonly definition: RegisteredComponentDefinition }
  | { readonly kind: "unknown"; readonly type: ComponentType }
  | {
      readonly kind: "future";
      readonly definition: RegisteredComponentDefinition;
      readonly fileSpecVersion: number;
      readonly supportedSpecVersion: number;
    };

export interface RegistryRegistration extends Disposable {
  readonly type: ComponentType;
}

export interface ComponentNode<P extends object = object> {
  readonly id: ComponentId;
  readonly type: ComponentType;
  readonly specVersion: number;
  readonly enabled: boolean;
  readonly label: string | null;
  readonly props: P;
  readonly style: import("@ocs/contracts/document").NodeStyleV1;
  readonly slots: Readonly<Record<string, readonly import("../runtime/types").ChildRef[]>>;
  readonly bindings: readonly BindingSpecV1[];
  readonly events: Readonly<Record<string, EventSequenceV1>>;
  readonly extensions: Readonly<Record<NamespacedKey, JsonValue>>;
}

export interface NodeFactoryInput<P extends object = object> {
  readonly definition: ComponentDefinition<P>;
  readonly context: CreateComponentContext;
  readonly initialProps?: JsonObject;
}

export interface NodeFactory {
  create<P extends object>(input: NodeFactoryInput<P>): Result<ComponentNode<P>>;
  createFromRegistered(input: {
    readonly definition: RegisteredComponentDefinition;
    readonly context: CreateComponentContext;
    readonly initialProps?: JsonObject;
  }): Result<ComponentNode<object>>;
}

export interface InspectorFieldKit {
  render(field: InspectorField): import("react").ReactNode;
  renderIssues(pointer: string): import("react").ReactNode;
  group(input: {
    readonly id: string;
    readonly label: string;
    readonly collapsible: boolean;
    readonly defaultCollapsed: boolean;
    readonly children: import("react").ReactNode;
  }): import("react").ReactNode;
}

export type InspectorField =
  | (BaseInspectorField & {
      readonly kind: "text";
      readonly placeholder?: string;
      readonly minLength?: number;
      readonly maxLength?: number;
    })
  | (BaseInspectorField & {
      readonly kind: "textarea";
      readonly rows?: number;
      readonly maxLength?: number;
      readonly monospace?: boolean;
    })
  | (BaseInspectorField & {
      readonly kind: "number";
      readonly min?: number;
      readonly max?: number;
      readonly step?: number;
      readonly unit?: string;
    })
  | (BaseInspectorField & { readonly kind: "toggle" })
  | (BaseInspectorField & {
      readonly kind: "select";
      readonly options: readonly {
        readonly label: string;
        readonly value: import("@ocs/contracts").JsonPrimitive;
      }[];
    })
  | (BaseInspectorField & { readonly kind: "color"; readonly allowThemeToken: boolean })
  | (BaseInspectorField & { readonly kind: "icon" })
  | (BaseInspectorField & {
      readonly kind: "file-path";
      readonly extensions: readonly string[];
      readonly allowCreate: boolean;
    })
  | (BaseInspectorField & { readonly kind: "query" })
  | (BaseInspectorField & {
      readonly kind: "action-list";
      readonly allowedActionTypes: readonly import("../runtime/action-types").ActionType[];
    });

export interface BaseInspectorField {
  readonly pointer: string;
  readonly label: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
}

export type { OpenDisposition, DeepReadonly, ComponentNodeV1 };
