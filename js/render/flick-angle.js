const TAU = Math.PI * 2;

function wrapAngleDelta(value) {
	return ((value + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

/**
 * Calculate the angles resulting from dragging one selected Flick handle.
 * A multi-selection moves by one quantized delta so its angle differences stay
 * unchanged, while a single Flick follows an absolute pi/4 snap grid.
 */
export function flickAngleChanges(flicks, primaryId, pointerAngle) {
	const items = (flicks || []).filter(item => item?.id != null);
	const primary = items.find(item => item.id === primaryId) || items[0];
	if (!primary || !Number.isFinite(Number(pointerAngle))) return new Map();
	const step = Math.PI / 4;
	if (items.length === 1) {
		return new Map([[primary.id, Math.round(Number(pointerAngle) / step) * step]]);
	}
	const initial = Number(primary.angle) || 0;
	const delta = Math.round(wrapAngleDelta(Number(pointerAngle) - initial) / step) * step;
	return new Map(items.map(item => [item.id, (Number(item.angle) || 0) + delta]));
}
