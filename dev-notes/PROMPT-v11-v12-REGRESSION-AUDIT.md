# PROMPT v11 -> v12 Regression Audit

日期：2026-08-21
目标发行：`v0.3.1`
审计范围：逐行阅读 `PROMPT-v11.md` 与 `PROMPT-v12.md`，对 v12 相对 v11 的新增和变更逐项核对实现，并回归受影响的旧功能。

## 审计结论

v12 的主要变化已经落到编辑器、文件格式、渲染、交互、NW.js 实时托管和帮助文档。时间轴通道滚动位置也已经实现：它保存在 `sviber.editor.timelineChannelOffset`，加载时恢复并按可见通道范围夹紧；滚动条、`Shift`+滚轮和自动显示当前通道都会更新该字段。

本轮 v0.3.1 审计额外修复了以下回归风险：

- 吸附距离从 v11 的 `6.125` 校正为 v12 要求的 `6.25`。
- Sunniesnow 导出只包含启用通道，并按通道顺序、时间和时间轴堆叠顺序排列；Tip point placeholder 仍保持同一排序规则。
- 系统剪贴板现在保存完整的 v1 事件数据，而不是只保存 `events` 数组；普通旧数组剪贴板仍可粘贴。
- Paste options 的 `duplicateSnappees` 选项和嵌套 group 中的 channel/snappee 引用都正确重映射。
- 只读模式保留通道和吸附器的启用/停用，以及难度切换；其他谱面变更仍被阻止。
- 文件格式规范字段统一为 `allowOutOfBound`；导入兼容旧的 `allowOutOfBounds`，序列化不再写出旧别名。
- Preferences 迁移会忽略旧的全局 `allowOutOfBounds`，重新保存时不会把已废弃字段写回 localStorage。
- 自由变换拒绝退化边界框，并补齐锚点、四条边缘手柄、`Ctrl`/`Shift` 缩放和 `Ctrl` 旋转吸附行为。
- 源码组织检查所需的 1000 行上限通过；自由变换新增逻辑拆入 `js/app-free-transform.js`。
- 浏览器回归同步覆盖 v12 的只读例外：难度切换和通道/吸附器启停保持可用；自由变换测试从锚点旁的自由区域启动。

## v11 -> v12 差异核对

