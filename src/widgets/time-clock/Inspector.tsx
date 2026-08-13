/**
 * time.clock Inspector（《运行时与 SDK 协议 v1》第 9.7 节）。
 * timeZone / locale / hourCycle / showSeconds / showDate / 条件 dateStyle / timeStyle / label。
 */

import type { ComponentInspectorProps } from "../../registry/definition";
import type { ClockProps } from "./schema";

const HOUR_CYCLES: readonly { value: ClockProps["hourCycle"]; label: string }[] = [
  { value: "h12", label: "12 小时" },
  { value: "h23", label: "24 小时" },
];

const DATE_STYLES: readonly { value: ClockProps["dateStyle"]; label: string }[] = [
  { value: "short", label: "短" },
  { value: "medium", label: "中" },
  { value: "long", label: "长" },
  { value: "full", label: "完整" },
];

const TIME_STYLES: readonly { value: ClockProps["timeStyle"]; label: string }[] = [
  { value: "short", label: "短（时:分）" },
  { value: "medium", label: "中（含秒）" },
];

export function TimeClockInspector(props: ComponentInspectorProps<ClockProps>) {
  const { value, controller, issues } = props;

  const commit = (next: ClockProps, label: string): void => {
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
        <span>时区</span>
        <input
          type="text"
          value={value.timeZone}
          onChange={(event) => commit({ ...value, timeZone: event.target.value }, "修改时区")}
        />
      </label>

      <label className="ocs-field">
        <span>区域</span>
        <input
          type="text"
          value={value.locale}
          onChange={(event) => commit({ ...value, locale: event.target.value }, "修改区域")}
        />
      </label>

      <label className="ocs-field">
        <span>小时制</span>
        <select
          value={value.hourCycle}
          onChange={(event) =>
            commit({ ...value, hourCycle: event.target.value as ClockProps["hourCycle"] }, "修改小时制")
          }
        >
          {HOUR_CYCLES.map((h) => (
            <option key={h.value} value={h.value}>
              {h.label}
            </option>
          ))}
        </select>
      </label>

      <label className="ocs-field">
        <span>显示秒</span>
        <input
          type="checkbox"
          checked={value.showSeconds}
          onChange={(event) => commit({ ...value, showSeconds: event.target.checked }, "切换秒显示")}
        />
      </label>

      <label className="ocs-field">
        <span>显示日期</span>
        <input
          type="checkbox"
          checked={value.showDate}
          onChange={(event) => commit({ ...value, showDate: event.target.checked }, "切换日期显示")}
        />
      </label>

      {value.showDate && (
        <label className="ocs-field">
          <span>日期格式</span>
          <select
            value={value.dateStyle}
            onChange={(event) =>
              commit({ ...value, dateStyle: event.target.value as ClockProps["dateStyle"] }, "修改日期格式")
            }
          >
            {DATE_STYLES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="ocs-field">
        <span>时间格式</span>
        <select
          value={value.timeStyle}
          onChange={(event) =>
            commit({ ...value, timeStyle: event.target.value as ClockProps["timeStyle"] }, "修改时间格式")
          }
        >
          {TIME_STYLES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <label className="ocs-field">
        <span>标签</span>
        <input
          type="text"
          value={value.label}
          onChange={(event) => commit({ ...value, label: event.target.value }, "修改标签")}
        />
      </label>
    </div>
  );
}
