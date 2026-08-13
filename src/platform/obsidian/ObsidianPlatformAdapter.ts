/**
 * ObsidianPlatformAdapter —— PlatformPort 的 Obsidian 实现
 * （《运行时与 SDK 协议 v1》第 4 章 + 《技术规格 v1》第 11 章）。
 *
 * Adapter 是接触 Obsidian 对象的唯一边界：Runtime 与组件目录不得 import
 * obsidian。本文件内的各子 Port 都以最小结构接口（obsidian-api.ts）依赖
 * Vault/Workspace/Commands，因此 vaultMutation / clock / theme 等可独立
 * 用纯对象 mock 测试。
 *
 * vaultId 来自 Adapter 配置（宿主派生），不是文档内容（技术规格 11.1）。
 */

import {
  Component,
  MarkdownRenderer,
  Modal,
  Notice,
  TFile,
  type App,
} from "obsidian";
import type {
  Disposable,
  OpenDisposition,
  ProtocolError,
  Result,
  StorageEventV1,
  VaultId,
} from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";
import type {
  ClipboardPort,
  ClockPort,
  CommandDescriptor,
  CommandPort,
  ComponentsStoragePort,
  ConfirmationPort,
  ConfirmationRequest,
  ExternalUrlPort,
  MarkdownPort,
  MarkdownRenderOwner,
  MarkdownRenderRequest,
  NoticePort,
  PathRules,
  PlatformInfo,
  PlatformPort,
  TextFileSnapshot,
  ThemeColorToken,
  ThemePort,
  ThemeSnapshot,
  VaultFileInfo,
  VaultMutationPort,
  VaultReadPort,
  WorkspacePort,
} from "../ports";
import { ObsidianVaultMutationPort } from "./ObsidianVaultMutationPort";
import { ObsidianPathRules, parentDir } from "./ObsidianPathRules";
import { ObsidianStorageAdapter } from "./ObsidianStorageAdapter";
import {
  ok,
  sha256HexSync,
  type CommandsRegistryLike,
  type ObsidianVaultLike,
  type TFileLike,
} from "./obsidian-api";

const PLATFORM_SCOPE = "platform" as const;

function err(
  code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
  message: string,
  options?: {
    readonly path?: string;
    readonly retryable?: boolean;
    readonly cause?: unknown;
  },
): { ok: false; error: ProtocolError } {
  return {
    ok: false,
    error: {
      code,
      message,
      scope: PLATFORM_SCOPE,
      recoverable: true,
      retryable: options?.retryable ?? true,
      path: options?.path,
      details: {},
      cause: options?.cause,
    },
  };
}

// ---------------------------------------------------------------------------
// Theme Port
// ---------------------------------------------------------------------------

const THEME_CSS_VARS: Readonly<Record<ThemeColorToken, string>> = {
  background: "--background-primary",
  surface: "--background-secondary",
  "surface-hover": "--background-modifier-hover",
  text: "--text-normal",
  "text-muted": "--text-muted",
  border: "--background-modifier-border",
  accent: "--interactive-accent",
  danger: "--text-error",
  success: "--text-success",
  warning: "--text-warning",
};

const DARK_FALLBACK: Readonly<Record<ThemeColorToken, string>> = {
  background: "#202020",
  surface: "#1e1e1e",
  "surface-hover": "#2a2a2a",
  text: "#dbdbdb",
  "text-muted": "#a0a0a0",
  border: "#3a3a3a",
  accent: "#7c6fde",
  danger: "#fb464c",
  success: "#7ec699",
  warning: "#e0ac00",
};

const LIGHT_FALLBACK: Readonly<Record<ThemeColorToken, string>> = {
  background: "#ffffff",
  surface: "#f5f5f5",
  "surface-hover": "#e8e8e8",
  text: "#1a1a1a",
  "text-muted": "#6b6b6b",
  border: "#d0d0d0",
  accent: "#705dcf",
  danger: "#c7254e",
  success: "#1f7a3d",
  warning: "#9c6500",
};

