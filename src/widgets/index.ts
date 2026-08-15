/**
 * 内置组件（widgets）规范清单。
 *
 * 插件注册、安装测试、注册完整性测试统一从这份列表消费，
 * 防止"定义了组件但忘记注册 → 文档里显示缺少对应组件实现"。
 */

import type { ComponentDefinition } from "../registry/definition";
import { coreLayoutDefinition } from "./core-layout";
import { coreMarkdownDefinition } from "./core-markdown";
import { coreNavListDefinition } from "./core-nav-list";
import { coreStatCardDefinition } from "./core-stat-card";
import { coreDataTableDefinition } from "./core-data-table";
import { timeClockDefinition } from "./time-clock";
import { timeCalendarDefinition } from "./time-calendar";
import { legacyComponents25Definition } from "./legacy-components-2-5";
import { projectDashboardDefinition } from "./project-dashboard";

/** 全部内置组件定义；顺序即注册顺序。 */
export const BUILTIN_WIDGET_DEFINITIONS: readonly ComponentDefinition<object>[] = [
  coreLayoutDefinition,
  coreMarkdownDefinition,
  coreNavListDefinition,
  coreStatCardDefinition,
  coreDataTableDefinition,
  timeClockDefinition,
  timeCalendarDefinition,
  legacyComponents25Definition,
  projectDashboardDefinition,
] as unknown as readonly ComponentDefinition<object>[];