| v12 差异 | 实现位置 | 回归覆盖 |
| --- | --- | --- |
| 选区只作用于可移动事件，group 可递归选择 | `js/render/chart-index.js`, `js/render/stage-interactions.js`, `js/render/timeline.js`, `js/app-event-editing.js` | `nested group selection enters one level at a time`; `render index separates inactive gameplay from complete timeline and comments`; 浏览器实际框选 |
| group 事件、嵌套 group、稳定递归 ID | `js/core/grouping.js`, `js/core/chart-model.js` | `nested groups keep recursive IDs, bounds, clips, and Sunniesnow export flat`; `removing a channel prunes empty nested groups` |
| Group/Ungroup、递归移动、删除、变换、反转时间和通道操作 | `js/app-history-commands.js`, `js/app-event-editing.js`, `js/app-file-workflows.js` | `tests/v8-features.test.mjs` 变换回归；group round-trip/export；完整 `npm test` |
| Timeline、主编辑区、Scroll view 的分组圈和 group 边界框；anchor 仅限主编辑区 | `js/render/timeline.js`, `js/render/stage-notes.js`, `js/render/scroll-view.js` | v11 渲染索引/Scroll view 回归；`verify:browser` 的画布像素与交互检查 |
| 双击逐层进入 group 临时作用域，作用域自动退出 | `js/render/chart-index.js`, `js/render/stage-interactions.js`, `js/render/timeline.js`, `js/app-event-editing.js` | `nested group selection enters one level at a time` |
| Clips 面板、缩略图、粘贴、重命名、排序、删除和保存 | `index.html`, `js/panels.js`, `js/core/chart-model.js`, `js/app-file-workflows.js` | `nested groups keep recursive IDs, bounds, clips, and Sunniesnow export`; 完整浏览器面板检查 |
| Paste with options：复制 channel/snappee | `js/app-file-workflows.js` | `system event clipboard preserves nested channel and snappee references`；系统剪贴板完整对象、旧数组兼容和嵌套引用重映射 |
| Timing 菜单：偏移、初始 BPM、BPM change、定时 JSON copy/paste | `js/commands.js`, `js/app-event-editing.js`, `js/app-file-workflows.js` | `TimingMap` 全套正负时间/BPM 回归；完整命令面测试 |
| 事件创建工具持续存在；检查器、翻转不退出创建模式 | `js/app-event-editing.js`, `js/app-history-commands.js` | v8/v9/v11 命令与交互测试；浏览器真实 pointer workflow |
| 吸附距离改为 `6.25`，边界使用极小浮点容差 | `js/render/stage-interactions.js`, `js/core/geometry.js` | `snap-to-point uses the v12 6.25 boundary exactly`; `chart-boundary snappee points use only the documented tiny tolerance` |
| 同时刻事件遵循时间轴堆叠顺序，停用 channel 不导出 | `js/core/chart-model.js` | `Sunniesnow export orders active events by channel, time, and timeline stacking`; `comments and channel state round-trip without leaking into Sunniesnow events` |
| Snappee 绘制顺序与 Snappees 面板顺序一致 | `js/render/stage-notes.js`, `js/render/stage-interactions.js` | v11 渲染/真实画布检查 |
| Scroll view 与时间轴使用相同的纵向时间比例，事件层级顺序修正 | `js/render/scroll-view.js`, `js/render/chart-index.js` | v11 Scroll view 手册、render index 和 browser canvas checks |
| 只读例外：通道/snappee 启停和难度 selector 可用 | `js/app-core.js`, `js/app-history-commands.js`, `js/app-chart-tools.js` | `read-only mode keeps channel and snappee activation available but blocks edits`; v11 read-only command policy |
| Editor 状态字段：`timelineChannelOffset`、四个显示开关和 `allowOutOfBound` | `js/core/chart-model.js`, `js/app-core.js`, `js/render/timeline.js` | `timeline channel offset round-trips and clamps to visible channels`; `v12 editor fields use the file-format spelling and preserve legacy imports` |
| 超界许可从全局 Preferences 改为按 difficulty 保存 | `js/app-core.js`, `js/app-file-workflows.js`, `js/core/chart-model.js` | `ChartModel defaults and round-trips the out-of-bounds editor setting`; 旧字段导入和规范字段序列化回归 |
| Free transform 退化边界、anchor、边缘手柄和 modifiers | `js/app-free-transform.js`, `js/app-event-editing.js`, `js/render/stage-interactions.js`, `js/render/stage-notes.js` | `free transform follows v12 degenerate-box and modifier rules`; v8 已有 attached snappee/pen/矩阵变换回归 |
| group anchor 独立移动、子事件保持位置、anchor 吸附 | `js/app-event-editing.js`, `js/render/stage-interactions.js`, `js/render/stage-notes.js` | v12 group selection/transform tests；browser pointer interactions |
| Live hosting HTTP `/sviber.ssc`、sscharter WebSocket 帧和 `chartUpdate` | `js/live-hosting.js`, `js/app-core.js`, `js/app-file-workflows.js` | `live reload uses the sscharter WebSocket handshake contract`；NW.js/browser capability checks |
| Live reload 导出 `sscharter.version = "0.10.1"` | `js/core/chart-model.js`, `js/core/project.js` | live-hosting test；普通导出不带 sscharter 字段的 core/project 回归 |
| Help > Keyboard shortcuts、双语帮助与文件格式说明 | `js/help.js`, `docs/index.html`, `README.md`, `README.zh-CN.md` | `v11 Scroll View, manual, and release notes describe the implemented behavior`；`verify:browser` 中英文手册检查 |
| JSON i18n 文件、PWA shell 和新模块缓存 | `json/i18n.en-US.json`, `json/i18n.zh-CN.json`, `service-worker.js` | `v11 localization is loaded from matching JSON dictionaries`; `v11 UI uses ... PWA caching`; `service-worker.js` 包含 `app-free-transform.js` |
| `clips` 字段、递归 group 文件格式和 Sunniesnow flatten | `js/core/chart-model.js`, `js/core/grouping.js` | group/clips round-trip、旧平面 event JSON 导入、纯 Sunniesnow export 回归 |

