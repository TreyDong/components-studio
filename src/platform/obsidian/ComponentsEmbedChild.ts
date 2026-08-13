/**
 * ComponentsEmbedChild —— `.components` Markdown 代码块宿主
 * （《运行时与 SDK 协议 v1》第 4.7 节 + 《技术规格 v1》第 11.3 节）。
 *
 * onload：解析 options → 校验/解析 src → SessionFactory.acquire →
 *   Host/HostState/React Root → render embedded Runtime。
 * onunload：abort → root.unmount → release Session → dispose Host/HostState
 *   → empty DOM。Embed 永远只读。
 */

import { MarkdownRenderChild } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import type { DocumentSessionV1 } from "@ocs/contracts";
import type { SessionFactory } from "../../session/SessionFactory";
import { toRuntimeDocumentPort } from "../../session/DocumentSession";
import { HostStateStore, RuntimeHostStore, RuntimeRoot } from "../../runtime";
import type {
  RuntimeServices,
  RuntimeDocumentPort,
} from "../../runtime/types";
import type { PlatformPort } from "../ports";
import {
  resolveEmbedSource,
  type ComponentsEmbedOptions,
} from "./embed-options";

export interface ComponentsEmbedChildDeps {
  readonly factory: SessionFactory;
  readonly platform: PlatformPort;
  readonly hostIdPrefix: string;
  readonly servicesFactory: (input: {
    readonly document: RuntimeDocumentPort;
    readonly host: RuntimeHostStore;
    readonly hostState: HostStateStore;
  }) => RuntimeServices;
}

export class ComponentsEmbedChild extends MarkdownRenderChild {
  private readonly options: ComponentsEmbedOptions;
  private readonly sourcePath: string;
  private readonly deps: ComponentsEmbedChildDeps;
  private readonly abort = new AbortController();
  private session: DocumentSessionV1 | null = null;
  private host: RuntimeHostStore | null = null;
  private hostState: HostStateStore | null = null;
  private root: Root | null = null;

  constructor(
    containerEl: HTMLElement,
    options: ComponentsEmbedOptions,
    sourcePath: string,
    deps: ComponentsEmbedChildDeps,
  ) {
    super(containerEl);
    this.options = options;
    this.sourcePath = sourcePath;
    this.deps = deps;
  }

  override onload(): void {
    const el = this.containerEl;
    el.addClass("ocs-embed", "ocs-component");
    if (this.options.height !== "auto") {
      el.style.height = `${this.options.height}px`;
    }
    if (this.options.maxWidth !== undefined) {
      el.style.maxWidth = `${this.options.maxWidth}px`;
    }
    const paths = this.deps.platform.componentsStorage.paths;
    const resolved = resolveEmbedSource(
      this.options.src,
      (path) => paths.isInsideVault(path),
      (path) => paths.normalize(path),
    );
    if (!resolved.ok) {
      this.renderDiagnostic(resolved.error.message);
      return;
    }
    void this.acquireAndRender(resolved.value);
  }

  override onunload(): void {
    this.abort.abort();
    this.root?.unmount();
    this.root = null;
    if (this.session) {
      void this.deps.factory.release(this.session);
      this.session = null;
    }
    this.host?.dispose();
    this.host = null;
    this.hostState?.dispose();
    this.hostState = null;
    this.containerEl.empty();
  }

  private async acquireAndRender(path: string): Promise<void> {
    const acquired = await this.deps.factory.acquire(path);
    if (this.abort.signal.aborted) {
      if (acquired.ok) {
        await this.deps.factory.release(acquired.value);
      }
      return;
    }
    if (!acquired.ok) {
      this.renderDiagnostic(`无法打开 ${path}：${acquired.error.message}`);
      return;
    }
    this.session = acquired.value;
    this.host = new RuntimeHostStore({
      hostId: `${this.deps.hostIdPrefix}:embed:${path}`,
      sourcePath: path,
      element: this.containerEl,
      theme: this.deps.platform.theme,
    });
    this.hostState = new HostStateStore();
    const document = toRuntimeDocumentPort(this.session);
    const services = this.deps.servicesFactory({
      document,
      host: this.host,
      hostState: this.hostState,
    });
    this.root = createRoot(this.containerEl);
    this.root.render(
      createElement(RuntimeRoot, { services, initialMode: "embedded" }),
    );
  }

  private renderDiagnostic(message: string): void {
    const el = this.containerEl;
    el.addClass("ocs-embed-error");
    el.setText(message);
  }
}
