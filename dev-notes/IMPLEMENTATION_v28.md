# IMPLEMENTATION_v28

本文件按 `PROMPT-v27.md → PROMPT-v28.md` 的差异清单逐条记录 v28 的改动内容、涉及文件路径、具体实现方式与验证结果。发布版本：`v0.19.0`。

原始统一 diff 同时保存于 `dev-notes/PROMPT-v27-v28.diff`，下文完整收录同一份 diff 内容，方便后续比对。

## 差异清单与实现状态（逐条）

| # | 类型 | 差异条目 | 涉及文件 | 实现状态 |
|---|---|---|---|---|
| 1 | 新增 | 通道视图（Channels view）所有文字（通道名、事件图标与尾条文字、拍号等）使用与主编辑区 HUD 相同的字体族 | `js/render/stage-hud.js`, `js/render/timeline-drawing.js`, `js/render/timeline-helpers.js`, `tests/channels-view-hud-fonts.test.mjs` | 已实现并验证 |
| 2 | 新增 | 滚动视图（Scroll view）所有文字（通道名、事件图标文字、拍号）使用与主编辑区 HUD 相同的字体族 | `js/render/stage-hud.js`, `js/render/scroll-view.js`, `js/render/timeline-helpers.js`, `tests/scroll-view-hud-fonts.test.mjs` | 已实现并验证 |
| 3 | 新增/修改 | 负数拍位与 JSON 有理数三元组的整数部分始终取向下取整（floor），例如 `-1/2` 的整数部分为 `-1`（`[-1, 1, 2]`、状态栏 `-1+2/4`） | `js/core/rational.js`, `js/app/app-helpers.js`, `js/macro/macro-api-math.js`, `js/macro/macro-api.rb`, `js/macro/macro-sandbox.bundle.js`, `tests/core.test.mjs`, `tests/negative-beat-floor.test.mjs` | 已实现并验证 |
| 4 | 新增/修改 | 在已打开工程且已有谱面时新建谱面，默认 `offset`、`initialBpm` 与 `title` 取当前打开谱面的对应值；否则仍为 `0`、`120`、`"New chart"` | `js/app/app-document-lifecycle.js`, `tests/new-chart-project-defaults.test.mjs` | 已实现并验证 |
| 5 | 新增 | Events 菜单新增 4 个主方向生成命令（`Spawn from right/above/left/below`，快捷键 `^`/`*`/`$`/`@`），全部 8 个 `π/4` 倍数方向均支持快捷键（`^ ( * & $ ! @ #`），作用于选中的相对生成位置（含继承源）可带游标事件 | `js/app/app-tip-point-modes.js`, `js/app/app-event-tools.js`, `js/app/commands.js`, `js/app/app-command-bindings.js`, `json/i18n.*.json`, `tests/spawn-direction-commands.test.mjs` | 已实现并验证 |
| 6 | 新增 | Events 菜单在 `Ungroup` 与 `Lock` 之间新增 `Edit in inspector`（快捷键 `E`）：若属性面板隐藏则显示，并聚焦本次会话中上次交互的输入框（无记录或不存在时聚焦首个输入框） | `js/ui/panels.js`, `js/app/app-shell-bindings.js`, `js/app/app-layout.js`, `js/app/commands.js`, `js/app/app-command-bindings.js`, `json/i18n.*.json`, `tests/edit-in-inspector.test.mjs` | 已实现并验证 |
| 7 | 新增/修改 | `Bulk edit texts...` 增加快捷键 `Ctrl+E`；`Bulk edit texts...` 与 `Bulk edit texts by channel...` 在只读模式下保持可用，文本框不可编辑且不修改谱面 | `js/ui/ui-fields.js`, `js/app/app-bulk-edit.js`, `js/app/commands.js`, `tests/bulk-edit-texts-readonly-shortcut.test.mjs` | 已实现并验证 |
| 8 | 新增 | Music 菜单在 `Seek to start (Home)` 后新增 `Seek to last event`（快捷键 `End`），将当前时间移至时间最大的事件的时刻 | `js/app/app-history-commands.js`, `js/app/commands.js`, `js/app/app-command-bindings.js`, `js/ui/i18n.js`, `json/i18n.*.json`, `tests/seek-to-last-event.test.mjs` | 已实现并验证 |
| 9 | 新增 | `requiredFingers` 检查新增布尔参数 `ignoreDrag`（默认 `false`），开启时忽略 `drag` 事件；在 JSON `checks.requiredFingers.ignoreDrag` 中持久化 | `js/core/checks.js`, `js/app/app-checks.js`, `tests/required-fingers-ignore-drag.test.mjs` | 已实现并验证 |
| 10 | 新增 | 宏 API `Event` 新增 `#duration`、`#duration=`、`#end_time`、`#end_time=`（JS 对应 `duration`、`endTime`），用于有持续时长的事件；写入结束时间会减去起始时间以设置时长 | `js/macro/macro-api-math.js`, `js/macro/macro-api-event.js`, `js/macro/macro-api.rb`, `js/macro/macro-sandbox.bundle.js`, `tests/macro-event-duration-end-time.test.mjs` | 已实现并验证 |
| 11 | 修改 | `PROMPT-v28.md` 列表排版微调（`-  the size of the tip points.` → `- the size of the tip points.`） | 无代码改动（纯规格排版修正） | 已核对 |

