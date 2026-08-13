/**
 * time.calendar Renderer（纯 UI 月历）。
 *
 * - 真实 <table> 语义（规格 12.7：Table 用真实表格或等价 ARIA）。
 * - 当前显示月份是 React state（临时交互状态），不写 Props。
 * - 今日高亮、相邻月灰显、可选周数、月份导航（按钮 + 键盘）。
 * - 无能力、无 Event、无 Slot。
 */

import { useState } from "react";
import type { CSSProperties } from "react";
import type { ComponentRendererProps } from "../../registry/definition";
import {
  buildMonthGrid,
  formatMonthTitle,
  weekdayShortNames,
} from "./schema";
import type { CalendarProps } from "./schema";

const MONTHS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export function TimeCalendarRenderer(props: ComponentRendererProps<CalendarProps>) {
  const { props: p } = props;
  const today = new Date();
  const [view, setView] = useState<{ year: number; month: number }>(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }));

  const grid = buildMonthGrid(view.year, view.month, p.firstDayOfWeek, today);
  const weekdays = weekdayShortNames(p.locale, p.firstDayOfWeek);
  const title = p.label
    ? `${p.label} · ${formatMonthTitle(view.year, view.month, p.locale)}`
    : formatMonthTitle(view.year, view.month, p.locale);

  const shiftMonth = (delta: number): void => {
    const total = view.year * 12 + view.month + delta;
    setView({ year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 });
  };

  const backToToday = (): void => {
    setView({ year: today.getFullYear(), month: today.getMonth() });
  };

  const isCurrentMonth =
    view.year === today.getFullYear() && view.month === today.getMonth();

  return (
    <div
      className="ocs-calendar"
      data-view-year={view.year}
      data-view-month={view.month}
      style={p.accent ? ({ "--ocs-cal-accent": p.accent } as CSSProperties) : undefined}
    >
      <div className="ocs-calendar-header">
        <button
          type="button"
          className="ocs-calendar-nav-btn"
          aria-label="上个月"
          onClick={() => shiftMonth(-1)}
        >
          ‹
        </button>
        <div className="ocs-calendar-title" role="heading" aria-level={2}>
          {title}
        </div>
        <button
          type="button"
          className="ocs-calendar-nav-btn"
          aria-label="下个月"
          onClick={() => shiftMonth(1)}
        >
          ›
        </button>
        {!isCurrentMonth && (
          <button
            type="button"
            className="ocs-calendar-today-btn"
            onClick={backToToday}
          >
            今天
          </button>
        )}
      </div>

      <table className="ocs-calendar-grid">
        <caption className="visually-hidden">{title}</caption>
        <thead>
          <tr>
            {p.showWeekNumbers && (
              <th scope="col" className="ocs-calendar-weeknum-head" aria-label="周">
                周
              </th>
            )}
            {weekdays.map((name, i) => (
              <th scope="col" key={i} className="ocs-calendar-weekday">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((week, row) => (
            <tr key={row}>
              {p.showWeekNumbers && (
                <td className="ocs-calendar-weeknum" aria-label={`第 ${week[0]!.weekNumber} 周`}>
                  {week[0]!.weekNumber}
                </td>
              )}
              {week.map((cell, col) => {
                const dayLabel = cell.date.toLocaleDateString(
                  p.locale === "system" ? undefined : p.locale,
                  { year: "numeric", month: "long", day: "numeric", weekday: "long" },
                );
                const className = [
                  "ocs-calendar-day",
                  cell.isToday && p.showToday ? "ocs-calendar-today" : "",
                  cell.adjacent ? "ocs-calendar-adjacent" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <td key={col}>
                    <span
                      className={className}
                      aria-label={dayLabel}
                      aria-current={cell.isToday ? "date" : undefined}
                    >
                      {cell.adjacent && !p.showAdjacentDays
                        ? ""
                        : String(cell.date.getDate())}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { MONTHS };
