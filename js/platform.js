import { ChartModel } from "./core/chart-model.js";
import {
	PROJECT_FILENAME,
	createProjectManifest,
	exportSunniesnowChartDocument,
	normalizeProjectManifest,
	projectManagedFiles,
	sanitizeFileStem,
} from "./core/project.js";

const AUTOSAVE_INDEX_KEY = "sviber.autosaves";
const MANUAL_SAVE_KEY = "sviber.manualSaveTime";
const AUTOSAVE_PREFIX = "sviber.autosave.";

const MIME_TYPES = Object.freeze({
	mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", flac: "audio/flac",
	m4a: "audio/mp4", aac: "audio/aac", opus: "audio/ogg", webm: "audio/webm",
	wma: "audio/x-ms-wma", aiff: "audio/aiff", aif: "audio/aiff", caf: "audio/x-caf",
	qoa: "audio/qoa", amr: "audio/amr",
	png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
	gif: "image/gif", avif: "image/avif", bmp: "image/bmp", svg: "image/svg+xml",
});

const AUDIO_EXTENSIONS = new Set(["mp3", "ogg", "wav", "flac", "m4a", "aac", "opus", "webm", "wma", "aiff", "aif", "caf", "qoa", "amr"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg"]);

function extension(name) {
	return String(name).split(".").pop()?.toLowerCase() || "";
}

function sanitizeFilename(name, fallback = "chart") {
	const result = String(name || fallback).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
	return result || fallback;
}

function download(blob, filename) {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.hidden = true;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function writeHandle(handle, blob) {
	const writable = await handle.createWritable();
	await writable.write(blob);
	await writable.close();
}

function nwModules() {
	if (!globalThis.nw) return null;
	const candidate = typeof globalThis.nw.require === "function"
		? globalThis.nw.require.bind(globalThis.nw)
		: typeof globalThis.require === "function" ? globalThis.require : null;
	if (!candidate) return null;
	try {
		return { fs: candidate("fs"), path: candidate("path") };
	} catch {
		return null;
	}
}

async function writeLocalFile(filesystem, pathname, blob) {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	await filesystem.promises.writeFile(pathname, bytes);
}

function pickNwSavePath(suggestedName, accept) {
	if (!globalThis.document?.body) return Promise.resolve(null);
	return new Promise(resolve => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = accept;
		input.className = "visually-hidden";
		input.setAttribute("nwsaveas", suggestedName);
		let settled = false;
		const selectedPath = () => input.files?.[0]?.path || input.value || "";
		const finish = value => {
			if (settled) return;
			settled = true;
			window.removeEventListener("focus", onFocus);
			input.remove();
			resolve(value && !String(value).includes("fakepath") ? String(value) : null);
		};
		const onFocus = () => setTimeout(() => finish(selectedPath()), 250);
		input.addEventListener("change", () => finish(selectedPath()), { once: true });
		input.addEventListener("cancel", () => finish(null), { once: true });
		window.addEventListener("focus", onFocus, { once: true });
		document.body.append(input);
		input.click();
	});
}

function pickNwDirectoryPath() {
	if (!globalThis.document?.body) return Promise.resolve(null);
	return new Promise(resolve => {
		const input = document.createElement("input");
		input.type = "file";
		input.className = "visually-hidden";
		input.setAttribute("nwdirectory", "");
		let settled = false;
		const selectedPath = () => input.files?.[0]?.path || input.value || "";
		const finish = value => {
			if (settled) return;
			settled = true;
			window.removeEventListener("focus", onFocus);
			input.remove();
			resolve(value && !String(value).includes("fakepath") ? String(value) : null);
		};
		const onFocus = () => setTimeout(() => finish(selectedPath()), 250);
		input.addEventListener("change", () => finish(selectedPath()), { once: true });
		input.addEventListener("cancel", () => finish(null), { once: true });
		window.addEventListener("focus", onFocus, { once: true });
		document.body.append(input);
		input.click();
	});
}

function fileFromBytes(bytes, name, type, pathname = "") {
	const file = typeof File === "function"
		? new File([bytes], name, { type })
		: Object.assign(new Blob([bytes], { type }), { name });
	if (pathname) {
		try {
			Object.defineProperty(file, "sviberPath", { value: pathname, configurable: true });
		} catch {
			file.sviberPath = pathname;
		}
	}
	return file;
}

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
		this.clearChartTarget();
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

	assetReference(file) {
		return this.localPathFor(file) || String(file?.name || "");
	}

	rememberAsset(reference, file, kind) {
		const key = String(reference || this.assetReference(file));
		if (!key || !file) return "";
		this.assetFiles.set(key, file);
		const localPath = this.localPathFor(file);
		if (localPath) this.assetFiles.set(localPath, file);
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
		if (!modules || !reference) return "";
		const value = String(reference);
		if (modules.path.isAbsolute(value)) return modules.path.normalize(value);
		if (this.projectPath) return modules.path.resolve(this.projectPath, value);
		if (this.chartPath) return modules.path.resolve(modules.path.dirname(this.chartPath), value);
		return modules.path.resolve(value);
	}

	async fileForAsset(reference, kind) {
		const key = String(reference || "");
		if (!key) return null;
		if (this.assetFiles.has(key)) return this.assetFiles.get(key);
		const modules = nwModules();
		const pathname = this.resolveAssetPath(key);
		if (!modules || !pathname) return null;
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
		if (!modules || !pathname) return null;
		const resolved = modules.path.resolve(String(pathname));
		const stat = await modules.fs.promises.stat(resolved);
		if (!stat.isFile()) return null;
		const bytes = await modules.fs.promises.readFile(resolved);
		return fileFromBytes(bytes, modules.path.basename(resolved), type, resolved);
	}

	async chooseProjectDirectory() {
		const modules = nwModules();
		if (modules) {
			const pathname = await pickNwDirectoryPath();
			return pathname ? { type: "nw", path: modules.path.resolve(pathname) } : null;
		}
		if (globalThis.showDirectoryPicker) {
			try {
				const handle = await globalThis.showDirectoryPicker({ mode: "readwrite" });
				return handle ? { type: "browser", handle } : null;
			} catch (error) {
				if (error.name === "AbortError") return null;
				throw error;
			}
		}
		throw new Error("Project folders are unavailable in this browser.");
	}

	#currentProjectDirectory() {
		if (this.projectPath) return { type: "nw", path: this.projectPath };
		if (this.projectDirectoryHandle) return { type: "browser", handle: this.projectDirectoryHandle };
		return null;
	}

	async copyAssetIntoProject(file, fallback) {
		const directory = this.#currentProjectDirectory();
		if (!directory || !file) return "";
		const filename = sanitizeFilename(file.name, fallback);
		await this.#writeDirectoryFile(directory, filename, file);
		return filename;
	}

	#directoryFromOptions(options = {}) {
		const modules = nwModules();
		if (options.directoryPath) {
			if (!modules) throw new Error("Local project paths require the desktop app.");
			return { type: "nw", path: modules.path.resolve(String(options.directoryPath)) };
		}
		if (options.directoryHandle) return { type: "browser", handle: options.directoryHandle };
		return null;
	}

	async #readDirectoryFile(directory, filename, type = "application/octet-stream") {
		if (directory.type === "nw") {
			const modules = nwModules();
			const pathname = modules.path.resolve(directory.path, filename);
			if (modules.path.dirname(pathname) !== modules.path.resolve(directory.path)) throw new Error("Invalid project filename.");
			const bytes = await modules.fs.promises.readFile(pathname);
			return fileFromBytes(bytes, modules.path.basename(pathname), type, pathname);
		}
		const handle = await directory.handle.getFileHandle(filename);
		return handle.getFile();
	}

	async #writeDirectoryFile(directory, filename, value) {
		const blob = value instanceof Blob ? value : new Blob([value]);
		if (directory.type === "nw") {
			const modules = nwModules();
			await modules.fs.promises.mkdir(directory.path, { recursive: true });
			const pathname = modules.path.resolve(directory.path, filename);
			if (modules.path.dirname(pathname) !== modules.path.resolve(directory.path)) throw new Error("Invalid project filename.");
			const sourcePath = this.localPathFor(value);
			if (sourcePath && modules.path.resolve(sourcePath) === pathname) return pathname;
			await writeLocalFile(modules.fs, pathname, blob);
			return pathname;
		}
		const handle = await directory.handle.getFileHandle(filename, { create: true });
		await writeHandle(handle, blob);
		return filename;
	}

	async #readExistingProjectManifest(directory) {
		try {
			const file = await this.#readDirectoryFile(directory, PROJECT_FILENAME, "application/json");
			return normalizeProjectManifest(JSON.parse(await file.text()));
		} catch (error) {
			if (error?.code === "ENOENT" || error?.name === "NotFoundError") return null;
			// A damaged or unrelated manifest must never authorize deleting files.
			if (error instanceof SyntaxError || error instanceof TypeError) return null;
			throw error;
		}
	}

	async #removeDirectoryFile(directory, filename) {
		if (directory.type === "nw") {
			const modules = nwModules();
			const pathname = modules.path.resolve(directory.path, filename);
			if (modules.path.dirname(pathname) !== modules.path.resolve(directory.path)) throw new Error("Invalid project filename.");
			await modules.fs.promises.rm(pathname, { force: true });
			return;
		}
		try {
			await directory.handle.removeEntry(filename);
		} catch (error) {
			if (error?.name !== "NotFoundError") throw error;
		}
	}

	#adoptProjectDirectory(directory, manifest) {
		this.projectDirectoryHandle = directory.type === "browser" ? directory.handle : null;
		this.projectPath = directory.type === "nw" ? directory.path : "";
		this.projectName = manifest.name;
		this.clearChartTarget();
	}

	async openProject(options = {}) {
		const directory = this.#directoryFromOptions(options) || await this.chooseProjectDirectory();
		if (!directory) return null;
		const manifestFile = await this.#readDirectoryFile(directory, PROJECT_FILENAME, "application/json");
		const manifest = normalizeProjectManifest(JSON.parse(await manifestFile.text()));
		const charts = [];
		for (const entry of manifest.charts) {
			const file = await this.#readDirectoryFile(directory, entry.file, "application/json");
			charts.push({ ...entry, document: JSON.parse(await file.text()) });
		}
		const musicFile = manifest.music
			? await this.#readDirectoryFile(directory, manifest.music, MIME_TYPES[extension(manifest.music)] || "audio/*")
			: null;
		const imageFile = manifest.image
			? await this.#readDirectoryFile(directory, manifest.image, MIME_TYPES[extension(manifest.image)] || "image/*")
			: null;
		this.#adoptProjectDirectory(directory, manifest);
		return { manifest, charts, musicFile, imageFile };
	}

	#projectAssetName(file, reference, fallback) {
		if (file?.name) return sanitizeFilename(file.name, fallback);
		const value = String(reference || "");
		if (value && !value.includes("/") && !value.includes("\\")) return sanitizeFilename(value, fallback);
		return "";
	}

	async saveProject(project, options = {}) {
		let directory = !options.saveAs && this.#currentProjectDirectory();
		directory ||= this.#directoryFromOptions(options);
		directory ||= await this.chooseProjectDirectory();
		if (!directory) return null;
		if (!Array.isArray(project?.charts) || !project.charts.length) throw new Error("A project must contain at least one difficulty.");
		const previousManifest = await this.#readExistingProjectManifest(directory);
		const music = this.#projectAssetName(this.musicFile, project.music, "music");
		const image = this.#projectAssetName(this.imageFile, project.image, "cover");
		const manifest = createProjectManifest({
			name: project.name,
			music,
			image,
			charts: project.charts,
			activeChart: project.activeChart,
		});
		for (const entry of project.charts) {
			entry.model.music = music;
			entry.model.image = image;
			await this.#writeDirectoryFile(directory, entry.file, new Blob([entry.model.serialize(2)], { type: "application/json" }));
		}
		if (music && this.musicFile) await this.#writeDirectoryFile(directory, music, this.musicFile);
		if (image && this.imageFile) await this.#writeDirectoryFile(directory, image, this.imageFile);
		await this.#writeDirectoryFile(directory, PROJECT_FILENAME,
			new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: "application/json" }));
		if (previousManifest) {
			const currentFiles = new Set(Array.from(projectManagedFiles(manifest), value => value.toLowerCase()));
			for (const filename of projectManagedFiles(previousManifest)) {
				if (!currentFiles.has(filename.toLowerCase())) await this.#removeDirectoryFile(directory, filename);
			}
		}
		this.#adoptProjectDirectory(directory, manifest);
		if (this.musicFile) this.rememberAsset(music, this.musicFile, "music");
		if (this.imageFile) this.rememberAsset(image, this.imageFile, "image");
		return {
			location: directory.type === "nw" ? directory.path : directory.handle.name,
			manifest,
		};
	}

	openProjectFolder() {
		if (!globalThis.nw || !this.projectPath) return false;
		globalThis.nw.Shell.openItem(this.projectPath);
		return true;
	}

	async readProjectText(filename) {
		const directory = this.#currentProjectDirectory();
		if (!directory) return null;
		const file = await this.#readDirectoryFile(directory, String(filename), "text/javascript");
		return file ? await file.text() : null;
	}

	async writeProjectText(filename, text) {
		const directory = this.#currentProjectDirectory();
		if (!directory || !globalThis.nw) throw new Error("Project macro files are available only in an NW.js project.");
		return this.#writeDirectoryFile(directory, String(filename), String(text));
	}

	async renameProjectText(oldFilename, newFilename) {
		const directory = this.#currentProjectDirectory();
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
			if (error?.code !== "ENOENT") throw error;
		}
		await modules.fs.promises.rename(oldPath, newPath);
		return newPath;
	}

	async removeProjectText(filename) {
		const directory = this.#currentProjectDirectory();
		if (!directory || directory.type !== "nw" || !globalThis.nw) {
			throw new Error("Project macro files are available only in an NW.js project.");
		}
		await this.#removeDirectoryFile(directory, String(filename));
	}

	async listProjectFiles(extension = ".js") {
		if (!this.projectPath || !globalThis.nw) return [];
		const modules = nwModules();
		const names = await modules.fs.promises.readdir(this.projectPath, { withFileTypes: true });
		return names.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(extension.toLowerCase()))
			.map(entry => entry.name).sort((left, right) => left.localeCompare(right));
	}

	async parseFile(file, importOptions = null) {
		if (!file) return null;
		const fileExtension = extension(file.name);
		if (fileExtension === "ssc") {
			const parsed = await this.#parseLevel(file, importOptions);
			return parsed ? { ...parsed, chartPath: "", fromLevel: true } : null;
		}
		const document = JSON.parse(await file.text());
		return {
			document,
			musicFile: null,
			imageFile: null,
			chartFilename: file.name,
			chartPath: this.localPathFor(file),
			fromLevel: false,
		};
	}

	async #parseLevel(file, importOptions) {
		await globalThis.sviberDependenciesReady;
		if (!globalThis.JSZip) throw new Error("JSZip is unavailable.");
		const archive = await JSZip.loadAsync(file);
		const files = Object.values(archive.files).filter(entry => !entry.dir && !entry.name.includes("/"));
		const chartFiles = files.filter(entry => extension(entry.name) === "json");
		const musicFiles = files.filter(entry => AUDIO_EXTENSIONS.has(extension(entry.name)));
		const imageFiles = files.filter(entry => IMAGE_EXTENSIONS.has(extension(entry.name)));
		if (!chartFiles.length) throw new Error("The level file does not contain a JSON chart.");
		let choice = {
			chart: chartFiles[0].name,
			music: musicFiles[0]?.name || "",
			image: imageFiles[0]?.name || "",
		};
		if (this.dialogs) {
			const values = await this.dialogs.form({
				titleKey: "dialog.openLevel",
				values: choice,
				fields: [
					{ id: "chart", type: "select", labelKey: "field.chartFile", required: true,
						options: chartFiles.map(entry => ({ value: entry.name, label: entry.name })) },
					{ id: "music", type: "select", labelKey: "field.musicFile",
						options: [{ value: "", label: "-" }, ...musicFiles.map(entry => ({ value: entry.name, label: entry.name }))] },
					{ id: "image", type: "select", labelKey: "field.imageFile",
						options: [{ value: "", label: "-" }, ...imageFiles.map(entry => ({ value: entry.name, label: entry.name }))] },
				],
			});
			if (!values) return null;
			choice = values;
		}
		const chartEntry = archive.file(choice.chart);
		if (!chartEntry) throw new Error("The selected chart was not found in the level file.");
		const document = JSON.parse(await chartEntry.async("text"));
		const makeFile = async (name, type) => {
			if (!name) return null;
			const entry = archive.file(name);
			if (!entry) return null;
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

	async saveChart(model, options = {}) {
		const filename = `${sanitizeFilename(model.metadata.title)}-${sanitizeFilename(model.metadata.difficultyName)}.json`;
		const blob = new Blob([model.serialize(2)], { type: "application/json" });
		const modules = nwModules();
		if (!options.saveAs && modules && this.projectPath && options.projectFilename) {
			const pathname = modules.path.resolve(this.projectPath, sanitizeFilename(options.projectFilename));
			if (modules.path.dirname(pathname) !== modules.path.resolve(this.projectPath)) throw new Error("Invalid project chart filename.");
			await writeLocalFile(modules.fs, pathname, blob);
			this.chartPath = pathname;
			this.chartFilename = modules.path.basename(pathname);
			return pathname;
		}
		if (!options.saveAs && modules && this.chartPath) {
			await writeLocalFile(modules.fs, this.chartPath, blob);
			return this.chartPath;
		}
		if (!options.saveAs && this.fileHandle) {
			await writeHandle(this.fileHandle, blob);
			return this.fileHandle.name;
		}
		if (modules) {
			const pathname = await pickNwSavePath(filename, ".json,application/json");
			if (!pathname) return null;
			await writeLocalFile(modules.fs, pathname, blob);
			this.fileHandle = null;
			this.chartPath = modules.path.resolve(pathname);
			this.chartFilename = modules.path.basename(pathname);
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
				if (error.name === "AbortError") return null;
				throw error;
			}
		}
		download(blob, filename);
		return filename;
	}

	async createLevelArchive(project) {
		await globalThis.sviberDependenciesReady;
		if (!globalThis.JSZip) throw new Error("JSZip is unavailable.");
		if (!Array.isArray(project?.charts) || !project.charts.length) throw new Error("A level must contain at least one difficulty.");
		if (!this.musicFile) throw new Error("A Sunniesnow level must contain a music file.");
		const zip = new JSZip();
		const usedNames = new Set();
		const reserveName = (name, label) => {
			const key = name.toLowerCase();
			if (usedNames.has(key)) throw new Error(`Duplicate Sunniesnow level filename for ${label}: ${name}.`);
			usedNames.add(key);
		};
		for (const entry of project.charts) {
			const filename = String(entry.file || "");
			if (!filename || filename.includes("/") || filename.includes("\\") || !filename.endsWith(".json")) {
				throw new Error(`Invalid Sunniesnow chart filename: ${filename || "(empty)"}.`);
			}
			reserveName(filename, "difficulty chart");
			const chart = exportSunniesnowChartDocument(entry.model);
			zip.file(filename, `${JSON.stringify(chart, null, 2)}\n`);
		}
		const musicName = sanitizeFilename(this.musicFile.name, "music");
		reserveName(musicName, "music");
		zip.file(musicName, new Uint8Array(await this.musicFile.arrayBuffer()));
		if (this.imageFile) {
			const imageName = sanitizeFilename(this.imageFile.name, "cover");
			reserveName(imageName, "cover");
			zip.file(imageName, new Uint8Array(await this.imageFile.arrayBuffer()));
		}
		const blob = await zip.generateAsync({
			type: "blob",
			compression: "DEFLATE",
			compressionOptions: { level: 6 },
			platform: "UNIX",
		});
		return blob;
	}

	async saveLevel(project) {
		const blob = await this.createLevelArchive(project);
		const filename = `${sanitizeFileStem(project.name || project.charts[0].model.metadata.title, "level")}.ssc`;
		const modules = nwModules();
		if (modules) {
			const pathname = await pickNwSavePath(filename, ".ssc,application/zip");
			if (!pathname) return null;
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
				if (error.name === "AbortError") return null;
				throw error;
			}
		}
		download(blob, filename);
		return filename;
	}

	async importClipboard(importOptions = {}) {
		if (!navigator.clipboard?.readText) throw new Error("Clipboard access is unavailable.");
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

export class AutosaveManager {
	constructor(options = {}) {
		this.storage = options.storage || globalThis.localStorage;
		this.interval = options.interval ?? 120_000;
		this.maxEntries = options.maxEntries ?? Infinity;
		this.timer = 0;
	}

	get index() {
		try {
			const parsed = JSON.parse(this.storage.getItem(AUTOSAVE_INDEX_KEY) || "[]");
			return Array.isArray(parsed) ? parsed.filter(value => Number.isFinite(value)) : [];
		} catch {
			return [];
		}
	}

	set index(value) {
		this.storage.setItem(AUTOSAVE_INDEX_KEY, JSON.stringify(value));
	}

	start(callback) {
		this.stop();
		if (!(this.interval > 0)) return;
		this.timer = setInterval(callback, this.interval);
	}

	setInterval(milliseconds) {
		this.interval = Math.max(0, Number(milliseconds) || 0);
	}

	stop() {
		clearInterval(this.timer);
		this.timer = 0;
	}

	save(model) {
		let entries = this.index;
		let timestamp = Date.now();
		while (entries.includes(timestamp)) timestamp += 1;
		const key = `${AUTOSAVE_PREFIX}${timestamp}`;
		const value = model instanceof ChartModel
			? model.serialize(0, { includeGeneratedEvents: false }) : JSON.stringify(model);
		const removeOldest = () => {
			const oldest = entries.shift();
			if (oldest != null) this.storage.removeItem(`${AUTOSAVE_PREFIX}${oldest}`);
			return oldest;
		};
		while (true) {
			try {
				this.storage.setItem(key, value);
				break;
			} catch (error) {
				if (!entries.length) throw error;
				removeOldest();
			}
		}
		entries.push(timestamp);
		while (Number.isFinite(this.maxEntries) && entries.length > this.maxEntries) {
			removeOldest();
		}
		while (true) {
			try {
				this.index = entries;
				break;
			} catch (error) {
				const oldestIndex = entries.findIndex(entry => entry !== timestamp);
				if (oldestIndex < 0) {
					if (entries.includes(timestamp)) this.storage.removeItem(key);
					throw error;
				}
				const [oldest] = entries.splice(oldestIndex, 1);
				this.storage.removeItem(`${AUTOSAVE_PREFIX}${oldest}`);
			}
		}
		return timestamp;
	}

	markManualSave() {
		this.storage.setItem(MANUAL_SAVE_KEY, String(Date.now()));
	}

	latestRecoverable() {
		return this.recoverable().at(0) || null;
	}

	recoverable() {
		const manualSave = Number(this.storage.getItem(MANUAL_SAVE_KEY) || 0);
		const result = [];
		for (const timestamp of this.index.filter(value => value > manualSave).toSorted((left, right) => right - left)) {
			try {
				const value = this.storage.getItem(`${AUTOSAVE_PREFIX}${timestamp}`);
				if (value) result.push({ timestamp, model: ChartModel.import(value) });
			} catch {
				// Keep other valid recovery entries available.
			}
		}
		return result;
	}
}

export { download, sanitizeFilename };
