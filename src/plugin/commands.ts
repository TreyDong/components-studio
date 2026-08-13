/**
 * 插件命令（《运行时与 SDK 协议 v1》第 5.7 节 + 技术规格 4.4）。
 * Obsidian 会自动给命令 id 加插件前缀，因此这里注册 "open-file" /
 * "create-document"，运行时 id 为 "components-studio:open-file" 等。
 */

import { Modal, Notice, Setting, TextComponent, ToggleComponent, type App, type Command } from "obsidian";
import type { PluginRuntimeDeps } from "./PluginRuntimeDeps";

export interface CommandHost {
  readonly app: App;
  addCommand(command: Command): Command;
  getRuntimeDeps(): PluginRuntimeDeps | null;
}

// ---------------------------------------------------------------------------
// 打开组件文档
// ---------------------------------------------------------------------------

class OpenFileModal extends Modal {
  private readonly onPick: (path: string | null) => void;
  private resolved = false;
  private input: TextComponent | null = null;

  constructor(app: App, onPick: (path: string | null) => void) {
    super(app);
    this.onPick = onPick;
  }

  override onOpen(): void {
    this.setTitle("打开组件文档");
    new Setting(this.contentEl)
      .setName("路径")
      .setDesc("相对 Vault 根的 .components 文件路径")
      .addText((text) => {
        this.input = text;
        text.setPlaceholder("Dashboard/Home.components");
      });
    new Setting(this.contentEl).addButton((button) =>
      button.setButtonText("打开").setCta().onClick(() => this.settle(this.input?.getValue() ?? "")),
    );
  }

  override onClose(): void {
    this.settle("");
  }

  private settle(path: string): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.onPick(path.length > 0 ? path : null);
    this.close();
  }
}

// ---------------------------------------------------------------------------
// 创建组件文档
// ---------------------------------------------------------------------------

export interface CreateDocumentForm {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly openAfterCreate: boolean;
}

class CreateDocumentModal extends Modal {
  private readonly onSubmit: (form: CreateDocumentForm | null) => void;
  private resolved = false;
  private pathInput: TextComponent | null = null;
  private titleInput: TextComponent | null = null;
  private descriptionInput: TextComponent | null = null;
  private openToggle: ToggleComponent | null = null;

  constructor(app: App, onSubmit: (form: CreateDocumentForm | null) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  override onOpen(): void {
    this.setTitle("创建组件文档");
    new Setting(this.contentEl)
      .setName("路径")
      .setDesc("相对 Vault 根；已存在的文件不会被覆盖")
      .addText((text) => {
        this.pathInput = text;
        text.setPlaceholder("Dashboard/Home.components");
      });
    new Setting(this.contentEl).setName("标题").addText((text) => {
      this.titleInput = text;
      text.setPlaceholder("Home");
    });
    new Setting(this.contentEl).setName("描述").addText((text) => {
      this.descriptionInput = text;
    });
    new Setting(this.contentEl)
      .setName("创建后打开")
      .addToggle((toggle) => {
        this.openToggle = toggle;
        toggle.setValue(true);
      });
    new Setting(this.contentEl).addButton((button) =>
      button.setButtonText("创建").setCta().onClick(() => {
        const path = this.pathInput?.getValue() ?? "";
        this.settle({
          path,
          title: this.titleInput?.getValue() ?? "",
          description: this.descriptionInput?.getValue() ?? "",
          openAfterCreate: this.openToggle?.getValue() ?? true,
        });
      }),
    );
  }

  override onClose(): void {
    this.settle({
      path: "",
      title: "",
      description: "",
      openAfterCreate: true,
    });
  }

  private settle(form: CreateDocumentForm): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.onSubmit(form.path.length > 0 ? form : null);
    this.close();
  }
}

// ---------------------------------------------------------------------------
// 注册
// ---------------------------------------------------------------------------

export function registerOpenFileCommand(host: CommandHost): void {
  host.addCommand({
    id: "open-file",
    name: "打开组件文档",
    callback: () => {
      const modal = new OpenFileModal(host.app, (path) => {
        if (path === null) {
          return;
        }
        const deps = host.getRuntimeDeps();
        if (!deps) {
          new Notice("组件运行时尚未就绪");
          return;
        }
        void deps.platform.workspace.openComponentsDocument(path, {
          disposition: "new-tab",
        });
      });
      modal.open();
    },
  });
}

export function registerCreateDocumentCommand(host: CommandHost): void {
  host.addCommand({
    id: "create-document",
    name: "新建组件文档",
    callback: () => {
      const modal = new CreateDocumentModal(host.app, (form) => {
        if (form === null) {
          return;
        }
        const deps = host.getRuntimeDeps();
        if (!deps) {
          new Notice("组件运行时尚未就绪");
          return;
        }
        void (async () => {
          const created = await deps.documentCreator.create(form);
          if (!created.ok) {
            new Notice(`创建失败：${created.error.message}`, 6000);
            return;
          }
          new Notice(`已创建 ${created.value.path}`);
          if (form.openAfterCreate) {
            await deps.platform.workspace.openComponentsDocument(
              created.value.path,
              { disposition: "new-tab" },
            );
          }
        })();
      });
      modal.open();
    },
  });
}
