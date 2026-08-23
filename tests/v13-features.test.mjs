import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ChartModel } from "../js/core/chart-model.js";
import { TimingMap } from "../js/core/timing.js";
import { COMMAND_DEFINITIONS, MENU_DEFINITION, TOOLBAR_ITEMS } from "../js/commands.js";

test("bar lines drive rational beat lines and snapping", () => {
	const timing = new TimingMap({ initialBpm: 120, barLines: [{ time: [1, 2, 3] }] });
	const lines = timing.beatLinesBetween([0, 0, 1], [3, 0, 1], 2);
	assert.ok(lines.some(line => line.barLine && line.beat.equals([1, 2, 3])));
	assert.equal(lines.find(line => line.beat.equals([2, 1, 6])).relative.toString(), "1/2");
	assert.equal(lines.find(line => line.barLine).beat.toString(), "1+2/3");
	assert.equal(timing.snapBeat([2, 1, 6], 2).toString(), "2+1/6");
	assert.deepEqual(timing.toJSON().barLines, [{ time: [1, 2, 3] }]);
});

test("v13 editor view and background visibility fields round-trip", () => {
	const model = ChartModel.createDefault({ editor: {
		showBgEventsInTimeline: false, showBgEventsInMainField: false,
		mainFieldPanX: 12, mainFieldPanY: -4, mainFieldZoom: 1.75,
	} });

	const restored = ChartModel.import({ sviber: model.serializeSviber(), metadata: model.metadata });
	assert.equal(restored.editor.showBgEventsInTimeline, false);
	assert.equal(restored.editor.showBgEventsInMainField, false);
	assert.equal(restored.editor.mainFieldPanX, 12);
	assert.equal(restored.editor.mainFieldPanY, -4);
	assert.equal(restored.editor.mainFieldZoom, 1.75);
});

test("v13 commands expose bar line and time dilation", () => {
	assert.equal(COMMAND_DEFINITIONS["timing.barLine"].shortcut, "R");
	assert.ok(COMMAND_DEFINITIONS["transform.timeDilation"]);
	const timing = MENU_DEFINITION.find(menu => menu.id === "timing");
	const transform = MENU_DEFINITION.find(menu => menu.id === "transform");
	assert.ok(timing.items.some(item => item.command === "timing.barLine"));
	assert.ok(transform.items.some(item => item.command === "transform.timeDilation"));
});

