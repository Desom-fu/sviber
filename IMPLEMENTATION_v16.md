# Sviber v16 实现说明

本文逐项对应 `PROMPT-v15.md` 与 `PROMPT-v16.md` 的新增/修改内容，记录 v0.7.2 的代码、配置、测试和帮助文档改动。

## 文件菜单与生命周期

- 新增“关闭谱面/工程”：`js/commands.js` 注册 `file.close` 并放入文件菜单；`js/app-history-commands.js` 绑定操作；`js/app-file-workflows.js` 在关闭前统一处理“保存 / 不保存 / 取消”，随后卸载媒体、清除文件目标并回到空白独立谱面。
- v16 没有为关闭操作指定快捷键，因此没有擅自增加按键；中英文帮助表以 `—` 明示无快捷键。
- “打开最近文件”标记为 `desktopOnly`，网页端命令状态为禁用；项目新建、打开、保存和删除同样只在 NW.js 中可用。

## 工程与谱面工作流

- `js/app-core.js` 增加 `editingProject`，明确区分独立谱面和工程。工程谱面选择器只在 NW.js 且确实打开工程时显示；网页始终只编辑一张独立谱面。
- 工程中新建谱面时，`newDifficulty()` 从当前谱面继承 `music` 和 `image`，但保留新谱面自己的难度、定时和历史记录。
- 桌面工程打开时，“打开...”“导入谱面/关卡文件...”共用的 `openFile()` 会在解析 JSON、SSC 或 Lyrica 前询问是否加入当前工程。选择加入时保留现有工程并创建/激活谱面；选择不加入时按独立谱面打开。
- 从剪贴板导入也使用同一加入工程确认流程。
- 工程切换谱面会切换各谱面自己的媒体引用并异步加载对应音乐和图片，不再把媒体字段同步到工程内全部谱面。
- 自动保存恢复状态记录独立谱面/工程模式；网页不会从恢复数据进入工程模式。

## 工程格式与桌面限制

- `js/core/project.js` 将 `sviber-project.json` 规范化为且仅为 `charts: [{file,id}]` 与 `activeChart`。读取时兼容旧版 `format`/`version` 标记，下一次保存自动迁移成最小清单；清单不再保存音乐或图片字段。
- `js/platform.js` 在入口层拒绝网页端工程打开和保存，而不仅依赖菜单禁用，确保工程文件夹能力为 NW.js 桌面版专属。
- 保存新工程时，目标目录可以非空，但若已有 `sviber-project.json` 会拒绝写入。已有的其他同名文件不会被覆盖：新谱面和媒体会自动分配无冲突文件名，保存结果同步回编辑器中的谱面条目。
- 每张工程谱面保存自己的全部引用媒体；相同源文件去重，不同源的同名文件自动改名。工程内“保存当前谱面”也会先复制外部媒体并把路径改成工程目录相对路径。

## 媒体路径与关卡导出

- NW.js 独立谱面保存/另存为时，`music` 和 `image` 写为绝对路径；工程谱面写为工程根目录相对路径。
- `createLevelArchive()` 对工程遍历全部谱面，并收集每张谱面引用的所有音乐和图片；独立谱面导出只传入当前谱面及当前媒体。
- 同一媒体只打包一次，文件名冲突时自动改名。谱面 JSON 由严格 Sunniesnow 导出生成，顶层不含 `sviber` 字段。

## 删除谱面

- “删除谱面...”只在桌面工程且至少有两张谱面时启用。
- 确认表单增加“同时删除工程文件中的谱面文件”复选框，默认勾选；勾选后调用桌面文件删除接口。删除后自动激活相邻谱面并加载其独立媒体。最后一张工程谱面不能删除。

## 文案、帮助与版本配置

- `json/i18n.en-US.json`、`json/i18n.zh-CN.json` 增加关闭、加入工程、删除磁盘文件、工程桌面限制及相关错误/提示文本。
- `docs/index.html` 的中英文工程、文件菜单、媒体路径、关卡导出和保存格式章节已与 v16 行为同步；`README.md` 与 `README.zh-CN.md` 明确网页仅支持独立谱面。
- `package.json`、`package-lock.json` 更新为 `0.7.2`；Service Worker 缓存版本更新为 `sviber-v072`。

## v0.7.1 回归修复

