export const IDENTITY_TRANSFORM = Object.freeze([1, 0, 0, 1, 0, 0]);
export const CHART_BOUNDS = Object.freeze({ minX: -100, maxX: 100, minY: -50, maxY: 50 });

const TAU = Math.PI * 2;
const EPSILON = 1e-12;

function finiteNumber(value, label) {
	const result = Number(value);
	if (!Number.isFinite(result)) throw new TypeError(`${label} must be a finite number`);
	return result;
}

export function isPointWithinChartBounds(input) {
	const x = Number(input?.x ?? input?.[0]);
	const y = Number(input?.y ?? input?.[1]);
	return Number.isFinite(x) && Number.isFinite(y)
		&& x >= CHART_BOUNDS.minX && x <= CHART_BOUNDS.maxX
		&& y >= CHART_BOUNDS.minY && y <= CHART_BOUNDS.maxY;
}

export function clampPointToChartBounds(input) {
	const x = Number(input?.x ?? input?.[0]);
	const y = Number(input?.y ?? input?.[1]);
	return {
		x: Math.max(CHART_BOUNDS.minX, Math.min(CHART_BOUNDS.maxX, Number.isFinite(x) ? x : 0)),
		y: Math.max(CHART_BOUNDS.minY, Math.min(CHART_BOUNDS.maxY, Number.isFinite(y) ? y : 0)),
	};
}

function positiveInteger(value, label, fallback) {
	const result = value == null ? fallback : Number(value);
	if (!Number.isSafeInteger(result) || result < 1) {
		throw new RangeError(`${label} must be a positive integer`);
	}
	return result;
}

function point(x, y, snapPoint) {
	return { x: finiteNumber(x, "x"), y: finiteNumber(y, "y"), snapPoint };
}

export function normalizeTransform(transform = IDENTITY_TRANSFORM) {
	if (!Array.isArray(transform) || transform.length !== 6) {
		throw new TypeError("transformation must be a six-number array");
	}
	return transform.map((value, index) => finiteNumber(value, `transformation[${index}]`));
}

export function applyTransform(input, transform = IDENTITY_TRANSFORM) {
	const [a, b, c, d, tx, ty] = normalizeTransform(transform);
	const x = finiteNumber(input?.x ?? input?.[0], "point.x");
	const y = finiteNumber(input?.y ?? input?.[1], "point.y");
	return { x: a * x + c * y + tx, y: b * x + d * y + ty };
}

/** Returns a matrix that applies `right` first and then `left`. */
export function multiplyTransforms(left, right) {
	const [a1, b1, c1, d1, tx1, ty1] = normalizeTransform(left);
	const [a2, b2, c2, d2, tx2, ty2] = normalizeTransform(right);
	return [
		a1 * a2 + c1 * b2,
		b1 * a2 + d1 * b2,
		a1 * c2 + c1 * d2,
		b1 * c2 + d1 * d2,
		a1 * tx2 + c1 * ty2 + tx1,
		b1 * tx2 + d1 * ty2 + ty1,
	];
}

export function invertTransform(transform) {
	const [a, b, c, d, tx, ty] = normalizeTransform(transform);
	const determinant = a * d - b * c;
	if (Math.abs(determinant) <= EPSILON) throw new RangeError("transformation is singular");
	return [
		d / determinant,
		-b / determinant,
		-c / determinant,
		a / determinant,
		(c * ty - d * tx) / determinant,
		(b * tx - a * ty) / determinant,
	];
}

export function transformAngle(angle, transform) {
	const [a, b, c, d] = normalizeTransform(transform);
	const radians = finiteNumber(angle, "angle");
	const x = Math.cos(radians);
	const y = Math.sin(radians);
	const transformedX = a * x + c * y;
	const transformedY = b * x + d * y;
	if (Math.hypot(transformedX, transformedY) <= EPSILON) return radians;
	return Math.atan2(transformedY, transformedX);
}

function integerRange(range, exclusive = false, forceExclusive = false) {
	if (!Array.isArray(range) || range.length !== 2) throw new TypeError("range must contain two integers");
	const start = Number(range[0]);
	const end = Number(range[1]);
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
		throw new TypeError("range bounds must be safe integers");
	}
	const direction = end >= start ? 1 : -1;
	const omitEnd = forceExclusive || Boolean(exclusive);
	const result = [];
	for (let value = start; direction > 0 ? value < end : value > end; value += direction) result.push(value);
	if (!omitEnd) result.push(end);
	return result;
}

