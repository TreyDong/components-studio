/**
 * time.calendar Props / Schema / 默认值 / validate。
 *
 * 持久 Props 只保存展示配置；当前显示月份是临时交互状态（React state），
 * 不写入 Props（规格 9.9 状态分类）。
 */

import { ERROR_CODES } from "@ocs/contracts";
import type { ValidationIssue, ValidationResult } from "@ocs/contracts";
import { validateAgainstSchema } from "../../schema/validator";
import type { JsonObjectSchema } from "../../schema/validator";

export interface CalendarProps {
  /** "system" 表示使用 Intl 默认 locale；其余按 BCP 47。 */
  readonly locale: string;
  /** 周起始：0=周日 … 6=周六。 */
  readonly firstDayOfWeek: number;
  readonly showWeekNumbers: boolean;
  readonly showToday: boolean;
  readonly showAdjacentDays: boolean;
  /** 标题前缀，只用于编辑器识别；null 不展示。 */
  readonly label: string;
  /**
   * 强调色（#RRGGBB/#RRGGBBAA），覆盖 --ocs-accent token。
   * 可选：旧文档无此字段时按 null 处理；向后兼容（非 required）。
   */
  readonly accent: string | null;
}

export const calendarPropsSchema: JsonObjectSchema = {
  type: "object",
  properties: {
    locale: { type: "string", minLength: 1, maxLength: 100 },
    firstDayOfWeek: { type: "integer", minimum: 0, maximum: 6 },
    showWeekNumbers: { type: "boolean" },
    showToday: { type: "boolean" },
    showAdjacentDays: { type: "boolean" },
    label: { type: "string", maxLength: 120 },
    accent: {
      oneOf: [
        { type: "string", pattern: "^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$", maxLength: 9 },
        { type: "null" },
      ],
    },
  },
  required: [
    "locale",
    "firstDayOfWeek",
    "showWeekNumbers",
    "showToday",
    "showAdjacentDays",
    "label",
  ],
  additionalProperties: false,
};

export function calendarDefaultProps(): CalendarProps {
  return {
    locale: "system",
    firstDayOfWeek: 1,
    showWeekNumbers: false,
    showToday: true,
    showAdjacentDays: false,
    label: "",
    accent: null,
  };
}

export function validateCalendarProps(input: unknown): ValidationResult<CalendarProps> {
  const issues: ValidationIssue[] = [];
  validateAgainstSchema(input, calendarPropsSchema, {}, issues, "$");
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  const raw = input as Record<string, unknown>;
  // 向后兼容：旧文档缺少 accent 字段时按 null 处理。
  const normalized: CalendarProps = {
    ...(input as CalendarProps),
    accent: typeof raw.accent === "string" ? raw.accent : null,
  };
  if (typeof normalized.locale === "string" && normalized.locale !== "system") {
    try {
      const resolved = Intl.DateTimeFormat(normalized.locale).resolvedOptions().locale;
      if (!resolved) {
        issues.push({
          pointer: "$/locale",
          code: ERROR_CODES.DOC_SCHEMA_INVALID,
          message: "无效 BCP 47 locale",
          severity: "error",
        });
      }
    } catch {
      issues.push({
        pointer: "$/locale",
        code: ERROR_CODES.DOC_SCHEMA_INVALID,
        message: "无效 BCP 47 locale",
        severity: "error",
      });
    }
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: normalized, warnings: [] };
}

// ---------------------------------------------------------------------------
// 月历算法（纯函数，确定性强，供 Renderer 与测试共用）
// ---------------------------------------------------------------------------

export interface CalendarCell {
  /** 该单元格日期（相邻月也返回真实日期）；永远非 null。 */
  readonly date: Date;
  /** 日号；相邻月为 null 显示。 */
  readonly day: number | null;
  /** 是否属于相邻月（灰显）。 */
  readonly adjacent: boolean;
  /** 是否今天。 */
  readonly isToday: boolean;
  /** 周数（ISO 风格，按 firstDayOfWeek 对齐的周）。 */
  readonly weekNumber: number;
}

/**
 * 构建月历网格：6 行 × 7 列，固定 42 格（跨月视图稳定）。
 * `month` 为 0 基；`today` 用于今日判定（本地时间）。
 */
export function buildMonthGrid(
  year: number,
  month: number,
  firstDayOfWeek: number,
  today: Date,
): CalendarCell[][] {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() - firstDayOfWeek + 7) % 7;

  const prevDays = new Date(year, month, 0).getDate();
  const isSameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const grid: CalendarCell[][] = [];
  for (let row = 0; row < 6; row++) {
    const cells: CalendarCell[] = [];
    for (let col = 0; col < 7; col++) {
      const index = row * 7 + col - lead; // -lead .. daysInMonth-1
      let date: Date;
      let adjacent: boolean;
      if (index < 0) {
        date = new Date(year, month - 1, prevDays + index + 1);
        adjacent = true;
      } else if (index >= daysInMonth) {
        date = new Date(year, month + 1, index - daysInMonth + 1);
        adjacent = true;
      } else {
        date = new Date(year, month, index + 1);
        adjacent = false;
      }
      const weekStart = new Date(date);
      const offset = (date.getDay() - firstDayOfWeek + 7) % 7;
      weekStart.setDate(date.getDate() - offset);
      // ISO 风格周数：周四所在的周。简化：基于 weekStart 的周计算。
      const weekNumber = isoWeekNumber(weekStart);
      cells.push({
        date,
        day: adjacent ? null : index + 1,
        adjacent,
        isToday: isSameDay(date, today),
        weekNumber,
      });
    }
    grid.push(cells);
  }
  return grid;
}

/** 与 ISO 8601 兼容的周数（周一=1；此处按 firstDayOfWeek 对齐后近似）。 */
function isoWeekNumber(weekStart: Date): number {
  const target = new Date(weekStart);
  // 计算该周周四所在年
  const thursday = new Date(target);
  thursday.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const year = thursday.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const week1Start = new Date(jan1);
  week1Start.setDate(jan1.getDate() + (1 - ((jan1.getDay() + 6) % 7)));
  return Math.floor((thursday.getTime() - week1Start.getTime()) / 604800000) + 1;
}

/** 年-月标题（本地化）。locale="system" 时用默认。 */
export function formatMonthTitle(year: number, month: number, locale: string): string {
  const date = new Date(year, month, 15);
  const loc = locale === "system" ? undefined : locale;
  try {
    return new Intl.DateTimeFormat(loc, { year: "numeric", month: "long" }).format(date);
  } catch {
    return `${year} 年 ${month + 1} 月`;
  }
}

/** 周名短标签（本地化）。 */
export function weekdayShortNames(locale: string, firstDayOfWeek: number): string[] {
  const loc = locale === "system" ? undefined : locale;
  const names: string[] = [];
  try {
    const fmt = new Intl.DateTimeFormat(loc, { weekday: "short" });
    for (let offset = 0; offset < 7; offset++) {
      const day = (firstDayOfWeek + offset) % 7;
      names.push(fmt.format(new Date(2026, 0, 4 + day))); // 2026-01-04 是周日
    }
  } catch {
    for (let offset = 0; offset < 7; offset++) {
      names.push(["日", "一", "二", "三", "四", "五", "六"][(firstDayOfWeek + offset) % 7]!);
    }
  }
  return names;
}
