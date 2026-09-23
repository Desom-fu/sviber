# IMPLEMENTATION_v27

本文件按 `PROMPT-v26.md → PROMPT-v27.md` 的差异清单逐条记录 v27 的实现内容、涉及文件、实现方式与验证结果。发布版本：v0.18.0。

原始统一 diff 见 `dev-notes/PROMPT-v26-v27.diff`。下文同时收录同一份 diff，便于后续比对。

## 差异清单与实现状态（逐条）

| # | 类型 | 差异条目 | 实现情况 |
|---|---|---|---|
| 1 | 新增 | 新谱面初始三条通道；可新建、删除、重排；始终至少保留一条 | 已实现。`defaultNewChartChannels()` 给出 id 0/1/2。删除最后一条通道时 `removeChannel` 返回空。Sunniesnow 导入仍只建一条通道 |
| 2 | 新增 | 部分曲线有一个不在曲线上的特殊吸附点；沿曲线移动时，吸附在该点上的事件不动 | 已实现。`applyCurveAttachedMove` 只在曲线上的点之间滑动，特殊点保持原 `snapPoint` |
| 3 | 新增 | 正多边形中心是编号 `-1` 的特殊吸附点 | 已实现。`sampleRegularPolygon` 在边点之后追加中心 |
| 4 | 新增 | 圆弧圆心是编号 `-1` 的特殊吸附点 | 已实现。`sampleCircularArc` 同样追加圆心。宏 `pos(-1)` 返回圆心 |
| 5 | 修改 | 渲染视频的头像来源增加 `avatarWeavatar` | 已实现。下拉选项含 weavatar；只显示当前来源对应的输入，并记住上次填写的邮箱 |
| 6 | 修改 | 渲染封面同样增加 `avatarWeavatar` | 已实现。封面与视频共用同一组头像字段 |
| 7 | 新增 | Snappee 菜单增加 Pencil，快捷键 Ctrl+Shift+P | 已实现。`snappee.pencil`，可勾选，播放中不可用。规格未给图标，菜单项无图标 |
| 8 | 新增 | 铅笔：一笔自由绘制成钢笔曲线；`getCoalescedEvents()` 采样；`@stroke-stabilizer/core` 平滑；起止可吸附并追加控制点；终点吸到起点则闭合；结束后打开钢笔参数窗 | 已实现。产物类型是 `penCurve`，命令只有 `M`/`L` |
| 9 | 新增 | 各 Snappee 子类有自己的属性读写方法 | 已实现。JS 子类原型与 Ruby `SnappeeProperties` 按类型暴露字段 |
| 10 | 修改 | Snappee 增加 `#active`/`#active=`、`#i_range`/`#j_range`、排除终点、`#has_special?`、`#special_i` | 已实现。JS 的 `iRange` 返回两个数；Ruby 的 `i_range` 返回 Range。`j` 只对网格有效，范围不含特殊点。网格的 `has_special?` 恒为假。无特殊点时 `special_i` 为空 |

## 主要实现说明

### 新谱面通道

`ChartModel.createDefault()` 使用 `defaultNewChartChannels()`。空通道列表归一化时也落到这三条。`_importSunniesnow` 显式传入一条通道，避免把导入谱面当成新建谱面。

### 特殊吸附点

正多边形与圆弧的采样在曲线点之后追加 `snapPoint === -1` 的中心。沿曲线滑动、按顺序/时间附着、用拖拽音符填满曲线时都会跳过这个点。单颗已附着音符仍可自由拖离，这与既有的单选拖动规则一致。

### 铅笔

`js/app/pencil-stroke.js` 用 `StabilizedPointer` 加 `oneEuroFilter` 处理采样，再按 6.25 的谱面距离决定起点和终点是否追加吸附点。笔画提交为一条 `penCurve`，然后打开与钢笔相同的参数窗，焦点在分段数。依赖为 `@stroke-stabilizer/core@0.3.1`。

### 宏 API

索引范围集中在 `js/core/snappee-index.js`。Ruby 侧 `SviberMacroInternals.index_spec` 与之对应。`active = false` 会停用并取消选择，与 `deactivate` 相同。已重打 `macro-sandbox.bundle.js`。

