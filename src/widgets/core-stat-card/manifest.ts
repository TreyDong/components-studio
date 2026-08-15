/**
 * core.stat-card Manifest（《运行时与 SDK 协议 v1》第 9 节）。
 * 纯展示组件，无 Vault 能力声明；vendor=components-studio。
 */

import type { ComponentManifest } from "../../registry/definition";
import type { ComponentType, IconName } from "@ocs/contracts";

export const coreStatCardManifest: ComponentManifest = {
  type: "core.stat-card" as ComponentType,
  specVersion: 1,
  displayName: "指标卡",
  description: "单个 KPI 指标卡：数值、单位、趋势与备注",
  category: "data",
  icon: "chart-bar" as IconName,
  keywords: ["指标", "统计", "kpi", "stat", "metric"],
  vendor: "components-studio",
  packageVersion: "0.1.0",
  rootAllowed: false,
  userCreatable: true,
  declaredCapabilities: [],
};
