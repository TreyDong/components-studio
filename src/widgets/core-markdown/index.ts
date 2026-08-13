/**
 * core.markdown 组件定义入口。
 */

import { defineComponent } from "../../registry/defineComponent";
import type { ComponentDefinition } from "../../registry/definition";
import { coreMarkdownManifest } from "./manifest";
import {
  markdownPropsSchema,
  markdownDefaultProps,
  validateMarkdownProps,
} from "./schema";
import type { MarkdownProps } from "./schema";
import { coreMarkdownMigrations } from "./migrations";
import { CoreMarkdownRenderer } from "./Renderer";
import { CoreMarkdownInspector } from "./Inspector";

export const coreMarkdownDefinition: ComponentDefinition<MarkdownProps> = defineComponent({
  manifest: coreMarkdownManifest,
  propsSchema: markdownPropsSchema,
  slots: [],
  events: [],
  bindableTargets: [],
  migrations: coreMarkdownMigrations,
  createCompanionDataSources: () => [],
  createDefaultProps: () => markdownDefaultProps(),
  validate: validateMarkdownProps,
  Renderer: CoreMarkdownRenderer,
  Inspector: CoreMarkdownInspector,
});

export type { MarkdownProps, MarkdownSource } from "./schema";
export { markdownPropsSchema, markdownDefaultProps, coreMarkdownManifest, coreMarkdownMigrations };
export { sliceMarkdown } from "./Renderer";
