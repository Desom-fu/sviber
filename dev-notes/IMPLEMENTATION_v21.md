# PROMPT-v21 实现文档

本文档逐条对照 `dev-notes/PROMPT-v20.md` 与 `dev-notes/PROMPT-v21.md` 的 diff（共 9 个 hunk、33 处插入、9 处删除），说明每一项的实现方式、涉及文件与验证结果，另附随版本发布的两个性能修复与一个叠层修复。

## Diff 清单与实现

### 1. 时间轴时长尾柄：Ctrl+Alt 放大、优先级高于事件拖动

- **diff**："The handle (and thus its hit box) enlarges when the user holds Ctrl+Alt." 与 "The interaction priority of the handles are higher than directly dragging events."
- **实现**：
  - `js/render/timeline.js`：新增 `ctrlAltHeld` 跟踪（keydown/keyup 捕获监听，状态变化时 `requestRender()` 即时重绘），`destroy()` 同步移除监听。
  - `js/render/timeline-drawing.js`：尾柄半宽 `this.ctrlAltHeld ? 12 : 7`，命中框随之放大一倍以上；绘制收集机制（v0.11.0 的置顶绘制）沿用。
  - 优先级：时间轴命中测试的优先级数组中 `"duration"` 本就排在 `"event"` 之前（`js/render/timeline-pointer.js`），语义已满足；由测试锁定。
- **验证**：`tests/timeline-view.test.mjs` "Ctrl+Alt enlarges every draggable handle and its hit box"（源码断言全部把手位点的缩放表达式）。

### 2-4. 主编辑区 flick 方向把手、游标生成位置把手、group 锚点：Ctrl+Alt 放大

- **实现**：
  - `js/render/stage-core.js`：新增 `ctrlAltHeld` 跟踪（同上，变化即重绘）；`js/render/stage-interactions.js` `destroy()` 移除监听。
  - `js/render/stage-overlays.js`：flick 把手与 tip 把手绘制半径 6 → Ctrl+Alt 时 13（`half - 4`），命中框半宽 10 → 17；group 锚点十字与圆盘 Ctrl+Alt 时放大（9→16、6→10），命中框半宽 8 → 14。
- **验证**：同上源码断言（`ctrlAltHeld ? 17 : 10`、`ctrlAltHeld ? 14 : 8`）。

### 5. 时间轴 Alt+Shift 通道拖动

- **diff**：按住 Alt+Shift 在通道区点击拖动 = 移动全部选中事件（等同普通事件拖动语义），此时鼠标在通道区不做其他任何事；移动方式依赖具体事件时以按下时离鼠标最近者为准。
- **实现**：`js/render/timeline-pointer.js`：
  - `_timelineDrag` 顶部拦截：`altKey && shiftKey` 且按压点在通道区（波形以下、滚动条以上）时进入 `_altShiftMoveDrag`——命中事件/时长尾柄也一并不再触及（"不必避开把手"）。
  - `_altShiftMoveDrag`：从 `_selectedLeafEvents`（已过滤锁定）取活跃频道选中事件，按（内容空间 x 距离 + 频道行距）选离按压最近者为准绳事件，合成与普通事件拖动完全相同的 drag 对象（`type: "event"`、`startBeat`、`absoluteBeatSnap`、`copy`、`collapseSelectionOnClick: false`）；预览与提交走既有 `onPreviewMoveEvents`/`onMoveEvents`（移动集合 `_selectedLeafEvents` 自动跳过锁定）。无选中或播放中返回 `null`（通道区不做其他事）。
- **验证**：`tests/timeline-view.test.mjs` "Alt+Shift drag in the channels moves the selection from the closest selected event"——准绳事件取最近者、`collapseSelectionOnClick` 为 false，且无 Alt 时同一点击保持普通语义。

### 6. 主编辑区 Alt+Shift 等价于 Shift

