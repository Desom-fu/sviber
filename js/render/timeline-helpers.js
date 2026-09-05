import { TimingMap } from "../core/timing.js";

const TIMELINE_NOTE_TYPES = new Set(["tap", "hold", "flick"]);

export const BEAT_LINE_COLORS = Object.freeze({
	1: "#ff2e59",
	2: "#3086ff",
	3: "#50a226",
	4: "#ff9d3d",
	8: "#d567ff",
	other: "#00e0ad",
});

export const TIMELINE_EVENT_COLORS = Object.freeze({
	tap: "#55d7bf",
	hold: "#ad7cf4",
	drag: "#f3ca4f",
	flick: "#ff9f1c",
	bgNote: "#8b949d",
	bigText: "#edf0f2",
	grid: "#69b7ff",
	hexagon: "#85cf68",
	checkerboard: "#e7e9ea",
	diamondGrid: "#4bd5c1",
	pentagon: "#f3b355",
	turntable: "#e77aa7",
	hexagram: "#c88bf5",
	comment: "#b7f34a",
});

export const TIMELINE_COMMENT_TEXT_COLOR = "#f2f5ed";

export const TIMELINE_DURATION_TYPES = new Set([
	"hold",
	"bgNote",
	"bigText",
	"grid",
	"hexagon",
	"checkerboard",
	"diamondGrid",
	"pentagon",
	"turntable",
	"hexagram",
	"comment",
]);

// bgNote and comment may be resized to zero length; other duration types may not.
export const ZERO_DURATION_TYPES = new Set(["bgNote", "comment"]);

export const BACKGROUND_EVENT_TYPES = new Set([
	"bgNote",
	"bigText",
	"grid",
	"hexagon",
	"checkerboard",
	"diamondGrid",
	"pentagon",
	"turntable",
	"hexagram",
]);

export function isBackgroundEvent(event) {
	return BACKGROUND_EVENT_TYPES.has(event?.type);
}

export function eventDrawLayer(event) {
	return isBackgroundEvent(event) ? 0 : 1;
}

export function projectState(state) {
	return state?.sviber ? { ...state.sviber, metadata: state } : state;
}

// v22: hidden channels collapse out of the timeline lanes; the scroll view and the main
// editor field keep showing their events, so only the timeline should filter by this.
export function visibleTimelineChannels(project) {
	return (project.channels || []).filter(channel => channel.hidden !== true);
}

// Return one notes-per-second density value per scrollbar pixel. Records may be render-index
// entries (`start`) or raw events (`time`), in which case callers should precompute `start`.
export function scrollbarNoteDensity(records, bounds, width) {
	const count = Math.max(1, Math.floor(Number(width) || 1));
	const beginning = Number(bounds?.[0]);
	const ending = Number(bounds?.[1]);
	const span = Math.max(1e-9, ending - beginning);
	const bins = Array(count).fill(0);
	for (const record of records || []) {
		if (!TIMELINE_NOTE_TYPES.has(record?.event?.type ?? record?.type)) {
			continue;
		}
		const time = Number(record?.start ?? record?.time);
		if (!Number.isFinite(time) || time < beginning || time > ending) {
			continue;
		}
		const index = Math.min(count - 1, Math.max(0, Math.floor(((time - beginning) / span) * count)));
		bins[index] += 1;
	}
	const secondsPerBin = span / count;
	return bins.map(value => value / secondsPerBin);
}

export function scrollbarHeatmapColors(densities) {
	const values = Array.from(densities || [], value => Math.max(0, Number(value) || 0));
	const minimum = values.length ? Math.min(...values) : 0;
	const maximum = values.length ? Math.max(...values) : 0;
	const range = maximum - minimum;
	return values.map(value => {
		const ratio = range > 0 ? (value - minimum) / range : 0;
		const red = Math.round(31 + ratio * (127 - 31));
		return `#${red.toString(16).padStart(2, "0")}1f1f`;
	});
}

export function timingFor(state) {
	return new TimingMap(projectState(state)?.timing || {});
}

export function currentSeconds(state, timing) {
	const editor = projectState(state).editor;
	if (editor.timeSnapped === false) {
		return Number(editor.currentTime) || 0;
	}
	return timing.beatToSeconds(editor.currentTime || [0, 0, 1]);
}

function greatestCommonDivisor(left, right) {
	left = Math.abs(left);
	right = Math.abs(right);
	while (right) {
		[left, right] = [right, left % right];
	}
	return left || 1;
}

