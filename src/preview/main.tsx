/**
 * 浏览器预览入口：与插件相同的 Registry → RuntimeRoot 渲染链路。
 * 预览文档的根节点是 `project.dashboard`，不是独立页面挂载。
 */
import { createRoot } from "react-dom/client";
import { ComponentRegistryImpl } from "../registry/ComponentRegistry";
import { DocumentCodec } from "../document/codec";
import { RuntimeRoot } from "../runtime/RuntimeRoot";
import { createRuntimeServices, HostStateStore } from "../runtime";
import { RuntimeHostStore } from "../runtime/RuntimeHostStore";
import { projectDashboardDefinition } from "../widgets/project-dashboard";
import { coreLayoutDefinition } from "../widgets/core-layout";
import type { PlatformPort, ThemePort, ThemeSnapshot } from "../platform/ports";

const previewTaskFiles = [
  ["Tasks/250811 主题系统.md", "---\ntags: [task, feature]\ntitle: 250811 主题系统\nstatus: todo\nprojects: [\"[[components]]\"]\ndue: 2026-08-20\n---\n"],
  ["Tasks/250927 优化按钮组件.md", "---\ntags: [task, improvement]\ntitle: 250927 优化按钮组件执行动作代码\nstatus: doing\nprojects: [\"[[components]]\"]\n---\n"],
  ["Tasks/250331 数据视图链接.md", "---\ntags: [task, feature]\ntitle: 250331 数据视图支持拖拽生成链接\nstatus: done\nprojects: [\"[[components]]\"]\n---\n"],
  ["Tasks/240722 只读模式.md", "---\ntags: [task, bug]\ntitle: 240722 数据视图支持配置为只读模式\nstatus: cancelled\nprojects: [\"[[components]]\"]\n---\n"],
] as const;

function previewPlatform(): PlatformPort {
  const taskText = new Map<string, string>(previewTaskFiles);
  const theme: ThemePort = {
    getSnapshot: (): ThemeSnapshot => ({
      mode: "light",
      accentColor: "#4d96ff",
      fontScale: 1,
      reducedMotion: false,
      highContrast: false,
      tokens: {
        background: "#f7f8fa", surface: "#ffffff", "surface-hover": "#eef0f3",
        text: "#3f414a", "text-muted": "#6b7280", border: "#e8eaee",
        accent: "#4d96ff", danger: "#e5484d", success: "#30a46c", warning: "#ffb224",
      } as ThemeSnapshot["tokens"],
    }),
    subscribe: () => () => {},
  };
  return {
    kind: "obsidian",
    theme,
    workspace: { getActiveFile: () => null, openFile: async () => ({ ok: true, value: undefined }), revealFile: async () => ({ ok: true, value: undefined }), openComponentsDocument: async () => ({ ok: true, value: undefined }) },
    markdown: { render: async () => ({ ok: true, value: undefined }) },
    commands: { list: () => [], execute: async () => ({ ok: true, value: undefined }), isAllowlisted: () => false },
    notices: { show: () => {} },
    clipboard: { writeText: async () => ({ ok: true, value: undefined }) },
    clock: { now: () => Date.now(), timeout: (cb: () => void, ms: number) => { const id = window.setTimeout(cb, ms); return { dispose: () => clearTimeout(id) }; }, interval: (cb: () => void, ms: number) => { const id = window.setInterval(cb, ms); return { dispose: () => clearInterval(id) }; }, aligned: (cb: () => void) => { const id = window.setInterval(cb, 1000); return { dispose: () => clearInterval(id) }; } },
    externalUrls: { open: async () => ({ ok: true, value: undefined }) },
    confirmations: { confirm: async () => true },
    vaultRead: {
      paths: {} as never,
      stat: async () => ({ ok: false, error: { code: "EXTERNAL_FILE_DELETED", message: "not implemented", scope: "platform", recoverable: false, retryable: false } }),
      readText: async (path: string) => {
        const text = taskText.get(path);
        return text === undefined ? { ok: false, error: { code: "EXTERNAL_FILE_DELETED", message: `文件不存在：${path}`, scope: "platform", recoverable: false, retryable: false } } : { ok: true, value: { path, text, rawHash: path, mtimeMs: Date.now(), sizeBytes: text.length } };
      },
      list: async (options?: { extension?: string; underPath?: string }) => ({ ok: true, value: previewTaskFiles.filter(([path]) => !options?.underPath || path.startsWith(`${options.underPath}/`)).map(([path]) => ({ path, extension: "md", basename: path.slice(path.lastIndexOf("/") + 1), parentPath: path.slice(0, path.lastIndexOf("/")), ctimeMs: Date.now() - 86400000, mtimeMs: Date.now(), sizeBytes: taskText.get(path)?.length ?? 0 })) }),
      subscribe: () => () => {},
    },
    vaultMutation: {
      updateFrontmatter: async ({ path, expectedFileText, patch }: { path: string; expectedFileText: string; patch: Record<string, { op: "set"; value: unknown }> }) => {
        if (taskText.get(path) !== expectedFileText) return { ok: false, error: { code: "ACTION_FRONTMATTER_CONFLICT", message: "文件已变化", scope: "platform", recoverable: true, retryable: false } };
        const next = expectedFileText.replace(/^status:.*$/m, `status: ${String(patch.status?.value)}`);
        taskText.set(path, next);
        return { ok: true, value: { path, text: next, rawHash: path, mtimeMs: Date.now(), sizeBytes: next.length } };
      },
    },
    getPlatformInfo: () => ({ kind: "obsidian", appVersion: "preview", pluginVersion: "0.1.0", locale: navigator.language, vaultId: "preview-vault" as never, isDesktop: true, isMobile: false }),
  } as unknown as PlatformPort;
}

