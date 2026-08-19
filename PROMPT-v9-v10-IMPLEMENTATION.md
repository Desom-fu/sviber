# PROMPT v9 / v10 实现说明

本文记录 `PROMPT-v9.md` 与 `PROMPT-v10.md` 逐项比对后，在 sviber 中完成的功能、修复和验收结果。它是维护说明，不是用户操作手册；实际操作步骤以 [`docs/index.html`](docs/index.html) 为准。

## Diff 结果与实现

### 编辑区与渲染

- 在 `js/render/chart-index.js` 增加按活动通道、时间区间、事件持续尾巴和选中状态工作的渲染索引。播放、选择和滚动视图不再每帧扫描全部事件。
- 新增 `js/render/scroll-view.js`。滚动视图使用时间与 x 坐标映射、等比例刻度、拍线、当前时间线、持续尾巴、Tip Point 连接线和生成方向线；背景音符始终绘制在其他事件下方。它只负责选择，不直接编辑事件。
- 时间轴保存并恢复 `visibleRangeBeginning`/`visibleRangeEnd`；Scroll View、时间轴和主编辑区共享活动通道过滤。
- 主编辑区左右边缘增加 DOM 显隐按钮，分别控制 Scroll View 和右侧面板组。
- 增加难度选择器、难度颜色和预设游玩区域网格。删除最后一个难度时自动建立空的 Master 谱面，避免编辑器进入无谱面状态。
- 完成水平/垂直翻转、自由变换和仿射矩阵对事件、附着吸附器、Flick 方向及 Tip Point 生成位置的一致变换。

### 吸附器与编辑交互

- `js/core/snappee-presets.js` 提供游玩区域网格、唱盘、四种六边形和五边形预设，并按当前语言命名。
- 吸附距离固定为 6.125 个谱面坐标单位。边界外的吸附点仍会拒绝；仅对理论上位于边界、因浮点舍入产生的极小越界使用极小容差。
- 钢笔/圆弧等吸附器支持平移、水平翻转、垂直翻转和自由变换；原有移动点与点吸附逻辑保持不变。
- 修复复制圆弧后移动、保存失败，以及移动附着对象时瞬移回原位置的问题；约束计算改为在预览和提交路径使用同一结果。
- Shift 拖动以最后选中事件为移动上下文，不会在拖动途中命中其他事件；状态复选框获得焦点时，Space、数字键等全局快捷键仍有效。

### 播放、节拍器与偏好

- `js/audio/player.js` 将音乐和 SE 分离到独立 GainNode，新增 SE 音量与音乐音量设置。
- 节拍器采用清晰、短促、恒定的合成点击音，每拍使用相同频率和响度，不再区分强拍/弱拍；节拍器音量跟随 SE 音量，并在正向/反向播放中保持定时同步。
- 偏好新增主题、语言、音效音量、音乐音量、超界放置和自动保存间隔；自动保存默认 120 秒，设为 0 可关闭。
- 修复英文语言选择项显示为 `Simplified Chinese`、中文语言选择项显示为 `简体中文` 的本地化要求；英文项始终为 `English`。
- 主编辑器、宏页面和手册页面通过 `js/theme-bootstrap.js` 共享明确的浅色/深色主题；只有“跟随系统”时才使用 `prefers-color-scheme`。

### 文件、宏和数据格式

- 普通保存保留生成的顶层 `events`；自动保存通过 `includeGeneratedEvents: false` 省略该列表，减少本地存储和序列化开销。
- 新增 `js/app-macro-bridge.js`、`js/macro-api.js`、`js/macro-api.rb`、`js/macro-sandbox.js` 和 `macro-sandbox.html`。JavaScript/Ruby 宏可读写 metadata、editor、timing、channels、events、snappees，并使用查找、修改、删除、选择和快捷创建 API。
- Ruby 宏使用 ruby.wasm；`$stdout`、`$stderr`、`puts`、`print`、`warn` 和 `log` 都被捕获并转发到宏控制台。宏异常不会应用部分结果，成功运行作为一条可撤销历史记录。
- 工程宏支持 `.js` 和 `.rb` 文件的创建、保存、重命名、删除、导入、导出；浏览器仍只启用全局宏。
- `js/core/chart-model.js` 保持编辑数据与 Sunniesnow 生成事件分离，删除/导入/导出和难度切换遵循 v10 约束。

### 构建与发布

- `scripts/build-nw.mjs` 支持显式 `SVIBER_NW_PLATFORM`/`SVIBER_NW_ARCH`，生成目标平台原生图标，并过滤不需要的 Ruby WASM 大文件。
- `.github/workflows/test.yml`、`.github/workflows/package.yml`、`.github/workflows/release.yml` 分离测试、架构构建和 tag 发布。
- 发行矩阵：Windows x86、x86_64、aarch64；Linux x86_64、aarch64；macOS x86_64、aarch64。按 v10 规范，Windows 为 ZIP、Linux 为 `tar.gz`、macOS 为 DMG，并额外发布无运行时 `.nw` 包。
- 源码只保留 `svg/icon.svg`；PNG/ICO/ICNS 在构建时生成。

## 帮助文档与 README

- `docs/index.html` 重写为中英文双语、带层级侧栏的完整手册，补充 Scroll View、拍线/尾巴、Tip Point、难度、预设吸附器、显隐面板、可见范围恢复、快捷键、宏 API、主题、语言、自动保存和边界容差。
- 中英文手册明确记录节拍器是恒定音色/恒定响度，不存在强拍/弱拍区分，并说明音量跟随 SE 音量。
- `README.md` 与 `README.zh-CN.md` 同步更新 120 秒自动保存、自动保存省略生成事件、主题同步、宏输出、架构发行包和 Scroll View 说明。
- `service-worker.js` 的缓存版本升至 `sviber-v30`，使旧手册和旧脚本不会继续覆盖新资源。

## 验证记录

在提交前执行：

- `npm test`：120/120 通过。
- `npm run benchmark:render`：100,000 events、600 frames，平均索引查询约 0.014 ms。
- `npm run verify:browser`：中英文、明暗主题、宏控制台、Canvas 非空、最小窗口和 100,000 事件播放/编辑检查通过，掉帧数为 0。
- `npm run build`：成功生成 `build/sviber-0.2.0.nw` 和本机 Windows x64 桌面包。
- `git diff --check` 与 `node scripts/check-source-size.mjs`：通过；所有源码文件不超过 1000 行。

## 版本与提交

- `package.json`、`package-lock.json` 版本：`0.2.0`。
- 建议提交信息：

  `feat: implement PROMPT v10 editor and release features`

- 建议 tag：`v0.2.0`。
- GitHub Release 需要在提交并推送 `v0.2.0` tag 后由 `release.yml` 自动创建；本地构建成功不等于远程 Release 已发布。
