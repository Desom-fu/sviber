# PROMPT v10 -> v11 实施报告

日期：2026-08-20
目标版本：`0.2.1`

## 1. Prompt 阅读与差异核对

本次先完整逐行读取了两个规范文件，再使用逐行 diff 复核：

- `PROMPT-v10.md`：2761 行。
- `PROMPT-v11.md`：2780 行。
- `PROMPT-v10.md -> PROMPT-v11.md`：32 行新增、13 行删除/替换。
- 新规范文件 `PROMPT-v11.md` 随实现一同纳入版本控制。

v11 的实际变化集中在以下规范段落：

| 规范变化 | 完成情况 | 主要实现位置 |
| --- | --- | --- |
| 网页版本可以安装为 PWA | 已完成 | `manifest.webmanifest`、`service-worker.js`、`index.html`、`js/app-core.js` |
| 状态栏复选框改为只有图标、没有可见文字 | 已完成 | `index.html`、`css/app-v11.css`、`svg/icons/*.svg` |
| 新增 Read-only 控件 | 已完成 | `js/app-core.js`、`js/commands.js`、`js/panels.js`、`js/app-macro-bridge.js`、`js/macros.js` |
| 新增 Fullscreen 控件和 F11 | 已完成 | `js/app-core.js`、`index.html`、JSON i18n |
| 状态栏中选中的注释显示为红色 | 已完成 | `js/app-core.js`、`css/app-v11.css` |
| 检查器空提示显示为灰色 | 已完成 | `js/panels.js`、`css/app-v11.css` |
| Scroll View 的纵向时间比例跟随时间轴 | 已完成 | `js/render/scroll-view.js`、`js/app-core.js` |
| Preferences 增加 `Ctrl+/` | 已完成 | `js/commands.js`、双语手册 |
| SE/Music volume 使用 range + output | 已完成 | `js/ui-fields.js`、`js/app-file-workflows.js` |
| Macros 命令使用图标并加入主工具栏 | 已完成 | `js/commands.js`、`svg/icons/macros.svg` |
| Documentation 增加 F1；Help 包含 Report issues | 已完成 | `js/commands.js`、双语手册；Report issues 原功能保留 |

## 2. v11 功能实现

### 2.1 PWA 与离线资源

- `manifest.webmanifest` 增加稳定的 `id`，保留独立窗口显示模式、作用域、启动地址和应用图标。
- `index.html` 继续从站点根加载 manifest，并在浏览器环境注册 Service Worker。
- Service Worker 缓存版本升级为 `sviber-v31`，应用入口 cachebuster 升级为 `v=21`。
- 离线应用外壳新增缓存：v11 CSS、两份 JSON 翻译、状态栏图标、Macros 图标和 manifest。
- 移除已经不存在的 `js/i18n-v10.js` 缓存项，避免安装阶段因 404 使整批缓存失败。
- 浏览器验证覆盖在线启动、Service Worker 离线重载和三块 Canvas 非空检查。

### 2.2 状态栏六个图标控件

状态栏现在依次提供：

1. Lock visible range
2. SE
3. Seek back after playing
4. Metronome
5. Read-only
6. Fullscreen

每项仍使用原生 checkbox 保留键盘、焦点和无障碍语义，但可见标签只显示用户提供的 SVG 图标。控件具有 `aria-label`、tooltip、聚焦边框和选中状态，窄屏时可以稳定换行。

### 2.3 Read-only 权限边界

只读模式不是单纯隐藏菜单，而是在多个层级阻止修改：

- 命令注册表只允许事件选择、复制、时间与可见范围导航、Music、注释、Preferences、Help 和打开 Macros。
- `commit()` 和 `preview()` 作为最终写入保护，默认拒绝所有修改。
- 注释仍可创建、修改时间/通道/时长/正文和删除，但不能把注释转换成其他事件类型。
- Inspector 在非注释选择下整体禁用；只选择注释时只开放注释字段。
- Snappees 面板禁用选择和全部操作；Channels 面板仍可切换当前通道，但禁用启停、复制、排序、重命名和删除。
- History 面板按钮禁用，`goToHistory()` 本身也再次检查只读，不能绕过命令系统跳转历史。
- 难度选择器在只读时禁用，避免切换到另一个谱面状态。
- 开启只读会退出创建、曲线和自由变换等编辑模式。
- 只读状态保存在 editor 数据中并可正常导入/导出。

