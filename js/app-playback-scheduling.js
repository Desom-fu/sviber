import {
	collectHitSchedule,
	collectHoldReleaseSchedule,
	collectIndexedHitSchedule,
	collectIndexedHoldReleaseSchedule,
	collectIndexedReverseHitSchedule,
	collectReverseHitSchedule,
} from "./audio/scheduler.js";

export function hitAudioTime(audio, delay) {
	const now = Number(audio?.context?.currentTime);
	return Number.isFinite(now) ? now + Math.max(0, Number(delay) || 0) : null;
}

export function playbackLateTolerance(currentTime, requestedTolerance, startTime, direction = 1) {
	const tolerance = Math.max(0, Number(requestedTolerance) || 0);
	const current = Number(currentTime);
	const start = Number(startTime);
	if (!Number.isFinite(current) || !Number.isFinite(start)) return tolerance;
	const elapsed = direction < 0 ? start - current : current - start;
	return Math.min(tolerance, Math.max(0, elapsed));
}

// Same rule as game-unstable Level.adjustProgress: unhit notes are those with
// note.time >= start. Notes before the seek/start epoch stay finished.
export function playbackOriginBound(startTime, direction = 1) {
	const start = Number(startTime);
	if (!Number.isFinite(start)) return direction < 0 ? Infinity : -Infinity;
	return start;
}

export function markHitsBeforePlaybackOrigin(records, scheduledIds, origin, field = "start", direction = 1) {
	const start = Number(origin);
	if (!Number.isFinite(start) || !Array.isArray(records) || !scheduledIds) return scheduledIds;
	for (const record of records) {
		const time = record?.[field];
		if (!Number.isFinite(time) || !record.event) continue;
		if (direction < 0 ? time > start + 1e-8 : time < start - 1e-8) scheduledIds.add(record.event.id);
	}
	return scheduledIds;
}

export function excludeHitsBeforePlaybackOrigin(app, origin = app?.playbackOrigin?.scheduleStartTime) {
	const direction = app?.audio?.direction < 0 ? -1 : 1;
	markHitsBeforePlaybackOrigin(app?.renderIndex?.hitRecords, app?.scheduledHitIds, origin, "start", direction);
	if (direction >= 0) {
		markHitsBeforePlaybackOrigin(app?.renderIndex?.holdReleaseRecords, app?.scheduledHoldReleaseIds, origin, "releaseTime", 1);
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
		current, lateTolerance, app.playbackOrigin?.scheduleStartTime, app.audio.direction);
	const loopRange = app.audio.loopRange;
	const loopBoundary = loopRange ? loopRange[reverse ? 0 : 1] : reverse ? -Infinity : Infinity;
	const rate = app.audio.rate;
	const events = app.renderIndex ? null : app.model.allEvents({ includeGroups: false });
	const timing = events ? app.timing() : null;
	const schedule = reverse
		? app.renderIndex
			? collectIndexedReverseHitSchedule(app.renderIndex.hitRecords, current, rate,
				app.scheduledHitIds, undefined, scheduleTolerance, loopBoundary, originBound)
			: collectReverseHitSchedule(events, timing, current, rate,
				app.scheduledHitIds, undefined, scheduleTolerance, loopBoundary, originBound)
		: app.renderIndex
			? collectIndexedHitSchedule(app.renderIndex.hitRecords, current, rate,
				app.scheduledHitIds, undefined, scheduleTolerance, loopBoundary, originBound)
			: collectHitSchedule(events, timing, current, rate,
				app.scheduledHitIds, undefined, scheduleTolerance, loopBoundary, originBound);
	const releases = reverse ? [] : app.renderIndex
		? collectIndexedHoldReleaseSchedule(app.renderIndex.holdReleaseRecords,
			current, rate, app.scheduledHoldReleaseIds, undefined, scheduleTolerance, loopBoundary, originBound)
		: collectHoldReleaseSchedule(events, timing, current,
			rate, app.scheduledHoldReleaseIds, undefined, scheduleTolerance, loopBoundary, originBound);
	return { reverse, schedule, releases, loopRange };
}
