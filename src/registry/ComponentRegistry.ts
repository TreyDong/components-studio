/**
 * ComponentRegistry Interface + Implementation（《运行时与 SDK 协议 v1》第 2.5 节）。
 *
 * 规则落实：
 * 1. Codec 是唯一执行 Migration 的 Module（resolveForMigration 只提供路径）。
 * 2. resolveForRender 只接受节点版本等于当前版本。
 * 3. 未知/未来版本返回显式 ComponentResolution，不抛错。
 * 4. 迁移必须是连续 N→N+1 纯函数链（defineComponent 校验）。
 * 5. Definition 注册后深冻结。
 * 6. 同一 type 重复注册失败，后注册者不得覆盖。
 * 7. register() 复用 defineComponent 校验。
 * 8. Palette / Inspector / Runtime / Codec 都只读本 Registry。
 */

import type {
  ComponentType,
  Result,
} from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";
import { createElement } from "react";
import type { ReactNode } from "react";
import type {
  ComponentDefinition,
  ComponentInspectorProps,
  ComponentPreviewProps,
  ComponentRendererProps,
  CompanionDraftContext,
  CreateComponentContext,
  ComponentResolution,
  MigrationResolution,
  RegisteredComponentDefinition,
  RegistryFilter,
  RegistryRegistration,
  SlotDefinition,
} from "./definition";
import { validateComponentDefinition } from "./defineComponent";
import type {
  CodecRegistry,
  ComponentTypeDescriptor,
  SlotDescriptor,
} from "../document/types";
import type { JsonSchema } from "../schema/validator";

export interface ComponentRegistry {
  register<P extends object>(
    definition: ComponentDefinition<P>,
  ): Result<RegistryRegistration>;
  has(type: ComponentType): boolean;
  get(type: ComponentType): RegisteredComponentDefinition | null;
  resolveForMigration(
    type: ComponentType,
    storedVersion: number,
  ): Result<MigrationResolution>;
  resolveForRender(
    type: ComponentType,
    storedVersion: number,
  ): Result<ComponentResolution>;
  list(filter?: RegistryFilter): readonly RegisteredComponentDefinition[];
  subscribe(listener: () => void): () => void;
  /** Document Codec 消费的最小 Registry 视图（document/types.ts）。 */
  codecView(): CodecRegistry;
}

/** list() 固定排序：类别顺序 → displayName → type。 */
const CATEGORY_ORDER: Record<string, number> = {
  layout: 0,
  content: 1,
  data: 2,
  time: 3,
  action: 4,
  integration: 5,
  custom: 6,
};

const ROOT_SCOPE = "registry" as const;

export class ComponentRegistryImpl implements ComponentRegistry {
  private readonly byType = new Map<string, RegisteredComponentDefinition>();
  private readonly listeners = new Set<() => void>();

  register<P extends object>(
    definition: ComponentDefinition<P>,
  ): Result<RegistryRegistration> {
    const validation = validateComponentDefinition(definition);
    if (!validation.ok) {
      return { ok: false, error: validation.error };
    }
    const type = definition.manifest.type;
    if (this.byType.has(type)) {
      return {
        ok: false,
        error: {
          code: ERROR_CODES.REGISTRY_TYPE_CONFLICT,
          message: `组件类型已注册: ${type}`,
          scope: ROOT_SCOPE,
          recoverable: false,
          retryable: false,
        },
      };
    }
    const registered = buildRegistered(definition);
    this.byType.set(type, registered);
    this.notify();
    return {
      ok: true,
      value: {
        type,
        dispose: () => {
          if (this.byType.delete(type)) {
            this.notify();
          }
        },
      },
    };
  }

  has(type: ComponentType): boolean {
    return this.byType.has(type);
  }

  get(type: ComponentType): RegisteredComponentDefinition | null {
    return this.byType.get(type) ?? null;
  }

