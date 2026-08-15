/**
 * core.data-table Props / Schema / 默认值 / validate（《运行时与 SDK 协议 v1》第 9 节）。
 *
 * 纯静态数据表：行数据内联在文档 props 中（Phase 0 无数据源）。
 * 单元格值限定为标量（string / number / boolean / null）。
 */

import type { JsonValue, ValidationIssue, ValidationResult } from "@ocs/contracts";
import { validateAgainstSchema } from "../../schema/validator";
import type { JsonObjectSchema } from "../../schema/validator";

export type TableCellAlign = "left" | "center" | "right";

export interface DataTableColumn {
  readonly key: string;
  readonly label: string;
  readonly width?: number | null;
  readonly align?: TableCellAlign;
}

export interface DataTableProps {
  readonly title?: string;
  readonly showHeader: boolean;
  readonly columns: readonly DataTableColumn[];
  readonly rows: readonly Record<string, JsonValue>[];
  readonly emptyText: string;
  readonly striped: boolean;
}

/** 冻结 Schema：列 key/label 必填、width 像素、align 枚举；行允许任意标量。 */
export const dataTablePropsSchema: JsonObjectSchema = {
  type: "object",
  properties: {
    title: { type: "string", maxLength: 120 },
    showHeader: { type: "boolean" },
    columns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string", minLength: 1, maxLength: 64 },
          label: { type: "string", maxLength: 80 },
          width: { type: "number", minimum: 40, maximum: 600 },
          align: { type: "string", enum: ["left", "center", "right"] },
        },
        required: ["key", "label"],
        additionalProperties: false,
      },
      maxItems: 32,
    },
    rows: {
      type: "array",
      items: { type: "object", properties: {}, required: [], additionalProperties: true },
      maxItems: 500,
    },
    emptyText: { type: "string", maxLength: 120 },
    striped: { type: "boolean" },
  },
  required: ["showHeader", "columns", "rows", "emptyText", "striped"],
  additionalProperties: false,
};

/** 默认 Props（每次返回全新对象）。 */
export function dataTableDefaultProps(): DataTableProps {
  return {
    title: "数据表格",
    showHeader: true,
    columns: [{ key: "col1", label: "列 1" }],
    rows: [],
    emptyText: "暂无数据",
    striped: true,
  };
}

export function validateDataTableProps(input: unknown): ValidationResult<DataTableProps> {
  const issues: ValidationIssue[] = [];
  validateAgainstSchema(input, dataTablePropsSchema, {}, issues, "$");
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: input as DataTableProps, warnings: [] };
}
