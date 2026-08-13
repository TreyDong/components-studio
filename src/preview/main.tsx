/**
 * Components Studio 浏览器预览入口（开发用，不进插件 main.js）。
 * 读取 preview-data.json → 真实 Registry + Codec → RuntimeRoot 渲染。
 */
import { createRoot } from "react-dom/client";
import { ComponentRegistryImpl } from "../registry/ComponentRegistry";
import { DocumentCodec } from "../document/codec";
import { RuntimeRoot } from "../runtime/RuntimeRoot";
import { createRuntimeServices, HostStateStore } from "../runtime/index";
import { RuntimeHostStore } from "../runtime/RuntimeHostStore";
import type { PlatformPort, ThemePort, ThemeSnapshot } from "../platform/ports";
import { coreLayoutDefinition } from "../widgets/core-layout";
import { coreMarkdownDefinition } from "../widgets/core-markdown";
import { coreNavListDefinition } from "../widgets/core-nav-list";
import { timeClockDefinition } from "../widgets/time-clock";
import { timeCalendarDefinition } from "../widgets/time-calendar";
import previewData from "./preview-data.json";
import type { ComponentsDocumentV1 } from "@ocs/contracts";

/** 极简 markdown → HTML（预览用；Obsidian 用 MarkdownRenderer）。 */
function renderMarkdown(markdown: string, container: HTMLElement): void {
  const lines = markdown.split("\n");
  let html = "";
  let inTable = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("|") && line.endsWith("|") && !inTable && !line.includes("---")) {
      inTable = true;
      html += "<table>";
    }
    if (line.includes("---") && inTable) continue;
    const escape = (s: string): string =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let cell = escape(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    if (inTable && line.startsWith("|")) {
      const cells = cell
        .split("|")
        .slice(1, -1)
        .map((c) => `<td>${c}</td>`)
        .join("");
      html += `<tr>${cells}</tr>`;
    } else if (inTable) {
      inTable = false;
      html += "</table>";
    } else if (line.startsWith("### ")) {
      html += `<h3>${cell.slice(4)}</h3>`;
    } else if (line.startsWith("## ")) {
      html += `<h2>${cell.slice(3)}</h2>`;
    } else if (line.startsWith("# ")) {
      html += `<h1>${cell.slice(2)}</h1>`;
    } else if (/^- \[ \] /.test(line)) {
      html += `<label class="ocs-md-task"><input type="checkbox" disabled /> ${cell.slice(6)}</label>`;
    } else if (/^- \[x\] /.test(line)) {
      html += `<label class="ocs-md-task"><input type="checkbox" checked disabled /> ${cell.slice(6)}</label>`;
    } else if (line.startsWith("- ")) {
      html += `<li>${cell.slice(2)}</li>`;
    } else if (/^\d+\. /.test(line)) {
      html += `<li>${cell.replace(/^\d+\. /, "")}</li>`;
    } else if (line.startsWith("**") && line.endsWith("**")) {
      html += `<h3>${cell.slice(2, -2)}</h3>`;
    } else if (line.startsWith("*") && line.endsWith("*")) {
      html += `<p class="ocs-md-note">${cell.slice(1, -1)}</p>`;
    } else if (line.trim() === "") {
      html += "";
    } else {
      html += `<p>${cell}</p>`;
    }
  }
  if (inTable) html += "</table>";
  container.innerHTML = `<div class="ocs-md-body">${html}</div>`;
}

