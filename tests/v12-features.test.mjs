import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ChartModel } from "../js/core/chart-model.js";
import { encodeWebSocketFrame, parseAddress, SSCHARTER_VERSION } from "../js/live-hosting.js";
import { ChartRenderIndex } from "../js/render/chart-index.js";
import { TimingMap } from "../js/core/timing.js";
import { Rational } from "../js/core/rational.js";
import { findNearestSnapPoint, isPointWithinChartBounds } from "../js/core/geometry.js";
import { withChartTools } from "../js/app-chart-tools.js";
import { withEventEditing } from "../js/app-event-editing.js";
import { withFileWorkflows } from "../js/app-file-workflows.js";
import { SviberAppCore } from "../js/app-core.js";
import { withHistoryCommands } from "../js/app-history-commands.js";
import { withStageInteractions } from "../js/render/stage-interactions.js";
import { toggledCreationMode } from "../js/app-history-commands.js";
import { eventClickSelectionMode } from "../js/render/selection.js";
import { flickAngleChanges } from "../js/render/flick-angle.js";
import { COMMAND_DEFINITIONS, MENU_DEFINITION } from "../js/commands.js";
import { TIMELINE_EVENT_COLORS } from "../js/render/timeline-helpers.js";
import { drawClipThumbnail } from "../js/panels.js";
import { HelpController } from "../js/help.js";
import { I18n } from "../js/i18n.js";

test("nested groups keep recursive IDs, bounds, clips, and Sunniesnow export flat", () => {
	const model = ChartModel.createDefault({
		channels: [{ id: 0, name: "One" }, { id: 1, name: "Two" }],
		events: [{
		id: 4, type: "group", channel: 0, x: 200, y: 200, color: "#ff9d3d", selected: true,
			events: [{ id: 7, type: "tap", channel: 0, time: [1, 0, 1], x: -20, y: 10 }, {
				id: 8, type: "group", channel: 1, x: 0, y: 0, events: [{ id: 9, type: "flick", channel: 1, time: [2, 0, 1], x: 30, y: -10 }],
			}],
		}],
	});
	const ids = model.allEvents().map(event => event.id);
	assert.equal(new Set(ids).size, ids.length);
	assert.equal(model.groupDescendants(4).length, 3);
	assert.deepEqual(model.groupBounds(4), { minX: -20, maxX: 30, minY: -10, maxY: 10 });
	model.addClip({ events: [{ type: "tap", time: [0, 0, 1], channel: 0 }], channels: [], snappees: [] });
	assert.equal(ChartModel.import(JSON.parse(model.serialize())).clips.length, 1);
	const exported = model.exportSunniesnow({ sscharterVersion: SSCHARTER_VERSION });
	assert.equal(exported.sscharter.version, "0.10.1");
	assert.equal(exported.events.filter(event => event.type === "tap").length, 1);
	assert.equal(exported.events.filter(event => event.type === "flick").length, 1);
});

