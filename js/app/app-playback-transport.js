// Playback transport: everything that reacts to the audio player's clock and lifecycle
// events, plus the hit/bg-note/metronome scheduling that rides on it. Split out of
// app-core.js so the transport rules (visible-range follow, schedule invalidation,
// seek-back-after-playing) are readable on their own.
//
// The listener installers are module-level functions taking the app instance rather than
// methods, so `_bindAudio` stays callable against a bare stub object in the tests.

import { collectMetronomeSchedule } from "../audio/scheduler.js";
import {
	hitAudioTime,
	excludeHitsBeforePlaybackOrigin,
	collectAppHitSchedules,
	collectAppBgNoteSchedules,
} from "./app-playback-scheduling.js";
import { deepClone } from "./app-helpers.js";

// Every transport discontinuity (loop, seek, direction or rate change, stop) drops the
// "already scheduled" bookkeeping so the next frame can schedule from scratch.
function clearScheduledSounds(app) {
	app.scheduledHitIds.clear();
	app.scheduledBgNoteIds?.clear();
	app.scheduledHoldReleaseIds.clear();
	app.scheduledMetronomeBeats.clear();
}

// Once the playhead has reached the middle of the visible range the range starts to
// follow it, keeping the playhead at a constant offset. `false` means "never follow for
// this playback run", `null` means "not yet, keep watching".
function initialPlayFollowOffset(editor, direction, time) {
	if (editor.lockVisibleRange) {
		return false;
	}
	const center = (editor.visibleRangeBeginning + editor.visibleRangeEnd) / 2;
	if (direction > 0) {
		if (time > editor.visibleRangeEnd) {
			return false;
		}
		if (time >= center && time >= editor.visibleRangeBeginning) {
			return { direction: 1, value: time - editor.visibleRangeBeginning };
		}
		return null;
	}
	if (time < editor.visibleRangeBeginning) {
		return false;
	}
	if (time <= center && time <= editor.visibleRangeEnd) {
		return { direction: -1, value: editor.visibleRangeEnd - time };
	}
	return null;
}

// Arms the follow offset as soon as the playhead crosses the middle of the visible range.
function armPlayFollowOffset(app, editor, time, center) {
	if (app.playFollowOffset !== null) {
		return;
	}
	if (app.audio.direction > 0 && time >= center && time <= editor.visibleRangeEnd) {
		app.playFollowOffset = { direction: 1, value: time - editor.visibleRangeBeginning };
	} else if (app.audio.direction < 0 && time <= center && time >= editor.visibleRangeBeginning) {
		app.playFollowOffset = { direction: -1, value: editor.visibleRangeEnd - time };
	}
}

// Slides the visible range so the playhead keeps its armed offset. Hitting a chart bound
// disables following for the rest of the playback run.
function applyPlayFollowOffset(app, editor, time, span) {
	const follow = app.playFollowOffset;
	if (!follow || typeof follow !== "object") {
		return;
	}
	const bounds = app.timeBounds();
	const requested = follow.direction > 0 ? time - follow.value : time + follow.value - span;
	const beginning = Math.max(bounds[0], Math.min(bounds[1] - span, requested));
	editor.visibleRangeBeginning = beginning;
	editor.visibleRangeEnd = beginning + span;
	if (Math.abs(beginning - requested) > 1e-8) {
		app.playFollowOffset = false;
	}
}

function bindPlaybackClock(app) {
	app.audio.addEventListener("timeupdate", event => {
		if (!app.audio.playing) {
			return;
		}
		const time = event.detail;
		app.model.editor.timeSnapped = false;
		app.model.editor.currentTime = time;
		const editor = app.model.editor;
		const span = editor.visibleRangeEnd - editor.visibleRangeBeginning;
		const center = editor.visibleRangeBeginning + span / 2;
		if (!editor.lockVisibleRange) {
			armPlayFollowOffset(app, editor, time, center);
			applyPlayFollowOffset(app, editor, time, span);
		}
		app._scheduleHits(time);
		app.lastPlaybackTime = time;
		app.refreshPlaybackFrame();
	});
}