## 回归测试结果

### 聚焦测试

以下测试在审计过程中执行并通过：

- `node --test tests/v12-features.test.mjs`：11/11。
- `node --test tests/v12-features.test.mjs tests/core.test.mjs tests/v8-features.test.mjs tests/v9-features.test.mjs tests/v11-features.test.mjs`：84/84。
- `npm run check:size`：通过，所有源码文件不超过 1000 行，SVG 位于规定目录。
- `git diff --check`：通过。

### 每项新增 v12 测试

`tests/v12-features.test.mjs` 当前包含 11 项独立回归：

1. nested group 递归 ID、边界、clips round-trip 和 Sunniesnow flatten。
2. sscharter WebSocket handshake contract。
3. group 选择逐层进入。
4. 删除 channel 后清理空 nested group。
5. `timelineChannelOffset` round-trip 和 visible-channel clamp。
6. `allowOutOfBound` 规范字段、legacy `allowOutOfBounds` 导入兼容。
7. `6.25` 吸附边界的内外两侧。
8. active channel 导出、inactive channel 过滤和 simultaneous stacking。
9. 系统 clipboard 完整数据、嵌套 channel/snappee 引用和 duplication remap。
10. 只读模式下 channel/snappee 启停可用、其他 mutation 被阻止。
11. 退化 free-transform bounds、`Ctrl` rotation 和 `Ctrl` aspect-ratio scale。

浏览器回归脚本另外验证了 Preferences 不再显示超界字段、状态栏超界设置的历史/序列化行为，以及两个难度之间的独立状态。

## 兼容性

- v11 及更早的平面 event JSON 仍作为根事件导入。
- 缺失 `clips` 时按空数组处理。
- 旧的 `editor.allowOutOfBounds` 只在导入时兼容；新保存统一写 `editor.allowOutOfBound`。
- 系统剪贴板的旧数组格式继续可粘贴；v1 完整 clipboard 对象增加 `channels` 和 `snappees`。
- 非 live hosting 导出不写 `sscharter`；只有 NW.js live reload 导出带版本字段。
- Service Worker cache 从 `sviber-v35` 更新为 `sviber-v36`，主 app cachebuster 从 `v25` 更新为 `v26`。

## 发布验证

发布前必须通过以下命令：

```text
npm test
npm run verify:browser
npm run build
git diff --check
```

本轮实际结果：`npm test` 147/147 通过；`npm run verify:browser` 通过，播放和编辑的 100000 事件基准均为 0 掉帧；源码大小检查通过。

构建产物属于 `build/`，由 `.gitignore` 排除，不提交生成目录。最终提交应使用：

```text
fix: complete v11-v12 regression audit
```

并创建 annotated tag `v0.3.1`。不得覆盖已有的 `v0.3.0` tag。

## v0.3.2 交互与分组修复

本轮针对 v0.3.1 使用反馈重新审视了 v11/v12 diff 中的选择、工具栏、分组和快捷键行为。修复内容如下：

### 选择行为

- 新增 `js/render/selection.js`，统一主编辑区、时间轴和 Scroll view 的点击选择模式。
- 普通点击未选事件仍然替换选择；普通点击已经选中的同一事件现在会取消选择。
- `Ctrl` 仍然追加选择，`Alt` 仍然移除选择；两种修饰键优先于普通点击的切换语义。
- 主编辑区的 group anchor 和三个视图中的 group 后代命中都遵循同一套重复点击取消规则；后续按 v12 文件模型校正为时间轴和 Scroll view 不显示 group anchor。
- 拖动与点击分离：已选事件只有在指针未超过拖动阈值时才执行取消，不会因为开始拖动而误取消选择。

### 创建工具

