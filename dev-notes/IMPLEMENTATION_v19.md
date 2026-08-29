# PROMPT-v19 实现文档

本文档逐条对照 `dev-notes/PROMPT-v18.md` 与 `dev-notes/PROMPT-v19.md` 的 diff（另存于 `dev-notes/v18-v19.diff`），说明每一项新增/修改的实现方式、涉及文件与验证结果。

## Diff 清单与实现

### 1. 选中的锁定事件显示品红（magenta）色调

- **diff**：主编辑区与自由变换相关段落中，“选中事件显示鲜红色调”补充“选中的锁定事件显示品红色调”；并明确“事件不可见时仍显示选中提示”的规则不适用于 `group` 事件，但适用于其他类型（包括选中 group 直接/间接包含的事件）。
- **实现**：
  - `js/render/stage-helpers.js`：`SUNNIESNOW_SKIN` 新增 `selectionLockedTint: "#e83dff"`，新增导出助手 `selectionTintFor(event)`。
  - `js/render/note-painting.js`：hold 光晕、bgNote、drag、碟形（tap/hold/flick）、flick 箭头的选中着色均按 `event.locked` 切换品红。
  - `js/render/stage-notes.js`：接近圈、不可见选中虚线轮廓（`_drawSelectedInvisible`，原本就跳过 `group` 并经由 `isEventSelected` 覆盖 group 包含的事件）使用 `selectionTintFor`。
  - `js/render/stage-core.js`：tip-point 连接线选中着色支持品红。
  - `js/render/stage-patterns.js`：背景图案选中描边/文字着色支持品红。
  - `js/render/timeline-drawing.js`、`js/render/scroll-view.js`：时间轴与滚动视图选中色 `locked ? "#e83dff" : "#ff3158"`。
- **验证**：`npm test`（eslint + 370 项 node 测试）通过。

### 2. 滚动条 Ctrl+点击/拖动设置当前时间

- **diff**：按住 Ctrl 在滚动条上点击/拖动时，按鼠标位置（吸附细分）设置当前时间；若可见范围原本包含当前时间，则同步平移可见范围使当前时间视觉位置不变。
- **实现**：`js/render/timeline-pointer.js`
  - `_scrollbarPressDrag` 增加 `event` 参数；Ctrl 按下时创建 `scroll-ctrl` 拖动（记录按下时的可见范围、是否跟随及当前时间在范围内的偏移）。
  - 新增 `_scrollCtrlSeek`/`_moveScrollCtrl`：将指针映射到滚动条时间、吸附细分后通过 `onPreviewSeekBeat` 寻拍，并按按下时记录的偏移同步 `onVisibleRange`；`_pointerUp` 收尾并触发 `onSeekEnd`。
- **验证**：lint 通过；全部测试通过。

### 3. Checks 面板标签页实时显示红色违规数

- **diff**：checks 面板的可点击标签页在违规数非零时以红色字体显示数量并实时更新。
- **实现**：
  - `index.html`：`#checks-tab` 内增加 `<span id="checks-tab-count">`（i18n 文本移至内层 span，避免被语言切换覆盖）。
  - `css/app.css`：新增 `.checks-tab-count`（红色 #ff405d、加粗）。
  - `js/app/app-checks.js`：`refreshChecks` 两条路径均调用新增的 `_updateChecksTabCount`，随每次刷新实时更新/隐藏徽标。
- **验证**：全部测试通过。

### 4. Circular arc 曲线

- **diff**：新增“Circular arc curve”章节：中心坐标、起止角、段数 m、顺/逆时针与是否闭合（整圆）参数；snap points 为等弧长分段顶点；创建后弹出参数表单并聚焦段数字段。
- **实现**：该功能在 v0.8.0（PROMPT-v17）已完整落地，v19 仅为文档化。复核确认：
  - `js/core/chart-snappees.js`：`circularArcCurve` 默认字段（centerX/Y、radius、beginningAngle、endAngle、clockwise、closed、segments）。
  - `js/core/geometry.js`：`sampleCircularArc` 按 m 等分圆弧（等弧长），闭合时整圆、snap points 为分段顶点。
  - `js/app/app-curve-draft.js` `finishCurveDraft`：创建后对 `circularArcCurve` 调用 `showSnappeeDialog(type, id, { focusField: "segments" })`。
  - `js/app/app-snappee-forms.js`：圆弧参数表单含全部参数。