export interface ObsidianThemePortOptions {
  readonly isDarkMode: () => boolean;
  readonly getDocument: () => Document | null;
  readonly subscribeCssChange?: (listener: () => void) => () => void;
}

export class ObsidianThemePort implements ThemePort {
  private readonly isDarkMode: () => boolean;
  private readonly getDocument: () => Document | null;
  private readonly subscribeCssChange: ((listener: () => void) => () => void) | null;

  constructor(options: ObsidianThemePortOptions) {
    this.isDarkMode = options.isDarkMode;
    this.getDocument = options.getDocument;
    this.subscribeCssChange = options.subscribeCssChange ?? null;
  }

  getSnapshot(): ThemeSnapshot {
    const dark = this.isDarkMode();
    const fallback = dark ? DARK_FALLBACK : LIGHT_FALLBACK;
    const doc = this.getDocument();
    const win = doc?.defaultView ?? null;
    const cs = doc?.body ? win?.getComputedStyle(doc.body) : null;
    const read = (cssVar: string): string | null => {
      if (!cs) {
        return null;
      }
      const value = cs.getPropertyValue(cssVar).trim();
      return value.length > 0 ? value : null;
    };
    const tokens = {} as Record<ThemeColorToken, string>;
    for (const token of Object.keys(THEME_CSS_VARS) as ThemeColorToken[]) {
      tokens[token] = read(THEME_CSS_VARS[token]) ?? fallback[token];
    }
    let fontScale = 1;
    if (cs) {
      const size = parseFloat(cs.getPropertyValue("--font-text-size"));
      if (Number.isFinite(size) && size > 0) {
        fontScale = size / 16;
      }
    }
    return {
      mode: dark ? "dark" : "light",
      accentColor: read(THEME_CSS_VARS.accent) ?? null,
      fontScale,
      reducedMotion: win?.matchMedia("(prefers-reduced-motion: reduce)").matches ?? false,
      highContrast: win?.matchMedia("(prefers-contrast: more)").matches ?? false,
      tokens,
    };
  }

  subscribe(listener: () => void): () => void {
    const doc = this.getDocument();
    const cleanups: Array<() => void> = [];
    if (doc?.body && typeof MutationObserver !== "undefined") {
      const observer = new MutationObserver(() => listener());
      observer.observe(doc.body, { attributes: true, attributeFilter: ["class"] });
      cleanups.push(() => observer.disconnect());
    }
    if (this.subscribeCssChange) {
      cleanups.push(this.subscribeCssChange(listener));
    }
    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }
}

// ---------------------------------------------------------------------------
// Clock Port（性能计时 + setTimeout 包装 + 共享对齐调度器）
// ---------------------------------------------------------------------------

class AlignedScheduler {
  private readonly byUnit = new Map<string, Set<() => void>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  subscribe(callback: () => void, unit: "second" | "minute"): () => void {
    let set = this.byUnit.get(unit);
    if (!set) {
      set = new Set();
      this.byUnit.set(unit, set);
      this.start(unit);
    }
    set.add(callback);
    return () => {
      set.delete(callback);
      if (set.size === 0) {
        const timer = this.timers.get(unit);
        if (timer !== undefined) {
          clearTimeout(timer);
          this.timers.delete(unit);
        }
        this.byUnit.delete(unit);
      }
    };
  }

  private start(unit: "second" | "minute"): void {
    const unitMs = unit === "second" ? 1000 : 60_000;
    const loop = (): void => {
      const delay = unitMs - (Date.now() % unitMs) + 1;
      const timer = setTimeout(() => {
        const set = this.byUnit.get(unit);
        if (set) {
          for (const callback of [...set]) {
            try {
              callback();
            } catch {
              // 回调异常不得破坏调度器。
            }
          }
        }
        loop();
      }, delay);
      this.timers.set(unit, timer);
    };
    loop();
  }
}

export class ObsidianClockPort implements ClockPort {
  private readonly scheduler = new AlignedScheduler();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly intervals = new Set<ReturnType<typeof setInterval>>();

  now(): number {
    return Date.now();
  }

