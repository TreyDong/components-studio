/**
 * core.stat-card 组件定义入口。
 */

import { defineComponent } from "../../registry/defineComponent";
import type { ComponentDefinition } from "../../registry/definition";
import { coreStatCardManifest } from "./manifest";
import {
  statCardPropsSchema,
  statCardDefaultProps,
  validateStatCardProps,
} from "./schema";
import type { StatCardProps } from "./schema";
import { coreStatCardMigrations } from "./migrations";
import { CoreStatCardRenderer } from "./Renderer";

export const coreStatCardDefinition: ComponentDefinition<StatCardProps> = defineComponent({
  manifest: coreStatCardManifest,
  propsSchema: statCardPropsSchema,
  slots: [],
  events: [],
  bindableTargets: [],
  migrations: coreStatCardMigrations,
  createCompanionDataSources: () => [],
  createDefaultProps: () => statCardDefaultProps(),
  validate: validateStatCardProps,
  Renderer: CoreStatCardRenderer,
  Inspector: null,
});

export type { StatCardProps, StatCardTrend } from "./schema";
export { statCardPropsSchema, statCardDefaultProps, coreStatCardManifest, coreStatCardMigrations };
