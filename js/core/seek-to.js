// Visible-range follow rule for Seek to... (PROMPT-v26): if the current time is inside
// the visible range, shift the range so the playhead does not move on screen.

export function visibleRangeAfterSeek(editor, newSeconds) {
	const beginning = Number(editor?.visibleRangeBeginning) || 0;
	const ending = Number(editor?.visibleRangeEnd);
	const end = Number.isFinite(ending) ? ending : beginning + 10;
	const current = Number(editor?.currentSeconds);
	const target = Number(newSeconds);
	if (!Number.isFinite(target)) {
		return { beginning, ending: end };
	}
	if (!Number.isFinite(current) || current < beginning || current > end) {
		return { beginning, ending: end };
	}
	const span = Math.max(1e-9, end - beginning);
	const ratio = (current - beginning) / span;
	return {
		beginning: target - ratio * span,
		ending: target + (1 - ratio) * span,
	};
}