test("clip thumbnails resolve attached content and use the dedicated five-action layout", async () => {
	const [panels, styles] = await Promise.all([
		readFile(new URL("../js/panels.js", import.meta.url), "utf8"),
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
	]);
	assert.match(panels, /drawClipThumbnail[\s\S]*resolveAttachedPosition\(event, data\?\.snappees/);
	assert.match(panels, /drawTimelineEventIcon\(context, event, 0, 0, TIMELINE_EVENT_COLORS\[event\.type\]/);
	assert.match(styles, /\.snappee-item\.clip-item\s*\{[\s\S]*grid-template-columns:\s*42px minmax\(0, 1fr\) repeat\(5, 25px\)/);
	assert.match(styles, /\.snappee-item\.clip-item \.snappee-name\s*\{[^}]*padding-inline-start:\s*8px/);
});

test("clip thumbnails draw timeline icons and colors for each note type", () => {
	const fills = [];
	const strokes = [];
	const context = {
		fillStyle: "",
		strokeStyle: "",
		save() {},
		restore() {},
		scale() {},
		translate() {},
		fillRect() {},
		beginPath() {},
		arc() {},
		moveTo() {},
		lineTo() {},
		closePath() {},
		fill() { fills.push(this.fillStyle); },
		stroke() { strokes.push(this.strokeStyle); },
		fillText() {},
	};
	const canvas = { style: {}, getContext: () => context };
	drawClipThumbnail(canvas, {
		events: [
			{ type: "tap", x: 0, y: 0 },
			{ type: "hold", x: 20, y: 0 },
			{ type: "drag", x: 40, y: 0 },
			{ type: "flick", x: 0, y: 20 },
		],
	});
	assert.ok(fills.includes(TIMELINE_EVENT_COLORS.tap));
	assert.ok(fills.includes(TIMELINE_EVENT_COLORS.hold));
	assert.ok(fills.includes(TIMELINE_EVENT_COLORS.flick));
	assert.ok(strokes.includes(TIMELINE_EVENT_COLORS.drag));
});

test("live reload uses the sscharter WebSocket handshake contract", async () => {
	assert.deepEqual(parseAddress("127.0.0.1:31108"), { host: "127.0.0.1", port: 31108 });
	const frame = encodeWebSocketFrame("{\"type\":\"update\"}", Buffer);
	assert.equal(frame[0], 0x81);
	assert.equal(frame[1], 17);
	assert.equal(frame.subarray(2).toString(), "{\"type\":\"update\"}");
	const source = await readFile(new URL("../js/live-hosting.js", import.meta.url), "utf8");
	assert.match(source, /Sec-WebSocket-Accept/);
	assert.match(source, /eventInfoTip/);
});

test("nested group selection enters one level at a time", () => {
	const model = ChartModel.createDefault({ events: [{ id: 10, type: "group", channel: 0, x: 0, y: 0, events: [{
		id: 11, type: "group", channel: 0, x: 0, y: 0, events: [{ id: 12, type: "tap", channel: 0, time: [0, 0, 1], x: 1, y: 2 }],
	}] }] });
	const leaf = model.findEvent(12);
	assert.equal(new ChartRenderIndex(model, new TimingMap(), {}).selectionTarget(leaf).id, 11);
	assert.equal(new ChartRenderIndex(model, new TimingMap(), { selectionScope: 10 }).selectionTarget(leaf).id, 11);
	assert.equal(new ChartRenderIndex(model, new TimingMap(), { selectionScope: 11 }).selectionTarget(leaf).id, 12);
	model.findEvent(10).selected = true;
	model.findEvent(11).selected = true;
	model.ungroupSelected();
	assert.equal(model.findEvent(10), null);
	assert.equal(model.findEvent(11), null);
	assert.equal(model.findEvent(12).type, "tap");
});

test("removing a channel prunes empty nested groups", () => {
	const model = ChartModel.createDefault({ channels: [{ id: 0 }, { id: 1 }], events: [{
		id: 4, type: "group", channel: 0, x: 0, y: 0, events: [{ id: 5, type: "tap", channel: 1, time: [0, 0, 1], x: 0, y: 0 }],
	}] });
	model.removeChannel(1);
	assert.equal(model.findEvent(4), null);
});

test("timeline channel offset round-trips and clamps to visible channels", () => {
	const model = ChartModel.createDefault({
		channels: Array.from({ length: 8 }, (_, id) => ({ id, name: `Channel ${id + 1}` })),
		editor: { timelineChannelOffset: 5 },
	});
	assert.equal(model.editor.timelineChannelOffset, 5);
	const reopened = ChartModel.import(model.toJSON());
	assert.equal(reopened.editor.timelineChannelOffset, 5);
	const clamped = ChartModel.createDefault({
		channels: [{ id: 0 }, { id: 1 }], editor: { timelineChannelOffset: 5 },
	});
	assert.equal(clamped.editor.timelineChannelOffset, 0);
});

function scrollbarApp(editor) {
	const App = withEventEditing(class {});
	const app = new App();
	app.model = ChartModel.createDefault({
		timing: { offset: 0, initialBpm: 120, bpmChanges: [], barLines: [] },
		editor: { timeSnapped: true, subdivision: 4, ...editor },
	});
	app.timing = () => new TimingMap(app.model.timing);
	app.timeBounds = () => [0, 60];
	app.audio = { playing: false, seek() {} };
	app.timeline = { requestRender() {} };
	app.stage = { requestRender() {} };
	app.scrollView = { requestRender() {} };
	app.refreshInteractionPreview = () => {};
	return app;
}

test("timeline scrollbar track jump seeks current time and moves the visible range", () => {
	const app = scrollbarApp({ currentTime: [4, 0, 1], visibleRangeBeginning: 1, visibleRangeEnd: 3 });
	app.currentSeconds = () => 2;
	app.seekScrollbar(10);
	assert.equal(app.model.editor.visibleRangeBeginning, 9);
	assert.equal(app.model.editor.visibleRangeEnd, 11);
	assert.deepEqual(app.model.editor.currentTime, [20, 0, 1]);
});

test("timeline scrollbar track jump moves only the visible range when current time is outside it", () => {
	const app = scrollbarApp({ currentTime: [4, 0, 1], visibleRangeBeginning: 10, visibleRangeEnd: 12 });
	app.currentSeconds = () => 2;
	app.seekScrollbar(20);
	assert.equal(app.model.editor.visibleRangeBeginning, 19);
	assert.equal(app.model.editor.visibleRangeEnd, 21);
	assert.deepEqual(app.model.editor.currentTime, [4, 0, 1]);
});

test("timeline zoom is centered on current time after zooming to the full range", () => {
	const App = withEventEditing(class {});
	const app = new App();
	app.model = ChartModel.createDefault({
		editor: { currentTime: [40, 0, 1], timeSnapped: true, subdivision: 4, visibleRangeBeginning: 0, visibleRangeEnd: 100 },
	});
	app.currentSeconds = () => 20;
	app.timeBounds = () => [0, 100];
	app.timeline = { requestRender() {} };
	app.stage = { requestRender() {} };
	app.scrollView = { requestRender() {} };
	app.requestStatusUpdate = () => {};
	app.navigateWheel(-1, true, true);
	assert.equal(app.model.editor.visibleRangeBeginning, 0);
	assert.ok(Math.abs(app.model.editor.visibleRangeEnd - 82) < 1e-9);
	app.model.editor.visibleRangeBeginning = 0;
	app.model.editor.visibleRangeEnd = 40;
	app.currentSeconds = () => 20;
	app.navigateWheel(-1, true, true);
	assert.ok(Math.abs((app.model.editor.visibleRangeBeginning + app.model.editor.visibleRangeEnd) / 2 - 20) < 1e-9);
	assert.ok(Math.abs(app.model.editor.visibleRangeEnd - app.model.editor.visibleRangeBeginning - 32.8) < 1e-9);
});

test("timeline scrollbar track click jumps instead of paging", async () => {
	const source = await readFile(new URL("../js/render/timeline.js", import.meta.url), "utf8");
	assert.match(source, /#scrollSeek\(point\.x, hit, true\)/);
	assert.match(source, /onScrollbarJump\?\.\(seconds\)/);
	assert.doesNotMatch(source, /onPageVisibleRange\?\.\(direction\)/);
});

test("switching clean difficulties does not create a dirty project", () => {
	const app = Object.create(SviberAppCore.prototype);
	const first = ChartModel.createDefault({ metadata: { title: "Project", artist: "Artist", difficultyName: "Easy" } });
	const second = ChartModel.createDefault({ metadata: { title: "Project", artist: "Artist", difficultyName: "Hard" } });
	app.installProject([
		{ id: "difficulty-1", file: "easy.json", model: first },
		{ id: "difficulty-2", file: "hard.json", model: second },
	], { activeChart: "difficulty-1", name: "Project", title: "Project", artist: "Artist", saved: true });
	assert.equal(app.dirty, false);
	app.activeDifficultyId = "difficulty-2";
	app.model = app.difficulties[1].model;
	app.history = app.difficulties[1].history;
	app.savedSignature = app.difficulties[1].savedSignature;
	app.updateDirty();
	assert.equal(app.dirty, false);
});

test("opening a chart from the project folder adds it without dropping other difficulties", async () => {
	const WorkflowApp = withFileWorkflows(class {});
	const app = new WorkflowApp();
	const master = ChartModel.createDefault({ metadata: { title: "Project", difficultyName: "Master" } });
	const special = ChartModel.createDefault({ metadata: { title: "Project", difficultyName: "Special" } });
	app.files = { projectPath: "C:/project", projectChartFilename: () => "Special.json" };
	app.difficulties = [{ id: "difficulty-0", file: "Master.json", model: master, history: {}, savedSignature: null }];
	app.activeDifficultyId = "difficulty-0"; app.model = master; app.projectTitle = "Project"; app.projectArtist = "";
	app.projectMusic = ""; app.projectImage = ""; app.nextDifficultyId = 1; app.projectDirty = false;
	app.modelSignature = SviberAppCore.prototype.modelSignature.bind(app);
	app.syncProjectSharedFields = SviberAppCore.prototype.syncProjectSharedFields.bind(app);
	app.updateDirty = () => {}; app.refresh = () => {}; app.rememberLastOpen = () => {};
	app.syncMediaFromModel = async () => {};
	app.confirmUnsaved = async () => true; app.requestImportOptions = async () => ({});
	app.toast = { show() {} }; app.files.parseFile = async () => ({ document: JSON.parse(special.serialize()), chartPath: "C:/project/Special.json" });
	await app.openFile({ name: "Special.json" }, { silent: true });
	assert.deepEqual(app.difficulties.map(entry => entry.file), ["Master.json", "Special.json"]);
	assert.equal(app.model.metadata.difficultyName, "Special");
});

test("v0.3.2 selection clicks toggle without changing modifier semantics", () => {
	assert.equal(eventClickSelectionMode({ selected: false }), "replace");
	assert.equal(eventClickSelectionMode({ selected: true }), "remove");
	assert.equal(eventClickSelectionMode({ selected: false, ctrlKey: true }), "add");
	assert.equal(eventClickSelectionMode({ selected: true, ctrlKey: true }), "add");
	assert.equal(eventClickSelectionMode({ selected: false, altKey: true }), "remove");
	assert.equal(eventClickSelectionMode({ selected: true, altKey: true }), "remove");
});

test("selected Flick handles preserve angle differences during multi-selection rotation", () => {
	const flicks = [{ id: 1, angle: 0.1 }, { id: 2, angle: 1.2 }, { id: 3, angle: -2.4 }];
	const changes = flickAngleChanges(flicks, 1, 0.1 + Math.PI / 2);
	assert.equal(changes.size, flicks.length);
	assert.ok(Math.abs(changes.get(1) - (0.1 + Math.PI / 2)) < 1e-12);
	assert.ok(Math.abs((changes.get(2) - changes.get(1)) - (flicks[1].angle - flicks[0].angle)) < 1e-12);
	assert.ok(Math.abs((changes.get(3) - changes.get(1)) - (flicks[2].angle - flicks[0].angle)) < 1e-12);
	const single = flickAngleChanges([{ id: 4, angle: 0.2 }], 4, 0.3);
	assert.equal(single.get(4), 0);
});

test("v0.3.2 event tools toggle the active creation mode and groups keep shortcuts", async () => {
	assert.equal(toggledCreationMode("tap", "tap"), null);
	assert.equal(toggledCreationMode(null, "tap"), "tap");
	assert.equal(toggledCreationMode("tap", "hold"), "hold");
	assert.equal(COMMAND_DEFINITIONS["events.group"].shortcut, "Ctrl+G");
	assert.equal(COMMAND_DEFINITIONS["events.ungroup"].shortcut, "Ctrl+Shift+G");
	const [english, chinese, css, overlays] = await Promise.all([
		readFile(new URL("../json/i18n.en-US.json", import.meta.url), "utf8"),
		readFile(new URL("../json/i18n.zh-CN.json", import.meta.url), "utf8"),
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
		readFile(new URL("../css/overlays.css", import.meta.url), "utf8"),
	]);
	const shortcutStyles = `${css}\n${overlays}`;
	assert.equal(JSON.parse(english)["event.group"], "Group");
	assert.equal(JSON.parse(chinese)["event.group"], "分组");
	assert.match(shortcutStyles, /\.dialog\.keyboard-shortcuts-dialog\s*\{[^}]*width:\s*min\(980px/);
	assert.match(shortcutStyles, /\.shortcut-columns\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
	assert.match(shortcutStyles, /@media\s*\(max-width:\s*760px\)[\s\S]*\.shortcut-columns\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
	assert.match(shortcutStyles, /\.shortcut-item\s*\{/);
	assert.match(shortcutStyles, /\.shortcut-group-list\s*\{[^}]*grid-template-columns:\s*max-content\s+minmax\(0,\s*1fr\)/);
	assert.match(shortcutStyles, /\.shortcut-item\s*\{[^}]*grid-template-columns:\s*subgrid/);
	assert.match(shortcutStyles, /\.shortcut-columns kbd\s*\{[^}]*border:\s*1px solid/);
	assert.equal(JSON.parse(english)["command.snappee.bezierCurve"], "Bézier curve");
	assert.equal(JSON.parse(chinese)["command.snappee.bezierCurve"], "Bézier 曲线");
	assert.equal(MENU_DEFINITION.find(menu => menu.id === "timing").mnemonic, "t");
	assert.equal(MENU_DEFINITION.find(menu => menu.id === "transform").mnemonic, "r");
});

test("v0.3.2 keyboard shortcut dialog lists group and ungroup", async () => {
	const previousDocument = globalThis.document;
	const hadDocument = Object.hasOwn(globalThis, "document");
	const makeNode = tag => ({
		tag,
		children: [],
		dataset: {},
		className: "",
		textContent: "",
		append(...children) { this.children.push(...children); },
	});
	globalThis.document = { createElement: tag => makeNode(tag) };
	let dialog;
	const tooltipKeys = [];
	try {
		const help = new HelpController({
			i18n: { t: key => key, shortcut: shortcut => shortcut },
			dialogs: { open: async options => { dialog = options; } },
			tooltip: { register: (_element, key) => { tooltipKeys.push(key); return () => {}; } },
		});
		await help.showKeyboardShortcuts(COMMAND_DEFINITIONS);
		const groups = dialog.content.children.flatMap(column => column.children);
		const rows = groups.flatMap(group => group.children[1].children.flatMap(row => row.children.map(child => child.textContent)));
		assert.ok(rows.includes("command.events.group"));
		assert.ok(rows.includes("command.events.ungroup"));
		assert.ok(rows.includes("Ctrl+G"));
		assert.ok(rows.includes("Ctrl+Shift+G"));
		assert.ok(tooltipKeys.includes("command.events.group.hint"));
		assert.equal(dialog.dialogClass, "keyboard-shortcuts-dialog");
		assert.ok(groups.some(group => group.children[0].textContent === "menu.events"));
	} finally {
		if (hadDocument) globalThis.document = previousDocument;
		else delete globalThis.document;
	}
});

test("group anchors stay in the main-field index and out of timeline and scroll indexes", () => {
	const model = ChartModel.createDefault({ events: [{
		id: 10, type: "group", channel: 0, time: [2, 0, 1], x: 0, y: 0, color: "#123456",
		events: [{ id: 11, type: "tap", channel: 0, time: [2, 0, 1], x: 10, y: 5 }],
	}] });
	const index = new ChartRenderIndex(model, new TimingMap({ initialBpm: 60 }));
	assert.deepEqual(index.scrollEventRecords(1, 3).map(record => record.event.id), [11]);
	assert.deepEqual(index.timelineRecords(1, 3).map(record => record.event.id), [11]);
	assert.equal(index.groupRecords[0].event.color, "#123456");
	assert.equal(index.groupRecords[0].start, 2);
	assert.equal("time" in index.groupRecords[0].event, false);
	assert.equal("channel" in index.groupRecords[0].event, false);
});

test("only top-level selected groups draw their own bounds", () => {
	const model = ChartModel.createDefault({ events: [{
		id: 10, type: "group", selected: true, x: 0, y: 0, events: [{
			id: 11, type: "group", selected: true, x: 0, y: 0,
			events: [{ id: 12, type: "tap", channel: 0, time: [1, 0, 1], x: 5, y: 5 }],
		}],
	}] });
	const index = new ChartRenderIndex(model, new TimingMap({ initialBpm: 60 }));
	assert.equal(index.isRootSelectedGroup(model.findEvent(10)), true);
	assert.equal(index.isRootSelectedGroup(model.findEvent(11)), false);
});

test("Scroll view places current time exactly one quarter of its height from the bottom", async () => {
	const scrollSource = await readFile(new URL("../js/render/scroll-view.js", import.meta.url), "utf8");
	assert.match(scrollSource, /const baseline = height \* 0\.75/);
});

test("an attached selected group moves together with all descendants", () => {
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	app.model = ChartModel.createDefault({ events: [{
		id: 10, type: "group", selected: true, attached: true, snappee: 0, snapPoint: [8, 4],
		events: [{ id: 11, type: "tap", channel: 0, time: [3, 0, 1], x: 10, y: 0 }],
	}] });
	app._applyPositionMove(app.model, 10, { x: 5, y: 7 });
	assert.deepEqual({ x: app.model.findEvent(10).x, y: app.model.findEvent(10).y }, { x: 5, y: 7 });
	assert.deepEqual({ x: app.model.findEvent(11).x, y: app.model.findEvent(11).y }, { x: 15, y: 7 });
	assert.deepEqual(app.model.findEvent(10).time, undefined);
	assert.deepEqual(app.model.findEvent(10).channel, undefined);
});

test("history labels are translated again after the interface language changes", () => {
	const translations = new I18n("en-US");
	const english = translations.t("history.createEvent", { type: translations.t("event.tap") });
	translations.setLanguage("zh-CN", null);
	assert.equal(translations.localize(english), "创建 Tap");
	assert.equal(translations.localize("Ungroup events"), "解组事件");
});

test("v12 editor fields use the file-format spelling", () => {
	const model = ChartModel.createDefault({
		editor: {
			allowOutOfBound: true,
			showGroupingInTimeline: false,
			showGroupingInMainField: false,
			showTipPoints: false,
		},
	});
	assert.equal(model.editor.allowOutOfBound, true);
	assert.equal(ChartModel.import(model.toJSON()).editor.allowOutOfBound, true);
	assert.equal(ChartModel.createDefault({ editor: { allowOutOfBounds: true } }).editor.allowOutOfBound, false);
});

test("snap-to-point uses the v12 6.25 boundary exactly", async () => {
	const snappee = {
		id: 1, type: "rectangularMesh", active: true, transformation: [1, 0, 0, 1, 0, 0],
		topLeftX: -10, topLeftY: 10, bottomRightX: 10, bottomRightY: -10,
		horizontalTiles: 1, verticalTiles: 1,
	};
	assert.equal(findNearestSnapPoint({ x: -3.75, y: 10 }, [snappee], { maxDistance: 6.25 })?.snappeeId, 1);
	assert.equal(findNearestSnapPoint({ x: -3.749999, y: 10 }, [snappee], { maxDistance: 6.25 }), null);
	const source = await readFile(new URL("../js/render/stage-interactions.js", import.meta.url), "utf8");
	assert.match(source, /maxDistance: 6\.25/);
});

test("Sunniesnow export orders active events by channel, time, and timeline stacking", () => {
	const model = ChartModel.createDefault({
		channels: [{ id: 10, name: "Top" }, { id: 20, name: "Bottom" }, { id: 30, active: false }],
		events: [
			{ id: 1, type: "tap", channel: 20, time: [0, 0, 1], x: 1, y: 0 },
			{ id: 2, type: "tap", channel: 10, time: [2, 0, 1], x: 2, y: 0 },
			{ id: 3, type: "tap", channel: 10, time: [1, 0, 1], x: 3, y: 0 },
			{ id: 4, type: "tap", channel: 30, time: [0, 0, 1], x: 4, y: 0 },
			{ id: 5, type: "tap", channel: 10, time: [1, 0, 1], x: 5, y: 0 },
		],
	});
	const taps = model.generateSunniesnowEvents().filter(event => event.type === "tap");
	assert.deepEqual(taps.map(event => event.properties.x), [3, 5, 2, 1]);
	assert.equal(taps.some(event => event.properties.x === 4), false);
});

test("system event clipboard preserves nested channel and snappee references", async () => {
	const clipboard = { value: "" };
	const previousNavigator = globalThis.navigator;
	Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
		clipboard: {
			async writeText(value) { clipboard.value = value; },
			async readText() { return clipboard.value; },
		},
	} });
	try {
		const model = ChartModel.createDefault({ events: [{
			id: 10, type: "group", channel: 0, x: 0, y: 0, selected: true,
			events: [{ id: 11, type: "tap", channel: 0, time: [1, 0, 1], attached: true,
				snappee: 0, snapPoint: [0, 0] }],
		}] });
		const WorkflowApp = withFileWorkflows(class {});
		const app = new WorkflowApp();
		app.model = model;
		app.currentBeat = () => Rational.from(4);
		app.uniqueChannelName = name => `${name} copy`;
		app.commit = (_label, mutation) => mutation(model);
		await app.copyEvents();
		const data = JSON.parse(clipboard.value);
		assert.equal(data.version, 1);
		assert.equal(data.channels.length, 1);
		assert.equal(data.snappees.length, 1);
		assert.equal(data.events[0].events[0].snappee, data.snappees[0].id);
		await app.pasteEvents(false, { duplicateChannels: true, duplicateSnappees: true });
		const pasted = model.events.at(-1);
		assert.notEqual(pasted.channel, 0);
		assert.notEqual(pasted.events[0].snappee, 0);
		assert.equal(model.snappees.length, 2);
	} finally {
		if (previousNavigator === undefined) delete globalThis.navigator;
		else Object.defineProperty(globalThis, "navigator", { configurable: true, value: previousNavigator });
	}
});

test("read-only mode keeps channel and snappee activation available but blocks edits", () => {
	const model = ChartModel.createDefault({
		channels: [{ id: 0 }, { id: 1 }],
		editor: { readOnly: true },
	});
	const HistoryApp = withHistoryCommands(class {});
	const historyApp = new HistoryApp();
	historyApp.model = model;
	historyApp.commit = (_label, mutation, options = {}) => {
		if (model.editor.readOnly && !options.allowReadOnly) return null;
		return mutation(model);
	};
	historyApp.toggleChannel(0);
	assert.equal(model.channels[0].active, false);
	const ToolApp = withChartTools(class {});
	const toolApp = new ToolApp();
	toolApp.model = model;
	toolApp.commit = historyApp.commit;
	toolApp.toggleSnappee(0);
	assert.equal(model.snappees[0].active, false);
	assert.equal(historyApp.commit("blocked", target => { target.channels[1].name = "blocked"; }), null);
});

test("free transform follows v12 degenerate-box and modifier rules", () => {
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	app.exitModes = () => {};
	app.refresh = () => {};
	app.model = ChartModel.createDefault({ events: [
		{ id: 1, type: "tap", selected: true, x: 0, y: 0 },
	] });
	assert.equal(app.startFreeTransform(), false);
	app.model = ChartModel.createDefault({ events: [
		{ id: 1, type: "tap", selected: true, x: 0, y: -10 },
		{ id: 2, type: "tap", selected: true, x: 0, y: 10 },
	] });
	assert.equal(app.startFreeTransform(), true);
	assert.deepEqual(app.freeTransform.bounds, { minX: -0.5, maxX: 0.5, minY: -10, maxY: 10 });
	app.cancelFreeTransform();
	app.model = ChartModel.createDefault({ events: [
		{ id: 1, type: "tap", selected: true, x: -10, y: -10 },
		{ id: 2, type: "tap", selected: true, x: 10, y: 10 },
	] });
	assert.equal(app.startFreeTransform(), true);
	assert.deepEqual(app.freeTransform.anchor, { x: 0, y: 0 });
	const InteractionApp = withStageInteractions(class {});
	const interactions = new InteractionApp();
	interactions.callbacks = { getFreeTransform: () => ({
		bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 }, matrix: [1, 0, 0, 1, 0, 0],
		anchor: { x: 0, y: 0 }, anchorLocal: { x: 0, y: 0 }, anchorFollows: true,
	}) };
	const rotate = interactions._freeTransformMatrix({ type: "free-rotate", startChart: { x: 10, y: 0 },
		bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 }, matrix: [1, 0, 0, 1, 0, 0] }, { x: 0, y: 10 }, { ctrlKey: true });
	assert.ok(Math.abs(rotate[0]) < 1e-10 && Math.abs(rotate[1] - 1) < 1e-10);
	const scale = interactions._freeTransformMatrix({ type: "free-scale", hit: { index: 0 }, startLocal: { x: -10, y: 10 },
		bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 }, matrix: [1, 0, 0, 1, 0, 0] }, { x: -20, y: 20 }, { ctrlKey: true });
	assert.equal(scale[0], 1.5);
	assert.equal(scale[3], 1.5);
});

test("free transform recursively includes attached descendants of a selected group", () => {
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	app.refresh = () => {};
	app.exitModes = () => {};
	app.model = ChartModel.createDefault({
		snappees: [{
			id: 0, type: "rectangularMesh", name: "Attached group mesh", color: "#00e0ad",
			transformation: [1, 0, 0, 1, 0, 0], active: true,
			topLeftX: -20, topLeftY: 20, bottomRightX: 20, bottomRightY: -20,
			horizontalTiles: 2, verticalTiles: 2,
		}],
		events: [{
			id: 10, type: "group", channel: 0, time: [0, 0, 1], x: 0, y: 0, selected: true,
			events: [
				{ id: 11, type: "tap", channel: 0, time: [0, 0, 1], attached: true, snappee: 0, snapPoint: [0, 0] },
				{ id: 12, type: "tap", channel: 0, time: [1, 0, 1], x: 10, y: -10 },
			],
		}],
	});
	assert.deepEqual([...app.attachedSnappeeIds()], [0]);
	assert.equal(app.transformationAvailable(), true);
	assert.equal(app.startFreeTransform(), true);
	const before = app.model.snappees[0].transformation;
	assert.equal(app._applyTransformMutation(app.model, [1, 0, 0, 1, 5, 7]), true);
	assert.deepEqual(app.model.snappees[0].transformation, [1, 0, 0, 1, 5, 7]);
	assert.equal(app.model.findEvent(10).x, 5);
	assert.equal(app.model.findEvent(10).y, 7);
	assert.deepEqual(app.model.findEvent(11).snapPoint, [0, 0]);
	assert.equal(app.model.findEvent(12).x, 15);
	assert.equal(app.model.findEvent(12).y, -3);
	assert.notDeepEqual(app.model.snappees[0].transformation, before);
});

test("line-shaped note selections and groups can free-transform while a single note stays blocked", () => {
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	app.refresh = () => {};
	app.exitModes = () => {};
	app.commit = (_label, mutation) => mutation(app.model);
	app.model = ChartModel.createDefault({ events: [{
		id: 10, type: "group", channel: 0, time: [0, 0, 1], x: 0, y: 0, selected: true,
		events: [
			{ id: 11, type: "tap", channel: 0, time: [0, 0, 1], x: 0, y: -20 },
			{ id: 12, type: "tap", channel: 0, time: [1, 0, 1], x: 0, y: 20 },
		],
	}] });
	assert.equal(app.startFreeTransform(), true);
	assert.deepEqual(app.freeTransform.bounds, { minX: -0.5, maxX: 0.5, minY: -20, maxY: 20 });
	app.cancelFreeTransform();
	app.model = ChartModel.createDefault({ events: [
		{ id: 20, type: "tap", channel: 0, time: [0, 0, 1], x: 0, y: -20, selected: true },
		{ id: 21, type: "tap", channel: 0, time: [1, 0, 1], x: 0, y: 20, selected: true },
	] });
	assert.equal(app.startFreeTransform(), true);
	assert.deepEqual(app.freeTransform.bounds, { minX: -0.5, maxX: 0.5, minY: -20, maxY: 20 });
	app.cancelFreeTransform();
	app.model = ChartModel.createDefault({ events: [
		{ id: 30, type: "tap", channel: 0, time: [0, 0, 1], x: 0, y: 0, selected: true },
	] });
	assert.equal(app.startFreeTransform(), false);
});

test("detached collinear notes can still free-transform", () => {
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	app.refresh = () => {};
	app.exitModes = () => {};
	app.commit = (_label, mutation) => mutation(app.model);
	app.model = ChartModel.createDefault({
		snappees: [{
			id: 0, type: "rectangularMesh", name: "Playfield", color: "#00e0ad",
			transformation: [1, 0, 0, 1, 0, 0], active: true,
			topLeftX: -20, topLeftY: 20, bottomRightX: 20, bottomRightY: -20,
			horizontalTiles: 4, verticalTiles: 2,
		}],
		events: [
			{ id: 1, type: "tap", selected: true, attached: true, snappee: 0, snapPoint: [0, 0],
				channel: 0, time: [0, 0, 1] },
			{ id: 2, type: "tap", selected: true, attached: true, snappee: 0, snapPoint: [1, 0],
				channel: 0, time: [1, 0, 1] },
			{ id: 3, type: "tap", selected: true, attached: true, snappee: 0, snapPoint: [2, 0],
				channel: 0, time: [2, 0, 1] },
			{ id: 4, type: "tap", selected: true, attached: true, snappee: 0, snapPoint: [3, 0],
				channel: 0, time: [3, 0, 1] },
		],
	});
	assert.equal(app.startFreeTransform(), true);
	app.cancelFreeTransform();
	app.detachSelected();
	for (const event of app.model.allEvents()) {
		assert.equal(event.attached, false);
		assert.equal(event.y, 20);
	}
	assert.equal(new Set(app.model.allEvents().map(event => event.x)).size, 4);
	assert.equal(app.startFreeTransform(), true);
	assert.equal(app.freeTransform.bounds.minY, 19.5);
	assert.equal(app.freeTransform.bounds.maxY, 20.5);
});

test("free transform translate and scale clamp to the chart boundary", () => {
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	app.exitModes = () => {};
	app.refresh = () => {};
	app.refreshInteractionPreview = () => {};
	app.model = ChartModel.createDefault({ events: [
		{ id: 1, type: "tap", selected: true, channel: 0, time: [0, 0, 1], x: 90, y: 0 },
		{ id: 2, type: "tap", selected: true, channel: 0, time: [0, 0, 1], x: 80, y: 10 },
	] });
	assert.equal(app.startFreeTransform(), true);
	assert.equal(app.previewFreeTransform([1, 0, 0, 1, 50, 0]), true);
	assert.equal(app.model.findEvent(1).x, 100);
	assert.equal(app.model.findEvent(2).x, 90);
	assert.deepEqual(app.freeTransform.matrix, [1, 0, 0, 1, 10, 0]);
	app.cancelFreeTransform();
	app.model = ChartModel.createDefault({ events: [
		{ id: 1, type: "tap", selected: true, channel: 0, time: [0, 0, 1], x: -10, y: -10 },
		{ id: 2, type: "tap", selected: true, channel: 0, time: [0, 0, 1], x: 10, y: 10 },
	] });
	assert.equal(app.startFreeTransform(), true);
	assert.equal(app.previewFreeTransform([20, 0, 0, 20, 0, 0]), true);
	assert.ok(Math.abs(app.model.findEvent(2).y - 50) < 1e-9);
	assert.ok(Math.abs(app.model.findEvent(2).x - 50) < 1e-9);
	assert.ok(Math.abs(app.freeTransform.matrix[0] - 5) < 1e-9);
	assert.ok(Math.abs(app.freeTransform.matrix[3] - 5) < 1e-9);
	app.cancelFreeTransform();
	app.model = ChartModel.createDefault({ events: [
		{ id: 1, type: "tap", selected: true, channel: 0, time: [0, 0, 1], x: 90, y: 10 },
		{ id: 2, type: "tap", selected: true, channel: 0, time: [0, 0, 1], x: 70, y: -10 },
	] });
	assert.equal(app.startFreeTransform(), true);
	assert.equal(app.previewFreeTransform([0, 1, -1, 0, 0, 0]), true);
	assert.equal(isPointWithinChartBounds(app.model.findEvent(1)), true);
	assert.equal(isPointWithinChartBounds(app.model.findEvent(2)), true);
});
