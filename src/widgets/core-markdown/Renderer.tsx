/**
 * core.markdown Renderer（《运行时与 SDK 协议 v1》第 9.3 节 Renderer 与状态）。
 *
 * - inline 直接交 markdown.render，sourcePath 使用当前 .components 路径。
 * - file 先经 content.readText 读取，再按 heading/blockId 简单文本切片，
 *   markdown sourcePath 使用被引用文件路径。
 * - 状态：loading / ready / empty / error；空内容显示 emptyText。
 * - Render Owner 生命周期由 Runtime 按 componentId+renderGeneration 管理
 *   （第 3.5 节），Renderer 只调用 markdown.render，不创建/释放 Owner。
 */

import { useEffect, useRef, useState } from "react";
import type { ComponentRendererProps } from "../../registry/definition";
import type { MarkdownProps } from "./schema";

type MarkdownViewState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready" }
  | { readonly kind: "empty" }
  | { readonly kind: "error"; readonly message: string };

export function CoreMarkdownRenderer(props: ComponentRendererProps<MarkdownProps>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<MarkdownViewState>({ kind: "loading" });
  const [title, setTitle] = useState<string | null>(null);

  const source = props.props.source;
  const sourceKind = source.kind;
  const sourceContent = source.kind === "inline" ? source.content : source.path;
  const sourceHeading = source.kind === "file" ? source.heading ?? null : null;
  const sourceBlockId = source.kind === "file" ? source.blockId ?? null : null;
  const sourcePath = props.sourcePath;
  const showSourceTitle = props.props.showSourceTitle;
  const emptyText = props.props.emptyText;
  const runtime = props.runtime;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setState({ kind: "loading" });
    setTitle(null);

    const run = async (): Promise<void> => {
      try {
        let markdown: string;
        let renderSourcePath: string;
        let resolvedTitle: string | null = null;
        if (sourceKind === "inline") {
          markdown = sourceContent;
          renderSourcePath = sourcePath;
        } else {
          const read = await runtime.content.readText(sourceContent, { signal: controller.signal });
          if (cancelled) return;
          if (!read.ok) {
            setState({ kind: "error", message: `读取失败：${read.error.message}` });
            return;
          }
          renderSourcePath = sourceContent;
          const sliced = sliceMarkdown(read.value.text, sourceHeading ?? undefined, sourceBlockId ?? undefined);
          if (sliced === null) {
            setState({ kind: "error", message: "截取目标不存在" });
            return;
          }
          markdown = sliced;
          if (showSourceTitle) resolvedTitle = basenameOf(sourceContent);
        }
        if (cancelled) return;
        if (markdown.trim() === "") {
          setState({ kind: "empty" });
          return;
        }
        const container = containerRef.current;
        if (container === null) return;
        const result = await runtime.markdown.render({
          markdown,
          sourcePath: renderSourcePath,
          container,
          signal: controller.signal,
        });
        if (cancelled) return;
        if (!result.ok) {
          setState({ kind: "error", message: `渲染失败：${result.error.message}` });
          return;
        }
        setState({ kind: "ready" });
        setTitle(resolvedTitle);
      } catch (err) {
        if (!cancelled) {
          setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
        }
      }
    };
    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sourceKind, sourceContent, sourceHeading, sourceBlockId, sourcePath, showSourceTitle, emptyText, runtime]);

  return (
    <div className="ocs-markdown" data-state={state.kind}>
      {state.kind === "loading" && <div className="ocs-markdown-loading">加载中…</div>}
      {state.kind === "error" && (
        <div className="ocs-markdown-error" role="alert">
          {state.message}
        </div>
      )}
      {state.kind === "empty" && <div className="ocs-markdown-empty">{emptyText}</div>}
      {title !== null && <div className="ocs-markdown-title">{title}</div>}
      <div className="ocs-markdown-content" ref={containerRef} hidden={state.kind !== "ready"} />
    </div>
  );
}

function basenameOf(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

/**
 * 简单文本切片：
 * - heading：首个匹配的标题行（忽略前导 # 与大小写）开始，到下一个同级或更高级标题结束。
 * - blockId：以 `^id` 结尾的行开始，到下一个空行或下一个块锚点行结束（去掉锚点后缀）。
 * 未找到目标返回 null（调用方按“截取目标不存在”局部错误处理）。
 */
export function sliceMarkdown(
  text: string,
  heading?: string,
  blockId?: string,
): string | null {
  const lines = text.split("\n");
  if (heading !== undefined) {
    const target = heading.trim().toLowerCase();
    let start = -1;
    let level = 0;
    for (let i = 0; i < lines.length; i++) {
      const match = /^(#{1,6})\s+(.+)$/.exec(lines[i] ?? "");
      if (match && match[2]!.trim().toLowerCase() === target) {
        start = i;
        level = match[1]!.length;
        break;
      }
    }
    if (start === -1) return null;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      const match = /^(#{1,6})\s+/.exec(lines[i] ?? "");
      if (match && match[1]!.length <= level) {
        end = i;
        break;
      }
    }
    return lines.slice(start, end).join("\n");
  }
  if (blockId !== undefined) {
    const suffix = `^${blockId}`;
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line.endsWith(suffix) && line.slice(0, -suffix.length).trim() !== "") {
        start = i;
        break;
      }
    }
    if (start === -1) return null;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line.trim() === "") {
        end = i;
        break;
      }
      if (/^\^[A-Za-z0-9_-]+$/.test(line.trim())) {
        end = i;
        break;
      }
    }
    const first = (lines[start] ?? "").slice(0, -suffix.length).replace(/\s+$/, "");
    return [first, ...lines.slice(start + 1, end)].join("\n");
  }
  return text;
}
