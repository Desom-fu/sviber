import { SUNNIESNOW_SCHEMA } from "./chart-model.js";

export const PROJECT_FILENAME = "sviber-project.json";
export const PROJECT_FORMAT = "sviber-project";
export const PROJECT_VERSION = 1;

const CHART_KEYS = new Set([
	"$schema", "title", "artist", "charter", "difficultyName", "difficultyColor",
	"difficulty", "difficultySup", "offset", "sscharter", "filters", "events",
]);
const EVENT_KEYS = new Set(["type", "time", "properties", "timeDependent", "filters"]);
const PATTERN_TYPES = new Set([
	"grid", "hexagon", "checkerboard", "diamondGrid", "pentagon", "turntable", "hexagram",
]);
const EVENT_PROPERTY_KEYS = Object.freeze({
	tap: new Set(["x", "y", "tipPoint", "text", "size", "fake", "doubleLine"]),
	hold: new Set(["x", "y", "duration", "tipPoint", "text", "size", "fake", "doubleLine"]),
	drag: new Set(["x", "y", "tipPoint", "size", "fake", "doubleLine"]),
	flick: new Set(["x", "y", "angle", "tipPoint", "text", "size", "fake", "doubleLine"]),
	placeholder: new Set(["x", "y", "tipPoint"]),
	bgNote: new Set(["x", "y", "duration", "tipPoint", "text", "size"]),
	bigText: new Set(["text", "duration"]),
});

function plainObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assert(condition, message) {
	if (!condition) throw new TypeError(message);
}

function assertOnlyKeys(value, allowed, label) {
	for (const key of Object.keys(value)) {
		assert(allowed.has(key), `${label} contains unsupported field \`${key}\`.`);
	}
}

function assertFinite(value, label) {
	assert(typeof value === "number" && Number.isFinite(value), `${label} must be a finite number.`);
}

