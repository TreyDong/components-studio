/**
 * ComponentsStudioPlugin —— 插件 Shell（《技术规格 v1》第 4.4 节）。
 *
 * onload 只做轻量工作：加载设置、创建轻量 Module（Registry/Codec/Adapter/
 * SessionFactory——纯内存装配，无重型 IO）、注册 View/扩展/Markdown
 * processor/命令/设置页。Vault 全量索引等重型初始化延迟到
 * workspace.onLayoutReady（Phase 0 仅占位）。
 *
 * onunload：dispose SessionFactory（含所有 Session 的保存/恢复），释放
 * 全部 Obsidian 事件注册。
 */

import { Notice, Plugin } from "obsidian";
import { ComponentRegistryImpl } from "../registry/ComponentRegistry";
import { NodeFactoryImpl } from "../registry/NodeFactory";
import { DocumentCodec } from "../document/codec";
import { DocumentBuilderImpl } from "../document/DocumentBuilder";
import { CodecSessionFactory } from "../session/SessionFactory";
import { createRuntimeServices } from "../runtime";
import { ObsidianPathRules } from "../platform/obsidian/ObsidianPathRules";
import { ObsidianStorageAdapter } from "../platform/obsidian/ObsidianStorageAdapter";
import { ObsidianRecoveryPort } from "../platform/obsidian/ObsidianRecoveryPort";
import { ObsidianPlatformAdapter } from "../platform/obsidian/ObsidianPlatformAdapter";
import { deriveVaultId } from "../platform/obsidian/obsidian-api";
import {
  COMPONENTS_EXTENSION,
  COMPONENTS_VIEW_TYPE,
  ComponentsFileView,
} from "../platform/obsidian/ComponentsFileView";
import {
  ComponentsEmbedChild,
} from "../platform/obsidian/ComponentsEmbedChild";
import { parseComponentsEmbedOptions } from "../platform/obsidian/embed-options";
import { coreLayoutDefinition } from "../widgets/core-layout";
import { coreMarkdownDefinition } from "../widgets/core-markdown";
import { timeClockDefinition } from "../widgets/time-clock";
import { timeCalendarDefinition } from "../widgets/time-calendar";
import { DocumentFileCreatorImpl } from "./create-document";
import { registerCreateDocumentCommand, registerOpenFileCommand } from "./commands";
import { ComponentsStudioSettingTab, DEFAULT_SETTINGS, type PluginSettings } from "./settings";
import type { PluginRuntimeDeps, ServicesFactoryFn } from "./PluginRuntimeDeps";

interface StoredSettings extends PluginSettings {
  version: number;
}

export class ComponentsStudioPlugin extends Plugin {
  private pluginSettings: StoredSettings = { ...DEFAULT_SETTINGS, version: 1 };
  private runtimeDeps: PluginRuntimeDeps | null = null;
  private indexStatus = "索引：等待 layout ready（Phase 2 接入）";

  override async onload(): Promise<void> {
    await this.loadSettings();

    // 轻量 Module 装配（无重型 IO）。
    this.assembleRuntime();

    this.addSettingTab(
      new ComponentsStudioSettingTab(this.app, this, {
        getIndexStatus: () => this.indexStatus,
        getCapabilityGrants: () => [],
        getSessionCount: () => this.runtimeDeps?.factory.getSessionCount() ?? 0,
      }),
    );

    registerOpenFileCommand(this);
    registerCreateDocumentCommand(this);

    // View + 扩展名 + Markdown processor。
    this.registerView(COMPONENTS_VIEW_TYPE, (leaf) =>
      new ComponentsFileView(leaf, () => this.runtimeDeps),
    );
    this.registerExtensions([COMPONENTS_EXTENSION], COMPONENTS_VIEW_TYPE);
    this.registerMarkdownCodeBlockProcessor("components", (source, el, ctx) => {
      const parsed = parseComponentsEmbedOptions(source);
      if (!parsed.ok) {
        el.addClass("ocs-embed-error");
        el.setText(parsed.error.message);
        return;
      }
      const deps = this.runtimeDeps;
      if (!deps) {
        el.addClass("ocs-embed-error");
        el.setText("Components Studio 运行时尚未就绪");
        return;
      }
      const child = new ComponentsEmbedChild(el, parsed.value, ctx.sourcePath, {
        factory: deps.factory,
        platform: deps.platform,
        hostIdPrefix: this.manifest.id,
        servicesFactory: deps.servicesFactory,
      });
      ctx.addChild(child);
    });

    // 重型初始化延迟到 layout ready（Phase 0：仅状态占位）。
    this.app.workspace.onLayoutReady(() => {
      this.indexStatus = `索引：Phase 2 接入（当前 ${this.app.vault.getFiles().length} 个文件）`;
    });
  }

