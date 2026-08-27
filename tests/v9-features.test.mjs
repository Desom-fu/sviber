import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { COMMAND_DEFINITIONS, CommandRegistry, parseShortcut } from "../js/commands.js";
import { withChartTools } from "../js/app-chart-tools.js";
import { withEventEditing } from "../js/app-event-editing.js";
import { withFreeTransform } from "../js/app-free-transform.js";
import { CHART_BOUNDS, sampleSnappee } from "../js/core/geometry.js";
import { withHistoryCommands } from "../js/app-history-commands.js";
import { ChartModel } from "../js/core/chart-model.js";
import { collectHitSchedule, collectMetronomeSchedule, collectReverseHitSchedule } from "../js/audio/scheduler.js";
import { validateField } from "../js/ui-fields.js";
import { MESSAGES } from "../js/i18n.js";
import { STAGE_INTERACTION_MODULES, readSources } from "./module-source.mjs";

const timing = {
	beatToSeconds(value) {
		if (Array.isArray(value)) {
			return Number(value[0]) + Number(value[1]) / Number(value[2]);
		}
		return Number(value);
	},
	secondsToBeat(value) {
		return { toNumber: () => Number(value) };
	},
};

test("v9 editor playback settings and A-B marks round-trip canonically", () => {
	const model = ChartModel.createDefault({
		editor: {
			lockVisibleRange: true,
			playSe: false,
			seekBackAfterPlaying: true,
			metronome: true,
			abLoopMarks: [
				[4, 0, 1],
				[1, 1, 2],
				[4, 0, 1],
			],
		},
	});
	assert.equal(model.editor.lockVisibleRange, true);
	assert.equal(model.editor.playSe, false);
	assert.equal(model.editor.seekBackAfterPlaying, true);
	assert.equal(model.editor.metronome, true);
	assert.deepEqual(model.editor.abLoopMarks, [
		[1, 1, 2],
		[4, 0, 1],
	]);
	const reopened = ChartModel.import(JSON.parse(model.serialize()));
	assert.deepEqual(reopened.editor, model.editor);
});

test("language options are localized in each interface", () => {
	assert.equal(MESSAGES["en-US"]["option.language.chinese"], "Simplified Chinese");
	assert.equal(MESSAGES["zh-CN"]["option.language.chinese"], "简体中文");
	assert.equal(MESSAGES["zh-CN"]["option.language.english"], "英文");
});

test("v9 Sunniesnow import filters incompatible chain members and allocates a free channel", () => {
	const model = ChartModel.import(
		{
			events: [
				{ type: "tap", time: 0, properties: { x: 0, y: 0 } },
				{ type: "placeholder", time: 1, properties: { x: -40, y: 20, tipPoint: "guide" } },
				{ type: "tap", time: 2, properties: { x: 0, y: 0, tipPoint: "guide" } },
				{ type: "bgNote", time: 3, properties: { x: 1, y: 1, tipPoint: "guide" } },
				{ type: "hold", time: 4, properties: { x: 20, y: 10, duration: 1, tipPoint: "guide" } },
				{ type: "image", time: 5, properties: { filename: "visual.png", tipPoint: "guide" } },
			],
		},
		{ offset: 0, initialBpm: 60 },
	);
	const notes = model.events.filter(
		event => ["tap", "hold"].includes(event.type) && event.channel !== model.channels[0].id,
	);
	assert.equal(notes.length, 2);
	assert.equal(notes[0].tipPointSpawnType, "chain");
	assert.equal(notes[1].tipPointSpawnType, "inherit");
	assert.equal(notes[0].channel, notes[1].channel);
	assert.notEqual(notes[0].channel, model.channels[0].id);
	assert.equal(notes[0].tipPointSpawnAbsolutePosition, false);
	assert.equal(notes[0].tipPointSpawnDistance, Math.hypot(-40, 20));
	assert.equal(notes[0].tipPointSpawnTime, 1);
	assert.ok(model.importWarnings.some(warning => warning.includes("unsupported event type image")));
	assert.equal(
		model.events.find(event => event.type === "tap" && event.channel === model.channels[0].id).tipPointSpawnType,
		"none",
	);
});

