/**
 * core.layout 组件定义入口。
 * 导出 definition 常量与 Props 类型 / Schema / Manifest / Migrations（供测试与宿主组装）。
 */

import { defineComponent } from "../../registry/defineComponent";
import type { ComponentDefinition } from "../../registry/definition";
import { coreLayoutManifest } from "./manifest";
import {
  coreLayoutPropsSchema,
  coreLayoutSlots,
  coreLayoutDefaultProps,
  validateCoreLayoutProps,
} from "./schema";
import type { CoreLayoutProps } from "./schema";
import { coreLayoutMigrations } from "./migrations";
import { CoreLayoutRenderer } from "./Renderer";
import { CoreLayoutInspector } from "./Inspector";

export const coreLayoutDefinition: ComponentDefinition<CoreLayoutProps> = defineComponent({
  manifest: coreLayoutManifest,
  propsSchema: coreLayoutPropsSchema,
  slots: coreLayoutSlots,
  events: [],
  bindableTargets: [],
  migrations: coreLayoutMigrations,
  createCompanionDataSources: () => [],
  createDefaultProps: () => coreLayoutDefaultProps(),
  validate: validateCoreLayoutProps,
  Renderer: CoreLayoutRenderer,
  Inspector: CoreLayoutInspector,
});

export type { CoreLayoutProps };
export { coreLayoutManifest, coreLayoutPropsSchema, coreLayoutMigrations, coreLayoutDefaultProps };
