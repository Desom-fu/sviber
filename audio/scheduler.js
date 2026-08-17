export const HIT_LOOKAHEAD_SECONDS = 0.1;
export const HIT_SOUND_TYPES = Object.freeze(new Set(["tap", "hold", "drag", "flick"]));

export function collectHitSchedule(events, timing, currentTime, playbackRate, scheduledIds, lookAhead = HIT_LOOKAHEAD_SECONDS) {
	const rate = Math.max(0.1, Number(playbackRate) || 1);
	const horizon = currentTime + Math.max(0, lookAhead) * rate;
	const result = [];
	for (const event of events) {
		if (!HIT_SOUND_TYPES.has(event.type) || scheduledIds.has(event.id)) continue;
		const hitTime = timing.beatToSeconds(event.time);
		if (hitTime < currentTime - 0.02 || hitTime > horizon + 1e-8) continue;
		result.push({ event, delay: Math.max(0, (hitTime - currentTime) / rate), hitTime });
	}
	return result.sort((left, right) => left.hitTime - right.hitTime || left.event.id - right.event.id);
}

export function collectHoldReleaseSchedule(events, timing, currentTime, playbackRate, scheduledIds, lookAhead = HIT_LOOKAHEAD_SECONDS) {
	const rate = Math.max(0.1, Number(playbackRate) || 1);
	const horizon = currentTime + Math.max(0, lookAhead) * rate;
	const result = [];
	for (const event of events) {
		if (event.type !== "hold" || scheduledIds.has(event.id)) continue;
		const releaseTime = timing.beatToSeconds(event.time) + timing.durationToSeconds(event.time, event.duration);
		if (releaseTime < currentTime - 0.02 || releaseTime > horizon + 1e-8) continue;
		result.push({ event, delay: Math.max(0, (releaseTime - currentTime) / rate), releaseTime });
	}
	return result.sort((left, right) => left.releaseTime - right.releaseTime || left.event.id - right.event.id);
}