test("v9 Sunniesnow import keeps overlapping tip-point chains on separate channels", () => {
	const model = ChartModel.import(
		{
			events: [
				{ type: "placeholder", time: 0, properties: { x: -20, y: 0, tipPoint: "first" } },
				{ type: "tap", time: 1, properties: { x: 0, y: 0, tipPoint: "first" } },
				{ type: "tap", time: 4, properties: { x: 20, y: 0, tipPoint: "first" } },
				{ type: "placeholder", time: 0.5, properties: { x: -20, y: 10, tipPoint: "second" } },
				{ type: "tap", time: 2, properties: { x: 0, y: 10, tipPoint: "second" } },
				{ type: "tap", time: 3, properties: { x: 20, y: 10, tipPoint: "second" } },
			],
		},
		{ offset: 0, initialBpm: 60 },
	);
	const chains = [0, 10].map(y =>
		model.events
			.filter(event => event.tipPointSpawnType === "chain" || event.tipPointSpawnType === "inherit")
			.filter(event => event.channel != null)
			.filter(event => event.y === y),
	);
	assert.equal(chains[0].length, 2);
	assert.equal(chains[1].length, 2);
	assert.notEqual(chains[0][0].channel, chains[1][0].channel);
});

test("a single attached event can be dragged freely in v9", () => {
	const model = new ChartModel({
		channels: [{ id: 0, name: "Main", active: true }],
		snappees: [
			{
				id: 4,
				type: "rectangularMesh",
				name: "Mesh",
				active: true,
				transformation: [1, 0, 0, 1, 0, 0],
				topLeftX: -50,
				topLeftY: 25,
				bottomRightX: 50,
				bottomRightY: -25,
				horizontalTiles: 2,
				verticalTiles: 2,
			},
		],
		events: [
			{
				id: 8,
				type: "tap",
				channel: 0,
				time: [0, 0, 1],
				selected: true,
				attached: true,
				snappee: 4,
				snapPoint: [0, 0],
			},
		],
	});
	const EditingApp = withEventEditing(class {});
	new EditingApp()._applyPositionMove(model, 8, { x: 25, y: 10 });
	assert.equal(model.events[0].attached, false);
	assert.deepEqual([model.events[0].x, model.events[0].y], [25, 10]);
});

test("a duplicated circular arc remains movable and serializable in the composed app", () => {
	const model = ChartModel.createDefault();
	const source = model.addSnappee("circularArcCurve", {
		name: "Arc",
		centerX: -20,
		centerY: 0,
		radius: 20,
		beginningAngle: 0,
		endAngle: 0,
		closed: true,
		segments: 24,
	});
	const TestApp = withChartTools(
		withEventEditing(
			class {
				constructor() {
					this.model = model;
				}

				commit(_label, mutation) {
					return mutation(this.model);
				}

				preview(_label, mutation) {
					return mutation(this.model);
				}
			},
		),
	);
	const app = new TestApp();

	app.duplicateSnappee(source.id);
	const copy = model.snappees.at(-1);
	assert.equal(copy.type, "circularArcCurve");
	app.moveSnappee(copy.id, { x: 5, y: 0 });
	assert.deepEqual(copy.transformation, [1, 0, 0, 1, 5, 0]);
	assert.ok(model.snappees.every(snappee => snappee && typeof snappee === "object"));
	assert.doesNotThrow(() => model.serialize());

	app.moveSnappeeInList(copy.id, -1);
	assert.equal(model.snappees.at(-2).id, copy.id);
	app.moveSnappeeInList(copy.id, { x: 1, y: 0 });
	assert.ok(model.snappees.every(snappee => snappee && typeof snappee === "object"));
});

test("snappee body movement clamps at the chart boundary instead of snapping back", () => {
	const model = ChartModel.createDefault();
	const arc = model.addSnappee("circularArcCurve", {
		name: "Near edge",
		centerX: -49.60404751429828,
		centerY: 0.13060513713539224,
		radius: 49.868015838099424,
		beginningAngle: 0,
		endAngle: 0,
		closed: true,
		segments: 24,
	});
	const TestApp = withEventEditing(
		class {
			constructor() {
				this.model = model;
			}

			commit(_label, mutation) {
				return mutation(this.model);
			}

			preview(_label, mutation) {
				return mutation(this.model);
			}
		},
	);
	const app = new TestApp();

	app.moveSnappee(arc.id, { x: -5, y: 0 });
	const transformed = sampleSnappee(arc);
	assert.ok(
		transformed.every(
			point =>
				point.x >= CHART_BOUNDS.minX &&
				point.x <= CHART_BOUNDS.maxX &&
				point.y >= CHART_BOUNDS.minY &&
				point.y <= CHART_BOUNDS.maxY,
		),
	);
	assert.ok(arc.transformation[4] < 0);
	assert.ok(arc.transformation[4] > -1);
});