- **验证**：现有 `tests/curve-draft.test.mjs`、`tests/snappees.test.mjs`、`tests/geometry.test.mjs` 全部通过。无需新增改动。

### 5. 难度颜色监听仅在用户编辑后触发

- **diff**：难度名 `input` 事件监听“只在用户编辑难度名时运行，用户编辑任何内容之前不运行”。
- **实现**：现有代码已满足——`js/app/app-helpers.js` 的 `applyPresetDifficultyColor` 先经 `isUserFieldEdit`（要求真实 `input` 事件且目标是难度名输入框）过滤，表单初始化/程序化赋值不会触发。无需改动；由 `tests/field-validation.test.mjs` 中 `isUserFieldEdit` 相关测试覆盖。

### 6. 新建谱面的 charter/难度默认值

- **diff**：charter 默认值仅在“新建谱面”时沿用上次填写值；打开或导入谱面不影响下次默认。默认难度名 Master 及其预设色，若已存在则为 Special 及其预设色。
- **实现**：
  - `js/app/app-document-lifecycle.js` `showChartProperties`：`rememberCharter` 仅在 `newChart && tracking.userEdited("charter")` 时执行（编辑既有谱面属性不再写入默认）。
  - `js/app/app-preferences-media.js` `requestLyricaImportOptions`：移除导入时的 `rememberCharter`。
  - Master/Special 默认值与预设色逻辑（`newDifficulty`/`newProject`）此前已实现，复核无误。
- **验证**：更新 `tests/field-validation.test.mjs` 以断言 v19 行为（媒体导入不再 `rememberCharter`，属性表单仅新建时记忆）；全部测试通过。

### 7. Offset 调整模式 Ctrl+拖动

- **diff**：Ctrl+拖动波形改为拖动最近的拍线（含细分拍线），通过改变该拍线之前（不含）最后一个 BPM 变化的 BPM（无则改初始 BPM）。
- **实现**：`js/render/timeline-pointer.js` `_offsetAdjustPointerDown`：最近拍线按 `subdivision` 取整（含细分拍线）；BPM 变化过滤条件由 `<=` 改为严格 `<`；`bpm` 取锚点处 BPM。
- **验证**：全部测试通过。

### 8. BPM 弹窗删除按钮

- **diff**：BPM 表单在确认/取消之外增加删除按钮，点击删除当前时间的 BPM 变化。
- **实现**：`js/app/app-chart-dialogs.js` `showBpmDialog` 改用 `dialogs.open` + 三按钮（ok/delete/cancel）；delete 分支在存在 BPM 变化时提交移除。i18n 新增 `dialog.delete`。
- **验证**：全部测试通过。

### 9. Lock / Unlock（Ctrl+L / Ctrl+Shift+L）与锁定语义

