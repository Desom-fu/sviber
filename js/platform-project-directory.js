// Reading and writing the files of a project folder.
//
// A project folder is addressed either as an NW.js filesystem path (`{ type: "nw", path }`) or
// as a File System Access directory handle (`{ type: "browser", handle }`). Every function
// here takes such a descriptor and hides the difference, and every one that resolves a name
// against an NW.js path checks that the result stays directly inside the folder, so a
// manifest entry can never write outside the project.
//
// Split out of js/platform.js.

import { fileFromBytes, nwModules, writeHandle, writeLocalFile } from "./platform-host.js";
import { nextAvailableFilename, sanitizeFilename } from "./platform-file-kinds.js";

// Resolves `filename` inside an NW.js project folder, refusing anything that escapes it.
function resolveInside(directory, filename) {
	const modules = nwModules();
	const pathname = modules.path.resolve(directory.path, filename);
	if (modules.path.dirname(pathname) !== modules.path.resolve(directory.path)) {
		throw new Error("Invalid project filename.");
	}
	return { modules, pathname };
}

export function projectDirectoryFromOptions(options = {}) {
	const modules = nwModules();
	if (options.directoryPath) {
		if (!modules) {
			throw new Error("Local project paths require the desktop app.");
		}
		return { type: "nw", path: modules.path.resolve(String(options.directoryPath)) };
	}
	if (options.directoryHandle) {
		return { type: "browser", handle: options.directoryHandle };
	}
	return null;
}

export async function readDirectoryFile(directory, filename, type = "application/octet-stream") {
	if (directory.type === "nw") {
		const { modules, pathname } = resolveInside(directory, filename);
		const bytes = await modules.fs.promises.readFile(pathname);
		return fileFromBytes(bytes, modules.path.basename(pathname), type, pathname);
	}
	const handle = await directory.handle.getFileHandle(filename);
	return handle.getFile();
}

export async function directoryFileExists(directory, filename) {
	if (directory.type === "nw") {
		const modules = nwModules();
		try {
			await modules.fs.promises.access(modules.path.resolve(directory.path, filename));
			return true;
		} catch {
			return false;
		}
	}
	try {
		await directory.handle.getFileHandle(filename);
		return true;
	} catch (error) {
		if (error?.name === "NotFoundError") {
			return false;
		}
		throw error;
	}
}

// `sourcePath` is where `value` was read from, if anywhere: writing a file onto itself is a
// no-op rather than a truncate-then-copy.
export async function writeDirectoryFile(directory, filename, value, sourcePath = "") {
	const blob = value instanceof Blob ? value : new Blob([value]);
	if (directory.type === "nw") {
		const modules = nwModules();
		await modules.fs.promises.mkdir(directory.path, { recursive: true });
		const { pathname } = resolveInside(directory, filename);
		if (sourcePath && modules.path.resolve(sourcePath) === pathname) {
			return pathname;
		}
		await writeLocalFile(modules.fs, pathname, blob);
		return pathname;
	}
	const handle = await directory.handle.getFileHandle(filename, { create: true });
	await writeHandle(handle, blob);
	return filename;
}

export async function removeDirectoryFile(directory, filename) {
	if (directory.type === "nw") {
		const { modules, pathname } = resolveInside(directory, filename);
		await modules.fs.promises.rm(pathname, { force: true });
		return;
	}
	try {
		await directory.handle.removeEntry(filename);
	} catch (error) {
		if (error?.name !== "NotFoundError") {
			throw error;
		}
	}
}

// Only NW.js folders can be listed; a browser directory handle is treated as opaque.
export async function directoryFilenames(directory) {
	if (directory.type !== "nw") {
		return [];
	}
	const modules = nwModules();
	try {
		return await modules.fs.promises.readdir(directory.path);
	} catch (error) {
		if (error?.code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

// Whether `sourcePath` is the very file that `filename` names inside this folder.
export function isSameDirectoryFile(directory, filename, sourcePath) {
	const modules = nwModules();
	if (!modules || directory.type !== "nw" || !sourcePath) {
		return false;
	}
	return (
		modules.path.resolve(sourcePath).toLowerCase() === modules.path.resolve(directory.path, filename).toLowerCase()
	);
}

// Claims a filename within a project, sanitizing it and de-duplicating against `usedNames`
// (which is compared case-insensitively because project folders may live on such filesystems).
export function uniqueProjectFilename(preferred, usedNames) {
	const sanitized = sanitizeFilename(preferred, "asset");
	const filename = nextAvailableFilename(sanitized, candidate => usedNames.has(candidate.toLowerCase()));
	usedNames.add(filename.toLowerCase());
	return filename;
}