## 逐条实现说明

### 1 & 2. 通道视图与滚动视图文字使用主编辑区 HUD 字体族

- **涉及文件**：`js/render/stage-hud.js`、`js/render/timeline-drawing.js`、`js/render/timeline-helpers.js`、`js/render/scroll-view.js`
- **实现方式**：从 `js/render/stage-hud.js` 导出 `HUD_FONT_FAMILY`（`"'Noto Sans Math', 'Noto Sans CJK TC', sans-serif"`），将通道视图的拍号（`_drawBeatLines`）、通道名称（`_drawChannels`）、事件尾条文字（`_drawEventLabel`）、BPM 变化标签（`_drawBpmChanges`）、事件图标文字（`drawTimelineEventIcon`）以及滚动视图的拍号（`#drawBeatLines`）与事件图标文字全部改为统一使用 `HUD_FONT_FAMILY`。
- **验证**：`tests/channels-view-hud-fonts.test.mjs` 与 `tests/scroll-view-hud-fonts.test.mjs` 通过源码断言及 2D Canvas 录制上下文验证全部 `fillText` 调用均使用 `HUD_FONT_FAMILY`。

### 3. 负数拍位与 JSON 有理数三元组整数部分向下取整（floor）

- **涉及文件**：`js/core/rational.js`、`js/app/app-helpers.js`、`js/macro/macro-api-math.js`、`js/macro/macro-api.rb`、`js/macro/macro-sandbox.bundle.js`、`tests/core.test.mjs`
- **实现方式**：
  - `Rational.prototype.toJSON()` 直接使用欧几里得除法：当余数 `remainder < 0n` 时执行 `whole -= 1n; remainder += this.denominator`，保证 `0 <= remainder < denominator` 且 `whole = floor(value)`（例如 `-1/2 -> [-1, 1, 2]`、`-1.5 -> [-2, 1, 2]`）。
  - `formatBeat()`（状态栏 Beat 显示）基于 `Rational.from(value).snap(subdivision).toJSON()` 展开分子，`-1/2` 在 4 细分下自然显示为 `-1+2/4`。
  - JS 宏 `macro-api-math.js` 改用 `Rational` 精确有理数实现 `beatTuple` / `addBeat` / `subBeat` / `compareBeat`；Ruby 宏 `macro-api.rb` 的 `beat_from_rational` 改为 `number.numerator.divmod(number.denominator)`，两者在正负拍位下完全一致，并重打 `js/macro/macro-sandbox.bundle.js`。
- **验证**：`tests/negative-beat-floor.test.mjs` 与 `tests/core.test.mjs` 覆盖核心 `Rational`、状态栏 `formatBeat`、`ChartModel` 序列化、JS 宏及 Ruby 实机执行。

### 4. 工程内新建谱面默认继承当前打开谱面的标题、偏移与初始 BPM

