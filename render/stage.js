import { Rational } from "../js/core/rational.js";
import { TimingMap } from "../js/core/timing.js";
import { CHART_BOUNDS, applyTransform, clampPointToChartBounds, findNearestSnapPoint, invertTransform, multiplyTransforms, resolveAttachedPosition, sampleSnappee } from "../js/core/geometry.js";
import { PixiCanvasSurface } from "./pixi-surface.js";

const MOVABLE_TYPES = new Set(["tap", "hold", "drag", "flick", "bgNote"]);
const NOTE_TYPES = new Set(["tap", "hold", "drag", "flick"]);
const PATTERN_TYPES = new Set(["bigText", "grid", "hexagon", "checkerboard", "diamondGrid", "pentagon", "turntable", "hexagram"]);
const DURATION_TYPES = new Set(["hold", "bgNote", ...PATTERN_TYPES]);
const TIP_POINT_SPAWN_TYPES = new Set(["inherit", "chain", "drop", "none"]);
const TIP_POINT_TRAIL_DURATION = 0.5;
const TIP_POINT_ZOOM_DURATION = 0.3;
const TIP_POINT_TRAIL_TAIL_DURATION = 0.1;

// These are the default-skin values in game-unstable/js/ui/event and ui/fx.
export const SUNNIESNOW_SKIN = Object.freeze({
	noteRadius: 12.5,
	noteSize: Object.freeze({ tap: 0.95, hold: 0.95, drag: 0.65, flick: 0.95, bgNote: 0.95 }),
	approachSpeed: 2,
	noteFadeInDuration: 0.25,
	noteFadeOutDuration: 2 / 3,
	bgNoteFadeOutDuration: 0.25,
	patternFadeDuration: 1 / 6,
	backgroundBlur: 20,
	backgroundBrightness: 0.5,
	selectionTint: "#ff2e59",
	tapFill: "#29a9b9",
	tapStroke: "#e8f8b8",
	doubleTapFill: "#3171d1",
	doubleTapStroke: "#e3f3f3",
	holdFill: "#d18cef",
	holdStroke: "#ffffff",
	holdHalo: "#d3e373",
	dragStroke: "#fcfc7c",
	dragOuterStroke: "#ffffcc",
	flickFill: "#fe6e4e",
	flickStroke: "#ffffff",
	flickArrow: "#eece4e",
	flickArrowHighlight: "#fafa7a",
	approachCircle: "#ccfcfc",
	patternStroke: "#ffffef",
});

export function sunniesnowNoteRadius(type) {
	return SUNNIESNOW_SKIN.noteRadius * (SUNNIESNOW_SKIN.noteSize[type] ?? 1);
}

export function sunniesnowPlayfieldScale(width, height) {
	const safeWidth = Math.max(1, Number(width) || 1);
	const safeHeight = Math.max(1, Number(height) || 1);
	return Math.min(safeWidth / 250, safeHeight / 150);
}

export function sunniesnowTapDoubleLinePairs(events) {
	const groups = new Map();
	for (const event of events || []) {
		if (event.type !== "tap") continue;
		const key = Rational.from(event.time).toString();
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(event);
	}
	const pairs = [];
	for (const group of groups.values()) {
		for (let index = 0; index + 1 < group.length; index += 1) {
			pairs.push([group[index], group[index + 1]]);
		}
	}
	return pairs;
}

export function circularArcDraftSpan(beginningAngle, endingAngle) {
	const fullTurn = Math.PI * 2;
	let span = (Number(endingAngle) - Number(beginningAngle)) % fullTurn;
	if (span <= 0) span += fullTurn;
	return span;
}

export function sunniesnowEventVisualState(event, start, end, now) {
	if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(now)) return null;
	const relativeTime = now - start;
	const duration = Math.max(0, end - start);
	const fadeInStart = -1 / SUNNIESNOW_SKIN.approachSpeed - SUNNIESNOW_SKIN.noteFadeInDuration;
	const activeStart = -1 / SUNNIESNOW_SKIN.approachSpeed;
	if (relativeTime < fadeInStart) return null;
	if (relativeTime < activeStart) {
		const progress = (relativeTime - fadeInStart) / SUNNIESNOW_SKIN.noteFadeInDuration;
		return {
			phase: "fadingIn",
			progress,
			start,
			end,
			relativeTime,
			alpha: event.type === "bgNote" ? progress : 1,
		};
	}
	if (relativeTime < 0) {
		return {
			phase: "active",
			progress: relativeTime * SUNNIESNOW_SKIN.approachSpeed + 1,
			start,
			end,
			relativeTime,
			alpha: 1,
		};
	}
	// At the event time the editor deliberately keeps instantaneous notes active,
	// while duration events enter their holding phase, as required by PROMPT-v5.
	if (Math.abs(relativeTime) < 1e-8) {
		return {
			phase: duration > 0 && DURATION_TYPES.has(event.type) ? "holding" : "active",
			progress: duration > 0 && DURATION_TYPES.has(event.type) ? 0 : 1,
			start,
			end,
			relativeTime: 0,
			alpha: 1,
		};
	}
	if (duration > 0 && DURATION_TYPES.has(event.type) && relativeTime < duration) {
		return { phase: "holding", progress: relativeTime / duration, start, end, relativeTime, alpha: 1 };
	}

	let fadeOutDuration = 0;
	if (event.type === "bgNote") fadeOutDuration = SUNNIESNOW_SKIN.bgNoteFadeOutDuration;
	else if (event.type === "flick" || event.type === "hold" || (event.type === "tap" && event.text)) {
		fadeOutDuration = SUNNIESNOW_SKIN.noteFadeOutDuration;
	}
	const fadeStart = duration > 0 && DURATION_TYPES.has(event.type) ? duration : 0;
	if (!(fadeOutDuration > 0) || relativeTime >= fadeStart + fadeOutDuration) return null;
	return {
		phase: "fadingOut",
		progress: Math.max(0, (relativeTime - fadeStart) / fadeOutDuration),
		start,
		end,
		relativeTime,
		alpha: 1,
	};
}

export function sunniesnowPatternVisualState(start, end, now) {
	const fade = SUNNIESNOW_SKIN.patternFadeDuration;
	if (now < start - fade || now >= end + fade) return null;
	if (now < start) return { phase: "fadingIn", progress: (now - start + fade) / fade };
	if (now < end) return { phase: "holding", progress: Math.max(0, (now - start) / Math.max(end - start, 1e-9)) };
	return { phase: "fadingOut", progress: (now - end) / fade };
}

export function sunniesnowDisplayedPattern(events, timing, now) {
	const candidates = (events || [])
		.map((event, sequence) => {
			if (!PATTERN_TYPES.has(event.type)) return null;
			const start = timing.beatToSeconds(event.time);
			const end = timing.beatToSeconds(Rational.from(event.time).add(event.duration || [0, 1, 1]));
			return { event, sequence, start, end };
		})
		.filter(record => record && now >= record.start - SUNNIESNOW_SKIN.patternFadeDuration)
		.sort((left, right) => left.start - right.start || left.sequence - right.sequence);
	const record = candidates.at(-1);
	if (!record) return null;
	const visual = sunniesnowPatternVisualState(record.start, record.end, now);
	return visual ? { ...record, visual } : null;
}

function colorIntegerToCss(value) {
	return `#${Math.max(0, Math.min(0xffffff, value | 0)).toString(16).padStart(6, "0")}`;
}

function randomColor(minimum, maximum) {
	let result = 0;
	for (let index = 0; index < 3; index += 1) {
		const minimumChannel = minimum & 0xff;
		const maximumChannel = maximum & 0xff;
		result |= (Math.floor(Math.random() * (maximumChannel - minimumChannel + 1)) + minimumChannel) << (index * 8);
		minimum >>= 8;
		maximum >>= 8;
	}
	return colorIntegerToCss(result);
}

function projectState(state) {
	return state?.sviber ? { ...state.sviber, metadata: state } : state;
}

function timingFor(state) {
	return new TimingMap(projectState(state)?.timing || {});
}

function currentSeconds(state, timing) {
	const editor = projectState(state).editor;
	return editor.timeSnapped === false
		? Number(editor.currentTime) || 0
		: timing.beatToSeconds(editor.currentTime || [0, 0, 1]);
}

function tipPointSpawnTime(target, settings, timing) {
	const targetTime = timing.beatToSeconds(target.time);
	if (!settings.tipPointSpawnTimeBeats) {
		const duration = Number(settings.tipPointSpawnTime ?? 1);
		return targetTime - Math.max(0, Number.isFinite(duration) ? duration : 1);
	}
	let duration;
	try {
		duration = Rational.from(settings.tipPointSpawnTime ?? 1);
	} catch {
		duration = Rational.from(1);
	}
	if (duration.compare(0) < 0) duration = duration.negate();
	return timing.beatToSeconds(Rational.from(target.time).sub(duration));
}

export function buildTipPointGuides(project, timing) {
	const indexedEvents = (project.events || []).map((event, sequence) => ({ event, sequence }));
	const guides = [];
	for (const channel of project.channels || []) {
		const events = indexedEvents
			.filter(({ event }) => event.channel === channel.id && NOTE_TYPES.has(event.type))
			.sort((left, right) => Rational.compare(left.event.time, right.event.time) || left.sequence - right.sequence);
		let previousMode = "none";
		let previousSettings = null;
		let activeChain = null;
		for (const { event } of events) {
			const declaredMode = TIP_POINT_SPAWN_TYPES.has(event.tipPointSpawnType)
				? event.tipPointSpawnType
				: "inherit";
			const effectiveMode = declaredMode === "inherit" ? previousMode : declaredMode;
			if (effectiveMode === "chain") {
				if (declaredMode === "chain" || !activeChain) {
					previousSettings = event;
					activeChain = { mode: "chain", spawnSettings: event, events: [] };
					guides.push(activeChain);
				}
				activeChain.events.push(event);
			} else if (effectiveMode === "drop") {
				if (declaredMode === "drop" || !previousSettings) previousSettings = event;
				guides.push({ mode: "drop", spawnSettings: previousSettings, events: [event] });
				activeChain = null;
			} else {
				activeChain = null;
				if (effectiveMode === "none") previousSettings = null;
			}

			previousMode = effectiveMode;
			if (declaredMode === "chain" || declaredMode === "drop") previousSettings = event;
			if (declaredMode === "none") {
				previousMode = "none";
				previousSettings = null;
			}
		}
	}
	return guides.map((guide) => {
		const eventTimes = guide.events.map(event => timing.beatToSeconds(event.time));
		return {
			...guide,
			eventTimes,
			spawnTime: tipPointSpawnTime(guide.events[0], guide.spawnSettings, timing),
			endTime: eventTimes[eventTimes.length - 1],
		};
	});
}

