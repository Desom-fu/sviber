# IMPLEMENTATION_v26

本文件按 `PROMPT-v25.md → PROMPT-v26.md` 的差异清单逐条记录 v26 的实现内容、涉及文件、实现方式与验证结果。发布版本：v0.17.0。

原始统一 diff 见 `dev-notes/PROMPT-v25-v26.diff`（与 `{SCRATCH}/PROMPT-v25-v26.diff` 同源）。宏 API 为破坏性改动，不保留旧名兼容。

## 差异清单与实现状态（逐条）

| # | 类型 | 差异条目 | 实现情况 |
|---|---|---|---|
| 1 | 新增 | 波形区可改为频谱图（链到 Spectrogram 设置） | 已实现。`editor.spectrogram.show` 为真时 `_drawSpectrogram` 替换波形；`blitSpectrogram` 用 `drawImage` 绘制，避免 `putImageData` 忽略 dpr `setTransform` |
| 2 | 修改 | 滚动条热力图忽略停用通道与停用事件 | `scrollbarRecordsForProject` 过滤 `channel.active === false` 与 `event.active === false` |
| 3 | 新增 | 选中事件亮红（未锁）/品红（已锁）竖线；位于热力图之上、可见范围之下 | `selectedEventLineColor` + `_drawSelectedEventScrollbarLines` |
| 4 | 新增 | A-B 标记绘制顺序：可见范围之上、当前时间之下 | `_drawScrollbar` 先画绿条再画 A-B |
| 5 | 新增 | 吸附器竖线位于选中事件线之下、热力图之上 | 仍在选中事件线之前调用 `_drawSnappeeScrollbarMarks` |
| 6 | 新增 | 书签亮橙竖线；与 A-B 同层，当前时间之下 | `_drawBookmarkScrollbarLines`，颜色 `#ff8c00` |
| 7 | 新增 | 属性面板正在编辑的字段消失时提交 | `flushInspectorEdits` 在 `InspectorPanel.render` 重建前触发 `change` |
| 8 | 修改 | 通道面板：隐藏为灰色（原停用为灰） | `.channel-item.is-hidden` 用 `--text-muted` |
| 9 | 修改 | 通道面板：停用为删除线 | `.channel-item.is-inactive { text-decoration: line-through }` |
| 10 | 修改 | 高亮的是当前通道（不是 “active channel” 措辞） | 代码本就用 `currentChannel`；文档同步 |
| 11 | 新增 | 工程路径已知时渲染默认 `${projectFolder}/${chartFileNameWithoutExt}.mkv` | `defaultRenderOutputPath` |
| 12 | 修改 | nickname：上次填写；首次用 charter | `renderNicknameDefault` + `sviber.renderDefaults` |
| 13 | 修改 | avatar：上次填写 | 同上 |
| 14 | 修改 | 未用的 avatar 输入隐藏而非禁用 | 表单 `hidden` 谓词 `avatarFieldHidden` |
| 15 | 新增 | 确认后保存 avatar 相关默认值 | `saveRenderDefaults` |
| 16 | 修改 | 筛选文本：区分大小写、正则 | `matchFilterText` |
| 17 | 新增 | 筛选通道（不能选停用通道） | `activeFilterChannels` |
| 18 | 新增 | 筛选提示点生成类型 | `enableSpawnType` + inherit/chain/drop/none |
| 19 | 新增 | 筛选结果：仅选择 / 加入 / 从选择移除 | `applyFilterSelection` → `selectEvents` 的 replace/add/remove |
| 20 | 移动 | 细分 1–9 与 Other…（0）从 Music 挪到 Timing（快捷键不变） | `commands.js` 菜单项移动，命令 id 仍为 `music.subdivision*` |
| 21 | 新增 | Timing 菜单下细分说明（从 Music 迁来） | 四语手册 Timing 表 |
| 22 | 新增 | 歌词导入去掉首尾空白（`Never ` → `Never`） | `cleanText` 只 trim 边缘，不折叠内部空白 |
| 23 | 新增 | Seek to…（G）+ 书签按钮 + 可见范围跟随 | `visibleRangeAfterSeek` + `showSeekToDialog` |
| 24 | 删除 | Music 菜单中的细分项 | 已从 Music 菜单移除 |
| 25 | 新增 | Bookmark…（Shift+B），允许空名，有删除 | `upsertBookmark` / `deleteBookmark` |
| 26 | 新增 | Music 菜单 Spectrogram… | `showSpectrogramDialog` |
| 27 | 新增 | Seek to… 行为说明 | 已实现并写入手册 |
| 28 | 删除 | Music 下细分文档（改到 Timing） | 四语手册已改 |
| 29 | 新增 | Bookmark… 对话框说明 | 已实现并写入手册 |
| 30 | 新增 | Spectrogram…：show 默认关、blackAsHigh 默认关、窗宽 5ms 存秒、高斯窗、0–5000 Hz、50 dB；颜色 `1 + intensity_dB / dynamic_range`；分辨率随视觉尺寸 | `js/core/spectrogram.js` |
| 31 | 新增 | 帮助文档含示例宏（以 Ruby 为主） | 四语手册 Example macros / 示例宏 |
| 32 | 修改 | 所有检查忽略停用事件和停用通道 | `buildContext` 的 `leafEvents` 同时过滤两者 |
| 33 | 新增 | `Chart::metadata` 不可变 Data | JS `Object.freeze`；Ruby `Data.define` |
| 34 | 新增 | `Channel::tip_point_switch(time, map)` | JS/Ruby 均调用 `writeTipPointSwitch` |
| 35 | 修改 | Channel `#active` / `#active=` | JS setter；Ruby `active`/`active=` |
| 36 | 修改 | Event `#perdurant?` / `#textable?` / `#background?` 取代 `#have_duration?` / `#have_text?` | JS/Ruby 就地改名，无别名 |
| 37 | 新增 | Event lock 访问器 | `locked`/`lock`/`unlock` |
| 38 | 新增 | Event active 访问器 | `active`/`activate`/`deactivate` |
| 39 | 新增 | Event `#tp` / `#tp=` | JS getter/setter；Ruby `alias` |
| 40 | 修改 | 措辞 “events other than group” | 手册与实现一致 |
| 41 | 新增 | JSON `editor.spectrogram` 对象 | `normalizeSpectrogram` + `serializeSviber` |
| 42 | 新增 | JSON `event.active` | v25 已有；本版 round-trip 测试钉死 |
| 43 | 新增 | 无运行时 `.nw` 不含原生模块与 FFmpeg | `shouldIncludePackagedFile`；`PACKAGE_ONLY` 不拷 Node/FFmpeg/.node |
| 44 | 新增 | 运行时原生模块按 NW.js Node 重建，开发依赖按宿主 Node；Nix 同样 | `nativeRebuildSpec`；`package.yml` `npm_config_runtime=node-webkit`；`default.nix` 注释 |
| 45 | 新增 | MCP 可执行文件、套接字、同意警告、工具列表 | `js/mcp/*`（编辑器侧 `handleEditorMcpTool` 覆盖全部实例工具）、`sviber-mcp`、`~/.sviber/${pid}.sock` |
| 46 | 新增 | `skills/sviber/SKILL.md` | 宏系统、能/不能做的事、EN/ZH/JA 术语 |