- **diff**：Events 菜单在 Ungroup 后新增 Lock/Unlock（v0.10.2 起 Lock 为 Ctrl+L、Unlock 为 Ctrl+Shift+L；prompt 原文误写为共用 Ctrl+L）；事件默认未锁定；锁定事件被编辑/变换/删除操作忽略（视为未选中）；全锁定时自由变换置灰；锁定事件不显示 flick 方向手柄与时间轴时长尾柄；Delete channel 仍删除锁定事件；事件 JSON 增加 `locked` 布尔字段。
- **实现**：
  - 数据：`js/core/chart-events.js` `createEvent` 增加 `locked: Boolean(overrides.locked)`（随 `normalizeEventTree`/序列化往返保留）。
  - 命令：`js/app/commands.js` 新增 `events.lock`（Ctrl+L）/`events.unlock`（Ctrl+Shift+L，快捷键 0.10.2 修正），菜单置于 Ungroup 之后；`handleKeyboard` 中禁用命令不再拦截同键位命令（`return false` → `continue`，该行为现由共用 Ctrl+Shift+V 的两条粘贴命令继续依赖）。
  - 绑定：`js/app/app-command-bindings.js` 注册两命令（Lock：存在未锁定选中时可用；Unlock：存在锁定选中时可用）；group/ungroup/delete/时间平移/伸缩/反转等命令的启用条件改为“存在未锁定选中”。
  - 动作：`js/app/app-event-tools.js` 新增 `lockSelected`/`unlockSelected`（历史标签 `history.lockEvents`/`history.unlockEvents`）。
  - 语义（“视为未选中”）：`deleteSelected`（跳过锁定事件；被删 group 中的锁定后代原位保留）、`chooseEventTool` 类型转换、`_selectedChannelLeaves`、`reverseSelectedTime`、`js/core/chart-model.js` `groupSelected`/`ungroupSelected`、`js/app/app-event-move.js`、`_applyEventMove`/`moveSelectedInTime`、`js/app/app-time-dilation.js`、`js/app/app-attachment.js` `showTimeTranslationDialog`、`js/app/app-transform-targets.js`（变换目标与 `transformationAvailable`，从而实现全锁定置灰）、`attachSelected`/`detachSelected`（`app-snappee-attach.js` 与 `app-selection-transform.js` 两处）、`js/app/app-property-editing.js` 检查器编辑、`js/render/timeline-pointer.js` `_selectedLeafEvents`/`_durationPressDrag`。
  - 手柄：`js/render/stage-overlays.js` flick 手柄过滤锁定；`js/render/timeline-drawing.js` 时长尾柄过滤锁定。
  - Delete channel 经 `model.removeChannel` 整通道删除，天然包含锁定事件，无需改动。
- **验证**：新增 `tests/event-lock.test.mjs`（6 项：locked 字段与 JSON 往返、group/ungroup 跳过锁定、命令快捷键、禁用不遮蔽同键命令）；全部测试通过。

### 10. Copy / Paste snappee

- **diff**：Snappee 菜单新增 Copy snappee（复制选中 snappee 的 JSON 到剪贴板，无选中置灰）与 Paste snappee（按剪贴板 JSON 创建新 snappee）。
- **实现**：`js/app/commands.js` 新增 `snappee.copy`/`snappee.paste`（菜单位于 Attach to curve by time 后，加分隔线）；`js/app/app-command-bindings.js` 绑定（copy 在无选中 snappee 时置灰）；`js/app/app-clipboard.js` 新增 `copySnappee`/`pasteSnappee`（校验 `SNAPPEE_TYPE_SET`、分配新 id、经 `uniqueSnappeeName` 去重并选中新 snappee，toast 提示）。
- **验证**：全部测试通过。

### 11. Set speed to 0.1（Ctrl+`）

