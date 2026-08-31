export const PROJECT_FILENAME = "project.sviber";
export const LEGACY_PROJECT_FILENAME = "sviber-project.json";
export const PROJECT_FORMAT = "sviber-project";
export const PROJECT_VERSION = 1;

export const PROJECT_FILENAMES = Object.freeze([PROJECT_FILENAME, LEGACY_PROJECT_FILENAME]);

function plainObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assert(condition, message) {
	if (!condition) {
		throw new TypeError(message);
	}
}

function isRootFilename(value, extension = "") {
	if (typeof value !== "string" || !value || value === "." || value === "..") {
		return false;
	}
	if (value.includes("/") || value.includes("\\") || /[<>:"|?*\u0000-\u001f]/.test(value)) {
		return false;
	}
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

export function createProjectManifest({ charts, activeChart, macros }) {
	return normalizeProjectManifest({
		activeChart: String(activeChart || charts?.[0]?.id || ""),
		charts: (charts || []).map(({ id, file }) => ({ id: String(id), file: String(file) })),
		macros: (macros || []).map(({ file, name }) => ({ file: String(file), name: String(name) })),
	});
}

// v17 adds the `macros` list to the manifest. Macro files still live in the project
// folder root; the manifest only records which of them belong to the project and how
// they are named in the macros interface.
function normalizeManifestMacros(source) {
	if (!Array.isArray(source)) {
		return [];
	}
	const files = new Set();
	const macros = [];
	for (const entry of source) {
		if (!plainObject(entry)) {
			continue;
		}
		const file = String(entry.file || "");
		if (!isRootFilename(file) || files.has(file.toLowerCase()) || file.toLowerCase() === PROJECT_FILENAME) {
			continue;
		}
		files.add(file.toLowerCase());
		macros.push({ file, name: String(entry.name || file.replace(/\.[^.]+$/, "")) });
	}
	return macros;
}

export function normalizeProjectManifest(source) {
	assert(plainObject(source), `${PROJECT_FILENAME} must contain a JSON object.`);
	// v16 manifests contain only chart membership and the active chart. Accept the
	// former v1 marker fields so existing projects can be opened and migrated on save.
	if (source.format != null) {
		assert(source.format === PROJECT_FORMAT, `${PROJECT_FILENAME} is not a Sviber project manifest.`);
	}
	if (source.version != null) {
		assert(source.version === PROJECT_VERSION, `Unsupported Sviber project version: ${source.version}.`);
	}
	assert(
		Array.isArray(source.charts) && source.charts.length > 0,
		"A Sviber project must contain at least one difficulty.",
	);

	const ids = new Set();
	const files = new Set();
	const charts = source.charts.map((entry, index) => {
		assert(plainObject(entry), `Difficulty ${index + 1} in the project manifest is invalid.`);
		const id = String(entry.id || "");
		const file = String(entry.file || "");
		assert(id && !ids.has(id), `Difficulty ${index + 1} has a missing or duplicate ID.`);
		assert(
			isRootFilename(file, ".json") && file.toLowerCase() !== PROJECT_FILENAME,
			`Difficulty ${index + 1} must use a JSON file in the project folder root.`,
		);
		assert(!files.has(file.toLowerCase()), `Difficulty chart filename \`${file}\` is duplicated.`);
		ids.add(id);
		files.add(file.toLowerCase());
		return { id, file };
	});
	const requestedActive = String(source.activeChart || "");
	return {
		charts,
		activeChart: ids.has(requestedActive) ? requestedActive : charts[0].id,
		macros: normalizeManifestMacros(source.macros),
	};
}

export function projectManagedFiles(manifest) {
	const normalized = normalizeProjectManifest(manifest);
	return new Set(normalized.charts.map(entry => entry.file));
}

export function exportSunniesnowChartDocument(model, options = {}) {
	return model.exportSunniesnow({ includeSchema: true, ...options });
}