Macros 窗口会从主窗口读取并实时接收只读状态：

- 全局宏仍可新建、编辑、保存、重命名、导入和删除。
- 工程宏仍可查看、复制和导出，但编辑器与写入相关命令会禁用。
- Run 和 F8 对所有宏禁用；执行入口和主窗口应用入口还各有一次保护。
- 工程宏文件的写入、重命名和删除接口在主窗口侧也拒绝只读请求。

### 2.4 Fullscreen

- 状态栏 checkbox 可进入/退出浏览器 Fullscreen API 或 NW.js fullscreen。
- `F11` 直接监听在 document 上，即使表单正在打开也可切换。
- 浏览器/NW.js 从其他途径改变全屏时，checkbox 会通过事件自动同步。
- NW.js 全屏状态下会阻止 Escape 的默认退出行为；浏览器保留平台强制的标准 Escape 行为。
- 全屏失败会显示本地化错误信息。

### 2.5 状态文字、偏好和工具栏

- 当前时间内生效的注释会包含选择状态；选中注释使用红色强调色。
- Inspector 没有选择时使用灰色 muted 样式。
- SE volume 和 Music volume 改为原生滑块，旁边的 `<output>` 实时显示两位小数。
- Preferences 快捷键为 `Ctrl+/`，Documentation 快捷键为 `F1`。
- Macros 使用 `macros.svg`，并作为新的第 35 个按钮加入主工具栏。

### 2.6 Scroll View 时间比例

旧实现用同一个 scale 同时表示谱面 x 坐标和秒数，不符合 v11。现在拆为：

- `xScale`：只由 Scroll View 宽度和谱面 x 边界决定。
- `timeScale`：使用 `timelineWidth / timelineVisibleSeconds`，与时间轴横向每秒像素数一致。
- 当前时间仍固定在靠近底部的位置；可见时间范围允许超出音乐边界。

## 3. 用户报告问题修复

### 3.1 顶部 Channel 菜单重复重命名

- 删除 `channel.rename` 命令定义、注册和顶部菜单项。
- 删除两份 JSON 中已经无调用方的 `command.channel.rename*` 文案。
- 右侧 Channels 面板的编辑图标、双击重命名和对应翻译完整保留。

### 3.2 英文界面的中文语言名称

- 英文和中文翻译中，中文选项都固定显示 `简体中文`。
- 英文选项在两种界面中都固定显示 `English`。
- 宏页面也使用同一份翻译数据，并优先读取 URL 或已保存的界面语言。

### 3.3 难度下拉框聚焦后快捷键失效

- `#difficulty-select` 被明确排除出普通可编辑输入的快捷键拦截规则。
- 选择器聚焦时，Space、数字键和其他全局快捷键继续交给命令系统。
- 普通文本框、数字框和 textarea 的输入保护不受影响。

### 3.4 Tip Point 半透明白线铺满整行

根因是时间轴静态引导线按完整 guide 绘制，两个端点都在视口外的长区间仍会被 Canvas 裁剪成贯穿整个可见范围的粗白线，看起来像与当前可见音符无关的一整行。

修复方式：

- 在 `js/render/timeline-helpers.js` 新增 `timelineTipSegments()`。
- 只生成同一 guide 中相邻事件之间的线段。
- 一条静态线段至少有一个端点位于当前时间视口内才绘制。
- 保留生成位置到首事件的线段和末端裁剪规则。
- 播放中的 Tip Point 运动轨迹继续使用原有完整 guide 算法，不改变游戏预览动画。

专项测试覆盖：可见相邻事件、两端均在视口外、spawn segment、视口边缘裁剪和原有 11 项 Tip Point 行为。

## 4. JSON i18n 与单文件限制

