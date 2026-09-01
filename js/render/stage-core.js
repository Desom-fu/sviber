import { Rational } from "../core/rational.js";
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
	sampleSnappeePath,
} from "../core/geometry.js";
import { PixiCanvasSurface } from "./pixi-surface.js";
import { ChartRenderIndex } from "./chart-index.js";
import { installTraitMembers } from "../core/mixin.js";
import { StagePatternsTrait } from "./stage-patterns.js";
import { StageSnappeesTrait } from "./stage-snappees.js";
import { flattenEvents } from "../core/grouping.js";
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
	selectionTintFor,
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

// Flick sparks fly out roughly along the flick direction, everything else in all
// directions.
function sparkAngle(flick, event) {
	if (!flick) {
		return Math.random() * Math.PI * 2;
	}
	return Math.random() * Math.PI - Math.PI / 2 - (Number(event.angle) || 0);
}

export class StageViewCore {
	constructor(host, callbacks = {}) {
		this.host = host;
		this.callbacks = callbacks;
		this.surface = new PixiCanvasSurface(host, {
			background: "#55585b",
			onResize: () => this.render(),
		});
		this.state = null;
		this.timing = null;
		this.renderIndex = null;
		this.hitRegions = [];
		this.visibleEvents = [];
		this.selectionBox = null;
		this.creationPreview = null;
		this.curvePreview = null;
		this.drag = null;
		this.pointerMoved = false;
		this.backgroundImage = null;
		this.backgroundCache = document.createElement("canvas");
		this.backgroundSource = document.createElement("canvas");
		this.backgroundPadded = document.createElement("canvas");
		this.backgroundDirty = true;
		this._staticLayer = document.createElement("canvas");
		this._staticContext = null;
		this._staticLayerValid = false;
		this._staticHitRegions = [];
		this._staticVisibleEvents = [];
		this.particles = [];
		this.particleAnimationFrame = 0;
		this.renderAnimationFrame = 0;
		this.pointerMoveAnimationFrame = 0;
		this.pendingPointerMove = null;
		this.lastHudCombo = null;
		this.hudComboAnimationStarted = null;
		this.pointerScreen = null;
		this.spaceHeld = false;
		this.spaceKeyDown = event => {
			if (event.code === "Space" || event.key === " ") {
				this.spaceHeld = true;
			}
		};
		this.spaceKeyUp = event => {
			if (event.code === "Space" || event.key === " ") {
				this.spaceHeld = false;
			}
		};
		document.addEventListener("keydown", this.spaceKeyDown, true);
		document.addEventListener("keyup", this.spaceKeyUp, true);
		// v21: Ctrl+Alt enlarges the selection handles (flick, tip spawn, group anchor),
		// so track the pair and repaint when it changes.
		this.ctrlAltHeld = false;
		this.ctrlAltListener = event => {
			const held = event.type === "keydown" && Boolean(event.ctrlKey && event.altKey);
			if (held !== this.ctrlAltHeld) {
				this.ctrlAltHeld = held;
				this.requestRender();
			}
		};
		document.addEventListener("keydown", this.ctrlAltListener, true);
		document.addEventListener("keyup", this.ctrlAltListener, true);
		this.boundMove = event => this._queuePointerMove(event);
		this.boundUp = event => {
			try {
				this._flushPointerMove();
				this._pointerUp(event);
			} finally {
				try {
					this.surface.canvas.releasePointerCapture?.(event.pointerId);
				} catch {
					/* Pointer capture may already be gone. */
				}
			}
		};
		this.surface.ready.then(() => {
			this.surface.canvas.addEventListener("pointerdown", event => this._pointerDown(event));
			this.surface.canvas.addEventListener("pointermove", event => this._hoverMove(event));
			this.surface.canvas.addEventListener("pointerleave", () => this._pointerLeave());
			this.surface.canvas.addEventListener(
				"wheel",
				event => {
					if (!event.ctrlKey || !event.shiftKey) {
						return;
					}
					event.preventDefault();
					this.callbacks.onMainFieldZoom?.(event.deltaY < 0 ? 1.12 : 1 / 1.12);
				},
				{ passive: false },
			);
			this.surface.canvas.addEventListener("dblclick", event => this._doubleClick(event));
			this.render();
		});
	}

