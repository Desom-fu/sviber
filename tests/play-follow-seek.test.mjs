import assert from "node:assert/strict";
import test from "node:test";

import { SviberAppCore } from "../js/app-core.js";

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
		timeBounds() { return [0, 100]; },
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
		timeBounds() { return [0, 100]; },
		refreshPlaybackFrame() {},
	};

	const listeners = bindAudioListeners(app);
	listeners.get("seek")();
	assert.equal(app.playFollowOffset, false);
	listeners.get("timeupdate")({ detail: 6 });
	assert.equal(app.model.editor.visibleRangeBeginning, 0);
	assert.equal(app.model.editor.visibleRangeEnd, 10);
});
