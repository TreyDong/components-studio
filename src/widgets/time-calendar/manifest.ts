/**
 * time.calendar Manifest（规格 28.10：新 Definition 扩展路径）。
 * 纯 UI 月历组件：不依赖 Query/Worker，Phase 0 即可注册渲染。
 * 无能力声明、无 Slot、无 Event。
 */

import type { ComponentManifest } from "../../registry/definition";
import type { ComponentType, IconName } from "@ocs/contracts";

export const timeCalendarManifest: ComponentManifest = {
  type: "time.calendar" as ComponentType,
  specVersion: 1,
  displayName: "日历",
  description: "显示月历网格，支持月份导航与今日高亮",
  category: "time",
  icon: "calendar" as IconName,
  keywords: ["calendar", "month", "日历", "月份", "日期"],
  vendor: "components-studio",
  packageVersion: "0.1.0",
  rootAllowed: false,
  userCreatable: true,
  declaredCapabilities: [],
};
