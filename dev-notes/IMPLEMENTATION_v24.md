# IMPLEMENTATION_v24

v24 相对 v23 的需求来自 `dev-notes/PROMPT-v23.md` 与 `dev-notes/PROMPT-v24.md` 的逐行 unified diff（约 583 行新增、69 行删除）。原始 patch 保存在同目录 `dev-notes/PROMPT-v23-v24.diff`，并在本文末全文收录。

发布元数据：`package.json` 版本 `0.15.0`，Service Worker 缓存 `sviber-v01500`。

验证：`eslint . --max-warnings 0` 通过；`node --test tests/*.test.mjs` 共 576 项，575 通过，1 项 NW.js 无头环境 skip，0 失败。`git diff --check` 退出码 0。CLI `--version` 输出 `sviber 0.15.0`，`--help` 含 `--version`。

## Diff 清单与实现

### 1. 面板拖拽改布局并写入偏好
- **需求**：状态栏可与右侧面板不同宽；时间轴与状态栏等高。主编辑区与左/右侧、时间轴与状态栏、主编辑区与顶栏、检查区与历史面板之间可拖拽改尺寸；比例与通道高度记在编辑器偏好而非谱面。
- **文件**：`js/app/app-layout.js`、`js/app/app-helpers.js`、`js/platform/window-bounds.js`、`css/app.css`、`index.html`、`tests/layout-resize.test.mjs`。
- **实现**：可拖分界 DOM；分数钳制后写入 `localStorage` 偏好。
- **验证**：`tests/layout-resize.test.mjs` 通过。

### 2. 可见通道数可配置（默认 3）
- **需求**：超过可配置数量（默认 3）的通道不再增高，改为竖向滚动。
- **文件**：`js/app/app-helpers.js`（`visibleChannels`）、`js/render/timeline.js`、`tests/visible-channels.test.mjs`。
- **实现**：时间轴通道窗口高度由偏好 `visibleChannels` 决定。
- **验证**：`tests/visible-channels.test.mjs` 通过。

### 3. 游标切换亮青色竖线与双击编辑
- **需求**：置换像不等于自身的通道，在切换时刻画亮青色竖线；绘制顺序在拍线之上、当前时间黄线之下；双击打开与菜单相同的表单，优先级低于选事件。
- **文件**：`js/render/timeline-markers.js`、`js/render/timeline-pointer.js`、`js/app/app-tip-point-switch.js`、`tests/tip-point-switch.test.mjs`。
- **实现**：命中类型 `tip-switch`；双击回调打开置换表单。
- **验证**：`tests/tip-point-switch.test.mjs` 通过。

### 4. 不可见选中事件红三角
- **需求**：时间轴看不到的选中事件用红三角标记（含隐藏通道分隔线上已有亮线的例外、四向与斜向、同角去重）。
- **文件**：`js/core/selected-event-markers.js`、`js/render/timeline-markers.js`、`tests/selected-event-triangles.test.mjs`。
- **实现**：纯几何函数计算 kind，绘制层去重后画三角。
- **验证**：`tests/selected-event-triangles.test.mjs` 通过。

### 5. 隐藏通道游标连线截断
- **需求**：一端可见、一端隐藏时，连线停在表示隐藏通道的亮水平线。
- **文件**：`js/render/timeline-markers.js`（`_channelDrawY`）、`js/render/timeline-drawing.js`、`tests/tip-point-hidden-channel-lines.test.mjs`。
- **实现**：隐藏通道映射到分隔线 Y，检查点用该 Y 截断。
- **验证**：`tests/tip-point-hidden-channel-lines.test.mjs` 通过。

### 6. 用 perdurant 替换 “events with durations”
- **需求**：时长把手、检查器、谱面字段用语改为 perdurant。
- **文件**：`js/core/chart-vocabulary.js`、手册四语、属性编辑。
- **实现**：词汇表与检查器按 perdurant 集合判断。
- **验证**：现有时长/检查器测试仍通过。

### 7. 滚动条热图排除 drag
- **需求**：密度只计 tap/hold/flick，不含 drag。
- **文件**：`js/render/timeline-helpers.js`、`tests/scrollbar-heatmap-non-drag.test.mjs`。
- **实现**：分箱计数过滤 `drag`。
- **验证**：`tests/scrollbar-heatmap-non-drag.test.mjs` 通过。

### 8. 选中吸附器在滚动条上的半透明竖线
- **需求**：选中吸附器时，在其吸附事件时刻画同色半透明竖线。
- **文件**：`js/render/timeline-markers.js`、`tests/snappee-scrollbar-markers.test.mjs`。
- **验证**：`tests/snappee-scrollbar-markers.test.mjs` 通过。

### 9. Alt 拖滚动条平移可见范围
- **需求**：按住 Alt 点击/拖动滚动条，把可见范围中心移到指针，不改当前时间。
- **文件**：`js/render/timeline-pointer.js`、`tests/scrollbar-alt-pan.test.mjs`。
- **验证**：`tests/scrollbar-alt-pan.test.mjs` 通过。

### 10. 状态栏三项对齐
- **需求**：时间靠左、拍数居中、速度靠右。
- **文件**：`css/app.css`、`tests/status-readout-alignment.test.mjs`、手册。
- **验证**：`tests/status-readout-alignment.test.mjs` 通过。

### 11. 锁定布局
- **需求**：勾选后不能拖改面板尺寸，边缘显隐按钮消失；视图菜单仍可用；默认关。
- **文件**：`index.html`、`js/app/app-layout.js`、`svg/icons/lock-layout.svg`、`tests/lock-layout.test.mjs`。
- **验证**：`tests/lock-layout.test.mjs` 通过。

### 12. 边缘按钮文案含片段面板
- **需求**：右侧按钮同时显隐检查器/通道/吸附器/片段/历史。
- **文件**：`js/app/app-shell-bindings.js`、`js/app/app-layout.js`、手册。
- **验证**：`tests/ui-shell.test.mjs`、`tests/view-menu.test.mjs` 通过。

### 13. 通道/吸附器/片段拖放排序
- **需求**：除上下按钮外可用拖放排序。
- **文件**：`js/ui/panel-lists.js`、`js/ui/panel-clips.js`、`tests/panel-drag-reorder.test.mjs`。
- **验证**：`tests/panel-drag-reorder.test.mjs` 通过。

### 14. 展开按钮改用 more.svg
- **需求**：通道、吸附器、片段的第二行展开按钮为 `more.svg`。
- **文件**：`svg/icons/more.svg`、`js/ui/panel-lists.js`、`js/ui/item-menu.js`、`js/ui/panel-clips.js`、`tests/more-button.test.mjs`。
- **验证**：`tests/more-button.test.mjs` 通过。

### 15. 滚动视图 perdurant 尾巴
- **需求**：可移动 perdurant（hold、bgNote）显示竖直时长尾巴。
- **文件**：`js/render/scroll-view.js`、词汇表。
- **验证**：既有滚动视图测试通过。

### 16. 菜单栏增加 View（助记 i）
- **需求**：顶级菜单增加 V<u>i</u>ew。
- **文件**：`js/app/commands.js`、四语 i18n、`tests/view-menu.test.mjs`。
- **验证**：`tests/view-menu.test.mjs` 通过。

### 17. 编辑关卡说明
- **需求**：文件菜单 “Edit level readme...”；无工程时灰显。
- **文件**：`js/app/commands.js`、`js/app/app-readme-editor.js`、`readme.html`、`js/readme/readme.js`、`tests/edit-level-readme.test.mjs`、`tests/readme-editor.test.mjs`。
- **验证**：上述测试通过。

### 18. 拖放导入谱面/媒体
- **需求**：从文件管理器拖入支持的谱面或媒体，等同菜单导入/设音乐/设背景。
- **文件**：`js/app/app-file-drop.js`、`tests/file-drag-drop.test.mjs`。
- **验证**：`tests/file-drag-drop.test.mjs` 通过。

### 19. 导入按游标轨分配再装回通道
- **需求**：占位符处理后找空闲 tip point track（必要时新建），再把轨装回通道并写游标切换，使同时刻顺序一致。
- **文件**：`js/core/sunniesnow-import.js`、`js/core/tip-point-track.js`、`tests/sunniesnow-import.test.mjs`。
- **实现**：`allocateTrackIndex` 按轨占用闭区间判重叠；`packTracksIntoChannels` 写 `tipPointSwitches`。
- **验证**：`tests/sunniesnow-import.test.mjs` 通过。

### 20. 偏好对话框改为引用 editor preferences
- **需求**：Preferences... 不再就地罗列字段，改为见 editor preferences 节。
- **文件**：`js/app/app-preferences-media.js`、`tests/preferences.test.mjs`、手册。
- **验证**：`tests/preferences.test.mjs` 通过。

### 21. 取消选择快捷键改为 X
- **需求**：Select none 由 Ctrl+D 改为 X。
- **文件**：`js/app/commands.js`、`tests/select-none-shortcut.test.mjs`、手册。
- **验证**：`tests/select-none-shortcut.test.mjs` 通过。

