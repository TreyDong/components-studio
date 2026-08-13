/**
 * time.calendar Inspector：locale / firstDayOfWeek / 显示开关 / label。
 */

import type { ComponentInspectorProps } from "../../registry/definition";
import type { CalendarProps } from "./schema";

const WEEK_START_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 0, label: "周日" },
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
];

export function TimeCalendarInspector(props: ComponentInspectorProps<CalendarProps>) {
  const { value, controller, issues } = props;

  const commit = (next: CalendarProps, label: string): void => {
    controller.replace(next, { label, save: "debounced" });
  };

  return (
    <div className="ocs-inspector">
      {issues.length > 0 && (
        <ul className="ocs-inspector-issues">
          {issues.map((issue, i) => (
            <li key={i}>
              {issue.pointer}: {issue.message}
            </li>
          ))}
        </ul>
      )}

      <label className="ocs-field">
        <span>区域</span>
        <input
          type="text"
          value={value.locale}
          onChange={(event) => commit({ ...value, locale: event.target.value }, "修改区域")}
        />
      </label>

      <label className="ocs-field">
        <span>周起始</span>
        <select
          value={value.firstDayOfWeek}
          onChange={(event) =>
            commit({ ...value, firstDayOfWeek: Number(event.target.value) }, "修改周起始")
          }
        >
          {WEEK_START_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="ocs-field ocs-field-toggle">
        <span>显示周数</span>
        <input
          type="checkbox"
          checked={value.showWeekNumbers}
          onChange={(event) => commit({ ...value, showWeekNumbers: event.target.checked }, "切换周数")}
        />
      </label>

      <label className="ocs-field ocs-field-toggle">
        <span>高亮今天</span>
        <input
          type="checkbox"
          checked={value.showToday}
          onChange={(event) => commit({ ...value, showToday: event.target.checked }, "切换今日高亮")}
        />
      </label>

      <label className="ocs-field ocs-field-toggle">
        <span>显示相邻月</span>
        <input
          type="checkbox"
          checked={value.showAdjacentDays}
          onChange={(event) =>
            commit({ ...value, showAdjacentDays: event.target.checked }, "切换相邻月")
          }
        />
      </label>

      <label className="ocs-field">
        <span>标题</span>
        <input
          type="text"
          value={value.label}
          maxLength={120}
          onChange={(event) => commit({ ...value, label: event.target.value }, "修改标题")}
        />
      </label>
    </div>
  );
}
