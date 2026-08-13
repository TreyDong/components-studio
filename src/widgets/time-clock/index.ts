/**
 * time.clock 组件定义入口。
 */

import { defineComponent } from "../../registry/defineComponent";
import type { ComponentDefinition } from "../../registry/definition";
import { timeClockManifest } from "./manifest";
import { clockPropsSchema, clockDefaultProps, validateClockProps } from "./schema";
import type { ClockProps } from "./schema";
import { timeClockMigrations } from "./migrations";
import { TimeClockRenderer } from "./Renderer";
import { TimeClockInspector } from "./Inspector";

export const timeClockDefinition: ComponentDefinition<ClockProps> = defineComponent({
  manifest: timeClockManifest,
  propsSchema: clockPropsSchema,
  slots: [],
  events: [],
  bindableTargets: [],
  migrations: timeClockMigrations,
  createCompanionDataSources: () => [],
  createDefaultProps: () => clockDefaultProps(),
  validate: validateClockProps,
  Renderer: TimeClockRenderer,
  Inspector: TimeClockInspector,
});

export type { ClockProps };
export { clockPropsSchema, clockDefaultProps, timeClockManifest, timeClockMigrations };
export { formatClock } from "./Renderer";
