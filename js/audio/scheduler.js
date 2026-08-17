export const HIT_LOOKAHEAD_SECONDS = 0.1;
export const HIT_SOUND_TYPES = Object.freeze(new Set(["tap", "hold", "drag", "flick"]));

function lowerBound(records, value, field) {
	let low = 0;
	let high = records.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (records[middle][field] < value) low = middle + 1;
		else high = middle;
	}
	return low;
}

function collectIndexedSchedule(records, field, outputField, currentTime, playbackRate, scheduledIds, lookAhead) {
	const rate = Math.max(0.1, Number(playbackRate) || 1);
	const horizon = currentTime + Math.max(0, lookAhead) * rate;
	const result = [];
	for (let index = lowerBound(records, currentTime - 0.02, field); index < records.length; index += 1) {
		const record = records[index];
		const scheduledTime = record[field];
		if (scheduledTime > horizon + 1e-8) break;
		if (scheduledIds.has(record.event.id)) continue;
		result.push({
			event: record.event,
			delay: Math.max(0, (scheduledTime - currentTime) / rate),
			[outputField]: scheduledTime,
		});
	}
	return result;
}

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

export function collectIndexedHitSchedule(records, currentTime, playbackRate, scheduledIds, lookAhead = HIT_LOOKAHEAD_SECONDS) {
	return collectIndexedSchedule(records, "start", "hitTime", currentTime, playbackRate, scheduledIds, lookAhead);
}

export function collectIndexedHoldReleaseSchedule(records, currentTime, playbackRate, scheduledIds, lookAhead = HIT_LOOKAHEAD_SECONDS) {
	return collectIndexedSchedule(records, "releaseTime", "releaseTime", currentTime, playbackRate, scheduledIds, lookAhead);
}
