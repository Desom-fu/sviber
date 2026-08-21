# sviber 0.3.4

## 修复内容

### 分组自由变换

- 修复选中 group 后按 `Ctrl+T` 无法进入自由变换的问题。
- 当 group 内事件全部位于同一条水平线或竖直线上时，group 使用 1 单位的最小退化轴边界，仍可旋转、缩放和移动。
- 普通事件选区的退化边界规则保持不变，避免改变 v12 对普通事件的约束。
- 保留 group 子事件、嵌套事件和附着吸附器的递归变换逻辑。

### 帮助文档搜索

- 输入搜索词后自动滚动到文档顺序中的第一个匹配段落、列表项或表格行。
- 按 `Enter` 跳到下一个匹配，按 `Shift+Enter` 跳到上一个匹配，并在首尾循环。
- 当前匹配项使用边框标记，搜索状态显示当前序号与匹配总数。
- 中英文搜索、清除搜索和目录过滤继续保持可用。

## 验证

- `npm test`：全部通过。
- `npm run verify:browser`：通过编辑器、离线、画布、性能和 NW.js 相关浏览器回归。
- 实际浏览器验证：选中竖直排列的 group 后，`Ctrl+T` 能启动自由变换并显示四个角点。
- 实际浏览器验证：搜索自动定位首项，`Enter` 向下循环，`Shift+Enter` 向上循环。
- `npm run build`：支持通过 `SVIBER_BUILD_DIRECTORY` 指定独立输出目录；当桌面程序占用默认 `build/nw` 时，可在不关闭编辑器的情况下完成发布构建。

## 发布提交

```text
fix: release sviber 0.3.4 with group free transform and search navigation
```