async function main(): Promise<void> {
  const registry = new ComponentRegistryImpl();
  for (const definition of [coreLayoutDefinition, projectDashboardDefinition]) {
    const registration = registry.register(definition as never);
    if (!registration.ok) throw new Error(registration.error.message);
  }
  const response = await fetch("./project-dashboard.components");
  if (!response.ok) throw new Error("无法读取 project-dashboard.components");
  const rawDocument = await response.text();
  const parsed = new DocumentCodec(registry.codecView()).parseUtf8(new TextEncoder().encode(rawDocument));
  if (!parsed.ok) throw new Error(`${parsed.error.code}: ${parsed.error.message}`);
  const dashboardDocument = parsed.value.document as unknown as { documentId: string; revision: number; rootId: string; nodes: Record<string, unknown>; metadata: unknown; permissions: unknown };
  const hostElement = document.getElementById("app");
  if (!hostElement) throw new Error("预览容器 #app 不存在");
  const platform = previewPlatform();
  const host = new RuntimeHostStore({ hostId: "preview", sourcePath: "Dashboard/项目首页.components", element: hostElement, theme: platform.theme });
  const snapshot = {
    documentId: dashboardDocument.documentId as never, sourcePath: "Dashboard/项目首页.components", sessionVersion: 1,
    revision: dashboardDocument.revision, rootId: dashboardDocument.rootId as never,
    nodes: new Map(Object.entries(dashboardDocument.nodes) as [string, unknown][]), dataSources: new Map(),
    permissions: dashboardDocument.permissions, metadata: dashboardDocument.metadata,
  };
  const services = createRuntimeServices({
    platform, registry,
    document: { getSnapshot: () => snapshot, subscribe: () => () => {}, getStatus: () => ({ kind: "ready", dirty: false }) } as never,
    host, hostState: new HostStateStore(),
  });
  createRoot(hostElement).render(<RuntimeRoot services={services} initialMode="view" />);
  (window as unknown as { __ready?: boolean }).__ready = true;
}

void main();