export function beatDenominator(step, subdivision) {
	return subdivision / greatestCommonDivisor(step, subdivision);
}

export function beatColor(step, subdivision) {
	return BEAT_LINE_COLORS[beatDenominator(step, subdivision)] || BEAT_LINE_COLORS.other;
}

export function relativeBeatColor(relative) {
	const denominator = Number(relative?.denominator ?? 1);
	return BEAT_LINE_COLORS[denominator] || BEAT_LINE_COLORS.other;
}

export function drawPatternIcon(context, type, x, y, radius, color) {
	context.save();
	context.translate(x, y);
	context.strokeStyle = color;
	context.fillStyle = color;
	context.lineWidth = 1.4;
	if (type === "turntable") {
		context.beginPath();
		context.arc(0, 0, radius, 0, Math.PI * 2);
		context.arc(0, 0, radius * 0.46, 0, Math.PI * 2);
		context.stroke();
	} else if (type === "checkerboard") {
		for (let row = -1; row <= 1; row += 1) {
			for (let column = -1; column <= 1; column += 1) {
				if ((row + column) % 2 === 0) {
					context.fillRect(column * radius * 0.58, row * radius * 0.58, radius * 0.52, radius * 0.52);
				}
			}
		}
	} else if (type === "grid" || type === "diamondGrid") {
		context.rotate(type === "diamondGrid" ? Math.PI / 4 : 0);
		for (let index = -1; index <= 1; index += 1) {
			context.beginPath();
			context.moveTo(index * radius * 0.55, -radius);
			context.lineTo(index * radius * 0.55, radius);
			context.moveTo(-radius, index * radius * 0.55);
			context.lineTo(radius, index * radius * 0.55);
			context.stroke();
		}
	} else {
		const sides = type === "pentagon" ? 5 : type === "hexagram" ? 3 : 6;
		for (let layer = 0; layer < (type === "hexagram" ? 2 : 1); layer += 1) {
			context.beginPath();
			for (let index = 0; index < sides; index += 1) {
				const angle = -Math.PI / 2 + (index * Math.PI * 2) / sides + layer * Math.PI;
				const px = Math.cos(angle) * radius;
				const py = Math.sin(angle) * radius;
				if (!index) {
					context.moveTo(px, py);
				} else {
					context.lineTo(px, py);
				}
			}
			context.closePath();
			context.stroke();
		}
	}
	context.restore();
}

export function eventIconRadius(preferences) {
	const size = Number(preferences?.eventIconSize);
	return size > 0 ? size : 8;
}

export function drawTimelineEventIcon(context, event, x, y, color, radius = 8) {
	const scale = radius / 8;
	context.save();
	context.fillStyle = color;
	context.strokeStyle = color;
	context.lineWidth = 2 * scale;
	if (["grid", "hexagon", "checkerboard", "diamondGrid", "pentagon", "turntable", "hexagram"].includes(event.type)) {
		drawPatternIcon(context, event.type, x, y, radius, color);
	} else if (event.type === "bigText") {
		context.font = `bold ${Math.max(9, 13 * scale)}px sans-serif`;
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.fillText("T", x, y);
	} else if (event.type === "comment") {
		context.beginPath();
		context.moveTo(x - radius, y - 6 * scale);
		context.lineTo(x + radius, y - 6 * scale);
		context.lineTo(x + radius, y + 4 * scale);
		context.lineTo(x + 2 * scale, y + 4 * scale);
		context.lineTo(x - 2 * scale, y + 8 * scale);
		context.lineTo(x - 2 * scale, y + 4 * scale);
		context.lineTo(x - radius, y + 4 * scale);
		context.closePath();
		context.stroke();
	} else if (event.type === "bgNote") {
		context.beginPath();
		for (let index = 0; index < 6; index += 1) {
			const angle = (index * Math.PI) / 3;
			const px = x + Math.cos(angle) * radius * 1.125;
			const py = y + Math.sin(angle) * radius * 1.125;
			if (!index) {
				context.moveTo(px, py);
			} else {
				context.lineTo(px, py);
			}
		}
		context.closePath();
		context.fill();
		if (event.text) {
			context.fillStyle = "#111417";
			context.font = `bold ${Math.max(6, 8 * scale)}px sans-serif`;
			context.textAlign = "center";
			context.textBaseline = "middle";
			context.fillText(String(event.text).slice(0, 3), x, y);
		}
	} else if (event.type === "drag") {
		context.beginPath();
		context.arc(x, y, radius * 0.75, 0, Math.PI * 2);
		context.stroke();
		context.beginPath();
		context.arc(x, y, radius * 0.3125, 0, Math.PI * 2);
		context.fill();
	} else {
		context.beginPath();
		context.arc(x, y, radius, 0, Math.PI * 2);
		context.fill();
		if (event.text) {
			context.fillStyle = "#111417";
			context.font = `bold ${Math.max(6, 8 * scale)}px sans-serif`;
			context.textAlign = "center";
			context.textBaseline = "middle";
			context.fillText(String(event.text).slice(0, 3), x, y);
		}
	}
	context.restore();
}