test("snappee pan preview publishes moved snappees so the stage follows the pointer", () => {
	const model = ChartModel.createDefault();
	const snappee = model.addSnappee("rectangularMesh", {
		name: "Small",
		selected: true,
		topLeftX: -10,
		topLeftY: 10,
		bottomRightX: 10,
		bottomRightY: -10,
		horizontalTiles: 2,
		verticalTiles: 2,
	});
	const App = withEventEditing(
		class {
			preview(_label, mutation, options = {}) {
				this.lastPreviewOptions = options;
				return mutation(this.model);
			}
		},
	);
	const app = new App();
	app.model = model;
	const before = [...snappee.transformation];
	app.previewSnappeeMove(snappee.id, { x: 12.5, y: -4 });
	assert.equal(app.lastPreviewOptions.snappees, true);
	assert.equal(app.lastPreviewOptions.snappeeId, snappee.id);
	assert.equal(app.lastPreviewOptions.stageOnly, true);
	assert.equal(app.lastPreviewOptions.positionOnly, undefined);
	const moved = model.snappees.find(item => item.id === snappee.id);
	assert.equal(moved.transformation[4], before[4] + 12.5);
	assert.equal(moved.transformation[5], before[5] - 4);
});

test("snappee preview refresh swaps the live snappee list onto the stage", () => {
	const App = withFreeTransform(class {});
	const app = new App();
	const snappees = [{ id: 7, transformation: [1, 0, 0, 1, 8, 2] }];
	app.model = { snappees };
	app.timeline = { state: { snappees: [] }, requestRender() {} };
	app.stage = { state: { snappees: [] }, requestRender() {} };
	app.scrollView = { state: { snappees: [] }, requestRender() {} };
	app.renderIndex = {
		snappeeSamples: new Map([["stale", true]]),
		snappeePaths: new Map([["stale", true]]),
		eventRecords: [],
	};
	app._rebuildRenderIndex = () => {};
	app.requestStatusUpdate = () => {};
	app.refreshInteractionPreview({ rebuildIndex: false, snappees: true, snappeeId: 7, stageOnly: true });
	assert.equal(app.stage.state.snappees, snappees);
	assert.equal(app.timeline.state.snappees, snappees);
	assert.equal(app.renderIndex.snappeeSamples.size, 0);
	assert.equal(app.renderIndex.snappeePaths.size, 0);
});

test("reverse and loop-aware schedulers do not schedule across an A-B boundary", () => {
	const events = [
		{ id: 0, type: "tap", time: 0.7 },
		{ id: 1, type: "tap", time: 0.8 },
		{ id: 2, type: "tap", time: 1 },
		{ id: 3, type: "tap", time: 1.2 },
	];
	const reverse = collectReverseHitSchedule(events, timing, 1, 1, new Set(), 0.3, 0.02, 0.75);
	assert.deepEqual(
		reverse.map(item => item.event.id),
		[2, 1],
	);
	const forward = collectHitSchedule(events, timing, 0.9, 1, new Set(), 0.3, 0.02, 1);
	assert.deepEqual(
		forward.map(item => item.event.id),
		[],
	);
	const metronome = collectMetronomeSchedule(timing, 0.9, 1, 1, new Set(), 0.3, [0, 1]);
	assert.deepEqual(metronome, []);
});

test("metronome scheduling uses one sound for every beat", () => {
	const schedule = collectMetronomeSchedule(timing, 0, 1, 1, new Set(), 2);
	assert.ok(schedule.length > 1);
	assert.ok(schedule.every(item => item.accent === false));
});

test("global shortcuts remain active when a status checkbox is focused", () => {
	let executions = 0;
	const registry = new CommandRegistry({
		space: { id: "space", shortcut: "Space" },
		number: { id: "number", shortcut: "1" },
	});
	registry.register("space", () => {
		executions += 1;
	});
	registry.register("number", () => {
		executions += 1;
	});
	const checkbox = {
		closest() {
			return checkbox;
		},
		matches(selector) {
			return selector === 'input[type="checkbox"], input[type="radio"]';
		},
	};
	const event = key => ({
		key,
		target: checkbox,
		defaultPrevented: false,
		isComposing: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		metaKey: false,
		repeat: false,
		preventDefault() {
			this.defaultPrevented = true;
		},
		stopImmediatePropagation() {},
	});
	assert.equal(registry.handleKeyboard(event(" "), {}), true);
	assert.equal(registry.handleKeyboard(event("1"), {}), true);
	assert.equal(executions, 2);
});

