/**
 * time.clock Manifest（《运行时与 SDK 协议 v1》第 9.7 节）。
 * 声明 timer:use 能力；内置类型 vendor=components-studio。
 */

import type { ComponentManifest } from "../../registry/definition";
import type { ComponentType, IconName } from "@ocs/contracts";

export const timeClockManifest: ComponentManifest = {
  type: "time.clock" as ComponentType,
  specVersion: 1,
  displayName: "时钟",
  description: "显示本地或指定时区的实时时钟",
  category: "time",
  icon: "clock" as IconName,
  keywords: ["clock", "time", "时间", "时钟", "时区"],
  vendor: "components-studio",
  packageVersion: "0.1.0",
  rootAllowed: false,
  userCreatable: true,
  declaredCapabilities: ["timer:use"],
};