## 主要实现说明

### 频谱图

- 设置存在谱面 `editor.spectrogram`。对话框以毫秒输入窗宽，落盘为秒。
- STFT 复用 `js/dsp/fft.js` 与 `createWindow(..., "gaussian")`。时间列数 = 像素宽，频率行数 = 像素高；窗长由设置决定，FFT 尺寸随高度零填充。
- 可见范围内峰值记为 0 dB，颜色 `spectrogramColor`。
- `PixiCanvasSurface.render` 对绘制回调做 `setTransform(dpr, …)`，坐标是 CSS 像素。`putImageData` 忽略该变换，会在 dpr=2 时把 CSS 尺寸的频谱画进设备像素角上。`js/render/spectrogram-blit.js` 的 `blitSpectrogram` 先把 `ImageData` 放到离屏 canvas，再用 `drawImage` 画到 CSS 矩形，让 dpr 变换生效。`tests/spectrogram.test.mjs` 断言目标 context 只收到 `drawImage`、收不到 `putImageData`。

### 滚动条叠层

绘制顺序：热力图 → 吸附器 → 选中事件线 → 可见范围绿条 → A-B 与书签 → 当前时间黄线。

### 宏 API（破坏性）

删除 `#have_duration?` / `#have_text?` 与 JS `haveDuration` / `haveText`。Ruby 烟测改为 `textable?`。已重打 `macro-sandbox.bundle.js`。

### MCP

stdio JSON-RPC 与编辑器 Unix 套接字分离。stdio 进程通过 `~/.sviber/${pid}.sock` 把实例工具转给编辑器；编辑器 `_handleMcpSocketLine` 一律调用 `handleEditorMcpTool`（`js/mcp/mcp-editor-handlers.js`），覆盖 `get_open` / `list_macros` / `read_macro` / `create_macro` / `rename_macro` / `edit_macro` / `run_macro` / `run_snippet` / `run_expression` / `undo_last_run` / `get_music_snippet`。