	setState(state, options = {}) {
		this.state = state;
		this._staticLayerValid = false;
		const project = projectState(state);
		this.renderIndex =
			state?.renderIndex ||
			new ChartRenderIndex(project, timingFor(state), {
				noteSpeed: state?.preferences?.noteSpeed,
			});
		this.timing = this.renderIndex.timing;
		if (options.render !== false) {
			this.render();
		}
	}

	setBackground(image) {
		this.backgroundImage = image;
		this.backgroundDirty = true;
		this.render();
	}

	triggerHit(event, delaySeconds = 0) {
		const project = projectState(this.state);
		const position = this.renderIndex?.positionFor(event) ||
			resolveAttachedPosition(event, project.snappees) || { x: event.x || 0, y: event.y || 0 };
		const flick = event.type === "flick";
		const sparkColors = [0xbfaa00, 0xffff00];
		const contourColors = [0xbfaa00, 0xff7f00];
		this.particles.push({
			x: position.x,
			y: position.y,
			radius: sunniesnowNoteRadius(event.type),
			started: performance.now() + Math.max(0, Number(delaySeconds) || 0) * 1000,
			sparks: Array.from({ length: 20 }, () => ({
				angle: sparkAngle(flick, event),
				color: randomColor(...sparkColors),
			})),
			contours: Array.from({ length: 3 }, () => ({
				angle: Math.random() * Math.PI * 2,
				color: randomColor(...contourColors),
			})),
		});
		this._animateParticles();
	}

	cancelScheduledHits() {
		const now = performance.now();
		this.particles = this.particles.filter(particle => particle.started <= now);
		this.render();
	}

	clearHitEffects() {
		this.particles = [];
		if (this.particleAnimationFrame) {
			cancelAnimationFrame(this.particleAnimationFrame);
			this.particleAnimationFrame = 0;
		}
		this.render();
	}

	_animateParticles() {
		// Playback already renders once per audio animation frame.
		if (this.callbacks.isPlaying?.()) {
			return;
		}
		if (this.particleAnimationFrame) {
			return;
		}
		const animate = () => {
			this.particleAnimationFrame = 0;
			const now = performance.now();
			this.particles = this.particles.filter(particle => now - particle.started < 190);
			this.render();
			if (this.particles.length) {
				this.particleAnimationFrame = requestAnimationFrame(animate);
			}
		};
		this.particleAnimationFrame = requestAnimationFrame(animate);
	}

	render() {
		if (this.renderAnimationFrame) {
			cancelAnimationFrame(this.renderAnimationFrame);
			this.renderAnimationFrame = 0;
		}
		if (!this.state || !this.surface.context) {
			return;
		}
		if (this.surface.resize()) {
			this.backgroundDirty = true;
			this._staticLayerValid = false;
		}
		this.surface.render((context, width, height) => this._draw(context, width, height));
	}

	requestRender() {
		if (this.renderAnimationFrame) {
			return;
		}
		this.renderAnimationFrame = requestAnimationFrame(() => {
			this.renderAnimationFrame = 0;
			this.render();
		});
	}

	_queuePointerMove(event) {
		this.pendingPointerMove = {
			clientX: event.clientX,
			clientY: event.clientY,
			ctrlKey: event.ctrlKey,
			shiftKey: event.shiftKey,
			altKey: event.altKey,
		};
		if (this.pointerMoveAnimationFrame) {
			return;
		}
		this.pointerMoveAnimationFrame = requestAnimationFrame(() => this._flushPointerMove());
	}

