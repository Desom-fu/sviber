import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ChartModel } from "../js/core/chart-model.js";
import { encodeWebSocketFrame, parseAddress, SSCHARTER_VERSION } from "../js/live-hosting.js";
import { ChartRenderIndex } from "../js/render/chart-index.js";
import { TimingMap } from "../js/core/timing.js";
import { Rational } from "../js/core/rational.js";
import { findNearestSnapPoint } from "../js/core/geometry.js";
import { withChartTools } from "../js/app-chart-tools.js";
import { withEventEditing } from "../js/app-event-editing.js";
import { withFileWorkflows } from "../js/app-file-workflows.js";
import { withHistoryCommands } from "../js/app-history-commands.js";
import { withStageInteractions } from "../js/render/stage-interactions.js";

test("nested groups keep recursive IDs, bounds, clips, and Sunniesnow export flat", () => {
	const model = ChartModel.createDefault({
		channels: [{ id: 0, name: "One" }, { id: 1, name: "Two" }],
		events: [{
			id: 4, type: "group", channel: 0, x: 0, y: 0, color: "#ff9d3d", selected: true,
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

test("v12 editor fields use the file-format spelling and preserve legacy imports", () => {
	const model = ChartModel.createDefault({
		editor: {
			allowOutOfBound: true,
			showGroupingInTimeline: false,
			showGroupingInMainField: false,
			showTipPoints: false,
		},
	});
	assert.equal(model.editor.allowOutOfBound, true);
	assert.equal(model.editor.allowOutOfBounds, true);
	assert.equal(ChartModel.import(model.toJSON()).editor.allowOutOfBound, true);
	const legacy = ChartModel.createDefault({ editor: { allowOutOfBounds: true } });
	assert.equal(legacy.editor.allowOutOfBound, true);
	assert.equal(legacy.editor.showGroupingInTimeline, true);
	assert.equal(legacy.editor.showGroupingInMainField, true);
	assert.equal(legacy.editor.showTipPoints, true);
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
		{ id: 1, type: "tap", selected: true, x: 0, y: -10 },
		{ id: 2, type: "tap", selected: true, x: 0, y: 10 },
	] });
	assert.equal(app.startFreeTransform(), false);
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