function evaluateExpression(expression, scope, evaluator) {
	if (typeof expression === "number") return finiteNumber(expression, "expression result");
	if (typeof expression === "function") {
		const result = Object.hasOwn(scope, "j")
			? (expression.length >= 2 ? expression(scope.i, scope.j, scope) : expression(scope))
			: expression(scope.i, scope);
		return finiteNumber(result, "expression result");
	}
	const text = String(expression ?? "").trim();
	if (Object.hasOwn(scope, text)) return finiteNumber(scope[text], "expression result");
	if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
		return finiteNumber(text, "expression result");
	}
	const engine = evaluator ?? globalThis.math;
	if (typeof engine === "function") return finiteNumber(engine(text, scope), "expression result");
	if (typeof engine?.evaluate === "function") {
		return finiteNumber(engine.evaluate(text, scope), "expression result");
	}
	throw new Error("Parametric snappees require a math.js-compatible evaluator");
}

function sampleRectangularMesh(snappee) {
	const horizontalTiles = positiveInteger(snappee.horizontalTiles, "horizontalTiles", 1);
	const verticalTiles = positiveInteger(snappee.verticalTiles, "verticalTiles", 1);
	const left = finiteNumber(snappee.topLeftX, "topLeftX");
	const top = finiteNumber(snappee.topLeftY, "topLeftY");
	const right = finiteNumber(snappee.bottomRightX, "bottomRightX");
	const bottom = finiteNumber(snappee.bottomRightY, "bottomRightY");
	const result = [];
	for (let i = 0; i <= horizontalTiles; i += 1) {
		for (let j = 0; j <= verticalTiles; j += 1) {
			result.push(point(
				left + (right - left) * i / horizontalTiles,
				top + (bottom - top) * j / verticalTiles,
				[i, j],
			));
		}
	}
	return result;
}

function sampleRadialMesh(snappee) {
	const azimuthalTiles = positiveInteger(snappee.azimuthalTiles, "azimuthalTiles", 1);
	const radialTiles = positiveInteger(snappee.radialTiles, "radialTiles", 1);
	const centerX = finiteNumber(snappee.centerX, "centerX");
	const centerY = finiteNumber(snappee.centerY, "centerY");
	const radius = finiteNumber(snappee.radius, "radius");
	const startingAngle = finiteNumber(snappee.startingAngle ?? snappee.angle ?? 0, "startingAngle");
	const result = [];
	for (let i = 0; i < azimuthalTiles; i += 1) {
		const angle = startingAngle + i * TAU / azimuthalTiles;
		for (let j = 0; j <= radialTiles; j += 1) {
			const currentRadius = radius * j / radialTiles;
			result.push(point(
				centerX + currentRadius * Math.cos(angle),
				centerY + currentRadius * Math.sin(angle),
				[i, j],
			));
		}
	}
	return result;
}

function sampleParametricMesh(snappee, evaluator) {
	const iValues = integerRange(snappee.iRange, snappee.iRangeExclusive);
	const jValues = integerRange(snappee.jRange, snappee.jRangeExclusive);
	const result = [];
	for (const i of iValues) {
		for (const j of jValues) {
			const scope = { i, j };
			result.push(point(
				evaluateExpression(snappee.xExpression, scope, evaluator),
				evaluateExpression(snappee.yExpression, scope, evaluator),
				[i, j],
			));
		}
	}
	return result;
}

function sampleRegularPolygon(snappee) {
	const sides = positiveInteger(snappee.sides ?? snappee.numberOfSides, "sides", 3);
	const segments = positiveInteger(snappee.segmentsPerSide, "segmentsPerSide", 1);
	const centerX = finiteNumber(snappee.centerX, "centerX");
	const centerY = finiteNumber(snappee.centerY, "centerY");
	const radius = finiteNumber(snappee.radius, "radius");
	const angle = finiteNumber(snappee.angle ?? 0, "angle");
	const vertices = Array.from({ length: sides }, (_, index) => ({
		x: centerX + radius * Math.cos(angle + index * TAU / sides),
		y: centerY + radius * Math.sin(angle + index * TAU / sides),
	}));
	const result = [];
	for (let side = 0; side < sides; side += 1) {
		const start = vertices[side];
		const end = vertices[(side + 1) % sides];
		for (let segment = 0; segment < segments; segment += 1) {
			const progress = segment / segments;
			result.push(point(
				start.x + (end.x - start.x) * progress,
				start.y + (end.y - start.y) * progress,
				side * segments + segment,
			));
		}
	}
	return result;
}

