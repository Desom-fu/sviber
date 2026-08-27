export const INTERNAL = Symbol("sviber macro wrapper");
export const OMITTED = Symbol("omitted macro argument");

export const MESH_SNAPPEE_TYPES = new Set(["rectangularMesh", "radialMesh", "parametricMesh"]);
export const CURVE_SNAPPEE_TYPES = new Set([
	"regularPolygonCurve",
	"bezierCurve",
	"circularArcCurve",
	"penCurve",
	"parametricCurve",
]);

const ANGLES = {
	u: Math.PI / 2,
	up: Math.PI / 2,
	d: -Math.PI / 2,
	down: -Math.PI / 2,
	l: Math.PI,
	left: Math.PI,
	r: 0,
	right: 0,
	ul: (3 * Math.PI) / 4,
	lu: (3 * Math.PI) / 4,
	upleft: (3 * Math.PI) / 4,
	leftup: (3 * Math.PI) / 4,
	ur: Math.PI / 4,
	ru: Math.PI / 4,
	upright: Math.PI / 4,
	rightup: Math.PI / 4,
	dl: (-3 * Math.PI) / 4,
	ld: (-3 * Math.PI) / 4,
	downleft: (-3 * Math.PI) / 4,
	leftdown: (-3 * Math.PI) / 4,
	dr: -Math.PI / 4,
	rd: -Math.PI / 4,
	downright: -Math.PI / 4,
	rightdown: -Math.PI / 4,
};

const NAMED_COLORS = {
	red: "#ff0000",
	green: "#008000",
	blue: "#0000ff",
	white: "#ffffff",
	black: "#000000",
	yellow: "#ffff00",
	magenta: "#ff00ff",
	cyan: "#00ffff",
	transparent: "#00000000",
};

const matrixValues = new WeakMap();

export function clone(value) {
	return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function ensureAlive(item, kind) {
	if (!item || item.__deleted) {
		throw new Error(`${kind} has been deleted`);
	}
	return item;
}

export function createBinder() {
	const bound = new WeakMap();

	function ctxOf(target) {
		let current = target;
		while (current && typeof current === "function") {
			const ctx = bound.get(current);
			if (ctx) {
				return ctx;
			}
			current = Object.getPrototypeOf(current);
		}
		throw new TypeError("macro API context is missing");
	}

	function attach(ctx, Class) {
		bound.set(Class, ctx);
		return Class;
	}

	function extend(ctx, Super, name = Super.name) {
		const Bound = {
			[name]: class extends Super {},
		}[name];
		return attach(ctx, Bound);
	}

	return { ctxOf, attach, extend };
}

export function gcd(a, b) {
	a = Math.abs(Math.trunc(a));
	b = Math.abs(Math.trunc(b));
	while (b) {
		[a, b] = [b, a % b];
	}
	return a || 1;
}

export function angleValue(value) {
	if (typeof value === "string" && Object.hasOwn(ANGLES, value.toLowerCase())) {
		return ANGLES[value.toLowerCase()];
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	throw new TypeError("angle must be a finite number or direction name");
}

export function beatTuple(value) {
	const parsed = parseBeatParts(value);
	let { numerator, denominator } = parsed;
	if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) {
		throw new TypeError("beat must be a number or rational tuple");
	}
	if (denominator < 0) {
		numerator = -numerator;
		denominator = -denominator;
	}
	const divisor = gcd(numerator, denominator);
	numerator /= divisor;
	denominator /= divisor;
	const whole = Math.trunc(numerator / denominator);
	const remainder = numerator - whole * denominator;
	return [whole, remainder, denominator];
}

export function beatNumber(value) {
	const tuple = beatTuple(value);
	return Number(tuple[0]) + Number(tuple[1]) / Number(tuple[2]);
}

export function addBeat(left, right) {
	return beatTuple(beatNumber(left) + beatNumber(right));
}

export function normalizeColor(value) {
	if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 0xffffff) {
		return `#${value.toString(16).padStart(6, "0")}`;
	}
	if (typeof value === "string") {
		const text = value.trim().toLowerCase();
		const canvasColor = canvasFillColor(text);
		if (canvasColor) {
			return canvasColor;
		}
		if (/^#[0-9a-f]{3,8}$/i.test(text)) {
			return expandHexColor(text);
		}
		const rgb = parseRgbColor(text);
		if (rgb) {
			return rgb;
		}
		if (NAMED_COLORS[text]) {
			return NAMED_COLORS[text];
		}
	}
	return value == null ? "#7f7f7f" : String(value);
}

