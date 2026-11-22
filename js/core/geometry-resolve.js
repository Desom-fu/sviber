import { SPECIAL_SNAP_INDEX } from "./snappee-index.js";

const TAU = Math.PI * 2;

function finiteNumber(value, label) {
	const result = Number(value);
	if (!Number.isFinite(result)) {
		throw new TypeError(`${label} must be a finite number`);
	}
	return result;
}

function positiveInteger(value, label, fallback) {
	const result = value == null ? fallback : Number(value);
	if (!Number.isSafeInteger(result) || result < 1) {
		throw new RangeError(`${label} must be a positive integer`);
	}
	return result;
}

function normalizedPositiveAngle(angle) {
	const result = angle % TAU;
	return result < 0 ? result + TAU : result;
}

function parseIntegerRange(range, exclusive = false, forceExclusive = false) {
	if (!Array.isArray(range) || range.length !== 2) {
		throw new TypeError("range must contain two integers");
	}
	const start = Number(range[0]);
	const end = Number(range[1]);
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
		throw new TypeError("range bounds must be safe integers");
	}
	return { start, end, omitEnd: forceExclusive || Boolean(exclusive) };
}

function inParsedRange(value, parsed) {
	if (typeof value !== "number" || !Number.isSafeInteger(value)) {
		return false;
	}
	if (parsed.end >= parsed.start) {
		return value >= parsed.start && (parsed.omitEnd ? value < parsed.end : value <= parsed.end);
	}
	return value <= parsed.start && (parsed.omitEnd ? value > parsed.end : value >= parsed.end);
}

function normalizeZero(value) {
	return value === 0 ? 0 : value;
}

function resolveRectangularMeshPoint(snappee, requested) {
	const horizontalTiles = positiveInteger(snappee.horizontalTiles, "horizontalTiles", 1);
	const verticalTiles = positiveInteger(snappee.verticalTiles, "verticalTiles", 1);
	const left = finiteNumber(snappee.topLeftX, "topLeftX");
	const top = finiteNumber(snappee.topLeftY, "topLeftY");
	const right = finiteNumber(snappee.bottomRightX, "bottomRightX");
	const bottom = finiteNumber(snappee.bottomRightY, "bottomRightY");
	if (!Array.isArray(requested) || requested.length !== 2) {
		return null;
	}
	const [rawI, rawJ] = requested;
	if (
		typeof rawI !== "number" ||
		typeof rawJ !== "number" ||
		!Number.isInteger(rawI) ||
		!Number.isInteger(rawJ) ||
		rawI < 0 ||
		rawI > horizontalTiles ||
		rawJ < 0 ||
		rawJ > verticalTiles
	) {
		return null;
	}
	const i = normalizeZero(rawI);
	const j = normalizeZero(rawJ);
	return {
		x: finiteNumber(left + ((right - left) * i) / horizontalTiles, "x"),
		y: finiteNumber(top + ((bottom - top) * j) / verticalTiles, "y"),
		snapPoint: [i, j],
	};
}

function resolveRadialMeshPoint(snappee, requested) {
	const azimuthalTiles = positiveInteger(snappee.azimuthalTiles, "azimuthalTiles", 1);
	const radialTiles = positiveInteger(snappee.radialTiles, "radialTiles", 1);
	const centerX = finiteNumber(snappee.centerX, "centerX");
	const centerY = finiteNumber(snappee.centerY, "centerY");
	const radius = finiteNumber(snappee.radius, "radius");
	const startingAngle = finiteNumber(snappee.startingAngle ?? snappee.angle ?? 0, "startingAngle");
	if (!Array.isArray(requested) || requested.length !== 2) {
		return null;
	}
	const [rawI, rawJ] = requested;
	if (
		typeof rawI !== "number" ||
		typeof rawJ !== "number" ||
		!Number.isInteger(rawI) ||
		!Number.isInteger(rawJ) ||
		rawI < 0 ||
		rawI >= azimuthalTiles ||
		rawJ < 0 ||
		rawJ > radialTiles
	) {
		return null;
	}
	const i = normalizeZero(rawI);
	const j = normalizeZero(rawJ);
	const angle = startingAngle + (i * TAU) / azimuthalTiles;
	const currentRadius = (radius * j) / radialTiles;
	return {
		x: finiteNumber(centerX + currentRadius * Math.cos(angle), "x"),
		y: finiteNumber(centerY + currentRadius * Math.sin(angle), "y"),
		snapPoint: [i, j],
	};
}

function resolveRegularPolygonPoint(snappee, requested) {
	const sides = positiveInteger(snappee.sides ?? snappee.numberOfSides, "sides", 3);
	const segments = positiveInteger(snappee.segmentsPerSide, "segmentsPerSide", 1);
	const centerX = finiteNumber(snappee.centerX, "centerX");
	const centerY = finiteNumber(snappee.centerY, "centerY");
	const radius = finiteNumber(snappee.radius, "radius");
	const angle = finiteNumber(snappee.angle ?? 0, "angle");
	if (requested === SPECIAL_SNAP_INDEX) {
		return { x: centerX, y: centerY, snapPoint: SPECIAL_SNAP_INDEX };
	}
	if (
		typeof requested !== "number" ||
		!Number.isInteger(requested) ||
		requested < 0 ||
		requested >= sides * segments
	) {
		return null;
	}
	const index = normalizeZero(requested);
	const side = Math.floor(index / segments);
	const segment = index % segments;
	const startAngle = angle + (side * TAU) / sides;
	const endAngle = angle + (((side + 1) % sides) * TAU) / sides;
	const startX = centerX + radius * Math.cos(startAngle);
	const startY = centerY + radius * Math.sin(startAngle);
	const endX = centerX + radius * Math.cos(endAngle);
	const endY = centerY + radius * Math.sin(endAngle);
	const progress = segment / segments;
	return {
		x: finiteNumber(startX + (endX - startX) * progress, "x"),
		y: finiteNumber(startY + (endY - startY) * progress, "y"),
		snapPoint: index,
	};
}

