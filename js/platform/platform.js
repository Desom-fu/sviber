// The FileManager: everything the editor knows about where a chart came from and where it
// should go. It tracks the current chart target (a file handle, a local path, or nothing), the
// current project folder, and the music/cover files the chart references, and it turns those
// into open, save and export operations.
//
// The host-specific and format-specific parts live in sibling modules:
//   ./platform-file-kinds.js         - what a file is and what it may be called
//   ./platform-host.js               - NW.js vs. File System Access vs. download
//   ./platform-project-directory.js  - reading and writing the files of a project folder
//   ./platform-level-archive.js      - packaging a project into a Sunniesnow .ssc archive
//   ./autosave.js                    - periodic recovery snapshots in local storage
//
// `AutosaveManager`, `needsDisplayTextFile`, `download` and `sanitizeFilename` are re-exported
// from here so existing importers of this module keep working.

import { ChartModel } from "../core/chart-model.js";
import {
	PROJECT_FILENAME,
	LEGACY_PROJECT_FILENAME,
	PROJECT_FILENAMES,
	createProjectManifest,
	normalizeProjectManifest,
	sanitizeFileStem,
} from "../core/project.js";
import {
	AUDIO_EXTENSIONS,
	IMAGE_EXTENSIONS,
	MIME_TYPES,
	extension,
	looksLikeLyrica,
	sanitizeFilename,
} from "./platform-file-kinds.js";
import {
	download,
	fileFromBytes,
	nwModules,
	pickNwDirectoryPath,
	pickNwSavePath,
	writeHandle,
	writeLocalFile,
} from "./platform-host.js";
import {
	directoryFileExists,
	directoryFilenames,
	isSameDirectoryFile,
	projectDirectoryFromOptions,
	readDirectoryFile,
	removeDirectoryFile,
	uniqueProjectFilename,
	writeDirectoryFile,
} from "./platform-project-directory.js";
import { createLevelArchive } from "./platform-level-archive.js";

export { needsDisplayTextFile } from "./platform-file-kinds.js";
export { AutosaveManager } from "./autosave.js";
export { download, sanitizeFilename };

export class FileManager {
	constructor(options = {}) {
		this.dialogs = options.dialogs;
		this.toast = options.toast;
		this.i18n = options.i18n;
		this.fileHandle = null;
		this.chartFilename = "";
		this.chartPath = "";
		this.projectDirectoryHandle = null;
		this.projectPath = "";
		this.projectName = "";
		this.projectManifestFilename = PROJECT_FILENAME;
		this.musicFile = null;
		this.imageFile = null;
		this.musicReference = "";
		this.imageReference = "";
		this.assetFiles = new Map();
	}

	get supportsLocalPaths() {
		return Boolean(nwModules());
	}

	clearChartTarget() {
		this.fileHandle = null;
		this.chartFilename = "";
		this.chartPath = "";
	}

	clearProjectTarget() {
		this.projectDirectoryHandle = null;
		this.projectPath = "";
		this.projectName = "";
		this.projectManifestFilename = PROJECT_FILENAME;
		this.clearChartTarget();
	}

	localSourceContext() {
		return {
			projectPath: this.projectPath,
			projectName: this.projectName,
			chartPath: this.chartPath,
			chartFilename: this.chartFilename,
		};
	}

	restoreLocalSourceContext(source = {}) {
		this.clearProjectTarget();
		const modules = nwModules();
		if (!modules) {
			return false;
		}
		this.projectPath = source.projectPath ? modules.path.resolve(String(source.projectPath)) : "";
		this.projectName = String(source.projectName || "");
		this.chartPath = source.chartPath ? modules.path.resolve(String(source.chartPath)) : "";
		this.chartFilename = String(
			source.chartFilename || (this.chartPath ? modules.path.basename(this.chartPath) : ""),
		);
		return Boolean(this.projectPath || this.chartPath);
	}