- **涉及文件**：`js/app/app-document-lifecycle.js`
- **实现方式**：在 `newDifficulty()` 打开“新建谱面”表单时，默认值改为 `title: source.metadata.title`、`offset: source.timing?.offset ?? 0`、`initialBpm: source.timing?.initialBpm ?? 120`；未打开工程时走 `newProject({ chartOnly: true })`，仍保持默认 `"New chart"`、`0`、`120`。
- **验证**：`tests/new-chart-project-defaults.test.mjs` 验证工程内与工程外两种场景的表单默认值。

### 5. 游标相对生成方向命令与 8 个方向快捷键

- **涉及文件**：`js/app/app-tip-point-modes.js`、`js/app/app-event-tools.js`、`js/app/commands.js`、`js/app/app-command-bindings.js`、`json/i18n.*.json`
- **实现方式**：
  - 在 `app-tip-point-modes.js` 定义 `SPAWN_DIRECTIONS`（8 个 `π/4` 倍数方向及其快捷键 `^ ( * & $ ! @ #`）以及 `relativeSpawnDirectionTargets(model)` / `hasRelativeSpawnDirectionTarget(model)`。解析选中未锁定的可带游标叶事件（含分组内后代）：对直接 `chain`/`drop` 且非绝对位置事件直接返回自身；对 `inherit` 事件通过 `inheritedTipPointSource(activeLeafEvents, event, model)`（支持 `tipPointSwitches` 通道置换）找到被继承源事件，仅当源事件为未锁定的相对生成位置时纳入修改目标并按事件去重。
  - 在 `app-event-tools.js` 实现 `canSetSelectedSpawnDirection()` 与 `setSelectedSpawnDirection(angle)`；若无匹配目标则命令灰显。
  - 在 `commands.js` 注册全部 8 条命令，仅在 Events 菜单（`Comment...` 与 `Group` 之间，上下带分隔线）放入 4 个 `π/2` 倍数命令（`Spawn from right/above/left/below`）。
- **验证**：`tests/spawn-direction-commands.test.mjs` 验证菜单项位置、全部 8 个快捷键、直接与跨通道交换继承修改、分组内事件、锁定源跳过与无目标灰显。

### 6. 在属性面板中编辑（`Edit in inspector`，快捷键 `E`）

- **涉及文件**：`js/ui/panels.js`、`js/app/app-shell-bindings.js`、`js/app/app-layout.js`、`js/app/commands.js`、`js/app/app-command-bindings.js`、`json/i18n.*.json`
- **实现方式**：
  - `InspectorPanel` 在渲染每行控件时为其中的 `input/select/textarea` 标记稳定的 `data-inspector-input-key`，并通过委托监听 `focusin`/`pointerdown`/`input`/`change` 记录本次编辑会话最近交互的控件键（程序性重新聚焦时通过 `_suppressFocusTracking` 避免污染记录）。
  - `InspectorPanel.prototype.focusPreferredInput()` 在当前可见且未禁用的输入框中优先聚焦上次交互控件，否则回退到第一个可聚焦输入框。
  - `LayoutTrait.prototype.editInInspector()` 在右侧面板隐藏时自动取消隐藏，调用 `activateSideTab("inspector")` 切到属性标签页，再调用 `focusPreferredInput()`。
  - 在 `commands.js` 将 `events.editInInspector`（快捷键 `E`）置于 Events 菜单的 `Ungroup` 与 `Lock` 之间（上下带分隔线）。
- **验证**：`tests/edit-in-inspector.test.mjs` 验证菜单位置、隐藏恢复、首次默认聚焦、重渲染记忆聚焦、不可用时回退首个输入框及再次切回记忆保持。

### 7. 批量编辑文本快捷键 `Ctrl+E` 与只读模式支持

- **涉及文件**：`js/ui/ui-fields.js`、`js/app/app-bulk-edit.js`、`js/app/commands.js`
- **实现方式**：
  - `events.bulkEditTexts` 配置快捷键 `Ctrl+E`，`events.bulkEditTexts` 与 `events.bulkEditTextsByChannel` 均设置 `allowWhenReadOnly: true`。
  - `ui-fields.js` 的 `buildTextareaControl` 支持 `field.readOnly`，将 `<textarea>` 设为 `readOnly = true`。
  - `app-bulk-edit.js` 在只读模式下以 `readOnly: true` 文本框和单一关闭按钮打开两个弹窗，按通道查看时仍可切换通道刷新展示文本，关闭或提交均不调用 `commit`、不修改谱面。
