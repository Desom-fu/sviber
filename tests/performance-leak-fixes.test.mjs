import assert from "node:assert/strict";
import test from "node:test";

import { ChartModel } from "../js/core/chart-model.js";
import { runChecks } from "../js/core/checks.js";
import { SPECIAL_SNAP_INDEX, resolveAttachedPosition, sampleSnappee } from "../js/core/geometry.js";
import { withOpenSave } from "../js/app/app-open-save.js";
import { withChecks } from "../js/app/app-checks.js";
import { ChartRenderIndex } from "../js/render/chart-index.js";
import { TimelineView } from "../js/render/timeline.js";
import { ClipsPanel } from "../js/ui/panel-clips.js";
import { ChannelsPanel, SnappeesPanel } from "../js/ui/panel-lists.js";
import { TooltipManager } from "../js/ui/ui-shell.js";

function makeFakeElement(tagName) {
	const element = {
		tagName: tagName.toUpperCase(),
		children: [],
		dataset: {},
		style: {},
		attributes: new Map(),
		listeners: new Map(),
		classList: {
			tokens: new Set(),
			toggle(name, force) {
				if (force === undefined) {
					if (this.tokens.has(name)) {
						this.tokens.delete(name);
					} else {
						this.tokens.add(name);
					}
					return;
				}
				if (force) {
					this.tokens.add(name);
				} else {
					this.tokens.delete(name);
				}
			},
		},
		append(...nodes) {
			this.children.push(...nodes);
		},
		replaceChildren(...nodes) {
			this.children = [...nodes];
		},
		setAttribute(name, value) {
			this.attributes.set(name, String(value));
		},
		addEventListener(type, fn) {
			if (!this.listeners.has(type)) {
				this.listeners.set(type, new Set());
			}
			this.listeners.get(type).add(fn);
		},
		removeEventListener(type, fn) {
			this.listeners.get(type)?.delete(fn);
		},
		contains(other) {
			return other === this;
		},
		getContext() {
			return null;
		},
		scrollTop: 0,
		scrollLeft: 0,
	};
	return element;
}

function makeFakeI18n() {
	return {
		language: "en-US",
		t(key) {
			return key;
		},
		subscribe() {
			return () => {};
		},
	};
}

function makeTestSnappees() {
	const transform = [1.2, 0.3, -0.25, 0.85, 7.5, -4.2];
	return [
		{
			id: 1,
			type: "rectangularMesh",
			horizontalTiles: 4,
			verticalTiles: 3,
			topLeftX: -80,
			topLeftY: 40,
			bottomRightX: 80,
			bottomRightY: -40,
			transformation: transform,
		},
		{
			id: 2,
			type: "radialMesh",
			azimuthalTiles: 6,
			radialTiles: 3,
			centerX: 5,
			centerY: -3,
			radius: 30,
			startingAngle: 0.4,
			transformation: transform,
		},
		{
			id: 3,
			type: "regularPolygonCurve",
			sides: 5,
			segmentsPerSide: 3,
			centerX: -10,
			centerY: 8,
			radius: 25,
			angle: 0.2,
			transformation: transform,
		},
		{
			id: 4,
			type: "circularArcCurve",
			centerX: 4,
			centerY: 6,
			radius: 22,
			beginningAngle: 0.1,
			endAngle: 2.3,
			segments: 6,
			closed: false,
			clockwise: true,
			transformation: transform,
		},
		{
			id: 5,
			type: "circularArcCurve",
			centerX: 0,
			centerY: 0,
			radius: 15,
			beginningAngle: 0.5,
			segments: 5,
			closed: true,
			clockwise: false,
			transformation: transform,
		},
		{
			id: 6,
			type: "parametricMesh",
			iRange: [3, 0],
			iRangeExclusive: true,
			jRange: [-1, 2],
			jRangeExclusive: false,
			xExpression: (i, j) => i * 5 + j,
			yExpression: (i, j) => j * 4 - i,
			transformation: transform,
		},
		{
			id: 7,
			type: "parametricCurve",
			iRange: [0, 4],
			iRangeExclusive: false,
			closed: true,
			xExpression: i => i * 10 - 20,
			yExpression: i => i * i - 3,
			transformation: transform,
		},
		{
			id: 8,
			type: "bezierCurve",
			segments: 5,
			closed: false,
			controlPoints: [{ x: -30, y: -10 }, { x: 0, y: 25 }, { x: 30, y: -15 }],
			transformation: transform,
		},
		{
			id: 9,
			type: "penCurve",
			segments: 4,
			closed: false,
			commands: [{ type: "M", x: -20, y: 0 }, { type: "L", x: 0, y: 20 }, { type: "L", x: 20, y: 0 }],
			transformation: transform,
		},
	];
}

