/**
 * core.markdown Manifest（《运行时与 SDK 协议 v1》第 9.3 节）。
 * file 模式声明 vault:read 能力；内置类型 vendor=components-studio。
 */

import type { ComponentManifest } from "../../registry/definition";
import type { ComponentType, IconName } from "@ocs/contracts";

export const coreMarkdownManifest: ComponentManifest = {
  type: "core.markdown" as ComponentType,
  specVersion: 1,
  displayName: "Markdown",
  description: "渲染内联或引用笔记的 Markdown 内容",
  category: "content",
  icon: "file-text" as IconName,
  keywords: ["markdown", "md", "笔记", "内容", "引用"],
  vendor: "components-studio",
  packageVersion: "0.1.0",
  rootAllowed: false,
  userCreatable: true,
  declaredCapabilities: ["vault:read"],
};
