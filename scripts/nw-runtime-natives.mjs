// Packaging rules for native modules and FFmpeg (PROMPT-v26).
// Runtime-free `.nw` omits native binaries and FFmpeg. Runtime natives rebuild against
// the NW.js Node ABI; development natives stay on the host Node.

import { existsSync } from "node:fs";
import path from "node:path";

export const RUNTIME_NATIVE_PACKAGES = Object.freeze(["gl", "canvas"]);
// These run in the bundled host Node worker, not inside NW.js. Do not rebuild against
// the NW.js ABI or the packaged render worker cannot load gl.
export const ABI_REBUILD_PACKAGES = Object.freeze([]);
export const NATIVE_BINARY_PATTERN = /\.node$/i;
export const FFMPEG_NAME_PATTERN = /(?:^|[/\\])ffmpeg(?:\.exe)?$/i;
// BtbN's Windows zip (and some macOS zips) ship a shared ffmpeg next to DLLs/dylibs.
// The exe does not start without those libraries; Node reports that as spawn ENOENT.
export const FFMPEG_LIBRARY_PATTERN = /\.(?:dll|dylib|so(?:\.\d+)*)$/i;

export function isBundledFfmpegLibrary(pathname) {
	const value = String(pathname || "").replace(/\\/g, "/");
	return /^(?:\.\/)?bin\/[^/]+$/.test(value) && FFMPEG_LIBRARY_PATTERN.test(value);
}
// Official NW.js header tarball host. npmmirror's nwjs tree 404s node-v*.tar.gz for 0.114.2.
export const NWJS_HEADERS_DISTURL = "https://dl.nwjs.io";

export function nwjsHeadersTarball(nwVersion) {
	const version = String(nwVersion || "").replace(/^v/i, "");
	return `${NWJS_HEADERS_DISTURL}/v${version}/node-v${version}.tar.gz`;
}

export function packagedNativeRebuildDirectory(outputDirectory) {
	const root = String(outputDirectory || "");
	const candidates = [
		path.join(root, "package.nw", "sviber"),
		path.join(root, "sviber.app", "Contents", "Resources", "app.nw", "sviber"),
		path.join(root, "sviber"),
	];
	for (const directory of candidates) {
		if (existsSync(path.join(directory, "node_modules", "gl"))) {
			return directory;
		}
	}
	throw new Error("packaged gl native module not found under the NW.js output");
}

// The NW.js output root holds the runtime binaries next to the packaged app, so launchers
// written to that root must reach INTO the packaged app: `package.nw` on Windows/Linux or
// the `.app` bundle on macOS. Resolving this instead of hardcoding a prefix keeps the MCP
// launcher (and anything else startable) from pointing at a directory that does not exist.
export const PACKAGED_APPLICATION_CANDIDATES = Object.freeze([
	["package.nw", "sviber"],
	["sviber.app", "Contents", "Resources", "app.nw", "sviber"],
	["sviber"],
]);

export function packagedApplicationDirectory(outputDirectory, nodeName = "node") {
	const root = String(outputDirectory || "");
	for (const segments of PACKAGED_APPLICATION_CANDIDATES) {
		const directory = path.join(root, ...segments);
		if (existsSync(path.join(directory, "runtime", nodeName))) {
			return directory;
		}
	}
	throw new Error("packaged application directory not found under the NW.js output");
}

// Relative path (POSIX separators) from the launcher's directory to the packaged app.
export function packagedApplicationPrefix(outputDirectory, nodeName = "node") {
	return path
		.relative(String(outputDirectory || ""), packagedApplicationDirectory(outputDirectory, nodeName))
		.split(path.sep)
		.join("/");
}

export function mcpLauncherScript(outputDirectory, { platform, nodeName }) {
	const prefix = packagedApplicationPrefix(outputDirectory, nodeName);
	const runtimeNode = path.posix.join(prefix, "runtime", nodeName);
	const script = path.posix.join(prefix, "js", "mcp", "mcp-main.mjs");
	if (platform === "win") {
		const windowsRuntime = runtimeNode.replace(/\//g, "\\");
		const windowsScript = script.replace(/\//g, "\\");
		return {
			name: "sviber-mcp.cmd",
			body: `@echo off\r\n"%~dp0${windowsRuntime}" "%~dp0${windowsScript}" %*\r\n`,
		};
	}
	const dir = `DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)`;
	return {
		name: "sviber-mcp",
		body: `#!/bin/sh\n${dir}\nexec "$DIR/${runtimeNode}" "$DIR/${script}" "$@"\n`,
	};
}

export function shouldIncludePackagedFile(pathname, { runtimeFree = false } = {}) {
	if (!runtimeFree) {
		return true;
	}
	const value = String(pathname || "").replace(/\\/g, "/");
	if (NATIVE_BINARY_PATTERN.test(value)) {
		return false;
	}
	if (FFMPEG_NAME_PATTERN.test(value)) {
		return false;
	}
	if (/(?:^|\/)bin\/ffmpeg(?:\.exe)?$/.test(value)) {
		return false;
	}
	if (isBundledFfmpegLibrary(value)) {
		return false;
	}
	return true;
}

export function nativeRebuildSpec({ kind, nwVersion, hostNodeVersion }) {
	if (kind === "runtime") {
		return {
			packages: [...RUNTIME_NATIVE_PACKAGES],
			abiRebuildPackages: [...ABI_REBUILD_PACKAGES],
			runtime: "node",
			target: String(hostNodeVersion || process.versions.node || ""),
			disturl: NWJS_HEADERS_DISTURL,
			tarball: nwjsHeadersTarball(nwVersion),
		};
	}
	return {
		packages: [],
		runtime: "node",
		target: String(hostNodeVersion || process.versions.node || ""),
	};
}

export function isRuntimeFreePackage(env = process.env) {
	return /^(?:1|true)$/i.test(String(env.SVIBER_NW_PACKAGE_ONLY || ""));
}
