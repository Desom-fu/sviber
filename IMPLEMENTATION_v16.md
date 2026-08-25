# Sviber v16 实现说明

本文逐项对应 `PROMPT-v15.md` 与 `PROMPT-v16.md` 的新增/修改内容，记录至 v0.7.11 的代码、配置、测试和帮助文档改动。

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
- `package.json`、`package-lock.json` 更新为 `0.7.11`；Service Worker 缓存版本更新为 `sviber-v0711`。

## v0.7.1 回归修复

- 撤回事件编辑时，历史视图现在保存和恢复 `timeSnapped`、`currentTime`、`visibleRangeBeginning`、`visibleRangeEnd`，因此会回到上一次编辑的时间条位置和对应拍数/秒数模式（`js/core/history.js`）。新增 `tests/history-regressions.test.mjs` 覆盖该场景。
- 主编辑区双押 tap 的连线在轻量拖动预览中优先从 `ChartRenderIndex.positionFor()` 读取实时位置，而不是沿用建立双押索引时的缓存坐标（`js/render/stage-core.js`）。`tests/render-index.test.mjs` 验证拖动后两端坐标均更新。
- 文件菜单中的自动保存命令启用检查只读取时间戳索引，不在菜单打开期间解析全部恢复文档（`js/app-history-commands.js`）；`tests/v16-features.test.mjs` 验证该路径不会调用完整恢复列表解析。

## v0.7.2 回归修复

- 上移或下移所选事件通道后，`ChartRenderIndex` 会递增时间轴游标布局修订号，`TimelineView` 将该修订号纳入检查点缓存签名，因此轻量增量刷新会立即重算游标连线纵坐标（`js/render/chart-index.js`、`js/render/timeline.js`、`js/render/timeline-helpers.js`）。
- `tests/render-index.test.mjs` 覆盖游标链事件先下移再上移，验证链成员、时间轴查询和缓存签名在两个方向均同步更新；中英文帮助同步说明即时更新行为。

## v0.7.3 回归修复

- 修正下落式预览按住 `Ctrl+Space` 平移时的时间映射：指针向下移动会把可见时间移向更晚的位置，向上移动移向更早的位置；`scrollPanTarget()` 独立封装该映射并由单元测试覆盖。
- 下落式预览空白处的矩形框选改为沿用时间轴和主编辑区的实时选择预览：每次指针移动都会更新事件选中状态和画布，松开鼠标时才写入历史记录；取消/结束手势会清理预览状态。
- `tests/v13-features.test.mjs` 增加源码接线检查及上下方向的映射测试；中英文帮助补充平移方向和实时框选说明。

## v0.7.4 回归修复

- 播放启动时使用零迟到容差调度音效和命中特效，避免把起播时间之前的音符误判为迟到事件；运行中的时间帧仍保留迟到补偿，保证正常播放调度不受影响。
- `tests/v8-features.test.mjs` 增加播放启动调度接线回归测试，`tests/audio-platform.test.mjs` 已覆盖零迟到容差不会调度过去事件。

## v0.7.5 回归修复

- 修正播放首帧仍使用迟到补偿导致的二次漏播：调度器记录本次播放起点，并将正向播放的迟到窗口限制在起点之后；因此起播点前的音符不会在首帧或后续帧触发音效和命中特效。
- `js/app-playback-scheduling.js` 提供方向感知的迟到容差限制；`tests/audio-platform.test.mjs` 与 `tests/v8-features.test.mjs` 覆盖容差计算和实际 `_scheduleHits` 过滤结果。

## v0.7.6 回归修复

- 对齐 game-unstable 的 `Level.adjustProgress` / `SeWithMusic.adjustProgress`：起播或寻点后，起播点之前的音符视为已处理，调度硬下界为该拍数对应时间，而不是只收缩迟到容差。
- 因此当音频时钟略落后于编辑器起点时，夹在两者之间的音符（例如从 137 拍起播时的 `136+23/24`）不会再被当成即将到来的命中而放出音效和特效。
- `tests/audio-platform.test.mjs` 与 `tests/v8-features.test.mjs` 覆盖该拍数复现和落后时钟场景。

## v0.7.7 回归修复

- 对齐 game-unstable `SeWithMusic`：命中音效按音乐源时钟预约（`startedAt + (hitTime - startedPosition) / rate`），而不是按调度当下的 `AudioContext.currentTime + delay`。
- 起播先重建索引，再 `armPlaybackSource()` 钉住音乐时钟并启动音源，然后才调度音效。因此刚好在播放位置上的音符不会比音乐晚一截。
- `playHit` 在 AudioContext 已运行时同步开声，避免额外的异步空隙。

## v0.7.8 回归修复

