/**
 * core.markdown 测试（《运行时与 SDK 协议 v1》第 9.3 节）。
 * 覆盖：Schema 正反例（含 .md 扩展名、heading/blockId 互斥）、inline → markdown.render、
 * file → content.readText + heading 切片、空内容 emptyText、读取失败局部错误。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { CoreMarkdownRenderer, sliceMarkdown } from "../../src/widgets/core-markdown/Renderer";
import { coreMarkdownDefinition, markdownDefaultProps } from "../../src/widgets/core-markdown";
import type { MarkdownProps } from "../../src/widgets/core-markdown";
import type { ComponentRendererProps } from "../../src/registry/definition";
import type { ComponentRuntimeApi, NodeVisibilityPort } from "../../src/runtime/types";
import type { ComponentId } from "@ocs/contracts";

const mounted: { root: Root; container: HTMLDivElement }[] = [];

afterEach(() => {
  for (const { root, container } of mounted) {
    root.unmount();
    container.remove();
  }
  mounted.length = 0;
});

function visibility(): NodeVisibilityPort {
  return {
    getSnapshot: () => ({
      hostVisible: true,
      ancestorVisible: true,
      nodeEnabled: true,
      nodeStyleVisible: true,
      activeInLayout: true,
      effectiveVisible: true,
    }),
    subscribe: () => () => {},
  };
}

function baseProps(overrides: Partial<ComponentRendererProps<MarkdownProps>> = {}) {
  return {
    id: "c1" as ComponentId,
    props: markdownDefaultProps(),
    mode: "view" as const,
    sourcePath: "home.components",
    location: {
      parentId: null,
      slotName: null,
      childIndex: null,
      placement: null,
      depth: 0,
      ancestry: [],
    },
    slots: {
      has: () => false,
      getChildren: () => [],
      render: () => null,
      renderChild: () => null,
    },
    runtime: {} as unknown as ComponentRuntimeApi,
    visibility: visibility(),
    ...overrides,
  };
}

function renderMarkdown(props: ComponentRendererProps<MarkdownProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(CoreMarkdownRenderer, props));
  });
  mounted.push({ root, container });
  return { container };
}

/** 冲刷 async effect 的 promise 链。 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("core.markdown Schema", () => {
  it("默认 Props 通过", () => {
    expect(coreMarkdownDefinition.validate(markdownDefaultProps()).ok).toBe(true);
  });

  it("反例：file path 非 .md 失败", () => {
    const bad = {
      ...markdownDefaultProps(),
      source: { kind: "file", path: "notes/plain.txt" },
    } as unknown as MarkdownProps;
    const result = coreMarkdownDefinition.validate(bad);
    expect(result.ok).toBe(false);
  });

  it("反例：heading 与 blockId 同时存在失败", () => {
    const bad = {
      ...markdownDefaultProps(),
      source: { kind: "file", path: "notes/a.md", heading: "Title", blockId: "abc" },
    } as unknown as MarkdownProps;
    const result = coreMarkdownDefinition.validate(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.pointer === "/source")).toBe(true);
    }
  });

  it("反例：缺 emptyText / 非法 blockId 字符失败", () => {
    const missing = { ...markdownDefaultProps() } as unknown as Record<string, unknown>;
    delete missing.emptyText;
    expect(coreMarkdownDefinition.validate(missing).ok).toBe(false);

    const badId = {
      ...markdownDefaultProps(),
      source: { kind: "file", path: "notes/a.md", blockId: "bad id!" },
    } as unknown as MarkdownProps;
    expect(coreMarkdownDefinition.validate(badId).ok).toBe(false);
  });
});

describe("sliceMarkdown", () => {
  it("按标题切片到下一个同级或更高级标题", () => {
    // 子标题（更低级）不断开切片。
    expect(sliceMarkdown("# Title\na\n## Sub\nb", "Title")).toBe("# Title\na\n## Sub\nb");
    // 下一个同级标题断开。
    expect(sliceMarkdown("# Title\na\n# Other\nb", "Title")).toBe("# Title\na");
    expect(sliceMarkdown("pre\n## Title\nbody\n### Child\nx\n## Next", "Title")).toBe(
      "## Title\nbody\n### Child\nx",
    );
  });

  it("标题不存在返回 null", () => {
    expect(sliceMarkdown("no headings here", "Missing")).toBeNull();
  });

  it("按块 ID 切片到空行，去掉锚点后缀", () => {
    expect(sliceMarkdown("para ^abc\nmore\n\nnext", undefined, "abc")).toBe("para\nmore");
    expect(sliceMarkdown("x\n\npara ^abc\nline2\n^other", undefined, "abc")).toBe("para\nline2");
  });
});

describe("core.markdown Renderer", () => {
  it("inline：调用 markdown.render，sourcePath 使用当前路径，ready 状态", async () => {
    const renderSpy = vi.fn(
      async (_input: import("@ocs/contracts").JsonObject): Promise<
        import("@ocs/contracts").Result<void>
      > => ({ ok: true as const, value: undefined }),
    );
    const runtime = {
      content: { readText: vi.fn() },
      markdown: { render: renderSpy },
    } as unknown as ComponentRuntimeApi;
    const { container } = renderMarkdown(
      baseProps({
        props: { ...markdownDefaultProps(), source: { kind: "inline", content: "hello **world**" } },
        runtime,
      }),
    );
    await flush();

    expect(renderSpy).toHaveBeenCalledTimes(1);
    const call = renderSpy.mock.calls[0]![0]!;
    expect(call.markdown).toBe("hello **world**");
    expect(call.sourcePath).toBe("home.components");
    expect(call.container).toBeInstanceOf(HTMLElement);
    expect(container.querySelector('[data-state="ready"]')).not.toBeNull();
  });

  it("file：先 readText 再按 heading 切片，sourcePath 使用被引用文件", async () => {
    const renderSpy = vi.fn(
      async (_input: import("@ocs/contracts").JsonObject): Promise<
        import("@ocs/contracts").Result<void>
      > => ({ ok: true as const, value: undefined }),
    );
    const readText = vi.fn(async () => ({
      ok: true as const,
      value: { path: "notes/a.md", text: "# Title\ncontent here", rawHash: "h" },
    }));
    const runtime = {
      content: { readText },
      markdown: { render: renderSpy },
    } as unknown as ComponentRuntimeApi;
    const { container } = renderMarkdown(
      baseProps({
        props: {
          ...markdownDefaultProps(),
          source: { kind: "file", path: "notes/a.md", heading: "Title" },
          showSourceTitle: true,
        },
        runtime,
      }),
    );
    await flush();

    expect(readText).toHaveBeenCalledWith("notes/a.md", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(renderSpy).toHaveBeenCalledTimes(1);
    const call = renderSpy.mock.calls[0]![0]!;
    expect(call.markdown).toBe("# Title\ncontent here");
    expect(call.sourcePath).toBe("notes/a.md");
    expect(container.querySelector('[data-state="ready"]')).not.toBeNull();
    // showSourceTitle：渲染来源标题（文件名）
    expect(container.querySelector(".ocs-markdown-title")?.textContent).toBe("a.md");
  });

  it("空内容显示 emptyText", async () => {
    const renderSpy = vi.fn();
    const runtime = {
      content: { readText: vi.fn() },
      markdown: { render: renderSpy },
    } as unknown as ComponentRuntimeApi;
    const { container } = renderMarkdown(
      baseProps({
        props: { ...markdownDefaultProps(), source: { kind: "inline", content: "  " } },
        runtime,
      }),
    );
    await flush();
    expect(renderSpy).not.toHaveBeenCalled();
    expect(container.querySelector('[data-state="empty"]')?.textContent).toBe("暂无内容");
  });

  it("读取失败显示局部错误，不抛异常", async () => {
    const runtime = {
      content: {
        readText: vi.fn(async () => ({
          ok: false as const,
          error: { code: "STORAGE_READ_FAILED", message: "文件不存在", scope: "storage", recoverable: true, retryable: false },
        })),
      },
      markdown: { render: vi.fn() },
    } as unknown as ComponentRuntimeApi;
    const { container } = renderMarkdown(
      baseProps({
        props: { ...markdownDefaultProps(), source: { kind: "file", path: "notes/missing.md" } },
        runtime,
      }),
    );
    await flush();
    expect(container.querySelector('[data-state="error"]')).not.toBeNull();
    expect(container.textContent).toContain("读取失败");
  });
});
