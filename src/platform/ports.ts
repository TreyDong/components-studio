/**
 * Platform Port（《运行时与 SDK 协议 v1》第 4 章）。
 * Adapter 是接触 Obsidian 对象的唯一边界；Runtime 与组件目录不得 import obsidian。
 * 本文件只定义 Interface，实现位于 src/platform/obsidian/。
 */

import type {
  Disposable,
  FileSnapshotV1,
  OpenDisposition,
  Result,
  StorageEventV1,
  StoragePortV1,
  VaultId,
  JsonValue,
} from "@ocs/contracts";

export type TextFileSnapshot = FileSnapshotV1;
export type StorageEvent = StorageEventV1;

export interface PlatformInfo {
  readonly kind: "obsidian";
  readonly appVersion: string;
  readonly pluginVersion: string;
  readonly locale: string;
  readonly vaultId: VaultId;
  readonly isDesktop: boolean;
  readonly isMobile: boolean;
}

export interface PathRules {
  normalize(input: string): Result<string>;
  resolve(
    input: string,
    options: {
      readonly sourcePath: string;
      readonly defaultBase: "vault" | "source-directory";
    },
  ): Result<string>;
  isInsideVault(path: string): boolean;
}

export interface ComponentsStoragePort extends StoragePortV1 {
  readonly paths: PathRules;
}

export interface VaultFileInfo {
  readonly path: string;
  readonly extension: string;
  readonly basename: string;
  readonly parentPath: string;
  readonly ctimeMs: number;
  readonly mtimeMs: number;
  readonly sizeBytes: number;
}

export interface VaultReadPort {
  readonly paths: PathRules;
  stat(path: string): Promise<Result<VaultFileInfo>>;
  readText(path: string, signal?: AbortSignal): Promise<Result<TextFileSnapshot>>;
  list(
    options?: { readonly extension?: string; readonly underPath?: string },
  ): Promise<Result<readonly VaultFileInfo[]>>;
  subscribe(listener: (event: StorageEvent) => void): () => void;
}

export interface FrontmatterPatchSet {
  readonly op: "set";
  readonly value: JsonValue;
}

export interface FrontmatterPatchDelete {
  readonly op: "delete";
}

export interface FrontmatterPatchAppend {
  readonly op: "append";
  readonly value: JsonValue;
  readonly unique: boolean;
}

export type FrontmatterPatchOperation =
  | FrontmatterPatchSet
  | FrontmatterPatchDelete
  | FrontmatterPatchAppend;

export interface MarkdownTaskLocator {
  readonly path: string;
  readonly expectedRawHash: string;
  readonly line: number;
  readonly expectedLineText: string;
  readonly expectedStatus: string;
  readonly blockId: string | null;
}

export interface VaultMutationPort {
  createText(input: {
    readonly path: string;
    readonly text: string;
    readonly createParents: boolean;
    readonly ifExists: "error" | "open-existing" | "append-number";
    readonly signal?: AbortSignal;
  }): Promise<Result<TextFileSnapshot>>;

  updateFrontmatter(input: {
    readonly path: string;
    readonly expectedFileText: string;
    readonly patch: Readonly<Record<string, FrontmatterPatchOperation>>;
    readonly signal?: AbortSignal;
  }): Promise<Result<TextFileSnapshot>>;

  updateMarkdownTask(input: {
    readonly locator: MarkdownTaskLocator;
    readonly nextStatus: string;
    readonly signal?: AbortSignal;
  }): Promise<Result<TextFileSnapshot>>;
}

export interface WorkspacePort {
  getActiveFile(): { readonly path: string } | null;
  openFile(
    path: string,
    options?: {
      readonly disposition?: OpenDisposition;
      readonly line?: number;
      readonly column?: number;
      readonly active?: boolean;
    },
  ): Promise<Result<void>>;
  revealFile(path: string): Promise<Result<void>>;
  openComponentsDocument(
    path: string,
    options?: {
      readonly disposition?: OpenDisposition;
      readonly editMode?: boolean;
    },
  ): Promise<Result<void>>;
}

export interface MarkdownRenderOwner {
  register(disposable: Disposable): void;
  dispose(): void | Promise<void>;
}

export interface MarkdownRenderRequest {
  readonly markdown: string;
  readonly sourcePath: string;
  readonly container: HTMLElement;
  readonly owner: MarkdownRenderOwner;
  readonly signal?: AbortSignal;
}

export interface MarkdownPort {
  render(request: MarkdownRenderRequest): Promise<Result<void>>;
}

export interface CommandDescriptor {
  readonly id: string;
  readonly name: string;
  readonly pluginId?: string;
}

export interface CommandPort {
  list(): readonly CommandDescriptor[];
  execute(commandId: string): Promise<Result<void>>;
  isAllowlisted(commandId: string): boolean;
}

export interface NoticePort {
  show(
    message: string,
    options?: {
      readonly level?: "info" | "success" | "warning" | "error";
      readonly timeoutMs?: number;
    },
  ): void;
}

export type ThemeColorToken =
  | "background"
  | "surface"
  | "surface-hover"
  | "text"
  | "text-muted"
  | "border"
  | "accent"
  | "danger"
  | "success"
  | "warning";

export interface ThemeSnapshot {
  readonly mode: "light" | "dark";
  readonly accentColor: string | null;
  readonly fontScale: number;
  readonly reducedMotion: boolean;
  readonly highContrast: boolean;
  readonly tokens: Readonly<Record<ThemeColorToken, string>>;
}

export interface ThemePort {
  getSnapshot(): ThemeSnapshot;
  subscribe(listener: () => void): () => void;
}

export interface ClipboardPort {
  writeText(text: string): Promise<Result<void>>;
}

export interface ClockPort {
  now(): number;
  timeout(callback: () => void, delayMs: number): Disposable;
  interval(callback: () => void, intervalMs: number): Disposable;
  aligned(
    callback: () => void,
    unit: "second" | "minute",
  ): Disposable;
}

export interface ExternalUrlPort {
  open(url: string): Promise<Result<void>>;
}

export interface ConfirmationRequest {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly danger: boolean;
}

export interface ConfirmationPort {
  confirm(request: ConfirmationRequest): Promise<boolean>;
}

export interface PlatformPort {
  readonly kind: "obsidian";
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
  getPlatformInfo(): PlatformInfo;
}

/** `.components` 文件 View 绑定（运行时协议第 4.6 节）。 */
export interface ComponentsViewBinding extends Disposable {
  readonly path: string;
  readonly host: import("../runtime/types").RuntimeHostStore;
  readonly hostState: import("../runtime/types").HostStateStore;
  getSerializedWorkingText(): Result<string>;
  acceptExternalText(text: string): Promise<Result<void>>;
  save(reason: "manual" | "close"): Promise<Result<void>>;
}
