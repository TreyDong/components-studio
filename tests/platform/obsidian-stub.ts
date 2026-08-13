/**
 * obsidian 模块测试桩（vitest alias）。
 * 仅用于需要 import obsidian 的测试（ComponentsFileView 等）；
 * 其他 platform 模块保持不顶层 import obsidian。
 */
export class TextFileView {
  contentEl: HTMLElement & {
    empty?: () => void;
    createDiv?: (opts?: { cls?: string }) => HTMLElement;
  } = document.createElement("div");

  constructor() {
    const el = this.contentEl;
    el.empty = () => {
      el.textContent = "";
    };
    el.createDiv = (opts?: { cls?: string }) => {
      const child = document.createElement("div");
      if (opts?.cls) child.className = opts.cls;
      (child as typeof el).empty = () => {
        child.textContent = "";
      };
      el.appendChild(child);
      return child;
    };
  }
  file: { path: string; basename: string } | null = null;
  data = "";
  requestSave = (): void => {};
  getViewType(): string {
    return "text";
  }
  getDisplayText(): string {
    return this.file?.basename ?? "";
  }
  async onOpen(): Promise<void> {}
  async onClose(): Promise<void> {}
  async setState(): Promise<void> {}
  getViewData(): string {
    return this.data;
  }
}

export class WorkspaceLeaf {}

export class ViewStateResult {}
