/**
 * RuntimeHostStore（《运行时与 SDK 协议 v1》第 3.2 节）。
 *
 * 每个 Host 一个实例：一个根 ResizeObserver（容器宽度 → responsiveMode，
 * 尺寸通知按 requestAnimationFrame 合并）与一个根可见性 Observer。
 * ownerDocument/ownerWindow 来自宿主元素，绝不使用全局 document/window。
 * 测试环境（jsdom）没有 ResizeObserver/IntersectionObserver 时降级为
 * 构造期 getBoundingClientRect 快照 + isHostVisible=true（注释见上）。
 */
import type { HostSnapshot, RuntimeHostStore as RuntimeHostStorePort, Size } from "./types";
import type { ThemePort } from "../platform/ports";
import { responsiveModeForWidth } from "@ocs/contracts";
import { ERROR_CODES } from "@ocs/contracts";

export interface RuntimeHostStoreOptions {
  readonly hostId: string;
  readonly sourcePath: string;
  /** 宿主容器元素（.components View / Embed 的根元素）。 */
  readonly element: HTMLElement;
  readonly theme: ThemePort;
}

export class RuntimeHostStore implements RuntimeHostStorePort {
  private readonly options: RuntimeHostStoreOptions;
  private snapshot: HostSnapshot;
  private readonly listeners = new Set<() => void>();
  private resizeObserver: ResizeObserver | null = null;
  private visibilityObserver: IntersectionObserver | null = null;
  private rafHandle: number | null = null;
  private pendingSize: Size | null = null;
  private disposed = false;

  constructor(options: RuntimeHostStoreOptions) {
    this.options = options;
    const { element } = options;
    const ownerDocument = element.ownerDocument;
    if (!ownerDocument) {
      throw new Error(
        `${ERROR_CODES.HOST_OWNER_DOCUMENT_MISSING}: 宿主元素缺少 ownerDocument`,
      );
    }
    const ownerWindow = ownerDocument.defaultView;
    if (!ownerWindow) {
      throw new Error(
        `${ERROR_CODES.HOST_OWNER_DOCUMENT_MISSING}: 宿主文档缺少 defaultView`,
      );
    }
    const rect = element.getBoundingClientRect();
    const containerSize: Size = {
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
    };
    this.snapshot = {
      hostId: options.hostId,
      sourcePath: options.sourcePath,
      ownerDocument,
      ownerWindow,
      containerSize,
      responsiveMode: responsiveModeForWidth(containerSize.width),
      isAttached: element.isConnected,
      isHostVisible: true,
      theme: options.theme.getSnapshot(),
    };
    this.startObservers();
  }

  // 方法以箭头字段实现：外部可能把方法引用直接传给
  // useSyncExternalStore（不绑定 this），箭头字段保证安全。
  getSnapshot = (): HostSnapshot => {
    return this.snapshot;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  };

  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafHandle !== null) {
      this.snapshot.ownerWindow.cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.visibilityObserver) {
      this.visibilityObserver.disconnect();
      this.visibilityObserver = null;
    }
    this.listeners.clear();
  }

  private startObservers(): void {
    const element = this.options.element;
    const ownerWindow = this.snapshot.ownerWindow;
    // lib.dom 把 ResizeObserver/IntersectionObserver 声明为全局构造器而非
    // Window 成员；通过有界断言读取宿主 realm 的实现（不同 iframe 各有一份）。
    const ResizeObserverCtor: (typeof ResizeObserver) | undefined = (
      ownerWindow as { ResizeObserver?: typeof ResizeObserver }
    ).ResizeObserver;
    const IntersectionObserverCtor: (typeof IntersectionObserver) | undefined = (
      ownerWindow as { IntersectionObserver?: typeof IntersectionObserver }
    ).IntersectionObserver;
    // 构造期元素可能尚未挂载（size 0）；观察器就绪后自动纠正。
    if (typeof ResizeObserverCtor === "function") {
      const observer = new ResizeObserverCtor((entries: ResizeObserverEntry[]) => {
        const entry = entries[0];
        if (!entry) return;
        this.pendingSize = {
          width: Math.max(0, Math.round(entry.contentRect.width)),
          height: Math.max(0, Math.round(entry.contentRect.height)),
        };
        this.scheduleNotify();
      });
      this.resizeObserver = observer;
      observer.observe(element);
    }
    if (typeof IntersectionObserverCtor === "function") {
      const observer = new IntersectionObserverCtor((entries: IntersectionObserverEntry[]) => {
        const entry = entries[0];
        if (!entry) return;
        this.commit({
          ...this.snapshot,
          isHostVisible: entry.isIntersecting,
          isAttached: element.isConnected,
        });
      });
      this.visibilityObserver = observer;
      observer.observe(element);
    }
  }

  private scheduleNotify(): void {
    if (this.rafHandle !== null || this.pendingSize === null) return;
    const ownerWindow = this.snapshot.ownerWindow;
    this.rafHandle = ownerWindow.requestAnimationFrame(() => {
      this.rafHandle = null;
      const size = this.pendingSize;
      this.pendingSize = null;
      if (size === null) return;
      this.commit({
        ...this.snapshot,
        containerSize: size,
        responsiveMode: responsiveModeForWidth(size.width),
        isAttached: this.options.element.isConnected,
      });
    });
  }

  private commit(next: HostSnapshot): void {
    if (this.disposed) return;
    this.snapshot = next;
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }
}
