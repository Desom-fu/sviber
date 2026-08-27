// Timeline gestures introduced in v17: unsnapped waveform seeking, A-B loop
// dragging, offset adjustment and the auto-chase behaviour that shifts the visible
// range (and the channel lanes) when a drag leaves the visible area.

export const CHASE_MARGIN = 12;
export const CHASE_SPEED = 0.55;

// Fraction of the visible span that the range should move by, based on how far the
// pointer went past the edge. Returns 0 when the pointer is still inside.
export function chaseFraction(x, width, margin = CHASE_MARGIN) {
	if (!(width > 0)) {
		return 0;
	}
	if (x < margin) {
		return -Math.min(1, (margin - x) / Math.max(1, width * 0.25));
	}
	if (x > width - margin) {
		return Math.min(1, (x - (width - margin)) / Math.max(1, width * 0.25));
	}
	return 0;
}

export function chaseChannelDelta(y, top, height) {
	if (!(height > 0)) {
		return 0;
	}
	if (y < top) {
		return -1;
	}
	if (y > top + height) {
		return 1;
	}
	return 0;
}

// Offset adjustment: dragging the waveform moves every beat line by the same amount,
// which is exactly a change of the chart offset.
export function offsetFromDrag(startOffset, startSeconds, seconds) {
	return startOffset + (seconds - startSeconds);
}

// Ctrl-dragging in offset adjustment mode stretches the beat grid: the beat line
// closest to where the drag started should end up under the pointer, which fixes the
// BPM of the segment that the line belongs to.
export function bpmFromDrag(anchorSeconds, beatDistance, currentBpm, seconds) {
	if (!(beatDistance > 0)) {
		return currentBpm;
	}
	const span = seconds - anchorSeconds;
	if (!(span > 1e-6)) {
		return currentBpm;
	}
	return Math.max(1, Math.min(1000, (60 * beatDistance) / span));
}

export function abLoopMarks(firstBeat, secondBeat) {
	if (!firstBeat) {
		return [];
	}
	if (!secondBeat || firstBeat.equals(secondBeat)) {
		return [firstBeat.toJSON()];
	}
	const ordered = firstBeat.compare(secondBeat) <= 0 ? [firstBeat, secondBeat] : [secondBeat, firstBeat];
	return ordered.map(mark => mark.toJSON());
}