function bezierPoint(controlPoints, progress) {
	const working = controlPoints.map(({ x, y }) => ({ x, y }));
	for (let level = working.length - 1; level > 0; level -= 1) {
		for (let index = 0; index < level; index += 1) {
			working[index] = {
				x: working[index].x + (working[index + 1].x - working[index].x) * progress,
				y: working[index].y + (working[index + 1].y - working[index].y) * progress,
			};
		}
	}
	return working[0];
}

function distance(left, right) {
	return Math.hypot(right.x - left.x, right.y - left.y);
}

function resamplePolyline(polyline, outputCount, closed = false) {
	if (polyline.length === 0 || outputCount <= 0) return [];
	if (polyline.length === 1) return Array.from({ length: outputCount }, () => ({ ...polyline[0] }));
	const source = polyline.map(({ x, y }) => ({ x, y }));
	if (closed && distance(source[0], source.at(-1)) > EPSILON) source.push({ ...source[0] });

	const cumulative = [0];
	for (let index = 1; index < source.length; index += 1) {
		cumulative.push(cumulative.at(-1) + distance(source[index - 1], source[index]));
	}
	const total = cumulative.at(-1);
	if (total <= EPSILON) return Array.from({ length: outputCount }, () => ({ ...source[0] }));

	const denominator = closed ? outputCount : Math.max(1, outputCount - 1);
	const result = [];
	let segment = 1;
	for (let index = 0; index < outputCount; index += 1) {
		const target = total * index / denominator;
		while (segment < cumulative.length - 1 && cumulative[segment] < target) segment += 1;
		const beginningDistance = cumulative[segment - 1];
		const segmentLength = cumulative[segment] - beginningDistance;
		const progress = segmentLength <= EPSILON ? 0 : (target - beginningDistance) / segmentLength;
		const beginning = source[segment - 1];
		const end = source[segment];
		result.push({
			x: beginning.x + (end.x - beginning.x) * progress,
			y: beginning.y + (end.y - beginning.y) * progress,
		});
	}
	return result;
}

function sampleBezierCurve(snappee) {
	const controlPoints = (snappee.controlPoints ?? []).map((value, index) => ({
		x: finiteNumber(value?.x ?? value?.[0], `controlPoints[${index}].x`),
		y: finiteNumber(value?.y ?? value?.[1], `controlPoints[${index}].y`),
	}));
	if (controlPoints.length < 2) return [];
	const segments = positiveInteger(snappee.segments, "segments", 1);
	const closed = Boolean(snappee.closed);
	const resolution = Math.max(256, segments * 32, controlPoints.length * 64);
	const polyline = Array.from({ length: resolution + 1 }, (_, index) => (
		bezierPoint(controlPoints, index / resolution)
	));
	const sampled = resamplePolyline(polyline, closed ? segments : segments + 1, closed);
	return sampled.map(({ x, y }, index) => point(x, y, index));
}

function normalizedPositiveAngle(angle) {
	const result = angle % TAU;
	return result < 0 ? result + TAU : result;
}

function sampleCircularArc(snappee) {
	const centerX = finiteNumber(snappee.centerX, "centerX");
	const centerY = finiteNumber(snappee.centerY, "centerY");
	const radius = finiteNumber(snappee.radius, "radius");
	const beginning = finiteNumber(snappee.beginningAngle ?? 0, "beginningAngle");
	const closed = Boolean(snappee.closed);
	const clockwise = Boolean(snappee.clockwise);
	const segments = positiveInteger(snappee.segments, "segments", 1);
	let span;
	if (closed) span = clockwise ? -TAU : TAU;
	else {
		const end = finiteNumber(snappee.endAngle ?? snappee.endingAngle ?? beginning, "endAngle");
		span = clockwise
			? -normalizedPositiveAngle(beginning - end)
			: normalizedPositiveAngle(end - beginning);
	}
	const count = closed ? segments : segments + 1;
	return Array.from({ length: count }, (_, index) => {
		const angle = beginning + span * index / segments;
		return point(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle), index);
	});
}

function commandValue(command, key, index, fallback) {
	return command?.[key] ?? (Array.isArray(command) ? command[index] : fallback);
}