	_flushPointerMove() {
		if (this.pointerMoveAnimationFrame) {
			cancelAnimationFrame(this.pointerMoveAnimationFrame);
		}
		this.pointerMoveAnimationFrame = 0;
		const event = this.pendingPointerMove;
		this.pendingPointerMove = null;
		if (event) {
			this._pointerMove(event);
		}
	}

	_mapping(width, height) {
		const editor = projectState(this.state)?.editor || {};
		const zoom = Math.max(0.1, Math.min(16, Number(editor.mainFieldZoom) || 1));
		const scale = sunniesnowPlayfieldScale(width, height) * zoom;
		const originX = width / 2 + (Number(editor.mainFieldPanX) || 0) * scale;
		const originY = height / 2 + (Number(editor.mainFieldPanY) || 0) * scale;
		return {
			scale,
			originX,
			originY,
			toScreen: point => ({ x: originX + point.x * scale, y: originY - point.y * scale }),
			toChart: point => ({ x: (point.x - originX) / scale, y: (originY - point.y) / scale }),
		};
	}

	_prepareBackground(width, height) {
		if (!this.backgroundDirty && this.backgroundCache.width === width && this.backgroundCache.height === height) {
			return;
		}
		this.backgroundCache.width = width;
		this.backgroundCache.height = height;
		this.backgroundSource.width = width;
		this.backgroundSource.height = height;
		const source = this.backgroundSource.getContext("2d", { alpha: false });
		source.fillStyle = "#ffffff";
		source.fillRect(0, 0, width, height);
		if (this.backgroundImage) {
			const imageWidth = this.backgroundImage.naturalWidth || this.backgroundImage.width || width;
			const imageHeight = this.backgroundImage.naturalHeight || this.backgroundImage.height || height;
			const scale = Math.max(width / imageWidth, height / imageHeight);
			const drawWidth = imageWidth * scale;
			const drawHeight = imageHeight * scale;
			source.drawImage(
				this.backgroundImage,
				(width - drawWidth) / 2,
				(height - drawHeight) / 2,
				drawWidth,
				drawHeight,
			);
		}

		// Pixi's BlurFilter samples clamped edge pixels. Repeating the outermost
		// source pixels into a padded bitmap produces the same edge behavior here.
		const padding = Math.ceil(SUNNIESNOW_SKIN.backgroundBlur * 3);
		this.backgroundPadded.width = width + padding * 2;
		this.backgroundPadded.height = height + padding * 2;
		const padded = this.backgroundPadded.getContext("2d", { alpha: false });
		padded.drawImage(this.backgroundSource, padding, padding);
		padded.drawImage(this.backgroundSource, 0, 0, 1, height, 0, padding, padding, height);
		padded.drawImage(this.backgroundSource, width - 1, 0, 1, height, padding + width, padding, padding, height);
		padded.drawImage(this.backgroundSource, 0, 0, width, 1, padding, 0, width, padding);
		padded.drawImage(this.backgroundSource, 0, height - 1, width, 1, padding, padding + height, width, padding);
		padded.fillStyle = source
			.getImageData(0, 0, 1, 1)
			.data.slice(0, 3)
			.reduce((value, channel) => `${value}${channel.toString(16).padStart(2, "0")}`, "#");
		padded.fillRect(0, 0, padding, padding);
		padded.fillStyle = source
			.getImageData(width - 1, 0, 1, 1)
			.data.slice(0, 3)
			.reduce((value, channel) => `${value}${channel.toString(16).padStart(2, "0")}`, "#");
		padded.fillRect(padding + width, 0, padding, padding);
		padded.fillStyle = source
			.getImageData(0, height - 1, 1, 1)
			.data.slice(0, 3)
			.reduce((value, channel) => `${value}${channel.toString(16).padStart(2, "0")}`, "#");
		padded.fillRect(0, padding + height, padding, padding);
		padded.fillStyle = source
			.getImageData(width - 1, height - 1, 1, 1)
			.data.slice(0, 3)
			.reduce((value, channel) => `${value}${channel.toString(16).padStart(2, "0")}`, "#");
		padded.fillRect(padding + width, padding + height, padding, padding);

		const context = this.backgroundCache.getContext("2d", { alpha: false });
		context.save();
		const brightness = SUNNIESNOW_SKIN.backgroundBrightness * 100;
		context.filter = `blur(${SUNNIESNOW_SKIN.backgroundBlur}px) brightness(${brightness}%)`;
		context.drawImage(this.backgroundPadded, -padding, -padding);
		context.restore();
		this.backgroundDirty = false;
	}

