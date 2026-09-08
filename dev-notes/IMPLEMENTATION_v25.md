# IMPLEMENTATION_v25

本文件按 `PROMPT-v24.md → PROMPT-v25.md` 的差异清单（原始 diff 见 `dev-notes/PROMPT-v24-v25.diff`）逐条记录 v25 的实现内容、涉及文件、实现方式与验证结果。发布版本：v0.16.0。

## 差异清单与实现状态（逐条）

| # | 类型 | 差异条目 | 实现情况 |
|---|---|---|---|
| 1 | 修改 | 面板调整手柄透明、面板之间无缝隙 | 已在 v0.15.7 实现（`.layout-resize` 透明手柄），本次核对无遗漏 |
| 2 | 修改 | perdurant events（含背景图案）显示时长尾巴的表述 | 代码已实现（`durationTailWidth` 按类型渲染），表述随术语表统一 |
| 3 | 修改 | 选中事件"唯一可移动事件"表述改为引用术语表 | 纯文档措辞，无代码分支变化，核对现状一致 |
| 4 | 新增 | File 菜单 "Open project folder in explorer"（移至 Save project 之后；网页或路径未知时灰显） | `js/app/commands.js` 菜单项移动；灰显谓词已有（`app-command-bindings.js: file.openProjectFolder`） |
| 5 | 新增 | File 菜单 "Render video..." / "Render cover..." | 新命令 `file.renderVideo`/`file.renderCover` + `js/app/app-render.js` 完整实现（见下） |
| 6 | 修改 | File 菜单结构：新增 "Rename chart..." 菜单项、移除多余分隔线 | 菜单顺序对齐 v25；`file.renameChart` 处理器已存在 |
| 7 | 新增 | 渲染视频/封面完整功能（sunniesnow-record） | 见"渲染"小节 |
| 8 | 新增 | Edit 菜单 Undo/Redo 与 Cut 之间的分隔线 | `commands.js` Edit 菜单加 `separator` |
| 9 | 新增 | Events 菜单 Activate (A) / Deactivate (Shift+A) / 分隔线 | 新命令 + 菜单项（见"事件启停"小节） |
| 10 | 新增 | Events 菜单 Bulk edit texts by channel... / Import lyrics/subtitle file... | 新命令 + 菜单项（见下） |
| 11 | 修改 | 创建模式文档：长按重复键忽略 | 代码已有（`app-event-tools.js` 的 `event.repeat` 检查），本次核对一致 |
| 12 | 新增 | 新建事件不立即播放其 SE | `createPositionedEvent` 在播放中把新建事件 id 加入 `scheduledHitIds`/`scheduledBgNoteIds`/`scheduledHoldReleaseIds`，调度器跳过该次命中 |
| 13 | 新增 | 播放中键盘创建 hold：key up 决定结束时间 | `finishKeyboardHoldCreation`（`app-event-tools.js`）+ `app-global-shortcuts.js` 的 keyup 绑定；结束时间取 key up 最近细分，与起点相同则取下一细分 |
| 14 | 新增 | 事件级 Activate/Deactivate（active 标志） | 见"事件启停"小节 |
| 15 | 新增 | "Bulk edit texts..."（按选中事件） | `app-bulk-edit.js` 重写：按时间+通道排序、无 `<select>`、不含 comment；灰显谓词 `canBulkEditTextsSelection` |
| 16 | 修改 | "Bulk edit texts by channel..."：草稿/光标记忆 + 措辞 | `app-bulk-edit.js`：每通道草稿、已编辑标记、光标位置记忆（未编辑→当前时间后首条文本偏移；已编辑→回到上次位置） |
| 17 | 新增 | Import lyrics/subtitle file...（LRC/SRT/WebVTT/ASS） | `js/core/lyrics-import.js` 解析器 + `js/app/app-lyrics-import.js` 对话框（偏移、量化分母；tap 行布局公式见 prompt） |
| 18 | 修改 | Tip point switch 弹窗排版：行列对齐、左列无网格线 | `css/app.css` `.tip-switch-column` 行高固定 28px，左列（`.is-source`）无边框，仅右列有分隔线 |
| 19 | 新增 | Snappee 菜单快捷键变更与改名 | `commands.js`：`snappee.activate` → Ctrl+Shift+D、`snappee.deactivate` → Ctrl+D、`snappee.deactivateAll` → Ctrl+Alt+D；i18n 标签更新 |
| 20 | 修改 | Snappee 章节"激活/停用"行为（事件选中→作用于其吸附器） | 行为已存在（`canSetSnappeesActive`），核对一致 |
| 21 | 新增 | Transform 菜单 Quantization... 对话框 | 新命令 + `js/app/app-quantization.js` + `js/core/quantize.js`（分母默认当前细分；平局模式 floor/ceil/even） |
| 22 | 修改 | 术语表新增 Background patterns 类别 | prompt 术语表条目；代码中对应 `PATTERN_TYPES`（checks.js 与 chart-vocabulary 均已存在） |
| 23 | 修改 | tip point 数学仅考虑 active 的 tip-pointable events | `chart-index.js` `_buildTipGuideIndexes` 过滤 `event.active !== false`；`chart-events.js` `connectSelectedTipPointChain` 同步过滤 |
| 24 | 新增 | 检查项 Conflicting bg patterns（strict 参数，默认 true） | `checks-config.js` 定义 + `checks.js` `checkConflictingBgPatterns`（点击选中两个图案） |
| 25 | 修改 | metronome 输入偏移符号（beat − current） | 代码已实现（`closestMetronomeDelta` 注释明确 PROMPT-v24 操作数颠倒），仅文档对齐 |
| 26 | 修改 | sviber JSON `events` 说明包含 comments 与 group events | 核对 `serializeSviber`（`events: clone(this.events)` 本就包含），无需改动 |
| 27 | 修改 | 检查参数清单新增 blockedTexts 与 conflictingBgPatterns(strict) | blockedTexts 代码已有；conflictingBgPatterns 为本版新增；文档清单以实现为准 |
| 28 | 新增 | 构建/发布：FFmpeg 捆绑（可取消）、gl/canvas 原生模块编译、.ssc 文件关联 | `scripts/build-nw.mjs` `bundleFfmpeg()`（`SVIBER_SKIP_FFMPEG=1` 取消；`SVIBER_FFMPEG_URL` 可覆盖源）；`.github/workflows/package.yml` 原生模块重建步骤；`packaging/*` 全部加入 `.ssc`（macOS Info.plist、Linux MIME XML + desktop、Windows Inno Setup 注册表）；`scripts/nw-build-config.mjs` 文件关联数组加入 ssc |
| 29 | 新增 | CLI `--render OUTPUT.mkv` / `--render OUTPUT.png` 及附加参数 | `js/cli/cli.js`（flag/help）、`js/cli/cli-main.js`（CLI_OPERATION_FLAGS/VALUE_FLAGS）、`js/cli/cli-operations.js` `runRender`（内存构建 level → Blob → sunniesnow-record）、`js/cli/cli-node-io.js` `buildLevelBytes` |

