/**
 * time.calendar 组件定义入口。
 */

import { defineComponent } from "../../registry/defineComponent";
import type { ComponentDefinition } from "../../registry/definition";
import { timeCalendarManifest } from "./manifest";
import {
  calendarPropsSchema,
  calendarDefaultProps,
  validateCalendarProps,
} from "./schema";
import type { CalendarProps } from "./schema";
import { timeCalendarMigrations } from "./migrations";
import { TimeCalendarRenderer } from "./Renderer";
import { TimeCalendarInspector } from "./Inspector";

export const timeCalendarDefinition: ComponentDefinition<CalendarProps> = defineComponent({
  manifest: timeCalendarManifest,
  propsSchema: calendarPropsSchema,
  slots: [],
  events: [],
  bindableTargets: [],
  migrations: timeCalendarMigrations,
  createCompanionDataSources: () => [],
  createDefaultProps: () => calendarDefaultProps(),
  validate: validateCalendarProps,
  Renderer: TimeCalendarRenderer,
  Inspector: TimeCalendarInspector,
});

export type { CalendarProps };
export {
  calendarPropsSchema,
  calendarDefaultProps,
  timeCalendarManifest,
  timeCalendarMigrations,
};
export { buildMonthGrid, formatMonthTitle, weekdayShortNames } from "./schema";