- **验证**：`tests/bulk-edit-texts-readonly-shortcut.test.mjs` 验证快捷键触发、只读启用、控件 `readOnly` 属性、通道切换预览及零修改保证。

### 8. 跳到最后事件（`Seek to last event`，快捷键 `End`）

- **涉及文件**：`js/app/app-history-commands.js`、`js/app/commands.js`、`js/app/app-command-bindings.js`、`js/ui/i18n.js`、`json/i18n.*.json`
- **实现方式**：
  - 在 `app-history-commands.js` 新增 `seekLastEvent()`，扫描全部非 `group` 事件（含嵌套分组内事件）找出时间（`Rational`）最大者，并通过 `seekBeat(latest.toJSON())` 移动当前时间与可见范围；无事件时保持不变。
  - 在 `commands.js` 注册 `music.seekLastEvent`（快捷键 `End`）并置于 Music 菜单的 `Seek to start` 之后；在 `i18n.js` 添加 `End -> shortcut.end` 映射。
- **验证**：`tests/seek-to-last-event.test.mjs` 验证菜单顺序、快捷键显示、空谱面无操作、嵌套分组最大拍位跳转与可见范围更新。

### 9. `requiredFingers.ignoreDrag` 参数

- **涉及文件**：`js/core/checks.js`、`js/app/app-checks.js`
- **实现方式**：
  - `checkRequiredFingers` 在开启 `ignoreDrag` 时提前过滤所有 `drag` 事件，彻底忽略 `drag` 对所需手指数的占用；默认值保持 `false`，JSON 序列化路径为 `checks.requiredFingers.ignoreDrag`。
  - 修复 `app-checks.js` 保存检查对话框参数时对 `checkbox` 类型参数的转换，确保保留布尔值而非转成数字。
- **验证**：`tests/required-fingers-ignore-drag.test.mjs` 与 `tests/checks.test.mjs` 验证默认值、JSON 归一化往返、多指判定与检查设置窗布尔保存。

### 10. 宏 API `Event#duration`、`#duration=`、`#end_time`、`#end_time=`

- **涉及文件**：`js/macro/macro-api-math.js`、`js/macro/macro-api-event.js`、`js/macro/macro-api.rb`、`js/macro/macro-sandbox.bundle.js`
- **实现方式**：
  - 在 JS 宏 `Event` 上新增 `duration` / `duration=` 与 `endTime` / `endTime=` 访问器，在 Ruby 宏 `Event` 上新增 `duration` / `duration=` 与 `end_time` / `end_time=`。
  - 仅允许对 `perdurant` 事件调用，非持续事件或已删除事件抛出错误；校验时长非负，且除 `bgNote` 与 `comment` 外要求严格为正；设置结束时间通过精确有理数减法 `end_time - time` 更新 `duration` 而不修改 `time`。
  - 重新构建 `js/macro/macro-sandbox.bundle.js`。
- **验证**：`tests/macro-event-duration-end-time.test.mjs` 同时验证 JS 宏 API、Ruby 实机执行以及 `macro-sandbox.bundle.js` 产物。

## 内部帮助文档、国际化与版本同步

- 四语用户手册（`docs/manual.en-US.html`、`docs/manual.zh-CN.html`、`docs/manual.zh-TW.html`、`docs/manual.ja-JP.html`）已同步更新：新建谱面工程默认值、通道视图与滚动视图 HUD 字体、状态栏与 JSON 负数拍位 floor 约定、`requiredFingers.ignoreDrag`、Events 菜单（4 个主方向与全部 8 个快捷键、`Edit in inspector (E)`、`Bulk edit texts... (Ctrl+E)` 及两个批量文本弹窗的只读可用性）、Music 菜单 `Seek to last event (End)` 以及宏 API `Event` 的 `duration` / `endTime`（`end_time`）。
- 四语界面翻译（`json/i18n.en-US.json`、`json/i18n.zh-CN.json`、`json/i18n.zh-TW.json`、`json/i18n.ja-JP.json`）已补齐所有新增命令、提示文本、历史标签与 `End` 键名。快捷键对话框由 `COMMAND_DEFINITIONS` 动态生成，自动包含所有新增快捷键。
- 发布版本更新至 `0.19.0`（`package.json`、`package-lock.json`、`service-worker.js` 缓存版本 `sviber-v0190000`）。

