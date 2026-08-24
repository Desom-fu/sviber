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