### 22. 选择当前时间事件（Z）
- **需求**：选中所有时刻等于当前时间的事件。
- **文件**：`js/app/commands.js`、`js/app/app-command-bindings.js`、`tests/select-events-at-current-time.test.mjs`。
- **验证**：`tests/select-events-at-current-time.test.mjs` 通过。

### 23. 播放中创建事件 + 输入偏移
- **需求**：创建模式且正在播放时，无修饰键的字母/数字/符号键（输入未聚焦）或主编辑区鼠标按下，按音频上下文时间加 input offset 吸附放置；禁止用 `Event.timeStamp`。
- **文件**：`js/app/app-event-tools.js`、`js/app/commands.js`、`js/render/stage-pointer.js`、`tests/event-creation-playback.test.mjs`、`tests/input-offset.test.mjs`。
- **验证**：上述测试通过。

### 24. 墨点默认时长 0 拍
- **需求**：首次创建 hold 默认 1 拍，bg note 默认 0 拍。
- **文件**：`js/app/app-core.js`、`tests/bg-note-default-duration.test.mjs`。
- **验证**：`tests/bg-note-default-duration.test.mjs` 通过。

### 25. 批量编辑文本
- **需求**：按通道 `<select>`+`<textarea>`，编码/解码伪代码，提交时各通道一起写入；不含 comment。
- **文件**：`js/core/bulk-edit-texts.js`、`js/app/app-bulk-edit.js`、`tests/bulk-edit-texts.test.mjs`。
- **验证**：`tests/bulk-edit-texts.test.mjs` 通过。

### 26. 通道菜单图标与游标切换（I）
- **需求**：创建/删除通道使用 maker 图标；新增 Tip point switch...（I）。
- **文件**：`js/app/commands.js`、`svg/icons/tip-point-switch.svg`、`js/app/app-tip-point-switch.js`。
- **验证**：`tests/tip-point-switch.test.mjs`、命令测试通过。

### 27. 播放中仍可在创建模式放置
- **需求**：播放时多数编辑禁用，但创建模式放置是例外。
- **文件**：`js/app/commands.js`（`interceptCreationPlaybackKey`）、`js/app/app-event-tools.js`。
- **验证**：`tests/event-creation-playback.test.mjs` 通过。

### 28. View 菜单：显隐三组面板与重置布局
- **需求**：切换顶/左/右面板组（等同边缘按钮）；重置侧栏宽高与通道高度为默认。
- **文件**：`js/app/commands.js`、`js/app/app-layout.js`、`tests/view-menu.test.mjs`。
- **验证**：`tests/view-menu.test.mjs` 通过。

### 29. 手册语言跟随编辑器，控件不持久化
- **需求**：每次打开手册用编辑器语言；页内切换不写入存储。
- **文件**：`js/ui/help.js`、`docs/docs.js`、`tests/documentation-language.test.mjs`。
- **验证**：`tests/documentation-language.test.mjs` 通过。

### 30. 快捷键文档与帮助对话框
- **需求**：帮助快捷键对话框含全部有快捷键的命令（含 I/X/Z）；手册菜单表同步。
- **文件**：`js/ui/help.js`、四语手册、`tests/menu-toolbar-shortcuts.test.mjs`。
- **验证**：快捷键对话框测试通过。

### 31. 事件类别词汇表
- **需求**：movable / tip-pointable / notes / background / textable / perdurant。
- **文件**：`js/core/chart-vocabulary.js`。
- **验证**：检查与批量改字测试覆盖这些集合。

### 32. 游标切换与游标轨定义
- **需求**：实现 $(\tau,\pi)$ 与 $T(C)$；同刻不能两个切换；inherit 沿轨而非沿通道。
- **文件**：`js/core/tip-point-track.js`、`js/core/tip-point.js`、`js/core/chart-model.js`。
- **验证**：`tests/tip-point-switch.test.mjs`、既有游标测试通过。

### 33. 删除“同通道同时刻叠层”那段旧说明
- **需求**：该边案已纳入轨定义，旧段删除。
- **实现**：逻辑并入 `T(C)` 构造，不再单独处理。
- **验证**：游标测试通过。

### 34. 合并越界检查并增加 bgNotes 参数
- **需求**：`outOfBoundaryNotes` 含 notes 与 bgNote；布尔参数默认 true；删除独立 bg 检查。
- **文件**：`js/core/checks-config.js`、`js/core/checks.js`、`tests/out-of-boundary-notes.test.mjs`、`tests/checks.test.mjs`。
- **验证**：上述测试通过。

### 35. 非法字符检查
- **需求**：非 comment 文本禁控制字符；可移动事件还禁空白。
- **文件**：`js/core/checks.js`、`tests/bad-characters.test.mjs`。
- **验证**：`tests/bad-characters.test.mjs` 通过。

### 36. 漂移游标检查
- **需求**：相邻连接事件及出现时刻到首事件不超过 T 秒（默认 2）。
- **文件**：`js/core/checks.js`、`tests/drifting-tip-points.test.mjs`。
- **验证**：`tests/drifting-tip-points.test.mjs` 通过。

### 37. 被遮挡文本检查
- **需求**：可移动可带文本事件在持续时间内须可见（同位置或 hold 距离 ≤ 6.25）。
- **文件**：`js/core/checks.js`、`tests/blocked-texts.test.mjs`。
- **验证**：`tests/blocked-texts.test.mjs` 通过。

### 38. 实时托管 URL 保留监听主机
- **需求**：即使绑定 `0.0.0.0`，toast URL 主机仍为监听主机。
- **文件**：`js/platform/live-hosting.js`、`tests/live-hosting-url.test.mjs`。
- **验证**：`tests/live-hosting-url.test.mjs` 通过。

### 39. Editor preferences 专节
- **需求**：音符速度、输入偏移（含 adjust 节拍器）、可见通道、事件图标尺寸及派生尺寸、音量、主题、自动保存、托管地址、布局分数、语言（作用于编辑器/宏/说明/手册）。
- **文件**：`js/app/app-helpers.js`、`js/app/app-preferences-media.js`、`js/render/timeline-helpers.js`、`tests/event-icon-size.test.mjs`、`tests/input-offset.test.mjs`、`tests/preferences.test.mjs`。
- **验证**：上述测试通过。

### 40. 时间输入带 s/ms 后缀
- **需求**：秒/毫秒输入后显示单位，标签不再写 “in seconds”。
- **文件**：`js/ui/ui-fields.js`、`js/core/checks-config.js`、`tests/number-input-units.test.mjs`。
- **验证**：`tests/number-input-units.test.mjs` 通过。

### 41. 关卡说明编辑器
- **需求**：独立页面；File/Edit/View；侧栏文件列表；Monaco；Markdown 预览（marked+DOMPurify）；布局记偏好；文件名符合 `needsDisplayTextFile`。
- **文件**：`readme.html`、`css/readme.css`、`js/readme/readme.js`、`js/app/app-readme-editor.js`、`tests/readme-editor.test.mjs`。
- **验证**：`tests/readme-editor.test.mjs` 通过。

### 42. 宏界面布局与 View 菜单
- **需求**：侧栏/控制台可拖改尺寸；View：切换控制台、重置布局；拖放导入宏。
- **文件**：`macros.html`、`js/macro/macro-layout.js`、`js/macro/macros.js`、`css/macros.css`、`tests/macros-layout.test.mjs`。
- **验证**：`tests/macros-layout.test.mjs` 通过。

### 43. 通道数据 tipPointSwitches
- **需求**：`time` + `target`；仅保存像不等于自身的项。
- **文件**：`js/core/tip-point-track.js`、`js/core/chart-normalize.js`、`tests/tip-point-switch.test.mjs`。
- **验证**：`tests/tip-point-switch.test.mjs` 通过。

### 44. 谱面 checks 字段
- **需求**：`outOfBoundaryNotes.bgNotes`；`driftingTipPoint.seconds`；删除 `outOfBoundaryBgNotes`。
- **文件**：`js/core/checks-config.js`（含旧字段迁移）。
- **验证**：`tests/out-of-boundary-notes.test.mjs`、`tests/checks.test.mjs` 通过。

### 45. i18n 范围澄清与独立窗口
- **需求**：手册正文仍分文件；非正文走 JSON。主编辑器/宏/说明/手册为独立页面；浏览器用新标签打开手册、其余弹窗；NW.js 全部弹窗并记住位置。
- **文件**：`js/ui/help.js`、`js/platform/window-bounds.js`、`js/app/app-core.js`、`tests/windows-popup.test.mjs`、`tests/documentation-language.test.mjs`。
- **验证**：上述测试通过。

### 46. CLI --version
- **需求**：`--version`/`-v` 显示版本且不启动 GUI。
- **文件**：`js/cli/cli.js`、`js/cli/cli-main.js`、`js/cli/cli-operations.js`、`tests/cli-version.test.mjs`。
- **验证**：`tests/cli-version.test.mjs` 通过；运行 `runCli(['--version'])` 得到 `sviber 0.15.0`。