export function transformPoint(point, matrix) {
	const [a, b, c, d, tx, ty] = matrix;
	return { x: a * point.x + c * point.y + tx, y: b * point.x + d * point.y + ty };
}

export function snapPointKey(point) {
	return Array.isArray(point) ? point.join(",") : String(point);
}

export function evaluateExpression(expression, scope) {
	const finiteResult = value => {
		const number = Number(value);
		if (!Number.isFinite(number)) {
			throw new TypeError("parametric expression must produce a finite number");
		}
		return number;
	};
	if (typeof expression === "number") {
		return finiteResult(expression);
	}
	if (typeof expression === "function") {
		return finiteResult(expression(scope));
	}
	const text = String(expression ?? "0").trim();
	if (Object.hasOwn(scope, text)) {
		return finiteResult(scope[text]);
	}
	const math = globalThis.math ?? globalThis.parent?.math;
	if (math?.evaluate) {
		return finiteResult(math.evaluate(text, scope));
	}
	if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
		return finiteResult(text);
	}
	throw new Error("Parametric snappees require math.js");
}

export function snapPointPosition(raw, point) {
	const p = Array.isArray(point) ? point : [point];
	let position;
	switch (raw?.type) {
		case "rectangularMesh":
			position = rectangularMeshPosition(raw, p);
			break;
		case "radialMesh":
			position = radialMeshPosition(raw, p);
			break;
		case "parametricMesh":
			position = parametricMeshPosition(raw, p);
			break;
		case "regularPolygonCurve":
			position = regularPolygonCurvePosition(raw, p);
			break;
		case "bezierCurve":
			position = bezierCurvePosition(raw, p);
			break;
		case "penCurve":
			position = penCurvePosition(raw, p);
			break;
		case "parametricCurve":
			position = parametricCurvePosition(raw, p);
			break;
		default:
			position = {
				x: Number(raw?.centerX ?? raw?.topLeftX ?? 0),
				y: Number(raw?.centerY ?? raw?.topLeftY ?? 0),
			};
	}
	return transformPoint(position, raw?.transformation || [1, 0, 0, 1, 0, 0]);
}

export function integerRange(range, exclusive = false, forceExclusive = false) {
	if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isSafeInteger)) {
		throw new TypeError("range must contain two integers");
	}
	const [start, end] = range;
	const direction = end >= start ? 1 : -1;
	const points = [];
	for (let value = start; direction > 0 ? value < end : value > end; value += direction) {
		points.push(value);
	}
	if (!exclusive && !forceExclusive) {
		points.push(end);
	}
	return points;
}

export function snapPoints(raw) {
	const points = [];
	if (raw.type === "rectangularMesh") {
		collectRectangularSnapPoints(raw, points);
	} else if (raw.type === "radialMesh") {
		collectRadialSnapPoints(raw, points);
	} else if (raw.type === "parametricMesh") {
		collectParametricMeshSnapPoints(raw, points);
	} else if (raw.type === "parametricCurve") {
		points.push(...integerRange(raw.iRange, raw.iRangeExclusive, Boolean(raw.closed)));
	} else {
		collectCurveSnapPoints(raw, points);
	}
	return points.map(snapPoint => locatedSnapPoint(raw, snapPoint));
}