- `toggledCreationMode()` 统一工具栏和快捷键使用的创建模式切换规则。
- 当前 Tap、Hold、Drag、Flick 或 Bg note 工具再次点击时退出创建模式；点击其他事件工具仍会切换到新工具。
- 该行为同步写入 README 和中英文手册，避免帮助文档继续描述为只能由 Escape 退出。

### Group 修复

- `ChartRenderIndex` 纳入主编辑区所需的 group 记录，并保留叶事件到祖先 group 的映射；后续按 v12 规则从 Timeline/Scroll 索引排除 group anchor。
- v0.3.2 曾在 Scroll view 加入 group 十字锚点；v0.3.5 将其移除，仅保留分组圈与所选 group 边界框。主编辑区 group anchor 的命中区域继续与绘制尺寸对齐。
- 嵌套 Group 的双击进入逻辑保留：普通点击仍选最近直接父 Group，双击只推进一层临时选择作用域，必须从外层到内层逐层进入；作用域内没有选中后代时自动退出。
- Group Inspector 不再显示普通事件类型下拉框，只保留 `Time` 和可编辑 `Color`；颜色修改继续走历史记录和只读保护。
- 补齐 `event.group` 的英文 `Group` 和中文 `分组` i18n，并确认菜单命令 `events.group` / `events.ungroup` 的双语 label/hint。

### 快捷键与帮助

- 分组快捷键明确固定为 `Ctrl+G`（分组）和 `Ctrl+Shift+G`（解组），并继续注册在 Events 菜单与命令注册表中。
- 快捷键弹窗现在直接回归测试最终生成的 DOM 内容，确认两条分组命令和对应快捷键都会显示，而不是只检查命令定义。
- 快捷键弹窗移除会造成横向滚动的最小宽度，并允许长标签换行；快捷键列保持紧凑不挤压标签。
- 中英文手册的 Events 表格新增 Group/Ungroup 独立行；README 的常用快捷键表和分组说明也明确列出两条快捷键。

### 发布文件与测试

- `package.json`、`package-lock.json` 更新为 `0.3.2`。
- 主入口 cachebuster 更新为 `js/app.js?v=27`，Service Worker 更新为 `sviber-v37`，并加入 `js/render/selection.js` 缓存项。
- 新增回归覆盖：选择模式、创建工具 toggle、快捷键弹窗内容、Group i18n、Group Scroll index，以及快捷键弹窗 CSS。
- 最终验证命令：

```text
node --test tests/v10-features.test.mjs tests/v11-features.test.mjs tests/v12-features.test.mjs tests/render-index.test.mjs
npm test
npm run verify:browser
npm run build
git diff --check
```

最终实际结果：`npm test` 151/151 通过；`npm run verify:browser` 通过，包含 Group 检查器、主编辑器 anchor、快捷键 toggle、选择取消和双基准 100000 事件性能检查，播放/编辑均 0 丢帧；`npm run build` 成功生成 `build/sviber-0.3.2.nw` 和 Windows x64 NW.js 包；`git diff --check` 通过。

本节对应发行版本为 `v0.3.2`；历史的 v0.3.1 审计结论和发布记录保留在上文，不覆盖既有 `v0.3.0` 与 `v0.3.1` tag。

## v0.3.5 PROMPT-v12 最终校正

本轮再次按行读取 `PROMPT-v12.md` 并与 `PROMPT-v11.md` 的 diff 对照，重点复查用户指出的文件格式、Scroll view、快捷键帮助、国际化、构建图标、自动恢复和 group 交互。PROMPT-v12 明确规定文件格式修改不考虑向后兼容，因此 group 规范化和新的自动保存记录采用当前格式，不保留旧的冗余模型。

### Group 文件模型和三视图行为