	_draw(context, width, height) {
		const project = projectState(this.state);
		const mapping = this._mapping(width, height);
		const now = currentSeconds(this.state, this.timing);
		const draft = this.callbacks.getCurveDraft?.();
		if (this._canReuseStaticLayer(width, height, draft)) {
			context.drawImage(this._staticLayer, 0, 0);
			this.hitRegions = this._staticHitRegions.slice();
			this.visibleEvents = this._staticVisibleEvents;
			this._drawCurveDraft(context, mapping);
			return;
		}
		this.hitRegions = [];
		this.visibleEvents = [];
		const scene = draft ? this._ensureStaticLayer(width, height) : context;
		this._prepareBackground(width, height);
		scene.drawImage(this.backgroundCache, 0, 0);
		if (project.editor?.showBgEventsInMainField !== false) {
			this._drawBackgroundPatterns(scene, project, mapping, now);
		}
		if (project.editor?.showChartBoundary !== false) {
			this._drawBoundary(scene, mapping);
		}
		this._drawHud(scene, width, height, project, now);
		this._drawParticles(scene, mapping);
		this._drawSnappees(scene, project, mapping);
		this._drawNotes(scene, project, mapping, now);
		this._drawGrouping?.(scene, project, mapping, now);
		this._drawSnappeeAttachRings?.(scene, project, mapping, now);
		this._drawRulers?.(scene, width, height, project, mapping);
		this._drawCreationEchoes(scene, project, mapping, now);
		this._drawTipPoints(scene, project, mapping, now);
		this._drawSelectedInvisible(scene, project, mapping, now);
		this._drawSelectionHandles(scene, project, mapping);
		this._drawFreeTransform(scene, mapping);
		this._drawCreationPreview(scene, project, mapping);
		if (draft) {
			this._staticHitRegions = this.hitRegions.slice();
			this._staticVisibleEvents = this.visibleEvents;
			this._staticLayerValid = true;
			context.drawImage(this._staticLayer, 0, 0);
		}
		this._drawCurveDraft(context, mapping);
		if (this.selectionBox) {
			this._drawSelectionBox(context, this.selectionBox);
		}
	}

	_canReuseStaticLayer(width, height, draft) {
		return (
			Boolean(draft) &&
			this._staticLayerValid &&
			this._staticLayer.width === width &&
			this._staticLayer.height === height &&
			!this.selectionBox &&
			!this.creationPreview
		);
	}

	_ensureStaticLayer(width, height) {
		if (this._staticLayer.width !== width || this._staticLayer.height !== height) {
			this._staticLayer.width = width;
			this._staticLayer.height = height;
			this._staticContext = null;
		}
		if (!this._staticContext) {
			this._staticContext = this._staticLayer.getContext("2d", { alpha: false });
		}
		return this._staticContext;
	}

	_drawBoundary(context, mapping) {
		const topLeft = mapping.toScreen({ x: -100, y: 50 });
		const bottomRight = mapping.toScreen({ x: 100, y: -50 });
		context.strokeStyle = "rgba(225,230,233,0.72)";
		context.lineWidth = 1;
		context.strokeRect(
			Math.round(topLeft.x) + 0.5,
			Math.round(topLeft.y) + 0.5,
			Math.round(bottomRight.x - topLeft.x),
			Math.round(bottomRight.y - topLeft.y),
		);
	}

