// Snappee construction: the starting field set for every snappee shape plus the factory
// that normalizes a snappee's transform, colour, name and identity. Geometry sampling of
// those shapes lives in js/core/geometry.js; this module only owns their creation.
// Split out of js/core/chart-model.js.

import { IDENTITY_TRANSFORM, normalizeTransform } from "./geometry.js";
import { SNAPPEE_TYPE_SET } from "./chart-vocabulary.js";
import { clone, finiteNumber, normalizeColor, positiveInteger, validId } from "./chart-normalize.js";

function defaultSnappeeFields(type) {
	switch (type) {
		case "rectangularMesh":
			return {
				topLeftX: -100,
				topLeftY: 50,
				bottomRightX: 100,
				bottomRightY: -50,
				horizontalTiles: 16,
				verticalTiles: 8,
			};
		case "radialMesh":
			return { centerX: 0, centerY: 0, radius: 50, azimuthalTiles: 8, radialTiles: 4, startingAngle: 0 };
		case "parametricMesh":
			return {
				iRange: [-4, 5],
				iRangeExclusive: true,
				jRange: [-2, 3],
				jRangeExclusive: true,
				xExpression: "i * 25",
				yExpression: "j * 25",
			};
		case "regularPolygonCurve":
			return {
				centerX: 0,
				centerY: 0,
				angle: Math.PI / 2,
				radius: 50,
				sides: 5,
				segmentsPerSide: 4,
				closed: true,
			};
		case "bezierCurve":
			return {
				degree: 3,
				controlPoints: [
					{ x: -75, y: 0 },
					{ x: -25, y: 50 },
					{ x: 25, y: -50 },
					{ x: 75, y: 0 },
				],
				segments: 16,
				closed: false,
			};
		case "circularArcCurve":
			return {
				centerX: 0,
				centerY: 0,
				radius: 50,
				closed: false,
				beginningAngle: 0,
				endAngle: Math.PI,
				clockwise: false,
				segments: 16,
			};
		case "penCurve":
			return {
				commands: [
					{ type: "M", x: -50, y: 0 },
					{ type: "L", x: 50, y: 0 },
				],
				segments: 8,
				closed: false,
			};
		case "parametricCurve":
			return {
				iRange: [0, 16],
				iRangeExclusive: true,
				xExpression: "50 * cos(2 * pi * i / 16)",
				yExpression: "50 * sin(2 * pi * i / 16)",
				closed: true,
			};
		default:
			throw new TypeError(`Unsupported snappee type: ${type}`);
	}
}

export function createSnappee(type, overrides = {}) {
	if (!SNAPPEE_TYPE_SET.has(type)) {
		throw new TypeError(`Unsupported snappee type: ${type}`);
	}
	let transformation;
	try {
		transformation = normalizeTransform(overrides.transformation ?? IDENTITY_TRANSFORM);
	} catch {
		transformation = [...IDENTITY_TRANSFORM];
	}
	const snappee = {
		...defaultSnappeeFields(type),
		...clone(overrides),
		id: validId(overrides.id) ? overrides.id : null,
		name: String(overrides.name ?? type),
		color: normalizeColor(overrides.color, "#00e0ad"),
		type,
		transformation,
		active: Boolean(overrides.active ?? true),
		selected: Boolean(overrides.selected),
	};
	if (type === "radialMesh") {
		snappee.startingAngle = finiteNumber(overrides.startingAngle ?? overrides.angle, 0);
	}
	if (type === "regularPolygonCurve") {
		snappee.sides = positiveInteger(overrides.sides ?? overrides.numberOfSides ?? snappee.sides, 3);
	}
	return snappee;
}

export function createDefaultSnappees() {
	return [
		createSnappee("rectangularMesh", {
			name: "Playfield grid",
			topLeftX: -100,
			topLeftY: 50,
			bottomRightX: 100,
			bottomRightY: -50,
			horizontalTiles: 16,
			verticalTiles: 8,
		}),
	];
}