function makePlatform(): PlatformPort {
  const theme: ThemePort = {
    getSnapshot: (): ThemeSnapshot => {
      const style = getComputedStyle(document.documentElement);
      const tokens: Record<string, string> = {
        background: style.getPropertyValue("--ocs-background") || "#ffffff",
        surface: style.getPropertyValue("--ocs-surface") || "#f5f5f5",
        "surface-hover": style.getPropertyValue("--ocs-surface-hover") || "#ececec",
        text: style.getPropertyValue("--ocs-text") || "#1e1e1e",
        "text-muted": style.getPropertyValue("--ocs-text-muted") || "#6e6e6e",
        border: style.getPropertyValue("--ocs-border") || "#d0d0d0",
        accent: style.getPropertyValue("--ocs-accent") || "#4d96ff",
        danger: style.getPropertyValue("--ocs-danger") || "#e5484d",
        success: style.getPropertyValue("--ocs-success") || "#30a46c",
        warning: style.getPropertyValue("--ocs-warning") || "#ffb224",
      };
      return {
        mode: "light",
        accentColor: tokens.accent,
        fontScale: 1,
        reducedMotion: false,
        highContrast: false,
        tokens,
      };
    },
    subscribe: () => () => {},
  };

  return {
    kind: "obsidian",
    componentsStorage: {
      paths: {
        normalize: (p: string) => ({ ok: true as const, value: p }),
        resolve: (p: string) => ({ ok: true as const, value: p }),
        isInsideVault: () => true,
      },
      readText: async () => ({ ok: false as const, error: { code: "STORAGE_READ_FAILED", message: "预览只读", scope: "storage", recoverable: false, retryable: false } }),
      compareAndSwapText: async () => ({ ok: false as const, error: { code: "SAVE_READ_ONLY", message: "预览只读", scope: "storage", recoverable: false, retryable: false } }),
      writeNewText: async () => ({ ok: false as const, error: { code: "SAVE_READ_ONLY", message: "预览只读", scope: "storage", recoverable: false, retryable: false } }),
      subscribe: () => () => {},
    },
    vaultRead: {
      paths: {
        normalize: (p: string) => ({ ok: true as const, value: p }),
        resolve: (p: string) => ({ ok: true as const, value: p }),
        isInsideVault: () => true,
      },
      stat: async () => ({ ok: false as const, error: { code: "STORAGE_READ_FAILED", message: "预览只读", scope: "storage", recoverable: false, retryable: false } }),
      readText: async () => ({ ok: false as const, error: { code: "STORAGE_READ_FAILED", message: "预览只读", scope: "storage", recoverable: false, retryable: false } }),
      list: async () => ({ ok: true as const, value: [] }),
      subscribe: () => () => {},
    },
    vaultMutation: {
      createText: async () => ({ ok: false as const, error: { code: "ACTION_EXECUTION_FAILED", message: "预览只读", scope: "action", recoverable: false, retryable: false } }),
      updateFrontmatter: async () => ({ ok: false as const, error: { code: "ACTION_EXECUTION_FAILED", message: "预览只读", scope: "action", recoverable: false, retryable: false } }),
      updateMarkdownTask: async () => ({ ok: false as const, error: { code: "ACTION_EXECUTION_FAILED", message: "预览只读", scope: "action", recoverable: false, retryable: false } }),
    },
    workspace: {
      getActiveFile: () => null,
      openFile: async () => ({ ok: true as const, value: undefined }),
      revealFile: async () => ({ ok: true as const, value: undefined }),
      openComponentsDocument: async () => ({ ok: true as const, value: undefined }),
    },
    markdown: {
      render: async (input: { markdown: string; container: HTMLElement }) => {
        renderMarkdown(input.markdown, input.container);
        return { ok: true as const, value: undefined };
      },
    },
    commands: {
      list: () => [],
      execute: async () => ({ ok: false as const, error: { code: "ACTION_EXECUTION_FAILED", message: "预览无命令", scope: "action", recoverable: false, retryable: false } }),
      isAllowlisted: () => false,
    },
    notices: {
      show: (message: string) => console.log("[notice]", message),
    },
    theme,
    clipboard: { writeText: async () => ({ ok: true as const, value: undefined }) },
    clock: {
      now: () => Date.now(),
      timeout: (cb: () => void, ms: number) => {
        const t = setTimeout(cb, ms);
        return { dispose: () => clearTimeout(t) };
      },
      interval: (cb: () => void, ms: number) => {
        const t = setInterval(cb, ms);
        return { dispose: () => clearInterval(t) };
      },
      aligned: (cb: () => void) => {
        const t = setInterval(cb, 1000);
        return { dispose: () => clearInterval(t) };
      },
    },
    externalUrls: { open: async () => ({ ok: true as const, value: undefined }) },
    confirmations: { confirm: async () => true },
    getPlatformInfo: () => ({
      kind: "obsidian",
      appVersion: "preview",
      pluginVersion: "0.1.0",
      locale: navigator.language,
      vaultId: "preview-vault" as never,
      isDesktop: true,
      isMobile: false,
    }),
  } as unknown as PlatformPort;
}

async function main(): Promise<void> {
  const registry = new ComponentRegistryImpl();
  for (const d of [
    coreLayoutDefinition,
    coreMarkdownDefinition,
    coreNavListDefinition,
    timeClockDefinition,
    timeCalendarDefinition,
  ]) {
    const r = registry.register(d as never);
    if (!r.ok) {
      document.body.textContent = `注册失败: ${JSON.stringify(r.error)}`;
      return;
    }
  }
  const codec = new DocumentCodec(registry.codecView());
  const parsed = codec.parseUtf8(new TextEncoder().encode(JSON.stringify(previewData)));
  if (!parsed.ok) {
    document.body.textContent = `解析失败: ${parsed.error.code} ${parsed.error.message}`;
    return;
  }
  const doc = parsed.value.document as unknown as ComponentsDocumentV1;

  const hostEl = document.getElementById("app")!;
  const platform = makePlatform();
  const host = new RuntimeHostStore({
    hostId: "preview",
    sourcePath: "项目首页.components",
    element: hostEl,
    theme: platform.theme,
  });
  // useSyncExternalStore 要求快照引用稳定：按 doc 引用缓存一次。
  let cached: ReturnType<typeof buildSnapshot> | null = null;
  const buildSnapshot = () => ({
    documentId: doc.documentId,
    sourcePath: "项目首页.components",
    sessionVersion: 1,
    revision: doc.revision,
    rootId: doc.rootId,
    nodes: new Map(Object.entries(doc.nodes) as [string, unknown][]),
    dataSources: new Map(),
    permissions: doc.permissions,
    metadata: doc.metadata,
  });
  const services = createRuntimeServices({
    platform,
    registry,
    document: {
      getSnapshot: () => {
        if (!cached) cached = buildSnapshot();
        return cached;
      },
      subscribe: () => () => {},
      getStatus: () => ({ kind: "ready" as const, dirty: false }),
    } as never,
    host,
    hostState: new HostStateStore(),
  });

  createRoot(hostEl).render(<RuntimeRoot services={services} initialMode="view" />);
  (window as unknown as { __ready?: boolean }).__ready = true;
}

void main();
