import { TimingMap } from "../core/timing.js";

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
	"hold", "bgNote", "bigText", "grid", "hexagon", "checkerboard",
	"diamondGrid", "pentagon", "turntable", "hexagram", "comment",
]);

export function projectState(state) {
	return state?.sviber ? { ...state.sviber, metadata: state } : state;
}

export function timingFor(state) {
	return new TimingMap(projectState(state)?.timing || {});
}

export function currentSeconds(state, timing) {
	const editor = projectState(state).editor;
	return editor.timeSnapped === false
		? Number(editor.currentTime) || 0
		: timing.beatToSeconds(editor.currentTime || [0, 0, 1]);
}

function greatestCommonDivisor(left, right) {
	left = Math.abs(left);
	right = Math.abs(right);
	while (right) [left, right] = [right, left % right];
	return left || 1;
}

export function beatDenominator(step, subdivision) {
	return subdivision / greatestCommonDivisor(step, subdivision);
}

export function beatColor(step, subdivision) {
	return BEAT_LINE_COLORS[beatDenominator(step, subdivision)] || BEAT_LINE_COLORS.other;
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
				const angle = -Math.PI / 2 + index * Math.PI * 2 / sides + layer * Math.PI;
				const px = Math.cos(angle) * radius;
				const py = Math.sin(angle) * radius;
				if (!index) context.moveTo(px, py);
				else context.lineTo(px, py);
			}
			context.closePath();
			context.stroke();
		}
	}
	context.restore();
}

export function drawTimelineEventIcon(context, event, x, y, color) {
	context.save();
	context.fillStyle = color;
	context.strokeStyle = color;
	context.lineWidth = 2;
	if (["grid", "hexagon", "checkerboard", "diamondGrid", "pentagon", "turntable", "hexagram"].includes(event.type)) {
		drawPatternIcon(context, event.type, x, y, 8, color);
	} else if (event.type === "bigText") {
		context.font = "bold 13px sans-serif";
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.fillText("T", x, y);
	} else if (event.type === "comment") {
		context.beginPath();
		context.moveTo(x - 8, y - 6);
		context.lineTo(x + 8, y - 6);
		context.lineTo(x + 8, y + 4);
		context.lineTo(x + 2, y + 4);
		context.lineTo(x - 2, y + 8);
		context.lineTo(x - 2, y + 4);
		context.lineTo(x - 8, y + 4);
		context.closePath();
		context.stroke();
	} else if (event.type === "bgNote") {
		context.beginPath();
		for (let index = 0; index < 6; index += 1) {
			const angle = index * Math.PI / 3;
			const px = x + Math.cos(angle) * 9;
			const py = y + Math.sin(angle) * 9;
			if (!index) context.moveTo(px, py); else context.lineTo(px, py);
		}
		context.closePath();
		context.fill();
	} else if (event.type === "drag") {
		context.beginPath();
		context.arc(x, y, 6, 0, Math.PI * 2);
		context.stroke();
		context.beginPath();
		context.arc(x, y, 2.5, 0, Math.PI * 2);
		context.fill();
	} else {
		context.beginPath();
		context.arc(x, y, 8, 0, Math.PI * 2);
		context.fill();
		if (event.text) {
			context.fillStyle = "#111417";
			context.font = "bold 8px sans-serif";
			context.textAlign = "center";
			context.textBaseline = "middle";
			context.fillText(String(event.text).slice(0, 3), x, y);
		}
	}
	context.restore();
}

export function timelineTipConnector(checkpoints, tailLength = 12) {
	if (!Array.isArray(checkpoints) || checkpoints.length < 2) return [];
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
		{ ...spawn, x: firstEvent.x + dx / length * fixedLength, y: firstEvent.y + dy / length * fixedLength },
		...checkpoints.slice(1),
	];
}

export function tipSpawnDirectionSegment(firstPosition, spawnPosition, screenPoint, tailLength = 12) {
	if (!firstPosition || !spawnPosition || !screenPoint) return [];
	const dx = Number(spawnPosition.x) - Number(firstPosition.x);
	const dy = Number(firstPosition.y) - Number(spawnPosition.y);
	const length = Math.hypot(dx, dy);
	if (!(length > 1e-8)) return [];
	const fixedLength = Math.max(1, Number(tailLength) || 12);
	return [
		{ x: screenPoint.x + dx / length * fixedLength, y: screenPoint.y + dy / length * fixedLength },
		{ x: screenPoint.x, y: screenPoint.y },
	];
}