  timeout(callback: () => void, delayMs: number): Disposable {
    const handle = setTimeout(() => {
      this.timers.delete(handle);
      callback();
    }, delayMs);
    this.timers.add(handle);
    return {
      dispose: () => {
        clearTimeout(handle);
        this.timers.delete(handle);
      },
    };
  }

  interval(callback: () => void, intervalMs: number): Disposable {
    const handle = setInterval(callback, intervalMs);
    this.intervals.add(handle);
    return {
      dispose: () => {
        clearInterval(handle);
        this.intervals.delete(handle);
      },
    };
  }

  aligned(callback: () => void, unit: "second" | "minute"): Disposable {
    return { dispose: this.scheduler.subscribe(callback, unit) };
  }
}

// ---------------------------------------------------------------------------
// Notice / Clipboard / ExternalUrl / Confirmation
// ---------------------------------------------------------------------------

export class ObsidianNoticePort implements NoticePort {
  show(
    message: string,
    options?: {
      readonly level?: "info" | "success" | "warning" | "error";
      readonly timeoutMs?: number;
    },
  ): void {
    const notice = new Notice(message, options?.timeoutMs ?? 4000);
    const level = options?.level ?? "info";
    if (level === "warning") {
      notice.noticeEl.addClass("mod-warning");
    } else if (level === "error") {
      notice.noticeEl.addClass("mod-error");
    }
  }
}

export interface ObsidianClipboardPortOptions {
  readonly getDocument: () => Document | null;
}

export class ObsidianClipboardPort implements ClipboardPort {
  private readonly getDocument: () => Document | null;

  constructor(options: ObsidianClipboardPortOptions) {
    this.getDocument = options.getDocument;
  }

  async writeText(text: string): Promise<Result<void>> {
    const navigator = this.getDocument()?.defaultView?.navigator ?? null;
    if (!navigator?.clipboard) {
      return err(ERROR_CODES.STORAGE_WRITE_FAILED, "剪贴板不可用");
    }
    try {
      await navigator.clipboard.writeText(text);
      return ok(undefined);
    } catch (cause) {
      return err(ERROR_CODES.STORAGE_WRITE_FAILED, "写入剪贴板失败", { cause });
    }
  }
}

export interface ObsidianExternalUrlPortOptions {
  readonly getDocument: () => Document | null;
}

export class ObsidianExternalUrlPort implements ExternalUrlPort {
  private readonly getDocument: () => Document | null;

  constructor(options: ObsidianExternalUrlPortOptions) {
    this.getDocument = options.getDocument;
  }

  async open(url: string): Promise<Result<void>> {
    if (!/^https?:\/\//i.test(url)) {
      return err(ERROR_CODES.ACTION_URL_SCHEME_DENIED, `拒绝打开非 http(s) 链接`);
    }
    const doc = this.getDocument();
    if (!doc) {
      return err(ERROR_CODES.STORAGE_WRITE_FAILED, "无法打开链接：缺少宿主文档");
    }
    const anchor = doc.createElement("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.style.display = "none";
    doc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return ok(undefined);
  }
}

class ConfirmModal extends Modal {
  private resolved = false;
  private readonly request: ConfirmationRequest;
  private readonly resolve: (value: boolean) => void;

  constructor(app: App, request: ConfirmationRequest, resolve: (value: boolean) => void) {
    super(app);
    this.request = request;
    this.resolve = resolve;
  }

  override onOpen(): void {
    this.setTitle(this.request.title);
    this.contentEl.createEl("p", { text: this.request.message });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = buttons.createEl("button", { text: this.request.cancelLabel, cls: "mod-ghost" });
    cancel.addEventListener("click", () => this.settle(false));
    const confirm = buttons.createEl("button", {
      text: this.request.confirmLabel,
      cls: this.request.danger ? "mod-warning" : "mod-cta",
    });
    confirm.addEventListener("click", () => this.settle(true));
  }

  override onClose(): void {
    this.settle(false);
  }

  private settle(value: boolean): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolve(value);
    this.close();
  }
}

export class ObsidianConfirmationPort implements ConfirmationPort {
  private readonly app: App;

