import assert from "node:assert/strict";
import test from "node:test";

import { SviberAppCore } from "../js/app/app-core.js";

function bindAudioListeners(app) {
	const listeners = new Map();
	app.audio.addEventListener = (type, callback) => listeners.set(type, callback);
	SviberAppCore.prototype._bindAudio.call(app);
	return listeners;
}

test("seeking during playback re-arms visible range follow after mid-range", () => {
	const app = {
		stage: { cancelScheduledHits() {} },
		model: {
			editor: {
				lockVisibleRange: false,
				visibleRangeBeginning: 0,
				visibleRangeEnd: 10,
				currentTime: 0,
				timeSnapped: false,
			},
		},
		audio: {
			playing: true,
			direction: 1,
			currentTime: 0,
			rate: 1,
		},
		playbackOrigin: { scheduleStartTime: 5 },
		playFollowOffset: { direction: 1, value: 5 },
		scheduledHitIds: new Set(),
		scheduledHoldReleaseIds: new Set(),
		scheduledMetronomeBeats: new Set(),
		_scheduleHits() {},
		timeBounds() {
			return [0, 100];
		},
		refreshPlaybackFrame() {},
	};

	const listeners = bindAudioListeners(app);
	app.audio.currentTime = 0;
	listeners.get("seek")();
	assert.equal(app.playFollowOffset, null);

	listeners.get("timeupdate")({ detail: 2 });
	assert.equal(app.playFollowOffset, null);
	assert.equal(app.model.editor.visibleRangeBeginning, 0);
	assert.equal(app.model.editor.visibleRangeEnd, 10);

	listeners.get("timeupdate")({ detail: 5 });
	assert.deepEqual(app.playFollowOffset, { direction: 1, value: 5 });

	listeners.get("timeupdate")({ detail: 6 });
	assert.equal(app.model.editor.visibleRangeBeginning, 1);
	assert.equal(app.model.editor.visibleRangeEnd, 11);
});

test("seeking during playback keeps follow disabled when visible range is locked", () => {
	const app = {
		stage: { cancelScheduledHits() {} },
		model: {
			editor: {
				lockVisibleRange: true,
				visibleRangeBeginning: 0,
				visibleRangeEnd: 10,
				currentTime: 0,
				timeSnapped: false,
			},
		},
		audio: {
			playing: true,
			direction: 1,
			currentTime: 0,
			rate: 1,
		},
		playbackOrigin: { scheduleStartTime: 5 },
		playFollowOffset: { direction: 1, value: 5 },
		scheduledHitIds: new Set(),
		scheduledHoldReleaseIds: new Set(),
		scheduledMetronomeBeats: new Set(),
		_scheduleHits() {},
		timeBounds() {
			return [0, 100];
		},
		refreshPlaybackFrame() {},
	};

	const listeners = bindAudioListeners(app);
	listeners.get("seek")();
	assert.equal(app.playFollowOffset, false);
	listeners.get("timeupdate")({ detail: 6 });
	assert.equal(app.model.editor.visibleRangeBeginning, 0);
	assert.equal(app.model.editor.visibleRangeEnd, 10);
});

test("arming follow anchors to the strict chart bound when a paused seek left the range before it", () => {
	// Home snaps the playhead slightly before time zero (negative beats), so the visible
	// range legally starts below the strict bound. Arming must anchor to the bound so the
	// first apply step does not mistake the normalization for a chart-bound hit.
	const app = {
		stage: { cancelScheduledHits() {} },
		model: {
			editor: {
				lockVisibleRange: false,
				visibleRangeBeginning: -0.0108,
				visibleRangeEnd: 3.467,
				currentTime: 0,
				timeSnapped: false,
			},
		},
		audio: {
			playing: true,
			direction: 1,
			currentTime: 0,
			rate: 1,
		},
		playbackOrigin: { scheduleStartTime: 0 },
		playFollowOffset: { direction: 1, value: 5 },
		scheduledHitIds: new Set(),
		scheduledHoldReleaseIds: new Set(),
		scheduledMetronomeBeats: new Set(),
		_scheduleHits() {},
		timeBounds() {
			return [0, 120];
		},
		refreshPlaybackFrame() {},
	};

	const listeners = bindAudioListeners(app);
	app.audio.currentTime = -0.0108;
	listeners.get("seek")();
	assert.equal(app.playFollowOffset, null);

	listeners.get("timeupdate")({ detail: 1.74 });
	assert.deepEqual(app.playFollowOffset, { direction: 1, value: 1.74 });

	listeners.get("timeupdate")({ detail: 2 });
	assert.equal(app.model.editor.visibleRangeBeginning, 0.26);
	assert.equal(app.model.editor.visibleRangeEnd, 3.7378);
	assert.deepEqual(app.playFollowOffset, { direction: 1, value: 1.74 });
});

