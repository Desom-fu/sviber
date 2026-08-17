import { Rational } from "../js/core/rational.js";
import { TimingMap } from "../js/core/timing.js";
import { CHART_BOUNDS, applyTransform, clampPointToChartBounds, findNearestSnapPoint, invertTransform, multiplyTransforms, resolveAttachedPosition, sampleSnappee } from "../js/core/geometry.js";
import { PixiCanvasSurface } from "./pixi-surface.js";

export const MOVABLE_TYPES = new Set(["tap", "hold", "drag", "flick", "bgNote"]);
export const NOTE_TYPES = new Set(["tap", "hold", "drag", "flick"]);
export const PATTERN_TYPES = new Set(["bigText", "grid", "hexagon", "checkerboard", "diamondGrid", "pentagon", "turntable", "hexagram"]);
export const DURATION_TYPES = new Set(["hold", "bgNote", ...PATTERN_TYPES]);
export const TIP_POINT_SPAWN_TYPES = new Set(["inherit", "chain", "drop", "none"]);
export const TIP_POINT_TRAIL_DURATION = 0.5;
export const TIP_POINT_ZOOM_DURATION = 0.3;
export const TIP_POINT_TRAIL_TAIL_DURATION = 0.1;

export const SUNNIESNOW_AUTOPLAY_GRADIENT = Object.freeze({
	top: "#f3eba2",
	bottom: "#d2fbfa",
});

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

export function sunniesnowNoteTextColor(event, visibility) {
	return visibility?.phase === "fadingOut" && event?.type !== "bgNote" ? "#ffff55" : "#ffffff";
}

export function sunniesnowPlayfieldScale(width, height) {
	const safeWidth = Math.max(1, Number(width) || 1);
	const safeHeight = Math.max(1, Number(height) || 1);
	return Math.min(safeWidth / 250, safeHeight / 150);
}

