# PROMPT-v20 实现文档

本文档逐条对照 `dev-notes/PROMPT-v19.md` 与 `dev-notes/PROMPT-v20.md` 的 diff（共 4 个 hunk、15 处插入、8 处删除），说明每一项新增/修改的实现方式、涉及文件与验证结果。

## Diff 清单与实现

### 1. ASCII 布局图：时间轴行变窄、状态面板列变宽

- **diff**：PROMPT 内的 ASCII 布局示意图中，Timeline 一行的左右边距收窄、Status panel 列加宽。
- **性质**：纯示意图更新，反映的是已在本仓 v0.10.x 落地的"状态面板与下方面板等宽"改动（`.timeline-row` 右列为 `clamp(260px, 24vw, 320px)`）。无代码改动。
- **验证**：现行 CSS 与示意图一致。

### 2. 状态面板基本信息：同一行、无标签、可换行

- **diff**：状态面板的时间/拍/速度三个数据显示为同一行（示例 `1:07.814    121+0/4    0.5`），不带标签以节省空间；一行放不下时按整项换行。
- **实现**：
  - `index.html`：三个 `.status-item` 移除 `<dt data-i18n="status.*">` 标签，`<dl>` 加 `status-readouts` 类；`#status-time`/`#status-beat`/`#status-speed` 三个 ID 不变（`js/app/app-status-view.js` 的 `renderTimeReadouts` 按 ID 写入，无需改动）；悬停提示（`data-tooltip-key="tooltip.*"`）保留。
  - `css/app.css`：新增 `.status-readouts`（`display: flex; flex-wrap: wrap; gap: 0 12px`），`.status-item` 去掉两列网格，`.status-item dd` 加 `white-space: nowrap`——三项作为整值在同一行排列，行宽不足时整项换行。
  - `json/i18n.*`：`status.time`/`status.beat`/`status.speed` 三个标签键不再被 HTML 引用，保留在词汇表中（键的 en/zh 对齐不变）。
- **验证**：`npm test` 全部通过；文档同步见第 6 条。

### 3. 锁定事件不能在时间轴与主编辑区拖动

- **diff**：锁定语义明确补充"Locked events cannot be dragged in the timeline or the main editor field."
- **现状核实**：
  - 主编辑区已在 v0.10.2 落地：`js/render/stage-pointer.js` `_eventPressDrag` 按压锁定事件只选中不启动拖动、`_closestSelectedMovable`/`_flickPressDrag` 跳过锁定、`js/app/app-position-move.js` `_applyPositionMove` 过滤锁定根与锁定后代、`js/app/app-group-anchor-move.js` 过滤锁定 group（均有 `tests/event-lock.test.mjs` 覆盖）。
  - 时间轴：时长尾柄拖动（`_durationPressDrag`）与移动集合（`_selectedLeafEvents`）早已过滤锁定事件，但**按压锁定事件本身仍会启动时间拖动手势**（移动集合为空，表现为一次空拖动）。
- **本次实现**：`js/render/timeline-pointer.js` `_eventPressDrag`：选中处理后，若 `selectionEvent.locked` 则返回 `null`（与主编辑区一致：可选中显示品红，但按下不产生拖动手势）。
- **验证**：`tests/event-lock.test.mjs` 新增 "pressing a locked event in the timeline selects it but never starts a time drag"——锁定事件按压返回 `null` 且选中已发生，未锁定事件照常返回 `type: "event"` 拖动。

### 4. 锁定事件不能在检查面板编辑

- **diff**：锁定语义明确补充"Locked events cannot be edited in the inspection panel."
- **现状核实**：v0.10.0 已落地——`js/app/app-property-editing.js` `applySelectedPropertyMutation` 以 `event.selected && !event.locked` 过滤（注释 "v19: locked events behave as if they were not selected, so the inspector skips them"），锁定事件如同未选中，检查面板显示灰色提示。
- **本次实现**：无代码改动；补回归测试 `tests/event-lock.test.mjs` "the inspector skips locked events when applying property edits"——同时选中锁定与未锁定事件后改通道，未锁定的移动到目标通道，锁定的保持原通道。

### 5. 翻译规则

- **diff**：明确 artist=曲师、chart=谱面、charter=谱师、bg notes=墨点、tip points=游标、Lyrica=阳春白雪；tap/drag/hold/flick 保持英文原文。
- **现状核实与落地**：
  - `json/i18n.zh-CN.json` 已全部符合：`field.artist`="曲师"、`field.charter`="谱师"、chart 系列均为"谱面"、Lyrica 系列均为"阳春白雪"、墨点/游标早已就位。
  - tap/drag/hold/flick 英文原文：v0.10.4 已修正 checks 字符串（"Hold 过短"、"Tap、Hold、Drag 与 Flick 都必须在谱面边界内。"等）；本次全量复查 zh 词汇表，类型名无残余中译（仅存的"拖动波形"为动词用法、"滑动平均"为数学术语，均非类型名，按规则保留中文）。命名遵循既定风格：首字母大写、中西文之间留空格（盘古之白）。
- **验证**：`grep` 全量核查；`npm test` 通过。

### 6. 内部文档同步

- **实现**：`docs/index.html`（应用内帮助，中英双语）状态面板段落更新：英文 "It shows the time to three decimal places, the current beat ... and the playback speed together on one line without labels, wrapping to more lines when one line cannot fit them..."；中文"时间（三位小数）、按当前细分分母显示的当前拍与播放速度三项数据显示在同一行且不带标签，一行放不下时按整项换行…"。
- **验证**：`tests/documentation.test.mjs` 与 `tests/ui-shell.test.mjs` 相关断言全部通过。

### 7. 附带修复（用户报告，随本版本发布）

- **时间轴 Hold 尾把手被事件遮挡**：`js/render/timeline-drawing.js` 中尾把手原在事件循环内逐个绘制，后绘制的事件会盖住先绘制的把手。改为 `_drawEvents` 收集 `durationHandles`、事件层画完后统一置顶绘制（`_drawDiamond` 自带配色与 save/restore；把手的命中区域 `"duration"` 在时间轴命中优先级中本就高于事件，交互不受影响）。
- **调整 tap 通道后双押线顺序疑未即时更新**：用 playwright 探针与回归测试核查了全部三条改通道路径——检查器频道下拉（`editSelectedProperty`，走 `refreshInteractionPreview` 重建分支）、`Ctrl+Shift+↑/↓`（`moveSelectedChannel`，走 `moveEventsToChannels` 增量路径并调用 `_buildDoubleTapIndexes`）、时间轴箭头移动（`moveEvents` channelDelta，走重建）；三者在当前构建中均即时更新 `tapEventsByTime` 顺序与 `doubleTapPairs` 配对，且增量结果与全量重建一致（像素级探针确认渲染变化）。未能复现报告的现象；已新增回归测试 "changing a tap's channel updates the double-tap pairing order immediately" 锁定三条路径的即时性（该测试同时要求测试桩保留 trait 真实的重建分支，避免假阴性）。

## 验收

- `npm test`（`eslint . --max-warnings 0 && node --test tests/*.test.mjs`）：lint 0 错误，全部测试通过（含 1 项预先存在的环境相关 skip）。
- 新增回归测试 4 项：时间轴锁定按压、检查器锁定跳过、双押线顺序即时更新（三条路径）、以及此前版本延续的锁定拖动覆盖。
- `npm run build`：本地 NW.js 打包成功。
