import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { COMMAND_DEFINITIONS, CommandRegistry } from "../js/commands.js";
import { SviberAppCore } from "../js/app-core.js";
import { withEventEditing } from "../js/app-event-editing.js";
import { withFreeTransform } from "../js/app-free-transform.js";
import { withHistoryCommands } from "../js/app-history-commands.js";
import { ChartModel, createEvent } from "../js/core/chart-model.js";
import { TimingMap } from "../js/core/timing.js";
import { MESSAGES } from "../js/i18n.js";
import { ChartRenderIndex } from "../js/render/chart-index.js";
import { TIMELINE_COMMENT_TEXT_COLOR, timelineTipConnector } from "../js/render/timeline-helpers.js";

function finishPlayback(app) {
	const listeners = new Map();
	app.audio.addEventListener = (type, callback) => listeners.set(type, callback);
	SviberAppCore.prototype._bindAudio.call(app);
	listeners.get("pause")();
}

function contrastRatio(foreground, background) {
	const luminance = color => {
		const channels = color.match(/[0-9a-f]{2}/gi).map(channel => parseInt(channel, 16) / 255)
			.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
		return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
	};
	const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
	return (values[0] + 0.05) / (values[1] + 0.05);
}

test("v8 commands have shortcuts and complete English and Chinese text", () => {
	const expectedShortcuts = {
		"events.comment": "Ctrl+M",
		"channel.selectAbove": "Alt+ArrowUp",
		"channel.selectBelow": "Alt+ArrowDown",
		"timeline.pageForward": "PageUp",
		"timeline.pageBackward": "PageDown",
	};
	for (const [id, shortcut] of Object.entries(expectedShortcuts)) {
		assert.equal(COMMAND_DEFINITIONS[id].shortcut, shortcut);
	}
	for (const language of Object.keys(MESSAGES)) {
		for (const definition of Object.values(COMMAND_DEFINITIONS)) {
			assert.ok(MESSAGES[language][definition.labelKey], `${language} lacks ${definition.labelKey}`);
			assert.ok(MESSAGES[language][definition.hintKey], `${language} lacks ${definition.hintKey}`);
		}
		for (const key of [
			"menu.help", "panel.channels", "dialog.comment", "dialog.editChannel", "dialog.about",
			"dialog.copy", "field.endTime", "event.comment", "panel.channel.activate",
			"panel.channel.deactivate", "panel.channel.duplicate", "panel.channel.moveUp",
			"panel.channel.moveDown", "panel.channel.delete",
			"panel.channel.rename", "panel.channel.edit", "history.editChannel", "about.repository", "about.license",
			"about.version", "about.commit", "about.commitDate", "about.nwVersion",
			"about.browserVersion", "about.engineVersion", "about.nodeVersion", "about.v8Version",
			"about.operatingSystem",
		]) assert.ok(MESSAGES[language][key], `${language} lacks ${key}`);
	}
});

test("comments and channel state round-trip without leaking into Sunniesnow events", () => {
	const model = new ChartModel({
		channels: [
			{ id: 4, name: "Muted", active: false },
			{ id: 9, name: "Gameplay", active: true },
		],
		snappees: [{ id: 8, type: "rectangularMesh", active: false, selected: true }],
		editor: { currentChannel: 4 },
		events: [
			{ id: 1, type: "tap", channel: 4, time: [0, 0, 1], x: 0, y: 0, selected: true },
			{ id: 2, type: "comment", channel: 4, time: [0, 0, 1], duration: [0, 0, 1], text: "muted note" },
			{ id: 3, type: "tap", channel: 9, time: [1, 0, 1], x: 1, y: 2 },
			{ id: 4, type: "comment", channel: 9, time: [1, 0, 1], duration: [2, 0, 1], text: "active note" },
		],
	});
	assert.equal(model.editor.currentChannel, 9);
	assert.deepEqual(model.channels.map(channel => [channel.name, channel.active]), [
		["Muted", false], ["Gameplay", true],
	]);
	assert.equal(model.snappees[0].selected, false);
	assert.equal(model.events[0].selected, false);
	assert.deepEqual(createEvent("comment", { duration: [-1, 0, 1] }).duration, [0, 0, 1]);
	assert.equal(model.addEvent("comment", {
		channel: 4, duration: [1, 0, 1], text: "new muted note", selected: true,
	}).selected, false);
	model.removeEvent(model.events.at(-1).id);

	const document = model.toJSON();
	assert.deepEqual(document.events.map(event => event.type), ["tap"]);
	assert.deepEqual(document.sviber.events.map(event => event.type), ["tap", "comment", "tap", "comment"]);
	assert.equal(document.sviber.events[3].text, "active note");
	assert.deepEqual(document.sviber.events[3].duration, [2, 0, 1]);
	assert.equal(document.sviber.editor.currentChannel, 9);

	const reopened = ChartModel.import(document);
	assert.deepEqual(reopened.channels, model.channels);
	assert.deepEqual(reopened.events, model.events);
});