  constructor(app: App) {
    this.app = app;
  }

  confirm(request: ConfirmationRequest): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const modal = new ConfirmModal(this.app, request, resolve);
      modal.open();
    });
  }
}

// ---------------------------------------------------------------------------
// Markdown Port
// ---------------------------------------------------------------------------

/**
 * MarkdownRenderer.render 需要 Component 宿主来登记它创建的 children；
 * 本类把 Obsidian 的 addChild/register 转发给 MarkdownRenderOwner。
 */
class MarkdownOwnerCarrier extends Component {
  private readonly owner: MarkdownRenderOwner;

  constructor(owner: MarkdownRenderOwner) {
    super();
    this.owner = owner;
  }

  override addChild<T extends Component>(child: T): T {
    this.owner.register({ dispose: () => child.unload() });
    return child;
  }

  override register(cb: () => void): void {
    this.owner.register({ dispose: cb });
  }
}

export interface ObsidianMarkdownPortOptions {
  readonly app: App;
}

export class ObsidianMarkdownPort implements MarkdownPort {
  private readonly app: App;

  constructor(options: ObsidianMarkdownPortOptions) {
    this.app = options.app;
  }

  async render(request: MarkdownRenderRequest): Promise<Result<void>> {
    if (request.signal?.aborted) {
      return ok(undefined);
    }
    const carrier = new MarkdownOwnerCarrier(request.owner);
    const abort = (): void => {
      request.owner.dispose();
    };
    if (request.signal) {
      if (request.signal.aborted) {
        return ok(undefined);
      }
      request.signal.addEventListener("abort", abort, { once: true });
    }
    try {
      request.container.empty();
      await MarkdownRenderer.render(
        this.app,
        request.markdown,
        request.container,
        request.sourcePath,
        carrier,
      );
      return ok(undefined);
    } catch (cause) {
      request.owner.dispose();
      return err(ERROR_CODES.STORAGE_READ_FAILED, "Markdown 渲染失败", { cause });
    } finally {
      request.signal?.removeEventListener("abort", abort);
    }
  }
}

// ---------------------------------------------------------------------------
// Workspace Port
// ---------------------------------------------------------------------------

export interface ObsidianWorkspacePortOptions {
  readonly app: App;
  readonly paths: PathRules;
}

export class ObsidianWorkspacePort implements WorkspacePort {
  private readonly app: App;
  private readonly paths: PathRules;

  constructor(options: ObsidianWorkspacePortOptions) {
    this.app = options.app;
    this.paths = options.paths;
  }

  getActiveFile(): { readonly path: string } | null {
    const file = this.app.workspace.getActiveFile();
    return file ? { path: file.path } : null;
  }

  async openFile(
    path: string,
    options?: {
      readonly disposition?: OpenDisposition;
      readonly line?: number;
      readonly column?: number;
      readonly active?: boolean;
    },
  ): Promise<Result<void>> {
    const file = this.resolveFile(path);
    if (!file.ok) {
      return file;
    }
    const leaf = this.leafFor(options?.disposition);
    try {
      await leaf.openFile(file.value, { active: options?.active ?? true });
      return ok(undefined);
    } catch (cause) {
      return err(ERROR_CODES.STORAGE_READ_FAILED, `打开文件失败：${path}`, {
        path,
        cause,
      });
    }
  }

  async revealFile(path: string): Promise<Result<void>> {
    const existing = this.findOpenLeaf(path);
    if (existing) {
      try {
        await this.app.workspace.revealLeaf(existing);
        return ok(undefined);
      } catch (cause) {
        return err(ERROR_CODES.STORAGE_READ_FAILED, `定位文件失败：${path}`, {
          path,
          cause,
        });
      }
    }
    return this.openFile(path, { disposition: "new-tab", active: true });
  }