- 删除内嵌大对象文件 `js/i18n-v10.js`。
- 新增 `json/i18n.en-US.json` 和 `json/i18n.zh-CN.json`，每份 623 个完全对应的 key。
- `js/i18n.js` 只负责静态 JSON import、语言归一化、插值、DOM 应用和订阅。
- JSON 不属于 1000 行源码限制；JS/CSS/HTML/MJS 仍由 `scripts/check-source-size.mjs` 强制检查。
- 新增 `css/app-v11.css` 承载 v11 样式，避免已经接近限制的 `css/app.css` 超过 1000 行。
- 当前最大的受检文件仍不超过限制：`css/app.css` 997 行、`js/app-core.js` 996 行、`js/app-event-editing.js` 989 行。

## 5. 文档同步

以下内容已同时更新英文和中文版本：

- README 的 v11 功能概览、语言标签、主题、只读、全屏、PWA 和发行架构。
- 用户手册的六个图标控件、注释红色、灰色空提示、Scroll View 比例、滑块、Macros 工具栏、快捷键和 PWA。
- 顶部 Channel 菜单不再列出 Rename，并明确右侧面板仍可重命名。
- 手册写明只读模式下全局/工程宏的差异和禁止运行规则。
- 手册写明 Tip Point 静态连接线不会再由视口外事件铺满整行。

## 6. 桌面打包与 Release 配置

发行矩阵保持按架构拆分，且格式统一为用户要求：

| 平台 | 架构 | 格式 |
| --- | --- | --- |
| Windows | x86、x86_64、aarch64 | ZIP |
| macOS | x86_64、aarch64 | ZIP |
| Linux | x86_64、aarch64 | `tar.gz` |
| Runtime-free | 通用 `.nw` | ZIP 格式的 `.nw` 文件 |

- macOS workflow 从 DMG 改为 `ditto` 生成 ZIP，仍保留 `.app` 的资源属性。
- Release workflow 只收集 ZIP、`tar.gz` 和 `.nw`，不再收集 DMG。
- `scripts/build-nw.mjs` 明确排除用户提供的 `new-icons-4/` 参考目录；该目录保留在本地，不提交也不打包。
- `package.json` 与 `package-lock.json` 版本均更新为 `0.2.1`。
- 推送 `v0.2.1` tag 后由 Release workflow 先测试、再构建所有架构、最后创建 GitHub Release。

## 7. 验证结果

### 自动测试

- `npm test`：130 项全部通过，0 failed。
- v11 + Tip Point + 打包专项：26 项全部通过。
- `node scripts/check-source-size.mjs`：通过。
- `git diff --check`：通过。

### 浏览器验证

`npm run verify:browser` 通过，覆盖：

- 1440x900 深色英文界面与 960x620 中文窄屏界面。
- 明确主题在主编辑器、Macros 和手册间继承。
- 工具栏 35 个按钮全部位于容器内，没有溢出或重叠。
- Timeline、Scroll View、Stage 三块 Canvas 均非空。
- Service Worker 离线重载成功。
- 10 万事件播放/编辑各 180 帧，掉帧数均为 0。
- 只读模式下的命令、检查器、通道、历史和注释权限经过真实 DOM 交互验证。
- 宏桥接、控制台转发和单条历史提交正常。

### 性能与构建

- `npm run benchmark:render`：10 万事件、600 帧，平均帧查询约 `0.013 ms`，P95 约 `0.023 ms`。
- `npm run build`：Windows x64 NW.js 应用与 `sviber-0.2.1.nw` 均生成成功。
- 构建内所有 sviber `package.json` 版本均为 `0.2.1`。
- 本次本地验证生成的 `.nw` 大小：95,265,305 bytes。
- 该本地验证文件的 SHA-256：`60C640F84C64B91D039162EC69648AB3B56995494AA2901FEB7440D884AA8933`；Release workflow 会重新构建附件，因此线上附件哈希会另行生成。
- 递归检查确认构建中不存在 `new-icons-4/`。

## 8. 提交信息

```text
feat: implement PROMPT v11 and release v0.2.1

Add PWA caching, JSON localization, icon-only status controls,
read-only and fullscreen modes, aligned Scroll View timing, volume
sliders, macro toolbar access, and updated bilingual documentation.

Fix the Chinese language label, focused difficulty shortcuts, duplicate
channel rename command, Tip Point timeline connectors, and desktop
archive formats.
```
