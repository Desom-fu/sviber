# IMPLEMENTATION_v22

v22 相对 v21 的需求来自 `dev-notes/PROMPT-v21.md` 与 `dev-notes/PROMPT-v22.md` 的逐行 diff（69 行新增、7 行删除），加上发布前追加的三个 bug 修复。本文件按 diff 清单逐条说明改动内容、涉及文件、实现方式与验证结果。

## diff 清单与实现

### 1. 波形底部深灰分隔线
- **需求**：波形底部画一条水平深灰线，把波形与通道区在视觉上分开。
- **文件**：`js/render/timeline-drawing.js`（`_drawChannels` 开头）。
- **实现**：在通道区背景填充之后、以 `#34383d`（与通道分隔线同色系）在 `layout.channels.y` 处横贯整个宽度描一条 1px 线。
- **验证**：`tests/timeline-channel-behavior.test.mjs` 源断言 + 浏览器目测。

### 2. 通道间分隔线在折叠隐藏通道处加粗变亮
- **需求**：两条相邻显示通道之间若隔着一个或多个隐藏通道，分隔线用亮灰并加粗。
- **文件**：`js/render/timeline-drawing.js`（`_drawChannels`）。
- **实现**：显示通道按非隐藏列表相邻；用 `project.channels` 中的序号差判断中间是否有隐藏通道，有则 `#d5dade`、线宽 2.5，否则维持 `#34383d`、1。
- **验证**：同上测试断言 `hiddenBetween ? "#d5dade" : "#34383d"` 与 `hiddenBetween ? 2.5 : 1`。

### 3. 通道隐藏/显示（模型 + 时间轴折叠）
- **需求**：每个通道可隐藏/显示（图标 `show-channel.svg`/`hide-channel.svg`）；隐藏通道在时间轴中被折叠不显示，但不影响其事件在滚动视图与主编辑区的显示。
- **文件**：
  - `js/core/chart-normalize.js`（`normalizeChannels` 增加 `hidden: channel?.hidden === true`，随 `serializeSviber` 自动持久化）；
  - `js/core/chart-model.js`（`addChannel` 默认 `hidden: false`；`duplicateChannel` 传播该标志）；
  - `js/render/timeline-helpers.js`（新增 `visibleTimelineChannels(project)`）；
  - `js/render/timeline.js`（`_visibleChannels`/`_layout`/`revealChannel`/`scrollChannelsBy`/`setState`/`_contentLanePosition` 全部改用折叠后的列表）；
  - `js/render/timeline-pointer.js`（通道区按下、Alt+Shift 瞄准、框选内容坐标、Shift 滚轮判据均用折叠列表）；
  - `js/render/timeline-drawing.js`（通道滚动条、游标检查点签名用折叠列表）；
  - `js/app/app-channel-commands.js`（`setChannelHidden`/`hideCurrentChannel`/`showAllChannels`；隐藏当前通道时按“上方优先”规则移到最近可见通道）；
  - `js/app/app-core.js`、`js/app/app-free-transform.js`（时间轴高度按非隐藏通道数计算）。
- **验证**：`tests/timeline-channel-behavior.test.mjs`（flag 持久化、折叠与 offset 钳制、隐藏/显示命令、当前通道回退）。

### 4. 通道面板：create-channel-above/below 按钮
- **需求**：每个通道条目有“在其上方创建通道”（`create-channel-above.svg`）和“在其下方创建通道”（`create-channel-below.svg`）按钮。
- **文件**：`js/ui/panel-lists.js`（`channelMenuItems`）、`js/app/app-channel-commands.js`（`createChannel(relative, id)` 泛化为锚定任意通道并选中新建通道）、`js/app/app-core.js`（`onCreate` 接线）。
- **实现**：按钮位于条目弹出菜单内（见第 5 条），点击即以该通道为锚创建并选中新通道。
- **验证**：`tests/timeline-channel-behavior.test.mjs`（“creating a channel from a panel item anchors it to that channel”）。

### 5. 三个面板条目的按钮收纳进弹出菜单
- **需求**：通道/吸附器面板条目只保留启用/停用按钮，其余按钮（含隐藏/显示、新建通道等）收进条目旁的小菜单；片段面板条目只保留粘贴按钮。`Esc` 或点击菜单外关闭菜单；点击菜单项（上移/下移除外）也关闭。
- **文件**：`js/ui/item-menu.js`（新增，`makeItemMenuButton`：aria-haspopup 菜单按钮 + 定位在条目旁的弹出菜单，底部空间不足时向上翻转，Esc/外点关闭，`keepOpen` 项例外）、`js/ui/panel-lists.js`（SnappeesPanel/ChannelsPanel 从 panels.js 拆出并改造）、`js/ui/panel-clips.js`、`js/ui/panels.js`（拆分后保留 Inspector 并 re-export）、`svg/icons/menu.svg`（新增竖排三点图标）、`css/app.css`（条目网格 6 列动作位改为 2 列，新增 `.item-menu-popup` 等样式与 `.is-hidden` 弱化样式）、`service-worker.js`（预缓存 `item-menu.js`、`menu.svg`、`show-channel.svg`、`hide-channel.svg`）。
- **验证**：`tests/timeline-channel-behavior.test.mjs`（菜单结构断言：keepOpen 恰为 4 处即上下移；clips 保留 paste + menu）、`tests/clips.test.mjs`（更新为 2 动作列 + `makeItemMenuButton`）。

