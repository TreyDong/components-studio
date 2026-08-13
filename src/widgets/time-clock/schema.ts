/**
 * time.clock Props / Schema / 默认值 / validate（《运行时与 SDK 协议 v1》第 9.7 节）。
 *
 * 额外验证（第 9.7 节）：Definition.validate 必须实际尝试构造 Intl.DateTimeFormat——
 * timeZone="local" 时省略 Intl timeZone；locale="system" 时使用 Intl 默认 locale。
 * 无效 IANA 时区或 BCP 47 locale 返回字段级错误。
 */

import { ERROR_CODES } from "@ocs/contracts";
import type { ValidationIssue, ValidationResult } from "@ocs/contracts";
import { validateAgainstSchema } from "../../schema/validator";
import type { JsonObjectSchema } from "../../schema/validator";

export interface ClockProps {
  /** "local" 表示省略 Intl timeZone；其余按 IANA 时区名。 */
  readonly timeZone: string;
  /** "system" 表示使用 Intl 默认 locale；其余按 BCP 47。 */
  readonly locale: string;
  readonly hourCycle: "h12" | "h23";
  readonly showSeconds: boolean;
  readonly showDate: boolean;
  readonly dateStyle: "short" | "medium" | "long" | "full";
  readonly timeStyle: "short" | "medium";
  readonly label: string;
}

/** 第 9.7 节冻结 Schema。 */
export const clockPropsSchema: JsonObjectSchema = {
  type: "object",
  properties: {
    timeZone: { type: "string", minLength: 1, maxLength: 100 },
    locale: { type: "string", minLength: 1, maxLength: 100 },
    hourCycle: { type: "string", enum: ["h12", "h23"] },
    showSeconds: { type: "boolean" },
    showDate: { type: "boolean" },
    dateStyle: { type: "string", enum: ["short", "medium", "long", "full"] },
    timeStyle: { type: "string", enum: ["short", "medium"] },
    label: { type: "string", maxLength: 120 },
  },
  required: [
    "timeZone",
    "locale",
    "hourCycle",
    "showSeconds",
    "showDate",
    "dateStyle",
    "timeStyle",
    "label",
  ],
  additionalProperties: false,
};

/** 第 9.7 节默认 Props（每次返回全新对象）。 */
export function clockDefaultProps(): ClockProps {
  return {
    timeZone: "local",
    locale: "system",
    hourCycle: "h23",
    showSeconds: false,
    showDate: true,
    dateStyle: "medium",
    timeStyle: "short",
    label: "",
  };
}

export function validateClockProps(input: unknown): ValidationResult<ClockProps> {
  const issues: ValidationIssue[] = [];
  validateAgainstSchema(input, clockPropsSchema, {}, issues, "$");
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  // Schema（additionalProperties:false）校验通过后即为 ClockProps。
  const value = input as ClockProps;
  if (value.locale !== "system") {
    try {
      new Intl.DateTimeFormat(value.locale);
    } catch {
      issues.push({
        pointer: "/locale",
        code: ERROR_CODES.COMPONENT_PROPS_INVALID,
        message: `无效 BCP 47 locale: ${value.locale}`,
        severity: "error",
      });
    }
  }
  if (value.timeZone !== "local") {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value.timeZone });
    } catch {
      issues.push({
        pointer: "/timeZone",
        code: ERROR_CODES.COMPONENT_PROPS_INVALID,
        message: `无效 IANA 时区: ${value.timeZone}`,
        severity: "error",
      });
    }
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value, warnings: [] };
}