test("v13 inspector hides inactive tip-point input rows and preserves panel scroll", async () => {
	const [panels, css] = await Promise.all([
		readFile(new URL("../js/panels.js", import.meta.url), "utf8"),
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
	]);
	assert.match(css, /\.property-row\[hidden\]\s*\{\s*display:\s*none;/);
	assert.match(panels, /if \(control\?\.dataset\?\.hidden === "true"\) row\.hidden = true/);
	assert.match(panels, /setControlHidden\(distanceControl, !spawnFieldsEnabled \|\| absolute !== false\)/);
	assert.match(panels, /setControlHidden\(absoluteWrapper, !spawnFieldsEnabled \|\| absolute !== true \|\| attached === true\)/);
	assert.match(panels, /setControlHidden\(secondsControl, !spawnFieldsEnabled \|\| timeInBeats !== false\)/);
	assert.match(panels, /setControlHidden\(beatsControl, !spawnFieldsEnabled \|\| timeInBeats !== true\)/);
	const snappeeStart = panels.indexOf("export class SnappeesPanel");
	const channelsStart = panels.indexOf("export class ChannelsPanel");
	const snappees = panels.slice(snappeeStart, channelsStart);
	assert.match(snappees, /const scrollTop = Number\(this\.element\.scrollTop\)/);
	assert.match(snappees, /this\.element\.scrollTop = scrollTop/);
});

test("v13 build/package metadata is shared through JSON and Nix", async () => {
	const [fonts, build, defaultNix, flake] = await Promise.all([
		readFile(new URL("../json/font-assets.json", import.meta.url), "utf8"),
		readFile(new URL("../scripts/build-nw.mjs", import.meta.url), "utf8"),
		readFile(new URL("../default.nix", import.meta.url), "utf8"),
		readFile(new URL("../flake.nix", import.meta.url), "utf8"),
	]);
	assert.ok(JSON.parse(fonts).length >= 5);
	assert.match(build, /font-assets\.json/);
	assert.match(defaultNix, /builtins\.fromJSON \(builtins\.readFile \.\/json\/font-assets\.json\)/);
	assert.match(defaultNix, /importNpmLock\.npmConfigHook/);
	assert.match(defaultNix, /SVIBER_NW_PACKAGE_ONLY=1/);
	assert.match(defaultNix, /makeWrapper/);
	assert.match(flake, /nixos-unstable/);
});

test("v13 macro wrappers expose timing, location, grouping, channels, and clips", async () => {
	await import("../js/macro-api.js");
	const runtime = globalThis.createSviberMacroApi({
		editor: { currentChannel: 0, currentTime: [0, 0, 1] },
		channels: [{ id: 0, name: "Main", color: "#ffffff", active: true }], events: [], snappees: [], clips: [],
		timing: { offset: 0, initialBpm: 120, bpmChanges: [], barLines: [] },
	});
	const api = runtime.globals;
	assert.throws(() => new api.Event({ type: "bg_note", location: new api.Location(0, 0) }), /Unsupported event type/);
	assert.throws(() => new api.AffineMatrix2D([1, 0, 0, 1, 4, 5]), /matrix elements must be finite numbers/);
	const partialMatrix = new api.AffineMatrix2D(2);
	assert.deepEqual(Object.fromEntries(["a", "b", "c", "d", "tx", "ty"].map(key => [key, partialMatrix[key]])),
		{ a: 2, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
	const channel = api.Channel.current;
	assert.equal(channel.name, "Main");
	channel.name = "Edited";
	const note = new api.Event({ type: "tap", location: new api.Location(2, 3), time: [1, 1, 2] });
	assert.deepEqual(note.time, [1, 1, 2]);
	assert.equal(note.type, "tap");
	const group = api.g([note], 0xff0000);
	assert.equal(group.group, true);
	group.location = new api.Location(5, 6);
	assert.equal(group.events[0].location.x, 7);
	const bar = new api.BarLine([1, 1, 2]);
	assert.equal(api.Chart.barLines.length, 1);
	bar.delete();
	const clip = new api.Clip(group.events, "test");
	assert.equal(api.Chart.clips[0].name, "test");
	assert.ok(clip.paste([2, 0, 1], channel)[0] instanceof api.Tap);
	assert.equal(Object.hasOwn(note, "raw"), false);
	assert.equal(runtime.state.channels[0].name, "Edited");
});

test("v13 macro geometry, tip-point serialization, relative copy, and deletion are enforced", async () => {
	await import("../js/macro-api.js");
	const runtime = globalThis.createSviberMacroApi({
		editor: { currentChannel: 30, currentTime: [3, 0, 1] },
		channels: [{ id: 10, name: "First", color: "#ffffff", active: true }, { id: 30, name: "Main", color: "#ffffff", active: true }],
		events: [], snappees: [], clips: [], timing: { bpmChanges: [], barLines: [] },
	});
	const api = runtime.globals;
	const mesh = new api.RectangularMesh(-10, 10, 10, -10, 2, 2);
	assert.deepEqual([mesh.pos(2, 2).x, mesh.pos(2, 2).y], [10, -10]);
	assert.ok(api.Snappee.list[0] instanceof api.RectangularMesh);
	const radial = new api.RadialMesh(0, 0, 10, 4, 1, "up");
	assert.ok(Math.abs(radial.pos(0, 1).x) < 1e-12);
	assert.equal(radial.pos(0, 1).y, 10);
	const polygon = new api.RegularPolygonCurve(0, 0, 10, "up", 4, 1);
	assert.ok(Math.abs(polygon.pos(0).x) < 1e-12);
	assert.equal(polygon.pos(0).y, 10);
	const previousMath = globalThis.math;
	globalThis.math = await import("mathjs");
	const parametric = new api.ParametricMesh([0, 2], [0, 2], "i * 10 + j", "j - i");
	assert.deepEqual([parametric.pos(2, 1).x, parametric.pos(2, 1).y], [21, -1]);
	globalThis.math = previousMath;
	const attached = new api.Location(mesh, 1, 1);
	assert.throws(() => new api.Location(mesh, [1, 1]), /one curve index or two mesh indices/);
	const reassigned = new api.Location(9, -9);
	reassigned.snappee = mesh;
	assert.deepEqual([reassigned.x, reassigned.y], [10, -10], "assigning snappee must attach to its nearest point");
	const note = new api.Tap({ location: attached, time: [1, 1, 2], channel: api.Channel.getById(10) });
	assert.equal(note.location.attached, true);
	const tip = api.TipPoint.chain({ location: new api.Location(4, 5), timeBeats: [1, 1, 2] });
	note.tipPoint = tip;
	assert.equal(runtime.state.events[0].tipPointSpawnAbsolutePosition, true);
	const matrix = new api.AffineMatrix2D().translate(2, 3).rotate(Math.PI / 2);
	assert.ok(Math.abs(matrix.a) < 1e-12);
	api.transform(note, function () { this.translate(1, 2); });
	assert.deepEqual([note.tipPoint.location.x, note.tipPoint.location.y], [5, 7]);
	assert.throws(() => api.transform(note, [1, 0, 0, 1, 0, 0]), /AffineMatrix2D or a callback/);
	assert.throws(() => api.transform(note), /AffineMatrix2D or a callback/);
	const copies = api.copy([note]);
	assert.equal(copies.length, 1);
	assert.deepEqual(copies[0].time, [3, 0, 1]);
	assert.equal(copies[0].channel.id, 30, "copy must use channel order rather than ID arithmetic");
	assert.throws(() => api.copy(), /array of events/);
	const directChild = new api.Tap({ text: "direct child" });
	const directGroup = new api.Group({ events: [directChild] });
	assert.equal(api.Channel.current.events.some(event => event.text === "direct child"), false);
	assert.equal(directGroup.events[0].text, "direct child");
	assert.throws(() => new api.Tap({ time: { numerator: 1, denominator: 2 } }), /beat/);
	assert.throws(() => api.b(null), /beat/);
	assert.throws(() => new api.Event({ location: new api.Location(0, 0) }), /type is required/);
	assert.throws(() => api.TipPoint.chain(10, "up", 1), /options object/);
	const flick = new api.Flick({ location: new api.Location(0, 0), angle: "up" });
	const flickRecord = runtime.state.events.at(-1);
	assert.equal(flick.angle, Math.PI / 2);
	assert.equal(new api.Flick({ angle: "upLeft" }).angle, 3 * Math.PI / 4);
	assert.equal(new api.Flick({ angle: "leftUp" }).angle, 3 * Math.PI / 4);
	assert.throws(() => new api.Flick({ angle: "up_left" }), /direction name/);
	flick.type = "hold";
	assert.equal(flick.type, "hold");
	assert.equal(Object.hasOwn(flickRecord, "angle"), false);
	const channel = new api.Channel({ name: "Temporary" });
	channel.delete();
	for (const operation of [() => channel.select(), () => channel.name, () => channel.toJSON()]) {
		assert.throws(operation, /deleted/);
	}
	const clip = new api.Clip([note], "Relative");
	const serializedClip = clip.toJSON();
	assert.equal(serializedClip.data.version, 1);
	assert.deepEqual(serializedClip.data.events[0].time, [0, 0, 1]);
	assert.equal(serializedClip.data.events[0].channel, 0);
});

test("v13 manual documents only the prompt macro surface in both languages", async () => {
	const manual = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");
	const english = manual.slice(manual.indexOf('id="en-macro-api"'), manual.indexOf('id="en-data"'));
	const chinese = manual.slice(manual.indexOf('id="zh-macro-api"'), manual.indexOf('id="zh-data"'));
	const chineseArticle = manual.slice(manual.indexOf('<article data-language="zh-CN"'));
	for (const section of [english, chinese]) {
		assert.match(section, /Chart/);
		assert.match(section, /AffineMatrix2D/);
		assert.match(section, /Location\(mesh,i,j\)/);
		assert.match(section, /TipPoint/);
		assert.match(section, /BpmChange/);
		assert.match(section, /BarLine/);
		assert.match(section, /Channel/);
		assert.match(section, /Snappee/);
		assert.match(section, /Event/);
		assert.match(section, /Clip/);
		assert.match(section, /copy\(events\)/);
		assert.match(section, /transform\(things/);
		assert.doesNotMatch(section, /<code>(?:api|state|chart)\./);
		assert.doesNotMatch(section, /findEvent|updateEvent|removeEvent|\$sviber/);
		assert.match(section, /bgNote\(location,duration=0,text=""\)/);
		assert.doesNotMatch(section, /bgNote\(location,angle/);
	}
	assert.doesNotMatch(chineseArticle, /背景音符|Tip point/);
	assert.match(chineseArticle, /墨点/);
	assert.match(chineseArticle, /游标/);
	assert.match(chineseArticle, /mainFieldPanX/);
	assert.match(chineseArticle, /mainFieldZoom/);
	assert.match(chineseArticle, /barLines/);
	assert.match(chineseArticle, /任意位置/);
});

test("v0.4.1 toolbar and wheel routing keep main-field controls discoverable", async () => {
	assert.equal(TOOLBAR_ITEMS[TOOLBAR_ITEMS.indexOf("events.bpmChange") - 1], "separator");
	const [css, timeline] = await Promise.all([
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
		readFile(new URL("../js/render/timeline.js", import.meta.url), "utf8"),
	]);
	assert.match(css, /\.reset-main-field-view[^\{]*\{[^}]*border: 2px solid var\(--text\)/s);
	assert.match(timeline, /if \(event\.ctrlKey && event\.shiftKey\) \{[\s\S]*onMainFieldZoom/s);
});

test("v13 global main-field zoom and live-hosting lifecycle follow the prompt", async () => {
	const [core, hosting, timeline, scrollView] = await Promise.all([
		readFile(new URL("../js/app-core.js", import.meta.url), "utf8"),
		readFile(new URL("../js/live-hosting.js", import.meta.url), "utf8"),
		readFile(new URL("../js/render/timeline.js", import.meta.url), "utf8"),
		readFile(new URL("../js/render/scroll-view.js", import.meta.url), "utf8"),
	]);
	const wheel = core.slice(core.indexOf('document.addEventListener("wheel"'), core.indexOf('window.addEventListener("beforeunload"'));
	assert.ok(wheel.indexOf("event.ctrlKey && event.shiftKey") < wheel.indexOf("event.target.closest"));
	assert.match(core, /onError: error => this\.toast\?\.error\("toast\.liveHostingFailed"/);
	assert.match(core, /onStop: \(\) => \{ this\.toast\?\.show\("toast\.liveHostingStopped"/);
	assert.match(hosting, /this\.#reportError\(error\)/);
	assert.match(hosting, /this\.onStop\(\)/);
	assert.match(timeline, /fillText\(line\.beat\.toString\(\)/);
	assert.match(scrollView, /text: line\.beat\.toString\(\)/);
});

test("v0.4.2 drops bgNote angle and avoids long-session full snapshots/refreshes", async () => {
	await import("../js/macro-api.js");
	const runtime = globalThis.createSviberMacroApi({
		editor: { currentChannel: 0, currentTime: [0, 0, 1] },
		channels: [{ id: 0, name: "Main", color: "#ffffff", active: true }], events: [], snappees: [], clips: [],
		timing: { offset: 0, initialBpm: 120, bpmChanges: [], barLines: [] },
	});
	const api = runtime.globals;
	const ink = api.bgNote(new api.Location(1, 2), [1, 0, 1], "hello");
	assert.equal(ink.text, "hello");
	assert.throws(() => ink.angle, /angle is only valid for flick/);
	assert.deepEqual(runtime.state.events.at(-1).duration, [1, 0, 1]);
	assert.equal(Object.hasOwn(runtime.state.events.at(-1), "angle"), false);
	const caption = api.bgNote(new api.Location(3, 4), "caption");
	assert.equal(caption.text, "caption");
	assert.deepEqual(runtime.state.events.at(-1).duration, [0, 0, 1]);
	const [core, editing, transform, stage, index, jsApi, rubyApi] = await Promise.all([
		readFile(new URL("../js/app-core.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app-event-editing.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app-free-transform.js", import.meta.url), "utf8"),
		readFile(new URL("../js/render/stage-core.js", import.meta.url), "utf8"),
		readFile(new URL("../js/render/chart-index.js", import.meta.url), "utf8"),
		readFile(new URL("../js/macro-api.js", import.meta.url), "utf8"),
		readFile(new URL("../js/macro-api.rb", import.meta.url), "utf8"),
	]);
	assert.match(transform, /if \(snapshotsEqual\(after, before\)\)/);
	assert.doesNotMatch(core, /JSON\.stringify\(this\.model\.snapshot\(\)\)/);
	assert.match(core, /this\.audio\.addEventListener\("play"[\s\S]*this\.refreshPlaybackFrame\(\)/);
	assert.doesNotMatch(editing, /JSON\.stringify\(this\.model\.snapshot\(\)\)/);
	assert.match(stage, /_canReuseStaticLayer/);
	assert.match(stage, /snappeePaths\?\.get\(snappee\)/);
	assert.match(index, /this\.snappeePaths = new Map\(\)/);
	assert.match(jsApi, /bgNote: \(location, duration = 0, text = ""\)/);
	assert.doesNotMatch(jsApi, /bgNote: \(location, angle,/);
	assert.match(rubyApi, /def bg_note\(location, duration = 0, text = ""\)/);
	assert.doesNotMatch(rubyApi, /def bg_note\(location, angle,/);
});

test("v0.4.3 snaps dragged pen handles and orients snappee previews like the stage", async () => {
	const [interactions, panels, editing, tools, transform, history] = await Promise.all([
		readFile(new URL("../js/render/stage-interactions.js", import.meta.url), "utf8"),
		readFile(new URL("../js/panels.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app-event-editing.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app-chart-tools.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app-free-transform.js", import.meta.url), "utf8"),
		readFile(new URL("../js/core/history.js", import.meta.url), "utf8"),
	]);
	assert.match(interactions, /_snapChartPoint\(chart, project, mapping\)/);
	assert.match(interactions, /drag\.type === "pen-new"[\s\S]*_snapChartPoint\(chart, project, mapping\)/);
	assert.match(interactions, /draft-pen-handle[\s\S]*_snapChartPoint\(chart, project, mapping\)/);
	assert.match(panels, /y: offsetY \+ \(maxY - point\.y\) \* scale/);
	assert.doesNotMatch(panels, /y: offsetY \+ \(point\.y - minY\) \* scale/);
	assert.match(history, /recordView\(view, label/);
	assert.match(transform, /history\.recordView\(captureHistoryView\(this\.model[\s\S]*?selectedEventIds/);
	assert.match(editing, /this\.history\.recordView\(captureHistoryView\(this\.model\)/);
	assert.doesNotMatch(editing, /history\.record\(this\.model\.snapshot\(\), i18n\.t\("history\.selection"\)/);
	assert.match(editing, /viewOnly: true, snappeeOnly: true, rebuildIndex: false, skipInspector: true, scheduleDirty: false/);
	assert.match(tools, /snappeesPanel\?\.syncFlags\?/);
	assert.match(tools, /selectSnappee\(id\) \{[\s\S]*?refreshInteractionPreview\?/);
	assert.doesNotMatch(tools, /selectSnappee\(id\) \{[\s\S]*?this\.refresh\(\);[\s\S]*?toggleSnappee/);
	assert.match(tools, /viewOnly: true, snappeeOnly: true, rebuildIndex: false, skipInspector: true, scheduleDirty: false/);
	assert.match(tools, /moveSnappeeInList[\s\S]*?scheduleDirty: false/);
	assert.match(await readFile(new URL("../js/app-history-commands.js", import.meta.url), "utf8"),
		/moveChannel[\s\S]*?channelOnly: true[\s\S]*?scheduleDirty: false/);
	assert.match(panels, /syncFlags\(model, context = \{\}\)/);
	assert.match(panels, /dataset\.historyId/);
});

test("v0.4.4 clamps free-transform translate/scale and keeps inspector Enter from finishing", async () => {
	const [core, transform, geometry, panels, manual] = await Promise.all([
		readFile(new URL("../js/app-core.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app-free-transform.js", import.meta.url), "utf8"),
		readFile(new URL("../js/core/geometry.js", import.meta.url), "utf8"),
		readFile(new URL("../js/panels.js", import.meta.url), "utf8"),
		readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
	]);
	assert.match(geometry, /export function clampAffineToChartBounds/);
	assert.match(transform, /clampAffineToChartBounds\(this\._freeTransformAnchorPoints\(this\.model\)/);
	assert.match(core, /isEditableTarget\(event\.target\)/);
	assert.match(panels, /onTransformChange\(index, next\)/);
	assert.match(manual, /submits that element/);
	assert.match(manual, /只提交该矩阵元素/);
});

test("v0.4.5 actually hides inapplicable tip-point inspector rows", async () => {
	const [css, panels, regressions, manual] = await Promise.all([
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
		readFile(new URL("../js/panels.js", import.meta.url), "utf8"),
		readFile(new URL("../scripts/verify-browser-regressions.mjs", import.meta.url), "utf8"),
		readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
	]);
	assert.match(css, /\.property-row\[hidden\]\s*\{\s*display:\s*none;/);
	assert.match(panels, /label: String\(item\.name \|\| `Channel \$\{index \+ 1\}`\)/);
	assert.match(regressions, /getComputedStyle\(row\)\.display/);
	assert.match(regressions, /relativeSeconds\["绝对"\]\.display, "none"/);
	assert.match(regressions, /absoluteBeats\["生成距离"\]\.display, "none"/);
	assert.match(regressions, /channelLabels.includes\("Lead"\)/);
	assert.match(regressions, /ordinal-only channel labels/);
	assert.match(manual, /unused fields are hidden/);
	assert.match(manual, /不适用的输入行会隐藏/);
	assert.match(manual, /channel dropdown lists channel names/);
	assert.match(manual, /通道下拉菜单显示通道名称/);
});

test("v0.4.6 keeps main-field pan when pointer capture is cancelled", async () => {
	const [core, interactions] = await Promise.all([
		readFile(new URL("../js/render/stage-core.js", import.meta.url), "utf8"),
		readFile(new URL("../js/render/stage-interactions.js", import.meta.url), "utf8"),
	]);
	assert.match(core, /releasePointerCapture\?\.\(event\.pointerId\)/);
	assert.match(interactions, /setPointerCapture\?\.\(event\.pointerId\)/);
	assert.match(interactions, /event\.type !== "pointercancel"/);
});
