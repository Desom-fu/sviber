import {
	collectHitSchedule,
	collectHoldReleaseSchedule,
	collectIndexedHitSchedule,
	collectIndexedHoldReleaseSchedule,
	collectIndexedReverseHitSchedule,
	collectReverseHitSchedule,
} from "../audio/scheduler.js";

export function playbackLoopCycle(audio, now = audio?.context?.currentTime) {
	const loop = audio?.loopRange;
	if (!Array.isArray(loop) || loop.length !== 2 || !(loop[1] > loop[0])) {
		return 0;
	}
	const startedAt = Number(audio?.startedAt);
	const startedPosition = Number(audio?.startedPosition);
	const clock = Number(now);
	const rate = Math.max(0.1, Number(audio?.rate) || 1);
	if (!Number.isFinite(startedAt) || !Number.isFinite(startedPosition) || !Number.isFinite(clock)) {
		return 0;
	}
	const elapsed = Math.max(0, clock - startedAt) * rate;
	const direction = audio?.direction < 0 ? -1 : 1;
	const raw = startedPosition + elapsed * direction;
	const span = loop[1] - loop[0];
	if (direction >= 0) {
		if (raw < loop[1]) {
			return 0;
		}
		return Math.floor((raw - loop[0]) / span);
	}
	if (raw >= loop[0]) {
		return 0;
	}
	return Math.ceil((loop[0] - raw) / span);
}

function loopCycleOffset(audio, now, rate) {
	const cycle = playbackLoopCycle(audio, now);
	if (cycle <= 0) {
		return 0;
	}
	const span = audio?.loopRange?.[1] - audio?.loopRange?.[0];
	if (!Number.isFinite(span) || span <= 0) {
		return 0;
	}
	return (cycle * span) / rate;
}

export function hitAudioTime(audio, delay, chartTime = null) {
	const now = Number(audio?.context?.currentTime);
	if (!Number.isFinite(now)) {
		return null;
	}
	const startedAt = Number(audio?.startedAt);
	const startedPosition = Number(audio?.startedPosition);
	const hitTime = Number(chartTime);
	const rate = Math.max(0.1, Number(audio?.rate) || 1);
	if (audio?.playing && Number.isFinite(startedAt) && Number.isFinite(startedPosition) && Number.isFinite(hitTime)) {
		const direction = audio.direction < 0 ? -1 : 1;
		const mapped = startedAt + ((hitTime - startedPosition) * direction) / rate;
		return mapped + loopCycleOffset(audio, now, rate);
	}
	return now + Math.max(0, Number(delay) || 0);
}

export function playbackLateTolerance(currentTime, requestedTolerance, startTime, direction = 1) {
	const tolerance = Math.max(0, Number(requestedTolerance) || 0);
	const current = Number(currentTime);
	const start = Number(startTime);
	if (!Number.isFinite(current) || !Number.isFinite(start)) {
		return tolerance;
	}
	const elapsed = direction < 0 ? start - current : current - start;
	return Math.min(tolerance, Math.max(0, elapsed));
}

// Same rule as game-unstable Level.adjustProgress: unhit notes are those with
// note.time >= start. Notes before the seek/start epoch stay finished.
export function playbackOriginBound(startTime, direction = 1) {
	const start = Number(startTime);
	if (!Number.isFinite(start)) {
		return direction < 0 ? Infinity : -Infinity;
	}
	return start;
}

export function markHitsBeforePlaybackOrigin(records, scheduledIds, origin, field = "start", direction = 1) {
	const start = Number(origin);
	if (!Number.isFinite(start) || !Array.isArray(records) || !scheduledIds) {
		return scheduledIds;
	}
	for (const record of records) {
		const time = record?.[field];
		if (!Number.isFinite(time) || !record.event) {
			continue;
		}
		if (direction < 0 ? time > start + 1e-8 : time < start - 1e-8) {
			scheduledIds.add(record.event.id);
		}
	}
	return scheduledIds;
}