- 撤回事件编辑时，历史视图现在保存和恢复 `timeSnapped`、`currentTime`、`visibleRangeBeginning`、`visibleRangeEnd`，因此会回到上一次编辑的时间条位置和对应拍数/秒数模式（`js/core/history.js`）。新增 `tests/history-regressions.test.mjs` 覆盖该场景。
- 主编辑区双押 tap 的连线在轻量拖动预览中优先从 `ChartRenderIndex.positionFor()` 读取实时位置，而不是沿用建立双押索引时的缓存坐标（`js/render/stage-core.js`）。`tests/render-index.test.mjs` 验证拖动后两端坐标均更新。
- 文件菜单中的自动保存命令启用检查只读取时间戳索引，不在菜单打开期间解析全部恢复文档（`js/app-history-commands.js`）；`tests/v16-features.test.mjs` 验证该路径不会调用完整恢复列表解析。

## v0.7.2 回归修复

- 上移或下移所选事件通道后，`ChartRenderIndex` 会递增时间轴游标布局修订号，`TimelineView` 将该修订号纳入检查点缓存签名，因此轻量增量刷新会立即重算游标连线纵坐标（`js/render/chart-index.js`、`js/render/timeline.js`、`js/render/timeline-helpers.js`）。
- `tests/render-index.test.mjs` 覆盖游标链事件先下移再上移，验证链成员、时间轴查询和缓存签名在两个方向均同步更新；中英文帮助同步说明即时更新行为。

## 验证覆盖

- `tests/v16-features.test.mjs` 覆盖菜单与网页禁用、最小工程清单、绝对/相对媒体路径、非空目录及同名文件保护、工程当前谱面保存、网页工程入口拒绝、删除复选框与最后谱面保护、媒体继承、加入工程确认和关闭流程。
- `tests/core.test.mjs` 覆盖多谱面/多媒体工程往返、旧清单兼容、严格 Sunniesnow 关卡 JSON 及全部资源打包。
- `scripts/verify-browser-project.mjs` 验证网页保持单谱面模式、全部工程命令禁用、工程选择器不可用和网页新建谱面行为。
- 发布门禁包括完整 `npm test`、`npm run verify:browser`、`npm run build`、`git diff --check`、JSON 解析，以及发布前重新逐行审计 v15/v16 diff。

## v15 → v16 最终逐项审计表

| Diff 新增/修改点 | 落实位置 | 验收覆盖 |
| --- | --- | --- |
| 文件菜单增加“关闭谱面/工程”及分隔线 | `js/commands.js`、`js/app-history-commands.js`、`closeDocument()` | 菜单顺序、无快捷键、关闭流程测试 |
| 工程新谱面继承上一张谱面的音乐和图片 | `newDifficulty()` | 媒体继承功能测试 |
| 桌面工程中“打开...”询问是否加入工程 | `openFile()` 与 `chart-file-input` | 公共加入确认流程测试 |
| 网页禁用“打开最近文件...” | `file.openRecent.desktopOnly` | 命令状态单测与浏览器验证 |
| JSON、SSC、Lyrica 导入统一询问是否加入工程 | `open-file-input` → `openFile()` 的解析前公共分支 | 输入绑定断言与加入确认测试 |
| 工程保存沿用已知路径；新目录可非空但不得已有清单 | `saveProject()`、`#assertNewProjectDestination()` | 保留普通文件、同名保护、已有清单拒绝及专用中英文错误提示测试 |
| 工程关卡导出全部谱面及各自媒体；JSON 无 `sviber` | `saveLevel()`、`createLevelArchive()` | 多谱面/多媒体 ZIP 内容与严格根对象测试 |
| 从剪贴板导入询问是否加入工程 | `importClipboard()` | v16 工作流断言 |
| 删除确认含默认勾选的磁盘删除；工程外/最后一张禁用 | `deleteDifficulty()`、命令启用条件、`deleteProjectChart()` | 表单默认值、文件删除、自动切换及最后谱面保护测试 |
| 关闭前处理未保存更改 | `confirmUnsaved()`、`closeDocument()` | 保存/放弃/取消入口及关闭功能测试 |
| 独立谱面使用绝对媒体路径，工程谱面使用相对路径 | `saveChart()`、`saveProject()` | 两类磁盘 JSON 路径断言；工程当前谱面单独保存测试 |
| 工程仅桌面可用；最小清单只有 `charts` 和 `activeChart`，媒体归各谱面 | `editingProject`、`FileManager` 桌面入口守卫、`core/project.js` | 网页拒绝、清单键精确断言、不同谱面媒体往返测试 |