- 全局宏读写 `sviber.macros`（测试可注入 `app.macroStorage`）；工程宏走 `app.files.{list,read,write,rename}ProjectText`。
- JS 宏运行走 shipped `createSviberMacroApi`（与 sandbox 同一套 globals）。Ruby 在无 live sandbox 时抛错。
- 只有 MCP 发起且确实改了谱面核心字段时才允许 `undo_last_run`（内部 `app.undo()`）。
- 音乐片段 ≤256KB 返回 base64 WAV；更大则调用 `app.writeMusicSnippetFile`（默认写 `~/.sviber/snippet-${Date.now()}.wav`）并返回 `{ encoding: "path", path }`。
- `tests/mcp-server.test.mjs` 直接调用 `handleEditorMcpTool`（不把 mock `callInstance` 当作工具已实现的证据）；stdio `tools/call` 的 backend 也转给同一 handler。

打包桌面版写 `sviber-mcp` / `sviber-mcp.cmd`，使用捆绑的 `runtime/node`。

## 测试与验证结果

- `npm test`（ESLint `--max-warnings 0` + `node --test tests/*.test.mjs`）两次均为 **724 通过 / 0 失败**（含 MCP 实例工具与频谱 dpr blit 补测）。
- 按功能命名的新测试文件：
  - `tests/spectrogram.test.mjs`
  - `tests/scrollbar-overlays.test.mjs`
  - `tests/inspector-submit-on-disappear.test.mjs`
  - `tests/channel-panel-hidden-inactive.test.mjs`
  - `tests/render-path-avatar-persistence.test.mjs`
  - `tests/select-filter-modes.test.mjs`
  - `tests/seek-to.test.mjs`
  - `tests/bookmarks.test.mjs`
  - `tests/checks-ignore-inactive.test.mjs`
  - `tests/macro-metadata.test.mjs`
  - `tests/macro-tip-point-switch.test.mjs`
  - `tests/macro-trait-rename.test.mjs`
  - `tests/runtime-free-nw.test.mjs`
  - `tests/mcp-server.test.mjs`
  - `tests/lyrics-whitespace.test.mjs`
  - `tests/v26-help-shortcuts.test.mjs`
- CLI：`node js/cli/cli-main.js --version` 输出 `sviber 0.17.0`。

## 原始 diff

完整 unified diff 保存在 `dev-notes/PROMPT-v25-v26.diff`。下文为同一文件内容，便于后续比对。

