/**
 * core.markdown Inspector（《运行时与 SDK 协议 v1》第 9.3 节）。
 * source kind；inline textarea；file path/heading/blockId 二选一；showSourceTitle；emptyText。
 */

import type { ComponentInspectorProps } from "../../registry/definition";
import type { MarkdownProps, MarkdownSource } from "./schema";

export function CoreMarkdownInspector(props: ComponentInspectorProps<MarkdownProps>) {
  const { value, controller, issues } = props;

  const commit = (next: MarkdownProps, label: string): void => {
    controller.replace(next, { label, save: "debounced" });
  };

  const setSource = (source: MarkdownSource, label: string): void => {
    commit({ ...value, source }, label);
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
        <span>来源</span>
        <select
          value={value.source.kind}
          onChange={(event) => {
            const kind = event.target.value;
            setSource(
              kind === "inline" ? { kind: "inline", content: "" } : { kind: "file", path: "" },
              "修改来源",
            );
          }}
        >
          <option value="inline">内联</option>
          <option value="file">引用文件</option>
        </select>
      </label>

      {value.source.kind === "inline" ? (
        <label className="ocs-field">
          <span>内容</span>
          <textarea
            rows={6}
            value={value.source.content}
            onChange={(event) => {
              if (value.source.kind !== "inline") return;
              setSource({ kind: "inline", content: event.target.value }, "修改内联内容");
            }}
          />
        </label>
      ) : (
        <>
          <label className="ocs-field">
            <span>文件路径</span>
            <input
              type="text"
              value={value.source.path}
              onChange={(event) => {
                if (value.source.kind !== "file") return;
                setSource({ ...value.source, path: event.target.value }, "修改文件路径");
              }}
            />
          </label>
          <label className="ocs-field">
            <span>标题（可选）</span>
            <input
              type="text"
              value={value.source.heading ?? ""}
              onChange={(event) => {
                if (value.source.kind !== "file") return;
                const heading = event.target.value === "" ? undefined : event.target.value;
                setSource({ ...value.source, heading, blockId: undefined }, "修改标题");
              }}
            />
          </label>
          <label className="ocs-field">
            <span>块 ID（可选）</span>
            <input
              type="text"
              value={value.source.blockId ?? ""}
              onChange={(event) => {
                if (value.source.kind !== "file") return;
                const blockId = event.target.value === "" ? undefined : event.target.value;
                setSource({ ...value.source, blockId, heading: undefined }, "修改块 ID");
              }}
            />
          </label>
        </>
      )}

      <label className="ocs-field">
        <span>显示来源标题</span>
        <input
          type="checkbox"
          checked={value.showSourceTitle}
          onChange={(event) => commit({ ...value, showSourceTitle: event.target.checked }, "切换来源标题")}
        />
      </label>

      <label className="ocs-field">
        <span>空内容文本</span>
        <input
          type="text"
          value={value.emptyText}
          onChange={(event) => commit({ ...value, emptyText: event.target.value }, "修改空内容文本")}
        />
      </label>
    </div>
  );
}
