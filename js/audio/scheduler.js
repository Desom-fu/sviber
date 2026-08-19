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

function collectIndexedSchedule(records, field, outputField, currentTime, playbackRate, scheduledIds,
	lookAhead, lateTolerance, maximumTime = Infinity) {
	const rate = Math.max(0.1, Number(playbackRate) || 1);
	const horizon = currentTime + Math.max(0, lookAhead) * rate;
	const result = [];
	const minimum = currentTime - Math.max(0, Number(lateTolerance) || 0);
	for (let index = lowerBound(records, minimum, field); index < records.length; index += 1) {
		const record = records[index];
		const scheduledTime = record[field];
		if (scheduledTime > horizon + 1e-8) break;
		if (scheduledTime >= maximumTime - 1e-8) break;
		if (scheduledIds.has(record.event.id)) continue;
		result.push({
			event: record.event,
			delay: Math.max(0, (scheduledTime - currentTime) / rate),
			[outputField]: scheduledTime,
		});
	}
	return result;
}

export function collectHitSchedule(events, timing, currentTime, playbackRate, scheduledIds,
	lookAhead = HIT_LOOKAHEAD_SECONDS, lateTolerance = 0.02, maximumTime = Infinity) {
	const rate = Math.max(0.1, Number(playbackRate) || 1);
	const horizon = currentTime + Math.max(0, lookAhead) * rate;
	const result = [];
	for (const event of events) {
		if (!HIT_SOUND_TYPES.has(event.type) || scheduledIds.has(event.id)) continue;
		const hitTime = timing.beatToSeconds(event.time);
		if (hitTime < currentTime - Math.max(0, Number(lateTolerance) || 0)
			|| hitTime > horizon + 1e-8 || hitTime >= maximumTime - 1e-8) continue;
		result.push({ event, delay: Math.max(0, (hitTime - currentTime) / rate), hitTime });
	}
	return result.sort((left, right) => left.hitTime - right.hitTime || left.event.id - right.event.id);
}

export function collectHoldReleaseSchedule(events, timing, currentTime, playbackRate, scheduledIds,
	lookAhead = HIT_LOOKAHEAD_SECONDS, lateTolerance = 0.02, maximumTime = Infinity) {
	const rate = Math.max(0.1, Number(playbackRate) || 1);
	const horizon = currentTime + Math.max(0, lookAhead) * rate;
	const result = [];
	for (const event of events) {
		if (event.type !== "hold" || scheduledIds.has(event.id)) continue;
		const releaseTime = timing.beatToSeconds(event.time) + timing.durationToSeconds(event.time, event.duration);
		if (releaseTime < currentTime - Math.max(0, Number(lateTolerance) || 0)
			|| releaseTime > horizon + 1e-8 || releaseTime >= maximumTime - 1e-8) continue;
		result.push({ event, delay: Math.max(0, (releaseTime - currentTime) / rate), releaseTime });
	}
	return result.sort((left, right) => left.releaseTime - right.releaseTime || left.event.id - right.event.id);
}

export function collectIndexedHitSchedule(records, currentTime, playbackRate, scheduledIds,
	lookAhead = HIT_LOOKAHEAD_SECONDS, lateTolerance = 0.02, maximumTime = Infinity) {
	return collectIndexedSchedule(records, "start", "hitTime", currentTime, playbackRate,
		scheduledIds, lookAhead, lateTolerance, maximumTime);
}

export function collectIndexedHoldReleaseSchedule(records, currentTime, playbackRate, scheduledIds,
	lookAhead = HIT_LOOKAHEAD_SECONDS, lateTolerance = 0.02, maximumTime = Infinity) {
	return collectIndexedSchedule(records, "releaseTime", "releaseTime", currentTime, playbackRate,
		scheduledIds, lookAhead, lateTolerance, maximumTime);
}

function collectReverseRecords(records, field, currentTime, playbackRate, scheduledIds,
	lookAhead = HIT_LOOKAHEAD_SECONDS, lateTolerance = 0.02, minimumTime = -Infinity) {
	const rate = Math.max(0.1, Number(playbackRate) || 1);
	const horizon = currentTime - Math.max(0, lookAhead) * rate;
	const maximum = currentTime + Math.max(0, Number(lateTolerance) || 0);
	const result = [];
	for (let index = lowerBound(records, horizon, field); index < records.length; index += 1) {
		const record = records[index];
		const hitTime = record[field];
		if (hitTime > maximum + 1e-8) break;
		if (hitTime <= minimumTime + 1e-8) continue;
		if (scheduledIds.has(record.event.id)) continue;
		result.push({ event: record.event, delay: Math.max(0, (currentTime - hitTime) / rate), hitTime });
	}
	return result.sort((left, right) => right.hitTime - left.hitTime || left.event.id - right.event.id);
}

export function collectReverseHitSchedule(events, timing, currentTime, playbackRate, scheduledIds,
	lookAhead = HIT_LOOKAHEAD_SECONDS, lateTolerance = 0.02, minimumTime = -Infinity) {
	const records = events
		.filter(event => HIT_SOUND_TYPES.has(event.type))
		.map(event => ({ event, start: timing.beatToSeconds(event.time) }))
		.sort((left, right) => left.start - right.start || left.event.id - right.event.id);
	return collectReverseRecords(records, "start", currentTime, playbackRate, scheduledIds,
		lookAhead, lateTolerance, minimumTime);
}

export function collectIndexedReverseHitSchedule(records, currentTime, playbackRate, scheduledIds,
	lookAhead = HIT_LOOKAHEAD_SECONDS, lateTolerance = 0.02, minimumTime = -Infinity) {
	return collectReverseRecords(records, "start", currentTime, playbackRate, scheduledIds,
		lookAhead, lateTolerance, minimumTime);
}

export function collectMetronomeSchedule(timing, currentTime, playbackRate, direction, scheduledBeats,
	lookAhead = HIT_LOOKAHEAD_SECONDS, loopRange = null) {
	const rate = Math.max(0.1, Number(playbackRate) || 1);
	const forward = direction >= 0;
	const endingTime = currentTime + (forward ? 1 : -1) * Math.max(0, lookAhead) * rate;
	const currentBeat = timing.secondsToBeat(currentTime).toNumber();
	const endingBeat = timing.secondsToBeat(endingTime).toNumber();
	const first = forward ? Math.ceil(currentBeat - 1e-8) : Math.floor(currentBeat + 1e-8);
	const last = forward ? Math.floor(endingBeat + 1e-8) : Math.ceil(endingBeat - 1e-8);
	const result = [];
	for (let beat = first; forward ? beat <= last : beat >= last; beat += forward ? 1 : -1) {
		if (scheduledBeats.has(beat)) continue;
		const time = timing.beatToSeconds(beat);
		if (Array.isArray(loopRange) && loopRange.length === 2
			&& (forward ? time >= loopRange[1] - 1e-8 : time <= loopRange[0] + 1e-8)) continue;
		const distance = forward ? time - currentTime : currentTime - time;
		if (distance < -0.02 || distance > Math.max(0, lookAhead) * rate + 1e-8) continue;
		result.push({ beat, time, delay: Math.max(0, distance / rate), accent: false });
	}
	return result;
}