test("Ctrl+Space does not activate a focused status checkbox", () => {
	let executions = 0;
	const registry = new CommandRegistry({
		space: { id: "space", shortcut: "Space" },
	});
	registry.register("space", () => {
		executions += 1;
	});
	const checkbox = {
		closest() {
			return checkbox;
		},
		matches(selector) {
			return selector === 'input[type="checkbox"], input[type="radio"]';
		},
	};
	const event = {
		key: " ",
		target: checkbox,
		defaultPrevented: false,
		isComposing: false,
		ctrlKey: true,
		shiftKey: false,
		altKey: false,
		metaKey: false,
		repeat: false,
		preventDefault() {
			this.defaultPrevented = true;
		},
		stopImmediatePropagation() {},
	};
	assert.equal(registry.handleKeyboard(event, {}), false);
	assert.equal(event.defaultPrevented, true);
	assert.equal(executions, 0);
});

test("shift-dragging the stage never retargets another event", async () => {
	const interactions = await readSources(STAGE_INTERACTION_MODULES);
	// v17: the governing event is the selected event closest to the pointer, and Shift
	// suppresses every other mouse interaction in the main field.
	assert.match(interactions, /_shiftDragTargets\(event, context\)[\s\S]*?_closestSelectedMovable\(/);
	assert.match(interactions, /event\.shiftKey && !freeTransform \? null : hit/);
	assert.match(interactions, /_closestSelectedMovable\(project, mapping, point, activeChannels\) \{/);
});

test("v9 shortcuts describe reverse playback, A-B marks, exact speed, channels, and page direction", () => {
	assert.equal(COMMAND_DEFINITIONS["music.playReverse"].shortcut, "Shift+Space");
	assert.equal(COMMAND_DEFINITIONS["music.abLoop"].shortcut, "L");
	assert.equal(COMMAND_DEFINITIONS["music.speed025"].shortcut, "Ctrl+4");
	assert.equal(COMMAND_DEFINITIONS["channel.selectLast"].shortcut, "Alt+0");
	assert.equal(COMMAND_DEFINITIONS["timeline.pageForward"].shortcut, "PageUp");
	assert.deepEqual(parseShortcut("Ctrl+Alt+M"), { ctrl: true, shift: false, alt: true, meta: false, key: "m" });
});

test("the v9 quarter-speed command preserves an exact 0.25 playback rate", () => {
	const CommandApp = withHistoryCommands(class {});
	const app = new CommandApp();
	app.model = { editor: { speed: 1 } };
	app.audio = {
		setRate: value => {
			app.audio.rate = value;
		},
	};
	app.refresh = () => {};
	app.setSpeed(0.25);
	assert.equal(app.model.editor.speed, 0.25);
	assert.equal(app.audio.rate, 0.25);
});

test("rational validation waits for a canonical, reduced tuple", () => {
	assert.equal(validateField({ type: "rational" }, [1, 1, 2]), "");
	assert.equal(validateField({ type: "rational" }, [1, 2, 2]), "");
	assert.equal(validateField({ type: "rational" }, [0, 0, 2]), "");
	assert.equal(validateField({ type: "rational" }, [-1, 1, 2]), "");
	assert.equal(validateField({ type: "rational" }, [-1, -1, 2]), "");
	assert.notEqual(validateField({ type: "rational" }, [1, 1, 0]), "");
});

test("v9 documentation and independent macro code are linked", async () => {
	const [manual, macroPage, macroCode, labels, workflows] = await Promise.all([
		readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
		readFile(new URL("../macros.html", import.meta.url), "utf8"),
		readFile(new URL("../js/macros.js", import.meta.url), "utf8"),
		readFile(new URL("../javascript.html", import.meta.url), "utf8"),
		readFile(new URL("../js/app-open-save.js", import.meta.url), "utf8"),
	]);
	assert.match(manual, /Play in reverse/);
	assert.match(manual, /宏|Macros interface/);
	// Monaco now comes up through js/macro-monaco-loader.js, which js/macros.js imports.
	const monacoLoader = await readFile(new URL("../js/macro-monaco-loader.js", import.meta.url), "utf8");
	assert.match(macroCode + monacoLoader, /monaco-editor/);
	assert.match(macroPage, /F8/);
	assert.match(labels, /href="js\/macros\.js"/);
	assert.match(labels, /Monaco Editor/);
	assert.match(workflows, /if \(record\) \{\s*this\.model\.editor\.visibleRangeBeginning/);
});
