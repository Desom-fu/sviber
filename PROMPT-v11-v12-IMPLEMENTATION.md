# PROMPT v11 -> v12 实施报告

日期：2026-08-21  
目标版本：`0.3.0`

## 1. 阅读与 diff 方法

本次完整逐行读取了 `PROMPT-v11.md` 和 `PROMPT-v12.md`，再按章节、菜单、交互和文件格式逐项核对。文件规模如下：

- `PROMPT-v11.md`：2780 行。
- `PROMPT-v12.md`：3070 行。
- v12 新增重点：Clips 面板、Paste options、Timing 菜单、Group 事件、分组渲染/选择/移动、显示开关、Allow out-of-bound、Live hosting、Keyboard shortcuts 帮助，以及递归事件文件格式。

## 2. v12 完成项

| v12 要求 | 完成内容 | 主要位置 |
| --- | --- | --- |
| 递归 Group 事件 | 新增独立事件树遍历、查找、祖先、后代、边界、同层分组、解组和递归 ID 管理；导出时递归 flatten | `js/core/grouping.js`, `js/core/chart-model.js` |
| Group 操作 | Group/ungroup、删除空 group、通道删除清理空树、移动/复制/变换/删除/时间反转/通道移动递归处理 | `js/app-history-commands.js`, `js/app-event-editing.js`, `js/app-file-workflows.js` |
| Group 视觉 | Timeline、Stage、Scroll view 显示嵌套分组圈；选中 group 显示颜色边界框和 anchor | `js/render/timeline.js`, `js/render/stage-notes.js`, `js/render/scroll-view.js` |
| Group 选择 | 普通点击选择最近 group；双击按一层一层进入临时 scope；scope 无选中后代时退出；inactive channel 不可交互 | `js/render/chart-index.js`, `js/render/stage-interactions.js`, `js/render/timeline.js`, `js/app-event-editing.js` |
| Group anchor | Anchor 独立于普通事件位置移动，子事件保持位置；anchor 可吸附直接子事件或 active snappee | `js/render/stage-interactions.js`, `js/render/stage-notes.js`, `js/app-event-editing.js` |
| Clips | Clips 面板展示缩略图，支持粘贴、重命名、上下排序和删除；片段随 editable JSON 保存 | `js/panels.js`, `js/app-file-workflows.js`, `js/core/chart-model.js`, `index.html` |
| Paste options | 支持复制引用的 channels/snappees，递归重映射嵌套 group 内引用和 ID | `js/app-file-workflows.js` |
| Timing | 新增 Offset/initial BPM 对话框，以及完整 timing JSON copy/paste | `js/commands.js`, `js/app-event-editing.js`, `js/app-file-workflows.js` |
| Editor toggles | 新增 timeline grouping、main-field grouping、tip points、out-of-bound 开关，并同步双语 tooltip | `js/app-core.js`, `js/core/chart-model.js`, `json/i18n.en-US.json`, `json/i18n.zh-CN.json` |
| Live hosting | NW.js HTTP `/sviber.ssc`、WebSocket handshake、文本/控制帧、ping/pong、close、分片帧、`connect`/`update`/`chartUpdate`；忽略 `eventInfoTip` | `js/live-hosting.js`, `js/app-core.js`, `js/app-file-workflows.js` |
| sscharter 版本 | Live reload 导出的 chart 写入 `sscharter: { version: "0.10.1" }`，非 live 导出不写入 | `js/core/chart-model.js`, `js/core/project.js` |
| 帮助和文档 | README 中英文、HTML 手册中英文、快捷键/Group/Clips/Timing/Live hosting/file format 说明 | `README.md`, `README.zh-CN.md`, `docs/index.html` |

## 3. 关键行为说明

### 3.1 Group 数据模型