- **diff**："For this mechanics, holding Alt+Shift is equivalent to just holding Shift."
- **现状核实**：主编辑区 Shift 拖动链路（`_selectionDrag` 的 `event.shiftKey` 判定、`_shiftDragTargets`、`target = shift ? null : hit`）天然涵盖 Alt+Shift（Alt 只在非 Shift 路径改变选择模式）——无需代码改动。
- **验证**：`tests/stage-pointer.test.mjs` 新增 "Alt+Shift drag moves the selection exactly like Shift"——Alt+Shift 按压空白处时同样以最近选中事件为准绳返回事件拖动。

### 7-8. 矩形/径向吸附器把手：Ctrl+Alt 放大

- **实现**：`js/render/stage-snappees.js`：两种形状（圆点/方点）绘制半径 5 → Ctrl+Alt 时 9，命中框半宽 8 → 14。该 trait 挂在主编辑区视图上，`ctrlAltHeld` 来自 stage-core。
- **验证**：同源码断言（`ctrlAltHeld ? 9 : 5`）。

### 9. 国际化范围扩大（许可页与帮助文档）

- **diff**：i18n 数据不得硬编码在 JavaScript 或 HTML 中；适用于编辑器页面之外的 JS 许可页、帮助文档等。
- **实现**：
  - **许可页**：`json/i18n.en-US.json`/`zh-CN.json` 新增 `license.*` 13 键（returnToEditor/backToLicenseList/title/note/file/license/source/sourceUnavailable/sourceUnavailableHint/sourceViewerTitle/sourceTitleSuffix/loadFailed/loading）；`javascript.html` 与 `source-viewer.html` 移除全部 `data-license-en/zh` 硬编码，改为 `data-i18n-key` 引用；`js/boot/license-page.js` 按界面语言 `fetch("json/i18n.<lang>.json")` 应用文案并设置 `document.title`，`loadSource` 的错误/标题文案同样走词汇表（`formatMessage` 填参）。
  - **帮助文档**：手册正文与界面文案抽取到 `json/manual.en.json` / `json/manual.zh-CN.json`（`{ article, ui }` 结构，ui 含语言下拉与搜索标签）；`docs/index.html` 由 104KB 减至 1.8KB，仅保留骨架与 chrome，运行时由 `docs/docs.js` 按语言 `fetch` 注入（`article.innerHTML`），TOC 与搜索在注入后的 DOM 上工作；`docs/docs.js` 删除硬编码的 `languageLabels`/`searchLabels`，改用 JSON `ui` 块（`{index}/{count}` 模板经 `formatMessage` 填参）；语言切换按需加载并缓存。
  - `service-worker.js` APP_SHELL 加入两个 manual JSON，保证离线打开手册。
- **验证**：playwright 冒烟——手册按 navigator.language 注入、正文/目录/搜索工作、切换语言后 zh 文章填充并显示"sviber 用户手册"；`tests/documentation.test.mjs` 等 6 个文件的内容断言统一经 `tests/module-source.mjs` 新增的 `readManual()`（解析两个 JSON 的 article 文本）读取，chrome 断言（如 `id="manual-search-input"`）仍读页面本身；`tests/preferences.test.mjs` 的许可页断言改查 `data-i18n-key`。

### 10. CI/CD 发布产物命名

- **diff**：平台包命名 `sviber-${version}-${os}-${arch}.${ext}`（Windows zip、Linux tar.gz、macOS dmg）；`.nw` 包命名 `sviber-${version}.nw`。
- **实现**：`.github/workflows/package.yml` 矩阵新增 `osName`（windows/linux/macos）与 `archName`（x86/x86_64/aarch64）字段；新增 "Resolve release version" 步骤（`node -p "require('./package.json').version"` 写入 `GITHUB_ENV`）；归档与 artifact 名称全部改为 `sviber-${{ env.version }}-${{ matrix.osName }}-${{ matrix.archName }}.${{ matrix.archive }}`。`.nw` 包文件名本就是 `sviber-${version}.nw`（`scripts/build-nw.mjs` 按 package.json 版本命名），符合要求。`release.yml` 的 `release/*` 通配不受影响。
- **验证**：`tests/nw-build-config.test.mjs` "release workflows archive each target with the required format" 重写为 v21 命名矩阵（7 目标 × osName/archName/nwPlatform/arch/archive 顺序断言 + 版本解析步骤断言）。

