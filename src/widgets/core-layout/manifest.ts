/**
 * core.layout Manifest（《运行时与 SDK 协议 v1》第 9.1 节）。
 * 内置类型使用 vendor=components-studio、packageVersion=0.1.0。
 */

import type { ComponentManifest } from "../../registry/definition";
import type { ComponentType, IconName } from "@ocs/contracts";

export const coreLayoutManifest: ComponentManifest = {
  type: "core.layout" as ComponentType,
  specVersion: 1,
  displayName: "布局",
  description: "堆叠、分栏、栅格与标签页布局容器",
  category: "layout",
  icon: "layout-grid" as IconName,
  keywords: ["layout", "grid", "tabs", "columns", "布局", "栅格", "标签页"],
  vendor: "components-studio",
  packageVersion: "0.1.0",
  rootAllowed: true,
  userCreatable: true,
  declaredCapabilities: [],
};