```diff
diff --git a/dev-notes/PROMPT-v25.md b/dev-notes/PROMPT-v26.md
index 8b61959..4cf7ffb 100644
--- a/dev-notes/PROMPT-v25.md
+++ b/dev-notes/PROMPT-v26.md
@@ -253,6 +253,7 @@ You should stick to what is specified in this document.
 
 The waveform is a graphical representation of the current music.
 The waveform is shown in a gray color.
+The user may choose to display a spectrogram here instead per [settings](#spectrogram).
 It does not overlap with the channels in space.
 At its bottom, a horizontal dark gray line is drawn to visually separate it from the channels.
 
@@ -556,7 +557,7 @@ The user can interact with the line using mouse to move it to other time across
 During the interaction, the current time is always snapped to beat subdivisions.
 
 The background of the scroll bar is colored according to the density of non-`drag` notes
-(total number of `tap`, `hold`, `flick` events per second)
+(total number of `tap`, `hold`, `flick` events per second; inactive channels and inactive events are ignored)
 to present a heat map.
 Time with larger note density is colored with brighter red color,
 and time with lower note density is colored with dark gray.
@@ -569,13 +570,25 @@ One green horizontal line connects the two vertical lines.
 The user can interact with either green vertical lines to move it to change the visible range.
 The user can interact with the horizontal green line to move both ends.
 
+Bright red (for unlocked events) or magenta (for locked events) lines
+are drawn at the times of selected events.
+The drawing order of the lines is below the visible range indicator and above the heat map.
+They are not interactable.
+
 If there is at least one A-B loop mark, draw a blue vertical line indicating the position for every mark.
 If there are two A-B loop marks, draw a translucent filled blue rectangle indicating the range between the two marks.
 In any case, they are not interactable on the scroll bar.
+The drawing order of the marks and the rectangle is above the visible range indicator
+and below the current time indicator.
 
 When a snappee is selected,
 draw translucent vertical lines of the same color of the color of the snappee,
 marking the times of events snapped to the snappee.
+The drawing order of the lines is below the red/magenta lines for selected events and above the heat map.
+
+For every bookmark, draw a bright orange line at its time.
+They are not interactable.
+The drawing order is above the visible range indicator and below the current time indicator.
 
 The mouse interaction priorities: bright yellow line > two vertical green lines > horizontal green line.
 
@@ -1120,6 +1133,9 @@ When the user hits <kbd>Enter</kbd> while focused on an input field in the inspe
 apply the change in this input field.
 When the user hits <kbd>Esc</kbd> while focused on an input field,
 unfocus it and restore the value in the input field.
+When an edited input field disappears for whatever reason
+(e.g., selecting a different event or switching to a different panel),
+submit the edit.
 
 When no events are selected, display a gray text saying that no events are selected.
 
@@ -1181,9 +1197,10 @@ Clicking an item in the channels panel changes the current channel to the clicke
 
 An item in the channels panel displays a name.
 The user can double click an item in the channels panel to edit the name of the channel in a popup form.
-The name is gray if the channel is inactive.
+The name is gray if the channel is hidden.
+The name has a strikethrough if the channel is inactive.
 
-The active channel is highlighted in the channels panel.
+The current channel is highlighted in the channels panel.
 The highlight style aligns with the selection style in the snappees panel.
 
 ### Snappees panel
@@ -1988,6 +2005,8 @@ Also properly set `assetsDir` so that sunniesnow-record reuses the fonts bundled
 instead of downloading them.
 
 The popup form has an input field for the output path in the local filesystem.
+If a project is currently open and its local directory path is known,
+the default path is `${projectFolder}/${chartFileNameWithoutExt}.mkv`.
 Near the input field, there is a "Browse" button for using a file dialogue to pick the path.
 Then, there are input fields for customizable options
 that will be passed to sunniesnow-record.
@@ -1995,10 +2014,12 @@ Note that not every option accepted by sunniesnow-record should customizable.
 
 For rendering video, the customizable options are:
 
-- `nickname`: Use the chart's `charter` property as default.
-- `avatar`.
+- `nickname`: Use the value the user filled in last time as default.
+  If this is the first time, use the chart's `charter` property as default.
+- `avatar`: Use the value the user filled in last time as default.
 - `avatarOnline`, `avatarUpload`, `avatarGravatar`:
-  Depending on which value is set for `avatar`, at most one input field is enabled.
+  Depending on which value is set for `avatar`, at most one input field is shown.
+  Fill in the value the user used last time.
 - Whether to use bundled FFmpeg. This option does not appear if bundled FFmpeg is not available
   (e.g., when directly running with `nw .` in the source repo or if the FFmpeg bundling was disabled when the build script ran).
 - `speed`: default 2, regardless of editor preferences.
@@ -2018,6 +2039,9 @@ For rendering cover, the customizable options are:
   There is a diamond shape area indicating the resultant part of the image shown as the cover theme image,
   outside which the sprite appears darkened.
 
+The values for avatar-related fields are saved as the default values
+for the next time the popup form for rendering video/cover opens.
+
 After confirming the popup form, show another popup form while waiting for the rendering.
 If rendering video, show a progress bar
 (empty when rendering the zeroth frame and full when rendering the last frame)
@@ -2199,14 +2223,22 @@ These are the available filters:
 
 - Types (checkboxes for each type: Tap, Hold, etc.)
 - Time (two rational numbers to specify a beat range)
-- Text (does the note text contain this string (case insensitive)?)
+- Text (does the note text contain this string?), with additional checkboxes
+  for whether the search is case sensitive and whether regex is enabled.
 - Duration (two rational numbers to specify a range of durations)
 - Has simultaneous event (does this event have a simultaneous event among the following types? checkboxes for each type)
+- Channel (which channel the event is in; cannot select inactive channels)
+- Tip point spawn type (checkboxes for each type).
 
 Each filter has a checkbox to specify whether this filter is enabled.
 The final filter is the conjunction of all enabled filters.
 The input fields of one filter are grayed out if this filter is not enabled.
 
+There is an additional selection for how to deal with the filtered events:
+select only filtered events,
+add filtered events to the current selection,
+or remove filtered events to the current selection.
+
 Selection operation are also items in the history panel.
 
 #### Delete
@@ -2231,6 +2263,14 @@ The "Timing" menu has the following submenu items:
 - BPM change... (<kbd>M</kbd>) (`../maker/svg/icons/bpm-change.svg`)
 - Bar line (<kbd>R</kbd>) (`bar-line.svg`)
 - (separator)
+- Set subdivision to 1 beat (<kbd>1</kbd>) (`../maker/svg/icons/time-lattice-1.svg`)
+- Set subdivision to 1/2 beats (<kbd>2</kbd>) (`../maker/svg/icons/time-lattice-2.svg`)
+- Set subdivision to 1/3 beats (<kbd>3</kbd>) (`../maker/svg/icons/time-lattice-3.svg`)
+- Set subdivision to 1/4 beats (<kbd>4</kbd>) (`../maker/svg/icons/time-lattice-4.svg`)
+- Set subdivision to 1/6 beats (<kbd>6</kbd>) (`../maker/svg/icons/time-lattice-6.svg`)
+- Set subdivision to 1/8 beats (<kbd>8</kbd>) (`../maker/svg/icons/time-lattice-8.svg`)
+- Other subdivisions... (<kbd>0</kbd>)
+- (separator)
 - Copy timing information
 - Paste timing information
 
@@ -2382,6 +2422,19 @@ then the times that can be snapped to are 0, 1/2, 1, 1+1/2, 1+2/3,
 2+1/6, 2+2/3, 3+1/6, etc. beats.
 They correspond to the [beat lines](#beat-lines) in the timeline.
 
+#### Set subdivision to 1 beat, Set subdivision to 1/2 beats, Set subdivision to 1/3 beats, Set subdivision to 1/4 beats, Set subdivision to 1/6 beats, Set subdivision to 1/8 beats
+
+Change the current beat subdivision.
+
+There are keyboard shortcuts from <kbd>1</kbd> to <kbd>9</kbd>, for nine different subdivisions,
+but only some of them are listed in the submenu so as not to clutter the submenu.
+They are listed in [keyboard shortcuts](#keyboard-shortcuts), however.
+
+#### Other subdivisions...
+
+Open a popup form for the user to set a beat subdivision.
+It allows the user to input a positive integer $n$, and the beat subdivision is set to $1/n$ beats.
+
 #### Copy timing information
 
 Copy the [timing information](#timing-field) of the chart as JSON into the clipboard.
@@ -2654,6 +2707,9 @@ Never gonna let you down
 (assuming zero offset) and then quantized to subdivisions.
 A `bigText` event is created at 16.780 s, ending at 20.500 s
 (assuming zero offset) and then quantized to subdivisions.
+For each imported text, surrounding whitespace characters are stripped.
+In other words, the texts of the `tap` events should be
+`Never`, `gonna`, and `give` (instead of `Never `, `gonna `, and `give`).
 
 The $i$th (zero-based) line of `tap` events are created at y coordinates $(-1)^i\cdot12.5$,
 and the $j$th (zero-based) `tap` event in a line is created at x coordinate $(-(n-1)/2+j)\cdot25$ if $n\le 9$
@@ -3179,16 +3235,10 @@ The "Music" menu has the following submenu items:
 - Seek backward (<kbd>,</kbd>)
 - Seek forward by 3 s (<kbd>Ctrl</kbd>+<kbd>.</kbd>)
 - Seek backward by 3 s (<kbd>Ctrl</kbd>+</kbd>,</kbd>)
+- Seek to... (<kbd>G</kbd>)
 - (separator)
 - Set/clear A-B loop marks (<kbd>L</kbd>)
-- (separator)
-- Set subdivision to 1 beat (<kbd>1</kbd>) (`../maker/svg/icons/time-lattice-1.svg`)
-- Set subdivision to 1/2 beats (<kbd>2</kbd>) (`../maker/svg/icons/time-lattice-2.svg`)
-- Set subdivision to 1/3 beats (<kbd>3</kbd>) (`../maker/svg/icons/time-lattice-3.svg`)
-- Set subdivision to 1/4 beats (<kbd>4</kbd>) (`../maker/svg/icons/time-lattice-4.svg`)
-- Set subdivision to 1/6 beats (<kbd>6</kbd>) (`../maker/svg/icons/time-lattice-6.svg`)
-- Set subdivision to 1/8 beats (<kbd>8</kbd>) (`../maker/svg/icons/time-lattice-8.svg`)
-- Other subdivisions... (<kbd>0</kbd>)
+- Bookmark... (<kbd>Shift</kbd>+<kbd>B</kbd>)
 - (separator)
 - Subtract speed by 0.1 (<kbd>[</kbd>)
 - Add speed by 0.1 (<kbd>]</kbd>)
@@ -3198,6 +3248,8 @@ The "Music" menu has the following submenu items:
 - Set speed to 1 (<kbd>Ctrl</kbd>+<kbd>1</kbd>) (`../maker/svg/icons/speed-1.svg`)
 - Other speeds... (<kbd>Ctrl</kbd>+<kbd>0</kbd>)
 - (separator)
+- Spectrogram...
+- (separator)
 - Zoom in (<kbd>Ctrl</kbd>+<kbd>=</kbd>) (`../maker/svg/icons/zoom-in.svg`)
 - Zoom out (<kbd>Ctrl</kbd>+<kbd>-</kbd>) (`../maker/svg/icons/zoom-out.svg`)
 
@@ -3293,6 +3345,16 @@ The change in the visible range is also the same as what happens when the user s
 Increment or decrement the current time by 3 seconds.
 If the music is not playing, snap to the closest beat subdivision.
 
+#### Seek to...
+
+Show a popup form to enter a rational number to specify a time in beats.
+Below the input fields are buttons, each of which shows the name and time of a bookmark,
+clicking which sets the value of the input fields to the time of the corresponding bookmark.
+Confirming the popup form sets the current time to the specified time.
+If the current time is initially within the visible range, change the visible range
+so that the current time does not move visually in the timeline;
+otherwise, the visible range does not change.
+
 #### Set/clear A-B loop marks
 
 If there are currently no A-B loop marks, create one A-B loop mark at the current time.
@@ -3306,18 +3368,13 @@ The earlier one and the later one of the two A-B loop marks are called the A mar
 
 This operation is grayed out while the music is playing.
 
-#### Set subdivision to 1 beat, Set subdivision to 1/2 beats, Set subdivision to 1/3 beats, Set subdivision to 1/4 beats, Set subdivision to 1/6 beats, Set subdivision to 1/8 beats
-
-Change the current beat subdivision.
-
-There are keyboard shortcuts from <kbd>1</kbd> to <kbd>9</kbd>, for nine different subdivisions,
-but only some of them are listed in the submenu so as not to clutter the submenu.
-They are listed in [keyboard shortcuts](#keyboard-shortcuts), however.
-
-#### Other subdivisions...
+#### Bookmark...
 
-Open a popup form for the user to set a beat subdivision.
-It allows the user to input a positive integer $n$, and the beat subdivision is set to $1/n$ beats.
+Show a popup form for editing/creating a bookmark at the current time.
+The popup form has an input field for editing the name of the bookmark.
+An empty name is acceptable.
+In addition to the usual confirmation button and the cancelation button,
+there is also a deletion button, which deletes the bookmark.
 
 #### Subtract speed by 0.1, Add speed by 0.1
 
@@ -3337,6 +3394,41 @@ They are available in the [keyboard shortcuts](#keyboard-shortcuts) list, howeve
 Open a popup form for the user to set a playback rate.
 It allows the user to input a number that is at least 0.1.
 
+#### Spectrogram...
+
+Show a popup form for modifying settings about the spectrogram.
+It has the following input fields.
+
+There is a checkbox for showing the spectrogram.
+Checking it replaces the waveform in the timeline with the spectrogram.
+Otherwise, the spectrogram is not visible.
+It is not checked by default.
+
+There is a checkbox for using black for high intensity.
+White is for high intensity if it is unchecked.
+The rationale for this setting is that users accustommed to Praat may like this.
+It is not checked by default.
+
+Window width for STFT.
+The input field is for entering the time in milliseconds, but the data stored in the chart file is in seconds.
+Default is 5 ms.
+
+Window shape for STFT.
+Default is Gaussian.
+
+Frequency range. Default is 0 to 5000 Hz.
+
+Dynamic range. Default is 50 dB.
+
+In the spectrogram, the bottom is the lowest frequency in the set frequency range,
+and the top is the highest frequency in the set frequency range.
+Suppose that the sample with the highest intensity in the visible range of time and frequency is 0 dB.
+Then, the color of each sample is `1 + intensity_dB / dynamic_range`,
+where `1` is white and `0` is black (if the checkbox for using black for high intensity is not checked).
+Any value in between is interpolated linearly between black and white.
+Everything negative is the same as zero.
+The time resolution and frequency resolution dynamically changes according to the current visual size of the spectrogram in the timeline.
+
 #### Zoom in, Zoom out
 
 Change the visible range of the timeline.
@@ -3387,6 +3479,7 @@ Open a page that contains documentation about how to use sviber.
 You need to write the documentation yourself in all languages mentioned in [internationalization](#internationalization).
 The documentation should be very detailed, explaining every usage detail of the editor,
 such as what every menu item does and what every keyboard shortcut is.
+It should also contain example macros (focus on Ruby).
 However, it should not include implementation details.
 
 Whenever any part of this prompt file updates that affect how the user should use sviber,
@@ -3741,6 +3834,7 @@ This section explains all types of checks,
 including what they do, their parameters and their default parameter values,
 and where to navigate to when the user clicks a violation in the checks panel.
 All checks are enabled by default.
+All checks ignore inactive events and inactive channels.
 
 ### Empty title, artist, or charter
 
@@ -4352,6 +4446,9 @@ For example, calling `channel.select` after `channel.delete` raises an error.
 
 `Chart` is a static object that stores the state of opened chart and the editor.
 
+- `::metadata`: an immutable `Data` containing the attributes
+  `title`, `artist`, `charter`, `difficulty_name`, `difficulty`,
+  `difficulty_color`, `difficulty_sup`, `music`, `image`.
 - `::current_time`, `::current_time=`.
 - `::channels`: array of `Channel` objects.
 - `::current_channel`.
@@ -4428,11 +4525,12 @@ it also have these methods to modify itself, and they all return `self`:
 - `::get_by_id(id)`: get a channel by ID number.
 - `::current`: get the current channel, same as `Chart::current_channel`.
 - `::list`: same as `Chart::channels`.
+- `::tip_point_switch(time, map)`: create/edit a tip point switch at `time`, where `map` should support method `[](channel)`.
 - `#move_up`, `#move_down`: reordering channels.
 - `#name`, `#name=`.
 - `#color`, `#color=`.
 - `#id`.