	_eventTimes(event) {
		const indexed = this.renderIndex?.recordFor(event);
		if (indexed) {
			return { start: indexed.start, end: indexed.end };
		}
		const start = this.timing.beatToSeconds(event.time);
		if (!DURATION_TYPES.has(event.type)) {
			return { start, end: start };
		}
		const finish = Rational.from(event.time).add(event.duration || [0, 1, 1]);
		return { start, end: this.timing.beatToSeconds(finish) };
	}

	_noteVisibility(event, now) {
		const { start, end } = this._eventTimes(event);
		return sunniesnowEventVisualState(event, start, end, now, this.state?.preferences?.noteSpeed);
	}

	// v21 fix: deterministic stacking for note bodies — by time, then by channel order
	// (the channel lower in the timeline covers the one above it when notes are
	// simultaneous), then by creation order inside the lane. The interval index returns
	// records in tree order, which used to make the covering flip per chart region.
	_sortNoteRecordsForStacking(noteRecords, project) {
		const channelOrder =
			this.renderIndex?.channelOrder ||
			new Map((project.channels || []).map((channel, index) => [channel.id, index]));
		noteRecords.sort(
			(left, right) =>
				left.start - right.start ||
				(channelOrder.get(left.event.channel) ?? Infinity) -
					(channelOrder.get(right.event.channel) ?? Infinity) ||
				left.sequence - right.sequence,
		);
	}

	_drawNotes(context, project, mapping, now) {
		const doubleTapIds = this._doubleTapIds(project);
		const records = [];
		const backgroundRecords = [];
		const noteRecords = [];
		const candidates =
			this.renderIndex?.visibleMovableRecords(now) ||
			flattenEvents(project.events || [], false)
				.filter(event => MOVABLE_TYPES.has(event.type) && event.type !== "group")
				.map(event => ({ event }));
		for (const indexed of candidates) {
			const { event } = indexed;
			if (project.editor?.showBgEventsInMainField === false && event.type === "bgNote") {
				continue;
			}
			const start = indexed.start ?? this.timing.beatToSeconds(event.time);
			const visibility =
				indexed.start == null? this._noteVisibility(event, now): sunniesnowEventVisualState(
							event,
							indexed.start,
							indexed.end,
							now,
							this.state?.preferences?.noteSpeed,
						);
			if (!visibility) {
				continue;
			}
			const position = indexed.position ||
				resolveAttachedPosition(event, project.snappees) || {
					x: Number(event.x) || 0,
					y: Number(event.y) || 0,
				};
			const screen = mapping.toScreen(position);
			const record = {
				event,
				position,
				screen,
				visibility,
				doubleTap: doubleTapIds.has(event.id),
				start,
				sequence: indexed.sequence ?? event.id,
			};
			records.push(record);
			if (event.type === "bgNote") {
				backgroundRecords.push(record);
			} else if (NOTE_TYPES.has(event.type)) {
				noteRecords.push(record);
			}
			this.visibleEvents.push(record);
		}
		this._sortNoteRecordsForStacking(noteRecords, project);
		for (const record of backgroundRecords) {
			this._drawNoteBody(
				context,
				record.event,
				record.screen,
				mapping.scale,
				record.visibility,
				record.doubleTap,
			);
		}
		this._drawDoubleLines(context, project, mapping, now);
		for (const record of noteRecords) {
			this._drawNoteBody(
				context,
				record.event,
				record.screen,
				mapping.scale,
				record.visibility,
				record.doubleTap,
			);
		}
		// Sunniesnow keeps all shrinking circles in a separate layer above note bodies.
		for (const record of noteRecords) {
			this._drawApproachCircle(context, record.event, record.screen, mapping.scale, record.visibility);
		}
		for (const { event, position, screen } of records) {
			const radius = sunniesnowNoteRadius(event.type) * mapping.scale;
			const region = {
				type: "event",
				event,
				position,
				x: screen.x - radius,
				y: screen.y - radius,
				width: radius * 2,
				height: radius * 2,
				centerX: screen.x,
				centerY: screen.y,
			};
			if (event.type === "bgNote") {
				region.polygon = Array.from({ length: 6 }, (_, index) => ({
					x: screen.x + Math.cos((index * Math.PI) / 3) * radius,
					y: screen.y + Math.sin((index * Math.PI) / 3) * radius,
				}));
			} else {
				region.radius = radius;
			}
			this.hitRegions.push(region);
		}
	}