- **diff**：Music 菜单与工具栏新增 Set speed to 0.1（Ctrl+`，图标 `speed-0-1.svg`），并加入工具栏项目清单；播放速率下限 0.1。
- **实现**：`js/app/commands.js` 新增 `music.speed01`（checkable，speed 组，菜单与 `TOOLBAR_ITEMS` 均位于 speed025 之前）；`js/app/app-command-bindings.js` 绑定 `setSpeed(0.1)`（`setSpeed` 已有 0.1 下限钳制）；`js/app/app-status-view.js` `_syncCheckedCommands` 增加 0.1 勾选态；i18n 双语条目；`service-worker.js` 图标缓存清单加入 `speed-0-1.svg`（图标文件已随 prompt 提交提供）。
- **验证**：`tests/shortcuts.test.mjs` 新增快捷键断言；全部测试通过。

### 12. Drag screening 检查

- **diff**：新增检查：drag 于 t0，若 [t0−T, t0] 内距离 L 内无其他音符（tap/hold/drag/flick）且 [t0, t0+T] 内距离 L 内有非 drag 音符，则违规；T 默认 0.4、L 默认 40；点击违规选中该 drag。
- **实现**：`js/core/checks-config.js` 新增 `dragScreening` 定义（target event，参数 `seconds`=0.4、`distance`=40）；`js/core/checks.js` 新增 `checkDragScreening` 并接入 `runChecks`；i18n 双语标签/提示。
- **验证**：`tests/checks.test.mjs` 更新检查总数（12→13）与参数清单，并新增两组行为测试（命中、遮挡/纯 drag/超距/超窗/默认参数场景）；全部测试通过。

### 13. 设置 JSON 增加 `playBgNoteSe`

- **diff**：设置序列化清单新增 `playBgNoteSe` 布尔字段。
- **实现**：此前版本已完整落地——`js/core/chart-vocabulary.js`（默认 false）、`js/core/chart-normalize.js`（反序列化）、`index.html` 状态栏开关、`js/app/app-status-*.js` 绑定、`js/app/app-playback-transport.js` 播放调度。复核无需改动。

## 内部文档同步

- `docs/index.html`（应用内帮助，中英双语）：滚动条 Ctrl 行为、Events 菜单 Lock/Unlock 行与锁定语义段落、Timing 表（细分拍线 + 严格之前、BPM 删除按钮）、Snappee 表（复制/粘贴吸附器）、Music 表（速度 0.1 / Ctrl+`）、Checks 面板（标签页红色计数、Drag screening 条目）、JSON 结构（`dragScreening` 参数、事件 `locked` 字段）、新建谱面默认值段落。

## 验收

- `npm test`（`eslint . --max-warnings 0 && node --test tests/*.test.mjs`）：lint 0 错误，370 项测试全部通过（含 1 项预先存在的 skip）。
- 提交前已逐行复查 `dev-notes/v18-v19.diff`，上述 13 项全部落地，覆盖率 100%。

## v0.10.1 修复：钢笔曲线无法用回车/双击确认，且闭环后首点被拖走

- **现象**：钢笔工具画曲线时，回车键与双击都无法像贝塞尔工具那样确认并弹出参数提示框；点击第一个点闭环时确认同样失败，草稿残留在半闭合状态，之后的点击/微拖动会把最初的那个点拖走。
- **根因**：`js/app/app-curve-draft.js` 的 `finishCurveDraft` 在 `penCurve` 分支引用了 `penCommandsFromNodes`，但该函数从未从 `../core/geometry.js` 导入。任何走完 pen 确认路径的调用（`finishCurveDraft`：回车/双击/闭环）都在构造 `commands` 时抛出 `ReferenceError`：snappee 未创建、提示框未弹出、`curveDraft` 未清空；闭环路径中 `closed = true` 已写入，草稿卡在破损状态，用户再次点击首点（命中 `draft-point` 区域）时轻微移动即被 `moveCurveDraftPoint` 当作拖动移点——表现为"闭环后把最开始的点弄走"。
- **修复**：在 `js/app/app-curve-draft.js` 顶部导入 `penCommandsFromNodes`（一行）。确认路径恢复正常：回车/双击结束绘制并弹出 segments 提示框；点击（不拖动）首点或靠近首点处闭环时生成带闭合段（回到首点坐标）的闭合 penCurve 并弹出提示框。
- **验证**：新增 `tests/curve-draft.test.mjs` 两项回归测试——"Enter or double-click on a pen draft creates the snappee and opens the dialog"（断言创建 snappee、`commands` 正确、弹出 `focusField: "segments"` 表单）与"closing a pen loop keeps the first point and appends the closing segment"（断言 `activateCurveDraftPoint(0)` 与 `startPenNode` 近首点两条闭环路径首点坐标不变、末尾为回到首点的闭合段）。未修复时两项均失败（ReferenceError），修复后通过；全部测试通过。

## v0.10.2 修复与调整

### 1. 解锁快捷键修正为 Ctrl+Shift+L