## 随版本修复

### A. 拖动时间轴 hold 尾卡顿

- **根因**：`onPreviewDurations` 的 preview 未标 `rebuildIndex: false`，每次 pointermove 都触发 `refreshInteractionPreview` 的全量索引重建（4000 事件实测每次移动 ~13-48ms）。
- **实现**：`js/app/app-view-callbacks.js`：时长预览与提交改走 `replaceEvents` 增量切片——`_applyDurationChanges` 用 `createEvent` 构造替换事件并经 `model.replaceEvent` 换入模型（保持模型与索引对象身份一致，这是增量在连续预览间可用的关键），`currentIndex.replaceEvents` 失败时经选项对象翻转 `rebuildIndex` 回退全量；预览标 `incremental: true`（不逐帧恢复 previewBase）+ `rebuildIndex: false`。
- **验证**：真实浏览器探针（4000 事件、40 个 hold）：每次移动中位数 **13.1ms → 1.0ms**（p95 21.6 → 1.6ms）；`tests/history-regressions.test.mjs` 新增 "a duration drag commits one undoable resize and keeps the render index usable"（两次预览 + 提交全程零重建、单一可撤销编辑、undo 恢复原时长且索引保持可用）。

### B. 拖完 hold 尾立刻播放卡顿

- **根因**：释放拖拽时的 commit 先 `model.restore(previewBase)`（O(n) 且使索引失效）再全量重建索引（~80ms@4000 事件），紧接播放又重建一次，两段连续卡顿。
- **实现**：`js/app/app-core.js` `commit` 与 `js/app/app-free-transform.js` `_finishCommit` 支持 `options.skipPreviewRestore`——增量预览的最终变更完整覆盖所有被预览字段时，跳过恢复以保住模型/索引身份，`previewBase` 快照转作历史基线 `before`（保证拖拽恰好等于最后一次预览时也计入历史）。`onResizeEvents` 使用该选项 + 增量 `replaceEvents`，发布拖拽全程零全量重建。
- **验证**：探针中提交后紧跟的播放路径重建仅 ~21ms（与任意一次播放基线一致）；上述回归测试锁定"提交后索引仍可用且历史正确"。

### C. 双押覆盖顺序在部分位置反转

- **现象**（用户报告）：不同通道同时押时，下方频道的 note 应覆盖上方频道的 note，但同谱面部分位置顺序相反；同时押按通道排、不同时按时间排、同通道同时按加入顺序（晚者在上）。
- **根因**：`js/render/stage-core.js` `_drawNotes` 的音符绘制顺序直接使用 `movableIndex.query()` 的区间树返回序——该顺序取决于插入历史，导致叠层逐区域不确定。
- **实现**：新增 `_sortNoteRecordsForStacking`——音符体绘制前按（时间秒 → 频道序（时间轴靠上的频道先画、被覆盖）→ 同频道同刻按创建序（晚者后画、在上））确定性排序；记录补充 `start`/`sequence` 字段，游离态回退路径分别用拍值换算与事件 id。接近圈层与命中区域遍历沿用该顺序。
- **验证**：`tests/stage-pointer.test.mjs` 新增 "simultaneous notes stack by channel order with the lower channel on top"——跨频道同刻（下方频道覆盖）、同频道同刻（晚加在上）、跨时刻（按时间）三种情形的排序断言。

## 验收

- `npm test`（`eslint . --max-warnings 0 && node --test tests/*.test.mjs`）：lint 0 错误，全部测试通过（含 1 项预先存在的环境相关 skip）。
- `npm run build`：本地 NW.js 打包成功。
- playwright 探针：时长拖拽每步 1.0ms、全程零重建；手册 JSON 注入、目录/搜索/语言切换正常。