### 帮助与快捷键

四语手册已写上三条通道、中心点 `-1`、沿曲线滑动时中心事件不动、WeAvatar、铅笔（Ctrl+Shift+P）以及新的 Snappee 方法。快捷键对话框仍从 `COMMAND_DEFINITIONS` 生成，因此铅笔会出现在快捷键列表里。

## 测试与验证结果

`npm test`（ESLint `--max-warnings 0` + `node --test tests/*.test.mjs`）为 **782 通过 / 0 失败**。

按功能命名的新测试文件：

- `tests/new-chart-channels.test.mjs`
- `tests/special-snap-point.test.mjs`
- `tests/render-avatar-weavatar.test.mjs`
- `tests/pencil-tool.test.mjs`
- `tests/snappee-macro-ranges.test.mjs`

没有在运行中的编辑器里用鼠标走完铅笔笔画和渲染对话框。上述行为由单元测试覆盖：采样、平滑折线、吸附追加点、命令注册、头像字段显隐，以及宏索引范围。

## 原始 diff

完整 unified diff 保存在 `dev-notes/PROMPT-v26-v27.diff`。下文为同一文件内容。

```diff
diff --git a/dev-notes/PROMPT-v26.md b/dev-notes/PROMPT-v27.md
index 4cf7ffb..a477ced 100644
--- a/dev-notes/PROMPT-v26.md
+++ b/dev-notes/PROMPT-v27.md
@@ -315,6 +315,10 @@ possibly being `tap`, `hold`, `drag`, `flick`, `bgNote`, `bigText`, any one of t
 The possible events do not include BPM changes because they are not real Sunniesnow events,
 and the BPM change events are shown in the [waveform](#waveform) instead of the channels.
 
+For a new chart, initially there are three channels.
+The user can create new channels, delete channels, and reorder channels.
+However, there must always be at least one channel in the chart.
+
 At the left, for each channel, the name of the channel is shown.
 The name is bright yellow for the current channel or is otherwise light gray.
 The name is translucent if the channel is inactive.
@@ -1483,6 +1487,8 @@ For example, when the user moves events from one snap point to another on a curv
 the events can be moved indefinitely along the curve if the curve is a closed loop;
 on the ohter hand, if the curve has open ends,
 the events cannot be moved past the ends.
+For some curves, there is one special snap point that is not on the curve.
+For this case, events attached to this snap point does not move when the user moves events along the curve.
 
 Snappees can be transformed by some tools such as [free transform](#free-transform).
 Such transformations are not implemented by directly changing the parameters of the snappees
@@ -1538,6 +1544,8 @@ the direction of one radius segment of the regular polygon specified as polar an
 the number of sides $n$ of this regular polygon,
 and the number of segments $m$ on each side.
 There are totally $nm$ snap points on the sides of the regular polygon.
+There is also a special snap point that is not on the curve, which is the center of the polygon.
+The special snap point is numbered as `-1`.
 
 A regular polygon curve is naturally a closed loop.
 
@@ -1550,6 +1558,8 @@ and two boolean parameters for whether the arc is clockwise or anticlockwise
 and whether it is a closed curve (full circle).
 The snap points are the vertices of segments of the curve,
 and the segments are determined by dividing the curve into $m$ segments with equal curve lengths.
+There is also a special snap point that is not on the curve, which is the center of the circle.
+The special snap point is numbered as `-1`.
 
 After creating curve, open a popup form for editing its parameters.
 The input is focused at the field for changing the number of segments.
@@ -2017,7 +2027,7 @@ For rendering video, the customizable options are:
 - `nickname`: Use the value the user filled in last time as default.
   If this is the first time, use the chart's `charter` property as default.
 - `avatar`: Use the value the user filled in last time as default.
-- `avatarOnline`, `avatarUpload`, `avatarGravatar`:
+- `avatarOnline`, `avatarUpload`, `avatarGravatar`, `avatarWeavatar`:
   Depending on which value is set for `avatar`, at most one input field is shown.
   Fill in the value the user used last time.
 - Whether to use bundled FFmpeg. This option does not appear if bundled FFmpeg is not available
@@ -2030,7 +2040,7 @@ For rendering video, the customizable options are:
 
 For rendering cover, the customizable options are:
 
-- `nickname`, `avatar`, `avatarOnline`, `avatarUpload`, `avatarGravatar`, `width`, `height`:
+- `nickname`, `avatar`, `avatarOnline`, `avatarUpload`, `avatarGravatar`, `avatarWeavatar`, `width`, `height`:
   Handle them in the same way as those in options for rendering video.
 - `coverThemeImageX`, `coverThemeImageY`, `coverThemeImageWidth`:
   Show a GUI widget powered by PixiJS for setting those parameters instead of having input fields.
@@ -2829,6 +2839,7 @@ The "Snappee" menu item contains the following submenu items:
 - B&eacute;zier curve (<kbd>Ctrl</kbd>+<kbd>B</kbd>) (`../maker/svg/icons/create-bezier-curve.svg`)
 - Circular arc (`../maker/svg/icons/create-circular-curve.svg`)
 - Pen (<kbd>Ctrl</kbd>+<kbd>P</kbd>) (`../maker/svg/icons/pen.svg`)
+- Pencil (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>)
 - Parametric curve...
 - (separator)
 - Preset snappee...
@@ -2961,6 +2972,23 @@ considering snapping.
 
 Individual control point actions are separate items in the history panel.
 
+#### Pencil
+
+Enters pencil mode.
+It creates a pen curve (not a new type of curve) by free drawing one stroke with the mouse.
+The pen curve is a broken line with many control points.
+The start of the stroke can snap to a snap point, and the end of the stroke
+can snap to a snap point or the start of the stroke (in which case the curve is set as a closed loop).
+If the start or the end of the stroke snaps to something,
+an additional control point is created at the snap point before or after the actual start or end of the stroke, respectively.
+
+The raw sampling points are taken from `getCoalescedEvents()` of pointer events.
+They are then processed using [@stroke-stabilizer/core](https://github.com/usapopopooon/stroke-stabilizer)
+to get a smoother broken line, which will make up the pen curve.
+
+After the user finishes the stroke, a popup form appears to let the user edit the resultant curve.
+The popup form is the same as the one for editing a pen curve.
+
 #### Parametric curve...
 
 Similar to rectangular mesh. Input fields:
@@ -4539,6 +4567,7 @@ it also have these methods to modify itself, and they all return `self`:
 - `#to_json(*args)`: same as `to_h.to_json(*args)`.
 
 `Snappee` class has subclasses `RectangularMesh`, `RadialMesh`, `ParametricMesh`, `RegularPolygonCurve`, `BezierCurve`, `PenCurve`, `ParametricCurve`.