-- `#activate`, `#deactivate`, `#active?`: change and get active status.
+- `#activate`, `#deactivate`, `#active?`, `#active`, `#active=`: change and get active status.
 - `#current?`: is this the current channel?
 - `#select`: set as the current channel; returns self.
 - `#delete`.
@@ -4468,15 +4566,18 @@ it also have these methods to modify itself, and they all return `self`:
 - `::new`: create new event; signature depends on type.
   Example is `::new(type: :bg_note, channel:, time:, duration:, location:, text:)` for creating a `bgNote` event.
 - `#type`, `#type=`: getter and setter of event type; the setter needs especial care, similar to how type conversion is handled in the [event creation operation](#tap-hold-drag-flick-bg-note).
-- `#movable?`, `#have_time?`, `#have_channel?`, `#have_duration?`,
-  `#have_text?`, `#tip_pointable?`, `#group?`.
+- `#movable?`, `#have_time?`, `#have_channel?`, `#perdurant?`,
+  `#textable?`, `#tip_pointable?`, `#group?`, `#background?`.
+- `#locked`, `#locked=`, `#lock`, `#unlock`, `#locked?`.
+- `#active`, `#active=`, `#activate`, `#deactivate`, `#active?`.
 - `#location`, `#location=`: only valid for movable events. Specially,
   this moves all contained events for `group` events.
 - `#text`, `#text=`: only valid for textable events.
 - `#anchor`, `#anchor=`: only valid in `group` events, setting location without moving contained events.
 - `#tip_point`, `#tip_point=`: getter and setter, accepting `TipPoint` object; only valid for tip-pointable events.
+- `#tp`, `#tp=`: alias of `#tip_point` and `#tip_point=`.
 - `#angle`, `#angle=`: only valid for `flick` events.
-- `#time`, `#time=`: getter and setter of event time. For subclasses other than `group`, get and set the time in beats;
+- `#time`, `#time=`: getter and setter of event time. For events other than `group`, get and set the time in beats;
   for `group`, getter gets the time of the earliest event,
   and setter translates all contained events in time to set the time of the earliest event.
 - `#channel`, `#channel=`: not valid for `group`.
@@ -4587,6 +4688,13 @@ A JSON object with the following fields:
 - `visibleRangeEnd`: float number indicate the visible range end.
 - `timelineChannelOffset`: the vertical scroll position of channels in the timeline.
 - `speed`: playback rate.
+- `spectrogram`: an object with the following keys:
+  - `show`: boolean.
+  - `blackAsHigh`: boolean.
+  - `windowWidth`: number.
+  - `windowShape`: string.
+  - `frequencyRange`: tuple of two numbers.
+  - `dynamicRange`: number.
 - `lockVisibleRange`: boolean.
 - `playSe`: boolean.
 - `playBgNoteSe`: boolean.
@@ -4657,6 +4765,7 @@ Each event is a JSON object with the following fields (nonexhaustive):
   `grid`, `hexagon`, `checkerboard`, `diamondGrid`, `pentagon`, `turntable`, `hexagram`, `comment`, `group`.
 - `selected`: boolean, whether it is selected.
 - `locked`: boolean, whether it is locked.
+- `active`: boolean, whether it is active.
 
 Other fields depend on the type.
 
@@ -5261,15 +5370,24 @@ with redistributable NW.js apps for Windows (x86, x86_64, aarch64),
 Linux (x86_64, aarch64), and macOS (x86_64 and aarch64) in the release assets.
 The distribution bundles are in Zip format for Windows, tar.gz for Linux, and dmg for macOS.
 The filename format is `sviber-${version}-${os}-${arch}.${ext}`.
+
 Also put a `.nw` package without NW.js runtime in the release assets
 for those who wish not to download NW.js binaries.
 The filename format is `sviber-${version}.nw`.
+Because this is not intended to be run using a specific runtime version on a specific platform,
+the native modules will not work,
+so do not include native modules for runtime-free releases.
+Runtime-free releases also should not bundle FFmpeg binaries for platform-independence.
+This means that rendering video/cover will not work on runtime-free releases.
 
 Compile the native modules of `gl` and `canvas` (dependencies from `sunniesnow-record`)
 instead of using precompiled binaries for bundling in the release assets.
 The requirement for the build environment is finicky,
 and you should look at the CI workflow of sunniesnow-record
 and read documentation of `gl` and `canvas` to write the CI workflow properly.
+Notice that native modules in development dependencies should be built against the build-environment Node.js
+while native modules in runtime dependencies should be built against the NW.js bundled Node.js.
+The same quirks need to be taken care of when building the Nix package.
 
 Because sunniesnow-record uses FFmpeg CLI, you also need to bundle FFmpeg binaries in the release assets.
 Downloading and bundling FFmpeg binaries should be cancelable by setting an environment variable
@@ -5288,6 +5406,52 @@ When you are prompted to generate a new release after bug fixes, bump the patch
 When you are prompted to generate a new release after being provided a new version of this prompt file,
 bump the minor version in `package.json` and push a new tag.
 
+### MCP
+
+In the distributed NW.js app, besides the main executable `sviber` for sviber the editor,
+also provide an executable `sviber-mcp` to implement a model context protocol (MCP) server
+for AI agents to communicate with sviber instances.
+
+Every sviber instance creates a Unix domain socket (or its equivalent on non-Unix-like OS) at `~/.sviber/${pid}.sock`.
+This path cannot be customized.
+The socket is for communicating with the MCP server.
+Multiple MCP servers can run at the same time, and each MCP server is connected to all sviber instances.
+When a MCP server wants to connect to a sviber instance,
+show a popup form in the sviber instance to allow or disallow the connection.
+Warn the user that allowing the connection makes it possible
+to make undoable modifications to the chart from outside the editor.
+
+The MCP server provides the following tools:
+
+- Get a list of sviber instances. For all the following tools,
+  a specific sviber instance needs to be specified when making a request.
+- Get what is open:
+  whether it is a chart or a project and the path to the local filesystem.
+- Get a list of global macros and project macros available.
+- Read a macro.
+- Create a macro (global or project).
+- Rename a macro.
+- Edit a macro.
+- Run a macro, and get stdout and stderr.
+- Run a macro code snippet, and get stdout and stderr.
+- Run a macro code expression, and get the return value in JSON format.
+- Undo a macro execution (available only if the last macro run was initiated by the MCP and the macro actually modified the chart).
+- Get a music snippet between two times specified in beats.
+  Depending on whether the snippet is large,
+  either return encoded music binary data in base64 or return a local file path.
+
+You can use a third-party library to write the MCP server, but you do not have to.
+
+The MCP server must run using the same Node.js runtime as the NW.js app
+to avoid wasting space for having two Node.js runtimes bundled in the distribution.
+
+In the source repo of sviber, write `skills/sviber/SKILL.md` and other files if necessary
+for an installable AI skill for using sviber-mcp to assist charting.
+It should include a full description of the macro system,
+a full description of sviber's mechanics and Sunniesnow's mechanics,
+what is possible and what is not possible to do by running macros,
+and translation notes for what every English term is in Chinese and Japanese.
+
 ### Open-source license
 
 Use AGPL-3.0-or-later as the open-source license.

```
