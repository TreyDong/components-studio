/**
 * ComponentsFileView —— `.components` 文件的 TextFileView
 * （《运行时与 SDK 协议 v1》第 4.6 节 + 《技术规格 v1》第 11.2 节）。
 *
 * 唯一写入者冻结为 DocumentSession → ComponentsStoragePort；本 View 不拥有
 * 第二条保存管道，requestSave 只委托 binding.save('manual')。
 *
 * 生命周期：
 *   onOpen → 创建容器（不创建 React Root）
 *   首次 setViewData → SessionFactory.acquire(path, {initialText}) →
 *     ComponentViewBindingImpl（createRoot 一次）→ render RuntimeRoot
 *   后续 setViewData → own-write hash 相同则忽略，否则 acceptExternalText
 *   getViewData → getSerializedWorkingText()（不触发磁盘写入）
 *   clear/onClose → flush → unmount → release → host dispose → empty DOM
 */

import { TextFileView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  DocumentSessionV1,
  ProtocolError,
  Result,
  SaveResultV1,
} from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";
import type { DocumentCodec } from "../../document/codec";
import type { SessionFactory } from "../../session/SessionFactory";
import { toRuntimeDocumentPort } from "../../session/DocumentSession";
import type { ComponentRegistry } from "../../registry/ComponentRegistry";
import { HostStateStore, RuntimeHostStore, RuntimeRoot } from "../../runtime";
import type {
  RuntimeMode,
  RuntimeServices,
  RuntimeDocumentPort,
} from "../../runtime/types";
import type { ComponentsViewBinding, PlatformPort } from "../ports";
import { sha256HexSync } from "../../shared/hash";

export const COMPONENTS_EXTENSION = "components";
export const COMPONENTS_VIEW_TYPE = "components-studio-file-view";

/** 由插件装配的 View 依赖（惰性获取：View 可能在运行时就绪前被恢复）。 */
export interface ComponentsFileViewDeps {
  readonly factory: SessionFactory;
  readonly codec: DocumentCodec;
  readonly registry: ComponentRegistry;
  readonly platform: PlatformPort;
  readonly hostIdPrefix: string;
  readonly servicesFactory: (input: {
    readonly document: RuntimeDocumentPort;
    readonly host: RuntimeHostStore;
    readonly hostState: HostStateStore;
  }) => RuntimeServices;
}

export interface ComponentViewBindingDeps {
  readonly path: string;
  readonly session: DocumentSessionV1;
  readonly container: HTMLElement;
  readonly hostId: string;
  readonly initialMode: RuntimeMode;
  /** 首次 setViewData 的原始文本 hash：作为自身写入回显消重的基线。 */
  readonly initialRawHash: string;
  readonly platform: PlatformPort;
  readonly codec: DocumentCodec;
  readonly factory: SessionFactory;
  readonly servicesFactory: ComponentsFileViewDeps["servicesFactory"];
}

/**
 * 具体 DocumentSession 的扩展方法（不在冻结的 DocumentSessionV1 接口上；
 * SessionAgent 提供 acceptExternalText 作为外部文本协调入口）。
 */
interface DocumentSessionWithExternal extends DocumentSessionV1 {
  acceptExternalText?(text: string): Promise<Result<void>>;
}