function bindPlaybackStart(app) {
	app.audio.addEventListener("play", () => {
		app.playbackScheduleInvalidated = false;
		app._rebuildRenderIndex();
		app._syncAudioLoop();
		const time = app.currentSeconds();
		const editor = app.model.editor;
		app.playFollowOffset = initialPlayFollowOffset(editor, app.audio.direction, time);
		app.lastPlaybackTime = time;
		app.playbackOrigin ||= {
			time,
			editorTime: deepClone(editor.currentTime),
			timeSnapped: editor.timeSnapped,
			visibleRangeBeginning: editor.visibleRangeBeginning,
			visibleRangeEnd: editor.visibleRangeEnd,
		};
		app.playbackOrigin.scheduleStartTime = time;
		clearScheduledSounds(app);
		excludeHitsBeforePlaybackOrigin(app, time);
		app.audio.armPlaybackSource();
		app._scheduleHits(time, 0);
		app._syncCheckedCommands();
		app._refreshDifficultyUi();
		app.refreshPlaybackFrame();
	});
}

// A loop jump can throw the playhead out of the visible range; when it does, and the
// playhead was inside the range before the jump, the range moves along with it.
function followLoopJump(app, time) {
	const editor = app.model.editor;
	const insideBefore =
		Number.isFinite(app.lastPlaybackTime) &&
		app.lastPlaybackTime >= editor.visibleRangeBeginning &&
		app.lastPlaybackTime <= editor.visibleRangeEnd;
	const outsideAfter = time < editor.visibleRangeBeginning || time > editor.visibleRangeEnd;
	if (editor.lockVisibleRange || !Number.isFinite(time) || !insideBefore || !outsideAfter) {
		return;
	}
	const span = editor.visibleRangeEnd - editor.visibleRangeBeginning;
	const before = time < editor.visibleRangeBeginning;
	app.setVisibleRange(time - (before ? 0 : span), before ? time + span : time);
}

function bindPlaybackJumps(app) {
	app.audio.addEventListener("directionchange", () => {
		app.stage.cancelScheduledHits();
		app.playFollowOffset = null;
		clearScheduledSounds(app);
		app._scheduleHits(app.audio.currentTime, 0);
		app._syncCheckedCommands?.();
		app._refreshDifficultyUi?.();
		app.refreshInteractionPreview?.({ rebuildIndex: false });
	});
	app.audio.addEventListener("loop", event => {
		app.audio.cancelScheduledHitSounds();
		app.stage.cancelScheduledHits();
		clearScheduledSounds(app);
		const time = Number(event.detail?.time);
		followLoopJump(app, time);
		if (!app.playbackOrigin || !Number.isFinite(time)) {
			return;
		}
		app.playbackOrigin.scheduleStartTime = time;
		excludeHitsBeforePlaybackOrigin(app, time);
		app._scheduleHits(time, 0);
	});
	app.audio.addEventListener("seek", () => {
		if (app.audio.playing) {
			app.stage.cancelScheduledHits();
		}
		clearScheduledSounds(app);
		if (!app.audio.playing) {
			return;
		}
		// Re-arm follow after mid-playback seeks (e.g. Home): wait for mid-range again.
		app.playFollowOffset = app.model.editor.lockVisibleRange ? false : null;
		if (app.playbackOrigin) {
			const time = app.audio.currentTime;
			app.playbackOrigin.scheduleStartTime = time;
			excludeHitsBeforePlaybackOrigin(app, time);
			app._scheduleHits(time, 0);
		}
	});
	app.audio.addEventListener("ratechange", () => {
		app.stage.cancelScheduledHits();
		clearScheduledSounds(app);
	});
}

// Where the playhead lands when playback stops: mid-seek resumes keep the raw audio time,
// "seek back after playing" restores the recorded origin, everything else snaps.
function restoreTimeAfterPlayback(app) {
	const editor = app.model.editor;
	if (app.resumePlaybackAfterSeek) {
		editor.timeSnapped = false;
		editor.currentTime = app.audio.currentTime;
		return;
	}
	if (editor.seekBackAfterPlaying && app.playbackOrigin) {
		editor.timeSnapped = app.playbackOrigin.timeSnapped;
		editor.currentTime = deepClone(app.playbackOrigin.editorTime);
		if (!editor.lockVisibleRange) {
			editor.visibleRangeBeginning = app.playbackOrigin.visibleRangeBeginning;
			editor.visibleRangeEnd = app.playbackOrigin.visibleRangeEnd;
		}
		return;
	}
	const snapped = app.timing().secondsToSnappedBeat(app.audio.currentTime, editor.subdivision);
	editor.timeSnapped = true;
	editor.currentTime = snapped.toJSON();
}

