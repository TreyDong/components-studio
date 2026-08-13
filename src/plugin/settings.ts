/**
 * 设置页（《技术规格 v1》第 23 章 + 第 4.4 节）。
 * Phase 0 占位：索引状态行 + 能力授权列表（Phase 2 接入真实 Index/Grant
 * Store 后替换为实时数据）。
 */

import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";

export interface PluginSettings {
  readonly allowlistedCommandIds: readonly string[];
}

export const DEFAULT_SETTINGS: PluginSettings = {
  allowlistedCommandIds: [],
};

export interface SettingsStatusSource {
  getIndexStatus(): string;
  getCapabilityGrants(): readonly string[];
  getSessionCount(): number;
}

export class ComponentsStudioSettingTab extends PluginSettingTab {
  private readonly source: SettingsStatusSource;

  constructor(app: App, plugin: Plugin, source: SettingsStatusSource) {
    super(app, plugin);
    this.source = source;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Components Studio" });

    new Setting(containerEl)
      .setName("索引状态")
      .setDesc("Vault 全量索引（PageRecord/Query）在 Phase 2 接入。")
      .addText((text) => {
        text.setValue(this.source.getIndexStatus());
        text.setDisabled(true);
      });

    new Setting(containerEl)
      .setName("打开会话数")
      .setDesc("当前共享的组件文档 Session 数量。")
      .addText((text) => {
        text.setValue(String(this.source.getSessionCount()));
        text.setDisabled(true);
      });

    containerEl.createEl("h3", { text: "能力授权" });
    containerEl.createEl("p", {
      text: "组件对 Vault/命令/外部链接等敏感能力的授权列表。Phase 0 尚无组件请求能力；列表在 Phase 2 接入 Grant Store 后显示真实授权。",
    });
    const grants = this.source.getCapabilityGrants();
    if (grants.length === 0) {
      containerEl.createEl("p", {
        text: "（暂无授权）",
        cls: "setting-item-description",
      });
    } else {
      const list = containerEl.createEl("ul");
      for (const grant of grants) {
        list.createEl("li", { text: grant });
      }
    }
  }
}