function tipPointDirection(checkpoints, index) {
	for (let next = index + 1; next < checkpoints.length; next += 1) {
		const dx = checkpoints[next].x - checkpoints[index].x;
		const dy = checkpoints[next].y - checkpoints[index].y;
		if (dx || dy) return Math.atan2(dy, dx);
	}
	for (let previous = index - 1; previous >= 0; previous -= 1) {
		const dx = checkpoints[index].x - checkpoints[previous].x;
		const dy = checkpoints[index].y - checkpoints[previous].y;
		if (dx || dy) return Math.atan2(dy, dx);
	}
	return -Math.PI / 2;
}

export function sampleTipPointPath(checkpoints, time) {
	if (!checkpoints.length) return null;
	if (time <= checkpoints[0].time) {
		return { ...checkpoints[0], angle: tipPointDirection(checkpoints, 0) };
	}
	const lastIndex = checkpoints.length - 1;
	if (time > checkpoints[lastIndex].time) {
		return { ...checkpoints[lastIndex], angle: tipPointDirection(checkpoints, lastIndex) };
	}
	const nextIndex = checkpoints.findIndex(checkpoint => checkpoint.time >= time);
	const previous = checkpoints[nextIndex - 1];
	const next = checkpoints[nextIndex];
	const duration = next.time - previous.time;
	const progress = duration > 0 ? Math.max(0, Math.min(1, (time - previous.time) / duration)) : 1;
	return {
		time,
		x: previous.x + (next.x - previous.x) * progress,
		y: previous.y + (next.y - previous.y) * progress,
		angle: tipPointDirection(checkpoints, nextIndex - 1),
	};
}

function tipPointPathBetween(checkpoints, beginning, ending) {
	const points = [sampleTipPointPath(checkpoints, beginning)];
	for (const checkpoint of checkpoints) {
		if (checkpoint.time > beginning && checkpoint.time < ending) points.push(checkpoint);
	}
	const last = sampleTipPointPath(checkpoints, ending);
	if (last && (last.time !== points.at(-1)?.time || last.x !== points.at(-1)?.x || last.y !== points.at(-1)?.y)) points.push(last);
	return points.filter(Boolean);
}

export function tipPointVisualState(checkpoints, now) {
	if (!checkpoints.length || !Number.isFinite(now)) return null;
	const startTime = checkpoints[0].time;
	const endTime = checkpoints.at(-1).time;
	if (now < startTime) return null;
	let alpha = 1;
	let scale = 1;
	if (now < startTime + TIP_POINT_ZOOM_DURATION) {
		scale = Math.max(0, (now - startTime) / TIP_POINT_ZOOM_DURATION);
	} else if (now > endTime + TIP_POINT_ZOOM_DURATION) {
		return null;
	} else if (now > endTime) {
		alpha = Math.max(0, 1 - (now - endTime) / TIP_POINT_ZOOM_DURATION);
		scale = alpha;
	}
	const headTime = Math.min(now, endTime);
	const trailBeginning = Math.max(startTime, now - TIP_POINT_TRAIL_DURATION);
	return {
		head: sampleTipPointPath(checkpoints, headTime),
		trail: tipPointPathBetween(checkpoints, trailBeginning, headTime),
		alpha,
		scale,
	};
}

export function drawTipPointTrail(context, points, width, scale = 1, alpha = 1, maximumOpacity = 0.5) {
	if (points.length < 2 || width <= 0) return;
	const startTime = points[0].time;
	const endTime = points.at(-1).time;
	const duration = endTime - startTime;
	if (!(duration > 0)) return;
	const size = Math.max(0, Math.min(1, scale));
	const progressAt = point => Math.max(0, Math.min(1, (point.time - startTime) / duration));
	const halfWidthAt = point => width / 2 * Math.min(size,
		Math.max(0, (point.time - startTime) / TIP_POINT_TRAIL_TAIL_DURATION));
	const opacityAt = point => Math.max(0, Math.min(1, alpha * maximumOpacity * progressAt(point)));

	context.save();
	for (let index = 1; index < points.length; index += 1) {
		const beginning = points[index - 1];
		const ending = points[index];
		if (!(ending.time > beginning.time)) continue;
		const dx = ending.x - beginning.x;
		const dy = ending.y - beginning.y;
		const length = Math.hypot(dx, dy);
		if (!(length > 0)) continue;
		const normalX = -dy / length;
		const normalY = dx / length;
		const beginningWidth = halfWidthAt(beginning);
		const endingWidth = halfWidthAt(ending);
		const beginningOpacity = opacityAt(beginning);
		const endingOpacity = opacityAt(ending);
		const gradient = context.createLinearGradient?.(beginning.x, beginning.y, ending.x, ending.y);
		if (gradient) {
			gradient.addColorStop(0, `rgba(255,255,255,${beginningOpacity})`);
			gradient.addColorStop(1, `rgba(255,255,255,${endingOpacity})`);
			context.fillStyle = gradient;
		} else {
			context.fillStyle = `rgba(255,255,255,${(beginningOpacity + endingOpacity) / 2})`;
		}
		context.beginPath();
		context.moveTo(beginning.x + normalX * beginningWidth, beginning.y + normalY * beginningWidth);
		context.lineTo(ending.x + normalX * endingWidth, ending.y + normalY * endingWidth);
		context.lineTo(ending.x - normalX * endingWidth, ending.y - normalY * endingWidth);
		context.lineTo(beginning.x - normalX * beginningWidth, beginning.y - normalY * beginningWidth);
		context.closePath();
		context.fill();
	}
	for (const point of points.slice(1, -1)) {
		const radius = halfWidthAt(point);
		if (!(radius > 0)) continue;
		context.fillStyle = `rgba(255,255,255,${opacityAt(point)})`;
		context.beginPath();
		context.arc(point.x, point.y, radius, 0, Math.PI * 2);
		context.fill();
	}
	context.restore();
}

function appendPolygonPath(context, centerX, centerY, radius, sides, rotation = 0) {
	for (let index = 0; index < sides; index += 1) {
		const angle = rotation + index * Math.PI * 2 / sides;
		const x = centerX + Math.cos(angle) * radius;
		const y = centerY + Math.sin(angle) * radius;
		if (!index) context.moveTo(x, y); else context.lineTo(x, y);
	}
	context.closePath();
}

function polygonPath(context, centerX, centerY, radius, sides, rotation = 0) {
	context.beginPath();
	appendPolygonPath(context, centerX, centerY, radius, sides, rotation);
}

function selectedEvents(project) {
	return project.events.filter(event => event.selected);
}

function pointInPolygon(point, polygon) {
	let inside = false;
	for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
		const a = polygon[current];
		const b = polygon[previous];
		if ((a.y > point.y) !== (b.y > point.y)
			&& point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
	}
	return inside;
}

export class StageView {
	constructor(host, callbacks = {}) {
		this.host = host;
		this.callbacks = callbacks;
		this.surface = new PixiCanvasSurface(host, {
			background: "#55585b",
			onResize: () => this.render(),
		});
		this.state = null;
		this.timing = null;
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
		this.particles = [];
		this.particleAnimationFrame = 0;
		this.lastHudCombo = null;
		this.hudComboAnimationStarted = null;
		this.boundMove = event => this.#pointerMove(event);
		this.boundUp = event => this.#pointerUp(event);
		this.surface.ready.then(() => {
			this.surface.canvas.addEventListener("pointerdown", event => this.#pointerDown(event));
			this.surface.canvas.addEventListener("pointermove", event => this.#hoverMove(event));
			this.surface.canvas.addEventListener("pointerleave", () => this.#pointerLeave());
			this.surface.canvas.addEventListener("dblclick", event => this.#doubleClick(event));
			this.render();
		});
	}

	setState(state) {
		this.state = state;
		this.timing = timingFor(state);
		this.render();
	}

	setBackground(image) {
		this.backgroundImage = image;
		this.backgroundDirty = true;
		this.render();
	}

	triggerHit(event, delaySeconds = 0) {
		const project = projectState(this.state);
		const position = resolveAttachedPosition(event, project.snappees) || { x: event.x || 0, y: event.y || 0 };
		const flick = event.type === "flick";
		const sparkColors = [0xbfaa00, 0xffff00];
		const contourColors = [0xbfaa00, 0xff7f00];
		this.particles.push({
			x: position.x,
			y: position.y,
			radius: sunniesnowNoteRadius(event.type),
			started: performance.now() + Math.max(0, Number(delaySeconds) || 0) * 1000,
			sparks: Array.from({ length: 20 }, () => ({
				angle: flick
					? Math.random() * Math.PI - Math.PI / 2 - (Number(event.angle) || 0)
					: Math.random() * Math.PI * 2,
				color: randomColor(...sparkColors),
			})),
			contours: Array.from({ length: 3 }, () => ({
				angle: Math.random() * Math.PI * 2,
				color: randomColor(...contourColors),
			})),
		});
		this.#animateParticles();
	}

	cancelScheduledHits() {
		const now = performance.now();
		this.particles = this.particles.filter(particle => particle.started <= now);
		this.render();
	}

	#animateParticles() {
		if (this.particleAnimationFrame) return;
		const animate = () => {
			this.particleAnimationFrame = 0;
			const now = performance.now();
			this.particles = this.particles.filter(particle => now - particle.started < 190);
			this.render();
			if (this.particles.length) this.particleAnimationFrame = requestAnimationFrame(animate);
		};
		this.particleAnimationFrame = requestAnimationFrame(animate);
	}

	render() {
		if (!this.state || !this.surface.context) return;
		if (this.surface.resize()) this.backgroundDirty = true;
		this.surface.render((context, width, height) => this.#draw(context, width, height));
	}

	#mapping(width, height) {
		const scale = sunniesnowPlayfieldScale(width, height);
		return {
			scale,
			originX: width / 2,
			originY: height / 2,
			toScreen: point => ({ x: width / 2 + point.x * scale, y: height / 2 - point.y * scale }),
			toChart: point => ({ x: (point.x - width / 2) / scale, y: (height / 2 - point.y) / scale }),
		};
	}

	#prepareBackground(width, height) {
		if (!this.backgroundDirty && this.backgroundCache.width === width && this.backgroundCache.height === height) return;
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
			source.drawImage(this.backgroundImage, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
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
		padded.fillStyle = source.getImageData(0, 0, 1, 1).data.slice(0, 3).reduce((value, channel) => `${value}${channel.toString(16).padStart(2, "0")}`, "#");
		padded.fillRect(0, 0, padding, padding);
		padded.fillStyle = source.getImageData(width - 1, 0, 1, 1).data.slice(0, 3).reduce((value, channel) => `${value}${channel.toString(16).padStart(2, "0")}`, "#");
		padded.fillRect(padding + width, 0, padding, padding);
		padded.fillStyle = source.getImageData(0, height - 1, 1, 1).data.slice(0, 3).reduce((value, channel) => `${value}${channel.toString(16).padStart(2, "0")}`, "#");
		padded.fillRect(0, padding + height, padding, padding);
		padded.fillStyle = source.getImageData(width - 1, height - 1, 1, 1).data.slice(0, 3).reduce((value, channel) => `${value}${channel.toString(16).padStart(2, "0")}`, "#");
		padded.fillRect(padding + width, padding + height, padding, padding);

		const context = this.backgroundCache.getContext("2d", { alpha: false });
		context.save();
		context.filter = `blur(${SUNNIESNOW_SKIN.backgroundBlur}px) brightness(${SUNNIESNOW_SKIN.backgroundBrightness * 100}%)`;
		context.drawImage(this.backgroundPadded, -padding, -padding);
		context.restore();
		this.backgroundDirty = false;
	}

	#draw(context, width, height) {
		const project = projectState(this.state);
		const mapping = this.#mapping(width, height);
		const now = currentSeconds(this.state, this.timing);
		this.hitRegions = [];
		this.visibleEvents = [];
		this.#prepareBackground(width, height);
		context.drawImage(this.backgroundCache, 0, 0);
		this.#drawBackgroundPatterns(context, project, mapping, now);
		this.#drawBoundary(context, mapping);
		this.#drawHud(context, width, height, project, now);
		this.#drawParticles(context, mapping);
		this.#drawSnappees(context, project, mapping);
		this.#drawNotes(context, project, mapping, now);
		this.#drawTipPoints(context, project, mapping, now);
		this.#drawSelectedInvisible(context, project, mapping, now);
		this.#drawSelectionHandles(context, project, mapping);
		this.#drawFreeTransform(context, mapping);
		this.#drawCreationPreview(context, project, mapping);
		this.#drawCurveDraft(context, mapping);
		if (this.selectionBox) this.#drawSelectionBox(context, this.selectionBox);
	}

	#drawBoundary(context, mapping) {
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

	#eventTimes(event) {
		const start = this.timing.beatToSeconds(event.time);
		const end = DURATION_TYPES.has(event.type)
			? this.timing.beatToSeconds(Rational.from(event.time).add(event.duration || [0, 1, 1]))
			: start;
		return { start, end };
	}

	#drawBackgroundPatterns(context, project, mapping, now) {
		const record = sunniesnowDisplayedPattern(project.events, this.timing, now);
		if (!record) return;
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
		this.#drawPattern(context, record.event, mapping);
		context.restore();
	}