function bindingError(
  code: (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
  message: string,
  path: string,
): { ok: false; error: ProtocolError } {
  return {
    ok: false,
    error: {
      code,
      message,
      scope: "binding",
      recoverable: true,
      retryable: true,
      path,
      details: {},
    },
  };
}

export class ComponentViewBindingImpl implements ComponentsViewBinding {
  readonly path: string;
  readonly host: RuntimeHostStore;
  readonly hostState: HostStateStore;

  private readonly session: DocumentSessionV1;
  private readonly container: HTMLElement;
  private readonly root: Root;
  private readonly codec: DocumentCodec;
  private readonly factory: SessionFactory;
  private readonly abort = new AbortController();
  private lastOwnWriteHash: string;
  private disposed = false;

  constructor(deps: ComponentViewBindingDeps) {
    this.path = deps.path;
    this.session = deps.session;
    this.container = deps.container;
    this.codec = deps.codec;
    this.factory = deps.factory;
    this.lastOwnWriteHash = deps.initialRawHash;

    this.host = new RuntimeHostStore({
      hostId: deps.hostId,
      sourcePath: deps.path,
      element: deps.container,
      theme: deps.platform.theme,
    });
    this.hostState = new HostStateStore();
    const document = toRuntimeDocumentPort(this.session);
    const services = deps.servicesFactory({
      document,
      host: this.host,
      hostState: this.hostState,
    });
    this.root = createRoot(this.container);
    this.root.render(
      createElement(RuntimeRoot, {
        services,
        initialMode: deps.initialMode,
      }),
    );
  }

  getSerializedWorkingText(): Result<string> {
    if (this.disposed) {
      return bindingError(ERROR_CODES.SAVE_IO_FAILED, "绑定已释放", this.path);
    }
    return this.codec.serialize(this.session.getSnapshot());
  }

  async acceptExternalText(text: string): Promise<Result<void>> {
    if (this.disposed) {
      return bindingError(ERROR_CODES.SAVE_IO_FAILED, "绑定已释放", this.path);
    }
    const hash = sha256HexSync(text);
    if (hash === this.lastOwnWriteHash) {
      // 自身写入的回显（CAS 写后 Obsidian 的 setViewData 同步），确认后忽略。
      return { ok: true, value: undefined };
    }
    const extended = this.session as DocumentSessionWithExternal;
    if (extended.acceptExternalText) {
      const result = await extended.acceptExternalText(text);
      if (result.ok) {
        this.lastOwnWriteHash = hash;
      }
      return result;
    }
    // Phase 0 兜底：Session 自身订阅了 storage 事件（文档协议第 13 章），
    // 外部变化会经事件队列协调；这里只做 hash 基线更新。
    this.lastOwnWriteHash = hash;
    return { ok: true, value: undefined };
  }

  async save(reason: "manual" | "close"): Promise<Result<void>> {
    if (this.disposed) {
      return bindingError(ERROR_CODES.SAVE_IO_FAILED, "绑定已释放", this.path);
    }
    const result = await this.session.save(reason);
    if (!result.ok) {
      return bindingError(result.error.code, result.error.message, this.path);
    }
    return this.mapSaveResult(result.value);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.abort.abort();
    // close 语义：flush Session；保存失败时 Session.dispose（最后一次
    // release 触发）会写恢复区（文档协议 15.6），并保留可恢复副本。
    const saved = await this.save("close");
    void saved;
    this.root.unmount();
    const released = await this.factory.release(this.session);
    void released;
    this.host.dispose();
    this.hostState.dispose();
    this.container.empty();
  }

  private mapSaveResult(
    result: SaveResultV1,
  ): { ok: true; value: undefined } | { ok: false; error: ProtocolError } {
    switch (result.kind) {
      case "no-op":
      case "saved":
        this.lastOwnWriteHash = result.snapshot.rawHash;
        return { ok: true, value: undefined };
      case "conflict":
        return bindingError(ERROR_CODES.SAVE_CONFLICT, "保存冲突", this.path);
      case "missing":
        return bindingError(ERROR_CODES.EXTERNAL_FILE_DELETED, "文件已删除", this.path);
      case "indeterminate":
        return bindingError(result.error.code, result.error.message, this.path);
    }
  }
}

export class ComponentsFileView extends TextFileView {
  private readonly getDeps: () => ComponentsFileViewDeps | null;
  private binding: ComponentViewBindingImpl | null = null;
  private hostEl: HTMLElement | null = null;
  private editMode = false;

  constructor(
    leaf: WorkspaceLeaf,
    getDeps: () => ComponentsFileViewDeps | null,
  ) {
    super(leaf);
    this.getDeps = getDeps;
    // 唯一保存路径：Session → ComponentsStoragePort。绝不走继承的
    // 去抖保存管道（技术规格 11.2）。
    this.requestSave = (): void => {
      void this.saveViaBinding("manual");
    };
  }

  getViewType(): string {
    return COMPONENTS_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return this.file?.basename ?? "Components Studio";
  }

  override canAcceptExtension(extension: string): boolean {
    return extension === COMPONENTS_EXTENSION;
  }

  override async onOpen(): Promise<void> {
    this.hostEl = this.contentEl.createDiv({ cls: "ocs-view-host ocs-component" });
    // 不在此处创建 React Root；首次 setViewData 时才创建。
  }

  override async setViewData(data: string, clear: boolean): Promise<void> {
    void clear;
    this.data = data;
    const path = this.file?.path ?? "";
    if (path.length === 0) {
      return;
    }
    if (!this.binding) {
      const deps = this.getDeps();
      if (!deps) {
        this.showNotice("组件运行时尚未就绪");
        return;
      }
      const acquired = await deps.factory.acquire(path, { initialText: data });
      if (!acquired.ok) {
        this.showNotice(`无法打开组件文档：${acquired.error.message}`);
        return;
      }
      this.binding = new ComponentViewBindingImpl({
        path,
        session: acquired.value,
        container: this.hostEl ?? this.contentEl,
        hostId: `${deps.hostIdPrefix}:${path}`,
        initialMode: this.editMode ? "edit" : "view",
        initialRawHash: sha256HexSync(data),
        platform: deps.platform,
        codec: deps.codec,
        factory: deps.factory,
        servicesFactory: deps.servicesFactory,
      });
      return;
    }
    // 后续 setViewData：own-write hash 相同则忽略，否则交给外部协调。
    await this.binding.acceptExternalText(data);
  }

  override getViewData(): string {
    if (!this.binding) {
      return this.data;
    }
    const serialized = this.binding.getSerializedWorkingText();
    return serialized.ok ? serialized.value : this.data;
  }

  override clear(): void {
    void this.teardown();
  }

  override async onClose(): Promise<void> {
    await this.teardown();
  }

  override async setState(
    state: unknown,
    result: ViewStateResult,
  ): Promise<void> {
    if (
      state &&
      typeof state === "object" &&
      "mode" in state &&
      (state.mode === "edit" || state.mode === "view")
    ) {
      this.editMode = state.mode === "edit";
    }
    await super.setState(state, result);
  }

  override getState(): Record<string, unknown> {
    return { ...super.getState(), mode: this.editMode ? "edit" : "view" };
  }

  private async saveViaBinding(reason: "manual" | "close"): Promise<void> {
    if (!this.binding) {
      return;
    }
    const saved = await this.binding.save(reason);
    if (!saved.ok) {
      this.showNotice(`保存失败：${saved.error.message}`);
    }
  }

  private async teardown(): Promise<void> {
    const binding = this.binding;
    this.binding = null;
    if (binding) {
      await binding.dispose();
    }
    if (this.hostEl) {
      this.hostEl.empty();
    }
  }

  private showNotice(message: string): void {
    const deps = this.getDeps();
    if (deps) {
      deps.platform.notices.show(message, { level: "error" });
    }
  }
}
