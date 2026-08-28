# Sviber v17 实现说明

本文逐项对应 `PROMPT-v16.md` 与 `PROMPT-v17.md` 的新增/修改内容，记录到 v0.8.0 的代码、配置、测试和帮助文档改动。对照完成后再次逐行复查了 v16/v17 diff。

## 技术与布局

- 去掉“单文件不超过 1000 行”作为概述要求，改为 ESLint `max-lines`；`scripts/check-source-size.mjs` 仍检查源文件行数。超限的 mixin 按职责拆到 `composeTraits` 层，而不是 `app-2.js` 式切分。
- Chromium 静音后 `AudioContext.currentTime` 冻结：`js/audio/player.js` 用 `createConstantSource` + `MediaStreamDestination` 保持时钟。
- 左侧滚动视图与检查面板共用空间，用标签切换；主编辑区左缘按钮同时隐藏二者。历史面板去掉标题。
- 工程切谱立即写入 `activeChart`（`persistProjectManifest()`）。

## 时间轴与主编辑区

- 波形拖动时当前时间不吸附；松开且未播放时再吸附。拖动期间禁用需要吸附拍的操作。`Shift` 拖波形创建 A-B 循环标记并追逐可见范围。
- 时间轴框选越出可见范围时平移时间，越出显示的通道时纵向滚动。
- `Ctrl`+滚轮：当前时间在可见范围内则以黄线为缩放中心，否则以范围中心为中心。
- 双押连线按绘制顺序相邻连接（1-2、2-3，不连 1-3）。
- 矩形/参数网格多选按相同 Δi/Δj 移动；径向网格可旋转并沿半径内外移动。
- 主编辑区按住 `Shift` 拖动：鼠标不做其它事；按下时离指针最近的选中事件决定移动规则。
- 选中贝塞尔显示控制点折线；钢笔一阶控制点方形、高阶圆形，并用线段连到一阶点。
- 检查面板字段按 `Esc` 取消焦点并恢复原值。
- 钢笔参数表单含 SVG path、复制、从剪贴板导入。

## 状态栏与音量

- SE 不含 bg note SE；新增 Bg note SE 开关（默认关）及合成音效。
- A-B 循环跳转会重武装 Web Audio 时钟并把排程原点改到落点：音符 SE 按新一圈的绝对时钟排，不再因为仍用开播时的 `startedAt` 而全部立刻响起。节拍器本来就用相对延迟，不受影响。
- 新增显示谱面边界开关（默认开），写入 `editor.showChartBoundary`。
- 有选中事件时状态栏显示数量。
- 偏好：SE 音量 0–2，音乐音量 0–1，步进 0.05，默认均为 1。

## 文件与工程

- 从磁盘重新加载谱面（仅桌面且已知路径；未保存更改会警告；保持当前工程）。
- 新建工程：独立谱面打开时询问是否加入新工程。
- 打开最近文件：完整分支（同谱面/同工程/其它工程/加入当前工程/独立打开）。
- 打开自动保存前处理未保存更改。
- 工程内保存新谱面会写 `sviber-project.json`。另存为不涉及工程。无工程时“保存工程”禁用；已知路径时等同保存。
- 关卡 ZIP 时间戳归一到 1980-01-01；打包工程里会作为关卡说明显示的文本（如 `README.md`）。
- 从剪贴板导入前处理未保存更改。
- 重命名谱面（工程内、不可撤销、立即写盘）。编辑属性后若难度名变化，可提议改成 `${difficultyName}.json`。
- 删除谱面立即写清单。工程级变更立即落盘。清单增加 `macros`。

## 菜单与命令