### 47. 内部帮助手册四语同步
- **需求**：快捷键、新菜单、检查项、偏好、导入轨、播放中放置、手册语言不持久等与实现一致。
- **文件**：`docs/manual.en-US.html`、`docs/manual.zh-CN.html`、`docs/manual.zh-TW.html`、`docs/manual.ja-JP.html`。
- **验证**：`tests/manual-line-length.test.mjs`、`tests/documentation.test.mjs` 通过。

### 48. 四语 i18n 键
- **需求**：新命令、检查、偏好、对话框键齐全。
- **文件**：`json/i18n.en-US.json` 等四份。
- **验证**：`tests/i18n.test.mjs`、`tests/language-support.test.mjs` 通过。

### 49. Service Worker 与版本
- **需求**：缓存新页面、CSS、JS、图标；版本 0.15.0。
- **文件**：`service-worker.js`、`package.json`、`package-lock.json`。
- **验证**：`tests/ui-shell.test.mjs`、构建元数据测试通过。

## 功能命名测试对照

| 功能 | 测试文件 |
|---|---|
| 布局拖拽 | `tests/layout-resize.test.mjs` |
| 锁定布局 | `tests/lock-layout.test.mjs` |
| 可见通道 | `tests/visible-channels.test.mjs` |
| 视图菜单 | `tests/view-menu.test.mjs` |
| more 按钮 | `tests/more-button.test.mjs` |
| 面板拖放排序 | `tests/panel-drag-reorder.test.mjs` |
| 游标切换 | `tests/tip-point-switch.test.mjs` |
| 隐藏通道连线 | `tests/tip-point-hidden-channel-lines.test.mjs` |
| 选中三角 | `tests/selected-event-triangles.test.mjs` |
| 热图排除 drag | `tests/scrollbar-heatmap-non-drag.test.mjs` |
| Alt 平移滚动条 | `tests/scrollbar-alt-pan.test.mjs` |
| 吸附器滚动条标记 | `tests/snappee-scrollbar-markers.test.mjs` |
| 状态栏对齐 | `tests/status-readout-alignment.test.mjs` |
| 取消选择 X | `tests/select-none-shortcut.test.mjs` |
| 当前时间选择 Z | `tests/select-events-at-current-time.test.mjs` |
| 播放中放置 | `tests/event-creation-playback.test.mjs` |
| 输入偏移 | `tests/input-offset.test.mjs` |
| 墨点默认时长 | `tests/bg-note-default-duration.test.mjs` |
| 批量改字 | `tests/bulk-edit-texts.test.mjs` |
| 非法字符 | `tests/bad-characters.test.mjs` |
| 漂移游标 | `tests/drifting-tip-points.test.mjs` |
| 遮挡文本 | `tests/blocked-texts.test.mjs` |
| 越界合并 | `tests/out-of-boundary-notes.test.mjs` |
| CLI 版本 | `tests/cli-version.test.mjs` |
| 托管 URL | `tests/live-hosting-url.test.mjs` |
| 文件拖放 | `tests/file-drag-drop.test.mjs` |
| 关卡说明 | `tests/edit-level-readme.test.mjs`、`tests/readme-editor.test.mjs` |
| 宏布局 | `tests/macros-layout.test.mjs` |
| 独立窗口 | `tests/windows-popup.test.mjs` |
| 手册语言 | `tests/documentation-language.test.mjs` |
| 数字单位 | `tests/number-input-units.test.mjs` |
| 事件图标尺寸 | `tests/event-icon-size.test.mjs` |

## 原始 diff

下文全文收录 `dev-notes/PROMPT-v23-v24.diff`。

`diff
--- dev-notes/PROMPT-v23.md
+++ dev-notes/PROMPT-v24.md
@@ -130,6 +130,37 @@
 | Tooltip bar                                                            |
 ```
 
+The status panel and the other right side panels (inspection panel etc. and the history panel) have the same width by default,
+but the status panel can have a different width as the user changes the layout.
+The status panel and the timeline always has the same height.
+
+The user can click and drag between the main editor field and the right side panels to resize them, changing their widths.
+The main editor field trades its width with the right side panels.
+The fraction of the right side panel width over the total page width is recorded in the editor preferences
+(not in the chart file).
+
+The user can click and drag between the main editor field and the left side panels to resize them, changing their widths.
+The main editor field trades its width with the left side panels.
+The fraction of the left side panel width over the total page width is recorded in the editor preferences
+(not in the chart file).
+
+The user can click and drag between the timeline and the status panel to resize them, changing their widths.
+The timeline trades its width with the status panel.
+The fraction of the status panel width over the total page width is recorded in the editor preferences.
+
+The user can click and drag between the main editor field (and the right side panels) and the top panels, changing their heights.
+The main editor field and the left and right side panels trade their height with the top panels.
+When the height changes, the heights of the waveform and each channel change, but the number of shown channels do not change.
+The height of the waveform and the height of a channel are kept to be equal.
+The height of a channel in the timeline is recorded in the editor preferences (not in the chart file).
+
+The user can click and drag between the inspection panel (or the channels panel, the snappees panel, or the clips panel)
+and the history panel to resize them, changing their heights.
+The inspection panel (or the other panels sharing the same space with it)
+trades its width with the history panel.
+The fraction of the inspection panel height over the combined height of the inspection panel and the history panel
+is recorded in the editor preferences.
+
 ### Menu bar
 
 At the top of the window, there is the menu bar.