- **背景**：PROMPT-v19 原文把 Lock/Unlock 写成共用 Ctrl+L，实现照做；用户更正 prompt（Unlock 应为 Ctrl+Shift+L），本次同步功能与帮助文档。
- **实现**：`js/app/commands.js` `events.unlock` 快捷键 `Ctrl+L` → `Ctrl+Shift+L`；`docs/index.html` 中英两处 Lock/Unlock 行同步为 "Ctrl+L / Ctrl+Shift+L" 并去掉"共用快捷键"描述。`handleKeyboard` "禁用命令不遮蔽同键命令"的 `continue` 行为保留（`edit.pasteOptions`/`edit.pasteDuplicateSnappees` 共用 Ctrl+Shift+V 仍依赖）。
- **验证**：`tests/event-lock.test.mjs` 更新快捷键断言（lock=Ctrl+L、unlock=Ctrl+Shift+L），"禁用命令不遮蔽同键命令"测试改用 Ctrl+Shift+V 粘贴命令对作为夹具；全部通过。

### 2. 状态面板与下方面板等宽

- **实现**：`css/app.css` `.timeline-row` 右列宽度 `clamp(148px, 14vw, 190px)` → `clamp(260px, 24vw, 320px)`，与 `.editor-row` 右侧 side-panel 列完全一致，上下两框右缘对齐；状态选项图标网格（`app-v11.css` 的 30px 瓦片）随之放下更多列。
- **验证**：`npm test` 通过；本地 `npm run build` 正常出包。

### 3. 锁定事件在主编辑区不可拖动

- **现象**：锁定事件仍能在主编辑区拖动改变位置。
- **根因**：v0.10.0 的锁定语义覆盖了时间轴拖动（`timeline-pointer.js` 已过滤）与各类命令，但漏掉了主编辑区的位置拖动链路：`stage-pointer.js` 的事件按压/Shift 拖动不检查 `locked`，`app-position-move.js` `_applyPositionMove` 的 movable 集合也不过滤锁定，`app-group-anchor-move.js` 允许拖动锁定 group 的锚点，`stage-overlays.js` 的 tip 生成位置手柄对锁定事件仍然显示。
- **实现**（锁定一律"视为未选中"）：
  - `js/render/stage-pointer.js` `_eventPressDrag`：锁定事件按压仍可选择（品红选中色可见）但不启动拖动；`_closestSelectedMovable`（Shift 拖动的生效事件）与 `_flickPressDrag`（联动转动的选中 flick 列表）跳过锁定事件。
  - `js/app/app-position-move.js` `_applyPositionMove`：primary 锁定时整个移动不生效；选中集合过滤锁定根事件与锁定后代（拖动 group 时锁定的子事件原位保留）；movable 为空时提前返回。
  - `js/app/app-group-anchor-move.js` `_applyGroupAnchorMove`：过滤锁定 group（锚点拖不动）。
  - `js/render/stage-overlays.js`：锁定事件不显示 tip 生成位置手柄。
- **验证**：`tests/event-lock.test.mjs` 新增三项——按压锁定事件只选中不产生拖动、位置拖动只移动未锁定事件（含拖锁定事件本身不动）、按事件或锚点拖动 group 时锁定的子事件原位保留且锁定 group 锚点拖不动；全部通过。

### 4. 界面翻译修正

- **实现**：`json/i18n.zh-CN.json`：`panel.inspector` "检查器" → "属性"（`docs/index.html` 中文帮助中 7 处"检查器"同步改为"属性"，"游标检查器"标题改为"游标属性"）；checks 相关 7 条字符串的"尖点"统一改为"游标"（`check.shortTipPoint*`、`check.sharpTipPointTurn*`、`check.teleportingTipPoint*`），与"显示游标""游标模式"等既有译法一致。
- **验证**：`npm test` 全部通过。

### 5. 检查面板随修改实时刷新