  resolveForMigration(
    type: ComponentType,
    storedVersion: number,
  ): Result<MigrationResolution> {
    const definition = this.byType.get(type);
    if (!definition) {
      return {
        ok: false,
        error: {
          code: ERROR_CODES.COMPONENT_TYPE_UNKNOWN,
          message: `未知组件类型: ${type}`,
          scope: ROOT_SCOPE,
          recoverable: false,
          retryable: false,
        },
      };
    }
    const current = definition.manifest.specVersion;
    if (storedVersion === current) {
      return {
        ok: true,
        value: {
          definition,
          fromVersion: current,
          toVersion: current,
          path: [],
        },
      };
    }
    if (storedVersion > current) {
      return {
        ok: false,
        error: {
          code: ERROR_CODES.COMPONENT_VERSION_UNSUPPORTED,
          message: `未来版本 ${storedVersion}（当前支持 ${current}）无法迁移`,
          scope: ROOT_SCOPE,
          recoverable: false,
          retryable: false,
          details: { type, storedVersion, current },
        },
      };
    }
    const path = resolveMigrationPath(definition.migrations, storedVersion, current);
    if (!path) {
      return {
        ok: false,
        error: {
          code: ERROR_CODES.MIGRATION_PATH_MISSING,
          message: `缺少迁移路径: ${type} ${storedVersion}→${current}`,
          scope: ROOT_SCOPE,
          recoverable: false,
          retryable: false,
          details: { type, storedVersion, current },
        },
      };
    }
    return {
      ok: true,
      value: { definition, fromVersion: storedVersion, toVersion: current, path },
    };
  }

  resolveForRender(
    type: ComponentType,
    storedVersion: number,
  ): Result<ComponentResolution> {
    const definition = this.byType.get(type);
    if (!definition) {
      // 规则 3：未知类型不是异常。
      return { ok: true, value: { kind: "unknown", type } };
    }
    const current = definition.manifest.specVersion;
    if (storedVersion === current) {
      return { ok: true, value: { kind: "known", definition } };
    }
    if (storedVersion > current) {
      // 规则 3：未来版本交给 system.unknown 只读展示。
      return {
        ok: true,
        value: {
          kind: "future",
          definition,
          fileSpecVersion: storedVersion,
          supportedSpecVersion: current,
        },
      };
    }
    // 旧版本节点：Runtime 永不迁移（规则 1），且规则 2 只接受当前版本；
    // Codec 解析时已迁移，此处按不可渲染处理。
    return { ok: true, value: { kind: "unknown", type } };
  }