	adoptChartSource(source) {
		this.fileHandle = source?.fileHandle || null;
		this.chartFilename = String(source?.chartFilename || "");
		this.chartPath = String(source?.chartPath || "");
	}

	clearCurrentAssets() {
		this.musicFile = null;
		this.imageFile = null;
		this.musicReference = "";
		this.imageReference = "";
	}

	localPathFor(file) {
		const modules = nwModules();
		const pathname = file?.path || file?.sviberPath;
		return modules && pathname ? modules.path.resolve(String(pathname)) : "";
	}

	// A file association passes the manifest file itself, while the project loader needs its
	// containing directory. The manifest contents are validated by openProject after this path
	// normalization.
	projectManifestDirectory(pathname) {
		const modules = nwModules();
		if (!modules || !pathname) {
			return "";
		}
		const resolved = modules.path.resolve(String(pathname));
		const basename = modules.path.basename(resolved).toLowerCase();
		if (!PROJECT_FILENAMES.some(filename => filename.toLowerCase() === basename)) {
			return "";
		}
		return modules.path.dirname(resolved);
	}

	// The manifest entry name for a chart file, or "" when the path is not a chart sitting
	// directly in the current project folder.
	projectChartFilename(pathname) {
		const modules = nwModules();
		if (!modules || !this.projectPath || !pathname) {
			return "";
		}
		const root = modules.path.resolve(this.projectPath);
		const resolved = modules.path.resolve(String(pathname));
		const insideRoot = modules.path.dirname(resolved).toLowerCase() === root.toLowerCase();
		const isChart = resolved.toLowerCase().endsWith(".json");
		const isManifest = PROJECT_FILENAMES.some(
			filename => resolved.toLowerCase() === modules.path.resolve(root, filename).toLowerCase(),
		);
		return insideRoot && isChart && !isManifest ? modules.path.basename(resolved) : "";
	}

	// v17: used by the CLI/argv path handling to tell a project folder from a chart file.
	async isProjectDirectory(pathname) {
		const modules = nwModules();
		if (!modules || !pathname) {
			return false;
		}
		try {
			const resolved = modules.path.resolve(String(pathname));
			if (!(await modules.fs.promises.stat(resolved)).isDirectory()) {
				return false;
			}
			const filename = await this.#findProjectManifestFilename(resolved);
			const text = await modules.fs.promises.readFile(modules.path.join(resolved, filename), "utf8");
			normalizeProjectManifest(JSON.parse(text));
			return true;
		} catch {
			return false;
		}
	}

	async containingProjectPath(pathname) {
		const modules = nwModules();
		if (!modules || !pathname) {
			return "";
		}
		const resolved = modules.path.resolve(String(pathname));
		const directory = modules.path.dirname(resolved);
		const chartFilename = modules.path.basename(resolved).toLowerCase();
		try {
			const manifestFilename = await this.#findProjectManifestFilename(directory);
			const text = await modules.fs.promises.readFile(modules.path.join(directory, manifestFilename), "utf8");
			const manifest = normalizeProjectManifest(JSON.parse(text));
			return manifest.charts.some(entry => entry.file.toLowerCase() === chartFilename) ? directory : "";
		} catch {
			return "";
		}
	}