- **现象**：修改事件后 Checks 面板内容与标签页红色计数不更新，要等一次完整刷新。
- **根因**：`refreshChecks` 只挂在完整刷新（`refreshNow`）里；绝大多数事件修改走 `commit` 的轻量刷新路径（`_finishCommit` → `_refreshAfterCommit` → `_refreshLightweight`），不经过 `refreshNow`。拖动预览帧依旧只做 `refreshInteractionPreview`（`preview` 的 lightweight 分支），不重跑检查，性能无影响。
- **实现**：`js/app/app-free-transform.js` `_refreshAfterCommit`：非 fullRefresh 分支在 `_refreshLightweight` 之后调用 `this.refreshChecks?.()`（内部有签名比对，未变化时只重渲染缓存结果）。
- **验证**：`tests/checks.test.mjs` 新增"轻量提交刷新实时检查面板"测试——桩 `refresh()` 不触碰 checks 面板，轻量 commit 引入超界音符后面板立即渲染出 `outOfBoundaryNotes` 违规；全部通过。

### 验收

- `npm test`（`eslint . --max-warnings 0 && node --test tests/*.test.mjs`）：lint 0 错误，377 项测试全部通过（含 1 项预先存在的环境相关 skip）。
- `npm run build`：本地 NW.js 打包成功（`build/sviber-*.nw` 与 `build/nw`）。

## v0.10.3 打开文档时的居中加载遮罩

- **背景**：打开谱面/工程偏慢（大谱面导入与音乐/封面解码），期间没有可见反馈。
- **实现**：
  - 复用启动时的 `#loading-screen` 全屏遮罩（居中的三色条动画 + 文案）：`js/app/app-shell-bindings.js` 新增 `showLoadingOverlay`/`hideLoadingOverlay`/`withLoadingOverlay`。深度计数器支持嵌套打开（谱面拉起所在工程时外层遮罩不提前消失）；`withLoadingOverlay` 在开始前等待一帧（双 rAF），确保遮罩先绘制再进入阻塞导入；对缺失 DOM 的环境静默降级。
  - `js/app/app-open-save.js`：`openProject` 的解析/导入/装填/媒体同步整体包进遮罩（文案 `loading.project`）；`openFile` 只包住模型构建后的装填阶段（文案 `loading.chart`）——导入选项对话框出现在遮罩之前，不会被 z-index 2000 的遮罩盖住。
  - i18n 新增 `loading.chart`（"正在打开谱面..."/"Opening chart..."）与 `loading.project`（"正在打开工程..."/"Opening project..."）。
- **验证**：`tests/project-workflows.test.mjs` 新增两项——遮罩接线源码断言、深度计数行为测试（嵌套打开时内层结束不隐藏遮罩）；两个打开流程测试的组合补上 `withShellBindings` 以匹配真实应用表面。`npm test` 379 项全部通过；`npm run build` 正常出包。

## v0.10.4 交互卡顿排查与修复

### 排查结论（playwright 真实浏览器探针 + node 基准，4000 事件谱面）

- **滚动视图/时间轴每帧绘制本身不慢**：播放帧（三个视图重绘 + 状态更新）中位数约 1.5ms；单独重绘滚动视图 0.2-0.3ms、时间轴 0.5-1ms、主编辑区 0.4-0.5ms；把 3000 个音符全部塞进可见窗口的密集场景也在 1ms 量级。渲染索引在播放帧间复用（`viewState` 携带 `renderIndex`），逐帧查询（`scrollEventRecords` 等）合计约 0.2ms，波形读取走金字塔分层。绘制路径里没有 shadowBlur/渐变等高开销调用，`getTimelineWidth` 读的是缓存尺寸不触发 reflow。
- **增量索引没有丢**：v0.9.0 模块拆分把增量变更搬进了 `js/render/chart-index-mutations.js`（`appendRootEvent`/`replaceEvents`/`moveEventsToChannels`/`setActiveChannels` 等，经 `ChartIndexMutationsTrait` 组合进 `ChartRenderIndex`），放置 note 仍是增量更新索引（实测放置后索引含新事件且无重建）。undo/redo 自始至终走快照恢复 + 全量重建，与拆分前一致。
- **放置 note 卡顿的根因是 v0.10.2 的同步检查刷新**：实测放置中位数 48.5ms，屏蔽 `refreshChecks` 后仅 3.8ms——`checksSignature` 全量 JSON 序列化（12ms@10k 事件）加 `runChecks` 全谱扫描（30ms@10k）都压在了点击的关键路径上。
- **undo 卡顿**：同步段约 57ms（快照基线深克隆 + patch 链回放 + `model.restore` 全量导入 + 随后一帧的 `refreshNow` 全量重建），与检查无关（屏蔽后不变），属历史设计的固有成本；defer 检查刷新能把随后一帧的 ~40ms 检查开销移出交互路径。

