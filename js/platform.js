import { ChartModel } from "./core/chart-model.js";
import {
	PROJECT_FILENAME,
	createProjectManifest,
	exportSunniesnowChartDocument,
	normalizeProjectManifest,
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

function looksLikeLyrica(text) {
	const first = String(text || "").split(/\r?\n/).find(line => line.trim());
	if (!first || first.includes("{")) return false;
	const fields = first.split("|");
	return fields.length >= 4 && Number.isFinite(Number(fields[0]));
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
		if (!modules) return false;
		this.projectPath = source.projectPath ? modules.path.resolve(String(source.projectPath)) : "";
		this.projectName = String(source.projectName || "");
		this.chartPath = source.chartPath ? modules.path.resolve(String(source.chartPath)) : "";
		this.chartFilename = String(source.chartFilename
			|| (this.chartPath ? modules.path.basename(this.chartPath) : ""));
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
	projectChartFilename(pathname) {
		const modules = nwModules();
		if (!modules || !this.projectPath || !pathname) return "";
		const root = modules.path.resolve(this.projectPath);
		const resolved = modules.path.resolve(String(pathname));
		return modules.path.dirname(resolved).toLowerCase() === root.toLowerCase() && resolved.toLowerCase().endsWith(".json")
			&& resolved.toLowerCase() !== modules.path.resolve(root, PROJECT_FILENAME).toLowerCase()
			? modules.path.basename(resolved) : "";
	}
	async containingProjectPath(pathname) {
		const modules = nwModules();
		if (!modules || !pathname) return "";
		const resolved = modules.path.resolve(String(pathname));
		const directory = modules.path.dirname(resolved);
		const filename = modules.path.basename(resolved).toLowerCase();
		try {
			const text = await modules.fs.promises.readFile(modules.path.join(directory, PROJECT_FILENAME), "utf8");
			const manifest = normalizeProjectManifest(JSON.parse(text));
			return manifest.charts.some(entry => entry.file.toLowerCase() === filename) ? directory : "";
		} catch { return ""; }
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

	resolveChartAssetReference(reference, chartPath) {
		const modules = nwModules();
		const value = String(reference || "");
		if (!modules || !value) return value;
		if (modules.path.isAbsolute(value)) return modules.path.normalize(value);
		return chartPath ? modules.path.resolve(modules.path.dirname(chartPath), value) : modules.path.resolve(value);
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
		throw new Error("Project folders are available only in the desktop app.");
	}

	#currentProjectDirectory() {
		if (this.projectPath) return { type: "nw", path: this.projectPath };
		if (this.projectDirectoryHandle) return { type: "browser", handle: this.projectDirectoryHandle };
		return null;
	}

	async copyAssetIntoProject(file, fallback, existingReference = "") {
		const directory = this.#currentProjectDirectory();
		if (!directory || !file) return "";
		const existingName = String(existingReference || "");
		if (existingName && sanitizeFilename(existingName, fallback) === existingName
			&& await this.#directoryFileExists(directory, existingName)) return existingName;
		const preferred = sanitizeFilename(file.name, fallback);
		const sourcePath = this.localPathFor(file);
		let filename = preferred;
		let suffix = 2;
		while (await this.#directoryFileExists(directory, filename)) {
			if (directory.type === "nw" && sourcePath) {
				const modules = nwModules();
				if (modules.path.resolve(sourcePath).toLowerCase()
					=== modules.path.resolve(directory.path, filename).toLowerCase()) break;
			}
			const dot = preferred.lastIndexOf(".");
			const stem = dot > 0 ? preferred.slice(0, dot) : preferred;
			const extensionPart = dot > 0 ? preferred.slice(dot) : "";
			filename = `${stem}-${suffix++}${extensionPart}`;
		}
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

	async #directoryFileExists(directory, filename) {
		if (directory.type === "nw") {
			const modules = nwModules();
			try {
				await modules.fs.promises.access(modules.path.resolve(directory.path, filename));
				return true;
			} catch { return false; }
		}
		try {
			await directory.handle.getFileHandle(filename);
			return true;
		} catch (error) {
			if (error?.name === "NotFoundError") return false;
			throw error;
		}
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

	#adoptProjectDirectory(directory, projectName = "") {
		this.projectDirectoryHandle = directory.type === "browser" ? directory.handle : null;
		this.projectPath = directory.type === "nw" ? directory.path : "";
		const modules = nwModules();
		this.projectName = String(projectName || (directory.type === "nw"
			? modules?.path.basename(directory.path) : directory.handle?.name) || "Untitled");
		this.clearChartTarget();
	}

	async openProject(options = {}) {
		if (!nwModules()) throw new Error("Project folders are available only in the desktop app.");
		const directory = this.#directoryFromOptions(options) || await this.chooseProjectDirectory();
		if (!directory) return null;
		const manifestFile = await this.#readDirectoryFile(directory, PROJECT_FILENAME, "application/json");
		const manifest = normalizeProjectManifest(JSON.parse(await manifestFile.text()));
		const charts = [];
		for (const entry of manifest.charts) {
			const file = await this.#readDirectoryFile(directory, entry.file, "application/json");
			charts.push({ ...entry, document: JSON.parse(await file.text()) });
		}
		this.assetFiles.clear();
		this.clearCurrentAssets();
		this.#adoptProjectDirectory(directory, options.projectName);
		return { manifest, charts, projectName: this.projectName };
	}

	#uniqueProjectFilename(preferred, usedNames) {
		const sanitized = sanitizeFilename(preferred, "asset");
		const dot = sanitized.lastIndexOf(".");
		const stem = dot > 0 ? sanitized.slice(0, dot) : sanitized;
		const extensionPart = dot > 0 ? sanitized.slice(dot) : "";
		let filename = sanitized;
		let suffix = 2;
		while (usedNames.has(filename.toLowerCase())) filename = `${stem}-${suffix++}${extensionPart}`;
		usedNames.add(filename.toLowerCase());
		return filename;
	}

	async #directoryFilenames(directory) {
		if (directory.type !== "nw") return [];
		const modules = nwModules();
		try { return await modules.fs.promises.readdir(directory.path); }
		catch (error) {
			if (error?.code === "ENOENT") return [];
			throw error;
		}
	}

	#isSameDirectoryFile(directory, filename, file) {
		const modules = nwModules();
		const sourcePath = this.localPathFor(file);
		if (!modules || directory.type !== "nw" || !sourcePath) return false;
		return modules.path.resolve(sourcePath).toLowerCase()
			=== modules.path.resolve(directory.path, filename).toLowerCase();
	}

	async #assertNewProjectDestination(directory) {
		if (await this.#directoryFileExists(directory, PROJECT_FILENAME)) {
			throw new Error(`The selected directory already contains ${PROJECT_FILENAME}.`);
		}
	}

	async saveProject(project, options = {}) {
		if (!nwModules()) throw new Error("Project folders are available only in the desktop app.");
		let directory = !options.saveAs && this.#currentProjectDirectory();
		const existingDirectory = Boolean(directory);
		directory ||= this.#directoryFromOptions(options);
		directory ||= await this.chooseProjectDirectory();
		if (!directory) return null;
		if (!existingDirectory) await this.#assertNewProjectDestination(directory);
		if (!Array.isArray(project?.charts) || !project.charts.length) throw new Error("A project must contain at least one difficulty.");
		const existingNames = new Set((await this.#directoryFilenames(directory)).map(name => name.toLowerCase()));
		const usedNames = new Set([...existingNames, PROJECT_FILENAME.toLowerCase()]);
		if (!existingDirectory) {
			for (const entry of project.charts) entry.file = this.#uniqueProjectFilename(entry.file, usedNames);
		} else {
			for (const entry of project.charts) usedNames.add(String(entry.file).toLowerCase());
		}
		const chartNames = new Set([PROJECT_FILENAME.toLowerCase(), ...project.charts.map(entry => String(entry.file).toLowerCase())]);
		const assetNames = new Set();
		const savedAssets = new Map();
		for (const entry of project.charts) {
			for (const [field, fallback] of [["music", "music"], ["image", "cover"]]) {
				const reference = String(entry.model[field] || "");
				if (!reference) continue;
				const resolved = this.resolveAssetPath(reference) || reference;
				let asset = savedAssets.get(resolved.toLowerCase());
				if (!asset) {
					const file = await this.fileForAsset(reference, field);
					if (!file) throw new Error(`Unable to read project ${field}: ${reference}.`);
					const preferred = sanitizeFilename(file.name || reference, fallback);
					const key = preferred.toLowerCase();
					const projectReference = existingDirectory && sanitizeFilename(reference, fallback) === reference
						&& reference.toLowerCase() === key && existingNames.has(key);
					const reuse = (projectReference || this.#isSameDirectoryFile(directory, preferred, file))
						&& !chartNames.has(key) && !assetNames.has(key);
					const filename = reuse ? preferred : this.#uniqueProjectFilename(preferred, usedNames);
					usedNames.add(filename.toLowerCase());
					assetNames.add(filename.toLowerCase());
					await this.#writeDirectoryFile(directory, filename, file);
					asset = { filename, file };
					savedAssets.set(resolved.toLowerCase(), asset);
				}
				entry.model[field] = asset.filename;
			}
		}
		const manifest = createProjectManifest({
			charts: project.charts,
			activeChart: project.activeChart,
		});
		for (const entry of project.charts) {
			await this.#writeDirectoryFile(directory, entry.file, new Blob([entry.model.serialize(2)], { type: "application/json" }));
		}
		await this.#writeDirectoryFile(directory, PROJECT_FILENAME,
			new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: "application/json" }));
		this.#adoptProjectDirectory(directory, project.name);
		this.assetFiles.clear();
		for (const asset of savedAssets.values()) this.assetFiles.set(asset.filename, asset.file);
		this.musicReference = String(project.charts.find(entry => entry.id === project.activeChart)?.model.music || "");
		this.imageReference = String(project.charts.find(entry => entry.id === project.activeChart)?.model.image || "");
		this.musicFile = this.assetFiles.get(this.musicReference) || null;
		this.imageFile = this.assetFiles.get(this.imageReference) || null;
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

	async deleteProjectChart(filename) {
		const directory = this.#currentProjectDirectory();
		if (!directory) return false;
		await this.#removeDirectoryFile(directory, String(filename));
		return true;
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
		const modules = nwModules();
		if (!options.saveAs && modules && this.projectPath && options.projectFilename) {
			for (const [field, fallback] of [["music", "music"], ["image", "cover"]]) {
				const reference = String(model[field] || "");
				if (!reference) continue;
				const file = await this.fileForAsset(reference, field);
				if (!file) throw new Error(`Unable to read project ${field}: ${reference}.`);
				model[field] = await this.copyAssetIntoProject(file, fallback, reference);
			}
			const blob = new Blob([model.serialize(2)], { type: "application/json" });
			const pathname = modules.path.resolve(this.projectPath, sanitizeFilename(options.projectFilename));
			if (modules.path.dirname(pathname) !== modules.path.resolve(this.projectPath)) throw new Error("Invalid project chart filename.");
			await writeLocalFile(modules.fs, pathname, blob);
			this.chartPath = pathname;
			this.chartFilename = modules.path.basename(pathname);
			return pathname;
		}
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
			if (!pathname) return null;
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
				if (error.name === "AbortError") return null;
				throw error;
			}
		}
		download(blob, filename);
		return filename;
	}

	async createLevelArchive(project, options = {}) {
		await globalThis.sviberDependenciesReady;
		if (!globalThis.JSZip) throw new Error("JSZip is unavailable.");
		if (!Array.isArray(project?.charts) || !project.charts.length) throw new Error("A level must contain at least one difficulty.");
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
			const chart = exportSunniesnowChartDocument(entry.model, options);
			zip.file(filename, `${JSON.stringify(chart, null, 2)}\n`);
		}
		const packagedAssets = new Map();
		for (const entry of project.charts) {
			for (const [field, fallback] of [["music", "music"], ["image", "cover"]]) {
				const reference = String(entry.model[field] || "");
				if (!reference) continue;
				const resolved = this.resolveAssetPath(reference) || reference;
				if (packagedAssets.has(resolved.toLowerCase())) continue;
				const file = await this.fileForAsset(reference, field);
				if (!file) throw new Error(`Unable to read referenced ${field}: ${reference}.`);
				let assetName = sanitizeFilename(file.name || reference, fallback);
				if (usedNames.has(assetName.toLowerCase())) {
					const dot = assetName.lastIndexOf(".");
					const stem = dot > 0 ? assetName.slice(0, dot) : assetName;
					const extensionPart = dot > 0 ? assetName.slice(dot) : "";
					let suffix = 2;
					while (usedNames.has(assetName.toLowerCase())) assetName = `${stem}-${suffix++}${extensionPart}`;
				}
				reserveName(assetName, field);
				zip.file(assetName, new Uint8Array(await file.arrayBuffer()));
				packagedAssets.set(resolved.toLowerCase(), assetName);
			}
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

	async saveText(text, options = {}) {
		const filename = String(options.filename || "chart.txt");
		const blob = new Blob([String(text ?? "")], { type: options.type || "text/plain" });
		const accept = options.accept || ".txt,text/plain";
		const modules = nwModules();
		if (modules) {
			const pathname = await pickNwSavePath(filename, accept);
			if (!pathname) return null;
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

	save(model, source = {}) {
		let entries = this.index;
		let timestamp = Date.now();
		while (entries.includes(timestamp)) timestamp += 1;
		const key = `${AUTOSAVE_PREFIX}${timestamp}`;
		const document = model instanceof ChartModel
			? JSON.parse(model.serialize(0, { includeGeneratedEvents: false })) : model;
		const value = JSON.stringify({ version: 1, document, source: { ...source } });
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

	listed() {
		return this.#readEntries(this.index.toSorted((left, right) => right - left));
	}

	recoverable() {
		const manualSave = Number(this.storage.getItem(MANUAL_SAVE_KEY) || 0);
		return this.#readEntries(this.index.filter(value => value > manualSave).toSorted((left, right) => right - left));
	}

	#readEntries(timestamps) {
		const result = [];
		for (const timestamp of timestamps) {
			try {
				const value = this.storage.getItem(`${AUTOSAVE_PREFIX}${timestamp}`);
				const recovery = value && JSON.parse(value);
				if (recovery?.version === 1 && recovery.document) result.push({
					timestamp,
					model: ChartModel.import(recovery.document),
					source: recovery.source && typeof recovery.source === "object" ? recovery.source : {},
				});
			} catch {
				// Keep other valid recovery entries available.
			}
		}
		return result;
	}
}

export { download, sanitizeFilename };
