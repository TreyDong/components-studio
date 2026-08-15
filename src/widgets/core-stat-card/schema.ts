/**
 * core.stat-card Props / Schema / 默认值 / validate（《运行时与 SDK 协议 v1》第 9 节）。
 *
 * 纯静态指标卡：数据内联在文档 props 中（Phase 0 无数据源）。
 * trend 语义：up 上升 / down 下降 / flat 持平；缺省不渲染趋势。
 */

import type { ValidationIssue, ValidationResult } from "@ocs/contracts";
import { validateAgainstSchema } from "../../schema/validator";
import type { JsonObjectSchema } from "../../schema/validator";

export type StatCardTrend = "up" | "down" | "flat";

export interface StatCardProps {
  readonly title: string;
  readonly value: string;
  readonly unit?: string;
  readonly trend?: StatCardTrend;
  readonly trendLabel?: string;
  readonly accent?: string;
  readonly note?: string;
  readonly icon?: string;
}

/** 冻结 Schema：title/value 必填，trend 枚举，accent 颜色格式，icon 图标名格式。 */
export const statCardPropsSchema: JsonObjectSchema = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1, maxLength: 120 },
    value: { type: "string", minLength: 1, maxLength: 40 },
    unit: { type: "string", maxLength: 20 },
    trend: { type: "string", enum: ["up", "down", "flat"] },
    trendLabel: { type: "string", maxLength: 80 },
    accent: { type: "string", format: "color" },
    note: { type: "string", maxLength: 200 },
    icon: { type: "string", format: "icon-name" },
  },
  required: ["title", "value"],
  additionalProperties: false,
};

/** 默认 Props（每次返回全新对象）。 */
export function statCardDefaultProps(): StatCardProps {
  return { title: "指标", value: "0" };
}

export function validateStatCardProps(input: unknown): ValidationResult<StatCardProps> {
  const issues: ValidationIssue[] = [];
  validateAgainstSchema(input, statCardPropsSchema, {}, issues, "$");
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: input as StatCardProps, warnings: [] };
}
