import { Rational } from "../core/rational.js";
import { descendants, flattenEvents } from "../core/grouping.js";
import { TimingMap } from "../core/timing.js";
import {
	CHART_BOUNDS,
	applyTransform,
	clampPointToChartBounds,
	findNearestSnapPoint,
	invertTransform,
	multiplyTransforms,
	resolveAttachedPosition,
	sampleSnappee,
} from "../core/geometry.js";
import { PixiCanvasSurface } from "./pixi-surface.js";
import {
	MOVABLE_TYPES,
	NOTE_TYPES,
	PATTERN_TYPES,
	DURATION_TYPES,
	TIP_POINT_SPAWN_TYPES,
	TIP_POINT_TRAIL_DURATION,
	TIP_POINT_ZOOM_DURATION,
	TIP_POINT_TRAIL_TAIL_DURATION,
	SUNNIESNOW_AUTOPLAY_GRADIENT,
	SUNNIESNOW_SKIN,
	noteSpeedPreference,
	sunniesnowNoteRadius,
	sunniesnowNoteTextColor,
	sunniesnowPlayfieldScale,
	isSnappeeVisible,
	sunniesnowTapDoubleLinePairs,
	circularArcDraftSpan,
	sunniesnowEventVisualState,
	sunniesnowPatternVisualState,
	sunniesnowDisplayedPattern,
	colorIntegerToCss,
	randomColor,
	projectState,
	timingFor,
	currentSeconds,
	tipPointSpawnTime,
	buildTipPointGuides,
	tipPointDirection,
	sampleTipPointPath,
	tipPointPathBetween,
	tipPointVisualState,
	directionBetween,
	adjacentDirection,
	tipPointTrailEdges,
	drawTipPointTrail,
	appendPolygonPath,
	polygonPath,
	selectedEvents,
	pointInPolygon,
} from "./stage-helpers.js";
import { composeTraits } from "../core/mixin.js";
import {
	drawFlickArrow,
	drawHoldHalo,
	drawNoteShape,
	drawNoteText,
	noteBodyDynamics,
} from "./note-painting.js";
import { StageDraftsTrait } from "./stage-drafts.js";
import { StageOverlaysTrait } from "./stage-overlays.js";

class StageNotesTrait {
	_drawNoteBody(context, event, screen, scale, visibility, doubleTap = false, preview = false) {
		const radius = sunniesnowNoteRadius(event.type) * scale;
		const selected = this.renderIndex?.isEventSelected(event) ?? Boolean(event.selected);
		const { noteScale, noteAlpha } = noteBodyDynamics(event, visibility);
		context.save();
		context.translate(screen.x, screen.y);
		context.scale(noteScale, noteScale);
		context.globalAlpha = noteAlpha * (preview ? 0.58 : 1);
		drawHoldHalo(context, event, radius, visibility, selected);
		drawNoteShape(context, event, radius, visibility, selected, doubleTap);
		drawNoteText(context, event, radius, visibility, selected);
		drawFlickArrow(context, event, radius, visibility, selected);
		context.restore();
	}

	_drawApproachCircle(context, event, screen, scale, visibility) {
		let circleScale;
		let alpha;
		if (visibility.phase === "fadingIn") {
			circleScale = 1 - (visibility.progress - 1) ** 2;
			alpha = visibility.progress / 3;
		} else if (visibility.phase === "active" && visibility.progress < 1) {
			const targetScale = 1 / 4;
			circleScale = 1 - (1 - targetScale) * visibility.progress;
			alpha = 1 / 3 + (2 / 3) * visibility.progress;
		} else {
			return;
		}
		const radius = sunniesnowNoteRadius(event.type) * 4 * scale * circleScale;
		const lineWidth = ((sunniesnowNoteRadius(event.type) * scale) / 4) * circleScale;
		if (!(radius > 0 && lineWidth > 0)) {
			return;
		}
		context.save();
		context.globalAlpha = alpha;
		context.strokeStyle = event.selected ? SUNNIESNOW_SKIN.selectionTint : SUNNIESNOW_SKIN.approachCircle;
		context.lineWidth = lineWidth;
		context.beginPath();
		context.arc(screen.x, screen.y, Math.max(0, radius - lineWidth / 2), 0, Math.PI * 2);
		context.stroke();
		context.restore();
	}

	_drawCreationEchoes(context, project, mapping, now) {
		if (!this.callbacks.getCreationMode?.()) {
			return;
		}
		const speed = noteSpeedPreference(this.state);
		const records =
			this.renderIndex?.creationEchoRecords(now) ||
			flattenEvents(project.events || [], false)
				.filter(event => MOVABLE_TYPES.has(event.type) && event.type !== "group")
				.map(event => ({
					event,
					end: this._eventTimes(event).end,
					position: resolveAttachedPosition(event, project.snappees) || event,
				}));
		for (const record of records) {
			const elapsed = now - record.end;
			if (elapsed <= 0 || elapsed > 1 / speed) {
				continue;
			}
			const position =
				record.position ||
				this.renderIndex?.positionFor(record.event) ||
				resolveAttachedPosition(record.event, project.snappees) ||
				record.event;
			const screen = mapping.toScreen(position);
			const radius = sunniesnowNoteRadius(record.event.type) * mapping.scale;
			context.save();
			context.globalAlpha = (1 - elapsed * speed) * 0.48;
			context.strokeStyle = "#ffffff";
			context.lineWidth = Math.max(1, radius / 10);
			if (record.event.type === "bgNote") {
				polygonPath(context, screen.x, screen.y, radius, 6, 0);
			} else {
				context.beginPath();
				context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
			}
			context.stroke();
			context.restore();
		}
	}