test("comment text remains readable on the timeline and status panel", async () => {
	const css = (await Promise.all([
		readFile(new URL("../css/themes.css", import.meta.url), "utf8"),
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
	])).join("\n");
	const commentColors = [...css.matchAll(/--comment-text:\s*(#[0-9a-f]{6})/gi)].map(match => match[1]);
	const panelColors = [...css.matchAll(/--panel:\s*(#[0-9a-f]{6})/gi)].map(match => match[1]);
	assert.ok(commentColors.length >= 2);
	assert.equal(commentColors.length, panelColors.length);
	for (const [index, color] of commentColors.entries()) {
		assert.ok(contrastRatio(color, panelColors[index]) >= 7);
	}
	assert.ok(contrastRatio(TIMELINE_COMMENT_TEXT_COLOR, "#090a0c") >= 7);
	assert.match(css, /\.status-comment\s*\{[\s\S]*?color:\s*var\(--comment-text\)/);
});

test("spatial transforms include selected tip-point cursor spawns", () => {
	const model = new ChartModel({
		channels: [{ id: 0, name: "Main", active: true }],
		events: [
			{ id: 1, type: "tap", channel: 0, time: [1, 0, 1], x: 25, y: 10, selected: true,
				tipPointSpawnType: "drop", tipPointSpawnAbsolutePosition: false,
				tipPointSpawnDistance: 40, tipPointSpawnAngle: 0 },
			{ id: 2, type: "tap", channel: 0, time: [2, 0, 1], x: 30, y: -5, selected: false,
				tipPointSpawnType: "drop", tipPointSpawnAbsolutePosition: true,
				tipPointSpawnAttached: false, tipPointSpawnX: 70, tipPointSpawnY: 20 },
		],
	});
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	assert.equal(app._applyTransformMutation(model, [-1, 0, 0, 1, 0, 0]), true);
	assert.equal(model.events[0].x, -25);
	assert.ok(Math.abs(Math.abs(model.events[0].tipPointSpawnAngle) - Math.PI) < 1e-12);
	assert.equal(model.events[0].tipPointSpawnDistance, 40);
	assert.deepEqual(
		model.events.slice(1).map(event => ({ x: event.x, y: event.y, spawnX: event.tipPointSpawnX, spawnY: event.tipPointSpawnY })),
		[{ x: 30, y: -5, spawnX: 70, spawnY: 20 }],
	);
	const placeholder = model.generateSunniesnowEvents().find(event => event.type === "placeholder");
	assert.ok(Math.abs(placeholder.properties.x + 65) < 1e-12);
	assert.ok(Math.abs(placeholder.properties.y - 10) < 1e-12);
});

test("selected pen snappees support flips, translation, and free-transform bounds", () => {
	const model = new ChartModel({
		channels: [{ id: 0, name: "Main", active: true }],
		snappees: [{
			id: 12, type: "penCurve", name: "Pen line", active: true, selected: true,
			transformation: [1, 0, 0, 1, 0, 0],
			commands: [{ type: "M", x: 10, y: 0 }, { type: "C", x1: 14, y1: 0, x2: 18, y2: 0, x: 22, y: 0 }],
			segments: 8, closed: false,
		}],
	});
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	assert.equal(app.transformationAvailable(model), true);
	assert.equal(app._applyTransformMutation(model, [-1, 0, 0, 1, 0, 0]), true);
	assert.deepEqual(model.snappees[0].transformation, [-1, 0, 0, 1, 0, 0]);
	assert.equal(app._applyTransformMutation(model, [1, 0, 0, -1, 0, 0]), true);
	assert.deepEqual(model.snappees[0].transformation.map(value => value === 0 ? 0 : value), [-1, 0, 0, -1, 0, 0]);
	assert.ok(app.transformSelectionBounds(model).maxY > app.transformSelectionBounds(model).minY);
	assert.equal(app._applyTransformMutation(model, [1, 0, 0, 1, 5, 7]), true);
	assert.deepEqual(model.snappees[0].transformation.map(value => value === 0 ? 0 : value), [-1, 0, 0, -1, 5, 7]);
});

test("transform commands are enabled for a selected snappee without selected events", () => {
	const model = ChartModel.createDefault({ events: [], snappees: [{
		id: 20, type: "bezierCurve", name: "Curve", active: true, selected: true,
		transformation: [1, 0, 0, 1, 0, 0], controlPoints: [{ x: -20, y: -10 }, { x: 20, y: 10 }],
		segments: 4, closed: false,
	}] });
	const CommandApp = withHistoryCommands(withEventEditing(class {}));
	const app = new CommandApp();
	app.model = model;
	app.registry = new CommandRegistry();
	app._registerCommands();
	for (const id of ["transform.moveLeft", "transform.flipHorizontal", "transform.flipVertical", "transform.free", "transform.matrix"]) {
		assert.equal(app.registry.isEnabled(id, app), true, `${id} should be enabled`);
	}
});

test("absolute tip-point cursor spawns follow vertical and matrix transforms", () => {
	const model = new ChartModel({
		channels: [{ id: 0, name: "Main", active: true }],
		events: [{ id: 1, type: "flick", channel: 0, time: [1, 0, 1], x: 10, y: 5, selected: true,
			angle: Math.PI / 4, tipPointSpawnType: "chain", tipPointSpawnAbsolutePosition: true,
			tipPointSpawnAttached: false, tipPointSpawnX: 70, tipPointSpawnY: 20 }],
	});
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	assert.equal(app._applyTransformMutation(model, [1, 0, 0, -1, 0, 0]), true);
	assert.deepEqual({ x: model.events[0].x, y: model.events[0].y,
		spawnX: model.events[0].tipPointSpawnX, spawnY: model.events[0].tipPointSpawnY },
	{ x: 10, y: -5, spawnX: 70, spawnY: -20 });
	assert.ok(Math.abs(model.events[0].angle + Math.PI / 4) < 1e-12);
	assert.equal(app._applyTransformMutation(model, [1, 0, 0, 1, 5, 7]), true);
	assert.deepEqual({ x: model.events[0].x, y: model.events[0].y,
		spawnX: model.events[0].tipPointSpawnX, spawnY: model.events[0].tipPointSpawnY },
	{ x: 15, y: 2, spawnX: 75, spawnY: -13 });
});

test("attached tip-point cursor spawns preserve unrelated snappees", () => {
	const mesh = {
		id: 8, type: "rectangularMesh", name: "Guide", color: "#00e0ad", active: true, selected: false,
		transformation: [1, 0, 0, 1, 0, 0], topLeftX: -50, topLeftY: 20,
		bottomRightX: 50, bottomRightY: -20, horizontalTiles: 2, verticalTiles: 2,
	};
	const model = new ChartModel({
		channels: [{ id: 0, name: "Main", active: true }],
		snappees: [mesh],
		events: [{ id: 1, type: "tap", channel: 0, time: [1, 0, 1], x: 10, y: 5, selected: true,
			tipPointSpawnType: "drop", tipPointSpawnAbsolutePosition: true, tipPointSpawnAttached: true,
			tipPointSpawnSnappee: 8, tipPointSpawnSnapPoint: [2, 0] }],
	});
	const EditingApp = withEventEditing(class {});
	assert.equal(new EditingApp()._applyTransformMutation(model, [-1, 0, 0, 1, 0, 0]), true);
	assert.deepEqual(model.snappees[0].transformation, [1, 0, 0, 1, 0, 0]);
	assert.equal(model.events[0].tipPointSpawnAttached, false);
	assert.deepEqual([model.events[0].tipPointSpawnX, model.events[0].tipPointSpawnY], [-50, 20]);
	assert.equal("tipPointSpawnSnappee" in model.events[0], false);
});

test("tip-point cursors retain attachment when their note moves the same snappee", () => {
	const model = new ChartModel({
		channels: [{ id: 0, name: "Main", active: true }],
		snappees: [{
			id: 8, type: "rectangularMesh", name: "Guide", color: "#00e0ad", active: true, selected: false,
			transformation: [1, 0, 0, 1, 0, 0], topLeftX: -50, topLeftY: 20,
			bottomRightX: 50, bottomRightY: -20, horizontalTiles: 2, verticalTiles: 2,
		}],
		events: [{ id: 1, type: "tap", channel: 0, time: [1, 0, 1], selected: true,
			attached: true, snappee: 8, snapPoint: [2, 0], tipPointSpawnType: "drop",
			tipPointSpawnAbsolutePosition: true, tipPointSpawnAttached: true,
			tipPointSpawnSnappee: 8, tipPointSpawnSnapPoint: [0, 0] }],
	});
	const EditingApp = withEventEditing(class {});
	assert.equal(new EditingApp()._applyTransformMutation(model, [-1, 0, 0, 1, 0, 0]), true);
	assert.deepEqual(model.snappees[0].transformation, [-1, 0, 0, 1, 0, 0]);
	assert.equal(model.events[0].tipPointSpawnAttached, true);
	assert.equal(model.events[0].tipPointSpawnSnappee, 8);
});

test("deleting the current channel chooses a remaining active channel", () => {
	const model = new ChartModel({
		channels: [
			{ id: 0, name: "Inactive above", active: false },
			{ id: 1, name: "Current", active: true },
			{ id: 2, name: "Active below", active: true },
		],
		editor: { currentChannel: 1 },
	});
	model.removeChannel(1);
	assert.equal(model.editor.currentChannel, 2);
});

test("event dragging cannot move selected events into an inactive channel", () => {
	const model = new ChartModel({
		channels: [
			{ id: 0, name: "Active", active: true },
			{ id: 1, name: "Inactive", active: false },
		],
		events: [{ id: 1, type: "tap", channel: 0, time: [0, 0, 1], x: 0, y: 0, selected: true }],
	});
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	app._applyEventMove(model, [1, 0, 1], 1, false);
	assert.equal(model.events[0].channel, 0);
	assert.deepEqual(model.events[0].time, [1, 0, 1]);
});

test("invalidated playback skips stale ticks but permits the zero-tolerance rebuild", () => {
	const event = { id: 1, type: "tap" };
	const hitCalls = [];
	const effectCalls = [];
	const app = {
		playbackScheduleInvalidated: true,
		renderIndex: {
			hitRecords: [{ event, start: 0.05 }],
			holdReleaseRecords: [],
		},
		audio: { rate: 1, playHit: (...args) => { hitCalls.push(args); } },
		stage: { triggerHit: (...args) => { effectCalls.push(args); } },
		scheduledHitIds: new Set(),
		scheduledHoldReleaseIds: new Set(),
	};
	SviberAppCore.prototype._scheduleHits.call(app, 0);
	assert.deepEqual(hitCalls, []);
	assert.equal(app.scheduledHitIds.size, 0);

	SviberAppCore.prototype._scheduleHits.call(app, 0, 0);
	assert.deepEqual(hitCalls, [["tap", 0.05]]);
	assert.equal(effectCalls.length, 1);
	assert.deepEqual([...app.scheduledHitIds], [1]);
});

test("starting playback schedules only events at or after the exact start time", async () => {
	const core = await readFile(new URL("../js/app-core.js", import.meta.url), "utf8");
	assert.match(core, /this\.playbackOrigin\.scheduleStartTime = time/);
	assert.match(core, /playbackLateTolerance\(current, lateTolerance,[\s\S]*?scheduleTolerance/);
});

test("playback scheduling never backfills before the playback epoch", () => {
	const oldEvent = { id: 1, type: "tap" };
	const currentEvent = { id: 2, type: "tap" };
	const hitCalls = [];
	const app = {
		playbackScheduleInvalidated: false,
		playbackOrigin: { scheduleStartTime: 10 },
		renderIndex: { hitRecords: [{ event: oldEvent, start: 9.99 }, { event: currentEvent, start: 10.01 }], holdReleaseRecords: [] },
		audio: { direction: 1, rate: 1, loopRange: null, playHit: (...args) => hitCalls.push(args) },
		model: { editor: {}, allEvents() { return []; } },
		stage: { triggerHit() {} },
		scheduledHitIds: new Set(), scheduledHoldReleaseIds: new Set(), scheduledMetronomeBeats: new Set(),
	};
	SviberAppCore.prototype._scheduleHits.call(app, 10.016);
	assert.deepEqual(hitCalls, [["tap", 0]]);
	assert.deepEqual([...app.scheduledHitIds], [2]);
});

test("invalidated lightweight refresh rebuilds the hit schedule", () => {
	const scheduled = [];
	const app = {
		playbackScheduleInvalidated: true,
		audio: { playing: true, currentTime: 1.25 },
		timeline: {},
		stage: { requestRender() {} },
		scrollView: { requestRender() {} },
		_rebuildRenderIndex() {},
		viewState() { return {}; },
		requestStatusUpdate() {},
		_scheduleHits(time, tolerance) { scheduled.push([time, tolerance]); },
		_flushInvalidatedPlaybackSchedule: SviberAppCore.prototype._flushInvalidatedPlaybackSchedule,
	};
	const PreviewApp = withFreeTransform(class {});
	PreviewApp.prototype.refreshInteractionPreview.call(app, { rebuildIndex: false, stageOnly: true });
	assert.deepEqual(scheduled, [[1.25, 0]]);
	assert.equal(app.playbackScheduleInvalidated, false);
});

test("view-only commits do not cancel playback hits", () => {
	const App = withFreeTransform(class {
		_invalidatePlaybackSchedule() { this.cancelled = true; }
		refresh() { this.full = true; }
	});
	const app = new App();
	app.model = {
		editor: {},
		allEvents() { return []; },
		metadata: { title: "t", difficultyName: "d" },
		snappees: [{ id: 1, active: true }],
	};
	app.history = { recordView: () => true };
	app._refreshLightweight = function () { this.light = true; };
	app._finishCommit("toggle", () => {}, { lightweight: true, viewOnly: true, scheduleDirty: false });
	assert.equal(app.cancelled, undefined);
	assert.equal(app.light, true);
	assert.equal(app.full, undefined);
});

test("commits use incremental refresh by default and reserve full refresh for panel domains", () => {
	const App = withFreeTransform(class {
		refresh() { this.full = true; }
		_invalidatePlaybackSchedule() {}
	});
	const makeApp = () => {
		const app = new App();
		app._refreshLightweight = function () { this.light = true; };
		app.model = {
			value: 0, music: "", image: "", metadata: { title: "t" }, channels: [], snappees: [], clips: [],
			snapshot() { return { value: this.value }; }, allEvents() { return []; },
		};
		app.history = { record: () => true };
		return app;
	};
	const incremental = makeApp();
	incremental._finishCommit("edit", model => { model.value = 1; });
	assert.equal(incremental.light, true);
	assert.equal(incremental.full, undefined);
	const full = makeApp();
	full._finishCommit("metadata", model => { model.metadata.title = "next"; });
	assert.equal(full.full, true);
	assert.equal(full.light, undefined);
});

test("stopping playback keeps a visible range locked after playback starts", () => {
	const app = {
		playbackScheduleInvalidated: true,
		stage: { cancelScheduledHits() {} },
		model: {
			editor: {
				currentTime: [8, 0, 1], timeSnapped: false,
				visibleRangeBeginning: 4, visibleRangeEnd: 14,
				lockVisibleRange: true, seekBackAfterPlaying: true,
			},
		},
		audio: { currentTime: 8 },
		playbackOrigin: {
			editorTime: [1, 0, 1], timeSnapped: true,
			visibleRangeBeginning: 0, visibleRangeEnd: 10,
		},
		resumePlaybackAfterSeek: false,
		playFollowOffset: { direction: 1, value: 5 },
		lastPlaybackTime: 8,
		scheduledHitIds: new Set([1]),
		scheduledHoldReleaseIds: new Set([2]),
		scheduledMetronomeBeats: new Set([3]),
		refresh() {},
	};

	finishPlayback(app);

	assert.deepEqual(app.model.editor.currentTime, [1, 0, 1]);
	assert.equal(app.model.editor.timeSnapped, true);
	assert.deepEqual([
		app.model.editor.visibleRangeBeginning,
		app.model.editor.visibleRangeEnd,
	], [4, 14]);
});

test("stopping playback restores the original visible range when it is not locked", () => {
	const app = {
		stage: { cancelScheduledHits() {} },
		model: {
			editor: {
				currentTime: [8, 0, 1], timeSnapped: false,
				visibleRangeBeginning: 4, visibleRangeEnd: 14,
				lockVisibleRange: false, seekBackAfterPlaying: true,
			},
		},
		audio: { currentTime: 8 },
		playbackOrigin: {
			editorTime: [1, 0, 1], timeSnapped: true,
			visibleRangeBeginning: 0, visibleRangeEnd: 10,
		},
		resumePlaybackAfterSeek: false,
		playFollowOffset: null,
		lastPlaybackTime: 8,
		scheduledHitIds: new Set(),
		scheduledHoldReleaseIds: new Set(),
		scheduledMetronomeBeats: new Set(),
		refresh() {},
	};

	finishPlayback(app);

	assert.deepEqual([
		app.model.editor.visibleRangeBeginning,
		app.model.editor.visibleRangeEnd,
	], [0, 10]);
});

test("render index separates inactive gameplay from complete timeline and comments", () => {
	const project = {
		channels: [
			{ id: 0, name: "Active", active: true },
			{ id: 1, name: "Inactive", active: false },
		],
		snappees: [],
		events: [
			{ id: 1, type: "tap", channel: 0, time: [1, 0, 1], x: 0, y: 0, tipPointSpawnType: "chain", tipPointSpawnTime: 1 },
			{ id: 2, type: "tap", channel: 0, time: [2, 0, 1], x: 1, y: 0, tipPointSpawnType: "inherit", tipPointSpawnTime: 1 },
			{ id: 3, type: "tap", channel: 1, time: [1, 0, 1], x: 0, y: 1, tipPointSpawnType: "chain", tipPointSpawnTime: 1 },
			{ id: 4, type: "tap", channel: 1, time: [2, 0, 1], x: 1, y: 1, tipPointSpawnType: "inherit", tipPointSpawnTime: 1 },
			{ id: 5, type: "comment", channel: 0, time: [0, 0, 1], duration: [2, 0, 1], text: "active" },
			{ id: 6, type: "comment", channel: 1, time: [0, 0, 1], duration: [2, 0, 1], text: "inactive" },
		],
	};
	const index = new ChartRenderIndex(project, new TimingMap({ initialBpm: 60 }));
	assert.deepEqual(index.hitRecords.map(record => record.event.id), [1, 2]);
	assert.equal(index.tipGuides.length, 1);
	assert.equal(index.allTipGuides.length, 2);
	assert.equal(index.timelineTipGuides(-10, 10).length, 2);
	assert.deepEqual(index.activeComments(0.5).map(event => event.text), ["active", "inactive"]);
	assert.equal(index.eventById.get(4), project.events[3]);

	index.setEventSelected(project.events[0], true);
	assert.equal(index.selectedEventIds.has(1), true);
	index.setEventSelected(project.events[0], false);
	assert.equal(index.selectedEventIds.has(1), false);
});

test("timeline tip connector is fixed just beyond the largest event icon radius", () => {
	const connector = timelineTipConnector([
		{ time: 0, x: 0, y: 0 },
		{ time: 10, x: 1000, y: 0 },
	]);
	assert.equal(connector[0].time, 0);
	assert.equal(Math.hypot(connector[0].x - connector[1].x, connector[0].y - connector[1].y), 12);
});

test("JavaScript license labels cover independent scripts with valid source links", async () => {
	const labels = await readFile(new URL("../javascript.html", import.meta.url), "utf8");
	assert.match(labels, /id="jslicense-labels1"/);
	for (const script of ["js/app.js", "js/license-page.js", "service-worker.js", "docs/docs.js"]) {
		assert.match(labels, new RegExp(`href="${script.replace(".", "\\.")}"`));
	}
	assert.match(labels, /data-return-editor/);
	assert.doesNotMatch(labels, /\/blob\/master\//);
});