function isRootFilename(value, extension = "") {
	if (typeof value !== "string" || !value || value === "." || value === "..") return false;
	if (value.includes("/") || value.includes("\\") || /[<>:"|?*\u0000-\u001f]/.test(value)) return false;
	return !extension || value.toLowerCase().endsWith(extension);
}

export function sanitizeFileStem(value, fallback = "chart") {
	const stem = String(value || fallback)
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
		.replace(/[. ]+$/g, "")
		.trim();
	return stem || fallback;
}

export function uniqueChartFilename(difficultyName, usedFilenames = []) {
	const used = new Set(Array.from(usedFilenames, value => String(value).toLowerCase()));
	const stem = sanitizeFileStem(difficultyName, "chart");
	let filename = `${stem}.json`;
	let suffix = 2;
	while (used.has(filename.toLowerCase()) || filename.toLowerCase() === PROJECT_FILENAME) {
		filename = `${stem}-${suffix++}.json`;
	}
	return filename;
}

export function createProjectManifest({ name, music = "", image = "", charts, activeChart }) {
	return normalizeProjectManifest({
		format: PROJECT_FORMAT,
		version: PROJECT_VERSION,
		name: String(name || "Untitled"),
		music: String(music || ""),
		image: String(image || ""),
		activeChart: String(activeChart || charts?.[0]?.id || ""),
		charts: (charts || []).map(({ id, file }) => ({ id: String(id), file: String(file) })),
	});
}

export function normalizeProjectManifest(source) {
	assert(plainObject(source), `${PROJECT_FILENAME} must contain a JSON object.`);
	assert(source.format === PROJECT_FORMAT, `${PROJECT_FILENAME} is not a Sviber project manifest.`);
	assert(source.version === PROJECT_VERSION, `Unsupported Sviber project version: ${source.version}.`);
	assert(Array.isArray(source.charts) && source.charts.length > 0, "A Sviber project must contain at least one difficulty.");
	assert(!source.music || isRootFilename(source.music), "The project music must be a file in the project folder root.");
	assert(!source.image || isRootFilename(source.image), "The project cover must be a file in the project folder root.");
	assert(!source.music || source.music.toLowerCase() !== PROJECT_FILENAME,
		"The project music filename conflicts with the project manifest.");
	assert(!source.image || source.image.toLowerCase() !== PROJECT_FILENAME,
		"The project cover filename conflicts with the project manifest.");

	const ids = new Set();
	const files = new Set();
	const charts = source.charts.map((entry, index) => {
		assert(plainObject(entry), `Difficulty ${index + 1} in the project manifest is invalid.`);
		const id = String(entry.id || "");
		const file = String(entry.file || "");
		assert(id && !ids.has(id), `Difficulty ${index + 1} has a missing or duplicate ID.`);
		assert(isRootFilename(file, ".json") && file.toLowerCase() !== PROJECT_FILENAME,
			`Difficulty ${index + 1} must use a JSON file in the project folder root.`);
		assert(!files.has(file.toLowerCase()), `Difficulty chart filename \`${file}\` is duplicated.`);
		ids.add(id);
		files.add(file.toLowerCase());
		return { id, file };
	});
	const assetNames = [source.music, source.image].filter(Boolean).map(value => String(value).toLowerCase());
	assert(new Set(assetNames).size === assetNames.length, "The project music and cover must use different filenames.");
	for (const filename of assetNames) {
		assert(!files.has(filename), `Project asset filename \`${filename}\` conflicts with a difficulty chart.`);
	}
	const requestedActive = String(source.activeChart || "");
	return {
		format: PROJECT_FORMAT,
		version: PROJECT_VERSION,
		name: String(source.name || "Untitled"),
		music: String(source.music || ""),
		image: String(source.image || ""),
		activeChart: ids.has(requestedActive) ? requestedActive : charts[0].id,
		charts,
	};
}

export function projectManagedFiles(manifest) {
	const normalized = normalizeProjectManifest(manifest);
	return new Set([
		...normalized.charts.map(entry => entry.file),
		normalized.music,
		normalized.image,
	].filter(Boolean));
}

function assertEventProperties(event, index) {
	const properties = event.properties;
	assert(plainObject(properties), `Event ${index + 1} properties must be an object.`);
	const allowed = PATTERN_TYPES.has(event.type)
		? new Set(["duration"])
		: EVENT_PROPERTY_KEYS[event.type];
	assert(allowed, `Event ${index + 1} has unsupported type \`${event.type}\`.`);
	assertOnlyKeys(properties, allowed, `Event ${index + 1} properties`);

	if (["tap", "hold", "drag", "flick", "placeholder", "bgNote"].includes(event.type)) {
		assertFinite(properties.x, `Event ${index + 1} x`);
		assertFinite(properties.y, `Event ${index + 1} y`);
	}
	if (event.type === "hold") {
		assertFinite(properties.duration, `Event ${index + 1} duration`);
		assert(properties.duration > 0, `Event ${index + 1} hold duration must be greater than zero.`);
	}
	if (event.type === "bgNote" || event.type === "bigText" || PATTERN_TYPES.has(event.type)) {
		assertFinite(properties.duration, `Event ${index + 1} duration`);
		assert(properties.duration >= 0, `Event ${index + 1} duration must not be negative.`);
	}
	if (event.type === "flick") assertFinite(properties.angle, `Event ${index + 1} flick angle`);
	if (event.type === "bigText") {
		assert(typeof properties.text === "string" && properties.text.length > 0,
			`Event ${index + 1} big text must not be empty.`);
	}
	if (Object.hasOwn(properties, "text")) assert(typeof properties.text === "string", `Event ${index + 1} text must be a string.`);
	if (Object.hasOwn(properties, "tipPoint")) {
		assert(properties.tipPoint === null || typeof properties.tipPoint === "string",
			`Event ${index + 1} tipPoint must be a string or null.`);
	}
}

export function assertSunniesnowChart(chart) {
	assert(plainObject(chart), "The exported Sunniesnow chart must be a JSON object.");
	assertOnlyKeys(chart, CHART_KEYS, "Sunniesnow chart");
	assert(chart.$schema === SUNNIESNOW_SCHEMA, "The exported chart must identify Sunniesnow Chart 1.0.");
	for (const key of ["title", "artist", "charter", "difficultyName", "difficulty"]) {
		assert(typeof chart[key] === "string" && chart[key].length > 0, `Sunniesnow field \`${key}\` must not be empty.`);
	}
	assert(typeof chart.difficultyColor === "string"
		|| Number.isSafeInteger(chart.difficultyColor) && chart.difficultyColor >= 0 && chart.difficultyColor <= 0xffffff,
	"Sunniesnow field `difficultyColor` must be a CSS color string or RGB integer.");
	if (Object.hasOwn(chart, "difficultySup")) assert(typeof chart.difficultySup === "string", "Sunniesnow field `difficultySup` must be a string.");
	assert(Array.isArray(chart.events) && chart.events.length > 0, "A Sunniesnow chart must contain at least one event.");
	chart.events.forEach((event, index) => {
		assert(plainObject(event), `Event ${index + 1} must be an object.`);
		assertOnlyKeys(event, EVENT_KEYS, `Event ${index + 1}`);
		assert(typeof event.type === "string", `Event ${index + 1} type must be a string.`);
		assertFinite(event.time, `Event ${index + 1} time`);
		assertEventProperties(event, index);
	});
	return chart;
}

export function exportStrictSunniesnowChart(model) {
	const chart = model.exportSunniesnow({ includeSchema: true });
	return assertSunniesnowChart(chart);
}