	#drawPattern(context, event, mapping) {
		const center = mapping.toScreen({ x: 0, y: 0 });
		const unit = SUNNIESNOW_SKIN.noteRadius * 2 * mapping.scale;
		const selected = Boolean(event.selected);
		const stroke = selected ? SUNNIESNOW_SKIN.selectionTint : SUNNIESNOW_SKIN.patternStroke;
		context.save();
		context.translate(center.x, center.y);
		if (event.type === "grid") {
			const halfWidth = unit * 4;
			const halfHeight = unit * 2;
			const margin = unit / 10;
			context.fillStyle = selected ? "rgba(255,46,89,0.24)" : "rgba(0,0,0,0.2)";
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
			context.strokeStyle = stroke;
			context.lineWidth = unit / 50;
			context.stroke();
		} else if (event.type === "checkerboard") {
			for (let row = 0; row < 4; row += 1) {
				for (let column = 0; column < 4; column += 1) {
					context.fillStyle = selected
						? `rgba(255,46,89,${(row + column) % 2 ? 0.22 : 0.48})`
						: ((row + column) % 2 ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.4)");
					context.fillRect((row - 2) * unit, (column - 2) * unit, unit, unit);
				}
			}
		} else if (event.type === "turntable") {
			const thickness = unit / 20;
			context.beginPath();
			context.arc(0, 0, unit * 2, 0, Math.PI * 2);
			context.fillStyle = selected ? "rgba(255,46,89,0.24)" : "rgba(0,0,0,0.2)";
			context.fill();
			context.strokeStyle = stroke;
			context.lineWidth = thickness;
			context.stroke();
			context.beginPath();
			context.arc(0, 0, unit * 1.12, 0, Math.PI * 2);
			context.stroke();
			context.beginPath();
			context.arc(0, 0, thickness / 2, 0, Math.PI * 2);
			context.stroke();
		} else if (event.type === "bigText") {
			const baseSize = SUNNIESNOW_SKIN.noteRadius * 10 * mapping.scale;
			const text = String(event.text || "");
			context.font = `${baseSize}px 'Sviber Big Text', 'YujiBoku', 'Noto Sans Math', sans-serif`;
			const measured = context.measureText(text).width;
			const fontSize = baseSize * Math.min(1, 250 * mapping.scale / Math.max(measured, 1));
			context.font = `${fontSize}px 'Sviber Big Text', 'YujiBoku', 'Noto Sans Math', sans-serif`;
			context.textAlign = "center";
			context.textBaseline = "middle";
			context.fillStyle = selected ? SUNNIESNOW_SKIN.selectionTint : "rgba(255,255,255,0.8)";
			context.fillText(text, 0, 0);
		} else if (event.type === "diamondGrid") {
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
			context.strokeStyle = stroke;
			context.lineWidth = unit / 50;
			context.stroke();
		} else if (event.type === "hexagon") {
			const thickness = unit / 20;
			polygonPath(context, 0, 0, unit * 4 / Math.sqrt(3), 6, Math.PI / 2);
			context.fillStyle = selected ? "rgba(255,46,89,0.24)" : "rgba(0,0,0,0.2)";
			context.fill();
			context.strokeStyle = stroke;
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
		} else if (event.type === "pentagon") {
			const thickness = unit / 20;
			const radius = 4 * unit / (1 + Math.cos(Math.PI / 5));
			polygonPath(context, 0, -2 * unit + radius, radius, 5, 0);
			context.fillStyle = selected ? "rgba(255,46,89,0.24)" : "rgba(0,0,0,0.2)";
			context.fill();
			context.strokeStyle = stroke;
			context.lineWidth = thickness;
			context.stroke();
			context.beginPath();
			context.arc(0, 0, thickness / 2, 0, Math.PI * 2);
			context.stroke();
		} else if (event.type === "hexagram") {
			const thickness = unit / 20;
			const points = [];
			for (let index = 0; index < 12; index += 1) {
				const radius = index % 2 ? unit * 2 : unit * 2 / Math.sqrt(3);
				const angle = index * Math.PI / 6;
				points.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
			}
			context.beginPath();
			points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
			context.closePath();
			context.fillStyle = selected ? "rgba(255,46,89,0.24)" : "rgba(0,0,0,0.2)";
			context.fill();
			context.beginPath();
			appendPolygonPath(context, 0, 0, unit * 2, 3, 0);
			appendPolygonPath(context, 0, 0, unit * 2, 3, Math.PI);
			context.strokeStyle = stroke;
			context.lineWidth = thickness;
			context.stroke();
			context.beginPath();
			context.arc(0, 0, thickness / 2, 0, Math.PI * 2);
			context.stroke();
		}
		context.restore();
	}

	#drawSnappees(context, project, mapping) {
		for (const snappee of project.snappees) {
			let points;
			try { points = sampleSnappee(snappee); } catch { continue; }
			if (!points.length) continue;
			context.save();
			context.strokeStyle = snappee.color || "#58b6ef";
			context.fillStyle = snappee.color || "#58b6ef";
			context.globalAlpha = snappee.active ? 0.82 : 0.35;
			context.lineWidth = snappee.selected ? 1.8 : 1;
			if (snappee.type === "rectangularMesh" || snappee.type === "parametricMesh") {
				const byIndex = new Map(points.map(value => [String(value.snapPoint), value]));
				context.beginPath();
				for (const value of points) {
					const [i, j] = value.snapPoint;
					for (const neighbor of [[i + 1, j], [i, j + 1]]) {
						const next = byIndex.get(String(neighbor));
						if (!next) continue;
						const from = mapping.toScreen(value);
						const to = mapping.toScreen(next);
						context.moveTo(from.x, from.y);
						context.lineTo(to.x, to.y);
					}
				}
				context.stroke();
			} else if (snappee.type === "radialMesh") {
				const byRadius = new Map();
				for (const value of points) {
					const [angle, radius] = value.snapPoint;
					if (!byRadius.has(radius)) byRadius.set(radius, []);
					byRadius.get(radius).push({ ...value, angle });
				}
				for (const values of byRadius.values()) {
					if (values.length <= 1) continue;
					context.beginPath();
					values.sort((left, right) => left.angle - right.angle).forEach((value, index) => {
						const point = mapping.toScreen(value);
						if (!index) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
					});
					context.closePath();
					context.stroke();
				}
				const center = points.find(value => value.snapPoint[1] === 0);
				if (center) {
					const origin = mapping.toScreen(center);
					context.beginPath();
					for (const value of points.filter(candidate => candidate.snapPoint[1] === (snappee.radialTiles || 1))) {
						const end = mapping.toScreen(value);
						context.moveTo(origin.x, origin.y);
						context.lineTo(end.x, end.y);
					}
					context.stroke();
				}
			} else {
				context.beginPath();
				points.forEach((value, index) => {
					const point = mapping.toScreen(value);
					if (!index) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
				});
				if (snappee.closed) context.closePath();
				context.stroke();
			}
			for (const value of points) {
				const point = mapping.toScreen(value);
				context.beginPath();
				context.arc(point.x, point.y, snappee.selected ? 2.6 : 1.7, 0, Math.PI * 2);
				context.fill();
			}
			if (snappee.selected) this.#drawSnappeeHandles(context, snappee, points, mapping);
			context.restore();
		}
	}

	#drawSnappeeHandles(context, snappee, points, mapping) {
		let handles = [];
		if (snappee.type === "rectangularMesh") handles = [points[0], points.at(-1)];
		else if (snappee.type === "radialMesh") handles = [points[0], points.find(point => point.snapPoint[1] === (snappee.radialTiles || 1))];
		else if (snappee.type === "regularPolygonCurve") handles = [
			applyTransform({ x: snappee.centerX, y: snappee.centerY }, snappee.transformation),
			points[0],
		];
		else if (snappee.type === "bezierCurve") handles = (snappee.controlPoints || []).map((point, index) => ({
			...applyTransform(point, snappee.transformation), handleIndex: index,
		}));
		else if (snappee.type === "circularArcCurve") handles = [
			{ ...applyTransform({ x: snappee.centerX, y: snappee.centerY }, snappee.transformation), handleIndex: "center" },
			points[0], points.at(-1),
		];
		else if (snappee.type === "penCurve") {
			for (let commandIndex = 0; commandIndex < (snappee.commands || []).length; commandIndex += 1) {
				const command = snappee.commands[commandIndex];
				for (const [x, y] of [["x1", "y1"], ["x2", "y2"], ["x", "y"]]) {
					if (!Number.isFinite(Number(command?.[x])) || !Number.isFinite(Number(command?.[y]))) continue;
					handles.push({
						...applyTransform({ x: Number(command[x]), y: Number(command[y]) }, snappee.transformation),
						handleIndex: { command: commandIndex, x, y },
					});
				}
			}
		}
		for (let index = 0; index < handles.length; index += 1) {
			const handle = handles[index];
			if (!handle) continue;
			const point = mapping.toScreen(handle);
			context.fillStyle = "#f7f8f9";
			context.strokeStyle = "#101215";
			context.lineWidth = 1;
			context.fillRect(point.x - 5, point.y - 5, 10, 10);
			context.strokeRect(point.x - 5, point.y - 5, 10, 10);
			this.hitRegions.push({ type: "snappee-handle", snappee, index: handle.handleIndex ?? index,
				x: point.x - 8, y: point.y - 8, width: 16, height: 16 });
		}
	}

	#noteVisibility(event, now) {
		const { start, end } = this.#eventTimes(event);
		return sunniesnowEventVisualState(event, start, end, now);
	}

	#drawNotes(context, project, mapping, now) {
		const doubleTapIds = this.#doubleTapIds(project);
		const records = [];
		for (const event of project.events) {
			if (!MOVABLE_TYPES.has(event.type)) continue;
			const visibility = this.#noteVisibility(event, now);
			if (!visibility) continue;
			const position = resolveAttachedPosition(event, project.snappees) || { x: Number(event.x) || 0, y: Number(event.y) || 0 };
			const screen = mapping.toScreen(position);
			const record = { event, position, screen, visibility, doubleTap: doubleTapIds.has(event.id) };
			records.push(record);
			this.visibleEvents.push(record);
		}
		for (const record of records.filter(({ event }) => event.type === "bgNote")) {
			this.#drawNoteBody(context, record.event, record.screen, mapping.scale, record.visibility, record.doubleTap);
		}
		this.#drawDoubleLines(context, project, mapping, now);
		for (const record of records.filter(({ event }) => NOTE_TYPES.has(event.type))) {
			this.#drawNoteBody(context, record.event, record.screen, mapping.scale, record.visibility, record.doubleTap);
		}
		// Sunniesnow keeps all shrinking circles in a separate layer above note bodies.
		for (const record of records.filter(({ event }) => NOTE_TYPES.has(event.type))) {
			this.#drawApproachCircle(context, record.event, record.screen, mapping.scale, record.visibility);
		}
		for (const { event, position, screen } of records) {
			const radius = sunniesnowNoteRadius(event.type) * mapping.scale;
			const region = {
				type: "event", event, position,
				x: screen.x - radius, y: screen.y - radius,
				width: radius * 2, height: radius * 2,
				centerX: screen.x, centerY: screen.y,
			};
			if (event.type === "bgNote") {
				region.polygon = Array.from({ length: 6 }, (_, index) => ({
					x: screen.x + Math.cos(index * Math.PI / 3) * radius,
					y: screen.y + Math.sin(index * Math.PI / 3) * radius,
				}));
			} else region.radius = radius;
			this.hitRegions.push(region);
		}
	}

	#doubleTapIds(project) {
		return new Set(sunniesnowTapDoubleLinePairs(project.events).flat().map(event => event.id));
	}

	#drawDoubleLines(context, project, mapping, now) {
		for (const [event1, event2] of sunniesnowTapDoubleLinePairs(project.events)) {
				const start = this.timing.beatToSeconds(event1.time);
				const relativeTime = now - start;
				let progress = 1;
				let alpha = 1;
				const fadeStart = -1 / SUNNIESNOW_SKIN.approachSpeed - 0.25;
				if (relativeTime < fadeStart || relativeTime >= 1 / 3) continue;
				if (relativeTime < -1 / SUNNIESNOW_SKIN.approachSpeed) {
					progress = (relativeTime - fadeStart) / 0.25;
				} else if (relativeTime > 0) alpha = (1 - relativeTime / (1 / 3)) ** 2;
				const position1 = resolveAttachedPosition(event1, project.snappees) || event1;
				const position2 = resolveAttachedPosition(event2, project.snappees) || event2;
				const point1 = mapping.toScreen(position1);
				const point2 = mapping.toScreen(position2);
				const beginning = {
					x: point1.x + (point2.x - point1.x) * (1 - progress) / 2,
					y: point1.y + (point2.y - point1.y) * (1 - progress) / 2,
				};
				const ending = {
					x: point1.x + (point2.x - point1.x) * (1 + progress) / 2,
					y: point1.y + (point2.y - point1.y) * (1 + progress) / 2,
				};
				context.save();
				context.globalAlpha = alpha;
				context.strokeStyle = event1.selected || event2.selected ? SUNNIESNOW_SKIN.selectionTint : "#f9f9e9";
				context.lineWidth = SUNNIESNOW_SKIN.noteRadius * mapping.scale / 12;
				context.setLineDash([SUNNIESNOW_SKIN.noteRadius * mapping.scale / 4, SUNNIESNOW_SKIN.noteRadius * mapping.scale / 4]);
				context.beginPath();
				context.moveTo(beginning.x, beginning.y);
				context.lineTo(ending.x, ending.y);
				context.stroke();
				context.restore();
		}
	}

	#drawNoteBody(context, event, screen, scale, visibility, doubleTap = false, preview = false) {
		const radius = sunniesnowNoteRadius(event.type) * scale;
		const selected = Boolean(event.selected);
		let noteScale = visibility.phase === "fadingIn" ? visibility.progress : 1;
		let noteAlpha = Number.isFinite(visibility.alpha) ? visibility.alpha : 1;
		if (event.type === "hold" && visibility.phase === "holding") {
			noteScale = 1.1 - Math.cos(2 * Math.PI * visibility.relativeTime / 0.27) * 0.1;
		} else if (event.type === "hold" && visibility.phase === "fadingOut") {
			noteScale = 1.1 - Math.cos(2 * Math.PI * (visibility.end - visibility.start) / 0.27) * 0.1;
		} else if (event.type === "bgNote" && visibility.phase === "fadingOut") {
			noteScale = 1 + (3 * (visibility.progress - 1 / 3) ** 2 - 1 / 3) * 0.5;
			noteAlpha = 1 - visibility.progress;
		}
		context.save();
		context.translate(screen.x, screen.y);
		context.scale(noteScale, noteScale);
		context.globalAlpha = noteAlpha * (preview ? 0.58 : 1);
		if (event.type === "hold" && visibility.phase !== "fadingOut") {
			const haloRadius = radius * 1.5;
			context.beginPath();
			if (visibility.phase === "holding") {
				const beginning = -Math.PI / 2 + Math.max(0, Math.min(1, visibility.progress)) * Math.PI * 2;
				context.moveTo(0, 0);
				context.lineTo(Math.cos(beginning) * haloRadius, Math.sin(beginning) * haloRadius);
				context.arc(0, 0, haloRadius, beginning, Math.PI * 3 / 2);
				context.closePath();
			} else context.arc(0, 0, haloRadius, 0, Math.PI * 2);
			context.fillStyle = selected ? "rgba(255,46,89,0.72)" : SUNNIESNOW_SKIN.holdHalo;
			context.fill();
		}

		let bodyVisible = true;
		let bodyScale = 1;
		let bodyAlpha = 1;
		if (visibility.phase === "fadingOut" && ["tap", "flick"].includes(event.type)) bodyVisible = false;
		if (event.type === "hold" && visibility.phase === "fadingOut") {
			const progress = visibility.progress * 2;
			if (progress <= 1) {
				bodyScale = 1 + (1 - (1 - progress) ** 2) * 0.5;
				bodyAlpha = (1 - progress) ** 3;
			} else bodyVisible = false;
		}
		if (bodyVisible) {
			context.save();
			context.scale(bodyScale, bodyScale);
			context.globalAlpha *= bodyAlpha;
		if (event.type === "bgNote") {
			context.fillStyle = selected ? "rgba(255,46,89,0.82)" : "rgba(0,0,0,0.7)";
			polygonPath(context, 0, 0, radius, 6, 0);
			context.fill();
		} else if (event.type === "drag") {
			let lineWidth = radius / 20;
			context.strokeStyle = selected ? "#ffd1da" : SUNNIESNOW_SKIN.dragOuterStroke;
			context.lineWidth = lineWidth;
			context.beginPath();
			context.arc(0, 0, radius - lineWidth / 2, 0, Math.PI * 2);
			context.stroke();
			lineWidth = radius / 9;
			context.strokeStyle = selected ? SUNNIESNOW_SKIN.selectionTint : SUNNIESNOW_SKIN.dragStroke;
			context.lineWidth = lineWidth;
			const radius2 = radius * 3 / 4;
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
		} else {
			const palette = event.type === "tap"
				? (doubleTap
					? [SUNNIESNOW_SKIN.doubleTapFill, SUNNIESNOW_SKIN.doubleTapStroke]
					: [SUNNIESNOW_SKIN.tapFill, SUNNIESNOW_SKIN.tapStroke])
				: event.type === "hold"
					? [SUNNIESNOW_SKIN.holdFill, SUNNIESNOW_SKIN.holdStroke]
					: [SUNNIESNOW_SKIN.flickFill, SUNNIESNOW_SKIN.flickStroke];
			const lineWidth = radius / 8;
			context.fillStyle = selected ? SUNNIESNOW_SKIN.selectionTint : palette[0];
			context.strokeStyle = selected ? "#ffd1da" : palette[1];
			context.lineWidth = lineWidth;
			context.beginPath();
			context.arc(0, 0, radius - lineWidth / 2, 0, Math.PI * 2);
			context.fill();
			context.stroke();
		}
			context.restore();
		}

		if (event.text) {
			let textScaleX = 1;
			let textScaleY = 1;
			let textAlpha = 1;
			let textColor = selected ? SUNNIESNOW_SKIN.selectionTint : "#ffffff";
			if (visibility.phase === "fadingOut" && event.type !== "bgNote") {
				const progress = visibility.progress;
				textColor = selected ? SUNNIESNOW_SKIN.selectionTint : "#ffff55";
				textScaleX = progress < 1 / 4 ? 1 + progress * 4
					: progress < 1 / 2 ? 2 - (progress - 1 / 4) * 2
						: 1.5 + (progress - 1 / 2) * 3;
				textScaleY = progress < 0.5 ? 1 + progress * 2
					: progress < 0.6 ? 2 - (progress - 0.5) * 5
						: 1.5 + (progress - 0.6) / 0.4 * 1.5;
				textAlpha = progress >= 0.5 ? 1 - (progress - 0.5) * 2 : 1;
			}
			const baseFontSize = radius;
			context.font = `${baseFontSize}px 'Sviber Note', 'Noto Sans Math', sans-serif`;
			const measured = context.measureText(String(event.text)).width;
			const fontSize = baseFontSize * Math.min(1, radius * 1.5 / Math.max(measured, 1));
			context.save();
			context.scale(textScaleX, textScaleY);
			context.globalAlpha *= textAlpha;
			context.fillStyle = textColor;
			context.font = `${fontSize}px 'Sviber Note', 'Noto Sans Math', sans-serif`;
			context.textAlign = "center";
			context.textBaseline = "middle";
			context.fillText(String(event.text), 0, 0);
			context.restore();
		}
		if (event.type === "flick") {
			let arrowScale = 1 - 0.05 * Math.cos(visibility.relativeTime * 5);
			let arrowAlpha = visibility.phase === "fadingIn" ? visibility.progress : 1;
			let arrowOffset = 0;
			if (visibility.phase === "fadingOut") {
				const progress = visibility.progress * 2;
				if (progress > 1) arrowAlpha = 0;
				else {
					arrowScale = 1.05;
					arrowAlpha = (1 - progress) ** 3;
					arrowOffset = radius * 2 * (1 - (1 - progress) ** 2);
				}
			}
			if (arrowAlpha > 0) {
				const angle = -(Number(event.angle) || 0);
				context.save();
				context.rotate(angle);
				context.translate(arrowOffset, 0);
				context.scale(arrowScale, arrowScale);
				context.globalAlpha *= arrowAlpha;
				const innerDistance = radius * 1.1;
				const tipDistance = radius * 2;
				context.beginPath();
				context.arc(0, 0, innerDistance, -Math.PI / 4, Math.PI / 4);
				context.lineTo(tipDistance, 0);
				context.closePath();
				context.fillStyle = selected ? SUNNIESNOW_SKIN.selectionTint : SUNNIESNOW_SKIN.flickArrow;
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
		}
		context.restore();
	}

	#drawApproachCircle(context, event, screen, scale, visibility) {
		let circleScale;
		let alpha;
		if (visibility.phase === "fadingIn") {
			circleScale = 1 - (visibility.progress - 1) ** 2;
			alpha = visibility.progress / 3;
		} else if (visibility.phase === "active" && visibility.progress < 1) {
			const targetScale = 1 / 4;
			circleScale = 1 - (1 - targetScale) * visibility.progress;
			alpha = 1 / 3 + 2 / 3 * visibility.progress;
		} else return;
		const radius = sunniesnowNoteRadius(event.type) * 4 * scale * circleScale;
		const lineWidth = sunniesnowNoteRadius(event.type) * scale / 4 * circleScale;
		if (!(radius > 0 && lineWidth > 0)) return;
		context.save();
		context.globalAlpha = alpha;
		context.strokeStyle = event.selected ? SUNNIESNOW_SKIN.selectionTint : SUNNIESNOW_SKIN.approachCircle;
		context.lineWidth = lineWidth;
		context.beginPath();
		context.arc(screen.x, screen.y, Math.max(0, radius - lineWidth / 2), 0, Math.PI * 2);
		context.stroke();
		context.restore();
	}

	#drawSelectedInvisible(context, project, mapping, now) {
		const displayedPattern = sunniesnowDisplayedPattern(project.events, this.timing, now)?.event;
		for (const event of project.events) {
			if (!event.selected) continue;
			if (MOVABLE_TYPES.has(event.type)) {
				if (this.#noteVisibility(event, now)) continue;
				const position = resolveAttachedPosition(event, project.snappees) || { x: event.x || 0, y: event.y || 0 };
				const screen = mapping.toScreen(position);
				const radius = sunniesnowNoteRadius(event.type) * mapping.scale;
				context.save();
				context.strokeStyle = SUNNIESNOW_SKIN.selectionTint;
				context.lineWidth = 2;
				context.globalAlpha = 0.72;
				context.setLineDash([4, 3]);
				if (event.type === "bgNote") polygonPath(context, screen.x, screen.y, radius, 6, 0);
				else {
					context.beginPath();
					context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
				}
				context.stroke();
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

	#drawSelectionHandles(context, project, mapping) {
		if (this.callbacks.getFreeTransform?.()) return;
		const selected = selectedEvents(project).filter(event => MOVABLE_TYPES.has(event.type));
		if (selected.length !== 1) return;
		const event = selected[0];
		const position = resolveAttachedPosition(event, project.snappees) || { x: event.x || 0, y: event.y || 0 };
		const screen = mapping.toScreen(position);
		if (event.type === "flick") {
			const angle = Number(event.angle) || 0;
			const visibility = this.#noteVisibility(event, currentSeconds(this.state, this.timing));
			const pulse = visibility && visibility.phase !== "fadingOut"
				? 1 - 0.05 * Math.cos(visibility.relativeTime * 5)
				: 1;
			const distance = sunniesnowNoteRadius("flick") * 2 * pulse * mapping.scale;
			const handle = { x: screen.x + Math.cos(angle) * distance, y: screen.y - Math.sin(angle) * distance };
			this.#drawDiamond(context, handle.x, handle.y, 6);
			this.hitRegions.push({ type: "flick-handle", event, x: handle.x - 10, y: handle.y - 10, width: 20, height: 20 });
		}
		const tipGuide = NOTE_TYPES.has(event.type)
			? buildTipPointGuides(project, this.timing).find(guide => guide.events[0] === event
				&& (guide.mode === "drop" || guide.spawnSettings === event))
			: null;
		if (tipGuide) {
			const spawn = this.#tipSpawnPosition(tipGuide.spawnSettings, position, project);
			if (spawn) {
				const handle = mapping.toScreen(spawn);
				context.strokeStyle = "rgba(255,255,255,0.72)";
				context.lineWidth = 2;
				context.beginPath();
				context.moveTo(handle.x, handle.y);
				context.lineTo(screen.x, screen.y);
				context.stroke();
				this.#drawDiamond(context, handle.x, handle.y, 6);
				this.hitRegions.push({
					type: "tip-handle",
					event,
					settingsEvent: tipGuide.spawnSettings,
					x: handle.x - 10,
					y: handle.y - 10,
					width: 20,
					height: 20,
				});
			}
		}
	}

	#freeTransformGeometry(mapping) {
		const descriptor = this.callbacks.getFreeTransform?.();
		if (!descriptor?.bounds || !Array.isArray(descriptor.matrix)) return null;
		const { minX, maxX, minY, maxY } = descriptor.bounds;
		const original = [
			{ x: minX, y: maxY }, { x: maxX, y: maxY },
			{ x: maxX, y: minY }, { x: minX, y: minY },
		];
		const chart = original.map(point => applyTransform(point, descriptor.matrix));
		const screen = chart.map(mapping.toScreen);
		const centerChart = applyTransform({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, descriptor.matrix);
		const topChart = applyTransform({ x: (minX + maxX) / 2, y: maxY }, descriptor.matrix);
		const center = mapping.toScreen(centerChart);
		const top = mapping.toScreen(topChart);
		const length = Math.hypot(top.x - center.x, top.y - center.y) || 1;
		const rotate = {
			x: top.x + (top.x - center.x) / length * 28,
			y: top.y + (top.y - center.y) / length * 28,
		};
		return { descriptor, original, chart, screen, centerChart, center, top, rotate };
	}

	#drawFreeTransform(context, mapping) {
		const geometry = this.#freeTransformGeometry(mapping);
		if (!geometry) return;
		context.save();
		context.strokeStyle = "#72adff";
		context.fillStyle = "#f7f8f9";
		context.lineWidth = 1.5;
		context.setLineDash([5, 3]);
		context.beginPath();
		geometry.screen.forEach((point, index) => {
			if (!index) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
		});
		context.closePath();
		context.stroke();
		context.setLineDash([]);
		context.beginPath();
		context.moveTo(geometry.top.x, geometry.top.y);
		context.lineTo(geometry.rotate.x, geometry.rotate.y);
		context.stroke();
		context.beginPath();
		context.arc(geometry.rotate.x, geometry.rotate.y, 5, 0, Math.PI * 2);
		context.fill();
		context.stroke();
		this.hitRegions.push({ type: "free-move", polygon: geometry.screen });
		this.hitRegions.push({ type: "free-rotate", x: geometry.rotate.x - 10, y: geometry.rotate.y - 10, width: 20, height: 20 });
		geometry.screen.forEach((point, index) => {
			context.fillRect(point.x - 5, point.y - 5, 10, 10);
			context.strokeRect(point.x - 5, point.y - 5, 10, 10);
			this.hitRegions.push({ type: "free-scale", index, x: point.x - 10, y: point.y - 10, width: 20, height: 20 });
		});
		context.restore();
	}

	#drawDiamond(context, x, y, size) {
		context.save();
		context.translate(x, y);
		context.rotate(Math.PI / 4);
		context.fillStyle = "#f8f9fa";
		context.strokeStyle = "#15171a";
		context.lineWidth = 1;
		context.fillRect(-size / 2, -size / 2, size, size);
		context.strokeRect(-size / 2, -size / 2, size, size);
		context.restore();
	}

	#tipSpawnPosition(event, eventPosition, project) {
		if (event.tipPointSpawnAbsolutePosition) {
			const attached = resolveAttachedPosition(event, project.snappees, { prefix: "tipPointSpawn" });
			if (attached) return attached;
			const x = Number(event.tipPointSpawnX);
			const y = Number(event.tipPointSpawnY);
			return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 100 };
		}
		const providedDistance = Number(event.tipPointSpawnDistance ?? 100);
		const providedAngle = Number(event.tipPointSpawnAngle ?? Math.PI / 2);
		const distance = Math.max(0, Number.isFinite(providedDistance) ? providedDistance : 100);
		const angle = Number.isFinite(providedAngle) ? providedAngle : Math.PI / 2;
		return {
			x: eventPosition.x + Math.cos(angle) * distance,
			y: eventPosition.y + Math.sin(angle) * distance,
		};
	}

	#tipHandleEditPoint(hit, point, project) {
		const settingsEvent = hit.settingsEvent || hit.event;
		if (settingsEvent === hit.event || settingsEvent.tipPointSpawnAbsolutePosition) return point;
		const target = resolveAttachedPosition(hit.event, project.snappees) || hit.event;
		const source = resolveAttachedPosition(settingsEvent, project.snappees) || settingsEvent;
		return {
			x: (Number(source.x) || 0) + point.x - (Number(target.x) || 0),
			y: (Number(source.y) || 0) + point.y - (Number(target.y) || 0),
		};
	}

	#drawTipPointMarker(context, point, radius, scale) {
		if (!point || scale <= 0) return;
		context.save();
		context.translate(point.x, point.y);
		context.rotate(Number.isFinite(point.angle) ? point.angle : -Math.PI / 2);
		context.scale(scale, scale);
		context.fillStyle = "#000000";
		context.beginPath();
		context.arc(0, 0, radius, 0, Math.PI * 2);
		context.fill();
		const unit = radius / Math.sqrt(2);
		context.beginPath();
		context.moveTo(unit, unit);
		context.lineTo(unit * 2, 0);
		context.lineTo(unit, -unit);
		context.closePath();
		context.fill();
		context.beginPath();
		context.arc(0, 0, unit, 0, Math.PI * 2);
		context.strokeStyle = "#ffff00";
		context.lineWidth = radius / 10;
		context.stroke();
		context.restore();
	}

	#drawTipPoints(context, project, mapping, now) {
		for (const guide of buildTipPointGuides(project, this.timing)) {
			const firstPosition = resolveAttachedPosition(guide.events[0], project.snappees) || guide.events[0];
			const spawn = this.#tipSpawnPosition(guide.spawnSettings, firstPosition, project);
			const checkpoints = [
				{ ...mapping.toScreen(spawn), time: guide.spawnTime },
				...guide.events.map((event, index) => ({
					...mapping.toScreen(resolveAttachedPosition(event, project.snappees) || event),
					time: guide.eventTimes[index],
				})),
			];
			const visual = tipPointVisualState(checkpoints, now);
			if (!visual) continue;
			context.save();
			const markerRadius = SUNNIESNOW_SKIN.noteRadius / 3 * mapping.scale;
			const trailWidth = markerRadius * 2 / 1.5;
			drawTipPointTrail(context, visual.trail, trailWidth, visual.scale, visual.alpha);
			this.#drawTipPointMarker(context, visual.head, markerRadius, visual.scale);
			context.restore();
		}
	}

	#drawCreationPreview(context, project, mapping) {
		const type = this.callbacks.getCreationMode?.();
		if (!type || !this.creationPreview || !MOVABLE_TYPES.has(type)) return;
		const event = { type, text: "", angle: this.callbacks.getDefaultFlickAngle?.() ?? Math.PI / 2 };
		const screen = mapping.toScreen(this.creationPreview);
		this.#drawNoteBody(context, event, screen, mapping.scale, {
			phase: "active", progress: 1, alpha: 1, relativeTime: 0, start: 0, end: 0,
		}, false, true);
		if (this.creationPreview.snappee) {
			context.strokeStyle = this.creationPreview.snappee.color || "#56db79";
			context.lineWidth = 2;
			context.beginPath();
			context.arc(screen.x, screen.y, 17 * mapping.scale, 0, Math.PI * 2);
			context.stroke();
		}
	}

	#drawCurveDraft(context, mapping) {
		const draft = this.callbacks.getCurveDraft?.();
		if (!draft?.points?.length) return;
		const previewPoints = this.curvePreview ? [...draft.points, this.curvePreview] : draft.points;
		context.save();
		context.strokeStyle = draft.color || "#53baf0";
		context.fillStyle = "#f6f8f9";
		context.lineWidth = 1.5;
		if (draft.type === "circularArcCurve" && draft.points.length === 1 && this.curvePreview) {
			context.globalAlpha = 0.4;
		}
		context.beginPath();
		if (draft.type === "penCurve" && draft.penNodes?.length) {
			const nodes = draft.penNodes;
			const first = mapping.toScreen(nodes[0]);
			context.moveTo(first.x, first.y);
			for (let index = 1; index < nodes.length; index += 1) {
				const previous = nodes[index - 1];
				const current = nodes[index];
				const end = mapping.toScreen(current);
				if (previous.outgoing || current.incoming) {
					const control1 = mapping.toScreen(previous.outgoing || previous);
					const control2 = mapping.toScreen(current.incoming || current);
					context.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
				} else context.lineTo(end.x, end.y);
			}
			if (draft.closed && nodes.length > 1) {
				const previous = nodes.at(-1);
				const current = nodes[0];
				if (previous.outgoing || current.incoming) {
					const control1 = mapping.toScreen(previous.outgoing || previous);
					const control2 = mapping.toScreen(current.incoming || current);
					context.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, first.x, first.y);
				} else context.lineTo(first.x, first.y);
			} else if (this.curvePreview) {
				const previous = nodes.at(-1);
				const end = mapping.toScreen(this.curvePreview);
				if (previous.outgoing) {
					const control = mapping.toScreen(previous.outgoing);
					context.bezierCurveTo(control.x, control.y, end.x, end.y, end.x, end.y);
				} else context.lineTo(end.x, end.y);
			}
		} else if (draft.type === "bezierCurve" && previewPoints.length > 1) {
			const evaluate = progress => {
				const points = previewPoints.map(point => ({ ...point }));
				for (let level = points.length - 1; level > 0; level -= 1) {
					for (let index = 0; index < level; index += 1) {
						points[index].x += (points[index + 1].x - points[index].x) * progress;
						points[index].y += (points[index + 1].y - points[index].y) * progress;
					}
				}
				return points[0];
			};
			for (let step = 0; step <= 96; step += 1) {
				const screen = mapping.toScreen(evaluate(step / 96));
				if (!step) context.moveTo(screen.x, screen.y); else context.lineTo(screen.x, screen.y);
			}
		} else if (draft.type === "circularArcCurve" && previewPoints.length >= 2) {
			const [center, beginning, ending] = previewPoints;
			const radius = Math.hypot(beginning.x - center.x, beginning.y - center.y);
			const start = Math.atan2(beginning.y - center.y, beginning.x - center.x);
			const end = ending ? Math.atan2(ending.y - center.y, ending.x - center.x) : start + Math.PI * 2;
			const span = circularArcDraftSpan(start, end);
			for (let step = 0; step <= 96; step += 1) {
				const angle = start + span * step / 96;
				const screen = mapping.toScreen({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
				if (!step) context.moveTo(screen.x, screen.y); else context.lineTo(screen.x, screen.y);
			}
		} else {
			previewPoints.forEach((point, index) => {
				const screen = mapping.toScreen(point);
				if (!index) context.moveTo(screen.x, screen.y); else context.lineTo(screen.x, screen.y);
			});
		}
		context.stroke();
		if (draft.type === "penCurve") {
			for (let index = 0; index < (draft.penNodes || []).length; index += 1) {
				const node = draft.penNodes[index];
				const anchor = mapping.toScreen(node);
				for (const kind of ["incoming", "outgoing"]) {
					if (!node[kind]) continue;
					const handle = mapping.toScreen(node[kind]);
					context.beginPath();
					context.moveTo(anchor.x, anchor.y);
					context.lineTo(handle.x, handle.y);
					context.strokeStyle = "rgba(246,248,249,0.72)";
					context.lineWidth = 1;
					context.stroke();
					context.beginPath();
					context.arc(handle.x, handle.y, 4, 0, Math.PI * 2);
					context.fill();
					this.hitRegions.push({ type: "draft-pen-handle", index, kind,
						x: handle.x - 7, y: handle.y - 7, width: 14, height: 14 });
				}
			}
		}
		for (let index = 0; index < draft.points.length; index += 1) {
			const point = draft.points[index];
			const screen = mapping.toScreen(point);
			context.fillRect(screen.x - 4, screen.y - 4, 8, 8);
			this.hitRegions.push({ type: "draft-point", index, x: screen.x - 8, y: screen.y - 8, width: 16, height: 16 });
		}
		context.restore();
	}

	#drawParticles(context, mapping) {
		const now = performance.now();
		this.particles = this.particles.filter(particle => now - particle.started < 190);
		for (const particle of this.particles) {
			const elapsed = now - particle.started;
			if (elapsed < 0) continue;
			const frames = elapsed / (1000 / 60);
			const alpha = Math.max(0, 1 - frames * 0.1);
			if (!(alpha > 0)) continue;
			const screen = mapping.toScreen(particle);
			const radius = particle.radius * mapping.scale;
			context.save();
			context.globalAlpha = alpha;
			for (const spark of particle.sparks) {
				const distance = frames * radius / 2;
				context.strokeStyle = spark.color;
				context.lineWidth = radius / 20;
				context.beginPath();
				context.moveTo(screen.x + Math.cos(spark.angle) * distance, screen.y + Math.sin(spark.angle) * distance);
				context.lineTo(screen.x + Math.cos(spark.angle) * (distance + radius * 2),
					screen.y + Math.sin(spark.angle) * (distance + radius * 2));
				context.stroke();
			}
			for (const contour of particle.contours) {
				const contourScale = 1 + frames * 0.2;
				context.save();
				context.translate(screen.x, screen.y);
				context.rotate(contour.angle);
				context.strokeStyle = contour.color;
				context.lineWidth = radius / 10 * contourScale;
				context.beginPath();
				context.arc(0, 0, radius * 1.5 * contourScale, -Math.PI / 6, Math.PI / 6);
				context.stroke();
				context.restore();
			}
			context.restore();
		}
	}

	#drawHud(context, width, height, project, now) {
		const metadata = project.metadata || this.state;
		const unit = width / 60;
		const drawBackground = mirrored => {
			context.save();
			if (mirrored) {
				context.translate(width, 0);
				context.scale(-1, 1);
			}
			context.beginPath();
			context.moveTo(0, 0);
			context.lineTo(20 * unit, 0);
			context.lineTo(22 * unit, 2 * unit);
			context.lineTo(20 * unit, 4 * unit);
			context.lineTo(0, 4 * unit);
			context.closePath();
			context.fillStyle = "rgba(0,0,0,0.5)";
			context.fill();
			context.beginPath();
			context.moveTo(20 * unit, 2 * unit);
			context.lineTo(19 * unit, 3 * unit);
			context.lineTo(18 * unit, 2 * unit);
			context.lineTo(20 * unit, 0);
			context.lineTo(22 * unit, 2 * unit);
			context.lineTo(20 * unit, 4 * unit);
			context.lineTo(0, 4 * unit);
			context.lineTo(0, 0);
			context.lineTo(20 * unit, 0);
			context.strokeStyle = "#ffffff";
			context.lineWidth = unit / 6;
			context.stroke();
			context.restore();
		};
		context.save();
		drawBackground(false);
		drawBackground(true);
		const hudFont = width / 45;
		const title = String(metadata.title || "");
		context.font = `${hudFont}px 'Noto Sans Math', 'Noto Sans CJK TC', sans-serif`;
		const titleWidth = context.measureText(title).width;
		const titleFont = hudFont * Math.min(1, 13 * unit / Math.max(titleWidth, 1));
		context.font = `${titleFont}px 'Noto Sans Math', 'Noto Sans CJK TC', sans-serif`;
		context.fillStyle = "#ffffff";
		context.textBaseline = "middle";
		context.textAlign = "left";
		context.fillText(title, 4 * unit, 2 * unit);

		const playable = project.events.filter(event => NOTE_TYPES.has(event.type));
		const hitCount = playable.filter(event => {
			const { start, end } = this.#eventTimes(event);
			return now >= (event.type === "hold" ? end : start);
		}).length;
		const score = playable.length ? Math.floor(1_000_000 * hitCount / playable.length) : 0;
		context.textAlign = "right";
		context.font = `${hudFont}px 'Noto Sans Math', 'Noto Sans CJK TC', sans-serif`;
		context.fillStyle = "#ffffff";
		context.fillText(String(score), width - 2 * unit, 2 * unit);
		context.textAlign = "left";
		context.fillStyle = metadata.difficultyColor || "#7f7f7f";
		context.fillText(String(metadata.difficultyName || ""), width - 15 * unit, 2 * unit);

		const playing = Boolean(this.callbacks.isPlaying?.());
		if (hitCount !== this.lastHudCombo) {
			this.lastHudCombo = hitCount;
			this.hudComboAnimationStarted = playing ? performance.now() : null;
		}
		if (!playing) this.hudComboAnimationStarted = null;
		if (hitCount > 0) {
			let scaleX = 1;
			let scaleY = 1;
			if (this.hudComboAnimationStarted != null) {
				const animationFrames = (performance.now() - this.hudComboAnimationStarted) / (1000 / 60);
				scaleX += 0.6 * Math.exp(-0.6 * animationFrames);
				scaleY += 0.5 * Math.exp(-0.5 * animationFrames);
			}
			context.save();
			context.translate(width / 2, width / 18);
			context.scale(scaleX, scaleY);
			context.textAlign = "center";
			context.fillStyle = "#ffffff";
			context.font = `${width / 30}px 'Noto Sans Math', 'Noto Sans CJK TC', sans-serif`;
			context.textBaseline = "bottom";
			context.fillText(String(hitCount), 0, 0);
			context.fillStyle = "#ffff00";
			context.font = `${width / 45}px 'Noto Sans Math', 'Noto Sans CJK TC', sans-serif`;
			context.textBaseline = "top";
			context.fillText("⟐ Autoplay ⟐", 0, 0);
			context.restore();
		}

		const bounds = this.callbacks.getTimeBounds?.() || [0, 10];
		const progress = Math.max(0, Math.min(1, (now - bounds[0]) / Math.max(0.001, bounds[1] - bounds[0])));
		const barHeight = width / 200;
		context.fillStyle = "rgba(255,255,255,0.5)";
		context.fillRect(0, height - barHeight, width, barHeight);
		context.fillStyle = "#c3efec";
		context.fillRect(0, height - barHeight, width * progress, barHeight);
		context.restore();
	}

	#drawSelectionBox(context, rectangle) {
		const x = Math.min(rectangle.x1, rectangle.x2);
		const y = Math.min(rectangle.y1, rectangle.y2);
		const width = Math.abs(rectangle.x2 - rectangle.x1);
		const height = Math.abs(rectangle.y2 - rectangle.y1);
		context.fillStyle = "rgba(48,134,255,0.17)";
		context.strokeStyle = "#72adff";
		context.lineWidth = 1;
		context.fillRect(x, y, width, height);
		context.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, width, height);
	}

	#hitTest(point) {
		const priorities = ["free-scale", "free-rotate", "free-move", "draft-pen-handle", "draft-point", "flick-handle", "tip-handle", "snappee-handle", "event"];
		for (const type of priorities) {
			for (let index = this.hitRegions.length - 1; index >= 0; index -= 1) {
				const region = this.hitRegions[index];
				if (region.type !== type) continue;
				if (region.polygon) {
					if (!pointInPolygon(point, region.polygon)) continue;
				} else if (point.x < region.x || point.x > region.x + region.width
					|| point.y < region.y || point.y > region.y + region.height) continue;
				if (type === "event" && !region.polygon
					&& Math.hypot(point.x - region.centerX, point.y - region.centerY) > region.radius) continue;
				return region;
			}
		}
		return null;
	}

	#previewAt(screenPoint) {
		const project = projectState(this.state);
		const mapping = this.#mapping(this.surface.width, this.surface.height);
		const raw = mapping.toChart(screenPoint);
		const allowOutOfBounds = Boolean(project.editor?.allowOutOfBounds);
		const target = allowOutOfBounds ? raw : clampPointToChartBounds(raw);
		const snap = findNearestSnapPoint(target, project.snappees, {
			activeOnly: true,
			maxDistance: 9 / mapping.scale,
			bounds: allowOutOfBounds ? undefined : CHART_BOUNDS,
		});
		this.creationPreview = snap ? { ...snap, snappee: snap.snappee } : target;
		this.callbacks.onCreationPreview?.(this.creationPreview);
	}

	#hoverMove(event) {
		if (this.drag) return;
		const draft = this.callbacks.getCurveDraft?.();
		if (draft) {
			const mapping = this.#mapping(this.surface.width, this.surface.height);
			const chart = mapping.toChart(this.surface.toLocal(event));
			const project = projectState(this.state);
			const snap = findNearestSnapPoint(chart, project.snappees, { activeOnly: true, maxDistance: 9 / mapping.scale });
			this.curvePreview = snap ? { x: snap.x, y: snap.y } : chart;
			this.render();
		} else if (this.callbacks.getCreationMode?.()) {
			this.#previewAt(this.surface.toLocal(event));
			this.render();
		}
	}

	#pointerLeave() {
		if (this.drag) return;
		this.creationPreview = null;
		this.curvePreview = null;
		this.callbacks.onCreationPreview?.(null);
		this.render();
	}

	#pointerDown(event) {
		if (event.button !== 0) return;
		if (this.callbacks.isPlaying?.()) return;
		event.preventDefault();
		const point = this.surface.toLocal(event);
		const project = projectState(this.state);
		const mapping = this.#mapping(this.surface.width, this.surface.height);
		this.pointerMoved = false;
		const creationMode = this.callbacks.getCreationMode?.();
		if (creationMode && MOVABLE_TYPES.has(creationMode)) {
			this.#previewAt(point);
			if (this.creationPreview) this.callbacks.onCreateEvent?.(creationMode, this.creationPreview);
			return;
		}
		const hit = this.#hitTest(point);
		const curveDraft = this.callbacks.getCurveDraft?.();
		if (curveDraft) {
			if (hit?.type === "draft-pen-handle") {
				this.drag = { type: "draft-pen-handle", hit, start: point };
				document.addEventListener("pointermove", this.boundMove);
				document.addEventListener("pointerup", this.boundUp, { once: true });
				document.addEventListener("pointercancel", this.boundUp, { once: true });
			} else if (hit?.type === "draft-point") {
				this.drag = { type: "draft-point", hit, start: point };
				document.addEventListener("pointermove", this.boundMove);
				document.addEventListener("pointerup", this.boundUp, { once: true });
				document.addEventListener("pointercancel", this.boundUp, { once: true });
			} else if (curveDraft.type === "penCurve") {
				const chart = mapping.toChart(point);
				const snap = findNearestSnapPoint(chart, project.snappees, { activeOnly: true, maxDistance: 9 / mapping.scale });
				const anchor = snap ? { x: snap.x, y: snap.y } : chart;
				const index = this.callbacks.onPenNodeStart?.(anchor);
				if (Number.isInteger(index)) {
					this.drag = { type: "pen-new", index, start: point };
					document.addEventListener("pointermove", this.boundMove);
					document.addEventListener("pointerup", this.boundUp, { once: true });
					document.addEventListener("pointercancel", this.boundUp, { once: true });
				}
			} else {
				this.callbacks.onCurvePoint?.(mapping.toChart(point), false);
			}
			return;
		}
		const freeTransform = this.callbacks.getFreeTransform?.();
		if (freeTransform) {
			if (!hit?.type?.startsWith("free-")) return;
			const chart = mapping.toChart(point);
			this.drag = {
				type: hit.type,
				hit,
				start: point,
				startChart: chart,
				matrix: [...freeTransform.matrix],
				bounds: { ...freeTransform.bounds },
			};
			if (hit.type === "free-scale") {
				try { this.drag.startLocal = applyTransform(chart, invertTransform(this.drag.matrix)); } catch { this.drag = null; return; }
			}
		} else if (hit?.type === "event") {
			if (event.altKey) {
				this.callbacks.onSelectEvents?.([hit.event.id], "remove");
				return;
			}
			if (event.ctrlKey && !hit.event.selected) this.callbacks.onSelectEvents?.([hit.event.id], "add");
			else if (!event.ctrlKey && !hit.event.selected) this.callbacks.onSelectEvents?.([hit.event.id], "replace");
			this.drag = { type: "event", hit, start: point, startChart: hit.position,
				collapseSelectionOnClick: !event.ctrlKey && Boolean(hit.event.selected) };
		} else if (hit?.type === "flick-handle") {
			this.drag = { type: "flick", hit, start: point };
		} else if (hit?.type === "tip-handle") {
			this.drag = { type: "tip", hit, start: point };
		} else if (hit?.type === "snappee-handle") {
			this.drag = { type: "snappee", hit, start: point };
		} else {
			this.drag = { type: "box", start: point, mode: event.altKey ? "remove" : event.ctrlKey ? "add" : "replace" };
			this.selectionBox = { x1: point.x, y1: point.y, x2: point.x, y2: point.y };
		}
		document.addEventListener("pointermove", this.boundMove);
		document.addEventListener("pointerup", this.boundUp, { once: true });
		document.addEventListener("pointercancel", this.boundUp, { once: true });
	}

	#freeTransformMatrix(drag, chart, event) {
		if (drag.type === "free-move") {
			return multiplyTransforms([1, 0, 0, 1, chart.x - drag.startChart.x, chart.y - drag.startChart.y], drag.matrix);
		}
		if (drag.type === "free-rotate") {
			const center = applyTransform({
				x: (drag.bounds.minX + drag.bounds.maxX) / 2,
				y: (drag.bounds.minY + drag.bounds.maxY) / 2,
			}, drag.matrix);
			const beginning = Math.atan2(drag.startChart.y - center.y, drag.startChart.x - center.x);
			let angle = Math.atan2(chart.y - center.y, chart.x - center.x) - beginning;
			if (event.shiftKey) angle = Math.round(angle / (Math.PI / 12)) * Math.PI / 12;
			const cosine = Math.cos(angle);
			const sine = Math.sin(angle);
			const rotation = [cosine, sine, -sine, cosine,
				center.x - cosine * center.x + sine * center.y,
				center.y - sine * center.x - cosine * center.y];
			return multiplyTransforms(rotation, drag.matrix);
		}
		if (drag.type === "free-scale") {
			let local;
			try { local = applyTransform(chart, invertTransform(drag.matrix)); } catch { return drag.matrix; }
			const corners = [
				{ x: drag.bounds.minX, y: drag.bounds.maxY }, { x: drag.bounds.maxX, y: drag.bounds.maxY },
				{ x: drag.bounds.maxX, y: drag.bounds.minY }, { x: drag.bounds.minX, y: drag.bounds.minY },
			];
			const anchor = corners[(drag.hit.index + 2) % 4];
			const startX = drag.startLocal.x - anchor.x;
			const startY = drag.startLocal.y - anchor.y;
			let scaleX = Math.abs(startX) < 1e-8 ? 1 : (local.x - anchor.x) / startX;
			let scaleY = Math.abs(startY) < 1e-8 ? 1 : (local.y - anchor.y) / startY;
			if (event.shiftKey) {
				const magnitude = Math.max(Math.abs(scaleX), Math.abs(scaleY));
				scaleX = Math.sign(scaleX || 1) * magnitude;
				scaleY = Math.sign(scaleY || 1) * magnitude;
			}
			if (Math.abs(scaleX) < 0.01 || Math.abs(scaleY) < 0.01) return drag.matrix;
			return multiplyTransforms(drag.matrix, [scaleX, 0, 0, scaleY,
				anchor.x * (1 - scaleX), anchor.y * (1 - scaleY)]);
		}
		return drag.matrix;
	}

	#pointerMove(event) {
		if (!this.drag) return;
		const point = this.surface.toLocal(event);
		if (Math.hypot(point.x - this.drag.start.x, point.y - this.drag.start.y) > 3) this.pointerMoved = true;
		const project = projectState(this.state);
		const mapping = this.#mapping(this.surface.width, this.surface.height);
		const chart = mapping.toChart(point);
		if (this.drag.type.startsWith("free-")) {
			this.callbacks.onPreviewFreeTransform?.(this.#freeTransformMatrix(this.drag, chart, event));
		} else if (this.drag.type === "event") {
			const allowOutOfBounds = Boolean(project.editor?.allowOutOfBounds);
			const target = allowOutOfBounds ? chart : clampPointToChartBounds(chart);
			const snap = findNearestSnapPoint(target, project.snappees, { activeOnly: true, maxDistance: 9 / mapping.scale,
				bounds: allowOutOfBounds ? undefined : CHART_BOUNDS });
			this.callbacks.onPreviewPosition?.(this.drag.hit.event.id, snap || target);
		} else if (this.drag.type === "flick") {
			const position = resolveAttachedPosition(this.drag.hit.event, project.snappees) || this.drag.hit.event;
			const angle = Math.round(Math.atan2(chart.y - position.y, chart.x - position.x) / (Math.PI / 4)) * Math.PI / 4;
			this.callbacks.onPreviewFlickAngle?.(this.drag.hit.event.id, angle);
		} else if (this.drag.type === "tip") {
			const settingsEvent = this.drag.hit.settingsEvent || this.drag.hit.event;
			this.callbacks.onPreviewTipSpawn?.(settingsEvent.id, this.#tipHandleEditPoint(this.drag.hit, chart, project));
		} else if (this.drag.type === "snappee") {
			const candidates = project.snappees.filter(snappee => snappee.id !== this.drag.hit.snappee.id);
			const snap = findNearestSnapPoint(chart, candidates, { activeOnly: true, maxDistance: 9 / mapping.scale });
			this.callbacks.onPreviewSnappeeHandle?.(this.drag.hit.snappee.id, this.drag.hit.index, snap || chart);
		} else if (this.drag.type === "draft-point") {
			const snap = findNearestSnapPoint(chart, project.snappees, { activeOnly: true, maxDistance: 9 / mapping.scale });
			this.callbacks.onPreviewCurvePoint?.(this.drag.hit.index, snap || chart);
		} else if (this.drag.type === "pen-new") {
			this.callbacks.onPreviewPenNode?.(this.drag.index, chart);
		} else if (this.drag.type === "draft-pen-handle") {
			this.callbacks.onPreviewPenHandle?.(this.drag.hit.index, this.drag.hit.kind, chart);
		} else if (this.drag.type === "box") {
			this.selectionBox.x2 = point.x;
			this.selectionBox.y2 = point.y;
			const x1 = Math.min(this.selectionBox.x1, point.x);
			const x2 = Math.max(this.selectionBox.x1, point.x);
			const y1 = Math.min(this.selectionBox.y1, point.y);
			const y2 = Math.max(this.selectionBox.y1, point.y);
			this.callbacks.onPreviewBoxSelect?.(this.visibleEvents.filter(item => item.screen.x >= x1 && item.screen.x <= x2
				&& item.screen.y >= y1 && item.screen.y <= y2).map(item => item.event.id), this.drag.mode);
		}
		this.render();
	}

	#pointerUp(event) {
		if (!this.drag) return;
		const drag = this.drag;
		const point = this.surface.toLocal(event);
		const project = projectState(this.state);
		const mapping = this.#mapping(this.surface.width, this.surface.height);
		const chart = mapping.toChart(point);
		if (drag.type.startsWith("free-")) {
			this.callbacks.onPreviewFreeTransform?.(this.#freeTransformMatrix(drag, chart, event));
		} else if (drag.type === "event" && this.pointerMoved) {
			const allowOutOfBounds = Boolean(project.editor?.allowOutOfBounds);
			const target = allowOutOfBounds ? chart : clampPointToChartBounds(chart);
			const snap = findNearestSnapPoint(target, project.snappees, { activeOnly: true, maxDistance: 9 / mapping.scale,
				bounds: allowOutOfBounds ? undefined : CHART_BOUNDS });
			this.callbacks.onMovePosition?.(drag.hit.event.id, snap || target);
		} else if (drag.type === "event" && drag.collapseSelectionOnClick) {
			this.callbacks.onSelectEvents?.([drag.hit.event.id], "replace");
		} else if (drag.type === "flick") {
			const position = resolveAttachedPosition(drag.hit.event, project.snappees) || drag.hit.event;
			this.callbacks.onFlickAngle?.(drag.hit.event.id,
				Math.round(Math.atan2(chart.y - position.y, chart.x - position.x) / (Math.PI / 4)) * Math.PI / 4);
		} else if (drag.type === "tip") {
			const settingsEvent = drag.hit.settingsEvent || drag.hit.event;
			this.callbacks.onTipSpawn?.(settingsEvent.id, this.#tipHandleEditPoint(drag.hit, chart, project));
		} else if (drag.type === "snappee") {
			const candidates = project.snappees.filter(snappee => snappee.id !== drag.hit.snappee.id);
			const snap = findNearestSnapPoint(chart, candidates, { activeOnly: true, maxDistance: 9 / mapping.scale });
			this.callbacks.onSnappeeHandle?.(drag.hit.snappee.id, drag.hit.index, snap || chart);
		} else if (drag.type === "draft-point") {
			if (this.pointerMoved) {
				const snap = findNearestSnapPoint(chart, project.snappees, { activeOnly: true, maxDistance: 9 / mapping.scale });
				this.callbacks.onCurvePointMove?.(drag.hit.index, snap || chart);
			} else this.callbacks.onCurvePointActivate?.(drag.hit.index);
		} else if (drag.type === "pen-new") {
			this.callbacks.onPenNode?.(drag.index, chart, this.pointerMoved);
		} else if (drag.type === "draft-pen-handle") {
			this.callbacks.onPenHandle?.(drag.hit.index, drag.hit.kind, chart);
		} else if (drag.type === "box") {
			if (this.pointerMoved) {
				const x1 = Math.min(drag.start.x, point.x);
				const x2 = Math.max(drag.start.x, point.x);
				const y1 = Math.min(drag.start.y, point.y);
				const y2 = Math.max(drag.start.y, point.y);
				this.callbacks.onBoxSelect?.(this.visibleEvents.filter(item => item.screen.x >= x1 && item.screen.x <= x2
					&& item.screen.y >= y1 && item.screen.y <= y2).map(item => item.event.id), drag.mode);
			} else if (drag.mode === "replace") {
				this.callbacks.onSelectEvents?.([], "replace");
			}
		}
		this.callbacks.onEndPreview?.();
		this.selectionBox = null;
		this.drag = null;
		document.removeEventListener("pointermove", this.boundMove);
		document.removeEventListener("pointerup", this.boundUp);
		document.removeEventListener("pointercancel", this.boundUp);
		this.render();
	}

	#doubleClick(event) {
		if (this.callbacks.isPlaying?.()) return;
		if (this.callbacks.getCurveDraft?.()) {
			this.callbacks.onCurveDoubleClick?.();
			return;
		}
		const point = this.surface.toLocal(event);
		const mapping = this.#mapping(this.surface.width, this.surface.height);
		const chartPoint = mapping.toChart(point);
		const project = projectState(this.state);
		let nearest = null;
		for (const snappee of project.snappees) {
			let points;
			try { points = sampleSnappee(snappee); } catch { continue; }
			const distance = Math.min(...points.map(candidate => Math.hypot(candidate.x - chartPoint.x, candidate.y - chartPoint.y)));
			if (!nearest || distance < nearest.distance) nearest = { snappee, distance };
		}
		if (nearest && nearest.distance < 8 / mapping.scale) {
			const ids = this.visibleEvents
				.filter(record => record.event.attached && record.event.snappee === nearest.snappee.id)
				.map(record => record.event.id);
			this.callbacks.onSelectEvents?.(ids,
				event.altKey ? "remove" : event.ctrlKey ? "add" : "replace");
		}
	}

	destroy() {
		document.removeEventListener("pointermove", this.boundMove);
		document.removeEventListener("pointerup", this.boundUp);
		document.removeEventListener("pointercancel", this.boundUp);
		cancelAnimationFrame(this.particleAnimationFrame);
		this.particleAnimationFrame = 0;
		this.surface.destroy();
	}
}
