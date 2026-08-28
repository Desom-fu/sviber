# Sviber v18 实现说明

本文逐项对应 `PROMPT-v17.md` 与 `PROMPT-v18.md` 的 diff，记录到 v0.9.0 的代码、配置、测试与帮助文档改动。写完后又逐行复查了一遍 v17/v18 diff，逐条确认落地。

v17 → v18 的 diff 只有四处（`diff PROMPT-v17.md PROMPT-v18.md` 共 52 行）：波形上 `Shift` 拖动的 A-B 循环手势重写、音乐音量上限、`sviber` 顶层字段补 `clips` 与 `checks`、以及新增 `checks` 字段一节。除此之外本次发布还修掉了九个报告的可用性 bug，并按 有丘直方 的要求重整了 `js/` 与 `tests/` 的目录结构。

## 1. 波形上 Shift 拖动的 A-B 循环手势（PROMPT-v18.md:249-268）

v17 的行为是"清除现有标记，在按下处和松开处各建一个"。v18 拆成两种手势，按下位置离已有标记的距离决定走哪一种。

- `js/render/timeline-gestures.js`
  - 新增 `AB_LOOP_GRAB_DISTANCE = 6`（像素）和 `abLoopGrabIndex(marks, x, toX, tolerance)`：返回被抓住的标记下标，两个都在容差内时取更近的那个，都不在则返回 `null`。
  - 新增 `abLoopDragMarks(anchor, moving)`：`anchor` 是不动的那个标记，`moving` 跟随指针。指针还没走到别的细分时（`anchor.equals(moving)`）只有一个标记；走到了才出现第二个；`moving` 越过 `anchor` 时仍按 A 早 B 晚排序；`anchor` 为 `null`（抓住了唯一一个标记）时始终只有一个标记。
- `js/render/timeline-pointer.js`
  - `_waveformPointerDown` 在 `event.shiftKey && !playing` 时进入新的 `_abLoopPointerDown`。
  - `_abLoopPointerDown` 只在按下时决定一次 anchor：抓住了某个标记就用"没被抓住的另一个"当 anchor（只有一个标记时 anchor 为 `null`）；没抓住任何标记就丢掉已有的一对，用按下处的细分当 anchor。返回 `{ type: "ab-loop", anchorBeat, movingBeat, grabbed }`。
  - `_moveAbLoop` 重新吸附指针位置、用同一个 anchor 重算标记对，并调 `_chaseVisibleRange` 让可见范围追逐指针（拖出可见范围时平滑跟随，与 v17 一致）。
  - 松开时以 `final = true` 提交 `abLoopDragMarks(drag.anchorBeat, drag.movingBeat)`，所以"松开位置和另一个标记同一细分则只剩一个标记"是提交路径自然的结果，整个手势在历史里只留一条记录。
- 手册：`docs/index.html` 的 `en-waveform` / `zh-waveform` 两段重写为新行为（六像素抓取、第二个标记延迟出现、可越过另一个标记、松开重合则只剩一个）。
- 测试：`tests/timeline-view.test.mjs` 新增三条——`abLoopGrabIndex` 的抓取与就近选择、`abLoopDragMarks` 的折叠与排序（含越过 anchor 和无 anchor 两种）、以及 `timeline-pointer.js` 的按下/移动/松开三段源码接线；另有一条断言手册确实换成了 v18 措辞并且不再留有 v17 措辞。

## 2. 音乐音量上限提到 2（PROMPT-v18.md:1825）

- `js/audio/player.js`：`setMusicVolume` 与 `setSeVolume` 同样 `Math.max(0, Math.min(2, parsed))`。
- `js/app/app-preferences-media.js`：`musicVolume` 滑块 `max: 2`（与 `seVolume` 一致，步进 0.05，默认 1）。
- 偏好持久化的 clamp 也是 0–2。
- 手册：英文与中文的偏好一节都改成"音效音量和音乐音量都使用 0 到 2 的滑块"。
- 测试：`tests/audio-volume.test.mjs` 断言 `storePreferences` / `loadPreferences` / `AudioPlayer` 三处都 clamp 到 2；`tests/preferences.test.mjs` 断言两个滑块的 `min/max/step` 与 player 的 clamp 表达式。

## 3. `sviber` 顶层新增 `clips` 与 `checks`（PROMPT-v18.md:3695-3696）

`js/core/chart-model.js` 的 `serializeSviber()` 已经输出 `clips` 与 `checks`，`ChartModel` 构造时也从 `state.clips` / `normalizeChecks(state.checks)` 读回，所以文件格式本身满足要求；本次补上文档与测试：

- 手册：`en-file-format` / `zh-file-format` 两段列出 `clips` 与 `checks`，并说明哪些检查带额外参数。
- 测试：`tests/editor-state.test.mjs` 新增一条，往模型里加 clip、改三项检查参数，序列化后断言字段存在，再 `ChartModel.import` 回来断言 enabled 与参数都保住，并遍历 `CHECK_IDS` 确认没有缺项。