export function nearestSnapPoint(raw, x, y) {
	return (
		snapPoints(raw)
			.map(point => ({ ...point, distance: Math.hypot(point.x - x, point.y - y) }))
			.sort((a, b) => a.distance - b.distance)[0] || { snapPoint: 0, ...snapPointPosition(raw, 0) }
	);
}

export function checkedSnapPoint(raw, args) {
	let expected = 0;
	if (MESH_SNAPPEE_TYPES.has(raw.type)) {
		expected = 2;
	} else if (CURVE_SNAPPEE_TYPES.has(raw.type)) {
		expected = 1;
	}
	if (!expected || args.length !== expected || args.some(value => !Number.isInteger(value))) {
		throw new TypeError("snap point expects one curve index or two mesh indices");
	}
	return expected === 2 ? [args[0], args[1]] : args[0];
}

export function affineMatrixValues(matrix) {
	return matrixValues.get(matrix);
}

export function moveListItem(list, item, direction) {
	const index = list.indexOf(item);
	const target = index + direction;
	if (index < 0 || target < 0 || target >= list.length) {
		return;
	}
	[list[index], list[target]] = [list[target], list[index]];
}

export class Vector2D {
	constructor(x = 0, y = 0) {
		this.x = Number(x) || 0;
		this.y = Number(y) || 0;
	}

	add(value) {
		const point = value instanceof Vector2D ? value : new Vector2D(value.x, value.y);
		return new Vector2D(this.x + point.x, this.y + point.y);
	}

	sub(value) {
		const point = value instanceof Vector2D ? value : new Vector2D(value.x, value.y);
		return new Vector2D(this.x - point.x, this.y - point.y);
	}

	mul(value) {
		return new Vector2D(this.x * Number(value), this.y * Number(value));
	}

	div(value) {
		return new Vector2D(this.x / Number(value), this.y / Number(value));
	}
}

export class AffineMatrix2D {
	constructor(...args) {
		assignAffineMatrix(this, args);
	}

	get a() {
		return matrixValues.get(this)[0];
	}

	set a(value) {
		matrixValues.get(this)[0] = Number(value);
	}

	get b() {
		return matrixValues.get(this)[1];
	}

	set b(value) {
		matrixValues.get(this)[1] = Number(value);
	}

	get c() {
		return matrixValues.get(this)[2];
	}

	set c(value) {
		matrixValues.get(this)[2] = Number(value);
	}

	get d() {
		return matrixValues.get(this)[3];
	}

	set d(value) {
		matrixValues.get(this)[3] = Number(value);
	}

	get tx() {
		return matrixValues.get(this)[4];
	}

	set tx(value) {
		matrixValues.get(this)[4] = Number(value);
	}

	get ty() {
		return matrixValues.get(this)[5];
	}

	set ty(value) {
		matrixValues.get(this)[5] = Number(value);
	}

	translate(x, y) {
		const point = x instanceof Vector2D ? x : new Vector2D(x, y);
		this.tx += point.x;
		this.ty += point.y;
		return this;
	}

	scale(x, y = x) {
		this.a *= Number(x);
		this.b *= Number(x);
		this.c *= Number(y);
		this.d *= Number(y);
		return this;
	}

	rotate(angle) {
		const radians = angleValue(angle);
		const c = Math.cos(radians);
		const s = Math.sin(radians);
		return this.compose(new AffineMatrix2D(c, s, -s, c, 0, 0));
	}

	horizontalFlip() {
		return this.scale(-1, 1);
	}

	flipHorizontally() {
		return this.horizontalFlip();
	}

	verticalFlip() {
		return this.scale(1, -1);
	}

	flipVertically() {
		return this.verticalFlip();
	}

	compose(matrix) {
		composeAffineMatrix(this, matrix);
		return this;
	}
}

