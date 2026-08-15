# Components Studio

用版本化的组件文档（versioned component documents）和可信 React 组件，在 Obsidian 中构建动态页面。

文档与渲染分离：`.components` 文件是版本化、可校验、可迁移的文档格式；组件是注册到 Registry 的可信 React 组件。二者通过权限模型、绑定（bindings）与事件（events）连接。

## 功能特性

- **版本化文档**：`ComponentsDocumentV1` 带 `formatVersion` / `revision` / `specVersion`，含 Schema 校验（`src/document/validate.ts`）与迁移框架（各组件 `migrations.ts`）。
- **可信组件注册表**：组件经 `defineComponent` 注册，声明所需的文档操作权限；运行时由 `CapabilityBroker` 按权限放行。
- **内置组件**：`core-layout`（布局）、`core-markdown`（Markdown 渲染）、`core-nav-list`（导航列表）、`time-clock`（时钟）、`time-calendar`（日历）、`project-dashboard`（项目看板）。
- **文档动作**：打开文件 / URL、复制到剪贴板、执行命令、显示通知、更新 frontmatter、创建文件。
- **主题适配**：样式统一走主题 token（`--ocs-*`），非 Obsidian 宿主下自动回退。
- **数据源**：文档可挂载 `dataSources`，由 `DataSourceStore` 提供查询能力。

## 安装

1. 下载最新 release 的 `main.js`、`manifest.json`、`styles.css`。
2. 放入 vault 的 `.obsidian/plugins/components-studio/`。
3. 在 Obsidian 设置中启用「Components Studio」。

开发版安装：执行 `npm run build` 后将产物复制到同一目录。

## 开发

```bash
npm install
npm run dev          # 监听构建 main.js
npm run check        # typecheck + lint + test
npm run build        # 生产构建
npm run preview:build  # 构建浏览器预览到 dist-preview/
```

浏览器预览用于快速调试组件渲染链路（与插件相同的 Registry → RuntimeRoot 管线），不进入插件产物。

## 目录结构

```
src/
  contracts/   # 文档 / 查询 / 权限 契约类型
  document/    # 版本化文档：构建、校验、编解码、迁移
  registry/    # 组件注册与定义
  runtime/     # 渲染运行时：渲染器、动作、数据源、错误边界
  widgets/     # 内置组件（schema + renderer + inspector）
  platform/    # Obsidian 适配层与平台端口
  plugin/      # 插件入口、命令、设置
  preview/     # 浏览器预览（开发用）
docs/          # 调研与能力参考文档
examples/      # 示例文档
tests/         # 单元 / 集成 / 安装测试
```

## 文档

- `docs/tasknotes-reference.md` — TaskNotes 能力调研（数据模型、查询、看板），供路线图参考。

## 许可证

MIT
