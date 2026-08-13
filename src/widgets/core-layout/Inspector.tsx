/**
 * core.layout Inspector（《运行时与 SDK 协议 v1》第 9.1 节）。
 * mode/gap/padding/locked + 按 mode 条件显示 grid/columns/tabs 字段。
 * 简单受控输入：controller.replace({label, save:'debounced'})。
 */

import type { ComponentInspectorProps } from "../../registry/definition";
import type { CoreLayoutProps } from "./schema";

const MODES: readonly { value: CoreLayoutProps["mode"]; label: string }[] = [
  { value: "stack", label: "堆叠" },
  { value: "columns", label: "分栏" },
  { value: "grid", label: "栅格" },
  { value: "tabs", label: "标签页" },
  { value: "vertical-tabs", label: "纵向标签页" },
];

const ACTIVATIONS: readonly { value: CoreLayoutProps["tabs"]["activation"]; label: string }[] = [
  { value: "automatic", label: "自动" },
  { value: "manual", label: "手动" },
];

const PLACEMENTS: readonly { value: CoreLayoutProps["tabs"]["placement"]; label: string }[] = [
  { value: "top", label: "顶部" },
  { value: "left", label: "左侧" },
];

export function CoreLayoutInspector(props: ComponentInspectorProps<CoreLayoutProps>) {
  const { value, controller, issues } = props;

  const commit = (next: CoreLayoutProps, label: string): void => {
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
        <span>模式</span>
        <select
          value={value.mode}
          onChange={(event) => commit({ ...value, mode: event.target.value as CoreLayoutProps["mode"] }, "修改模式")}
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <label className="ocs-field">
        <span>间距</span>
        <input
          type="number"
          min={0}
          max={48}
          value={value.gap}
          onChange={(event) => {
            const n = Number(event.target.value);
            if (Number.isFinite(n)) commit({ ...value, gap: n }, "修改间距");
          }}
        />
      </label>

      <label className="ocs-field">
        <span>内边距</span>
        <input
          type="number"
          min={0}
          max={64}
          value={value.padding}
          onChange={(event) => {
            const n = Number(event.target.value);
            if (Number.isFinite(n)) commit({ ...value, padding: n }, "修改内边距");
          }}
        />
      </label>

      <label className="ocs-field">
        <span>锁定布局</span>
        <input
          type="checkbox"
          checked={value.locked}
          onChange={(event) => commit({ ...value, locked: event.target.checked }, "切换锁定")}
        />
      </label>

      {value.mode === "grid" && (
        <fieldset className="ocs-fieldset">
          <legend>栅格</legend>
          <label className="ocs-field">
            <span>列数·窄</span>
            <input
              type="number"
              min={1}
              max={4}
              value={value.grid.columns.compact}
              onChange={(event) => {
                const n = Number(event.target.value);
                if (Number.isFinite(n)) {
                  commit(
                    { ...value, grid: { ...value.grid, columns: { ...value.grid.columns, compact: n } } },
                    "修改窄屏列数",
                  );
                }
              }}
            />
          </label>
          <label className="ocs-field">
            <span>列数·常规</span>
            <input
              type="number"
              min={1}
              max={12}
              value={value.grid.columns.regular}
              onChange={(event) => {
                const n = Number(event.target.value);
                if (Number.isFinite(n)) {
                  commit(
                    { ...value, grid: { ...value.grid, columns: { ...value.grid.columns, regular: n } } },
                    "修改常规列数",
                  );
                }
              }}
            />
          </label>
          <label className="ocs-field">
            <span>列数·宽</span>
            <input
              type="number"
              min={1}
              max={24}
              value={value.grid.columns.wide}
              onChange={(event) => {
                const n = Number(event.target.value);
                if (Number.isFinite(n)) {
                  commit(
                    { ...value, grid: { ...value.grid, columns: { ...value.grid.columns, wide: n } } },
                    "修改宽屏列数",
                  );
                }
              }}
            />
          </label>
          <label className="ocs-field">
            <span>行高</span>
            <input
              type="number"
              min={24}
              max={240}
              value={value.grid.rowHeight}
              onChange={(event) => {
                const n = Number(event.target.value);
                if (Number.isFinite(n)) {
                  commit({ ...value, grid: { ...value.grid, rowHeight: n } }, "修改行高");
                }
              }}
            />
          </label>
          <label className="ocs-field">
            <span>紧凑回填</span>
            <input
              type="checkbox"
              checked={value.grid.dense}
              onChange={(event) =>
                commit({ ...value, grid: { ...value.grid, dense: event.target.checked } }, "切换紧凑回填")
              }
            />
          </label>
        </fieldset>
      )}

      {value.mode === "columns" && (
        <fieldset className="ocs-fieldset">
          <legend>分栏</legend>
          <label className="ocs-field">
            <span>自动换行</span>
            <input
              type="checkbox"
              checked={value.columns.wrap}
              onChange={(event) =>
                commit({ ...value, columns: { ...value.columns, wrap: event.target.checked } }, "切换换行")
              }
            />
          </label>
          <label className="ocs-field">
            <span>等宽</span>
            <input
              type="checkbox"
              checked={value.columns.equalWidth}
              onChange={(event) =>
                commit({ ...value, columns: { ...value.columns, equalWidth: event.target.checked } }, "切换等宽")
              }
            />
          </label>
        </fieldset>
      )}

      {(value.mode === "tabs" || value.mode === "vertical-tabs") && (
        <fieldset className="ocs-fieldset">
          <legend>标签页</legend>
          <label className="ocs-field">
            <span>激活方式</span>
            <select
              value={value.tabs.activation}
              onChange={(event) =>
                commit(
                  { ...value, tabs: { ...value.tabs, activation: event.target.value as CoreLayoutProps["tabs"]["activation"] } },
                  "修改激活方式",
                )
              }
            >
              {ACTIVATIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ocs-field">
            <span>标签位置</span>
            <select
              value={value.tabs.placement}
              onChange={(event) =>
                commit(
                  { ...value, tabs: { ...value.tabs, placement: event.target.value as CoreLayoutProps["tabs"]["placement"] } },
                  "修改标签位置",
                )
              }
            >
              {PLACEMENTS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
      )}
    </div>
  );
}
