# PROMPT-v22 Audit Report

本轮审计逐行阅读了 `dev-notes/PROMPT-v22.md` 的全部 4591 行。逐行实现、测试和结果矩阵见 [`dev-notes/PROMPT-v22-AUDIT-MATRIX.md`](PROMPT-v22-AUDIT-MATRIX.md)，该矩阵包含 4591 条连续 Prompt 行记录，以及此前所有 `NO-TEST/MISSING` 的 65 条逐项关闭台账。

## 本轮修复

- 修复 SSC 独立导入被错误标记为已保存的问题。SSC 导入结果保持 dirty，因此未手动保存退出后仍会进入自动保存恢复链路。
- 修复 SSC 解包媒体异步加载后，撤销事件移动会恢复空 `music`/`image` 字段的问题。项目媒体现在同步到历史状态；恢复旧快照时也保留当前媒体引用。
- 修复滚动视图双击群组内事件未进入临时群组选择的问题。
- 修复主编辑区 tip point spawn handle 在关闭“显示游标”时仍可交互的问题。
- 修复时间轴墨点 `bgNote` 文字未显示的问题。
- 修复通道复制丢失嵌套 group 的问题。
- 修复片段默认名称未国际化的问题。
- 按 PROMPT-v22 将退后 3 秒快捷键设为 `Ctrl+,`，同步中英文手册和现有断言。
- 直播托管内存关卡使用 ZIP `STORE`（level-0）压缩，普通文件导出继续使用 DEFLATE。

## 审计结论

- 模型、定时、事件、游标、检查、导入导出、工程、自动保存、宏 API、文件格式、Lyrica、CLI、构建和 CI/CD 需求均有实现；可独立验证的行为均由 Node `node:test` 单元测试覆盖。
- 纯视觉或真实 DOM hover 行为由源码契约测试和已有页面验证脚本覆盖；这类脚本没有被用来替代新增单元测试。
- 快捷键对话框动态遍历全部 `COMMAND_DEFINITIONS`，新增单元契约测试验证每个有快捷键的命令都出现在快捷键清单中。
- 预期的唯一重复快捷键是 `Ctrl+Shift+V`，由普通粘贴选项和复制吸附器选项按命令可用性消解；其余快捷键无重复。
- 中英文手册均包含菜单、时间轴、自动保存、工程、宏、文件格式、Lyrica、CLI、主题、快捷键和 v22 通道/面板行为说明。

## 测试清单

新增并通过的功能单元测试文件：

- `tests/ab-loop-marks.test.mjs`
- `tests/attach-curve-order.test.mjs`
- `tests/autosave-ssc-workflow.test.mjs`
- `tests/bg-note-timeline-text.test.mjs`
- `tests/channel-panel-ops.test.mjs`
- `tests/duration-endtime.test.mjs`
- `tests/fill-curve.test.mjs`
- `tests/level-archive-compression.test.mjs`
- `tests/open-recent-plan.test.mjs`
- `tests/page-navigation.test.mjs`
- `tests/seek-speed-commands.test.mjs`
- `tests/menu-toolbar-shortcuts.test.mjs`
- `tests/timeline-status-scroll.test.mjs`
- `tests/main-field-panels.test.mjs`
- `tests/snappee-geometry-commands.test.mjs`
- `tests/editor-commands-workflows.test.mjs`
- `tests/macro-interface-api.test.mjs`
- `tests/file-format-lyrica-live-hosting.test.mjs`
- `tests/project-release-contract.test.mjs`
- `tests/shortcuts.test.mjs`（全量快捷键清单契约）
- `tests/technical-notes.test.mjs`
- `tests/audit-contract-helpers.mjs`（测试辅助模块，不是测试文件）

最终验证：

- `npm test`: 500 项测试，499 通过，1 项环境相关测试跳过，0 失败。
- 按功能命名的审计测试共 99 项，全部通过；矩阵检查确认 4591 个连续行号和 65 条关闭记录。
- `npm run build`: 通过，生成 `build/sviber-0.13.2.nw` 和本地 NW.js 构建目录。
- SSC 专项回归：4 项通过，覆盖事件自动保存/恢复、导入 dirty 状态、媒体异步加载后的撤销、旧快照媒体兼容。
- 受影响功能专项测试：26 项通过；按功能命名的审计测试全部通过。
- ESLint 与 `git diff --check`: 通过。