function penPolyline(commands = []) {
	const result = [];
	let current = { x: 0, y: 0 };
	let subpathStart = null;
	const append = (next) => {
		current = { x: finiteNumber(next.x, "pen x"), y: finiteNumber(next.y, "pen y") };
		result.push({ ...current });
	};

	for (const command of commands) {
		const rawType = String(command?.type ?? command?.command ?? command?.[0] ?? "");
		const relative = rawType === rawType.toLowerCase();
		const type = rawType.toUpperCase();
		const coordinate = (key, index, axis) => {
			const value = finiteNumber(commandValue(command, key, index, 0), `pen ${key}`);
			return relative ? value + current[axis] : value;
		};
		if (type === "M") {
			append({ x: coordinate("x", 1, "x"), y: coordinate("y", 2, "y") });
			subpathStart = { ...current };
		} else if (type === "L") {
			append({ x: coordinate("x", 1, "x"), y: coordinate("y", 2, "y") });
		} else if (type === "Q") {
			const start = { ...current };
			const control = { x: coordinate("x1", 1, "x"), y: coordinate("y1", 2, "y") };
			const end = { x: coordinate("x", 3, "x"), y: coordinate("y", 4, "y") };
			for (let step = 1; step <= 24; step += 1) {
				const t = step / 24;
				const u = 1 - t;
				append({
					x: u * u * start.x + 2 * u * t * control.x + t * t * end.x,
					y: u * u * start.y + 2 * u * t * control.y + t * t * end.y,
				});
			}
		} else if (type === "C") {
			const start = { ...current };
			const control1 = { x: coordinate("x1", 1, "x"), y: coordinate("y1", 2, "y") };
			const control2 = { x: coordinate("x2", 3, "x"), y: coordinate("y2", 4, "y") };
			const end = { x: coordinate("x", 5, "x"), y: coordinate("y", 6, "y") };
			for (let step = 1; step <= 32; step += 1) {
				const t = step / 32;
				const u = 1 - t;
				append({
					x: u ** 3 * start.x + 3 * u * u * t * control1.x + 3 * u * t * t * control2.x + t ** 3 * end.x,
					y: u ** 3 * start.y + 3 * u * u * t * control1.y + 3 * u * t * t * control2.y + t ** 3 * end.y,
				});
			}
		} else if (type === "Z" && subpathStart) {
			append(subpathStart);
		}
	}
	return result;
}

export function penCommandsFromNodes(nodes = [], closed = false) {
	if (!Array.isArray(nodes) || nodes.length === 0) return [];
	const normalized = nodes.map((node, index) => ({
		x: finiteNumber(node?.x, `penNodes[${index}].x`),
		y: finiteNumber(node?.y, `penNodes[${index}].y`),
		incoming: node?.incoming ? {
			x: finiteNumber(node.incoming.x, `penNodes[${index}].incoming.x`),
			y: finiteNumber(node.incoming.y, `penNodes[${index}].incoming.y`),
		} : null,
		outgoing: node?.outgoing ? {
			x: finiteNumber(node.outgoing.x, `penNodes[${index}].outgoing.x`),
			y: finiteNumber(node.outgoing.y, `penNodes[${index}].outgoing.y`),
		} : null,
	}));
	const commands = [{ type: "M", x: normalized[0].x, y: normalized[0].y }];
	const appendSegment = (from, to) => {
		if (from.outgoing || to.incoming) {
			commands.push({
				type: "C",
				x1: from.outgoing?.x ?? from.x,
				y1: from.outgoing?.y ?? from.y,
				x2: to.incoming?.x ?? to.x,
				y2: to.incoming?.y ?? to.y,
				x: to.x,
				y: to.y,
			});
		} else {
			commands.push({ type: "L", x: to.x, y: to.y });
		}
	};
	for (let index = 1; index < normalized.length; index += 1) {
		appendSegment(normalized[index - 1], normalized[index]);
	}
	if (closed && normalized.length > 1) appendSegment(normalized.at(-1), normalized[0]);
	return commands;
}

function samplePenCurve(snappee) {
	const polyline = penPolyline(snappee.commands);
	if (polyline.length < 2 && Array.isArray(snappee.controlPoints)) {
		const temporary = { ...snappee, type: "bezierCurve" };
		return sampleBezierCurve(temporary);
	}
	const segments = positiveInteger(snappee.segments, "segments", 1);
	const closed = Boolean(snappee.closed);
	const sampled = resamplePolyline(polyline, closed ? segments : segments + 1, closed);
	return sampled.map(({ x, y }, index) => point(x, y, index));
}

