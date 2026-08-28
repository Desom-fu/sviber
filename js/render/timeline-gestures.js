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

// v18: how close (in pixels) the press has to be to an existing A-B loop mark for the
// gesture to grab that mark instead of starting a new pair.
export const AB_LOOP_GRAB_DISTANCE = 6;

// Picks the A-B loop mark the press grabs, or null when the press is not close to one.
// `marks` are the existing marks in seconds, `x` the press position and `toX` maps
// seconds to the same pixel space.
export function abLoopGrabIndex(marks, x, toX, tolerance = AB_LOOP_GRAB_DISTANCE) {
	let best = null;
	for (let index = 0; index < marks.length; index += 1) {
		const distance = Math.abs(toX(marks[index]) - x);
		if (distance <= tolerance && (!best || distance < best.distance)) {
			best = { index, distance };
		}
	}
	return best ? best.index : null;
}

// v18 Shift-drag on the waveform. `anchor` is the mark that stays put — the one the mouse
// down created, or the mark that was not grabbed — and `moving` is the mark that follows the
// pointer. While the pointer has not reached another subdivision there is only one mark; the
// second appears as soon as it does, and the two collapse back to one whenever they land on
// the same subdivision. `anchor` is null when the gesture grabbed the only existing mark.
export function abLoopDragMarks(anchor, moving) {
	if (!anchor) {
		return moving ? [moving.toJSON()] : [];
	}
	if (!moving || anchor.equals(moving)) {
		return [anchor.toJSON()];
	}
	return abLoopMarks(anchor, moving);
}