  list(filter?: RegistryFilter): readonly RegisteredComponentDefinition[] {
    const items = [...this.byType.values()];
    const out = filter ? items.filter((def) => matchesFilter(def, filter)) : items;
    out.sort((a, b) => {
      const byCategory =
        (CATEGORY_ORDER[a.manifest.category] ?? 99) -
        (CATEGORY_ORDER[b.manifest.category] ?? 99);
      if (byCategory !== 0) return byCategory;
      const byName = a.manifest.displayName.localeCompare(b.manifest.displayName);
      if (byName !== 0) return byName;
      return a.manifest.type.localeCompare(b.manifest.type);
    });
    return out;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  codecView(): CodecRegistry {
    return {
      resolveComponentType: (type, specVersion) => {
        const definition = this.byType.get(type);
        if (!definition) return { kind: "unknown" };
        const descriptor = descriptorOf(definition);
        if (specVersion === definition.manifest.specVersion) {
          return { kind: "known", descriptor };
        }
        if (specVersion > definition.manifest.specVersion) {
          return { kind: "future", descriptor, fileSpecVersion: specVersion };
        }
        // 旧版本：Codec 是唯一 Migration 执行者（规则 1）。
        return { kind: "known", descriptor };
      },
      // Phase 0 无独立 DataSource/Action Registry：一律视为未知（opaque 保留）。
      resolveDataSourceType: () => ({ kind: "unknown" }),
      resolveActionType: () => ({ kind: "unknown" }),
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

// ---------------------------------------------------------------------------
// 内部
// ---------------------------------------------------------------------------

/**
 * 创建不导出泛型 P 的 RegisteredComponentDefinition。
 * 私有闭包在校验通过后才把值交回 Renderer/Inspector（第 2.5 节）。
 */
function buildRegistered<P extends object>(
  definition: ComponentDefinition<P>,
): RegisteredComponentDefinition {
  deepFreeze(definition);
  return {
    manifest: definition.manifest,
    propsSchema: definition.propsSchema,
    slots: definition.slots as unknown as readonly SlotDefinition<object>[],
    events: definition.events,
    bindableTargets: definition.bindableTargets,
    migrations: definition.migrations,
    createCompanionDataSources: (context: CompanionDraftContext) =>
      definition.createCompanionDataSources(context),
    createDefaultPropsUnknown: (context: CreateComponentContext) =>
      definition.createDefaultProps(context),
    validateUnknown: (input: unknown) => definition.validate(input),
    renderUnknown: (props: ComponentRendererProps<object>): ReactNode => {
      const validation = definition.validate(props.props);
      if (!validation.ok) {
        return createElement("div", { className: "ocs-render-invalid" }, "组件 Props 非法，无法渲染");
      }
      return createElement(
        definition.Renderer,
        props as unknown as ComponentRendererProps<P>,
      );
    },
    inspectUnknown: (props: ComponentInspectorProps<object>): ReactNode => {
      if (!definition.Inspector) return null;
      const validation = definition.validate(props.value);
      if (!validation.ok) {
        return createElement("div", { className: "ocs-inspect-invalid" }, "组件 Props 非法，无法编辑");
      }
      return createElement(
        definition.Inspector,
        props as unknown as ComponentInspectorProps<P>,
      );
    },
    previewUnknown: (props: ComponentPreviewProps<object>): ReactNode => {
      if (!definition.Preview) return null;
      const validation = definition.validate(props.props);
      if (!validation.ok) return null;
      return createElement(
        definition.Preview,
        props as unknown as ComponentPreviewProps<P>,
      );
    },
  };
}

function descriptorOf(definition: RegisteredComponentDefinition): ComponentTypeDescriptor {
  return {
    currentSpecVersion: definition.manifest.specVersion,
    propsSchema: definition.propsSchema,
    schemaDefs: extractDefs(definition.propsSchema),
    migrations: definition.migrations,
    slots: definition.slots.map(toSlotDescriptor),
    events: definition.events,
    bindableTargets: definition.bindableTargets,
  };
}

function toSlotDescriptor(slot: SlotDefinition<object>): SlotDescriptor {
  return {
    name: slot.name,
    cardinality: slot.cardinality,
    accepts: slot.accepts,
  };
}

function extractDefs(schema: JsonSchema): Readonly<Record<string, JsonSchema>> {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    return {};
  }
  if (!("$defs" in schema)) return {};
  const defs = schema.$defs;
  if (defs === null || typeof defs !== "object" || Array.isArray(defs)) return {};
  // compileSchema 已校验 $defs 形状与所有 $ref 目标；此处只取用。
  return defs as Record<string, JsonSchema>;
}

function matchesFilter(
  definition: RegisteredComponentDefinition,
  filter: RegistryFilter,
): boolean {
  const manifest = definition.manifest;
  if (filter.category !== undefined && manifest.category !== filter.category) return false;
  if (filter.userCreatable !== undefined && manifest.userCreatable !== filter.userCreatable) {
    return false;
  }
  if (filter.rootAllowed !== undefined && manifest.rootAllowed !== filter.rootAllowed) {
    return false;
  }
  if (filter.search !== undefined && filter.search !== "") {
    const q = filter.search.toLowerCase();
    const haystack = [
      manifest.type,
      manifest.displayName,
      ...manifest.keywords,
    ].join(" ").toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

/** 解析连续 N→N+1 迁移路径；断链返回 null。 */
function resolveMigrationPath<T extends { readonly from: number; readonly to: number }>(
  migrations: readonly T[],
  fromVersion: number,
  toVersion: number,
): readonly T[] | null {
  if (fromVersion >= toVersion) return [];
  const byFrom = new Map<number, T>();
  for (const m of migrations) byFrom.set(m.from, m);
  const path: T[] = [];
  let current = fromVersion;
  const guard = new Set<number>();
  while (current < toVersion) {
    if (guard.has(current)) return null;
    guard.add(current);
    const m = byFrom.get(current);
    if (!m || m.to !== current + 1) return null;
    path.push(m);
    current = m.to;
  }
  return path;
}

/** 深冻结（规则 5）：Definition 注册后不可变。 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