export function isSnappeeVisible(snappee) {
	return snappee?.active !== false;
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

export function sunniesnowEventVisualState(event, start, end, now, approachSpeed = SUNNIESNOW_SKIN.approachSpeed) {
	if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(now)) return null;
	approachSpeed = Number(approachSpeed);
	if (!(approachSpeed > 0)) approachSpeed = SUNNIESNOW_SKIN.approachSpeed;
	const relativeTime = now - start;
	const duration = Math.max(0, end - start);
	const fadeInStart = -1 / approachSpeed - SUNNIESNOW_SKIN.noteFadeInDuration;
	const activeStart = -1 / approachSpeed;
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
			progress: relativeTime * approachSpeed + 1,
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

export function colorIntegerToCss(value) {
	return `#${Math.max(0, Math.min(0xffffff, value | 0)).toString(16).padStart(6, "0")}`;
}

export function randomColor(minimum, maximum) {
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

export function tipPointSpawnTime(target, settings, timing) {
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

export function tipPointDirection(checkpoints, index) {
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

export function tipPointPathBetween(checkpoints, beginning, ending) {
	const points = [sampleTipPointPath(checkpoints, beginning)];
	const tailConnectTime = beginning + TIP_POINT_TRAIL_TAIL_DURATION;
	if (tailConnectTime < ending) points.push(sampleTipPointPath(checkpoints, tailConnectTime));
	for (const checkpoint of checkpoints) {
		if (checkpoint.time > beginning && checkpoint.time < ending) points.push(checkpoint);
	}
	const last = sampleTipPointPath(checkpoints, ending);
	if (last && (last.time !== points.at(-1)?.time || last.x !== points.at(-1)?.x || last.y !== points.at(-1)?.y)) points.push(last);
	return points.filter(Boolean).filter((point, index, all) => index === 0
		|| point.time !== all[index - 1].time || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
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

export function directionBetween(from, to) {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const length = Math.hypot(dx, dy);
	return length > 1e-8 ? { x: dx / length, y: dy / length } : null;
}

export function adjacentDirection(points, index, step) {
	for (let next = index + step; next >= 0 && next < points.length; next += step) {
		const direction = step < 0
			? directionBetween(points[next], points[index])
			: directionBetween(points[index], points[next]);
		if (direction) return direction;
	}
	return null;
}

// This is the Canvas equivalent of game-unstable's TipPoint.jointEdge().
// Adjacent quads share mitered edge vertices, so corners stay continuous.
export function tipPointTrailEdges(points, width, scale = 1) {
	if (points.length < 2 || !(width > 0)) return [];
	const startTime = points[0].time;
	const size = Math.max(0, Math.min(1, scale));
	return points.map((point, index) => {
		const halfWidth = width / 2 * Math.min(size,
			Math.max(0, (point.time - startTime) / TIP_POINT_TRAIL_TAIL_DURATION));
		const previous = adjacentDirection(points, index, -1);
		const next = adjacentDirection(points, index, 1);
		const incoming = previous || next || { x: 0, y: -1 };
		const outgoing = next || previous || incoming;
		const incomingNormal = { x: -incoming.y, y: incoming.x };
		const outgoingNormal = { x: -outgoing.y, y: outgoing.x };
		let miterX = incomingNormal.x + outgoingNormal.x;
		let miterY = incomingNormal.y + outgoingNormal.y;
		const miterLength = Math.hypot(miterX, miterY);
		if (miterLength <= 1e-8) {
			miterX = outgoingNormal.x;
			miterY = outgoingNormal.y;
		} else {
			miterX /= miterLength;
			miterY /= miterLength;
		}
		const projection = miterX * outgoingNormal.x + miterY * outgoingNormal.y;
		const edgeLength = Math.abs(projection) > 1e-4 ? halfWidth / projection : halfWidth;
		const dx = miterX * edgeLength;
		const dy = miterY * edgeLength;
		return {
			...point,
			left: { x: point.x + dx, y: point.y + dy },
			right: { x: point.x - dx, y: point.y - dy },
		};
	});
}

export function drawTipPointTrail(context, points, width, scale = 1, alpha = 1, maximumOpacity = 0.5) {
	if (points.length < 2 || width <= 0) return;
	const startTime = points[0].time;
	const endTime = points.at(-1).time;
	const duration = endTime - startTime;
	if (!(duration > 0)) return;
	const progressAt = point => Math.max(0, Math.min(1, (point.time - startTime) / duration));
	const opacityAt = point => Math.max(0, Math.min(1, alpha * maximumOpacity * progressAt(point)));
	const edges = tipPointTrailEdges(points, width, scale);

	context.save();
	for (let index = 1; index < edges.length; index += 1) {
		const beginning = edges[index - 1];
		const ending = edges[index];
		if (!(ending.time > beginning.time)) continue;
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
		context.moveTo(beginning.left.x, beginning.left.y);
		context.lineTo(ending.left.x, ending.left.y);
		context.lineTo(ending.right.x, ending.right.y);
		context.lineTo(beginning.right.x, beginning.right.y);
		context.closePath();
		context.fill();
	}
	context.restore();
}

export function sunniesnowRegularPolygonPoints(centerX, centerY, radius, sides, rotation = 0) {
	sides = Math.max(sides | 0, 3);
	const startAngle = -Math.PI / 2 + rotation;
	const delta = Math.PI * 2 / sides;
	return Array.from({ length: sides }, (_, index) => {
		const angle = startAngle - index * delta;
		return {
			x: centerX + Math.cos(angle) * radius,
			y: centerY + Math.sin(angle) * radius,
		};
	});
}

export function appendPolygonPath(context, centerX, centerY, radius, sides, rotation = 0) {
	for (const [index, point] of sunniesnowRegularPolygonPoints(centerX, centerY, radius, sides, rotation).entries()) {
		if (!index) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
	}
	context.closePath();
}

export function polygonPath(context, centerX, centerY, radius, sides, rotation = 0) {
	context.beginPath();
	appendPolygonPath(context, centerX, centerY, radius, sides, rotation);
}

export function selectedEvents(project) {
	return project.events.filter(event => event.selected);
}

export function pointInPolygon(point, polygon) {
	let inside = false;
	for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
		const a = polygon[current];
		const b = polygon[previous];
		if ((a.y > point.y) !== (b.y > point.y)
			&& point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
	}
	return inside;
}