@@ -286,7 +317,8 @@
 As the total number of channels can change
 (through [create channel above](#create-channel-above), [delete channel](#delete-channel), etc.),
 the total height of this part should also change.
-When there are more than 3 channels, do not increase the height further
+When there are more than a certain number of channels
+(by default is 3, but customizable), do not increase the height further
 but show a vertical scroll bar to scroll through the channels.
 The user can scroll through the channels vertically by interacting with the vertical scroll
 or using the mouse wheel while holding <kbd>Shift</kbd>.
@@ -324,6 +356,32 @@
 The drawing order of the events follows the order in which they are stacked vertically,
 with the event stacked at the bottom being drawn at the top.
 
+For every tip point switch,
+for every channel whose image under the permutation function of the tip point switch is different from itself,
+draw a vertical bright teal line in the channel at the time of the tip point switch.
+The drawing order of bright teal line is below the bright yellow line for the current time
+but above the beat lines.
+Double clicking the bright teal line opens a popup form for editing the tip point switch,
+which is the same as the popup form used by the [submenu item](#tip-point-switch).
+This operation has lower priority than selecting events.
+
+If an selected event is not visible in the channels in the timeline, draw a red triangle to mark it
+(this does not include a selected event in the visible range in a hidden channel
+that has a visible bright line indicating it in the timeline).
+If the event is in a channel visible in the current vertical scroll position of the channels but is outside the visible range,
+draw a triangle pointing left (if it is earlier than the visible range) or right (if it is later than the visible range)
+at the left edge (if it is earlier than the visible range) or right edge (if it is later than the visible range)
+of the channel shown in the timeline.
+If the event is outside the visible range and is in a hidden channel that has a visible bright horizontal line indicating it,
+the triangles are drawn at the left or the right of the horinzontal line.
+If the event is in the visible range but is in a channel not visible in the current scroll position of channels,
+draw a triangle at its time pointing down (if it is below the visible channels) or up (if it is above the visible channels)
+at the bottom (if it is below the visible channels) or the top (if it is above the visible channels)
+of the channels in the timeline.
+If the event is outside the visible range and is not in a visible channel,
+draw the triangle at a corner of the channels in the timeline, pointing at a oblique direction to where the event is.
+If multiple events need triangles drawn at the same corner, only one of them is drawn to avoid cluttering.
+
 If an event is contained in a `group` event, draw a circle around its event icon with the color of the `group` event.
 The circle needs to be larger than the event icon.
 If it is inside a nested `group` event, for each `group` event that contains it directly or indirectly, draw a circle.
@@ -337,6 +395,8 @@
 in which case the user can deactivate the channel with many events to operate on other channels.
 
 Events that are connected by one tip point appear connected by a thick translucent white line.
+If a tip point connects an event in a visible channel and another event in a hidden channel,
+the line stops at the bright horizontal line indicating the hidden channel.
 Additionally, there is an additional segment of thin dark yellow line emanating from the first event connected by the tip point,
 pointing in the direction from which the tip point flies in to the first event.
 This additional segment is very short
@@ -419,16 +479,16 @@
 then the $i$th event can only be moved to beat $b_i+n/3$,
 where $n$ is an integer and is the same for all $i$.
 
-For each selected event with a duration, a handle marked as a white diamond appears.
+For each selected perdurant event (i.e., event with a duration), a handle marked as a white diamond appears.
 The size of the handle is smaller than the event icon
 (otherwise the user cannot click an event icon if an end time handle blocks it).
 The handle (and thus its hit box) enlarges when the user holds <kbd>Ctrl</kbd>+<kbd>Alt</kbd>.
-The user can use mouse to drag the handle to change the end times of the events with durations.
+The user can use mouse to drag the handle to change the end times of the perdurant events.
 The interaction priority of the handles are higher than directly dragging events.
 For this mechanics, selecting a `group` event is effectively equivalent to selecting
 For each event, its end time must not be smaller than its time;
 if its event type additionally does not allow zero end time, its end time must be strictly larger than its time.
-If the end times of all selected notes with durations are the same,
+If the end times of all selected perdurant notes are the same,
 the end times can only snap to beat subdivisions;
 otherwise, the end times can only be shifted by the same integer multiple of beat subdivisions;
 this behavior is similar to dragging events in time, described in the previous paragraph.
@@ -491,8 +551,8 @@
 The user can interact with the line using mouse to move it to other time across the music to change the current time.
 During the interaction, the current time is always snapped to beat subdivisions.
 
-The background of the scroll bar is colored according to the density of notes
-(total number of `tap`, `drag`, `hold`, `flick` events per second)
+The background of the scroll bar is colored according to the density of non-`drag` notes
+(total number of `tap`, `hold`, `flick` events per second)
 to present a heat map.
 Time with larger note density is colored with brighter red color,
 and time with lower note density is colored with dark gray.
@@ -508,6 +568,10 @@
 If there is at least one A-B loop mark, draw a blue vertical line indicating the position for every mark.
 If there are two A-B loop marks, draw a translucent filled blue rectangle indicating the range between the two marks.
 In any case, they are not interactable on the scroll bar.
+
+When a snappee is selected,
+draw translucent vertical lines of the same color of the color of the snappee,
+marking the times of events snapped to the snappee.
 
 The mouse interaction priorities: bright yellow line > two vertical green lines > horizontal green line.
 
@@ -582,6 +646,10 @@
 If the visible range initially contains the current time,
 the visible range is changed together so that the visual position of the current time does not change.
 
+When the user clicks and possibly drags on the scroll bar while holding <kbd>Alt</kbd>,
+the center of the visible range is moved to where the mouse is, clamped so that the visible range does not exceed the music bounds.
+The current time is not changed in this way.
+
 Clicking the scroll bar has higher priority than clicking events in channels.
 
 ### Status panel
@@ -603,6 +671,8 @@
 ```
 
 The three data are put in the same line without labels to save space.
+The first part is aligned to the left, the last part is aligned to the right,
+and the middle part is aligned at the center.
 They are put on multiple lines if one line cannot contain all three data.
 
 Below the basic information, there are some basic control options,
@@ -649,6 +719,10 @@
   (although it usually has to be the case if sviber is running in the browser),
   but can only exit fullscreen by unchecking this checkbox or hitting <kbd>F11</kbd>.
   This checkbox automatically checks and unchecks when the editor enters and exits fullscreen by other means.
+- Lock layout (`lock-layout.svg`): when checked, the panels width and height cannot be changed by clicking and dragging,
+  and the buttons for showing and hiding panels do not appear.
+  The submenu items for toggling panels still work regardless.
+  Unchecked by default.
 - Live hosting (`live-hosting.svg`): when checked, an HTTP server is set up to host the Sunniesnow level.
   See [live hosting](#live-hosting).
 
@@ -687,20 +761,22 @@
 to restore to the default.
 
 When the mouse hovers near the center of the right edge of the main editor field,
-a button appear that the user can click to hide or show the inspection panel,
-the snappees panel, the channels panel, and the history panel.
+a button appear that the user can click to hide or show the right side panels
+(the inspection panel, the snappees panel, the channels panel, the clips panel, and the history panel).
 When they are hidden, the main editor field can be wider.
 These panels are not hidden by default.
 This button should be a DOM element, not part of the canvas of the main editor field.
 
 When the mouse hovers near the center of the left edge of the main editor field,
-a button appear that the user can click to hide or show the scroll view and the checks panel.
+a button appear that the user can click to hide or show the left side panels
+(the scroll view and the checks panel).
 When they are hidden, the main editor field can be wider.
 They are not hidden by default.
 This button should be a DOM element, not part of the canvas of the main editor field.
 
 When the mouse hovers near the center of the top edge of the main editor field,
-a button appear that the user can click to hide the timeline and the status panel.
+a button appear that the user can click to hide the top panels
+(the timeline and the status panel).
 When they are hidden, the main editor field can be taller.
 The timeline and the status panel are not hidden by default.
 This button should be a DOM element, not part of the canvas of the main editor field.
@@ -1072,6 +1148,7 @@
 Every channel has a button for moving up (`up.svg`) and a button for moving down (`down.svg`).
 These buttons are used for changing the order of the channels
 without having to change the current channel.
+Besides using the buttons, the user can also use drag-and-drop to order the items.
 
 Every channel has a button for creating a channel above (`create-channel-above.svg`) and
 a button for creating a channel below (`create-channel-below.svg`).
@@ -1090,7 +1167,7 @@
 
 All these buttons except activating/deactivating are hidden by default.
 For each item, there is the activating/deactivating button,
-and another button for making the item taller and making a second line
+and another button (`more.svg`) for making the item taller and making a second line
 that contains the other buttons appear in the item.
 The buttons in the second line are icons only just like the buttons in the first line,
 and they should be aligned to the right.
@@ -1121,6 +1198,7 @@
 Every snappee has a button for moving up (`up.svg`) and a button for moving down (`down.svg`).
 These buttons are used for changing the order of the snappees in the snappees panel.
 Reordering does not change snappees ID number.
+Besides using the buttons, the user can also use drag-and-drop to order the items.
 
 Every snappee has a button for editing parameters (`edit.svg`).
 Clicking the button is equivalent to double clicking the snappee item.
@@ -1135,7 +1213,7 @@
 
 All these buttons except activating/deactivating are hidden by default.
 For each item, there is the activating/deactivating button,
-and another button for making the item taller and making a second line
+and another button (`more.svg`) for making the item taller and making a second line
 that contains the other buttons appear in the item.
 The buttons in the second line are icons only just like the buttons in the first line,
 and they should be aligned to the right.
@@ -1175,6 +1253,7 @@
 Every clip has two buttons for moving up (`up.svg`) and down (`down.svg`)
 for reordering the items in the clips panel.
 The order does not really have any effect.
+Besides using the buttons, the user can also use drag-and-drop to order the items.
 
 Every clip has an edit button (`edit.svg`).
 Clicking it shows a popup form to rename it.
@@ -1184,7 +1263,7 @@
 
 All these buttons except pasting are hidden by default.
 For each item, there is the pasting button,
-and another button for making the item taller and making a second line
+and another button (`more.svg`) for making the item taller and making a second line
 that contains the other buttons appear in the item.
 The buttons in the second line are icons only just like the buttons in the first line,
 and they should be aligned to the right.
@@ -1223,7 +1302,7 @@
 The current time is always put at the same height near the bottom (the distance to the bottom is 1/4 of the height) of the scroll view
 no matter what the current time is
 so that the events appear scrolling vertically as the current time changes.
-For movable events with durations (`hold` and `bgNote`),
+For movable perdurant events (`hold` and `bgNote`),
 vertical tails are shown to indicate their durations, similarly to the duration tails in the channels in the timeline.
 
 Events in inactive channels are invisible in the scroll view.
@@ -1504,6 +1583,7 @@
 - <u>S</u>nappee
 - T<u>r</u>ansform
 - <u>M</u>usic
+- V<u>i</u>ew
 - M<u>a</u>cros
 - <u>H</u>elp
 
@@ -1535,6 +1615,7 @@
 - (separator)
 - Set music...
 - Set background...
+- Edit level readme...
 - (separator)
 - Open project folder in explorer
 - (separator)
@@ -1698,6 +1779,7 @@
 
 Ask the user to select a file in the local filesystem.
 Acceptable files are JSON files, .ssc files, and Lyrica charts (.txt).
+The same operation can also be done by dragging and dropping a supported file into the interface from file manager.
 For any type of file, if sviber is in NW.js app and a project is currently open,
 open a popup form for the user to confirm whether he wants to add the imported chart to the project or not.
 
@@ -1756,13 +1838,13 @@
    not deleted from the chart.
 2. If the first event is not a placeholder,
    add a placeholder event at the beginning that have the same position and time as the first event.
-3. Repeatedly delete the first event of a placeholder until the second event is not a placeholder or the second event does not exist.
+3. Repeatedly delete the first event until the second event is not a placeholder or the second event does not exist.
    In the latter case, stop the processing of this tip point chain and go to process the next one.
 4. Delete all placeholder events except the first one.
-5. Find the first channel that does not have any event after (inclusive) the second event in the chain
+5. Find the first tip point track that does not have any event after (inclusive) the second event in the chain
    and before (inclusive) the last event in the chain.
-   If no such channel is found, create a new channel.
-   Then, put all events in the chain except the first one into the found channel.
+   If no such tip point track is found, create a new tip point track.
+   Then, put all events in the chain except the first one into the found tip point track.
 6. If there are only one non-placeholder event,
    set its tip point spawn type to "drop".
    Otherwise, set the tip point spawn type of the first non-placeholder event to "chain",
@@ -1771,6 +1853,9 @@
    according to the position and time of the placeholder event relative to it.
    The spawn position type is relative (i.e., set position in distance and direction),
    and the spawn time type is in seconds.
+
+After constructing all the tip point tracks, rearrange them into channels with tip point switches
+so that the ordering of simultaneous events in different tip point tracks is consistent with the constructed channels.
 
 When handling a Lyrica chart, refer to [Lyrica chart format](#lyrica-chart-format).
 After the user provides the file,
@@ -1801,12 +1886,18 @@
 #### Set music..., Set background...
 
 These two options open a file dialogue for the user to select an audio or image file as the music or background.
+The same operation can also be done by dragging and dropping a supported file into the interface from file manager.
 The audio file is decoded using [audio-decode](https://github.com/audiojs/audio-decode).
 
 If a project is currently open, the audio or image file is copied to the project folder.
 
 This operation involves async tasks.
 Put a toast message after it completes.
+
+#### Edit level readme...
+
+Open the [readme editor](#readme-editor).
+Grayed out if there is no currently open project.
 
 #### Save
 
@@ -1921,24 +2012,7 @@
 
 #### Preferences...
 
-Open a popup form for editing sviber preferences.
-The preferences are stored in `localStorage`.
-It has the following fields:
-
-- Note speed: the same option as `speed` in Sunniesnow, controlling how long the active phases of note animations are.
-  The default value is the same as the default value in Sunniesnow.
-- SE volume: control volume of note SE, bg note SE, and metronome; max is 2, and default is 1. Use an `<input type="range">` and an `<output>`.
-- Music volume: control music volume; max is 2, and default is 1. Use an `<input type="range">` and an `<output>`.
-- Theme: choose between light theme and dark theme. The default value depends on the system.
-- Auto-save interval: number in seconds to specify the interval between auto-saves.
-  Setting to zero disables auto-saves altogether.
-- Live hosting address: a string in the format of `${host}:${port}`
-  to set the bind host and port for [live hosting](#live-hosting).
-  It is `0.0.0.0:8011` by default.
-- Live reload port: a port number for the live reload port for
-  [live hosting](#live-hosting). It is `31108` by default.
-- Language: interface language. The user can select one among all languages mentioned in [internationalization](#internationalization).
-  The default value depends on the system.
+Open a popup form for editing sviber preferences. See [editor preferences](#editor-preferences).
 
 This operation does not make an item in the history panel
 because it does not change the chart/project but changes global editor state.
@@ -1957,8 +2031,9 @@
 - (separator)
 - Select all (<kbd>Ctrl</kbd>+<kbd>A</kbd>)
 - Select channel (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd>)
-- Select none (<kbd>Ctrl</kbd>+<kbd>D</kbd>)
+- Select none (<kbd>X</kbd>)
 - Select attached events
+- Select events at current time (<kbd>Z</kbd>)
 - Select by filter... (<kbd>Ctrl</kbd>+<kbd>F</kbd>)
 - (separator)
 - Delete (<kbd>Del</kbd>)
@@ -2051,6 +2126,10 @@
 
 Select only and all events attached to the snappee selected in the snappees panel.
 Grayed out if no snappee is selected in the snappees panel.
+
+#### Select events at current time
+
+Select all events whose times are the current time.
 
 #### Select by filter...
 
@@ -2274,6 +2353,8 @@
 - Unlock (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>)
 - (separator)
 - Fill curve with drag notes
+- (separator)
+- Bulk edit texts...
 
 #### Tap, Hold, Drag, Flick, Bg note
 
@@ -2300,6 +2381,16 @@
 After placing the event, the current selection is updated to contain only this new event.
 The event creation mode does not end after this, and the user can continue placing new events.
 
+In the event creation mode,
+if the music is playing, hitting any letter, number, or symbol key
+(this overrides any keyboard shortcuts on these keys without modification keys)
+(only if no input field is focused)
+or any mouse button (only if the mouse is in the main editor field)
+places the event according to where the mouse is (according to the last paragraph)
+at the subdivion closest to the current time
+(using the current audio context time; never use `Event.timeStamp`)
+plus the [input offset](#input-offset).
+
 Hitting <kbd>Esc</kbd>, triggering most sub-menu items and tool bar items, and modifying events selection using the timeline
 exit the event creation mode.
 Triggering submenu items in the "Music" menu or the corresponding items in the tool bar
@@ -2313,7 +2404,8 @@
 
 For hold and bg note, the default duration is the same as the last time the user creates this type of event.
 If this is the first time the user creates this type of event,
-then the default duration is one beat.
+then the default duration is one beat for hold
+and zero beats for bg note.
 For flick, the default direction is the same as the last time the user creates a flick.
 If this is the first time, the default direction is being upward ($\pi/2$).
 
@@ -2387,6 +2479,58 @@
 with the first event being at the current time,
 the next event's time incrementing by one beat subdivision, etc.
 
+#### Bulk edit texts...
+
+Shows a popup form.
+The popup form has a `<select>` listing all channels
+(by default, the current channel is selected)
+and a `<textarea>` containing the texts of all textable events (except `comment`) in the selected channel.
+The user can edit the texts in the text area,
+and selecting a different channel in the dropdown selection does not discard the previously edited text:
+the edits for different channels will be sumitted altogether when the user submits the form.
+
+To convert all texts of a sequence of textable events into a single string,
+follow this pseudocode:
+
+```js
+function eventTextsToString(events) {
+  const result = [];
+  for (const event of events) {
+    let { text } = event;
+    [['\\', '\\\\'], [' ', '\\s'], ['\n', '\\n'], ['\t', '\\t']].forEach(r => text = text.replaceAll(...r));
+    if (event.isMovable()) {
+      result.push(text, ' ');
+      continue;
+    }
+    if (result.length) {
+      result[result.length - 1] = '\n';
+    }
+    result.push(text, '\n');
+  };
+  result.pop();
+  return result.join('');
+}
+```
+
+To convert a single string into texts for a sequence of textable events,
+use this pseudocode:
+
+```js
+function stringToEventTexts(string, events) {
+  for (const [text, event] of Iterator.zip([string.split(/ |\n|\t/), events], { mode: 'longest' })) {
+    if (!event) {
+      break;
+    }
+    event.text = text ? convertBackslashEscapes(text) : '';
+  }
+}
+```
+
+where `convertBackslashEscapes()` converts `\\`, `\s`, `\n`, and `\t`
+back to the backslash, space, line feed, and tabulation characters.
+
+Texts of all textable evets except `comment` are edited after this operation.
+
 ### Channel
 
 The "Channel" menu item has the following submenu items:
@@ -2396,8 +2540,8 @@
 - Move above within channel (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Up</kbd>)
 - Move below within channel (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Down</kbd>)
 - (separator)
-- Create channel above (<kbd>Insert</kbd>)
-- Create channel below (<kbd>Shift</kbd>+<kbd>Insert</kbd>)
+- Create channel above (<kbd>Insert</kbd>) (`../maker/svg/icons/create-channel-above.svg`)
+- Create channel below (<kbd>Shift</kbd>+<kbd>Insert</kbd>) (`../maker/svg/icons/create-channel-below.svg`)
 - (separator)
 - Deactivate channel (<kbd>Ctrl</kbd>+<kbd>K</kbd>)
 - Activate all channels (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>K</kbd>)
@@ -2405,10 +2549,12 @@
 - Hide channel (<kbd>Ctrl</kbd>+<kbd>J</kbd>)
 - Show all channels (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>J</kbd>)
 - (separator)
-- Delete channel
+- Delete channel (`../maker/svg/icons/delete-channel.svg`)
 - (separator)
 - Move channel up (<kbd>Ctrl</kbd>+<kbd>Up</kbd>)
 - Move channel down (<kbd>Ctrl</kbd>+<kbd>Down</kbd>)
+- (separator)
+- Tip point switch... (<kbd>I</kbd>) (`tip-point-switch.svg`)
 
 #### Move to channel above, Move to channel below
 
@@ -2466,6 +2612,24 @@
 Move the current channel up or down to change the order channels.
 The item "Move channel up" is grayed out if the current channel is the uppermost channel.
 The item "Move channel down" is grayed out if the current channel is the lowermost channel.
+
+#### Tip point switch
+
+Show a popup form to edit, create, or delete a tip point switch at the current time.
+The aim of the popup form is for the user to input the permutation function $\pi$ for the tip point switch
+(see the [definition](#tip-point-switch-and-tip-point-track)).
+
+The popup form consists of two columns.
+Each column consists of the names of all channels in the chart.
+The left column is not editable.
+The right column is editable: each item in the right column has a button for moving down and a button for moving up,
+and the user can click the buttons or use drag-and-drop to reorder the items in the right column.
+The channel pair in each row gives a mapping relation of the permutation.
+
+Besides the usual confirmation and cancelation button,
+there is also a deletion button.
+Clicking the deletion button is equivalent to confirming after setting the permutation to an identity function,
+which deletes the tip point switch.
 
 ### Snappee
 
@@ -2916,11 +3080,13 @@
 However, all the submenu items in "Music" menu should still be enabled while music is playing.
 In other words, the user can seek forward or backward
 and set the playback rate while the music is playing.
-Also, the editor functions that neither rely on quantized current time (e.g., creating events),
+Also, the editor functions that neither rely on quantized current time (e.g., adding a bar line),
 nor open popup forms (e.g., creating meshes),
 nor enter dedicated editing modes (e.g., pen),
 should also still be available,
 such as saving, undoing and redoing, activating and deactivating snappees, creating and deleting channels, etc.
+As an exception, if the music is playing in event creation mode,
+the user can still place events ([see](#tap-hold-drag-flick-bg-note)).
 
 If there are two A-B loop marks, the current time changes to the A mark when it reaches the B mark while the music is playing.
 The sudden change in the current time must be perfect:
@@ -3033,6 +3199,23 @@
 Change the visible range of the timeline.
 This is equivalent to use mouse scroll wheel while holding <kbd>Ctrl</kbd>.
 
+### View
+
+The "View" menu has the following submenu items:
+
+- Toggle timeline and status panel
+- Toggle left side panels
+- Toggle right side panels
+- (separator)
+- Reset layout dimensions
+
+The operations for toggling the panels
+are equivalent to clicking the buttons for showing and hiding those panels
+near the edges of the main editor field.
+
+Reseting layout dimensions resets the values for the side panel widths and heights
+and the channels height in the editor preferences to default values.
+
 ### Macros
 
 The "Macros" menu has the following submenu items:
@@ -3079,6 +3262,12 @@
 It should also has basic dark theme and light theme support,
 automatically chosen with `prefers-color-scheme`
 while also being able to be manually chosen.
+
+Every time the documentation opens, it is shown in the
+[language set in editor preferences](#language).
+There is also a widget in the documentation page that can be used to change the language,
+but this change does not persist, and the documentation will still show in the editor language
+the next time the user opens it.
 
 #### Keyboard shortcuts
 
@@ -3143,6 +3332,7 @@
 - Create channel above (Channels)
 - Create channel below (Channels)
 - Delete channel (Channels)
+- Tip point switch... (Channels)
 - (separator)
 - Rectangular mesh... (Snappee)
 - Radial mesh... (Snappee)
@@ -3186,10 +3376,19 @@
 the end time cannot be set to be equal to the time, either.
 Whenever the user changes one of the duration and the end time,
 the other changes accordingly.
-When the user selects a bunch of events with durations and changes their end time altogether,
+When the user selects a bunch of perdurant events and changes their end times altogether,
 all of them change their durations
 to make their end times align to the same time specified by the user.
 Note that the end time is not present in the actual [chart file](#events-field).
+
+Here is a glossary of event type categories used elsewhere in the prompt:
+
+- Movable events: `tap`, `drag`, `hold`, `flick`, `bgNote`, `group`.
+- Tip-pointable events: `tap`, `drag`, `hold`, `flick`.
+- Notes: `tap`, `drag`, `hold`, `flick`.
+- Background events: `bgNote`, `bigText`, `grid`, `hexagon`, `checkerboard`, `diamondGrid`, `pentagon`, `turntable`, `hexagram`.
+- Textable events: `tap`, `hold`, `flick`, `bgNote`, `bigText`, `comment`.
+- Perdurant events: `hold` ,`bgNote`, `bigText`, `grid`, `hexagon`, `checkerboard`, `diamondGrid`, `pentagon`, `turntable`, `hexagram`, `comment`.
 
 ### Tap
 
@@ -3296,6 +3495,47 @@
 When saving as Sunniesnow chart,
 a placeholder event is generated for spawning the tip point.
 
+### Tip point switch and tip point track
+
+This section introduces the definition of tip point switches and tip point tracks.
+
+Some notations about sequences.
+If $S_1$ and $S_2$ are finite sequences, denote $S_1\oplus S_2$ as their concatenation.
+Abuse the notation of symbol "$\in$" to denote membership relation for sequences.
+Abuse the notation of set comprehension to filter a sequence to get a subsequence:
+for example, for a sequence $S$, the notation $\{x\in S\,|\,\varphi(x)\}$
+means a subsequence of $S$ whose elements are those in $S$ that satisfy $\varphi(\cdot)$.
+For a sequence $S$, denote $|S|$ as its number of elements,
+and denote $S[i]$ as its $i$th element (zero-based).
+Denote $\bigodot_{i=1}^n f_i$ as the right-to-left function composition:
+$\left(\bigodot_{i=1}^n f_i\right)(x)=f_n\circ\cdots\circ f_1(x)$;
+specially, when the upper bound is smaller than the lower bound for the iteration variable,
+the result is the identity function.
+
+Denote the set of all channels as $\mathscr C$,
+and a channel $C\in\mathscr C$ is mathematically a sequence of events
+(for this section, we only consider tip-pointable events,
+and an inactive channel is regarded as an empty sequence).
+For an event $E$, denote $t(E)\in\mathbb Q$ as the time (in beats) of the event.
+The ordering of events in $C$ is compatible with their time ordering:
+if $E_1,E_2\in C$ and $E_1$ is ordered before $E_2$, then $t(E_1)\le t(E_2)$.
+For simultaneous events in the same channel,
+the event stacked at the top as appearing in the timeline is ordered before the simultaneous event stacked at the bottom.
+
+A tip point switch is defined as a tuple $(\tau,\pi)$,
+where $\tau\in\mathbb Q$ is the time of the tip point switch,
+and $\pi:\mathscr C\to\mathscr C$ is a permutation.
+A sviber chart can have many tip point switches, but it cannot have two tip point switches whose times are the same.
+The sequence of all tip point switches ordered by their times is denoted as $\mathscr S$.
+For each $S\in\mathscr S$, denote $\tau(S)$ as its time
+and $\pi_S$ as its permutation over channels.
+
+For each $C\in\mathscr C$, define a sequence $T(C)$ of events called the tip point track starting at $C$ as follows:
+$$T(C)=\bigoplus_{i=0}^{|\mathscr S|}\left\{E\in\left(\bigodot_{j=0}^{i-1}\pi_{\mathscr S[j]}\right)(C)\,\middle|\,\tau_{i-1}\le t(E)<\tau_i\right\},$$
+where $\tau_{-1}=-\infty$, $\tau_{|\mathscr S|}=+\infty$,
+and $\tau_i=\tau(\mathscr S[i])$ for $0\le i<|\mathscr S|$.
+It is obvious that each event is a member of exactly one tip point track among $T(\mathscr C)$.
+
 ### Tip point spawn type
 
 The tip point spawn type is one of "inherit", "chain", "drop", and "none".
@@ -3303,18 +3543,18 @@
 
 If a tip-pointable event has the inherit spawn type, then:
 
-- If the previous tip-pointable event in its channel has the chain spawn type,
+- If the previous tip-pointable event in its tip point track has the chain spawn type,
   then this event is connected by the same tip point as the previous tip-pointable event.
-- If the previous tip-pointable event in its channel has the drop spawn type,
+- If the previous tip-pointable event in its tip point track has the drop spawn type,
   then this event is connected by a new tip point with the same spawn parameters (position and time) as the previous tip-pointable event.
-- If this event is the first tip-pointable event in the channel
+- If this event is the first tip-pointable event in the tip point track
   or if the previous tip-pointable event has the none spawn type,
   then this event is not connected by a tip point.
 
-If the next tip-pointable event in the channel also has the inherit spawn type,
-then it sees the tip point spawn type of this event as the same spawn type of the previous tip-pointable event in the channel.
-
-For example, suppose that the tip-pointable events in a channel have the following spawn types:
+If the next tip-pointable event in the tip point track also has the inherit spawn type,
+then it sees the tip point spawn type of this event as the same spawn type of the previous tip-pointable event in the tip point track.
+
+For example, suppose that the tip-pointable events in a tip point track have the following spawn types:
 (1) inherit, (2) chain, (3) inherit, (4) inherit, (5) drop, (6) inherit, (7) inherit, (8) none, (9) inherit.
 Then, the events 1, 8, and 9 are not connected by tip points.
 The events 2, 3, and 4 are connected by the same tip point.
@@ -3323,10 +3563,6 @@
 
 The spawn types are inspired by [sscharter](https://github.com/sunniesnow/sscharter).
 Read its source code for more information.
-
-There is the edge case of multiple simultaneous tip-pointable events being in the same channel,
-the order of events corresponds to the stacking order in channels in the timeline.
-Events stacked at the top are before events stacked at the bottom.
 
 ### Spawn position
 
@@ -3417,14 +3653,8 @@
 
 ### Out-of-boundary notes
 
-This check checks that all notes (`tap`, `hold`, `flick`, `drag`) are within the chart boundary.
-There is a small tolerance for floating point errors.
-When a violation is clicked,
-select the out-of-bound event.
-
-### Out-of-boundary bg notes
-
-This check checks that all `bgNote` events are within the chart boundary.
+This check checks that all notes (`tap`, `hold`, `flick`, `drag`) and `bgNote` events are within the chart boundary.
+It has a boolean parameter that is true by default, and when it is false, `bgNote` events are excluded from this check.
 There is a small tolerance for floating point errors.
 When a violation is clicked,
 select the out-of-bound event.
@@ -3473,10 +3703,22 @@
 
 ### Multi-character CJK texts
 
-This check checks that, for each movable event that may have texts
+This check checks that, for each movable textable event
 (`tap`, `hold`, `flick`, `bgNote`),
 if it contains a CJK character, its full text is only a CJK character.
 For example, "啊a" and "啊啊" are violations, but "啊" and "aa" are not violations.
+When a violation is clicked, the event with violating texts is selected.
+
+### Bad characters
+
+This check checks that there are no bad characters in event texts.
+It does not check `comment` events.
+Bad characters include:
+
+- Special ASCII characters including tabulation, line feed, carriage return, etc.
+- Special characters that manipulates layout, such as RTL override.
+- For movable events, whitespace characters are also bad.
+
 When a violation is clicked, the event with violating texts is selected.
 
 ### Events outside music
@@ -3523,6 +3765,31 @@
 - A `flick` event and a `tap` event that are simultaneous and have the same position,
   where the `tap` event is drawn behind the `flick` event.
 
+### Drifting tip points
+
+This check checks that two consecutive events that one tip point connects to must be at most $T$ seconds apart
+and that the spawn time of a tip point must be at most $T$ seconds before the first event it connects to,
+where $T$ is a customizable parameter whose default value is 2.
+When a violation is clicked, the event to which a tip point drifts for a long time before reaching is selected.
+
+### Blocked texts
+
+This check checks that texts on movable textable events (`tap`, `flick`, `hold`, `bgNote`) are visible.
+For an event $E$, denote its start time as $t_0(E)$, and its end time as $t_1(E)$
+(if $E$ is not perdurant, define $t_1(E)=t_0(E)$).
+A violating event is a movable textable event $E$ meeting both the following criteria:
+
+- Its text is not empty.
+- For any time $t$ such that $t_0(E)\le t\le t_1(E)$, there exists a movable textable event $E'$
+  (not necessarily having non-empty text) such that all the following conditions are met:
+  - $t_0(E')\le t\le t_1(E')$.
+  - The drawing order is that $E'$ is drawn above $E$.
+  - Either of the following conditions are met (with small tolerance for floating point error):
+    - The spatial positions of $E$ and $E'$ are the same.
+    - $E'$ is a `hold` event, and the spatial distance between $E$ and $E'$ is not larger than 6.25.
+
+When a violation is clicked, the violating event is selected.
+
 ## Live hosting
 
 Live hosting is the feature that sets up a server for Sunniesnow to connect to
@@ -3554,10 +3821,210 @@
 
 When the live hosting server starts, put a toast message containing information about
 the full URL to the hosted `.ssc` file and the live reload port.
+The host in the URL should be the same as the listening host (even if it is `0.0.0.0`).
 When an sscharter client connects or disconnects,
 put a toast message containing the IP address of the client.
 When there is an error about the live hosting, put a toast message about the error.
 When the live hosting server ends, put a toast message saying that.
+
+## Editor preferences
+
+The editor preferences are stored in `localStorage`.
+
+### Note speed
+
+It is similar to the option `speed` in Sunniesnow, controlling how long the active phases of note animations are.
+The default value is the same as the default value in Sunniesnow.
+
+### Input offset
+
+The number of seconds for the input offset of time used in [event creation mode](#tap-hold-drag-flick-bg-note).
+
+In the popup form for editing editor preferences,
+additionally put a button near the input field for this setting saying "adjust".
+After clicking the button, disable all input fields in the popup form and start playing a 120 BPM metronome.
+When the user hits any letter, symbol, or number key,
+subtract the audio context time of the closest metronome beat
+from the current audio context time to get a datum
+(never use `Event.timeStamp` as it is inaccurate in most browsers,
+but this setting requires millisecond-level accuracy).
+As the user does this, replace the value of the number input with the average value of the data.
+When the user hits <kbd>Space</kbd>, <kbd>Enter</kbd>, or clicks the button again,
+go back to the normal state of editing the popup form with input fields re-enabled.
+When the user hits <kbd>Esc</kbd>,
+go back to the normal state of editing the popup form with input fields re-eanbled
+and additionally restore the value for the input offset back to what it was before clicking the button.
+
+### Visible channels
+
+The number of visible channels in the timeline.
+The default is 3.
+
+### Event icon size
+
+Changes the size of event icons in the timeline and the scroll view.
+The default is 8 (radius in pixels).
+
+This also proportionally affects the following dimensions in the timeline and/or the scroll view:
+
+- the thicknesses of various lines indicating information about tip points,
+- the distance between stacked event icons for simultaneous events in the same channel,
+- the font sizes of texts shown on the event icons and the duration tails,
+-  the size of the tip points.
+
+### SE volume
+
+Volume of note SE, bg note SE, and metronome; max is 2, and default is 1.
+In the popup form for changing editor preferences,
+use an `<input type="range">` and an `<output>`.
+
+### Music volume
+
+Music volume; max is 2, and default is 1.
+In the popup form for changing editor preferences,
+use an `<input type="range">` and an `<output>`.
+
+### Theme
+
+Choose between following system, light theme, and dark theme.
+The default value is following system.
+
+### Auto-save interval
+
+Number in seconds to specify the interval between auto-saves.
+Setting to zero disables auto-saves altogether.
+
+### Live hosting address
+
+a string in the format of `${host}:${port}`
+to set the bind host and port for [live hosting](#live-hosting).
+It is `0.0.0.0:8011` by default.
+
+### Live reload port
+
+a port number for the live reload port for
+[live hosting](#live-hosting). It is `31108` by default.
+
+### Layout information
+
+Dimensions of the layout.
+The popup form for editing editor preferences should not support editing these settings.
+Data include:
+- the width fraction of right side panels,
+- the width fraction of left side panels,
+- the width fraction of the stauts panel,
+- the height fraction of the inspection panel (and other panels sharing the same space),
+- the height of a channel in the timeline,
+- whether the top panels are hidden,
+- whether the left panels are hidden,
+- whether the right panels are hidden,
+- the width fraction of side bar in readme editor,
+- the width fraciton of the preview panel in readme editor,
+- whether the preview panel in the readme editor is hidden,
+- the width fraction of side bar in macros editor,
+- the height fraction of console in macros editor,
+- whether the console in macros editor is hidden.
+
+### Language
+
+Interface language. The user can select one among all languages mentioned in [internationalization](#internationalization).
+The default value depends on the system.
+
+The same setting controls not just the editor interface language,
+but also controls the languages on all interfaces,
+including the [macros](#macros-interface), [readme editor](#readme-editor), and [help documentation](#documentation).
+
+## Readme editor
+
+The readme editor is a separate webpage from sviber.
+Its UI contains a menu at the top.
+Below the menu, the left is a side bar containing a list of readme files,
+and the right is a full-featured code editor and optionally a preview panel.
+The keyboard shortcuts and the undo history of the readme editor is unrelated to the main sviber interface.
+
+Each readme file is simply a text file whose filename matches `Sunniesnow.Utils.needsDisplayTextFile`
+(see `../game-unstable/js/utils/Utils.js`),
+saved directly in the project folder.
+They will be included as is in the exported Sunniesnow level file.
+
+The user can click and drag between the side bar and the code editor to resize them.
+The user can click and drag between the code editor and the preview panel to resize them.
+The width fractions of the side bar and the preview panel are recorded in [editor preferences](#layout-information).
+
+### Readme editor menu
+
+The menu has the following items:
+
+- <u>F</u>ile
+- <u>E</u>dit
+- <u>V</u>iew
+
+The "File" menu has the following submenu items:
+
+- New... (<kbd>Ctrl</kbd>+<kbd>N</kbd>)
+- Save (<kbd>Ctrl</kbd>+<kbd>S</kbd>)
+- Rename...
+- Import...
+- Export...
+- Delete...
+
+The "New..." action opens a popup form to ask the user what the filename of the new readme file is.
+By default it is `README.md`, but if that file already exists, by default it is empty.
+Only a filename matching `Sunniesnow.Utils.needsDisplayTextFile` is an acceptable input.
+
+The "Save" action saves the currently open file to local filesystem.
+
+The "Rename..." action renames the currently open file.
+Only a filename matching `Sunniesnow.Utils.needsDisplayTextFile` is an acceptable input.
+
+The "Import..." action opens a file dialogue for user to choose a file from local filesystem,
+and then opens a popup form to ask the user what the name of the new file is.
+
+The "Export..." action opens a file dialogue for user to select a location
+to save the currently open file to a local file path.
+
+The "Edit" menu has the following submenu items:
+
+- Undo (<kbd>Ctrl</kbd>+<kbd>Z</kbd>)
+- Redo (<kbd>Ctrl</kbd>+<kbd>Y</kbd>)
+- (separator)
+- Cut (<kbd>Ctrl</kbd>+<kbd>X</kbd>)
+- Copy (<kbd>Ctrl</kbd>+<kbd>C</kbd>)
+- Paste (<kbd>Ctrl</kbd>+<kbd>V</kbd>)
+
+These are basic actions that are implemented in the code editor.
+
+The "View" menu has the following submenu items:
+
+- Toggle preview (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>)
+- Reset to default
+
+The "Toggle preview" action toggles the visiblity of the preview panel to the right of the code editor.
+It grays out if the currently open file is not in Markdown.
+The preview panel is visible by default.
+
+The "Reset to default" action resets the layout in the readme editor.
+
+### Readme editor side bar
+
+The side bar contains a list of readme files in the project.
+The text in each item is the filename of the file,
+prepended with an asterisk if there is unsaved change in this file.
+The user can open a file by clicking in the list.
+Opening another file while there is currently unsaved change does not discard the change,
+and the user can go back to the previous file and save.
+
+### Readme code editor
+
+Use Monaco to power an editor that supports highlighting for Markdown.
+The editor must be loaded in the correct language for [internationalization](#internationalization).
+
+### Readme preview panel
+
+If the preview panel is not toggled off and the currently open file is in Markdown,
+it shows to the right of the code editor.
+Use `marked` and `dompurify` (the same libraries used by Sunniesnow) to render the preview.
+The preview updates on live as the user edits the file.
 
 ## Macros interface
 
@@ -3579,6 +4046,10 @@
 and project macros are stored as `.js` or `.rb` files in the project folder.
 In a web browser, only global macros can be used.
 
+The user can click and drag between the side bar and the code editor to resize them.
+The user can click and drag between the console and the side bar or code editor to resize them.
+The width fraction of the side bar and the height fraction of the console are recorded in [editor preferences](#layout-information).
+
 ### Macros side bar
 
 The macros side bar has two lists of macros,
@@ -3592,6 +4063,7 @@
 
 - <u>F</u>ile
 - <u>E</u>dit
+- <u>V</u>iew
 - <u>R</u>un
 
 The "File" menu has the following submenu items:
@@ -3622,6 +4094,7 @@
 and whether it is a JavaScript macro or a Ruby macro.
 Create a macro accordingly and
 make the contents of the uploaded file as the contents of the new macro.
+The same operation can also be done by dragging and dropping a file into the macros interface from file manager.
 
 The "Export..." action opens a file dialogue for user to select a location to save
 the currently open macro to a local file path as a `.js` or `.rb` file.
@@ -3639,6 +4112,18 @@
 - Paste (<kbd>Ctrl</kbd>+<kbd>V</kbd>)
 
 These are basic actions that are implemented in the code editor.
+
+The "View" menu has the following submenu items:
+
+- Toggle console
+- Reset to default
+
+The "Toggle console" action toggles the visibility of the console.
+
+The "Reset to default" action resets the layout information of the macros interface,
+including the width fraction of the side bar,
+the height fraction of the console,
+and whether the console is hidden.
 
 The "Run" menu has the following submenu items:
 
@@ -3830,7 +4315,7 @@
   `#have_text?`, `#tip_pointable?`, `#group?`.
 - `#location`, `#location=`: only valid for movable events. Specially,
   this moves all contained events for `group` events.
-- `#text`, `#text=`: only valid for events with texts.
+- `#text`, `#text=`: only valid for textable events.
 - `#anchor`, `#anchor=`: only valid in `group` events, setting location without moving contained events.
 - `#tip_point`, `#tip_point=`: getter and setter, accepting `TipPoint` object; only valid for tip-pointable events.
 - `#angle`, `#angle=`: only valid for `flick` events.
@@ -3987,6 +4472,7 @@
 
 - `id`: an integer ID number. It increments starting from 0, to distinguish different channels.
 - `name`: string, the user-set name.
+- `tipPointSwitches`: array.
 - `active`: boolean, whether it is active.
 - `hidden`: boolean, whether it is hidden.
 - `expanded`: boolean, whether the second line of buttons in the panel is shown.
@@ -3994,6 +4480,16 @@
 When moving channels around (e.g., [move channel up and move channel down](#move-channel-up-move-channel-down)),
 the ID number of the channels do not change,
 but they only change order in this array.
+
+Each element in the `tipPointSwitches` array is an object with the following keys:
+
+- `time`: rational 3-tuple representing time in beats.
+- `target`: integer, the channel ID of the image of this channel under the permutation function of the tip point switch at this time.
+
+Only those tip point switches whose `target` in this object would be different from the ID of this channel
+need to be included in this array.
+For example, if a tip point switch permutates channels 1, 2, and 3 into 1, 3, and 2 respectively,
+then this tip point switch only needs to be saved in the data of channels 2 and 3 but not in the data of channel 1.
 
 ### `events` field
 
@@ -4021,13 +4517,13 @@
 - `snapPoint`: either one number `i` if the snappee is a curve,
   or two numbers `[i,j]` if the snappee is a mesh; present if `attached` is true.
 
-Events with durations (`hold`, `bgNote`, `bigText`,
+Perdurant events (`hold`, `bgNote`, `bigText`,
 `grid`, `hexagon`, `checkerboard`, `diamondGrid`, `pentagon`, `turntable`, `hexagram`, `comment`)
 have these fields:
 
 - `duration`: rational 3-tuple denoting the duration in beats.
 
-Events with texts (`tap`, `hold`, `flick`, `bgNote`, `bigText`, `comment`) have these fields:
+Textable events (`tap`, `hold`, `flick`, `bgNote`, `bigText`, `comment`) have these fields:
 
 - `text`: arbitrary string for the text.
 
@@ -4162,8 +4658,7 @@
 - `emptyMetadata`
 - `irregularDifficulty`
 - `requiredFingers`: extra field `fingers`.
-- `outOfBoundaryNotes`
-- `outOfBoundaryBgNotes`
+- `outOfBoundaryNotes`: extra field `bgNotes`.
 - `shortHold`: extra field `seconds`.
 - `shortBgPattern`: extra field `seconds`.
 - `shortTipPoint`: extra field `seconds`.
@@ -4173,6 +4668,7 @@
 - `eventsOutsideMusic`
 - `dragScreening`: extra field `seconds` and `distance`.
 - `simultaneousOverlappingNotes`: extra field `invisibleOnly`.
+- `driftingTipPoint`: extra field `seconds`.
 
 ## Lyrica chart format
 
@@ -4484,7 +4980,7 @@
 The internationalization data (except the main text of the help manual) need to be put in JSON files in the `json` dir,
 not hardcoded in JavaScript or HTML so as to make translation easier.
 This applies to not just the webpage for the editor
-but also applies to the JavaScript license page, the help documentation, etc.
+but also applies to the JavaScript license page, the non-main text part of help documentation, etc.
 For the main text of the help manual, the body texts for different languages are put in different files,
 not including the other parts of the full HTML page (e.g., `<head>`).
 Use JavaScript to dynamically fetch and replace the body texts.
@@ -4505,6 +5001,16 @@
 scroll view is "下落式预览" in Chinese;
 tap, drag, hold, and flick are their English words as is for other languages.
 
+### Windows
+
+The main editor, the macros editor, the readme editor, and the help manual are separate webpages.
+The interfaces other than the main editor are handled differently in the browser and the NW.js app:
+
+- In the browser webpage, the help manual is opened in a new tab,
+  and the others are opened in real popups.
+- In the NW.js app, all of them are opened in real popups,
+  and they should have their window sizes and positions remembered.
+
 ### Auto-save
 
 By default, every 120 seconds, automatically save the chart currently being edited to `localStorage`
@@ -4575,6 +5081,12 @@
 Range input for integer parameters (for creating and editing parametric snappees) consists of two integer number inputs.
 There should also be an accompanying checkbox to choose whether the upper bound is inclusive or exclusive.
 It should be exclusive by default.
+
+Number input for time in unit of seconds or miliseconds
+should be followed by "s" or "ms" to indicate the time unit.
+The label text of the input should not mention what unit this input field is in.
+For example, instead of "Offset (in seconds): [input]",
+use "Offset: [input]s".f
 
 ### CI/CD
 
@@ -4657,4 +5169,6 @@
   Devise proper CLI flags for the parameters.
 
 Also add help message when using `--help`.
+Also add version information when using `--version`.
+
 When CLI flags are provided, do not launch the main GUI.
`