	async #findProjectManifestFilename(directory) {
		const modules = nwModules();
		for (const filename of PROJECT_FILENAMES) {
			try {
				await modules.fs.promises.access(modules.path.join(directory, filename));
				return filename;
			} catch {
				// Try the next supported manifest name.
			}
		}
		throw new Error("The directory does not contain a Sviber project manifest.");
	}

	assetReference(file) {
		return this.localPathFor(file) || String(file?.name || "");
	}

	rememberAsset(reference, file, kind) {
		const key = String(reference || this.assetReference(file));
		if (!key || !file) {
			return "";
		}
		this.assetFiles.set(key, file);
		const localPath = this.localPathFor(file);
		if (localPath) {
			this.assetFiles.set(localPath, file);
		}
		if (kind === "music") {
			this.musicFile = file;
			this.musicReference = key;
		}
		if (kind === "image") {
			this.imageFile = file;
			this.imageReference = key;
		}
		return key;
	}

	resolveAssetPath(reference) {
		const modules = nwModules();
		if (!modules || !reference) {
			return "";
		}
		const value = String(reference);
		if (modules.path.isAbsolute(value)) {
			return modules.path.normalize(value);
		}
		if (this.projectPath) {
			return modules.path.resolve(this.projectPath, value);
		}
		if (this.chartPath) {
			return modules.path.resolve(modules.path.dirname(this.chartPath), value);
		}
		return modules.path.resolve(value);
	}

	resolveChartAssetReference(reference, chartPath) {
		const modules = nwModules();
		const value = String(reference || "");
		if (!modules || !value) {
			return value;
		}
		if (modules.path.isAbsolute(value)) {
			return modules.path.normalize(value);
		}
		return chartPath ? modules.path.resolve(modules.path.dirname(chartPath), value) : modules.path.resolve(value);
	}

	async fileForAsset(reference, kind) {
		const key = String(reference || "");
		if (!key) {
			return null;
		}
		if (this.assetFiles.has(key)) {
			return this.assetFiles.get(key);
		}
		const modules = nwModules();
		const pathname = this.resolveAssetPath(key);
		if (!modules || !pathname) {
			return null;
		}
		const bytes = await modules.fs.promises.readFile(pathname);
		const name = modules.path.basename(pathname);
		const type = MIME_TYPES[extension(name)] || (kind === "music" ? "audio/*" : "image/*");
		const file = fileFromBytes(bytes, name, type, pathname);
		this.assetFiles.set(key, file);
		this.assetFiles.set(pathname, file);
		return file;
	}

	async fileFromLocalPath(pathname, type = "application/json") {
		const modules = nwModules();
		if (!modules || !pathname) {
			return null;
		}
		const resolved = modules.path.resolve(String(pathname));
		const stat = await modules.fs.promises.stat(resolved);
		if (!stat.isFile()) {
			return null;
		}
		const bytes = await modules.fs.promises.readFile(resolved);
		return fileFromBytes(bytes, modules.path.basename(resolved), type, resolved);
	}

	async chooseProjectDirectory() {
		const modules = nwModules();
		if (modules) {
			const pathname = await pickNwDirectoryPath();
			return pathname ? { type: "nw", path: modules.path.resolve(pathname) } : null;
		}
		throw new Error("Project folders are available only in the desktop app.");
	}

	// The project folder the editor is currently pointed at, as a descriptor the functions in
	// ./platform-project-directory.js understand, or null when no project is open.
	currentProjectDirectory() {
		if (this.projectPath) {
			return { type: "nw", path: this.projectPath };
		}
		if (this.projectDirectoryHandle) {
			return { type: "browser", handle: this.projectDirectoryHandle };
		}
		return null;
	}

	#writeDirectoryFile(directory, filename, value) {
		return writeDirectoryFile(directory, filename, value, this.localPathFor(value));
	}

	#isSameDirectoryFile(directory, filename, file) {
		return isSameDirectoryFile(directory, filename, this.localPathFor(file));
	}

	async copyAssetIntoProject(file, fallback, existingReference = "") {
		const directory = this.currentProjectDirectory();
		if (!directory || !file) {
			return "";
		}
		const existingName = String(existingReference || "");
		if (
			existingName &&
			sanitizeFilename(existingName, fallback) === existingName &&
			(await directoryFileExists(directory, existingName))
		) {
			return existingName;
		}
		const preferred = sanitizeFilename(file.name, fallback);
		let filename = preferred;
		let suffix = 2;
		while (await directoryFileExists(directory, filename)) {
			if (this.#isSameDirectoryFile(directory, filename, file)) {
				break;
			}
			const dot = preferred.lastIndexOf(".");
			const stem = dot > 0 ? preferred.slice(0, dot) : preferred;
			const extensionPart = dot > 0 ? preferred.slice(dot) : "";
			filename = `${stem}-${suffix++}${extensionPart}`;
		}
		await this.#writeDirectoryFile(directory, filename, file);
		return filename;
	}

	async openProject(options = {}) {
		if (!nwModules()) {
			throw new Error("Project folders are available only in the desktop app.");
		}
		const directory = projectDirectoryFromOptions(options) || (await this.chooseProjectDirectory());
		if (!directory) {
			return null;
		}
		const manifestFilename = await this.#findProjectManifestFilename(directory.path);
		const manifestFile = await readDirectoryFile(directory, manifestFilename, "application/json");
		const manifest = normalizeProjectManifest(JSON.parse(await manifestFile.text()));
		const charts = [];
		for (const entry of manifest.charts) {
			const file = await readDirectoryFile(directory, entry.file, "application/json");
			charts.push({ ...entry, document: JSON.parse(await file.text()) });
		}
		this.assetFiles.clear();
		this.clearCurrentAssets();
		this.#adoptProjectDirectory(directory, options.projectName);
		this.projectManifestFilename = manifestFilename;
		return { manifest, charts, projectName: this.projectName };
	}

	#adoptProjectDirectory(directory, projectName = "") {
		this.projectDirectoryHandle = directory.type === "browser" ? directory.handle : null;
		this.projectPath = directory.type === "nw" ? directory.path : "";
		const modules = nwModules();
		this.projectName = String(
			projectName ||
				(directory.type === "nw" ? modules?.path.basename(directory.path) : directory.handle?.name) ||
				"Untitled",
		);
		this.clearChartTarget();
	}

	// Resolves where a "Save project" should write to: the folder already open unless this is a
	// Save As, then whatever the caller supplied, then whatever the user picks. A folder the
	// project is not already in must not already hold a manifest.
	async #resolveProjectDestination(options) {
		let directory = !options.saveAs && this.currentProjectDirectory();
		const existingDirectory = Boolean(directory);
		directory ||= projectDirectoryFromOptions(options);
		directory ||= await this.chooseProjectDirectory();
		if (!directory) {
			return null;
		}
		if (!existingDirectory) {
			if (await directoryFileExists(directory, PROJECT_FILENAME)) {
				throw new Error(`The selected directory already contains ${PROJECT_FILENAME}.`);
			}
		}
		return { directory, existingDirectory };
	}

	// Claims a filename for every difficulty. Charts saved into a folder for the first time are
	// renamed away from anything already there; charts already belonging to the project keep
	// the names the manifest gave them.
	async #reserveProjectChartNames(project, directory, existingDirectory) {
		const existingNames = new Set((await directoryFilenames(directory)).map(name => name.toLowerCase()));
		const usedNames = new Set([...existingNames, ...PROJECT_FILENAMES.map(filename => filename.toLowerCase())]);
		for (const entry of project.charts) {
			if (existingDirectory) {
				usedNames.add(String(entry.file).toLowerCase());
			} else {
				entry.file = uniqueProjectFilename(entry.file, usedNames);
			}
		}
		const chartNames = new Set([
			...PROJECT_FILENAMES.map(filename => filename.toLowerCase()),
			...project.charts.map(entry => String(entry.file).toLowerCase()),
		]);
		return { existingNames, usedNames, chartNames };
	}

	// Whether an asset already in the project folder can stay under the name it has, rather
	// than being copied in under a fresh one.
	#canReuseProjectAsset(directory, names, reference, preferred, file, fallback) {
		const { existingDirectory, existingNames, chartNames, assetNames } = names;
		const key = preferred.toLowerCase();
		const alreadyInProject =
			existingDirectory &&
			sanitizeFilename(reference, fallback) === reference &&
			reference.toLowerCase() === key &&
			existingNames.has(key);
		const inPlace = alreadyInProject || this.#isSameDirectoryFile(directory, preferred, file);
		return inPlace && !chartNames.has(key) && !assetNames.has(key);
	}

	// Copies every music and cover file the project references into the project folder and
	// rewrites the chart references to the copied names. Difficulties sharing an asset share
	// the copy, keyed by the asset's resolved source path.
	async #saveProjectAssets(project, directory, names) {
		const savedAssets = new Map();
		names.assetNames = new Set();
		for (const entry of project.charts) {
			for (const [field, fallback] of [
				["music", "music"],
				["image", "cover"],
			]) {
				const reference = String(entry.model[field] || "");
				if (!reference) {
					continue;
				}
				const resolved = this.resolveAssetPath(reference) || reference;
				let asset = savedAssets.get(resolved.toLowerCase());
				if (!asset) {
					const file = await this.fileForAsset(reference, field);
					if (!file) {
						throw new Error(`Unable to read project ${field}: ${reference}.`);
					}
					const preferred = sanitizeFilename(file.name || reference, fallback);
					const reuse = this.#canReuseProjectAsset(directory, names, reference, preferred, file, fallback);
					const filename = reuse ? preferred : uniqueProjectFilename(preferred, names.usedNames);
					names.usedNames.add(filename.toLowerCase());
					names.assetNames.add(filename.toLowerCase());
					await this.#writeDirectoryFile(directory, filename, file);
					asset = { filename, file };
					savedAssets.set(resolved.toLowerCase(), asset);
				}
				entry.model[field] = asset.filename;
			}
		}
		return savedAssets;
	}

	// After a successful save the folder becomes the current project, and the asset cache is
	// rebuilt from the names actually written so later saves see the project-relative
	// references rather than the paths the assets were originally imported from.
	#adoptSavedProject(project, directory, savedAssets) {
		this.#adoptProjectDirectory(directory, project.name);
		this.projectManifestFilename = PROJECT_FILENAME;
		this.assetFiles.clear();
		for (const asset of savedAssets.values()) {
			this.assetFiles.set(asset.filename, asset.file);
		}
		const active = project.charts.find(entry => entry.id === project.activeChart);
		this.musicReference = String(active?.model.music || "");
		this.imageReference = String(active?.model.image || "");
		this.musicFile = this.assetFiles.get(this.musicReference) || null;
		this.imageFile = this.assetFiles.get(this.imageReference) || null;
	}

	async saveProject(project, options = {}) {
		if (!nwModules()) {
			throw new Error("Project folders are available only in the desktop app.");
		}
		const destination = await this.#resolveProjectDestination(options);
		if (!destination) {
			return null;
		}
		const { directory, existingDirectory } = destination;
		if (!Array.isArray(project?.charts) || !project.charts.length) {
			throw new Error("A project must contain at least one difficulty.");
		}
		const names = {
			existingDirectory,
			...(await this.#reserveProjectChartNames(project, directory, existingDirectory)),
		};
		const savedAssets = await this.#saveProjectAssets(project, directory, names);
		const manifest = createProjectManifest({
			charts: project.charts,
			activeChart: project.activeChart,
			macros: project.macros,
		});
		for (const entry of project.charts) {
			await this.#writeDirectoryFile(
				directory,
				entry.file,
				new Blob([entry.model.serialize(2)], { type: "application/json" }),
			);
		}
		await this.#writeDirectoryFile(
			directory,
			PROJECT_FILENAME,
			new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: "application/json" }),
		);
		if (this.projectManifestFilename === LEGACY_PROJECT_FILENAME && LEGACY_PROJECT_FILENAME !== PROJECT_FILENAME) {
			await removeDirectoryFile(directory, LEGACY_PROJECT_FILENAME);
		}
		this.#adoptSavedProject(project, directory, savedAssets);
		return {
			location: directory.type === "nw" ? directory.path : directory.handle.name,
			manifest,
		};
	}

	openProjectFolder() {
		if (!globalThis.nw || !this.projectPath) {
			return false;
		}
		globalThis.nw.Shell.openItem(this.projectPath);
		return true;
	}

	async readProjectText(filename) {
		const directory = this.currentProjectDirectory();
		if (!directory) {
			return null;
		}
		const file = await readDirectoryFile(directory, String(filename), "text/javascript");
		return file ? await file.text() : null;
	}

	async writeProjectText(filename, text) {
		const directory = this.currentProjectDirectory();
		if (!directory || !globalThis.nw) {
			throw new Error("Project macro files are available only in an NW.js project.");
		}
		return this.#writeDirectoryFile(directory, String(filename), String(text));
	}

	async renameProjectText(oldFilename, newFilename) {
		const directory = this.currentProjectDirectory();
		const modules = nwModules();
		if (!directory || directory.type !== "nw" || !modules) {
			throw new Error("Project macro files are available only in an NW.js project.");
		}
		const root = modules.path.resolve(directory.path);
		const oldPath = modules.path.resolve(root, String(oldFilename));
		const newPath = modules.path.resolve(root, String(newFilename));
		if (modules.path.dirname(oldPath) !== root || modules.path.dirname(newPath) !== root) {
			throw new Error("Invalid project filename.");
		}
		try {
			await modules.fs.promises.access(newPath);
			throw new Error("A project macro with that filename already exists.");
		} catch (error) {
			if (error?.code !== "ENOENT") {
				throw error;
			}
		}
		await modules.fs.promises.rename(oldPath, newPath);
		return newPath;
	}

	async removeProjectText(filename) {
		const directory = this.currentProjectDirectory();
		if (!directory || directory.type !== "nw" || !globalThis.nw) {
			throw new Error("Project macro files are available only in an NW.js project.");
		}
		await removeDirectoryFile(directory, String(filename));
	}

	async deleteProjectChart(filename) {
		const directory = this.currentProjectDirectory();
		if (!directory) {
			return false;
		}
		await removeDirectoryFile(directory, String(filename));
		return true;
	}

	async listProjectFiles(fileExtension = ".js") {
		if (!this.projectPath || !globalThis.nw) {
			return [];
		}
		const modules = nwModules();
		const names = await modules.fs.promises.readdir(this.projectPath, { withFileTypes: true });
		return names
			.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(fileExtension.toLowerCase()))
			.map(entry => entry.name)
			.sort((left, right) => left.localeCompare(right));
	}

	async parseFile(file, importOptions = null) {
		if (!file) {
			return null;
		}
		const fileExtension = extension(file.name);
		if (fileExtension === "ssc") {
			const parsed = await this.#parseLevel(file, importOptions);
			return parsed ? { ...parsed, chartPath: "", fromLevel: true } : null;
		}
		const text = await file.text();
		if (fileExtension === "txt" || looksLikeLyrica(text)) {
			return {
				document: { lyrica: text },
				lyricaText: text,
				musicFile: null,
				imageFile: null,
				chartFilename: file.name,
				chartPath: this.localPathFor(file),
				fromLevel: false,
			};
		}
		const document = JSON.parse(text);
		return {
			document,
			musicFile: null,
			imageFile: null,
			chartFilename: file.name,
			chartPath: this.localPathFor(file),
			fromLevel: false,
		};
	}

	// A level archive may hold several charts and several assets, so the user is asked which
	// combination to open; without a dialog manager the first of each is taken.
	async #chooseLevelEntries(chartFiles, musicFiles, imageFiles) {
		const choice = {
			chart: chartFiles[0].name,
			music: musicFiles[0]?.name || "",
			image: imageFiles[0]?.name || "",
		};
		if (!this.dialogs) {
			return choice;
		}
		const asOptions = files => files.map(entry => ({ value: entry.name, label: entry.name }));
		return this.dialogs.form({
			titleKey: "dialog.openLevel",
			values: choice,
			fields: [
				{
					id: "chart",
					type: "select",
					labelKey: "field.chartFile",
					required: true,
					options: asOptions(chartFiles),
				},
				{
					id: "music",
					type: "select",
					labelKey: "field.musicFile",
					options: [{ value: "", label: "-" }, ...asOptions(musicFiles)],
				},
				{
					id: "image",
					type: "select",
					labelKey: "field.imageFile",
					options: [{ value: "", label: "-" }, ...asOptions(imageFiles)],
				},
			],
		});
	}

	async #parseLevel(file, importOptions) {
		await globalThis.sviberDependenciesReady;
		if (!globalThis.JSZip) {
			throw new Error("JSZip is unavailable.");
		}
		const archive = await JSZip.loadAsync(file);
		const files = Object.values(archive.files).filter(entry => !entry.dir && !entry.name.includes("/"));
		const chartFiles = files.filter(entry => extension(entry.name) === "json");
		const musicFiles = files.filter(entry => AUDIO_EXTENSIONS.has(extension(entry.name)));
		const imageFiles = files.filter(entry => IMAGE_EXTENSIONS.has(extension(entry.name)));
		if (!chartFiles.length) {
			throw new Error("The level file does not contain a JSON chart.");
		}
		const choice = await this.#chooseLevelEntries(chartFiles, musicFiles, imageFiles);
		if (!choice) {
			return null;
		}
		const chartEntry = archive.file(choice.chart);
		if (!chartEntry) {
			throw new Error("The selected chart was not found in the level file.");
		}
		const document = JSON.parse(await chartEntry.async("text"));
		const makeFile = async (name, type) => {
			if (!name) {
				return null;
			}
			const entry = archive.file(name);
			if (!entry) {
				return null;
			}
			return new File([await entry.async("blob")], name.split("/").pop(), { type });
		};
		return {
			document,
			musicFile: await makeFile(choice.music, `audio/${extension(choice.music)}`),
			imageFile: await makeFile(choice.image, `image/${extension(choice.image)}`),
			chartFilename: choice.chart.split("/").pop(),
			importOptions,
		};
	}

	// Writing a chart that belongs to an open project: assets are copied in beside it and the
	// chart keeps project-relative references.
	async #saveProjectChart(model, projectFilename) {
		const modules = nwModules();
		for (const [field, fallback] of [
			["music", "music"],
			["image", "cover"],
		]) {
			const reference = String(model[field] || "");
			if (!reference) {
				continue;
			}
			const file = await this.fileForAsset(reference, field);
			if (!file) {
				throw new Error(`Unable to read project ${field}: ${reference}.`);
			}
			model[field] = await this.copyAssetIntoProject(file, fallback, reference);
		}
		const blob = new Blob([model.serialize(2)], { type: "application/json" });
		const pathname = modules.path.resolve(this.projectPath, sanitizeFilename(projectFilename));
		if (modules.path.dirname(pathname) !== modules.path.resolve(this.projectPath)) {
			throw new Error("Invalid project chart filename.");
		}
		await writeLocalFile(modules.fs, pathname, blob);
		this.chartPath = pathname;
		this.chartFilename = modules.path.basename(pathname);
		return pathname;
	}

	// Writing a chart on its own: asset references are absolutized so the chart still finds
	// them from wherever it ends up.
	async #saveStandaloneChart(model, options, filename) {
		const modules = nwModules();
		const standalone = model.clone();
		if (modules) {
			standalone.music = this.resolveAssetPath(model.music) || String(model.music || "");
			standalone.image = this.resolveAssetPath(model.image) || String(model.image || "");
		}
		const blob = new Blob([standalone.serialize(2)], { type: "application/json" });
		if (!options.saveAs && modules && this.chartPath) {
			await writeLocalFile(modules.fs, this.chartPath, blob);
			model.music = standalone.music;
			model.image = standalone.image;
			return this.chartPath;
		}
		if (!options.saveAs && this.fileHandle) {
			await writeHandle(this.fileHandle, blob);
			return this.fileHandle.name;
		}
		if (modules) {
			const pathname = await pickNwSavePath(filename, ".json,application/json");
			if (!pathname) {
				return null;
			}
			await writeLocalFile(modules.fs, pathname, blob);
			this.fileHandle = null;
			this.chartPath = modules.path.resolve(pathname);
			this.chartFilename = modules.path.basename(pathname);
			if (!this.projectPath) {
				model.music = standalone.music;
				model.image = standalone.image;
			}
			return this.chartPath;
		}
		if (globalThis.showSaveFilePicker) {
			try {
				this.fileHandle = await showSaveFilePicker({
					suggestedName: filename,
					types: [{ description: "sviber chart", accept: { "application/json": [".json"] } }],
				});
				await writeHandle(this.fileHandle, blob);
				return this.fileHandle.name;
			} catch (error) {
				if (error.name === "AbortError") {
					return null;
				}
				throw error;
			}
		}
		download(blob, filename);
		return filename;
	}

	async saveChart(model, options = {}) {
		const title = sanitizeFilename(model.metadata.title);
		const difficulty = sanitizeFilename(model.metadata.difficultyName);
		const filename = `${title}-${difficulty}.json`;
		const modules = nwModules();
		if (!options.saveAs && modules && this.projectPath && options.projectFilename) {
			return this.#saveProjectChart(model, options.projectFilename);
		}
		return this.#saveStandaloneChart(model, options, filename);
	}

	createLevelArchive(project, options = {}) {
		return createLevelArchive(this, project, options);
	}

	async saveLevel(project) {
		const blob = await this.createLevelArchive(project);
		const filename = `${sanitizeFileStem(project.name || project.charts[0].model.metadata.title, "level")}.ssc`;
		const modules = nwModules();
		if (modules) {
			const pathname = await pickNwSavePath(filename, ".ssc,application/zip");
			if (!pathname) {
				return null;
			}
			await writeLocalFile(modules.fs, pathname, blob);
			return pathname;
		}
		if (globalThis.showSaveFilePicker) {
			try {
				const handle = await showSaveFilePicker({
					suggestedName: filename,
					types: [{ description: "Sunniesnow level", accept: { "application/zip": [".ssc"] } }],
				});
				await writeHandle(handle, blob);
				return filename;
			} catch (error) {
				if (error.name === "AbortError") {
					return null;
				}
				throw error;
			}
		}
		download(blob, filename);
		return filename;
	}

	async saveText(text, options = {}) {
		const filename = String(options.filename || "chart.txt");
		const blob = new Blob([String(text ?? "")], { type: options.type || "text/plain" });
		const accept = options.accept || ".txt,text/plain";
		const modules = nwModules();
		if (modules) {
			const pathname = await pickNwSavePath(filename, accept);
			if (!pathname) {
				return null;
			}
			await writeLocalFile(modules.fs, pathname, blob);
			return pathname;
		}
		if (globalThis.showSaveFilePicker) {
			try {
				const handle = await showSaveFilePicker({
					suggestedName: filename,
					types: [{ description: options.description || "Text", accept: { "text/plain": [".txt"] } }],
				});
				await writeHandle(handle, blob);
				return filename;
			} catch (error) {
				if (error.name === "AbortError") {
					return null;
				}
				throw error;
			}
		}
		download(blob, filename);
		return filename;
	}

	async importClipboard(importOptions = {}) {
		if (!navigator.clipboard?.readText) {
			throw new Error("Clipboard access is unavailable.");
		}
		const text = await navigator.clipboard.readText();
		return ChartModel.import(text, importOptions);
	}

	async exportClipboard(model) {
		const text = model.serialize(2);
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return;
		}
		const textarea = document.createElement("textarea");
		textarea.value = text;
		textarea.className = "visually-hidden";
		document.body.append(textarea);
		textarea.select();
		document.execCommand("copy");
		textarea.remove();
	}
}
