# sviber 0.3.7

## 片段行间距修复

- 在 42px 片段缩略图和片段名称之间增加 8px 视觉留白，名称不再紧贴缩略图边框。
- 留白通过名称内部起始边距实现，不改变五个操作按钮的列宽，也不会增加片段行整体宽度。
- 浏览器布局回归现在检查名称实际文字起点与缩略图之间至少保留 8px，同时继续检查名称不遮挡按钮、五个按钮不溢出。

## 文档与发布

- 更新英文 README、简体中文 README 和双语 HTML 帮助文档中的片段面板说明。
- 版本号更新为 `0.3.7`，入口资源更新为 `app.js?v=33`，Service Worker 缓存更新为 `sviber-v44`。

## 验证

- `npm test`
- `npm run verify:browser`
- `npm run build`
- `git diff --check`

## 发布提交

```text
fix: release sviber 0.3.7 with improved clip spacing
```