test("list panel re-renders unregister inline action and expansion tooltips without leaking", () => {
	const previousDocument = globalThis.document;
	globalThis.document = { createElement: makeFakeElement };
	try {
		const i18n = makeFakeI18n();
		const tooltip = new TooltipManager({ i18n, document: globalThis.document, element: makeFakeElement("span") });
		const snappeesPanel = new SnappeesPanel({ element: makeFakeElement("div"), i18n, tooltip });
		const channelsPanel = new ChannelsPanel({ element: makeFakeElement("div"), i18n, tooltip });
		const clipsPanel = new ClipsPanel({ element: makeFakeElement("div"), i18n, tooltip });
		const model = ChartModel.createDefault({
			channels: [
				{ id: 0, name: "A" },
				{ id: 1, name: "B" },
			],
			snappees: [{ type: "rectangularMesh", id: 0, name: "Mesh" }],
			clips: [{ name: "Clip", data: { events: [], snappees: [] } }],
		});

		snappeesPanel.render(model);
		channelsPanel.render(model);
		clipsPanel.render(model);
		const baseline = tooltip.entries.size;
		assert.ok(baseline > 0);

		for (let iteration = 0; iteration < 30; iteration += 1) {
			snappeesPanel.render(model);
			channelsPanel.render(model);
			clipsPanel.render(model);
		}
		assert.equal(tooltip.entries.size, baseline, "repeated renders must not grow TooltipManager.entries");
	} finally {
		globalThis.document = previousDocument;
	}
});

test("resolveAttachedPosition matches sampleSnappee for every snappee type and invalid index", () => {
	const snappees = makeTestSnappees();
	const snappeeMap = new Map(snappees.map(snappee => [snappee.id, snappee]));
	const sampleCache = new Map();

	for (const snappee of snappees) {
		const sampled = sampleSnappee(snappee);
		for (const expected of sampled) {
			const resolved = resolveAttachedPosition(
				{ attached: true, snappee: snappee.id, snapPoint: expected.snapPoint },
				snappeeMap,
				{ sampleCache },
			);
			assert.ok(resolved, `expected hit for ${snappee.type} snapPoint ${JSON.stringify(expected.snapPoint)}`);
			assert.equal(resolved.attached, true);
			assert.equal(resolved.snappee, snappee);
			assert.ok(Math.abs(resolved.x - expected.x) < 1e-12);
			assert.ok(Math.abs(resolved.y - expected.y) < 1e-12);
			assert.ok(Math.abs(resolved.localX - expected.localX) < 1e-12);
			assert.ok(Math.abs(resolved.localY - expected.localY) < 1e-12);
			assert.deepEqual(resolved.snapPoint, expected.snapPoint);
		}

		for (const badSnapPoint of [null, undefined, 999, -2, 1.5, [999, 0], [0], "0"]) {
			const missing = resolveAttachedPosition(
				{ attached: true, snappee: snappee.id, snapPoint: badSnapPoint },
				snappees,
				{ sampleCache },
			);
			assert.equal(missing, null, `expected null for ${snappee.type} invalid ${JSON.stringify(badSnapPoint)}`);
		}
	}

	const center = resolveAttachedPosition(
		{ tipPointSpawnAttached: true, tipPointSpawnSnappee: 3, tipPointSpawnSnapPoint: SPECIAL_SNAP_INDEX },
		snappees,
		{ prefix: "tipPointSpawn" },
	);
	assert.equal(center.snapPoint, SPECIAL_SNAP_INDEX);
});

