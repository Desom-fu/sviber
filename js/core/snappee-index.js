// Index ranges for Snappee#pos. Meshes use i and j. Curves use i only.
// A regular polygon or circular arc also has a center that is not part of this range.

export const SPECIAL_SNAP_INDEX = -1;

export function isSpecialSnapPoint(snapPoint) {
	if (Array.isArray(snapPoint)) {
		return snapPoint.length > 0 && Number(snapPoint[0]) === SPECIAL_SNAP_INDEX;
	}
	return Number(snapPoint) === SPECIAL_SNAP_INDEX;
}

function positiveInteger(value, label, fallback) {
	const result = value == null ? fallback : Number(value);
	if (!Number.isSafeInteger(result) || result < 1) {
		throw new RangeError(`${label} must be a positive integer`);
	}
	return result;
}

function integerPair(range) {
	if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isSafeInteger)) {
		throw new TypeError("range must contain two integers");
	}
	return [range[0], range[1]];
}

export function snappeeIndexSpec(snappee) {
	if (!snappee || typeof snappee !== "object") {
		throw new TypeError("snappee must be an object");
	}
	const type = snappee.type;
	if (type === "rectangularMesh") {
		return {
			mesh: true,
			i: [0, positiveInteger(snappee.horizontalTiles, "horizontalTiles", 1)],
			iExcludeEnd: false,
			j: [0, positiveInteger(snappee.verticalTiles, "verticalTiles", 1)],
			jExcludeEnd: false,
			hasSpecial: false,
			specialI: null,
		};
	}
	if (type === "radialMesh") {
		return {
			mesh: true,
			i: [0, positiveInteger(snappee.azimuthalTiles, "azimuthalTiles", 1)],
			iExcludeEnd: true,
			j: [0, positiveInteger(snappee.radialTiles, "radialTiles", 1)],
			jExcludeEnd: false,
			hasSpecial: false,
			specialI: null,
		};
	}
	if (type === "parametricMesh") {
		return {
			mesh: true,
			i: integerPair(snappee.iRange),
			iExcludeEnd: Boolean(snappee.iRangeExclusive),
			j: integerPair(snappee.jRange),
			jExcludeEnd: Boolean(snappee.jRangeExclusive),
			hasSpecial: false,
			specialI: null,
		};
	}
	if (type === "parametricCurve") {
		return {
			mesh: false,
			i: integerPair(snappee.iRange),
			iExcludeEnd: Boolean(snappee.iRangeExclusive) || Boolean(snappee.closed),
			j: null,
			jExcludeEnd: false,
			hasSpecial: false,
			specialI: null,
		};
	}
	if (type === "regularPolygonCurve") {
		const sides = positiveInteger(snappee.sides ?? snappee.numberOfSides, "sides", 3);
		const segments = positiveInteger(snappee.segmentsPerSide, "segmentsPerSide", 1);
		return {
			mesh: false,
			i: [0, sides * segments],
			iExcludeEnd: true,
			j: null,
			jExcludeEnd: false,
			hasSpecial: true,
			specialI: SPECIAL_SNAP_INDEX,
		};
	}
	if (type === "bezierCurve" || type === "circularArcCurve" || type === "penCurve") {
		return {
			mesh: false,
			i: [0, positiveInteger(snappee.segments, "segments", 1)],
			iExcludeEnd: Boolean(snappee.closed),
			j: null,
			jExcludeEnd: false,
			hasSpecial: type === "circularArcCurve",
			specialI: type === "circularArcCurve" ? SPECIAL_SNAP_INDEX : null,
		};
	}
	throw new TypeError(`Unsupported snappee type: ${type}`);
}