## 主要实现说明

### 事件级启停（active 标志）

- `js/core/chart-events.js`：`createEvent` 归一化 `active`（默认 `true`）；`connectSelectedTipPointChain` 跳过 inactive 事件。
- `js/render/chart-index.js`：`_isActive` 增加 `event.active === false` 短路（group 同样生效）；`_buildTipGuideIndexes` 的 leaf 投影与 `noteEventRecordsByChannel` 均排除 inactive，因此主编辑区、滚动条、命中调度（SE）与游标链全部自动排除，而 `timelineIndex` 仍包含全部事件。
- `js/render/timeline-drawing.js`：inactive 事件在时间轴中以 0.4 透明度绘制且保持命中区域（可选中）。
- 命令：`events.activate`（A）、`events.deactivate`（Shift+A），作用于全部选中事件（含 group），进入历史记录。

### 渲染（视频/封面）

- `js/app/app-render.js`：NW.js 专用（非 NW 或无音乐时灰显）。表单含输出路径 + Browse（`pickNwSavePath`）、nickname（默认 charter）、avatar 三选一启停、bundled FFmpeg 复选框（仅捆绑可用时出现）、speed/width/height/fps/resultsDuration/waitForMusic。确认后弹出进度表单（进度条 + 状态文本；渲染完成前不可确认；完成后出现"在文件夹中显示"按钮）。
- level 文件通过 `files.createLevelArchive` 在内存中生成并以 `Blob` 传给 `sunniesnow-record`（`levelFile: "upload"`、`chartSelect/musicSelect: "from-level"`）；背景使用当前图像（无图则 `background: "none"`）；`assetsDir` 指向打包内 `assets/fonts` 复用捆绑字体。
- `js/app/app-render-cover-widget.js`：PixiJS 封面主题图 widget（拖动移动、滚轮缩放、菱形区域外暗化）。
- FFmpeg 路径：打包内 `bin/ffmpeg[.exe]`（由构建脚本捆绑）或回退 PATH。

### 构建 / CLI

- `scripts/build-nw.mjs`：新增 `bundleFfmpeg()`，按目标平台下载静态 FFmpeg 并放入 `bin/`；`SVIBER_SKIP_FFMPEG=1` 取消捆绑（此时渲染回退 PATH FFmpeg）；`SVIBER_FFMPEG_URL` 可覆盖下载源。
- `.github/workflows/package.yml`：runner 架构与目标一致时执行 `npm rebuild gl canvas --update-binary`（从源码编译原生模块）；交叉编译目标保留预编译二进制。
- CLI：`sviber PATH --render OUTPUT.mkv|png [--nickname ... --avatar ... --width ... --height ... --fps ... --speed ... --ffmpeg ...]`。

## 测试与验证结果

- `npm test`（ESLint `--max-warnings 0` + `node --test`）：**633 项测试，632 通过 / 0 失败 / 1 跳过（既有）**。
- 新增测试文件（按功能命名）：
  - `tests/event-active.test.mjs` — 事件启停（索引过滤、时间轴保留、round trip、tip point 排除）
  - `tests/quantization.test.mjs` — 量化舍入与三种平局模式
  - `tests/bulk-edit-selection.test.mjs` — 按选中事件批量编辑（排序、comment 排除、转义往返）
  - `tests/lyrics-import.test.mjs` — LRC/SRT/WebVTT/ASS 解析与布局公式
  - `tests/conflicting-bg-patterns.test.mjs` — 冲突检测与 strict 参数
  - `tests/render-commands.test.mjs` — 渲染命令灰显条件与选项映射
  - `tests/cli-render.test.mjs` — CLI --render 参数解析
- 原始 diff 存档：`dev-notes/PROMPT-v24-v25.diff`。