function sampleParametricCurve(snappee, evaluator) {
	const values = integerRange(snappee.iRange, snappee.iRangeExclusive, Boolean(snappee.closed));
	return values.map((i) => {
		const scope = { i };
		return point(
			evaluateExpression(snappee.xExpression, scope, evaluator),
			evaluateExpression(snappee.yExpression, scope, evaluator),
			i,
		);
	});
}

const SAMPLERS = {
	rectangularMesh: sampleRectangularMesh,
	radialMesh: sampleRadialMesh,
	parametricMesh: sampleParametricMesh,
	regularPolygonCurve: sampleRegularPolygon,
	bezierCurve: sampleBezierCurve,
	circularArcCurve: sampleCircularArc,
	penCurve: samplePenCurve,
	parametricCurve: sampleParametricCurve,
};

export function sampleSnappee(snappee, options = {}) {
	if (!snappee || typeof snappee !== "object") throw new TypeError("snappee must be an object");
	const sampler = SAMPLERS[snappee.type];
	if (!sampler) throw new TypeError(`Unsupported snappee type: ${snappee.type}`);
	const transform = normalizeTransform(snappee.transformation ?? IDENTITY_TRANSFORM);
	return sampler(snappee, options.evaluator).map((raw) => {
		const transformed = applyTransform(raw, transform);
		return {
			x: transformed.x,
			y: transformed.y,
			snapPoint: Array.isArray(raw.snapPoint) ? [...raw.snapPoint] : raw.snapPoint,
			localX: raw.x,
			localY: raw.y,
		};
	});
}

function sameSnapPoint(left, right) {
	if (Array.isArray(left) || Array.isArray(right)) {
		return Array.isArray(left) && Array.isArray(right)
			&& left.length === right.length
			&& left.every((value, index) => value === right[index]);
	}
	return left === right;
}

function snappeeCollection(snappees) {
	if (snappees instanceof Map) return [...snappees.values()];
	if (Array.isArray(snappees)) return snappees;
	if (snappees && typeof snappees === "object") return Object.values(snappees);
	return [];
}

function insideBounds(candidate, bounds) {
	if (!bounds) return true;
	return candidate.x >= (bounds.minX ?? -Infinity)
		&& candidate.x <= (bounds.maxX ?? Infinity)
		&& candidate.y >= (bounds.minY ?? -Infinity)
		&& candidate.y <= (bounds.maxY ?? Infinity);
}

export function findNearestSnapPoint(input, snappees, options = {}) {
	const target = {
		x: finiteNumber(input?.x ?? input?.[0], "point.x"),
		y: finiteNumber(input?.y ?? input?.[1], "point.y"),
	};
	const activeOnly = options.activeOnly ?? true;
	const maxDistance = options.maxDistance ?? Infinity;
	if (maxDistance < 0) return null;
	let nearest = null;
	let nearestSquared = maxDistance ** 2;
	for (const snappee of snappeeCollection(snappees)) {
		if (activeOnly && snappee.active === false) continue;
		for (const candidate of sampleSnappee(snappee, options)) {
			if (!insideBounds(candidate, options.bounds)) continue;
			const squared = (candidate.x - target.x) ** 2 + (candidate.y - target.y) ** 2;
			if (squared > nearestSquared || (nearest && squared === nearestSquared)) continue;
			nearestSquared = squared;
			nearest = {
				snappee,
				snappeeId: snappee.id,
				snapPoint: Array.isArray(candidate.snapPoint) ? [...candidate.snapPoint] : candidate.snapPoint,
				x: candidate.x,
				y: candidate.y,
				distance: Math.sqrt(squared),
			};
		}
	}
	return nearest;
}

export function resolveAttachedPosition(value, snappees, options = {}) {
	const prefix = options.prefix ?? "";
	const field = (name) => prefix ? `${prefix}${name[0].toUpperCase()}${name.slice(1)}` : name;
	if (!value?.[field("attached")]) {
		const x = value?.[field("x")];
		const y = value?.[field("y")];
		return Number.isFinite(Number(x)) && Number.isFinite(Number(y))
			? { x: Number(x), y: Number(y), attached: false }
			: null;
	}
	const id = value[field("snappee")];
	const snappee = snappeeCollection(snappees).find((candidate) => candidate.id === id);
	if (!snappee) return null;
	const requested = value[field("snapPoint")];
	const candidate = sampleSnappee(snappee, options).find((item) => sameSnapPoint(item.snapPoint, requested));
	return candidate ? { ...candidate, attached: true, snappee } : null;
}

export const SNAPPEE_TYPES = Object.freeze(Object.keys(SAMPLERS));
