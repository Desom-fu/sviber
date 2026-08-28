import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SviberAppCore } from "../js/app/app-core.js";
import { withFreeTransform } from "../js/app/app-free-transform.js";
import { withHistoryCommands } from "../js/app/app-history-commands.js";
import { excludeHitsBeforePlaybackOrigin } from "../js/app/app-playback-scheduling.js";
import { collectHitSchedule, collectMetronomeSchedule, collectReverseHitSchedule } from "../js/audio/scheduler.js";
import { TimingMap } from "../js/core/timing.js";
import { StageView } from "../js/render/stage.js";

function finishPlayback(app) {
	const listeners = new Map();
	app.audio.addEventListener = (type, callback) => listeners.set(type, callback);
	SviberAppCore.prototype._bindAudio.call(app);
	listeners.get("pause")();
}

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

test("music-stop clears in-flight hit effects through the shipped StageView method", () => {
	const target = { particles: [{ started: 1 }, { started: 2 }], particleAnimationFrame: 0, render() {} };
	StageView.prototype.clearHitEffects.call(target);
	assert.deepEqual(target.particles, []);
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
		audio: {
			rate: 1,
			playHit: (...args) => {
				hitCalls.push(args);
			},
		},
		stage: {
			triggerHit: (...args) => {
				effectCalls.push(args);
			},
		},
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
	const transport = await readFile(new URL("../js/app/app-playback-transport.js", import.meta.url), "utf8");
	assert.match(transport, /playbackOrigin\.scheduleStartTime = time/);
	assert.match(transport, /excludeHitsBeforePlaybackOrigin\((?:this|app), time\)/);
	assert.match(transport, /\.audio\.armPlaybackSource\(\)/);
	assert.match(transport, /collectAppHitSchedules\(/);
});

test("playback scheduling never backfills before the playback epoch", () => {
	const oldEvent = { id: 1, type: "tap" };
	const currentEvent = { id: 2, type: "tap" };
	const hitCalls = [];
	const app = {
		playbackScheduleInvalidated: false,
		playbackOrigin: { scheduleStartTime: 10 },
		renderIndex: {
			hitRecords: [
				{ event: oldEvent, start: 9.99 },
				{ event: currentEvent, start: 10.01 },
			],
			holdReleaseRecords: [],
		},
		audio: { direction: 1, rate: 1, loopRange: null, playHit: (...args) => hitCalls.push(args) },
		model: {
			editor: {},
			allEvents() {
				return [];
			},
		},
		stage: { triggerHit() {} },
		scheduledHitIds: new Set(),
		scheduledHoldReleaseIds: new Set(),
		scheduledMetronomeBeats: new Set(),
	};
	SviberAppCore.prototype._scheduleHits.call(app, 10.016);
	assert.deepEqual(hitCalls, [["tap", 0]]);
	assert.deepEqual([...app.scheduledHitIds], [2]);
});

test("playback start does not play notes between a lagging audio clock and the editor epoch", () => {
	const earlier = { id: 1, type: "tap" };
	const later = { id: 2, type: "tap" };
	const hitCalls = [];
	const effectCalls = [];
	const app = {
		playbackScheduleInvalidated: false,
		playbackOrigin: { scheduleStartTime: 10 },
		renderIndex: {
			hitRecords: [
				{ event: earlier, start: 9.985 },
				{ event: later, start: 10.05 },
			],
			holdReleaseRecords: [],
		},
		audio: { direction: 1, rate: 1, loopRange: null, playHit: (...args) => hitCalls.push(args) },
		model: {
			editor: {},
			allEvents() {
				return [];
			},
		},
		stage: { triggerHit: (...args) => effectCalls.push(args) },
		scheduledHitIds: new Set(),
		scheduledHoldReleaseIds: new Set(),
		scheduledMetronomeBeats: new Set(),
	};
	excludeHitsBeforePlaybackOrigin(app, 10);
	SviberAppCore.prototype._scheduleHits.call(app, 9.97);
	assert.equal(hitCalls.length, 1);
	assert.equal(hitCalls[0][0], "tap");
	assert.ok(Math.abs(hitCalls[0][1] - 0.08) < 1e-12);
	assert.equal(effectCalls.length, 1);
	assert.deepEqual(
		[...app.scheduledHitIds].sort((left, right) => left - right),
		[1, 2],
	);
});

test("starting at beat 137 does not fire notes at 136+23/24", () => {
	const timing = new TimingMap({ initialBpm: 180 });
	const start = timing.beatToSeconds(137);
	const noteTime = timing.beatToSeconds([136, 23, 24]);
	const hitCalls = [];
	const effectCalls = [];
	const notes = [
		{ id: 1, type: "tap" },
		{ id: 2, type: "tap" },
	];
	const app = {
		playbackScheduleInvalidated: false,
		playbackOrigin: { scheduleStartTime: start },
		renderIndex: {
			hitRecords: notes.map(event => ({ event, start: noteTime })),
			holdReleaseRecords: [],
		},
		audio: { direction: 1, rate: 1, loopRange: null, playHit: (...args) => hitCalls.push(args) },
		model: {
			editor: {},
			allEvents() {
				return [];
			},
		},
		stage: { triggerHit: (...args) => effectCalls.push(args) },
		scheduledHitIds: new Set(),
		scheduledHoldReleaseIds: new Set(),
		scheduledMetronomeBeats: new Set(),
	};
	excludeHitsBeforePlaybackOrigin(app, start);
	SviberAppCore.prototype._scheduleHits.call(app, start - 0.02);
	SviberAppCore.prototype._scheduleHits.call(app, start + 0.016);
	assert.deepEqual(hitCalls, []);
	assert.deepEqual(effectCalls, []);
	assert.deepEqual(
		[...app.scheduledHitIds].sort((left, right) => left - right),
		[1, 2],
	);
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
		viewState() {
			return {};
		},
		requestStatusUpdate() {},
		_scheduleHits(time, tolerance) {
			scheduled.push([time, tolerance]);
		},
		_flushInvalidatedPlaybackSchedule: SviberAppCore.prototype._flushInvalidatedPlaybackSchedule,
	};
	const PreviewApp = withFreeTransform(class {});
	PreviewApp.prototype.refreshInteractionPreview.call(app, { rebuildIndex: false, stageOnly: true });
	assert.deepEqual(scheduled, [[1.25, 0]]);
	assert.equal(app.playbackScheduleInvalidated, false);
});

