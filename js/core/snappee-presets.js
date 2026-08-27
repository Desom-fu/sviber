import { createSnappee } from "./chart-model.js";

export const SNAPPEE_PRESETS = [
	{
		id: "playfieldGrid",
		type: "rectangularMesh",
		values: {
			topLeftX: -100,
			topLeftY: 50,
			bottomRightX: 100,
			bottomRightY: -50,
			horizontalTiles: 16,
			verticalTiles: 8,
		},
	},
	{
		id: "turntable",
		type: "radialMesh",
		values: {
			centerX: 0,
			centerY: 0,
			radius: 50,
			azimuthalTiles: 16,
			radialTiles: 4,
		},
	},
	{
		id: "hexagon1",
		type: "regularPolygonCurve",
		values: {
			centerX: 0,
			centerY: 0,
			radius: 100 / Math.sqrt(3),
			angle: 0,
			sides: 6,
			segmentsPerSide: 4,
			closed: true,
		},
	},
	{
		id: "hexagon2",
		type: "regularPolygonCurve",
		values: {
			centerX: 0,
			centerY: 0,
			radius: 50,
			angle: Math.PI / 2,
			sides: 6,
			segmentsPerSide: 4,
			closed: true,
		},
	},
	{
		id: "hexagon3",
		type: "regularPolygonCurve",
		values: {
			centerX: 0,
			centerY: 0,
			radius: 25 * Math.sqrt(3),
			angle: 0,
			sides: 6,
			segmentsPerSide: 2,
			closed: true,
		},
	},
	{
		id: "hexagon4",
		type: "regularPolygonCurve",
		values: {
			centerX: 0,
			centerY: 0,
			radius: 50 / Math.sqrt(3),
			angle: 0,
			sides: 6,
			segmentsPerSide: 2,
			closed: true,
		},
	},
	{
		id: "pentagon",
		type: "regularPolygonCurve",
		values: {
			centerX: 0,
			centerY: 20 * Math.sqrt(5) - 50,
			radius: 100 - 20 * Math.sqrt(5),
			angle: Math.PI / 2,
			sides: 5,
			segmentsPerSide: 4,
			closed: true,
		},
	},
];

export function createPresetSnappee(presetId, name) {
	const preset = SNAPPEE_PRESETS.find(candidate => candidate.id === presetId);
	if (!preset) {
		throw new TypeError(`Unknown snappee preset: ${presetId}`);
	}
	return createSnappee(preset.type, { ...preset.values, name: String(name || preset.id) });
}