### 6. 通道菜单：Move above/below within channel（Ctrl+Alt+Up/Down）
- **需求**：重排同通道同时押事件的叠层顺序：从上到下扫描，每个选中事件与紧邻上方未选中事件交换（下移对称）；选择 A（最顶）时置灰；预期结果 BCDA/BADC/ACDB 等与 PROMPT 示例一致。
- **文件**：`js/app/app-channel-commands.js`（`_withinChannelReorder`/`canMoveSelectedWithinChannel`/`moveSelectedWithinChannel`，轻量提交 + 索引重建）、`js/app/commands.js`（`channel.moveAboveWithinChannel`/`channel.moveBelowWithinChannel`）、`js/app/app-command-bindings.js`（动作与置灰条件）。
- **验证**：`tests/timeline-channel-behavior.test.mjs`（四个 PROMPT 示例 + 下移对称 + 不可移动置灰 + 可撤销）。

### 7. 通道菜单：快捷键变更与新增（Ctrl+K / Ctrl+Alt+K / Ctrl+J / Ctrl+Alt+J）
- **需求**：Deactivate channel 改为 `Ctrl+K`（原 `Ctrl+,`），Activate all channels 改为 `Ctrl+Alt+K`（原 `Ctrl+Alt+,`）；新增 Hide channel `Ctrl+J` 与 Show all channels `Ctrl+Alt+J`。
- **文件**：`js/app/commands.js`（定义 + 菜单结构）、`js/app/app-command-bindings.js`、`js/ui/i18n.js` 不涉及、`json/i18n.*.json`（新命令文案）。
- **键位冲突核查**：全量扫描 `COMMAND_DEFINITIONS`，除刻意设计的 `Ctrl+Shift+V` 互斥对（pasteOptions/pasteDuplicateSnappees，由 handleKeyboard 的“禁用命令不遮蔽”规则消解）外无重复；v17 遗留的 `Ctrl+,`（channel.deactivate 与 music.seekBackward3）冲突随本次改动彻底消除；v22 的 `music.seekBackward3` 使用 `Ctrl+,`，通道命令使用 `Ctrl+K`/`Ctrl+Alt+K`/`Ctrl+J`/`Ctrl+Alt+J`。
- **验证**：`tests/commands.test.mjs`（六个通道命令快捷键断言 + 菜单顺序）、重复键扫描脚本输出无冲突。

### 8. Tip point：同通道同时押事件按叠层顺序
- **需求**：同通道同时押多个可挂游标事件时，顺序即时间轴通道叠层顺序：叠在上者（事件数组中靠前）为 previous，叠在下者为 next（取代 v21 的“未定义行为”）。
- **文件**：`js/core/tip-point.js`（`inheritedTipPointSource` 注释明确定义）、`js/render/stage-helpers.js`（`buildTipPointGuides` 注释明确定义）；两者早已按 `time → sequence` 排序，`sequence` 即数组位置即叠层自上而下，行为与规范一致，本次将其固化为明确定义并加回归测试。
- **验证**：`tests/timeline-channel-behavior.test.mjs`（“tip point chains of simultaneous events follow the timeline stacking order”）。

### 9. Mac 键位显示（Ctrl→Command、Alt→Option）
- **需求**：在 MacBook 上快捷键列表、子菜单、tooltip、帮助文档应以 Command/Option 显示。
- **文件**：
  - `js/ui/i18n.js`（新增 `isMacPlatform()`；`shortcut()` 在 Mac 上把 Ctrl 映射为 `shortcut.command`、Alt 映射为 `shortcut.option` —— 覆盖菜单栏 `.menu-shortcut`、工具栏 tooltip 标题、快捷键对话框的 `<kbd>`）；
  - `docs/docs.js`（`localizeShortcutKeys`：手册注入后在 Mac 上把 `<kbd>` 内的 Ctrl/Alt 替换为 Command/Option）；
  - `json/i18n.en-US.json`/`zh-CN.json`（新增 `shortcut.command`/`shortcut.option`，两语言均为 Command/Option）。
- **键盘行为无需改动**：`CommandRegistry.metaAsCtrl` 已使 Ctrl 快捷键在 Mac 上由 Command 触发。
- **验证**：`tests/i18n.test.mjs` 键位对齐（自动）；人工核对 en/zh。