Group 与普通可移动事件共享 `time`、`channel` 和位置字段，并增加 `color`、`events`。事件树中的每个 group child 都有稳定且全局唯一的 ID。`ChartModel.allEvents()` 默认包括 group，`allEvents({ includeGroups: false })` 只返回叶事件；渲染索引同时维护平面事件记录和祖先表。`ChartModel.exportSunniesnow()` 只导出叶事件和生成的 Tip point placeholder，因此 Sunniesnow 仍接收扁平事件列表。

### 3.2 选择和临时进入

默认命中 group 后代时，`selectionTarget()` 返回最近的直接 group。双击后运行时保存 `groupSelectionScope`，不会写入 chart JSON；渲染索引会把命中目标推进一层。嵌套 group 需要从外到内重复双击。任何提交、历史恢复、工程切换或选择框结束都会检查 scope；scope 对应 group 被删除，或其后代已没有选择时，scope 自动清除。

### 3.3 Anchor 与普通移动

Group anchor 使用独立 hit region 和 drag 类型。普通 group 拖动会递归移动 group 与后代；anchor drag 只移动 selected group 的 anchor，不改变 descendants 的解析位置。主交互在当前 group 的直接 movable children 中优先寻找可吸附目标，然后才查询 active snappee；提交时只把直接交互的 anchor 附着到 snappee。

### 3.4 剪贴板和 Clips

复制数据仍使用相对最小 beat 和最小 channel 的格式，同时扩展为：

- `events`：可包含嵌套 group 的相对事件树；
- `channels`：相对通道偏移和 channel attributes；
- `snappees`：事件位置及 Tip point spawn 引用的吸附器；
- `version: 1`：内部 clipboard 标识。

普通 Ctrl+V 只粘贴事件；Paste options 可按 checkbox 复制 channels 和 snappees，并递归改写 group children 的 event/channel/snappee IDs。Clip 使用同样的数据结构，thumbnail 只绘制叶 movable events。

### 3.5 Live hosting

Live hosting 只在 NW.js 可用。HTTP server 在内存中按请求生成当前 `.ssc`，不写临时文件；WebSocket server 完成 RFC 6455 握手并支持短帧、16-bit/64-bit 长度、客户端 masked payload、continuation、ping/pong 和 close。客户端发送 `connect` 时返回当前连接信息；`eventInfoTip` 被有意忽略；编辑提交后广播 `chartUpdate` 和 `update`。

## 4. v11 兼容性

v11 的 PWA、JSON i18n、icon-only status controls、Read-only、Fullscreen、Scroll View 比例、Tip point 修复和宏系统保持不变。旧文档中“复制吸附器后粘贴”现在由 v12 的“Paste with options...”覆盖，但 `Ctrl+Shift+V` 仍保留复制 snappees 的快捷路径。旧的平面 event JSON 会被正常导入为根事件；没有 `clips` 时按空数组处理。

## 5. 测试与验证

本次新增 `tests/v12-features.test.mjs`，覆盖：

- nested group recursive IDs、bounds、clips round-trip、Sunniesnow flatten；
- sscharter WebSocket frame and handshake contract；
- one-level-at-a-time group selection scope；
- removing a channel prunes empty nested groups。

已执行并通过：

- `node --test tests/v12-features.test.mjs tests/core.test.mjs`（36/36）
- `npm run check:size`
- `npm test`（140/140）
- `npm run verify:browser`（包含模块化启动、偏好持久化、宏、交互、画布像素检查、100k 事件播放/编辑性能检查；两项均 0 丢帧）
- `npm run build`（生成 `build/sviber-0.3.0.nw` 和 Windows x64 NW.js 包）
- `git diff --check`

发布元数据已更新到 `0.3.0`，PWA cache 版本更新到 `sviber-v35`，主脚本 cachebuster 更新到 `v25`。提交、annotated tag 和远端 push 状态在最终交付报告中确认。

## 6. 提交信息

```text
feat: complete prompt v12 editor features

Add recursive groups, clips, paste options, timing tools, grouping views,
out-of-bounds controls, and sscharter live hosting.

Update bilingual help and implementation documentation, add v12 coverage,
and prepare the 0.3.0 release.
```
