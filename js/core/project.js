export const PROJECT_FILENAME = "sviber-project.json";
export const PROJECT_FORMAT = "sviber-project";
export const PROJECT_VERSION = 1;

function plainObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assert(condition, message) {
	if (!condition) throw new TypeError(message);
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

export function exportSunniesnowChartDocument(model, options = {}) {
	return model.exportSunniesnow({ includeSchema: true, ...options });
}