  async openComponentsDocument(
    path: string,
    options?: {
      readonly disposition?: OpenDisposition;
      readonly editMode?: boolean;
    },
  ): Promise<Result<void>> {
    const file = this.resolveFile(path);
    if (!file.ok) {
      return file;
    }
    const leaf = this.leafFor(options?.disposition);
    try {
      await leaf.openFile(file.value, {
        active: true,
        state: { mode: options?.editMode ? "edit" : "view" },
      });
      return ok(undefined);
    } catch (cause) {
      return err(ERROR_CODES.STORAGE_READ_FAILED, `打开组件文档失败：${path}`, {
        path,
        cause,
      });
    }
  }

  private resolveFile(path: string): Result<TFile> {
    const normalized = this.paths.normalize(path);
    if (!normalized.ok) {
      return normalized;
    }
    const file = this.app.vault.getAbstractFileByPath(normalized.value);
    if (file instanceof TFile) {
      return ok(file);
    }
    return err(ERROR_CODES.EXTERNAL_FILE_DELETED, `文件不存在：${normalized.value}`, {
      path: normalized.value,
    });
  }

  private leafFor(disposition?: OpenDisposition) {
    switch (disposition) {
      case "split":
        return this.app.workspace.getLeaf("split");
      case "new-tab":
        return this.app.workspace.getLeaf(true);
      default:
        return this.app.workspace.getLeaf(false);
    }
  }

