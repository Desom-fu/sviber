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

### 9. Lock / Unlock（Ctrl+L）与锁定语义

- **diff**：Events 菜单在 Ungroup 后新增 Lock/Unlock（均 Ctrl+L）；事件默认未锁定；锁定事件被编辑/变换/删除操作忽略（视为未选中）；全锁定时自由变换置灰；锁定事件不显示 flick 方向手柄与时间轴时长尾柄；Delete channel 仍删除锁定事件；事件 JSON 增加 `locked` 布尔字段。
- **实现**：
  - 数据：`js/core/chart-events.js` `createEvent` 增加 `locked: Boolean(overrides.locked)`（随 `normalizeEventTree`/序列化往返保留）。
  - 命令：`js/app/commands.js` 新增 `events.lock`/`events.unlock`（均 `Ctrl+L`，菜单置于 Ungroup 之后）；`handleKeyboard` 中禁用命令不再拦截同键位命令（`return false` → `continue`），保证全锁定时 Ctrl+L 触发 Unlock。
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