### 修复：检查刷新改为空闲调度

- **实现**：`js/app/app-checks.js` 新增 `_scheduleChecksRefresh`——用 `requestIdleCallback`（无则 `setTimeout` 32ms）在空闲切片执行 `refreshChecks`，进行中合并（挂起期间不重复排程，运行时读取最新模型）；`js/app/app-free-transform.js` `_refreshAfterCommit` 与 `js/app/app-core.js` `refreshNow` 的检查调用都改走调度（`showChecksDialog` 确认后的 `refreshChecks({force: true})` 仍同步）。检查面板与标签页红色计数在编辑后约一帧内更新，肉眼无感，但不再阻塞放置/撤销的关键路径。
- **验证**：真实浏览器复测放置中位数 48.5ms → **3.5ms**（p95 67.9 → 5.4ms）；`tests/checks.test.mjs` 更新为断言"提交不同步重跑检查、空闲切片后面板更新"。

### 术语：checks 里 Hold/Tap/Flick/Drag 不翻译

- **实现**：`json/i18n.zh-CN.json` 的 8 条 check 字符串把"长按/点击/拖动/滑动/drag"改为大写英文并与中文之间留空格（盘古之白）："Hold 过短"、"Tap、Hold、Drag 与 Flick 都必须在谱面边界内。"、"Hold 会占用自己的手指直到结束。"、"未判定的 Drag 不得遮挡…"等。"游标"（tip point）译法维持不变。
- **验证**：`npm test` 全部通过。

### 验收

- `npm test`（`eslint . --max-warnings 0 && node --test tests/*.test.mjs`）：lint 0 错误，378 项测试全部通过（含 1 项预先存在的环境相关 skip）。
- `npm run build`：本地 NW.js 打包成功。
- 若滚动视图在实际谱面中仍有可感知的掉帧，需要用户提供具体谱面文件复现（合成数据下绘制与索引路径均在预算内）。

## v0.10.5 检查扫描分步执行

- **现象**：v0.10.4 把检查刷新挪到空闲切片后，放置不再卡，但"放完之后"会卡——一整个空闲任务里跑完签名序列化 + 全部 13 项检查（4000 事件约 42ms），用户停手时正好撞上。
- **实现**：
  - `js/core/checks.js`：把 `runChecks` 的规则序列抽成 `createChecksSteps(model, options)`（返回 `{ violations, steps }`）并导出 `sortViolations`；`runChecks` 改为逐步执行同一份 steps，结果不变。
  - `js/app/app-checks.js`：`_scheduleChecksRefresh` 改为泵式分步执行——每个空闲切片（`requestIdleCallback`，按 `timeRemaining() > 2` 用量预算；无则 `setTimeout` 16ms + 5ms 预算）只跑若干条规则，全部完成后排序、渲染面板并更新标签页计数。编辑突发用 `checksRefreshPending` + token 合并：运行中的扫描在下一个切片发现被更新的编辑取代时，用新步骤重启；签名序列化从异步路径移除（编辑触发的重跑本来就知道模型变了，同步路径的 `refreshChecks` 仍带签名去重）。
- **验证**：playwright 探针（4000 事件）——放置本身 8-10ms，放置后 600ms 内 **零长任务**（修复前有一个 ~42ms 的整块检查任务，即"放完之后卡一下"）；`tests/checks.test.mjs` 新增分步与一次性运行结果一致性测试，`npm test` 全部通过。

