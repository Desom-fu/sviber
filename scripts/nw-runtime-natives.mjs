// Packaging rules for native modules and FFmpeg (PROMPT-v26).
// Runtime-free `.nw` omits native binaries and FFmpeg. Runtime natives rebuild against
// the NW.js Node ABI; development natives stay on the host Node.

export const RUNTIME_NATIVE_PACKAGES = Object.freeze(["gl", "canvas"]);
export const NATIVE_BINARY_PATTERN = /\.node$/i;
export const FFMPEG_NAME_PATTERN = /(?:^|[/\\])ffmpeg(?:\.exe)?$/i;
// Official NW.js header tarball host. npmmirror's nwjs tree 404s node-v*.tar.gz for 0.114.2.
export const NWJS_HEADERS_DISTURL = "https://dl.nwjs.io";

export function nwjsHeadersTarball(nwVersion) {
	const version = String(nwVersion || "").replace(/^v/i, "");
	return `${NWJS_HEADERS_DISTURL}/v${version}/node-v${version}.tar.gz`;
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
	return true;
}

export function nativeRebuildSpec({ kind, nwVersion, hostNodeVersion }) {
	if (kind === "runtime") {
		return {
			packages: [...RUNTIME_NATIVE_PACKAGES],
			runtime: "node-webkit",
			target: String(nwVersion || ""),
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