function parseBeatParts(value) {
	if (Array.isArray(value) && value.length === 3 && value.every(Number.isSafeInteger)) {
		if (value[2] === 0) {
			throw new TypeError("beat denominator must not be zero");
		}
		return { denominator: Number(value[2]), numerator: Number(value[0]) * Number(value[2]) + Number(value[1]) };
	}
	if (Array.isArray(value) && value.length === 2 && value.every(Number.isSafeInteger)) {
		return { numerator: value[0], denominator: value[1] };
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return { denominator: 1_000_000, numerator: Math.round(value * 1_000_000) };
	}
	throw new TypeError("beat must be a number or rational tuple");
}

function canvasFillColor(text) {
	if (!globalThis.document?.createElement) {
		return null;
	}
	const context = globalThis.document.createElement("canvas").getContext("2d");
	if (!context) {
		return null;
	}
	context.fillStyle = "#010203";
	context.fillStyle = text;
	if (context.fillStyle !== "#010203" || text === "#010203") {
		return context.fillStyle;
	}
	return null;
}

function expandHexColor(text) {
	if (text.length !== 4) {
		return text;
	}
	// #rgb is expanded to #rrggbb so the stored value is always canonical.
	return `#${text
		.slice(1)
		.split("")
		.map(char => char + char)
		.join("")}`;
}