export function timelineTipConnector(checkpoints, tailLength = 12) {
	if (!Array.isArray(checkpoints) || checkpoints.length < 2) {
		return [];
	}
	const spawn = checkpoints[0];
	const firstEvent = checkpoints[1];
	let dx = Number(spawn.x) - Number(firstEvent.x);
	let dy = Number(spawn.y) - Number(firstEvent.y);
	let length = Math.hypot(dx, dy);
	if (!(length > 1e-8)) {
		dx = -1;
		dy = 0;
		length = 1;
	}
	const fixedLength = Math.max(1, Number(tailLength) || 12);
	return [
		{ ...spawn, x: firstEvent.x + (dx / length) * fixedLength, y: firstEvent.y + (dy / length) * fixedLength },
		...checkpoints.slice(1),
	];
}

export function timelineTipSegments(checkpoints, beginning, ending) {
	if (
		!Array.isArray(checkpoints) ||
		checkpoints.length < 2 ||
		!Number.isFinite(beginning) ||
		!Number.isFinite(ending) ||
		ending < beginning
	) {
		return [];
	}
	const interpolate = (from, to, time) => {
		const duration = to.time - from.time;
		const progress = duration > 0 ? (time - from.time) / duration : 0;
		return {
			time,
			x: from.x + (to.x - from.x) * progress,
			y: from.y + (to.y - from.y) * progress,
		};
	};
	const lowerBound = target => {
		let low = 0;
		let high = checkpoints.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (checkpoints[middle].time < target) {
				low = middle + 1;
			} else {
				high = middle;
			}
		}
		return low;
	};
	const upperBound = target => {
		let low = 0;
		let high = checkpoints.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (checkpoints[middle].time <= target) {
				low = middle + 1;
			} else {
				high = middle;
			}
		}
		return low;
	};
	const segments = [];
	const first = Math.max(0, lowerBound(beginning) - 1);
	const last = Math.min(checkpoints.length - 1, upperBound(ending));
	for (let index = first; index < last; index += 1) {
		const from = checkpoints[index];
		const to = checkpoints[index + 1];
		const fromVisible = from.time >= beginning && from.time <= ending;
		const toVisible = to.time >= beginning && to.time <= ending;
		// Do not turn a connection between two off-screen notes into a full-width lane.
		if (!fromVisible && !toVisible) {
			continue;
		}
		const clippedFrom = from.time < beginning ? interpolate(from, to, beginning) : from;
		const clippedTo = to.time > ending ? interpolate(from, to, ending) : to;
		if (clippedFrom.time <= ending && clippedTo.time >= beginning) {
			segments.push([clippedFrom, clippedTo]);
		}
	}
	return segments;
}

export function tipSpawnDirectionSegment(firstPosition, spawnPosition, screenPoint, tailLength = 12) {
	if (!firstPosition || !spawnPosition || !screenPoint) {
		return [];
	}
	const dx = Number(spawnPosition.x) - Number(firstPosition.x);
	const dy = Number(firstPosition.y) - Number(spawnPosition.y);
	const length = Math.hypot(dx, dy);
	if (!(length > 1e-8)) {
		return [];
	}
	const fixedLength = Math.max(1, Number(tailLength) || 12);
	return [
		{ x: screenPoint.x + (dx / length) * fixedLength, y: screenPoint.y + (dy / length) * fixedLength },
		{ x: screenPoint.x, y: screenPoint.y },
	];
}

export function timelineTipCheckpointSignature(layout, channelOffset, channels, revision = 0) {
	return (
		`${layout.channels.width}:${layout.channels.y}:${layout.channelHeight}:${channelOffset}:` +
		`${(channels || []).map(channel => channel.id).join(",")}:${revision}`
	);
}
