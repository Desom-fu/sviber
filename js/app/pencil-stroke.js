// Pencil mode (PROMPT-v27): one freehand stroke becomes a pen curve.
// Raw samples come from pointer getCoalescedEvents(); @stroke-stabilizer/core
// turns them into the broken line. Snapping the start or the end adds one extra
// control point at the snap, before or after the stroke. Snapping the end to the
// start of the stroke closes the loop.

import { StabilizedPointer, oneEuroFilter } from "../../node_modules/@stroke-stabilizer/core/dist/index.js";

export const PENCIL_SNAP_DISTANCE = 6.25;

export function coalescedChartPoints(event, toLocal, toChart) {
	const native = typeof event?.getCoalescedEvents === "function" ? event.getCoalescedEvents() : null;
	const events = native && native.length ? native : [event];
	return events.map(item => {
		const chart = toChart(toLocal(item));
		return {
			x: chart.x,
			y: chart.y,
			pressure: item.pressure,
			timestamp: item.timeStamp,
		};
	});
}

function finitePoint(point) {
	const x = Number(point?.x);
	const y = Number(point?.y);
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		return null;
	}
	return { x, y };
}

function nearlySame(left, right, epsilon = 1e-4) {
	return Math.hypot(left.x - right.x, left.y - right.y) <= epsilon;
}

function dedupePoints(points) {
	const result = [];
	for (const point of points) {
		const normalized = finitePoint(point);
		if (!normalized) {
			continue;
		}
		if (result.length && nearlySame(result.at(-1), normalized, 0.05)) {
			continue;
		}
		result.push(normalized);
	}
	return result;
}

export function stabilizePencilPoints(rawPoints) {
	const samples = (rawPoints || []).map(finitePoint).filter(Boolean);
	if (!samples.length) {
		return [];
	}
	const pointer = new StabilizedPointer().addFilter(oneEuroFilter({ minCutoff: 1, beta: 0.007 }));
	let time = 0;
	for (const sample of rawPoints) {
		const point = finitePoint(sample);
		if (!point) {
			continue;
		}
		const timestamp = Number(sample.timestamp);
		time = Number.isFinite(timestamp) && timestamp > time ? timestamp : time + 16;
		pointer.process({
			x: point.x,
			y: point.y,
			pressure: Number.isFinite(Number(sample.pressure)) ? Number(sample.pressure) : 0.5,
			timestamp: time,
		});
	}
	const finished = pointer.finish() || [];
	const smoothed = dedupePoints(finished);
	return smoothed.length ? smoothed : dedupePoints(samples);
}

export function buildPencilStroke(
	rawPoints,
	{ startSnap = null, endSnap = null, snapDistance = PENCIL_SNAP_DISTANCE } = {},
) {
	const samples = (rawPoints || []).map(finitePoint).filter(Boolean);
	if (!samples.length) {
		return null;
	}
	const points = stabilizePencilPoints(rawPoints);
	if (!points.length) {
		return null;
	}
	const start = finitePoint(startSnap);
	if (start && !nearlySame(start, points[0])) {
		points.unshift(start);
	}
	const end = samples.at(-1);
	const origin = points[0];
	let target = null;
	let closes = false;
	if (points.length >= 2 && Math.hypot(end.x - origin.x, end.y - origin.y) <= snapDistance) {
		target = origin;
		closes = true;
	}
	const snap = finitePoint(endSnap);
	if (snap && Math.hypot(end.x - snap.x, end.y - snap.y) <= snapDistance) {
		const snapDistanceToEnd = Math.hypot(end.x - snap.x, end.y - snap.y);
		const chosenDistance = target ? Math.hypot(end.x - target.x, end.y - target.y) : Infinity;
		if (snapDistanceToEnd < chosenDistance) {
			target = snap;
			closes = Math.hypot(snap.x - origin.x, snap.y - origin.y) <= 1e-4;
		}
	}
	if (target && !nearlySame(target, points.at(-1))) {
		points.push({ x: target.x, y: target.y });
	}
	if (points.length < 2) {
		return null;
	}
	return {
		points,
		closed: closes,
		segments: Math.max(1, points.length - 1),
		commands: points.map((point, index) => ({
			type: index === 0 ? "M" : "L",
			x: point.x,
			y: point.y,
		})),
	};
}
