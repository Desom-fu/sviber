export function hitAudioTime(audio, delay) {
	const now = Number(audio?.context?.currentTime);
	return Number.isFinite(now) ? now + Math.max(0, Number(delay) || 0) : null;
}