	_drawSelectedInvisible(context, project, mapping, now) {
		const patternRecord =
			this.renderIndex?.displayedPattern(now) ??
			sunniesnowDisplayedPattern(project.events, this.timing, now);
		const displayedPattern = patternRecord?.event;
		const selected =
			this.renderIndex?.stageSelectedEvents ||
			flattenEvents(project.events || [], false).filter(event => event.selected);
		for (const event of selected) {
			if (
				project.editor?.showBgEventsInMainField === false &&
				(event.type === "bgNote" || PATTERN_TYPES.has(event.type))
			) {
				continue;
			}
			if (event.type === "group") {
				continue;
			}
			if (MOVABLE_TYPES.has(event.type)) {
				if (this._noteVisibility(event, now)) {
					continue;
				}
				const position = this.renderIndex?.positionFor(event) ||
					resolveAttachedPosition(event, project.snappees) || { x: event.x || 0, y: event.y || 0 };
				const screen = mapping.toScreen(position);
				const radius = sunniesnowNoteRadius(event.type) * mapping.scale;
				context.save();
				context.strokeStyle = SUNNIESNOW_SKIN.selectionTint;
				context.lineWidth = 2;
				context.globalAlpha = 0.72;
				context.setLineDash([4, 3]);
				if (event.type === "bgNote") {
					polygonPath(context, screen.x, screen.y, radius, 6, 0);
				} else {
					context.beginPath();
					context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
				}
				context.stroke();
				if (event.text) {
					this._drawSelectedInvisibleText(context, event, screen, radius);
				}
				context.restore();
			} else if (PATTERN_TYPES.has(event.type) && event !== displayedPattern) {
				const center = mapping.toScreen({ x: 0, y: 0 });
				context.save();
				context.strokeStyle = SUNNIESNOW_SKIN.selectionTint;
				context.lineWidth = 2;
				context.globalAlpha = 0.72;
				context.setLineDash([5, 3]);
				context.strokeRect(center.x - 10, center.y - 10, 20, 20);
				context.restore();
			}
		}
	}

	_drawSelectedInvisibleText(context, event, screen, radius) {
		const text = String(event.text || "");
		if (!text) {
			return;
		}
		const baseFontSize = radius;
		context.font = `${baseFontSize}px 'Sviber Note', 'Noto Sans Math', sans-serif`;
		const measured = context.measureText(text).width;
		const fontSize = baseFontSize * Math.min(1, (radius * 1.5) / Math.max(measured, 1));
		context.save();
		context.setLineDash([]);
		context.globalAlpha = 1;
		context.font = `${fontSize}px 'Sviber Note', 'Noto Sans Math', sans-serif`;
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.strokeStyle = "rgba(0,0,0,0.82)";
		context.lineWidth = Math.max(1, fontSize / 7);
		context.lineJoin = "round";
		context.strokeText(text, screen.x, screen.y);
		context.fillStyle = sunniesnowNoteTextColor(event, { phase: "active" });
		context.fillText(text, screen.x, screen.y);
		context.restore();
	}

	_drawParticles(context, mapping) {
		const now = performance.now();
		this.particles = this.particles.filter(particle => now - particle.started < 190);
		for (const particle of this.particles) {
			const elapsed = now - particle.started;
			if (elapsed < 0) {
				continue;
			}
			const frames = elapsed / (1000 / 60);
			const alpha = Math.max(0, 1 - frames * 0.1);
			if (!(alpha > 0)) {
				continue;
			}
			const screen = mapping.toScreen(particle);
			const radius = particle.radius * mapping.scale;
			context.save();
			context.globalAlpha = alpha;
			for (const spark of particle.sparks) {
				const distance = (frames * radius) / 2;
				context.strokeStyle = spark.color;
				context.lineWidth = radius / 20;
				context.beginPath();
				context.moveTo(
					screen.x + Math.cos(spark.angle) * distance,
					screen.y + Math.sin(spark.angle) * distance,
				);
				context.lineTo(
					screen.x + Math.cos(spark.angle) * (distance + radius * 2),
					screen.y + Math.sin(spark.angle) * (distance + radius * 2),
				);
				context.stroke();
			}
			for (const contour of particle.contours) {
				const contourScale = 1 + frames * 0.2;
				context.save();
				context.translate(screen.x, screen.y);
				context.rotate(contour.angle);
				context.strokeStyle = contour.color;
				context.lineWidth = (radius / 10) * contourScale;
				context.beginPath();
				context.arc(0, 0, radius * 1.5 * contourScale, -Math.PI / 6, Math.PI / 6);
				context.stroke();
				context.restore();
			}
			context.restore();
		}
	}

}

export const withStageNotes = composeTraits(
	"StageNotesLayer",
	StageNotesTrait,
	StageOverlaysTrait,
	StageDraftsTrait,
);