export function excludeHitsBeforePlaybackOrigin(app, origin = app?.playbackOrigin?.scheduleStartTime) {
	const direction = app?.audio?.direction < 0 ? -1 : 1;
	markHitsBeforePlaybackOrigin(app?.renderIndex?.hitRecords, app?.scheduledHitIds, origin, "start", direction);
	markHitsBeforePlaybackOrigin(
		app?.renderIndex?.bgNoteHitRecords,
		app?.scheduledBgNoteIds,
		origin,
		"start",
		direction,
	);
	if (direction >= 0) {
		markHitsBeforePlaybackOrigin(
			app?.renderIndex?.holdReleaseRecords,
			app?.scheduledHoldReleaseIds,
			origin,
			"releaseTime",
			1,
		);
	}
	return app;
}

export function playbackScheduleBounds(current, lateTolerance, origin, direction = 1) {
	return {
		reverse: direction < 0,
		scheduleTolerance: playbackLateTolerance(current, lateTolerance, origin, direction),
		originBound: playbackOriginBound(origin, direction),
	};
}

export function collectAppHitSchedules(app, current, lateTolerance = 0.02) {
	const { reverse, scheduleTolerance, originBound } = playbackScheduleBounds(
		current,
		lateTolerance,
		app.playbackOrigin?.scheduleStartTime,
		app.audio.direction,
	);
	const loopRange = app.audio.loopRange;
	const loopBoundary = loopRange ? loopRange[reverse ? 0 : 1] : reverse ? -Infinity : Infinity;
	const rate = app.audio.rate;
	const events = app.renderIndex ? null : app.model.allEvents({ includeGroups: false });
	const timing = events ? app.timing() : null;
	const schedule = reverse? app.renderIndex? collectIndexedReverseHitSchedule(
					app.renderIndex.hitRecords,
					current,
					rate,
					app.scheduledHitIds,
					undefined,
					scheduleTolerance,
					loopBoundary,
					originBound,
				): collectReverseHitSchedule(
					events,
					timing,
					current,
					rate,
					app.scheduledHitIds,
					undefined,
					scheduleTolerance,
					loopBoundary,
					originBound,
				): app.renderIndex? collectIndexedHitSchedule(
					app.renderIndex.hitRecords,
					current,
					rate,
					app.scheduledHitIds,
					undefined,
					scheduleTolerance,
					loopBoundary,
					originBound,
				): collectHitSchedule(
					events,
					timing,
					current,
					rate,
					app.scheduledHitIds,
					undefined,
					scheduleTolerance,
					loopBoundary,
					originBound,
				);
	const releases = reverse? []: app.renderIndex? collectIndexedHoldReleaseSchedule(
					app.renderIndex.holdReleaseRecords,
					current,
					rate,
					app.scheduledHoldReleaseIds,
					undefined,
					scheduleTolerance,
					loopBoundary,
					originBound,
				): collectHoldReleaseSchedule(
					events,
					timing,
					current,
					rate,
					app.scheduledHoldReleaseIds,
					undefined,
					scheduleTolerance,
					loopBoundary,
					originBound,
				);
	return { reverse, schedule, releases, loopRange };
}

// Bg note SE is toggled independently of note SE, so it needs its own scheduled-id
// bookkeeping instead of sharing the note hit schedule.
export function collectAppBgNoteSchedules(app, current, lateTolerance = 0.02) {
	const records = app.renderIndex?.bgNoteHitRecords;
	if (!records?.length) {
		return [];
	}
	const { reverse, scheduleTolerance, originBound } = playbackScheduleBounds(
		current,
		lateTolerance,
		app.playbackOrigin?.scheduleStartTime,
		app.audio.direction,
	);
	const loopRange = app.audio.loopRange;
	const loopBoundary = loopRange ? loopRange[reverse ? 0 : 1] : reverse ? -Infinity : Infinity;
	const rate = app.audio.rate;
	if (reverse) {
		return collectIndexedReverseHitSchedule(
			records,
			current,
			rate,
			app.scheduledBgNoteIds,
			undefined,
			scheduleTolerance,
			loopBoundary,
			originBound,
		);
	}
	return collectIndexedHitSchedule(
		records,
		current,
		rate,
		app.scheduledBgNoteIds,
		undefined,
		scheduleTolerance,
		loopBoundary,
		originBound,
	);
}