- 主编辑区轻量拖动只刷新事件坐标，游标轨迹屏幕缓存仍按旧坐标绘制。`refreshPositions` 现在递增 `timelineTipRevision`，主编辑区缓存签名纳入该修订号，拖动时游标会跟着音符走。
- `tests/render-index.test.mjs` 覆盖拖动后游标检查点更新。

## v0.7.9 回归修复

- 停用通道走轻量 view 历史，但视图里不记录 `channel.active`。再启用时历史认为没变化，界面也不刷新，通道会卡在停用。视图现在保存并恢复通道启用状态；历史未写入时也会刷新。
- `tests/history-regressions.test.mjs` 覆盖停用后再启用同一通道。

## v0.7.10 回归修复

- 历史视图已保存时间条可见范围，但未保存时间轴通道纵向偏移。撤回/重做时横向拍数会回去，上下滚动却停在后来的位置。`timelineChannelOffset` 现在随视图一起保存和恢复。
- `tests/history-regressions.test.mjs` 覆盖撤回后通道纵向偏移回到上一次摆放时的位置。

## v0.7.11 回归修复

- 片段缩略图原先把所有事件画成同色圆点。现在使用时间轴同一套 `drawTimelineEventIcon` 和颜色，tap/hold/drag/flick 及背景类事件与时间轴一致。
- `tests/v12-features.test.mjs` 覆盖缩略图按种类使用时间轴图标和颜色。

## v0.7.12 回归修复

- 自由变换原先把“包围盒宽或高为零”一律视为无法启动，只有选中 group 才用 1 单位最小边界。水平或竖直排列的多个 note 在取消附着后只剩一条线，Ctrl+T 会静默失败。两个及以上可变换音符现在与 group 一样使用最小边界，单音符退化选择仍被拒绝。
- `tests/v12-features.test.mjs` 覆盖共线 note、分离后的共线附着 note，以及单音符仍不能启动。

## v0.7.13 回归修复

- 绘制吸附器时，主编辑区会把当前帧拷进静态层再只重绘草稿曲线。主画布使用 `desynchronized` 2D，撤回后的全量刷新会把上一帧鼠标橡皮筋读进静态层，留下残影。现在场景直接画到离屏静态层，贝塞尔、圆弧、钢笔共用这条路径。
- `tests/v13-features.test.mjs` 覆盖静态层不再从 live canvas 回读，以及撤回贝塞尔/圆弧控制点会恢复上一份草稿。

## v0.7.14 回归修复

- 拖动平移吸附器时，预览每次都会 `restore` 出新的吸附器对象，但轻量刷新不把新列表交给舞台，画面停在原处，松开后才跳到终点。预览现在把当前吸附器写回舞台状态并重采样；选中吸附器不再使用过期的 `snappeeSamples` 缓存。
- `tests/v9-features.test.mjs` 覆盖平移预览选项和舞台吸附器列表同步。

## v0.7.15 回归修复

- 时间轴底部总览进度条点击绿条外侧原先按一个可见跨度翻页。现在会把当前时间（黄线）跳到点击处，可见范围（绿条）按黄线原来的相对位置一起平移。<kbd>PageUp</kbd>/<kbd>PageDown</kbd> 仍按跨度翻页。
- `tests/v12-features.test.mjs` 覆盖跳转后的当前时间和可见范围。

## v0.7.16 回归修复

- <kbd>Ctrl</kbd>+滚轮缩放时间轴可见范围原先始终以绿条中点为中心。放到最大后再缩小会缩回歌曲中段，黄线被甩到绿条外面。现在以当前时间（黄线）为缩放中心。
- `tests/v12-features.test.mjs` 覆盖从全范围缩小后可见范围贴近当前时间。

## v0.7.17 回归修复

- 偏好里的音效音量和音乐音量从 0–1 滑块改为无上下限的数字输入；偏好存储和播放器增益都不再夹到 0–1。
- 帮助文档右侧正文铺满剩余宽度，表格固定布局并允许断行，去掉页面底部横向滚动条。
- `tests/preferences.test.mjs` 和 `tests/audio-platform.test.mjs` 覆盖无界音量与手册布局。

## v0.7.18 回归修复

- 音效/音乐音量改回与 Sunniesnow 相同的滑块：0 到 2，步进 0.05，默认 1。偏好存储和播放器增益按同一范围夹取。
- `tests/preferences.test.mjs` 和 `tests/audio-platform.test.mjs` 覆盖 0–2 夹取与滑块字段。

## v0.7.19 回归修复

- 帮助文档去掉会破坏 sticky 的整页 `overflow-x: hidden`。页面改成固定壳：顶栏和左侧目录留在视口里，只有右侧手册滚动，并继续禁止横向滚动。目录锚点和搜索跳转在手册滚动容器内 `scrollIntoView`。
- `tests/preferences.test.mjs` 覆盖固定壳布局；浏览器检查手册滚动时顶栏和目录位置不变。

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