function resolveCircularArcPoint(snappee, requested) {
	const centerX = finiteNumber(snappee.centerX, "centerX");
	const centerY = finiteNumber(snappee.centerY, "centerY");
	const radius = finiteNumber(snappee.radius, "radius");
	const beginning = finiteNumber(snappee.beginningAngle ?? 0, "beginningAngle");
	const closed = Boolean(snappee.closed);
	const clockwise = Boolean(snappee.clockwise);
	const segments = positiveInteger(snappee.segments, "segments", 1);
	let span;
	if (closed) {
		span = clockwise ? -TAU : TAU;
	} else {
		const end = finiteNumber(snappee.endAngle ?? snappee.endingAngle ?? beginning, "endAngle");
		span = clockwise ? -normalizedPositiveAngle(beginning - end) : normalizedPositiveAngle(end - beginning);
	}
	if (requested === SPECIAL_SNAP_INDEX) {
		return { x: centerX, y: centerY, snapPoint: SPECIAL_SNAP_INDEX };
	}
	const count = closed ? segments : segments + 1;
	if (typeof requested !== "number" || !Number.isInteger(requested) || requested < 0 || requested >= count) {
		return null;
	}
	const index = normalizeZero(requested);
	const angle = beginning + (span * index) / segments;
	return {
		x: finiteNumber(centerX + radius * Math.cos(angle), "x"),
		y: finiteNumber(centerY + radius * Math.sin(angle), "y"),
		snapPoint: index,
	};
}

function resolveParametricMeshPoint(snappee, requested, evaluateExpression, evaluator) {
	const iRange = parseIntegerRange(snappee.iRange, snappee.iRangeExclusive);
	const jRange = parseIntegerRange(snappee.jRange, snappee.jRangeExclusive);
	if (!Array.isArray(requested) || requested.length !== 2) {
		return null;
	}
	const [rawI, rawJ] = requested;
	if (!inParsedRange(rawI, iRange) || !inParsedRange(rawJ, jRange)) {
		return null;
	}
	const i = normalizeZero(rawI);
	const j = normalizeZero(rawJ);
	const scope = { i, j };
	return {
		x: evaluateExpression(snappee.xExpression, scope, evaluator),
		y: evaluateExpression(snappee.yExpression, scope, evaluator),
		snapPoint: [i, j],
	};
}

function resolveParametricCurvePoint(snappee, requested, evaluateExpression, evaluator) {
	const iRange = parseIntegerRange(snappee.iRange, snappee.iRangeExclusive, Boolean(snappee.closed));
	if (!inParsedRange(requested, iRange)) {
		return null;
	}
	const i = normalizeZero(requested);
	const scope = { i };
	return {
		x: evaluateExpression(snappee.xExpression, scope, evaluator),
		y: evaluateExpression(snappee.yExpression, scope, evaluator),
		snapPoint: i,
	};
}

/**
 * Resolves a single snap point in O(1) for analytic snappee types without sampling the
 * entire mesh or curve. Returns `undefined` when the snappee type requires full sampling
 * (bezierCurve, penCurve) or is unknown, and `null` when `requested` is out of range.
 */
export function resolveAnalyticLocalPoint(snappee, requested, evaluateExpression, evaluator) {
	if (!snappee || typeof snappee !== "object") {
		throw new TypeError("snappee must be an object");
	}
	if (snappee.type === "rectangularMesh") {
		return resolveRectangularMeshPoint(snappee, requested);
	}
	if (snappee.type === "radialMesh") {
		return resolveRadialMeshPoint(snappee, requested);
	}
	if (snappee.type === "regularPolygonCurve") {
		return resolveRegularPolygonPoint(snappee, requested);
	}
	if (snappee.type === "circularArcCurve") {
		return resolveCircularArcPoint(snappee, requested);
	}
	if (snappee.type === "parametricMesh") {
		return resolveParametricMeshPoint(snappee, requested, evaluateExpression, evaluator);
	}
	if (snappee.type === "parametricCurve") {
		return resolveParametricCurvePoint(snappee, requested, evaluateExpression, evaluator);
	}
	return undefined;
}

export function findSnappeeById(snappees, id) {
	if (snappees instanceof Map) {
		const direct = snappees.get(id);
		if (direct && direct.id === id) {
			return direct;
		}
		for (const candidate of snappees.values()) {
			if (candidate.id === id) {
				return candidate;
			}
		}
		return null;
	}
	if (Array.isArray(snappees)) {
		for (let index = 0; index < snappees.length; index += 1) {
			if (snappees[index].id === id) {
				return snappees[index];
			}
		}
		return null;
	}
	if (snappees && typeof snappees === "object") {
		for (const candidate of Object.values(snappees)) {
			if (candidate.id === id) {
				return candidate;
			}
		}
	}
	return null;
}

export function resolveSampledCandidate(snappee, requested, sampleSnappee, sameSnapPoint, options) {
	const cache = options?.sampleCache;
	let samples = cache instanceof Map ? cache.get(snappee) : undefined;
	if (!samples) {
		samples = sampleSnappee(snappee, options);
		if (cache instanceof Map) {
			cache.set(snappee, samples);
		}
	}
	if (
		typeof requested === "number" &&
		Number.isInteger(requested) &&
		requested >= 0 &&
		requested < samples.length &&
		samples[requested].snapPoint === requested
	) {
		return samples[requested];
	}
	return samples.find(item => sameSnapPoint(item.snapPoint, requested)) ?? null;
}
