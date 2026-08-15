/**
 * core.data-table Manifest（《运行时与 SDK 协议 v1》第 9 节）。
 * 纯展示组件，无 Vault 能力声明；vendor=components-studio。
 */

import type { ComponentManifest } from "../../registry/definition";
import type { ComponentType, IconName } from "@ocs/contracts";

export const coreDataTableManifest: ComponentManifest = {
  type: "core.data-table" as ComponentType,
  specVersion: 1,
  displayName: "数据表格",
  description: "内联数据的结构化表格：列定义、对齐、斑马纹与空态",
  category: "data",
  icon: "table" as IconName,
  keywords: ["表格", "数据", "table", "list", "列表"],
  vendor: "components-studio",
  packageVersion: "0.1.0",
  rootAllowed: false,
  userCreatable: true,
  declaredCapabilities: [],
};
