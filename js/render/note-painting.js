import { SUNNIESNOW_SKIN, polygonPath, sunniesnowNoteTextColor } from "./stage-helpers.js";

// The individual strokes that make up a Sunniesnow note: the hold halo, the note shape,
// the note text and the flick arrow. They are plain functions on a 2D context translated
// to the note centre, so the stage only has to decide where a note goes, not how it looks.

// v19: selected locked events use a magenta tint instead of the bright red one.
function selectionTint(selected, event) {
	if (!selected) {
		return null;
	}
	return event?.locked ? SUNNIESNOW_SKIN.selectionLockedTint : SUNNIESNOW_SKIN.selectionTint;
}

const NOTE_PALETTES = {
	tap: [SUNNIESNOW_SKIN.tapFill, SUNNIESNOW_SKIN.tapStroke],
	doubleTap: [SUNNIESNOW_SKIN.doubleTapFill, SUNNIESNOW_SKIN.doubleTapStroke],
	hold: [SUNNIESNOW_SKIN.holdFill, SUNNIESNOW_SKIN.holdStroke],
	flick: [SUNNIESNOW_SKIN.flickFill, SUNNIESNOW_SKIN.flickStroke],
};

function notePalette(event, doubleTap) {
	if (event.type === "tap") {
		return doubleTap ? NOTE_PALETTES.doubleTap : NOTE_PALETTES.tap;
	}
	return NOTE_PALETTES[event.type] ?? NOTE_PALETTES.flick;
}

// Holds pulse while held, background notes bulge as they fade; everything else simply
// grows out of nothing while fading in.
export function noteBodyDynamics(event, visibility) {
	const noteAlpha = Number.isFinite(visibility.alpha) ? visibility.alpha : 1;
	if (event.type === "hold" && visibility.phase === "holding") {
		const pulse = Math.cos((2 * Math.PI * visibility.relativeTime) / 0.27);
		return { noteScale: 1.1 - pulse * 0.1, noteAlpha };
	}
	if (event.type === "hold" && visibility.phase === "fadingOut") {
		const pulse = Math.cos((2 * Math.PI * (visibility.end - visibility.start)) / 0.27);
		return { noteScale: 1.1 - pulse * 0.1, noteAlpha };
	}
	if (event.type === "bgNote" && visibility.phase === "fadingOut") {
		const bulge = 1 + (3 * (visibility.progress - 1 / 3) ** 2 - 1 / 3) * 0.5;
		return { noteScale: bulge, noteAlpha: 1 - visibility.progress };
	}
	const noteScale = visibility.phase === "fadingIn" ? visibility.progress : 1;
	return { noteScale, noteAlpha };
}

export function drawHoldHalo(context, event, radius, visibility, selected) {
	if (event.type !== "hold" || visibility.phase === "fadingOut") {
		return;
	}
	const haloRadius = radius * 1.5;
	context.beginPath();
	if (visibility.phase === "holding") {
		const progress = Math.max(0, Math.min(1, visibility.progress));
		const beginning = -Math.PI / 2 + progress * Math.PI * 2;
		context.moveTo(0, 0);
		context.lineTo(Math.cos(beginning) * haloRadius, Math.sin(beginning) * haloRadius);
		context.arc(0, 0, haloRadius, beginning, (Math.PI * 3) / 2);
		context.closePath();
	} else {
		context.arc(0, 0, haloRadius, 0, Math.PI * 2);
	}
	const haloTint = event.locked ? "rgba(232,61,255,0.72)" : "rgba(255,46,89,0.72)";
	context.fillStyle = selected ? haloTint : SUNNIESNOW_SKIN.holdHalo;
	context.fill();
}

// Taps and flicks vanish the instant they are hit; holds shrink away over the first half
// of their fade out.
function noteShapeFade(event, visibility) {
	if (visibility.phase === "fadingOut" && ["tap", "flick"].includes(event.type)) {
		return null;
	}
	if (event.type !== "hold" || visibility.phase !== "fadingOut") {
		return { bodyScale: 1, bodyAlpha: 1 };
	}
	const progress = visibility.progress * 2;
	if (progress > 1) {
		return null;
	}
	return { bodyScale: 1 + (1 - (1 - progress) ** 2) * 0.5, bodyAlpha: (1 - progress) ** 3 };
}

function drawBgNoteShape(context, event, radius, selected) {
	context.fillStyle = selected? event.locked? "rgba(232,61,255,0.82)": "rgba(255,46,89,0.82)": "rgba(0,0,0,0.7)";
	polygonPath(context, 0, 0, radius, 6, 0);
	context.fill();
}

function drawDragShape(context, event, radius, selected) {
	let lineWidth = radius / 20;
	context.strokeStyle = selected ? "#ffd1da" : SUNNIESNOW_SKIN.dragOuterStroke;
	context.lineWidth = lineWidth;
	context.beginPath();
	context.arc(0, 0, radius - lineWidth / 2, 0, Math.PI * 2);
	context.stroke();
	lineWidth = radius / 9;
	context.strokeStyle = selectionTint(selected, event) || SUNNIESNOW_SKIN.dragStroke;
	context.lineWidth = lineWidth;
	const radius2 = (radius * 3) / 4;
	const radius1 = radius / 2;
	const unit1 = radius1 / Math.sqrt(2);
	const unit2 = radius2 / Math.sqrt(2);
	context.beginPath();
	context.arc(0, 0, radius2, 0, Math.PI * 2);
	context.moveTo(radius1, 0);
	context.arc(0, 0, radius1, 0, Math.PI * 2);
	context.moveTo(-unit1, unit1);
	context.lineTo(-unit2, unit2);
	context.moveTo(unit1, -unit1);
	context.lineTo(unit2, -unit2);
	context.stroke();
}