  private findOpenLeaf(path: string) {
    const normalized = this.paths.normalize(path);
    const target = normalized.ok ? normalized.value : path;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const state = leaf.getViewState();
      if (state.state && typeof state.state === "object" && "file" in state.state) {
        const file = state.state.file;
        if (typeof file === "string" && file === target) {
          return leaf;
        }
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Command Port
// ---------------------------------------------------------------------------

export interface ObsidianCommandPortOptions {
  readonly app: App;
  readonly pluginId: string;
  readonly isAllowlisted?: (commandId: string) => boolean;
}

export class ObsidianCommandPort implements CommandPort {
  private readonly app: App;
  private readonly pluginId: string;
  private readonly allowlist: (commandId: string) => boolean;

  constructor(options: ObsidianCommandPortOptions) {
    this.app = options.app;
    this.pluginId = options.pluginId;
    this.allowlist =
      options.isAllowlisted ?? ((id) => id.startsWith(`${this.pluginId}:`));
  }

  /**
   * obsidian 1.13 的 d.ts 未声明 App.commands，但运行时存在 CommandRegistry
   * （listCommands/executeCommandById 为多年稳定公开方法）。此处用最小
   * 结构接口做边界读取，不做 any。
   */
  private commandsRegistry(): CommandsRegistryLike | null {
    const appWithCommands = this.app as unknown as {
      commands?: CommandsRegistryLike;
    };
    return appWithCommands.commands ?? null;
  }

  list(): readonly CommandDescriptor[] {
    const registry = this.commandsRegistry();
    if (!registry) {
      return [];
    }
    return registry.listCommands().map((command) => ({
      id: command.id,
      name: command.name,
      pluginId: command.pluginId,
    }));
  }

  async execute(commandId: string): Promise<Result<void>> {
    const registry = this.commandsRegistry();
    if (!registry) {
      return err(ERROR_CODES.ACTION_COMMAND_DENIED, "命令注册表不可用");
    }
    try {
      await registry.executeCommandById(commandId);
      return ok(undefined);
    } catch (cause) {
      return err(ERROR_CODES.ACTION_COMMAND_DENIED, `执行命令失败：${commandId}`, {
        cause,
      });
    }
  }

  isAllowlisted(commandId: string): boolean {
    return this.allowlist(commandId);
  }
}

// ---------------------------------------------------------------------------
// VaultRead Port
// ---------------------------------------------------------------------------

export interface ObsidianVaultReadPortOptions {
  readonly vault: ObsidianVaultLike;
  readonly paths: PathRules;
}

function fileInfoOf(file: TFileLike): VaultFileInfo {
  const stat = file.stat ?? { ctime: 0, mtime: 0, size: 0 };
  const extension = file.path.includes(".")
    ? file.path.slice(file.path.lastIndexOf(".") + 1)
    : "";
  const segments = file.path.split("/");
  return {
    path: file.path,
    extension,
    basename: file.name ?? segments[segments.length - 1] ?? file.path,
    parentPath: parentDir(file.path),
    ctimeMs: stat.ctime,
    mtimeMs: stat.mtime,
    sizeBytes: stat.size,
  };
}

export class ObsidianVaultReadPort implements VaultReadPort {
  readonly paths: PathRules;
  private readonly vault: ObsidianVaultLike;

  constructor(options: ObsidianVaultReadPortOptions) {
    this.vault = options.vault;
    this.paths = options.paths;
  }

  async stat(path: string): Promise<Result<VaultFileInfo>> {
    const normalized = this.paths.normalize(path);
    if (!normalized.ok) {
      return normalized;
    }
    const file = this.vault.getAbstractFileByPath(normalized.value);
    if (!file?.stat) {
      return err(ERROR_CODES.EXTERNAL_FILE_DELETED, `文件不存在：${normalized.value}`, {
        path: normalized.value,
      });
    }
    return ok(fileInfoOf(file));
  }

  async readText(
    path: string,
    signal?: AbortSignal,
  ): Promise<Result<TextFileSnapshot>> {
    if (signal?.aborted) {
      return err(ERROR_CODES.STORAGE_READ_FAILED, "读取已取消", { path });
    }
    const normalized = this.paths.normalize(path);
    if (!normalized.ok) {
      return normalized;
    }
    const file = this.vault.getAbstractFileByPath(normalized.value);
    if (!file?.stat) {
      return err(ERROR_CODES.EXTERNAL_FILE_DELETED, `文件不存在：${normalized.value}`, {
        path: normalized.value,
      });
    }
    try {
      const text = await this.vault.read(file);
      return ok({
        path: normalized.value,
        text,
        rawHash: sha256HexSync(text),
        mtimeMs: file.stat.mtime,
        sizeBytes: file.stat.size,
      });
    } catch (cause) {
      return err(ERROR_CODES.STORAGE_READ_FAILED, `读取失败：${normalized.value}`, {
        path: normalized.value,
        cause,
      });
    }
  }

  async list(options?: {
    readonly extension?: string;
    readonly underPath?: string;
  }): Promise<Result<readonly VaultFileInfo[]>> {
    const files = this.vault.getFiles?.() ?? [];
    const extension = options?.extension
      ? options.extension.replace(/^\./, "")
      : null;
    const underNormalized = options?.underPath
      ? this.paths.normalize(options.underPath)
      : null;
    const underPath = underNormalized?.ok ? underNormalized.value : null;
    const out: VaultFileInfo[] = [];
    for (const file of files) {
      if (extension !== null) {
        const ext = file.path.includes(".")
          ? file.path.slice(file.path.lastIndexOf(".") + 1)
          : "";
        if (ext !== extension) {
          continue;
        }
      }
      if (underPath !== null && !file.path.startsWith(`${underPath}/`)) {
        continue;
      }
      out.push(fileInfoOf(file));
    }
    out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return ok(out);
  }

  subscribe(listener: (event: StorageEventV1) => void): () => void {
    const onModify = (file: unknown): void => {
      const p = filePathOf(file);
      if (p) {
        listener({ kind: "modified", path: p });
      }
    };
    const onCreate = (file: unknown): void => {
      const p = filePathOf(file);
      if (p) {
        listener({ kind: "created", path: p });
      }
    };
    const onDelete = (file: unknown): void => {
      const p = filePathOf(file);
      if (p) {
        listener({ kind: "deleted", path: p });
      }
    };
    const onRename = (file: unknown, oldPath: unknown): void => {
      const newPath = filePathOf(file);
      if (typeof oldPath === "string" && newPath) {
        listener({ kind: "renamed", oldPath, newPath });
      }
    };
    this.vault.on("modify", onModify);
    this.vault.on("create", onCreate);
    this.vault.on("delete", onDelete);
    this.vault.on("rename", onRename);
    return () => {
      this.vault.off("modify", onModify);
      this.vault.off("create", onCreate);
      this.vault.off("delete", onDelete);
      this.vault.off("rename", onRename);
    };
  }
}

function filePathOf(file: unknown): string {
  if (
    typeof file === "object" &&
    file !== null &&
    "path" in file &&
    typeof file.path === "string"
  ) {
    return file.path;
  }
  return "";
}

// ---------------------------------------------------------------------------
// PlatformPort 聚合
// ---------------------------------------------------------------------------

export interface ObsidianPlatformAdapterOptions {
  readonly app: App;
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly vaultId: string;
  readonly paths?: PathRules;
  readonly getDocument?: () => Document | null;
  readonly isCommandAllowlisted?: (commandId: string) => boolean;
}

export class ObsidianPlatformAdapter implements PlatformPort {
  readonly kind = "obsidian" as const;
  readonly componentsStorage: ComponentsStoragePort;
  readonly vaultRead: VaultReadPort;
  readonly vaultMutation: VaultMutationPort;
  readonly workspace: WorkspacePort;
  readonly markdown: MarkdownPort;
  readonly commands: CommandPort;
  readonly notices: NoticePort;
  readonly theme: ThemePort;
  readonly clipboard: ClipboardPort;
  readonly clock: ClockPort;
  readonly externalUrls: ExternalUrlPort;
  readonly confirmations: ConfirmationPort;

  private readonly pluginId: string;
  private readonly pluginVersion: string;
  private readonly vaultId: string;

  constructor(options: ObsidianPlatformAdapterOptions) {
    const paths = options.paths ?? new ObsidianPathRules();
    const getDocument =
      options.getDocument ??
      (() => (typeof document !== "undefined" ? document : null));
    this.pluginId = options.pluginId;
    this.pluginVersion = options.pluginVersion;
    this.vaultId = options.vaultId;

    this.componentsStorage = new ObsidianStorageAdapter({
      vault: options.app.vault,
      paths,
    });
    this.vaultRead = new ObsidianVaultReadPort({
      vault: options.app.vault,
      paths,
    });
    this.vaultMutation = new ObsidianVaultMutationPort({
      vault: options.app.vault,
      paths,
    });
    this.workspace = new ObsidianWorkspacePort({ app: options.app, paths });
    this.markdown = new ObsidianMarkdownPort({ app: options.app });
    this.commands = new ObsidianCommandPort({
      app: options.app,
      pluginId: options.pluginId,
      isAllowlisted: options.isCommandAllowlisted,
    });
    this.notices = new ObsidianNoticePort();
    this.theme = new ObsidianThemePort({
      isDarkMode: () => options.app.isDarkMode(),
      getDocument,
      subscribeCssChange: (listener) => {
        const workspace = options.app.workspace;
        const ref = workspace.on("css-change", () => listener());
        return () => workspace.offref(ref);
      },
    });
    this.clipboard = new ObsidianClipboardPort({ getDocument });
    this.clock = new ObsidianClockPort();
    this.externalUrls = new ObsidianExternalUrlPort({ getDocument });
    this.confirmations = new ObsidianConfirmationPort(options.app);
  }

  getPlatformInfo(): PlatformInfo {
    const platformValue = globalValue("Platform");
    const isDesktop =
      typeof platformValue === "object" &&
      platformValue !== null &&
      "isDesktop" in platformValue &&
      platformValue.isDesktop === true;
    const isMobile =
      typeof platformValue === "object" &&
      platformValue !== null &&
      "isMobile" in platformValue &&
      platformValue.isMobile === true;
    const momentValue = globalValue("moment");
    const locale =
      typeof momentValue === "object" &&
      momentValue !== null &&
      "locale" in momentValue &&
      typeof momentValue.locale === "function"
        ? String(momentValue.locale())
        : "";
    return {
      kind: "obsidian",
      appVersion: globalString("appVersion"),
      pluginVersion: this.pluginVersion,
      locale,
      vaultId: this.vaultId as VaultId,
      isDesktop,
      isMobile,
    };
  }
}

function globalValue(key: string): unknown {
  return (globalThis as Record<string, unknown>)[key];
}

function globalString(key: string): string {
  const value = globalValue(key);
  return typeof value === "string" ? value : "";
}