test("play arms follow anchored to the strict chart bound when the range starts before it", () => {
	const app = {
		stage: { cancelScheduledHits() {} },
		model: {
			editor: {
				lockVisibleRange: false,
				visibleRangeBeginning: -0.0108,
				visibleRangeEnd: 3.467,
				currentTime: 0,
				timeSnapped: true,
			},
		},
		audio: {
			playing: false,
			direction: 1,
			currentTime: 2,
			rate: 1,
			armPlaybackSource() {},
		},
		playbackOrigin: null,
		playFollowOffset: null,
		lastPlaybackTime: null,
		scheduledHitIds: new Set(),
		scheduledBgNoteIds: new Set(),
		scheduledHoldReleaseIds: new Set(),
		scheduledMetronomeBeats: new Set(),
		renderIndex: { hitRecords: [], bgNoteHitRecords: [], holdReleaseRecords: [] },
		_rebuildRenderIndex() {},
		_syncAudioLoop() {},
		currentSeconds() {
			return 2;
		},
		_scheduleHits() {},
		_syncCheckedCommands() {},
		_refreshDifficultyUi() {},
		refreshPlaybackFrame() {},
		timeBounds() {
			return [0, 120];
		},
	};

	const listeners = bindAudioListeners(app);
	listeners.get("play")();
	assert.deepEqual(app.playFollowOffset, { direction: 1, value: 2 });
	assert.equal(app.lastPlaybackTime, 2);
	assert.equal(app.playbackOrigin.time, 2);
});

test("A-B loop reschedules note SE from the wrap time instead of the original epoch", () => {
	const hitCalls = [];
	const app = {
		stage: { cancelScheduledHits() {}, triggerHit() {} },
		model: {
			editor: {
				lockVisibleRange: true,
				visibleRangeBeginning: 0,
				visibleRangeEnd: 10,
				playSe: true,
			},
		},
		audio: {
			playing: true,
			direction: 1,
			currentTime: 2,
			rate: 1,
			loopRange: [2, 8],
			cancelScheduledHitSounds() {},
			playHit: (...args) => hitCalls.push(args),
		},
		playbackOrigin: { scheduleStartTime: 5 },
		lastPlaybackTime: 8,
		scheduledHitIds: new Set([1, 2]),
		scheduledHoldReleaseIds: new Set(),
		scheduledMetronomeBeats: new Set(),
		scheduledBgNoteIds: new Set(),
		playbackScheduleInvalidated: false,
		renderIndex: {
			hitRecords: [
				{ event: { id: 1, type: "tap" }, start: 2.05 },
				{ event: { id: 2, type: "tap" }, start: 6 },
			],
			holdReleaseRecords: [],
		},
		playFollowOffset: false,
		refreshPlaybackFrame() {},
		refreshInteractionPreview() {},
		_syncCheckedCommands() {},
		_refreshDifficultyUi() {},
		_scheduleHits(...args) {
			SviberAppCore.prototype._scheduleHits.call(this, ...args);
		},
	};

	const listeners = bindAudioListeners(app);
	listeners.get("loop")({ detail: { time: 2 } });
	assert.equal(app.playbackOrigin.scheduleStartTime, 2);
	assert.equal(hitCalls.length, 1);
	assert.equal(hitCalls[0][0], "tap");
	assert.ok(Math.abs(hitCalls[0][1] - 0.05) < 1e-12);
	assert.deepEqual([...app.scheduledHitIds], [1]);
});