function drawDiscShape(context, event, radius, selected, doubleTap) {
	const palette = notePalette(event, doubleTap);
	const lineWidth = radius / 8;
	context.fillStyle = selectionTint(selected, event) || palette[0];
	context.strokeStyle = selected ? "#ffd1da" : palette[1];
	context.lineWidth = lineWidth;
	context.beginPath();
	context.arc(0, 0, radius - lineWidth / 2, 0, Math.PI * 2);
	context.fill();
	context.stroke();
}

export function drawNoteShape(context, event, radius, visibility, selected, doubleTap) {
	const fade = noteShapeFade(event, visibility);
	if (!fade) {
		return;
	}
	context.save();
	context.scale(fade.bodyScale, fade.bodyScale);
	context.globalAlpha *= fade.bodyAlpha;
	if (event.type === "bgNote") {
		drawBgNoteShape(context, event, radius, selected);
	} else if (event.type === "drag") {
		drawDragShape(context, event, radius, selected);
	} else {
		drawDiscShape(context, event, radius, selected, doubleTap);
	}
	context.restore();
}


// Hit text stretches horizontally then settles, and stretches vertically on a slightly
// different schedule, which is what gives the Sunniesnow hit text its squash and stretch.
function fadeOutTextScaleX(progress) {
	if (progress < 1 / 4) {
		return 1 + progress * 4;
	}
	if (progress < 1 / 2) {
		return 2 - (progress - 1 / 4) * 2;
	}
	return 1.5 + (progress - 1 / 2) * 3;
}

function fadeOutTextScaleY(progress) {
	if (progress < 0.5) {
		return 1 + progress * 2;
	}
	if (progress < 0.6) {
		return 2 - (progress - 0.5) * 5;
	}
	return 1.5 + ((progress - 0.6) / 0.4) * 1.5;
}

function noteTextDynamics(event, visibility) {
	if (visibility.phase !== "fadingOut" || event.type === "bgNote") {
		return { textScaleX: 1, textScaleY: 1, textAlpha: 1 };
	}
	const progress = visibility.progress;
	const textAlpha = progress >= 0.5 ? 1 - (progress - 0.5) * 2 : 1;
	return { textScaleX: fadeOutTextScaleX(progress), textScaleY: fadeOutTextScaleY(progress), textAlpha };
}

const NOTE_FONT_FAMILY = "'Sviber Note', 'Noto Sans Math', sans-serif";

export function drawNoteText(context, event, radius, visibility, selected) {
	if (!event.text) {
		return;
	}
	const { textScaleX, textScaleY, textAlpha } = noteTextDynamics(event, visibility);
	const baseFontSize = radius;
	context.font = `${baseFontSize}px ${NOTE_FONT_FAMILY}`;
	const measured = context.measureText(String(event.text)).width;
	const fontSize = baseFontSize * Math.min(1, (radius * 1.5) / Math.max(measured, 1));
	context.save();
	context.scale(textScaleX, textScaleY);
	context.globalAlpha *= textAlpha;
	context.fillStyle = sunniesnowNoteTextColor(event, visibility);
	context.font = `${fontSize}px ${NOTE_FONT_FAMILY}`;
	context.textAlign = "center";
	context.textBaseline = "middle";
	if (selected) {
		context.strokeStyle = "rgba(0,0,0,0.82)";
		context.lineWidth = Math.max(1, fontSize / 7);
		context.lineJoin = "round";
		context.strokeText(String(event.text), 0, 0);
	}
	context.fillText(String(event.text), 0, 0);
	context.restore();
}

// The arrow breathes while the flick waits, then shoots outwards as it is hit.
function flickArrowDynamics(radius, visibility) {
	if (visibility.phase !== "fadingOut") {
		const arrowAlpha = visibility.phase === "fadingIn" ? visibility.progress : 1;
		return { arrowScale: 1 - 0.05 * Math.cos(visibility.relativeTime * 5), arrowAlpha, arrowOffset: 0 };
	}
	const progress = visibility.progress * 2;
	if (progress > 1) {
		return { arrowScale: 1, arrowAlpha: 0, arrowOffset: 0 };
	}
	const arrowOffset = radius * 2 * (1 - (1 - progress) ** 2);
	return { arrowScale: 1.05, arrowAlpha: (1 - progress) ** 3, arrowOffset };
}

export function drawFlickArrow(context, event, radius, visibility, selected) {
	if (event.type !== "flick") {
		return;
	}
	const { arrowScale, arrowAlpha, arrowOffset } = flickArrowDynamics(radius, visibility);
	if (arrowAlpha <= 0) {
		return;
	}
	context.save();
	context.rotate(-(Number(event.angle) || 0));
	context.translate(arrowOffset, 0);
	context.scale(arrowScale, arrowScale);
	context.globalAlpha *= arrowAlpha;
	const innerDistance = radius * 1.1;
	const tipDistance = radius * 2;
	context.beginPath();
	context.arc(0, 0, innerDistance, -Math.PI / 4, Math.PI / 4);
	context.lineTo(tipDistance, 0);
	context.closePath();
	context.fillStyle = selectionTint(selected, event) || SUNNIESNOW_SKIN.flickArrow;
	context.fill();
	context.beginPath();
	context.moveTo(tipDistance, 0);
	context.lineTo(innerDistance / Math.sqrt(2), innerDistance / Math.sqrt(2));
	context.lineTo((innerDistance + tipDistance) / 2, 0);
	context.lineTo(innerDistance / Math.sqrt(2), -innerDistance / Math.sqrt(2));
	context.closePath();
	context.fillStyle = selected ? "#ffd1da" : SUNNIESNOW_SKIN.flickArrowHighlight;
	context.fill();
	context.restore();
}