function parseRgbColor(text) {
	const rgb = text.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
	if (!rgb) {
		return null;
	}
	return `#${rgb
		.slice(1, 4)
		.map(channel =>
			Math.max(0, Math.min(255, Math.round(Number(channel))))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;
}

function rectangularMeshPosition(raw, p) {
	const i = Number(p[0] ?? 0);
	const j = Number(p[1] ?? 0);
	const left = Number(raw.topLeftX ?? -100);
	const top = Number(raw.topLeftY ?? 50);
	const right = Number(raw.bottomRightX ?? 100);
	const bottom = Number(raw.bottomRightY ?? -50);
	return {
		x: left + (i * (right - left)) / Math.max(1, Number(raw.horizontalTiles ?? 1)),
		y: top + (j * (bottom - top)) / Math.max(1, Number(raw.verticalTiles ?? 1)),
	};
}

function radialMeshPosition(raw, p) {
	const i = Number(p[0] ?? 0);
	const j = Number(p[1] ?? 0);
	const m = Math.max(1, Number(raw.azimuthalTiles ?? 1));
	const n = Math.max(1, Number(raw.radialTiles ?? 1));
	const angle = Number(raw.startingAngle ?? raw.angle ?? 0) + (i * Math.PI * 2) / m;
	const radius = (Number(raw.radius ?? 50) * j) / n;
	return {
		x: Number(raw.centerX ?? 0) + radius * Math.cos(angle),
		y: Number(raw.centerY ?? 0) + radius * Math.sin(angle),
	};
}

function parametricMeshPosition(raw, p) {
	const scope = { i: Number(p[0] ?? 0), j: Number(p[1] ?? 0) };
	return {
		x: evaluateExpression(raw.xExpression, scope),
		y: evaluateExpression(raw.yExpression, scope),
	};
}

function regularPolygonCurvePosition(raw, p) {
	const sides = Math.max(3, Number(raw.sides ?? raw.numberOfSides ?? 3));
	const segments = Math.max(1, Number(raw.segmentsPerSide ?? 1));
	const index = Number(p[0] ?? 0);
	const side = Math.floor(index / segments);
	const part = (index % segments) / segments;
	const angle = Number(raw.angle ?? 0);
	const radius = Number(raw.radius ?? 50);
	const vertex = k => ({
		x: Number(raw.centerX ?? 0) + radius * Math.cos(angle + (k * Math.PI * 2) / sides),
		y: Number(raw.centerY ?? 0) + radius * Math.sin(angle + (k * Math.PI * 2) / sides),
	});
	const a = vertex(side);
	const b = vertex((side + 1) % sides);
	return { x: a.x + (b.x - a.x) * part, y: a.y + (b.y - a.y) * part };
}

function bezierCurvePosition(raw, p) {
	const points = raw.controlPoints || [];
	const t = Number(p[0] ?? 0) / Math.max(1, Number(raw.segments ?? 1));
	const work = points.map(value => ({
		x: Number(value.x ?? value[0] ?? 0),
		y: Number(value.y ?? value[1] ?? 0),
	}));
	for (let level = work.length - 1; level > 0; level -= 1) {
		for (let i = 0; i < level; i += 1) {
			work[i].x += (work[i + 1].x - work[i].x) * t;
			work[i].y += (work[i + 1].y - work[i].y) * t;
		}
	}
	return { x: work[0]?.x ?? 0, y: work[0]?.y ?? 0 };
}

function penCurvePosition(raw, p) {
	const node = (raw.penNodes || raw.commands || [])[Number(p[0] ?? 0)];
	return { x: Number(node?.x ?? node?.[1] ?? 0), y: Number(node?.y ?? node?.[2] ?? 0) };
}

function parametricCurvePosition(raw, p) {
	const scope = { i: Number(p[0] ?? 0) };
	return {
		x: evaluateExpression(raw.xExpression, scope),
		y: evaluateExpression(raw.yExpression, scope),
	};
}

function locatedSnapPoint(raw, snapPoint) {
	return { snapPoint, ...snapPointPosition(raw, snapPoint) };
}

function collectRectangularSnapPoints(raw, points) {
	for (let i = 0; i <= Number(raw.horizontalTiles ?? 1); i += 1) {
		for (let j = 0; j <= Number(raw.verticalTiles ?? 1); j += 1) {
			points.push([i, j]);
		}
	}
}

function collectRadialSnapPoints(raw, points) {
	for (let i = 0; i < Number(raw.azimuthalTiles ?? 1); i += 1) {
		for (let j = 0; j <= Number(raw.radialTiles ?? 1); j += 1) {
			points.push([i, j]);
		}
	}
}

function collectParametricMeshSnapPoints(raw, points) {
	for (const i of integerRange(raw.iRange, raw.iRangeExclusive)) {
		for (const j of integerRange(raw.jRange, raw.jRangeExclusive)) {
			points.push([i, j]);
		}
	}
}

function collectCurveSnapPoints(raw, points) {
	let count = Number(raw.segments ?? 16);
	if (raw.type === "regularPolygonCurve") {
		count = Number(raw.sides ?? 3) * Number(raw.segmentsPerSide ?? 1);
	}
	count = Math.max(1, count);
	const exclusiveEnd = raw.type === "regularPolygonCurve" || Boolean(raw.closed);
	for (let i = 0; i < count + (exclusiveEnd ? 0 : 1); i += 1) {
		points.push(i);
	}
}

function assignAffineMatrix(self, args) {
	if (args.length > 6) {
		throw new TypeError("AffineMatrix2D expects at most six numbers");
	}
	if (args.some(value => typeof value !== "number" || !Number.isFinite(value))) {
		throw new TypeError("matrix elements must be finite numbers");
	}
	const defaults = [1, 0, 0, 1, 0, 0];
	const values = defaults.map((fallback, index) => (index < args.length ? args[index] : fallback));
	matrixValues.set(self, values);
}

function composeAffineMatrix(self, matrix) {
	if (!(matrix instanceof AffineMatrix2D)) {
		throw new TypeError("matrix must be an AffineMatrix2D");
	}
	const other = matrixValues.get(matrix);
	const [a, b, c, d, tx, ty] = matrixValues.get(self);
	matrixValues.set(self, [
		a * other[0] + c * other[1],
		b * other[0] + d * other[1],
		a * other[2] + c * other[3],
		b * other[2] + d * other[3],
		a * other[4] + c * other[5] + tx,
		b * other[4] + d * other[5] + ty,
	]);
}