test("view-only commits do not cancel playback hits", () => {
	const App = withFreeTransform(
		class {
			_invalidatePlaybackSchedule() {
				this.cancelled = true;
			}

			refresh() {
				this.full = true;
			}
		},
	);
	const app = new App();
	app.model = {
		editor: {},
		allEvents() {
			return [];
		},
		metadata: { title: "t", difficultyName: "d" },
		snappees: [{ id: 1, active: true }],
	};
	app.history = { recordView: () => true };
	app._refreshLightweight = function () {
		this.light = true;
	};
	app._finishCommit("toggle", () => {}, { lightweight: true, viewOnly: true, scheduleDirty: false });
	assert.equal(app.cancelled, undefined);
	assert.equal(app.light, true);
	assert.equal(app.full, undefined);
});

test("paused seeks do not repaint hit particles", async () => {
	const transport = await readFile(new URL("../js/app/app-playback-transport.js", import.meta.url), "utf8");
	assert.match(transport, /if \(app\.audio\.playing\) \{[\s\S]*?app\.stage\.cancelScheduledHits\(\);[\s\S]*?\}/);
});

test("stopping playback keeps a visible range locked after playback starts", () => {
	const app = {
		playbackScheduleInvalidated: true,
		stage: { cancelScheduledHits() {} },
		model: {
			editor: {
				currentTime: [8, 0, 1],
				timeSnapped: false,
				visibleRangeBeginning: 4,
				visibleRangeEnd: 14,
				lockVisibleRange: true,
				seekBackAfterPlaying: true,
			},
		},
		audio: { currentTime: 8 },
		playbackOrigin: {
			editorTime: [1, 0, 1],
			timeSnapped: true,
			visibleRangeBeginning: 0,
			visibleRangeEnd: 10,
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
	assert.deepEqual([app.model.editor.visibleRangeBeginning, app.model.editor.visibleRangeEnd], [4, 14]);
});

test("stopping playback restores the original visible range when it is not locked", () => {
	const app = {
		stage: { cancelScheduledHits() {} },
		model: {
			editor: {
				currentTime: [8, 0, 1],
				timeSnapped: false,
				visibleRangeBeginning: 4,
				visibleRangeEnd: 14,
				lockVisibleRange: false,
				seekBackAfterPlaying: true,
			},
		},
		audio: { currentTime: 8 },
		playbackOrigin: {
			editorTime: [1, 0, 1],
			timeSnapped: true,
			visibleRangeBeginning: 0,
			visibleRangeEnd: 10,
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

	assert.deepEqual([app.model.editor.visibleRangeBeginning, app.model.editor.visibleRangeEnd], [0, 10]);
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