## 测试与验证结果

- `npm test`（ESLint `--max-warnings 0` + `node --test tests/*.test.mjs`）：**841 通过 / 0 失败**（含原有 819 项 + 本次新增 22 项）。
- `ruby tests/ruby-macro-smoke.rb`：通过（`ruby macro smoke ok`）。
- 新增按功能命名的测试文件（共 10 个）：
  - `tests/channels-view-hud-fonts.test.mjs`
  - `tests/scroll-view-hud-fonts.test.mjs`
  - `tests/negative-beat-floor.test.mjs`
  - `tests/new-chart-project-defaults.test.mjs`
  - `tests/spawn-direction-commands.test.mjs`
  - `tests/edit-in-inspector.test.mjs`
  - `tests/bulk-edit-texts-readonly-shortcut.test.mjs`
  - `tests/seek-to-last-event.test.mjs`
  - `tests/required-fingers-ignore-drag.test.mjs`
  - `tests/macro-event-duration-end-time.test.mjs`

## 原始 diff

完整 unified diff 保存在 `dev-notes/PROMPT-v27-v28.diff`，以下为原始内容：

```diff
diff --git a/dev-notes/PROMPT-v27.md b/dev-notes/PROMPT-v28.md
index a477ced..f7f5b49 100644
--- a/dev-notes/PROMPT-v27.md
+++ b/dev-notes/PROMPT-v28.md
@@ -417,6 +417,9 @@ For example, if a tip point spawns below the first event that it connects to,
 then the additional segment points down from the event icon in the timeline.
 It is drawn behind the event icons so as not to block the event icons visually.
 
+All texts in the channels view, including channel names, texts on event icons and event tails, and beat numbers,
+use the same font families as the font used for the HUD elements in the main editor field (e.g., the title and the difficulty name).
+
 When the user clicks an event (including its tail if it has one),
 select that event without changing the current time or the current channel.
 If the event is contained in a `group` event, select the `group` event instead.
@@ -683,6 +686,8 @@ It shows the following information:
 - Beat: the current beat, in the format of integer part plus numerator slash denominator.
   The denominator is always the same as the current subdivision denominator.
   In other words, the fraction is not simplified to have coprime numerator and denominator.
+  The integer part is always the floor of the current beat.
+  For example, the integer part of $-1/2$ is $-1$.
 - Speed: the current playback rate.
 
 For example, it can be:
@@ -1357,6 +1362,9 @@ a red number is shown to indicate the beat number of that beat line.
 At A-B loop marks, bright blue horizontal lines are drawn regardless of the current subdivision.
 When there are two A-B loop marks, a translucent blue rectangle is drawn to cover the region between them.
 
+All texts in the scroll view, including channel names, texts on event icons, and beat numbers,
+use the same font families as the font used for the HUD elements in the main editor field (e.g., the title and the difficulty name).
+
 When the user clicks and drags with mouse in the scroll view while holding <kbd>Ctrl</kbd>+<kbd>Space</kbd>,
 pan the scroll view following the mouse by changing the current time.
 If the visible range does not originally contain the current time or the visible range lock is on,
@@ -1699,6 +1707,8 @@ It sets the time of beat 0 (in seconds).
 Because Sunniesnow does not have the concept of beats, this is useless to Sunniesnow.
 The initial BPM is literally just the initial BPM.
 It is the BPM before the first BPM change event.
+If the user is creating a chart while a project is open,
+the default values of the initial BPM and the offset are those of the currently open chart.
 
 The difficulty color input automatically changes to a preset color if difficulty name is changed to one of "Easy", "Normal", "Hard", "Master", and "Special"
 as found by `input` event listener of the text input of the difficulty name.
@@ -1725,9 +1735,11 @@ The difficulty name is by default "Master", and the difficulty color is by defau
 but if that difficulty already exists in the project, the difficulty name is by default "Special",
 and the difficulty color is by default the preset color for special.
 The difficulty is by default "12".
-The offset is by default 0.
-The initial BPM is by default 120.
-The title is by default "New chart".
+The offset is by default 0, but if there is already a chart in the project, the offset is by default the offset of the currently open chart.
+The initial BPM is by default 120, but if there is already a chart in the project,
+the initial BPM is by default the initial BPM of the currently open chart.
+The title is by default "New chart", but if there is already a chart in the project,
+the title is by default the title of the currently open chart.
 All other fields are by default empty, and empty inputs should be considered acceptable input.
 
 #### Open project folder...
@@ -2468,9 +2480,16 @@ The "Events" menu has the following submenu items:
 - (separator)
 - Comment... (<kbd>Ctrl</kbd>+<kbd>M</kbd>)
 - (separator)
+- Spawn from right (<kbd>\^</kbd>)
+- Spawn from above (<kbd>\*</kbd>)
+- Spawn from left (<kbd>\$</kbd>)
+- Spawn from below (<kbd>@</kbd>)
+- (separator)
 - Group (<kbd>Ctrl</kbd>+<kbd>G</kbd>)
 - Ungroup (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>)
 - (separator)
+- Edit in inspector (<kbd>E</kbd>)
+- (separator)
 - Lock (<kbd>Ctrl</kbd>+<kbd>L</kbd>)
 - Unlock (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>)
 - (separator)
@@ -2479,7 +2498,7 @@ The "Events" menu has the following submenu items:
 - (separator)
 - Fill curve with drag notes
 - (separator)
-- Bulk edit texts...
+- Bulk edit texts... (<kbd>Ctrl</kbd>+<kbd>E</kbd>)
 - Bulk edit texts by channel...
 - Import lyrics/subtitle file...
 
@@ -2578,6 +2597,30 @@ this submenu item is not grayed out even if the current channel is inactive.
 The reason is that toggling channel activity is only intended to hide events and their sound effects,
 but comments are not shown in the main field and do not have sound effects anyway.
 
+#### Spawn from right, Spawn from above, Spawn from left, Spawn from below
+
+For all selected tip-pointable events whose spawn positions are relative
+(including those inheriting relative spawn positions),
+change their spawn directions (or the spawn directions of the inherited events)
+to one of $0$, $\pi/2$, $\pi$, and $-\pi/2$
+according to the name of the operation (e.g., $0$ for spawning from right).
+If no such events are selected, the operation is grayed out.
+
+There are additional keyboard shortcuts, 8 in total for all multiples of $\pi/4$,
+but only multiples of $\pi/2$ are in the menu.
+The full list of keyboard shortcuts:
+
+| Direction | Key |
+|-|-|
+| $0$ | <kbd>\^</kbd> |
+| $\pi/4$ | <kbd>(</kbd> |
+| $\pi/2$ | <kbd>\*</kbd> |
+| $3\pi/4$ | <kbd>&</kbd> |
+| $\pi$ | <kbd>\$</kbd> |
+| $-3\pi/4$ | <kbd>!</kbd> |
+| $-\pi/2$ | <kbd>@</kbd> |
+| $-\pi/4$ | <kbd>#</kbd> |
+
 #### Group
 
 Detach all selected events from snappees and convert them into a `group` event containing them.
@@ -2592,6 +2635,14 @@ For all selected `group` events, put the events back and remove the `group` even
 If a selected `group` event is nested inside a `group` event, put the events in its outer `group`.
 This option is grayed out if no `group` events are selected.
 
+#### Edit in inspector
+
+If the inspection panel is hidden, show it.
+Focus on the previously interacted input element
+(or the first input element if none has been interacted with in this editor session
+or the previously interacted input element is not present)
+in the inspection panel.
+
 #### Lock, Unlock
 
 Lock or unlock all selected events.
@@ -2632,6 +2683,11 @@ The sequence of edited events is sorted by time and then by channel.
 Grayed out if no non-`comment` textable events are selected.
 Texts of all selected textable events except `comment` are edited after this operation.
 
+Different from most editor functions, this operation is still available in read-only mode,
+but the text box is not editable.
+This is because aggregating texts from a bunch of events is still useful even if
+they are not intended for editing.
+
 #### Bulk edit texts by channel...
 
 Shows a popup form.
@@ -2691,6 +2747,11 @@ the cursor position is set to where the user left it last time.
 
 Texts of all textable evets except `comment` are edited after this operation.
 
+Different from most editor functions, this operation is still available in read-only mode,
+but the text box is not editable.
+This is because aggregating texts from a bunch of events is still useful even if
+they are not intended for editing.
+
 #### Import lyrics/subtitle file...
 
 Show a file dialogue to choose a lyrics/subtitle file to import.
@@ -3259,6 +3320,7 @@ The "Music" menu has the following submenu items:
 - Play in reverse (<kbd>Shift</kbd>+<kbd>Space</kbd>)
 - (separator)
 - Seek to start (<kbd>Home</kbd>) (`../maker/svg/icons/seek-to-start.svg`)
+- Seek to last event (<kbd>End</kbd>)
 - Seek forward (<kbd>.</kbd>)
 - Seek backward (<kbd>,</kbd>)
 - Seek forward by 3 s (<kbd>Ctrl</kbd>+<kbd>.</kbd>)
@@ -3362,6 +3424,10 @@ If the music is not playing, change the current time to the beat subdivision clo
 whichever is smaller.
 Change the visible range of the timeline to contain the current time.
 
+#### Seek to last event
+
+Change the current time to the time of the event with the largest time.
+
 #### Seek forward, Seek backward
 
 Increment or decrement the current time by 1 beat subdivision.
@@ -3917,6 +3983,9 @@ and a `drag` at time 2 only requires 1 finger.
 When a violation is clicked in the checks panel,
 select the event that requires an $(n+1)$th finger.
 
+It has a boolean parameter that is false by default,
+and when it is true, the check ignores `drag` events.
+
 ### Out-of-boundary notes
 
 This check checks that all notes (`tap`, `hold`, `flick`, `drag`) and `bgNote` events are within the chart boundary.
@@ -4149,7 +4218,7 @@ This also proportionally affects the following dimensions in the timeline and/or
 - the thicknesses of various lines indicating information about tip points,
 - the distance between stacked event icons for simultaneous events in the same channel,
 - the font sizes of texts shown on the event icons and the duration tails,
--  the size of the tip points.
+- the size of the tip points.
 
 ### SE volume
 
@@ -4616,6 +4685,7 @@ In addition to the methods listed here, each subclass has their own methods for
 - `#time`, `#time=`: getter and setter of event time. For events other than `group`, get and set the time in beats;
   for `group`, getter gets the time of the earliest event,
   and setter translates all contained events in time to set the time of the earliest event.
+- `#duration`, `#duration=`, `#end_time`, `#end_time=`: getter and setter of duration for perdurant events; setting the end time sets the duration by subtracting start time.
 - `#channel`, `#channel=`: not valid for `group`.
 - `#events`, `#color`, `#color=`: only valid for `group`.
 - `#delete`.
@@ -4698,6 +4768,8 @@ Sometimes one needs to represent a rational number in JSON.
 It is represented as a 3-tuple of numbers,
 the 3 numbers respectively being the integer part, the numerator of the frational part,
 and the denominator of the fractional part.
+The integer part is always the floor of the number, whether the number is positive or negative.
+For example, the integer part of $-1/2$ is $-1$.
 
 This file format may not be optimal. Improve it if you think you have better ideas.
 
@@ -4959,7 +5031,7 @@ and it possibly contain extra fields for parameters.
 
 - `emptyMetadata`
 - `irregularDifficulty`
-- `requiredFingers`: extra field `fingers`.
+- `requiredFingers`: extra field `fingers` and `ignoreDrag`.
 - `outOfBoundaryNotes`: extra field `bgNotes`.
 - `shortHold`: extra field `seconds`.
 - `shortBgPattern`: extra field `seconds`.
```