## 4. `checks` 字段一节（PROMPT-v18.md:3938-3954）

- `js/core/checks-config.js` 的 `CHECK_DEFINITIONS` 与 prompt 列出的十二个 id 和参数完全对应：`requiredFingers` 带 `fingers`，`shortHold` / `shortBgPattern` / `shortTipPoint` 各带 `seconds`，其余无参数；每项都至少有 `enabled`。
- 测试：`tests/checks.test.mjs` 已按 prompt 的顺序 `deepEqual` 断言 `CHECK_IDS`，本次新增一条逐项断言额外参数名（并断言其余检查确实没有参数），防止以后加检查时漏掉文档同步。

## 修复的九个 bug

前五个是同一个根因：ES `#private` 方法带 brand check，`composeTraits` / `installTraitMembers` 把描述符拷到别的 prototype 上以后调用就抛 `TypeError: Receiver must be an instance of class X`。trait 文件里一律改成 `_` 前缀的普通原型方法。

新增 `tests/traits.test.mjs` 守住这个根因：一条验证 composed trait 调用自己的 `_` helper 正常（顺带断言 `Layer.name` 与成员不可枚举）；一条把失效模式本身钉住（`#private` helper 拷到别的 prototype 上必抛 `TypeError`，而在声明类的实例上仍然正常）；一条扫描 `js/app` 与 `js/render` 下全部 46 个 trait 模块（自己 compose 的，或导出 `*Trait` 给别人 install 的），断言没有任何 `#` 成员声明或 `this.#` 使用。非 trait 的普通类（`pixi-surface.js`、`interval-index.js`、`scroll-view.js`）不受限制。

1. **编辑 > 检查... 不可用** — `js/app/app-checks.js` 的私有方法改为 `_` 前缀。
2. **定时 > 调整偏移 不可用** — 同上，`js/app/app-auto-timing.js`。
3. **吸附器 > 按顺序附着到曲线 不可用** — `js/app/app-attachment.js` 的 `#curveSnapPoints` / `#attachAtIndices` 改为 `_curveSnapPoints` / `_attachAtIndices`。
4. **吸附器 > 按时间附着到曲线 不可用** — 同上，两条命令共用 `_attachAtIndices`。
5. **自动定时不可用（报错）** — trait 私有方法之外，还有 worker 的问题：module worker 在 `file:` 下构造失败，且它报的 `error` 事件是 `ErrorEvent` 而不是 `Error`，旧代码 reject 出 `[object ErrorEvent]` 就放弃了分析。现在 `_analyseInWorker` 取 `event.message` 作为原因，`runAutoTimingAnalysis` 在构造失败或运行失败时都回落到 `runAutoTimingLocally` 在本线程跑完整管线。
6. **波形上不能连续拖动设置当前时间，松开也不吸附细分** — `js/render/timeline-pointer.js` 的 seek 拖动改为按下即 `onSeekStart`、移动持续 `_seekAt`、松开时若未播放再吸附。
7. **滚动视图与检查面板叠在一起而不是标签切换** — 只用 `visibility: hidden` 隐藏不活跃的那个，它仍然占据布局，于是两者看起来是叠着的。`css/app.css` 的 `.scroll-surface.is-inactive` 补上 `content-visibility: hidden`：跳过绘制但不像 `display: none` 那样把元素塌掉——滚动视图是 WebGL surface，隐藏时仍然要能被测量。回归测试在 `tests/scroll-view.test.mjs`。
8. **定时 > 自动定时... 弹窗排版错乱** — 隐藏了 label 的字段不产生 label 列的格子，控件就被挤进那个窄列里。`js/ui/ui-dialogs.js` 给这类字段加 `is-full`，`css/dialogs.css` 里 `.dialog-field.is-full` 用 `grid-template-columns: minmax(0, 1fr)` 占满整行；`js/ui/auto-timing-form.js` 的参数分组是唯一的调用方。回归测试在 `tests/field-validation.test.mjs`。
9. **`nw .` 抛 `Check failed: base_url_value->IsString().`** — Web App Manifest 里 `id` / `start_url` / `scope` 都是相对 URL（这是同一份文件既能放站点根目录又能放子目录的原因），NW.js 从 `file:` 式 base 加载页面时 Chromium 的 manifest parser 解析不了这些相对 URL，直接在应用启动前 abort 整个进程。打包的桌面应用本来也不需要 web app manifest，于是新增 `js/boot/manifest-link.js`：只在 `globalThis.nw` 不存在时把 `<link rel="manifest">` 插进 `<head>`，`index.html` 里删掉静态的那一行。保持为 `<head>` 里的经典脚本，link 在文档解析完成前就存在，PWA 可安装性不受影响。`manifest.webmanifest` 本身没改（`manifest.id === "./"` 有测试守着）。

## 目录结构重整

按 有丘直方 的两条要求做的，不属于 prompt diff。