+In addition to the methods listed here, each subclass has their own methods for getting and setting properties.
 
 - `::new(*args, name: nil, color: nil)`: create new snappee; the signature of `args` is specified in subclasses; automatically choose name and color if not given.
 - `::get(n)`: get a snappee; `n` can be integer (0-based) according to the order in the snappees panel (not ID number) or string for name.
@@ -4550,10 +4579,17 @@ it also have these methods to modify itself, and they all return `self`:
 - `#name`, `#name=`.
 - `#color`, `#color=`.
 - `#id`.
-- `#activate`, `#deactivate`, `#active?`.
+- `#activate`, `#deactivate`, `#active?`, `#active`, `#active=`.
 - `#selected?`.
 - `#select`.
 - `#pos(i)` or `#pos(i, j)`: get `Point2D` object.
+- `#i_range`, `#j_range`: get the range of valid indices for `#pos`.
+  `#j_range` is only valid for meshes.
+  The range does not include the special snap point, if any.
+  Return a range object in Ruby, and an array of two numbers in JavaScript.
+- `#i_exclude_end?`, `#j_exclude_end?`: whether the end of the index range is excluded.
+- `#has_special?`: whether the snappee has a special snap point. It is always false for meshes.
+- `#special_i`: the `i` index of the special snap point.
 - `#delete`.
 - `#duplicate(name=self.name, color=self.color)`: return a new duplicated snappee.
 - `#to_h`: hash map with the same structure as elements in [`snappees` field](#snappees-field).
```
