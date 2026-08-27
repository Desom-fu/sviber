import { flattenEvents } from "../core/grouping.js";
import { SUNNIESNOW_SKIN, appendPolygonPath, polygonPath, sunniesnowDisplayedPattern } from "./stage-helpers.js";

// Drawing of the background patterns of Sunniesnow: the grids, the polygons and the big text
// that fill the playfield behind the notes. One pattern is visible at a time; the stage picks
// it and this module paints it around the origin of the playfield.

const PATTERN_FILL = "rgba(0,0,0,0.2)";
const PATTERN_SELECTED_FILL = "rgba(255,46,89,0.24)";
const BIG_TEXT_FAMILY = "'Sviber Big Text', 'YujiBoku', 'Noto Sans Math', 'Noto Sans CJK TC', sans-serif";

// Selected patterns are tinted with the selection colour while keeping their own contrast.
function patternStyle(event) {
	const selected = Boolean(event.selected);
	return {
		selected,
		stroke: selected ? SUNNIESNOW_SKIN.selectionTint : SUNNIESNOW_SKIN.patternStroke,
		fill: selected ? PATTERN_SELECTED_FILL : PATTERN_FILL,
	};
}

// Checkerboard cells alternate, and the selection tint alternates its opacity instead of its
// colour so that the checker pattern stays legible.
function checkerCellFill(selected, parity) {
	if (selected) {
		return `rgba(255,46,89,${parity % 2 ? 0.22 : 0.48})`;
	}
	return parity % 2 ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.4)";
}

function drawGridPattern(context, unit, style) {
	const halfWidth = unit * 4;
	const halfHeight = unit * 2;
	const margin = unit / 10;
	context.fillStyle = style.selected ? "rgba(255,46,89,0.24)" : "rgba(0,0,0,0.2)";
	context.fillRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
	context.beginPath();
	for (let index = -4; index <= 4; index += 1) {
		context.moveTo(index * unit, -halfHeight - margin);
		context.lineTo(index * unit, halfHeight + margin);
	}
	for (let index = -2; index <= 2; index += 1) {
		context.moveTo(-halfWidth - margin, index * unit);
		context.lineTo(halfWidth + margin, index * unit);
	}
	context.strokeStyle = style.stroke;
	context.lineWidth = unit / 50;
	context.stroke();
}

function drawCheckerboardPattern(context, unit, style) {
	for (let row = 0; row < 4; row += 1) {
		for (let column = 0; column < 4; column += 1) {
			context.fillStyle = checkerCellFill(style.selected, row + column);
			context.fillRect((row - 2) * unit, (column - 2) * unit, unit, unit);
		}
	}
}

function drawTurntablePattern(context, unit, style) {
	const thickness = unit / 20;
	context.beginPath();
	context.arc(0, 0, unit * 2, 0, Math.PI * 2);
	context.fillStyle = style.fill;
	context.fill();
	context.strokeStyle = style.stroke;
	context.lineWidth = thickness;
	context.stroke();
	context.beginPath();
	context.arc(0, 0, unit * 1.12, 0, Math.PI * 2);
	context.stroke();
	context.beginPath();
	context.arc(0, 0, thickness / 2, 0, Math.PI * 2);
	context.stroke();
}

// The big text shrinks until it fits the width of the playfield.
function drawBigTextPattern(context, unit, style, event, mapping) {
	const baseSize = SUNNIESNOW_SKIN.noteRadius * 10 * mapping.scale;
	const text = String(event.text || "");
	context.font = `${baseSize}px ${BIG_TEXT_FAMILY}`;
	const measured = context.measureText(text).width;
	const fontSize = baseSize * Math.min(1, (250 * mapping.scale) / Math.max(measured, 1));
	context.font = `${fontSize}px ${BIG_TEXT_FAMILY}`;
	context.textAlign = "center";
	context.textBaseline = "middle";
	context.fillStyle = style.selected ? SUNNIESNOW_SKIN.selectionTint : "rgba(255,255,255,0.8)";
	context.fillText(text, 0, 0);
}

function drawDiamondGridPattern(context, unit, style) {
	const margin = unit / 10;
	const ends = [3, 2, 1, -1];
	const halfSpan = ends.length - 1;
	context.beginPath();
	for (let index = -halfSpan; index <= halfSpan; index += 1) {
		const x = index * unit * 2;
		const start = -ends[Math.max(0, -index)] * unit;
		const ending = ends[Math.max(0, index)] * unit;
		context.moveTo(x + start - margin, start - margin);
		context.lineTo(x + ending + margin, ending + margin);
		context.moveTo(-x - start + margin, start - margin);
		context.lineTo(-x - ending - margin, ending + margin);
	}
	context.strokeStyle = style.stroke;
	context.lineWidth = unit / 50;
	context.stroke();
}