	_doubleTapIds(project) {
		return (
			this.renderIndex?.doubleTapIds ||
			new Set(
				sunniesnowTapDoubleLinePairs(project.events, project.channels)
					.flat()
					.map(event => event.id),
			)
		);
	}

	_drawDoubleLines(context, project, mapping, now) {
		const approachSpeed = noteSpeedPreference(this.state);
		const pairs =
			this.renderIndex?.activeDoubleTapPairs(now) ||
			sunniesnowTapDoubleLinePairs(project.events, project.channels).map(([event1, event2]) => ({
				event1,
				event2,
			}));
		for (const pair of pairs) {
			const { event1, event2 } = pair;
			const start = pair.start ?? this.timing.beatToSeconds(event1.time);
			const relativeTime = now - start;
			let progress = 1;
			let alpha = 1;
			const fadeStart = -1 / approachSpeed - 0.25;
			if (relativeTime < fadeStart || relativeTime >= 1 / 3) {
				continue;
			}
			if (relativeTime < -1 / approachSpeed) {
				progress = (relativeTime - fadeStart) / 0.25;
			} else if (relativeTime > 0) {
				alpha = (1 - relativeTime / (1 / 3)) ** 2;
			}
			// Pair positions are cached for indexed playback, but dragging updates the
			// event records in place. Read the current indexed positions first so the
			// line follows a moved tap during lightweight interaction previews.
			const position1 =
				this.renderIndex?.positionFor(event1) ||
				pair.position1 ||
				resolveAttachedPosition(event1, project.snappees) ||
				event1;
			const position2 =
				this.renderIndex?.positionFor(event2) ||
				pair.position2 ||
				resolveAttachedPosition(event2, project.snappees) ||
				event2;
			const point1 = mapping.toScreen(position1);
			const point2 = mapping.toScreen(position2);
			const beginning = {
				x: point1.x + ((point2.x - point1.x) * (1 - progress)) / 2,
				y: point1.y + ((point2.y - point1.y) * (1 - progress)) / 2,
			};
			const ending = {
				x: point1.x + ((point2.x - point1.x) * (1 + progress)) / 2,
				y: point1.y + ((point2.y - point1.y) * (1 + progress)) / 2,
			};
			context.save();
			context.globalAlpha = alpha;
			const selectedEvent = event1.selected ? event1 : event2.selected ? event2 : null;
			context.strokeStyle = selectedEvent ? selectionTintFor(selectedEvent) : "#f9f9e9";
			context.lineWidth = (SUNNIESNOW_SKIN.noteRadius * mapping.scale) / 12;
			context.setLineDash([
				(SUNNIESNOW_SKIN.noteRadius * mapping.scale) / 4,
				(SUNNIESNOW_SKIN.noteRadius * mapping.scale) / 4,
			]);
			context.beginPath();
			context.moveTo(beginning.x, beginning.y);
			context.lineTo(ending.x, ending.y);
			context.stroke();
			context.restore();
		}
	}
}


// The background patterns and the snappee overlays are large enough to live in their own
// modules; their methods are installed onto the prototype so that callers keep seeing one
// class.
installTraitMembers(StageViewCore.prototype, StagePatternsTrait.prototype);
installTraitMembers(StageViewCore.prototype, StageSnappeesTrait.prototype);
