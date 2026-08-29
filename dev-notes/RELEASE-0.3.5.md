# sviber 0.3.5

## PROMPT-v12 校正

### Group 模型、渲染与操作

- Group 不再保存 `time` 或 `channel`；显示时间递归取最早后代事件，通道相关操作也按后代叶事件判断。
- 检查器为 group 显示只读推导时间和可编辑颜色，不显示普通事件类型或通道。
- Group anchor 只在选中后于主编辑区显示和命中。Timeline 与 Scroll view 不再出现 anchor，但继续显示嵌套分组圈；边界框只包围后代叶事件，且父子 group 同时选中时只为根选择绘制。
- 修复唯一选中的 attached group 无法移动；现在 group 自身和全部可移动后代会一起移动。
- 复制、粘贴、片段、时间反转、通道移动、框选、删除和自由变换均使用无 group 时间/通道的递归事件树。

### 自动保存媒体恢复

- 自动保存改用版本化记录，同时保存谱面文档与本地工程/谱面来源上下文。
- NW.js 恢复自动保存时会先恢复工程和谱面路径，再自动重新载入相对路径的音乐与背景。

### 国际化与快捷键

- 页脚 JavaScript 许可信息链接补齐英文和简体中文 i18n。
- 历史记录在切换语言后重新翻译已有标签，Group/Ungroup 不再保留切换前的语言。
- Keyboard shortcuts 弹窗改为响应式多列；悬停每一项会在提示栏显示命令说明。
- Timing 使用 `Alt+T`，Transform 使用 `Alt+R`；Group/Ungroup 继续显示 `Ctrl+G` / `Ctrl+Shift+G`。

### Scroll view、构建、片段与手册

- Scroll view 当前时间线固定在距底部正好四分之一高度的位置。
- 构建脚本从 SVG 在源码根目录同时生成被 Git 忽略的 `icon.ico` 和 `icon.png`，支持直接运行 `nw .`，发行包图标保持对应平台格式。
- 片段行修正为 42px 缩略图、名称和五个独立操作按钮；缩略图支持 nested group、附着事件和按内容自动取景。
- 手册搜索保持全文可见，输入后自动定位第一项；`Enter` / `Shift+Enter` 按文档顺序循环查找。
- 中英文 README、HTML 手册、v11/v12 实施报告和回归审计已同步最终行为。

## 验证

- `npm test`：158/158 通过，源码大小检查通过。
- `npm run verify:browser`：中英文、主题、画布、交互、离线和 100000 事件性能回归通过；播放和编辑均为 0 掉帧。
- `npm run build`：使用 `D:\sunniesnow\sviber-build-0.3.5` 独立输出目录生成 `sviber-0.3.5.nw` 和 Windows x64 NW.js 包，并验证源码根目录 ICO/PNG 生成。
- `git diff --check`：补丁格式检查通过。

## 发布提交

```text
fix: release sviber 0.3.5 with prompt v12 regressions resolved
```