function drawHexagonPattern(context, unit, style) {
	const thickness = unit / 20;
	polygonPath(context, 0, 0, (unit * 4) / Math.sqrt(3), 6, Math.PI / 2);
	context.fillStyle = style.fill;
	context.fill();
	context.strokeStyle = style.stroke;
	context.lineWidth = thickness;
	context.stroke();
	context.beginPath();
	appendPolygonPath(context, 0, 0, unit * 2, 6, 0);
	appendPolygonPath(context, 0, 0, unit * Math.sqrt(3), 6, Math.PI / 2);
	context.globalAlpha *= 0.7;
	context.lineWidth = unit / 50;
	context.stroke();
	context.globalAlpha /= 0.7;
	context.beginPath();
	context.arc(0, 0, thickness / 2, 0, Math.PI * 2);
	context.lineWidth = thickness;
	context.stroke();
}

function drawPentagonPattern(context, unit, style) {
	const thickness = unit / 20;
	const radius = (4 * unit) / (1 + Math.cos(Math.PI / 5));
	polygonPath(context, 0, -2 * unit + radius, radius, 5, 0);
	context.fillStyle = style.fill;
	context.fill();
	context.strokeStyle = style.stroke;
	context.lineWidth = thickness;
	context.stroke();
	context.beginPath();
	context.arc(0, 0, thickness / 2, 0, Math.PI * 2);
	context.stroke();
}

// Two overlapping triangles, filled through the twelve point outline of their union.
function drawHexagramPattern(context, unit, style) {
	const thickness = unit / 20;
	const points = [];
	for (let index = 0; index < 12; index += 1) {
		const radius = index % 2 ? unit * 2 : (unit * 2) / Math.sqrt(3);
		const angle = (index * Math.PI) / 6;
		points.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
	}
	context.beginPath();
	points.forEach((point, index) => {
		if (index) {
			context.lineTo(point.x, point.y);
		} else {
			context.moveTo(point.x, point.y);
		}
	});
	context.closePath();
	context.fillStyle = style.fill;
	context.fill();
	context.beginPath();
	appendPolygonPath(context, 0, 0, unit * 2, 3, 0);
	appendPolygonPath(context, 0, 0, unit * 2, 3, Math.PI);
	context.strokeStyle = style.stroke;
	context.lineWidth = thickness;
	context.stroke();
	context.beginPath();
	context.arc(0, 0, thickness / 2, 0, Math.PI * 2);
	context.stroke();
}

const PATTERN_PAINTERS = {
	grid: drawGridPattern,
	checkerboard: drawCheckerboardPattern,
	turntable: drawTurntablePattern,
	bigText: drawBigTextPattern,
	diamondGrid: drawDiamondGridPattern,
	hexagon: drawHexagonPattern,
	pentagon: drawPentagonPattern,
	hexagram: drawHexagramPattern,
};

export class StagePatternsTrait {
	// Background patterns fade in by scaling up from the origin and fade out by going
	// transparent, matching the Sunniesnow player.
	_drawBackgroundPatterns(context, project, mapping, now) {
		const record =
			this.renderIndex?.displayedPattern(now) ??
			sunniesnowDisplayedPattern(flattenEvents(project.events || [], false), this.timing, now);
		if (!record) {
			return;
		}
		const { visual } = record;
		context.save();
		if (visual.phase === "fadingIn") {
			context.globalAlpha = visual.progress;
			const center = mapping.toScreen({ x: 0, y: 0 });
			context.translate(center.x, center.y);
			context.scale(visual.progress, visual.progress);
			context.translate(-center.x, -center.y);
		} else if (visual.phase === "fadingOut") {
			context.globalAlpha = 1 - visual.progress;
		}
		this._drawPattern(context, record.event, mapping);
		context.restore();
	}

	_drawPattern(context, event, mapping) {
		const painter = PATTERN_PAINTERS[event.type];
		if (!painter) {
			return;
		}
		const center = mapping.toScreen({ x: 0, y: 0 });
		const unit = SUNNIESNOW_SKIN.noteRadius * 2 * mapping.scale;
		context.save();
		context.translate(center.x, center.y);
		painter(context, unit, patternStyle(event), event, mapping);
		context.restore();
	}
}