- **`js/` 按职责分目录**：102 个平铺文件移入 `app/ audio/ boot/ cli/ core/ dsp/ macro/ platform/ render/ ui/`，`js/` 下不再有平铺文件。所有相对 import、`index.html` / `macros.html` / `macro-sandbox.html` / `source-viewer.html` / `javascript.html` 的脚本标签与 `data-view-source`、`service-worker.js` 的 shell 缓存列表、`eslint.config.mjs` 的路径、以及测试里的 import 与路径断言都同步改过，`grep` 确认没有残留的旧平铺路径。
- **`tests/` 按实际范围分文件**：11 个 `vXX-features.test.mjs`（169 条测试）拆进 42 个按范围命名的 suite（`snappees` `macro-api` `autosave` `documentation` `i18n` `commands` `shortcuts` `read-only` `ui-shell` `groups` `clips` `live-hosting` `timeline-view` `project-workflows` `selection` `free-transform` `scroll-view` `editor-state` `snapping` `sunniesnow-export` `sunniesnow-import` `clipboard` `build-metadata` `inspector` `main-field-view` `refresh-scheduling` `curve-draft` `lyrica` `field-validation` `cli` `checks` `attachment` `auto-timing` `audio-volume` `comments` `tip-point-spawns` `channels` `playback-scheduling` `render-indexing` `licenses` `stage-pointer` 等）。每个文件的 import 按模块重新合并、helper 按需传递复制，没有重复声明，也没有改动任何断言的含义。测试标题里的 `vXX` / `v0.X.Y` 前缀也一并去掉——版本号属于 git 历史，不属于测试名。

## 自动定时的单元测试

有丘直方 说自动定时"怎么就写了这么点不痛不痒的单元测试，我还以为怎么说也得合成一个音频试试呢"。于是：

- 新增 `tests/auto-timing-signal.mjs`：用 `mulberry32` 种子 PRNG 合成确定性的 click track。`renderClickTrack(times, options)` 预渲染一个带噪声的衰减脉冲、在每个拍点盖章、最后峰值归一；`steadyBeatTimes(bpm, beats, offset)` 与 `tempoChangeBeatTimes(firstBpm, firstBeats, secondBpm, secondBeats, offset)` 生成拍点。
- `tests/auto-timing.test.mjs` 新增六条端到端测试：
  - 96 / 120 / 150 BPM、offset 0.37 的 click track，`runAutoTiming` 恢复的 offset 在 20 ms 内、initial BPM 在 0.5 内、全局 tempo 估计在 1 内（后者单独断言，专门防半速/倍速这个经典错误），且至少跟到 40 拍。
  - 120 → 160 BPM 的变速 click track，initial BPM 接近 120，`bpmChanges` 非空且每一条都接近 160，第一条的时间落在实际变速点一秒内。
  - 单声道与"一路静音的立体声下混后再放大两倍"两种输入结果一致，把 `toMonoSamples` 的下混也串进来。
  - 没有 `Worker` 时 `runAutoTimingAnalysis` 在本线程跑完（这正是桌面版实际走的路径）。
  - `Worker` 构造抛异常时回落到本线程，并且只 warn 一次。
  - worker 报 `ErrorEvent`（只有 `message`）时仍然产出结果，且 warn 里带上真实原因——这就是 bug 5 的回归测试。

## 版本与缓存

- `package.json` / `package-lock.json`：`0.9.0`。
- `service-worker.js`：`CACHE_VERSION = "sviber-v0900"`，shell 列表补 `./js/boot/manifest-link.js`，`app.js` 的 cache-bust 同步到 `?v=45`。
- `index.html`：`js/app/app.js?v=45`。
- 一次性的迁移脚本（`scripts/reorganize-*.mjs`）用完即删，没有进仓库。

## 验收

`npm test`（`check-source-size` + `eslint . --max-warnings 0` + `node --test tests/*.test.mjs`）：319 条测试全过，0 失败，0 警告。

v17/v18 diff 的四处改动全部逐条复查过：

| Prompt 位置 | 内容 | 实现 | 测试 |
| --- | --- | --- | --- |
| 249-260 | Shift 按下离标记远：清除已有一对、在按下细分建标记、指针到别的细分才出现第二个并跟随、拖出可见范围则追逐 | `abLoopDragMarks` + `_abLoopPointerDown` + `_moveAbLoop` + `_chaseVisibleRange` | `timeline-view.test.mjs` ×4 |
| 262-268 | Shift 按下离标记近：移动该标记、另一个不动、可越过、松开重合则只剩一个 | `abLoopGrabIndex` + anchor 选择 + 松开时 `final = true` 提交 | 同上 |
| 1825 | 音乐音量 max 2、默认 1 | `player.js` clamp 0–2 + 偏好滑块 `max: 2` | `audio-volume.test.mjs`、`preferences.test.mjs` |
| 3695-3696 | `sviber` 增加 `clips` 与 `checks` | `serializeSviber()` 输出、构造时读回 | `editor-state.test.mjs` |
| 3938-3954 | `checks` 一节的十二个 id 与额外参数 | `checks-config.js` 的 `CHECK_DEFINITIONS` | `checks.test.mjs` ×2 |