test("checkBlockedTexts and checkDragScreening match reference semantics across long holds and channels", () => {
	const model = ChartModel.createDefault({
		metadata: { title: "Song", artist: "Artist", charter: "Charter", difficultyName: "Master", difficulty: "12" },
		channels: [
			{ id: 0, name: "Bottom" },
			{ id: 1, name: "Top" },
		],
	});
	// A long hold (typeLayer=1) from beat 0 to 20 covers a bgNote (typeLayer=0) at beat 10 within distance 6.25.
	model.addEvent("hold", { channel: 1, time: [0, 0, 1], duration: [20, 0, 1], x: 3, y: 0 });
	const coveredByLongHold = model.addEvent("bgNote", {
		channel: 0,
		time: [10, 0, 1],
		duration: [2, 0, 1],
		x: 0,
		y: 0,
		text: "hidden",
	});
	// A regular tap at beat 10 has start=10 > hold.start=0 and same typeLayer=1, so it draws above the hold.
	const aboveEarlierHold = model.addEvent("tap", { channel: 0, time: [10, 0, 1], x: 0, y: 0, text: "above" });
	// Two consecutive holds cover a hold's full span; a partial hold does not.
	const coveredHold = model.addEvent("hold", {
		channel: 0,
		time: [30, 0, 1],
		duration: [4, 0, 1],
		x: -40,
		y: 0,
		text: "covered",
	});
	model.addEvent("hold", { channel: 1, time: [30, 0, 1], duration: [2, 0, 1], x: -40, y: 0 });
	model.addEvent("hold", { channel: 1, time: [32, 0, 1], duration: [2, 0, 1], x: -40, y: 0 });
	const uncoveredHold = model.addEvent("hold", {
		channel: 0,
		time: [40, 0, 1],
		duration: [4, 0, 1],
		x: -40,
		y: 0,
		text: "visible",
	});
	model.addEvent("hold", { channel: 1, time: [40, 0, 1], duration: [2, 0, 1], x: -40, y: 0 });
	// Drag screening: unguarded drag followed by nearby tap -> violation; guarded drag -> no violation.
	const screenedDrag = model.addEvent("drag", { channel: 0, time: [60, 0, 1], x: 50, y: 0 });
	model.addEvent("tap", { channel: 0, time: [60, 1, 8], x: 52, y: 0 });
	model.addEvent("tap", { channel: 0, time: [70, 0, 1], x: 50, y: 0 });
	const guardedDrag = model.addEvent("drag", { channel: 0, time: [70, 1, 8], x: 50, y: 0 });
	model.addEvent("tap", { channel: 0, time: [70, 2, 8], x: 50, y: 0 });

	const violations = runChecks(model);
	const blockedIds = violations.filter(item => item.check === "blockedTexts").flatMap(item => item.eventIds);
	assert.deepEqual(blockedIds, [coveredByLongHold.id, coveredHold.id]);
	assert.equal(blockedIds.includes(aboveEarlierHold.id), false);
	assert.equal(blockedIds.includes(uncoveredHold.id), false);

	const screenedIds = violations.filter(item => item.check === "dragScreening").flatMap(item => item.eventIds);
	assert.deepEqual(screenedIds, [screenedDrag.id]);
	assert.equal(screenedIds.includes(guardedDrag.id), false);
});

test("broadcastLiveChartUpdate skips chart export when no live reload client is connected", () => {
	const App = withOpenSave(class {});
	const app = new App();
	let exportsCount = 0;
	let broadcasts = 0;
	const model = {
		exportSunniesnow() {
			exportsCount += 1;
			return { events: [] };
		},
	};
	app.activeDifficultyState = () => ({ file: "master.json", model });
	app.liveHosting = {
		server: {},
		reloadPort: 8012,
		clients: new Set(),
		broadcast() {
			broadcasts += 1;
		},
	};

	app.broadcastLiveChartUpdate();
	assert.equal(exportsCount, 0);
	assert.equal(broadcasts, 0);

	app.liveHosting.clients.add({});
	app.broadcastLiveChartUpdate();
	assert.equal(exportsCount, 1);
	assert.equal(broadcasts, 2);
});

test("superseded check slice waits for checksQuietTimer before restarting", async () => {
	const App = withChecks(class {});
	const app = new App();
	app.model = ChartModel.createDefault();
	app.checksPanel = { render() {} };
	let slicesRun = 0;
	const origIdle = globalThis.requestIdleCallback;
	const pendingCallbacks = [];
	globalThis.requestIdleCallback = callback => {
		pendingCallbacks.push(callback);
		return pendingCallbacks.length;
	};
	try {
		app._pumpChecksRefresh();
		// Supersede while a quiet timer is actively counting down.
		app._scheduleChecksRefresh();
		const staleSlice = pendingCallbacks.shift();
		staleSlice({ timeRemaining: () => 10 });
		slicesRun = pendingCallbacks.length;
		assert.equal(slicesRun, 0, "stale slice must wait for quiet timer instead of restarting immediately");
		clearTimeout(app.checksQuietTimer);
		app.checksQuietTimer = null;
	} finally {
		globalThis.requestIdleCallback = origIdle;
	}
});

test("timeline scrollbar heatmap cache reuses runs and invalidates on renderIndex mutations", () => {
	const model = ChartModel.createDefault({
		events: [{ id: 1, type: "tap", channel: 0, time: [0, 0, 1], x: 0, y: 0 }],
	});
	const index = new ChartRenderIndex(model, model.timing);
	const view = Object.create(TimelineView.prototype);
	view.renderIndex = index;
	view.timing = model.timing;

	const firstRuns = view._scrollbarHeatmapRuns(model, [0, 10], 20);
	const secondRuns = view._scrollbarHeatmapRuns(model, [0, 10], 20);
	assert.equal(secondRuns, firstRuns, "unchanged state returns cached runs array");

	const added = model.addEvent("tap", { channel: 0, time: [10, 0, 1], x: 0, y: 0 });
	index.appendRootEvent(added);
	const afterAddRuns = view._scrollbarHeatmapRuns(model, [0, 10], 20);
	assert.notEqual(afterAddRuns, firstRuns, "appendRootEvent invalidates scrollbar heatmap cache");
});