- `group` 只保存递归 `events`、位置/附着字段和颜色，不再保存 `time` 或 `channel`；导入、创建、粘贴和保存都会移除这两个旧字段。
- `eventTime()` 递归取最早叶事件时间，`eventChannels()` / `eventUsesChannel()` 按后代叶事件判断所属通道；检查器显示推导出的只读时间、可编辑颜色，不显示类型或通道。
- Timeline 和 Scroll view 的事件索引只包含叶事件，所以不会绘制或命中 group anchor；两个视图继续根据祖先表绘制嵌套分组圈和所选 group 的颜色边界框。
- 主编辑区继续单独渲染和命中 group anchor。点击 group 后再次点击会取消选择；双击逐层进入嵌套 group 的临时作用域仍然保留。
- Group bounds 只按递归叶事件计算，不把自身或内层 group anchor 算入范围；父子 group 同时处于 selected 状态时，也只为未嵌套在其他所选 group 中的根选择绘制边界框。移动、时间反转、通道移动、复制粘贴、选区和自由变换均递归作用于叶事件。
- 唯一选中的 attached group 现在可以移动；移动会同步改变 group 自身位置和全部可移动后代，不会因为 anchor 已附着而被拦截。

### 自动保存与媒体恢复

- 自动保存记录改为版本化 envelope，分别保存无生成事件列表的 `document` 和 NW.js 本地来源上下文 `source`。
- 来源上下文包含工程路径/名称和谱面路径/文件名。恢复时先恢复这些路径，再安装工程并同步媒体，因此相对路径引用的音乐和背景会自动重新载入。
- 按 PROMPT-v12 的“文件格式更新不考虑兼容性”要求，不再把旧裸谱面自动保存记录作为新格式处理。

### 国际化

- 页脚 JavaScript 许可信息链接增加 `footer.javascriptLicense`，英文和简体中文均从 JSON 字典读取。
- `I18n.localize()` 可识别历史记录中已保存的旧语言文本，并按当前语言重新生成。切换语言后，已有的创建事件、分组、解组等历史标签会立即更新。

### Scroll view 与快捷键帮助

- Scroll view 当前时间线固定为 `height * 0.75`，即距顶部四分之三、距底部正好四分之一面板高度。
- Timing 菜单助记键固定为 `Alt+T`，Transform 菜单固定为 `Alt+R`，避免与其他顶级菜单冲突并符合 PROMPT-v12。
- Keyboard shortcuts 弹窗使用响应式多列；每条快捷键都有独立悬停区域，并向底部提示栏注册对应命令的详细说明。Group/Ungroup 及其 `Ctrl+G` / `Ctrl+Shift+G` 保持在列表中。

### 构建、片段与手册

- `npm run build` 从 `svg/icon.svg` 同时生成源码根目录的 `icon.ico` 与 `icon.png`，使 `nw .` 能直接使用图标；两个文件和全部构建输出均由 `.gitignore` 排除。
- 片段行固定为缩略图、名称和五个操作按钮的独立列。缩略图递归解析 nested group，并解析附着事件的实际坐标，再按片段内容自动取景。
- 手册搜索保持全文、目录、列表和表格可见；输入时跳到第一处匹配，`Enter` 向下、`Shift+Enter` 向上循环导航。
- README 和中英文 HTML 手册同步说明自动恢复媒体、group 模型/锚点/移动、Scroll 基准线、快捷键多列和悬停提示、动态 i18n 及源码图标生成规则。

### v0.3.5 回归覆盖

- Group：无 `time/channel`、最早后代时间、三视图索引、嵌套 rings/bounds、attached group 移动、剪贴板/片段递归树、变换与历史。
- 自动保存：版本化 document/source envelope、恢复来源路径、NW.js 相对音乐/背景同步。
- i18n：页脚 key 与双语字典一致；已有 Create Tap / Ungroup 历史标签在切换语言后重新翻译。
- 快捷键：多列 CSS、item DOM、Group/Ungroup、悬停 tooltip、Timing/Transform 助记键。
- Scroll view：当前时间基准线源码契约、无 group anchor、保留 grouping bounds。
- 构建：根目录 ICO/PNG 生成路径、package 窗口图标和 `.gitignore` 规则。
- 手册与片段：全文搜索与循环导航、nested/attached clip 缩略图和固定行布局。

发布前执行 `npm test`、`npm run verify:browser`、独立输出目录的 `npm run build` 和 `git diff --check`；最终结果记录在 `RELEASE-0.3.5.md`。