function bindPlaybackStop(app) {
	const finish = () => {
		app.playbackScheduleInvalidated = false;
		if (typeof app.stage.clearHitEffects === "function") {
			app.stage.clearHitEffects();
		} else {
			app.stage.cancelScheduledHits();
		}
		restoreTimeAfterPlayback(app);
		app.playFollowOffset = null;
		app.lastPlaybackTime = null;
		if (!app.resumePlaybackAfterSeek) {
			app.playbackOrigin = null;
		}
		clearScheduledSounds(app);
		app._syncCheckedCommands?.();
		app._refreshDifficultyUi?.();
		app.refreshInteractionPreview?.({ rebuildIndex: false });
	};
	app.audio.addEventListener("pause", finish);
	app.audio.addEventListener("ended", finish);
}

// Prefers absolute audio-clock scheduling when the player exposes a usable clock,
// falling back to a relative delay otherwise.
function playHitSound(app, type, delay, hitTime) {
	const audioTime = hitAudioTime(app.audio, delay, hitTime);
	if (audioTime != null) {
		void app.audio.playHitAt(type, audioTime);
	} else {
		void app.audio.playHit(type, delay);
	}
}

function scheduleBgNoteSounds(app, current, lateTolerance) {
	for (const { event, delay, hitTime } of collectAppBgNoteSchedules(app, current, lateTolerance)) {
		app.scheduledBgNoteIds?.add(event.id);
		playHitSound(app, "bgNote", delay, hitTime);
	}
}

function scheduleMetronome(app, current, loopRange) {
	const metronomes = collectMetronomeSchedule(
		app.timing(),
		current,
		app.audio.rate,
		app.audio.direction,
		app.scheduledMetronomeBeats,
		undefined,
		loopRange,
	);
	for (const item of metronomes) {
		app.scheduledMetronomeBeats.add(item.beat);
		void app.audio.playMetronome(item.delay);
	}
}

export const withPlaybackTransport = Base =>
	class extends Base {
		_bindAudio() {
			bindPlaybackClock(this);
			bindPlaybackStart(this);
			bindPlaybackJumps(this);
			bindPlaybackStop(this);
		}

		_syncAudioLoop() {
			const marks = Array.isArray(this.model.editor.abLoopMarks) ? this.model.editor.abLoopMarks : [];
			if (marks.length !== 2) {
				this.audio.setLoopRange(null);
				return;
			}
			const seconds = marks.map(mark => this.timing().beatToSeconds(mark));
			this.audio.setLoopRange(seconds.sort((left, right) => left - right));
		}

		_invalidatePlaybackSchedule() {
			if (!this.audio.playing) {
				return;
			}
			this.audio.cancelScheduledHitSounds();
			this.stage.cancelScheduledHits();
			this.scheduledHitIds.clear();
			this.scheduledBgNoteIds?.clear();
			this.scheduledHoldReleaseIds.clear();
			this.playbackScheduleInvalidated = true;
		}

		_flushInvalidatedPlaybackSchedule() {
			if (!this.playbackScheduleInvalidated || !this.audio?.playing) {
				return;
			}
			this.playbackScheduleInvalidated = false;
			this._scheduleHits(this.audio.currentTime, 0);
		}

		refreshPlaybackFrame() {
			const view = this.viewState();
			this.timeline.setState(view);
			this.stage.setState(view);
			// The scroll view is a secondary overview; updating it every other frame keeps
			// the playhead visible while leaving the main field and timeline at full rate.
			this.scrollView.setState(view, { render: (this.playbackFrameCount || 0) % 2 === 0 });
			this._updatePlaybackStatus?.();
			this.playbackFrameCount = (this.playbackFrameCount || 0) + 1;
		}

		_scheduleHits(current, lateTolerance = 0.02) {
			if (this.playbackScheduleInvalidated && lateTolerance !== 0) {
				return;
			}
			const { reverse, schedule, releases, loopRange } = collectAppHitSchedules(this, current, lateTolerance);
			const playbackEditor = this.model?.editor || {};
			for (const { event, delay, hitTime } of schedule) {
				this.scheduledHitIds.add(event.id);
				if (playbackEditor.playSe !== false) {
					playHitSound(this, event.type, delay, hitTime);
				}
				if (!reverse) {
					this.stage.triggerHit(event, delay);
				}
			}
			for (const { event, delay } of releases) {
				this.scheduledHoldReleaseIds.add(event.id);
				this.stage.triggerHit(event, delay);
			}
			if (playbackEditor.playBgNoteSe) {
				scheduleBgNoteSounds(this, current, lateTolerance);
			}
			if (playbackEditor.metronome && this.scheduledMetronomeBeats) {
				scheduleMetronome(this, current, loopRange);
			}
		}
	};