  override onunload(): void {
    if (this.runtimeDeps) {
      void this.runtimeDeps.factory.dispose();
    }
    this.runtimeDeps = null;
  }

  getRuntimeDeps(): PluginRuntimeDeps | null {
    return this.runtimeDeps;
  }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  private assembleRuntime(): void {
    const registry = new ComponentRegistryImpl();
    const registerResult = [
      registry.register(coreLayoutDefinition),
      registry.register(coreMarkdownDefinition),
      registry.register(timeClockDefinition),
      registry.register(timeCalendarDefinition),
    ].find((result) => !result.ok);
    if (registerResult && !registerResult.ok) {
      new Notice(`注册内置组件失败：${registerResult.error.message}`);
    }

    const codec = new DocumentCodec(registry.codecView());
    const vaultId = deriveVaultId(
      this.app.vault.getName(),
      this.app.vault.configDir,
    );
    const paths = new ObsidianPathRules();
    const storage = new ObsidianStorageAdapter({ vault: this.app.vault, paths });
    const recovery = new ObsidianRecoveryPort({
      adapter: this.app.vault.adapter,
      configDir: this.app.vault.configDir,
      // configDir 异常时的兜底（ObsidianRecoveryPort 内记录选择）。
      pluginDir: this.manifest.dir ?? "plugins/components-studio",
      vaultId,
    });
    const platform = new ObsidianPlatformAdapter({
      app: this.app,
      pluginId: this.manifest.id,
      pluginVersion: this.manifest.version,
      vaultId,
      isCommandAllowlisted: (commandId) =>
        this.pluginSettings.allowlistedCommandIds.includes(commandId) ||
        commandId.startsWith(`${this.manifest.id}:`),
    });
    const factory = new CodecSessionFactory({
      codec,
      storage,
      recovery,
      clock: platform.clock,
      vaultId,
    });
    const builder = new DocumentBuilderImpl({
      registry,
      nodeFactory: new NodeFactoryImpl(),
      codec,
    });
    const documentCreator = new DocumentFileCreatorImpl({
      storage,
      builder,
      codec,
    });
    const servicesFactory: ServicesFactoryFn = (input) =>
      createRuntimeServices({
        platform,
        registry,
        document: input.document,
        host: input.host,
        hostState: input.hostState,
      });

    this.runtimeDeps = {
      factory,
      codec,
      registry,
      platform,
      recovery,
      documentCreator,
      servicesFactory,
      hostIdPrefix: this.manifest.id,
    };
  }

  private async loadSettings(): Promise<void> {
    const loaded: unknown = await this.loadData();
    const merged = { ...DEFAULT_SETTINGS, ...(loaded as Partial<StoredSettings> | null) };
    this.pluginSettings = {
      allowlistedCommandIds: Array.isArray(merged.allowlistedCommandIds)
        ? merged.allowlistedCommandIds.filter(
            (id): id is string => typeof id === "string",
          )
        : [],
      version: 1,
    };
  }
}