- 编辑：检查…（启用/参数）。
- 定时：调整偏移（工具栏图标；波形拖偏移，Ctrl 拖最近拍线改 BPM，Alt 为原来的寻点，无距离阈值，Esc 退出）；自动定时…（见下）。
- “时间反转”从事件菜单移到变换菜单。
- 通道：停用当前通道 `Ctrl+,`，启用全部 `Ctrl+Alt+,`。退后 3 秒改为 `Ctrl+Shift+,`。
- 吸附器：全部停用 `Alt+Shift+A`；按顺序/按时间吸附到曲线。激活/停用在无选中事件时作用于选中吸附器。
- 变换：带重新附着的翻转 `Ctrl+%` / `Ctrl+"`；时间平移…；时间伸缩用分子/分母（可假分数）。
- 自由变换：一维退化包围盒只留非退化轴与旋转；完全退化（单个未附着音符）不能启动。
- 音乐：其它速度… `Ctrl+0`；速度下限 0.1；`1`–`9` 细分、`Ctrl+1`–`9` 速度（菜单只列部分）。

## 自动定时（FMP 第 6 章）

自研 `js/core/ndarray.js`，无数值库依赖。流水线在 `js/dsp/`：

- 新奇度：energy / spectral / phase / complex
- 速度图：短时傅里叶 / 短时自相关
- 节拍跟踪：PLP / 动态规划
- 节拍去噪：管状 taut-string，再得到 offset、初始 BPM 和少量变速
- Worker：`js/dsp/auto-timing-worker.js`；预览用节拍器播放，确认后才写入谱面

表单在 `js/auto-timing-form.js`，参数按所选算法折叠。

## 谱面检查

`js/core/checks.js` + `js/core/checks-config.js` + 实时面板 `js/checks-panel.js`。十二类检查默认全开：空元数据、不规则难度、所需手指数、越界音符/背景音符、过短 hold/背景图案、过短游标、游标急转、游标瞬移、多字符 CJK、超出音乐范围。点击跳到违规处，双击打开检查表单并聚焦对应项。所需手指：hold 占用到结束拍（含），hold 期间的 drag 可共用该手指。

## 宏、CLI、Lint

- Monaco 跟随界面语言，并加载 API 补全（`js/macro-completions.js`）。运行宏的全局/工程单选记住到退出。Ruby `selected_events` 拼写已修正。
- 宏 API 按概念拆成 `macro-api-math.js` / `location` / `entities` / `event` / `chart`，沙箱用 ES 模块加载。
- NW.js `node-main`：`js/cli-main.js`。有 `--export` / `--import` / `--help` 时不启动 GUI。
- ESLint：文件 ≤1000 行、函数 ≤100 行、一行一句、行宽 120、函数之间空行、`if`/`for` 必须花括号、三元运算符不得跨行。`npm test` 先跑源码组织检查再 lint 再单测；`npm run build` 的前置是完整 `npm test`，通过后才打 NW.js 包。组织检查覆盖 CSS/HTML 行数和资源目录，JS 规则由 ESLint 负责。

## 帮助与快捷键

`docs/index.html` 中英文章节已与上述行为对齐，包括检查面板、自动定时、打开最近文件分支、通道/吸附器/变换新命令、`Ctrl+Shift+,`、`1`–`9` 与 `Ctrl+1`–`9`。快捷键弹窗仍由 `js/commands.js` 生成。

## 发版配置

- `package.json` / `package-lock.json`：`0.8.1`
- Service Worker 缓存：`sviber-v0801`，并列入全部应用模块、`css/dialogs.css` 和新图标
- `*.pdf` 已在 `.gitignore`（参考书不入库）

## v0.8.1

- 左侧检查列表的 `display: flex` 盖掉了 `[hidden]`，隐式网格行把滚动视图挤成 0 高。滚动视图与检查面板改到同一 `grid-area`，`[hidden]` 用更高优先级隐藏。
- `npm run build` 的前置是完整 `npm test`。组织检查成功信息改为 `Source organization check passed.`

## 验证

- `tests/v17-features.test.mjs`：命令/菜单、十二类检查、手指规则、吸附顺序/时间、DSP 冒烟、音量夹取、源码接线
- `tests/v17-cli.test.mjs`：CLI 导入导出与 ZIP 时间戳
- `tests/audio-platform.test.mjs` / `tests/play-follow-seek.test.mjs`：A-B 循环后音符 SE 按当前圈时钟排程
- 门禁：`npm test`（组织检查 + ESLint + 全部 `tests/*.test.mjs`）；`npm run build` 先跑 `npm test` 再打包
