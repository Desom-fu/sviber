// Packaging a project into a Sunniesnow level archive (`.ssc`).
//
// A level archive is a flat zip: one JSON chart per difficulty, the music and cover art they
// reference, and any readme-style text file sitting in the project folder. Names must be
// unique within that flat namespace, and every entry timestamp is pinned to the DOS epoch so
// that exporting the same project twice produces a byte-identical archive.
//
// Split out of js/platform.js.

import { exportSunniesnowChartDocument } from "../core/project.js";
import { needsDisplayTextFile, nextAvailableFilename, sanitizeFilename } from "./platform-file-kinds.js";
import { directoryFilenames, readDirectoryFile } from "./platform-project-directory.js";

// The smallest timestamp a zip entry can represent, used for every entry so archives are
// reproducible.
const ZIP_EPOCH = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

// The flat name space of the archive: a name may be claimed only once.
function createNameReserver() {
	const usedNames = new Set();
	const reserve = (name, label) => {
		const key = name.toLowerCase();
		if (usedNames.has(key)) {
			throw new Error(`Duplicate Sunniesnow level filename for ${label}: ${name}.`);
		}
		usedNames.add(key);
	};
	return { usedNames, reserve };
}

function addChartEntries(zip, project, options, reserve) {
	for (const entry of project.charts) {
		const filename = String(entry.file || "");
		if (!filename || filename.includes("/") || filename.includes("\\") || !filename.endsWith(".json")) {
			throw new Error(`Invalid Sunniesnow chart filename: ${filename || "(empty)"}.`);
		}
		reserve(filename, "difficulty chart");
		const chart = exportSunniesnowChartDocument(entry.model, options);
		zip.file(filename, `${JSON.stringify(chart, null, 2)}\n`, { date: ZIP_EPOCH });
	}
}

// Difficulties commonly share one music file and one cover, so assets are keyed by their
// resolved source path and packaged only once.
async function addAssetEntries(zip, project, files, { usedNames, reserve }) {
	const packagedAssets = new Map();
	for (const entry of project.charts) {
		for (const [field, fallback] of [
			["music", "music"],
			["image", "cover"],
		]) {
			const reference = String(entry.model[field] || "");
			if (!reference) {
				continue;
			}
			const resolved = files.resolveAssetPath(reference) || reference;
			if (packagedAssets.has(resolved.toLowerCase())) {
				continue;
			}
			const file = await files.fileForAsset(reference, field);
			if (!file) {
				throw new Error(`Unable to read referenced ${field}: ${reference}.`);
			}
			const preferred = sanitizeFilename(file.name || reference, fallback);
			const assetName = nextAvailableFilename(preferred, candidate => usedNames.has(candidate.toLowerCase()));
			reserve(assetName, field);
			zip.file(assetName, new Uint8Array(await file.arrayBuffer()), { date: ZIP_EPOCH });
			packagedAssets.set(resolved.toLowerCase(), assetName);
		}
	}
	return packagedAssets;
}

// v17: text files that Sunniesnow would show as level readme texts are packaged too.
async function addReadmeEntries(zip, files, usedNames) {
	const directory = files.currentProjectDirectory();
	if (!directory) {
		return;
	}
	let filenames = [];
	try {
		filenames = await directoryFilenames(directory);
	} catch {
		return;
	}
	for (const filename of filenames) {
		if (usedNames.has(filename.toLowerCase()) || !needsDisplayTextFile(filename)) {
			continue;
		}
		const file = await readDirectoryFile(directory, filename, "text/plain");
		if (!file) {
			continue;
		}
		usedNames.add(filename.toLowerCase());
		zip.file(filename, new Uint8Array(await file.arrayBuffer()), { date: ZIP_EPOCH });
	}
}

// `files` is the FileManager that owns the project: it resolves asset references and knows
// which folder, if any, the project currently lives in.
export async function createLevelArchive(files, project, options = {}) {
	await globalThis.sviberDependenciesReady;
	if (!globalThis.JSZip) {
		throw new Error("JSZip is unavailable.");
	}
	if (!Array.isArray(project?.charts) || !project.charts.length) {
		throw new Error("A level must contain at least one difficulty.");
	}
	const zip = new JSZip();
	const names = createNameReserver();
	addChartEntries(zip, project, options, names.reserve);
	await addAssetEntries(zip, project, files, names);
	await addReadmeEntries(zip, files, names.usedNames);
	return zip.generateAsync({
		type: "blob",
		compression: "DEFLATE",
		compressionOptions: { level: 6 },
		platform: "UNIX",
	});
}
