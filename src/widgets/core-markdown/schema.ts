/**
 * core.markdown Props / Schema / 默认值 / validate（《运行时与 SDK 协议 v1》第 9.3 节）。
 *
 * 额外验证（第 9.3 节）：file path 扩展名必须为 .md；heading 与 blockId 不得同时存在。
 */

import { ERROR_CODES } from "@ocs/contracts";
import type { ValidationIssue, ValidationResult } from "@ocs/contracts";
import { validateAgainstSchema } from "../../schema/validator";
import type { JsonObjectSchema } from "../../schema/validator";

export type MarkdownSource =
  | { readonly kind: "inline"; readonly content: string }
  | {
      readonly kind: "file";
      readonly path: string;
      readonly heading?: string;
      readonly blockId?: string;
    };

export interface MarkdownProps {
  readonly source: MarkdownSource;
  readonly showSourceTitle: boolean;
  readonly emptyText: string;
}

/** 第 9.3 节冻结 Schema。 */
export const markdownPropsSchema: JsonObjectSchema = {
  type: "object",
  properties: {
    source: {
      oneOf: [
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["inline"] },
            content: { type: "string", maxLength: 204800 },
          },
          required: ["kind", "content"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["file"] },
            path: { type: "string", minLength: 1, maxLength: 1024, format: "vault-path" },
            heading: { type: "string", minLength: 1, maxLength: 300 },
            blockId: { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" },
          },
          required: ["kind", "path"],
          additionalProperties: false,
        },
      ],
    },
    showSourceTitle: { type: "boolean" },
    emptyText: { type: "string", maxLength: 300 },
  },
  required: ["source", "showSourceTitle", "emptyText"],
  additionalProperties: false,
};

/** 第 9.3 节默认 Props（每次返回全新对象）。 */
export function markdownDefaultProps(): MarkdownProps {
  return {
    source: { kind: "inline", content: "开始编写内容" },
    showSourceTitle: false,
    emptyText: "暂无内容",
  };
}

export function validateMarkdownProps(input: unknown): ValidationResult<MarkdownProps> {
  const issues: ValidationIssue[] = [];
  validateAgainstSchema(input, markdownPropsSchema, {}, issues, "$");
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  // Schema（additionalProperties:false）校验通过后即为 MarkdownProps。
  const value = input as MarkdownProps;
  if (value.source.kind === "file") {
    if (!value.source.path.endsWith(".md")) {
      issues.push({
        pointer: "/source/path",
        code: ERROR_CODES.COMPONENT_PROPS_INVALID,
        message: "file path 扩展名必须为 .md",
        severity: "error",
      });
    }
    if (value.source.heading !== undefined && value.source.blockId !== undefined) {
      issues.push({
        pointer: "/source",
        code: ERROR_CODES.COMPONENT_PROPS_INVALID,
        message: "heading 与 blockId 不得同时存在",
        severity: "error",
      });
    }
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value, warnings: [] };
}
