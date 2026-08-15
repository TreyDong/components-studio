# TaskNotes 能力参考（官方资料）

调研日期：2026-08-14。仅使用 TaskNotes 官方文档与其官方 GitHub 仓库；文档页面标注的版本为 TaskNotes 4.11.1。

## 结论

TaskNotes 的核心不是独立数据库，而是“每个任务一份 Markdown + YAML frontmatter”。其页面视图由 Obsidian Bases 查询这些文件得到；这与 Components Studio 应接入 Vault 文件、保留 Markdown 为真相的方向一致。

## 数据模型与写入边界

- 一个任务就是一个 Markdown 文件；任务元数据保存在 YAML frontmatter。任务可用指定标签（例如 `task`）或指定的 property/value（例如 `isTask: true`）识别。
- 默认字段可以映射到用户现有的键名，而不是要求迁移：`title`、`status`、`priority`、`due`、`scheduled`、`contexts`、`projects`、tags、`timeEstimate`、`recurrence`、`reminders` 等。`projects` 是指向 Vault 中真实笔记的链接；一个任务可属于多个项目。
- `status` 可用布尔 `true/false`，以兼容 Obsidian Properties 复选框。用户字段由用户定义 key，类型支持 text、number、boolean、date、list；这些字段可参与筛选、排序、分组。
- 支持正常笔记中的 checkbox 内联任务：可转换为完整 TaskNote。项目笔记可就地展示子任务与依赖关系。

示例（字段名应在我们系统中作为可配置映射，而非硬编码）：

```yaml
---
tags: [task]
title: "优化按钮组件"
status: in-progress
priority: high
due: 2026-08-20
scheduled: 2026-08-15
projects: ["[[components]]"]
contexts: ["@work"]
timeEstimate: 60
effort: medium
---
```

来源：[Task management](https://tasknotes.dev/features/task-management/)、[Task properties](https://tasknotes.dev/settings/task-properties/)、[General settings](https://tasknotes.dev/settings/general/)、[Inline features](https://tasknotes.dev/features/)。

## 查询、筛选、排序与分组

- TaskNotes 以 Obsidian Bases 为数据源；Task List、Kanban、Calendar、Agenda 都是 Vault 中可编辑的 `.base` 文本文件，而非插件私有查询配置。
- Bases 条件可使用 `==`、`!=`、`>`、`<`、`>=`、`<=`、`contains()`，以及 `and/or`。排序支持多列和方向。用户字段也可筛选、排序和分组。
- Kanban 必须指定 `groupBy`，每个属性值变成一列；可按 priority 等创建 swimlane，支持固定列、隐藏空列、WIP 上限、每列排序与拖放排序。
- HTTP API 提供 `POST /api/tasks/query`。请求是由 `and/or` group 与 condition 组成的 `FilterQuery`；可带 `sortKey`、`sortDirection`、`groupKey`、`subgroupKey`。可查询 status、priority、tags、projects、日期、完成状态、依赖、估时、recurrence 和 `user:<fieldId>`。

来源：[Task list view](https://tasknotes.dev/views/task-list/)、[Kanban view](https://tasknotes.dev/views/kanban-view/)、[User fields](https://tasknotes.dev/features/user-fields/)、[HTTP API](https://tasknotes.dev/HTTP_API/)。

## 现成视图与统计能力

- 任务视图：Task List、Kanban、Calendar（月/周/日/年/list，含拖放排期与 time-block）、Agenda、MiniCalendar。
- MiniCalendar 是紧凑月度 heatmap，并支持快速键盘导航；可作为我们“热力图”组件的功能参考，但并不等于通用分析图表系统。
- 时间追踪和 Pomodoro 有单任务明细与聚合 API。`GET /api/stats` 返回 total、completed、active、overdue、archived、withTimeTracking；`GET /api/time/summary` 可按 today/week/month/all 或日期区间汇总。

来源：[Views](https://tasknotes.dev/views/)、[HTTP API](https://tasknotes.dev/HTTP_API/)。

## 可接入 API

- **组件内优先**：直接扫描 Obsidian Vault Markdown/frontmatter，实施与 TaskNotes 同样的可移植模式；通过 metadata cache + vault 事件增量刷新。TaskNotes 官方 README 明确其 Bases data source 及 view types 为 `tasknotesTaskList`、`tasknotesKanban`、`tasknotesCalendar`、`tasknotesMiniCalendar`。
- **与已安装 TaskNotes 协作（可选 adapter）**：其桌面端 HTTP API 默认关闭，启用后只绑定 `127.0.0.1`，默认端口 8080；可用 `/api/tasks/query`、`/api/stats`、`/api/filter-options`。如配置 token，需 Bearer token。不要将其作为唯一数据源，否则页面无法在未安装 TaskNotes 的 Vault 运行。
- **进程内能力（可选）**：TaskNotes 公开了 `app.plugins.plugins.tasknotes.api.parseNaturalLanguage(text)`；完整 JS API 还覆盖任务更新、时间追踪、settings snapshot 与事件。使用前必须检测插件是否存在，且不应让 `project.dashboard` 依赖它。

来源：[官方 GitHub README](https://github.com/callumalpass/tasknotes)、[HTTP API](https://tasknotes.dev/HTTP_API/)、[NLP API](https://tasknotes.dev/nlp-api/)。

## 对本项目的落地建议

1. 建立 `vault.tasks` datasource：读取并规范化 TaskNotes-compatible frontmatter，配置 task identification、字段映射、任务 folders/排除 folders。
2. 数据源返回统一 TaskRecord，并提供 filter/sort/group 聚合；先支持项目首页所需的 status、type/tags、projects、日期、优先级、自定义字段。
3. `project.dashboard` 只消费 datasource results：指标卡、柱图、热力格与 Kanban 均来自同一个 query snapshot；拖放/完成操作写回相应任务 Markdown frontmatter。
4. TaskNotes adapter 作为增强层：若检测到并用户显式启用，使用其 API/NLP/统计能力；不可覆盖本地 Markdown 读写与重建索引能力。