### 10. 帮助文档同步（json/manual.*.json）
- 通道菜单快捷键表：更新 Ctrl+K/Ctrl+Alt+K，新增“通道内上移/下移”与“隐藏/显示所有通道”两行（en/zh）。
- 面板描述：条目只保留主按钮 + 菜单按钮、菜单内容与关闭规则、隐藏通道语义、折叠分隔线加粗变亮（en/zh）。
- 快捷键对话框描述：追加 Mac 的 Command/Option 说明（en/zh）。
- Alt+Shift 拖动描述：改为“移到鼠标所在位置（绝对定位）且无最小移动阈值”（en/zh）。

## 追加 bug 修复（发布前用户报告）

### A. 播放中缩放可视范围时当前时间位置跳回
- **根因**：播放中已武装的 `playFollowOffset` 会在下一帧把可视范围滑回缩放前的锚点。
- **文件**：`js/app/app-timeline-navigation.js`（`navigateWheel` 缩放分支在 `setVisibleRange` 后按新几何重新武装 `playFollowOffset.value`；正放为 `current - beginning`，倒放为 `end - current`；已禁用（false）或未武装（null）的偏移不受影响）。
- **验证**：`tests/timeline-view.test.mjs`（“timeline zoom during playback re-arms the follow offset to keep the playhead position”：正放/倒放/禁用三态）。

### B. 时间轴 Alt+Shift 拖动改为绝对定位
- **需求**：与主编辑区 Shift 拖动一致，直接把事件移到鼠标位置，而不是按相对按下点的位移移动。
- **文件**：`js/render/timeline-pointer.js`（`_altShiftMoveDrag` 恒定 `absoluteBeatSnap: true` 并新增 `absoluteChannel: true` 与 `governingLaneIndex`；`_moveEvents` 与 `_pointerUp` 的通道增量按“指针所在轨道 − 主控事件轨道”计算）。
- **验证**：`tests/timeline-view.test.mjs`（位移与通道增量断言：x=400 → 拍 40，指针轨道 1.4 → 通道增量 1）。

### C. 时间轴 Alt+Shift 拖动与主区 Shift 拖动去除最小拖动阈值
- **需求**：这两个手势不应有 3 像素最小拖动距离（与普通拖动不同）。
- **文件**：`js/render/stage-pointer.js`（`_emptyAreaDrag` 的 Shift 分支打 `noThreshold: true`；`_pointerMove` 对 `noThreshold` 拖动任何移动都置 `pointerMoved`）、`js/render/timeline-pointer.js`（`_altShiftMoveDrag` 打 `noThreshold: true`；`_pointerMove` 同样处理）。
- **验证**：`tests/stage-pointer.test.mjs`（“a Shift drag applies without the minimum drag distance”：亚阈值移动立即预览）、`tests/timeline-view.test.mjs`（子像素移动即预览）。

## 其他内部改动
- `js/ui/panels.js` 拆分：`SnappeesPanel`/`ChannelsPanel` 与 snappee 预览绘制移至新文件 `js/ui/panel-lists.js`（panels.js re-export 保持导入路径兼容），以满足 lint 的单文件/单函数行数上限。
- 新增 i18n 键：`command.channel.hide(.hint)`、`command.channel.showAll(.hint)`、`command.channel.moveAboveWithinChannel(.hint)`、`command.channel.moveBelowWithinChannel(.hint)`、`history.moveWithinChannel`、`panel.channel.{menu,show,hide,createAbove,createBelow}`、`panel.snappee.menu`、`panel.clip.menu`、`shortcut.command`、`shortcut.option`（en-US/zh-CN 同步，`i18n.test.mjs` 校验通过）。
- 图标：新增 `svg/icons/menu.svg`（菜单按钮）；`show-channel.svg`/`hide-channel.svg`/`create-channel-above.svg`/`create-channel-below.svg` 沿用已有文件。
- 版本：v0.13.2 审计后追加发布 v0.13.3，`index.html` 与 `service-worker.js` 的 app.js 缓存参数同步至 `?v=66`；`CACHE_VERSION` 为 `sviber-v01330`。时间轴滚动条空白轨道按可见跨度翻页，Ctrl 点击/拖动按指针吸附定位；主编辑区 HUD 进度条支持低优先级点击和拖动寻拍。SSC 独立导入保持未保存状态以确保自动保存恢复；项目媒体字段同步到历史快照，撤销操作不会清空已加载音乐和图片。

## 验证结果
- `npm test`（eslint + node --test）：**500 项测试，499 通过，1 项既有环境跳过，0 失败**。新增审计测试已按功能拆分命名，未使用通用 Prompt 测试文件。
- `npm run build`：本地构建通过。
- 全量快捷键重复扫描：无未预期冲突。
