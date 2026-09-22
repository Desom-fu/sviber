// Runtime fixes for sunniesnow-record renders.
//
// Two failures used to surface as a broken render:
// - A Windows path such as E:\avatar.png is a valid URL (protocol "e:"), so the game's
//   online-avatar hook hands it to fetch and undici throws "TypeError: fetch failed".
//   The default avatar name is fetched from the community server, which fails the same
//   way when that host is unreachable. Either abort aborts Settings, and Plugin/Chart
//   then crash only because the settings object was never finished.
// - Windows FFmpeg builds ship ffmpeg.exe plus sibling DLLs. Spawning the exe alone
//   makes Node report "spawn ffmpeg ENOENT". A bare "ffmpeg" lookup also fails when the
//   install directory contains spaces.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTENT_TYPES = {
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
};

export function sviberAppRoot() {
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function bundledFfmpegCandidate(appRoot, platform = process.platform) {
	return path.join(appRoot, "bin", platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
}

export function defaultAvatarCandidate(appRoot) {
	return path.join(appRoot, "svg", "default-avatar.svg");
}

export function isBareFfmpegCommand(value) {
	return /^(?:ffmpeg|ffmpeg\.exe)$/i.test(String(value ?? "").trim());
}

export function isWindowsFilesystemPath(value) {
	const text = String(value ?? "").trim();
	return /^[a-zA-Z]:[\\/]/.test(text) || text.startsWith("\\\\");
}

export function filesystemPathForFetch(target) {
	const text = String(target ?? "").trim();
	if (!text || /^https?:/i.test(text)) {
		return null;
	}
	if (isWindowsFilesystemPath(text)) {
		return text;
	}
	if (/^file:/i.test(text)) {
		try {
			return fileURLToPath(text);
		} catch {
			return null;
		}
	}
	return null;
}

export function isDefaultAvatarName(value) {
	const text = String(value ?? "").trim();
	if (!text || /^(?:\.\/)?default\.svg$/i.test(text)) {
		return true;
	}
	try {
		return /\/default\.svg$/i.test(decodeURIComponent(new URL(text).pathname));
	} catch {
		return false;
	}
}

function fileExists(target, exists) {
	try {
		return Boolean(target) && exists(target);
	} catch {
		return false;
	}
}

function contentTypeForPath(filePath) {
	const lower = String(filePath).toLowerCase();
	const dot = lower.lastIndexOf(".");
	return CONTENT_TYPES[dot >= 0 ? lower.slice(dot) : ""] || "application/octet-stream";
}

// The online avatar field accepts a community filename. A drive path typed or picked
// into that field, and the built-in default.svg, are turned into a local upload so
// rendering does not depend on fetch.
export function prepareAvatarOptions(options = {}, { defaultAvatar, exists = fs.existsSync } = {}) {
	const next = { ...options };
	if (next.avatar === "online" || next.avatar == null) {
		const local = filesystemPathForFetch(next.avatarOnline);
		if (local) {
			next.avatar = "upload";
			next.avatarUpload = local;
			next.avatarOnline = undefined;
		} else if (
			isDefaultAvatarName(next.avatar === "online" ? next.avatarOnline : (next.avatarOnline ?? "default.svg"))
			&& fileExists(defaultAvatar, exists)
		) {
			next.avatar = "upload";
			next.avatarUpload = defaultAvatar;
			next.avatarOnline = undefined;
		}
	}
	if (next.avatar === "upload") {
		const file = String(next.avatarUpload ?? "").trim();
		if (!fileExists(file, exists)) {
			throw Object.assign(new Error(`Local file not found: ${file || "(empty)"}`), { code: "AVATAR_NOT_FOUND" });
		}
		next.avatarUpload = file;
	}
	return next;
}

// Prefer an explicit executable that exists. Otherwise use the bundled binary when the
// package has one, including when the caller only said "ffmpeg" (PATH lookup misses it
// if the install directory contains spaces, and reports a missing DLL as ENOENT).
export function resolveFfmpegForRecord(requested, { bundled, exists = fs.existsSync } = {}) {
	const text = String(requested ?? "").trim();
	if (text && !isBareFfmpegCommand(text) && fileExists(text, exists)) {
		return text;
	}
	if (fileExists(bundled, exists)) {
		return bundled;
	}
	return text || "ffmpeg";
}

// sunniesnow-record's fetch treats only file: as local. A Windows path survives
// URL parsing with a drive-letter protocol, then undici fails the request.
export function installRecordFetchFallback(utils, fsPromises = fs.promises) {
	if (!utils || utils.__sviberFetchFallback || typeof utils.strictFetch !== "function") {
		return utils;
	}
	utils.__sviberFetchFallback = true;
	const original = utils.strictFetch.bind(utils);
	utils.strictFetch = async (target, requestOptions) => {
		const local = filesystemPathForFetch(target);
		if (local) {
			let data;
			try {
				data = await fsPromises.readFile(local);
			} catch (error) {
				throw Object.assign(new Error(`Local file not found: ${local}`), {
					cause: error,
					code: "AVATAR_NOT_FOUND",
				});
			}
			return new Response(data, {
				status: 200,
				headers: {
					"Content-Type": contentTypeForPath(local),
					"Content-Length": String(data.length),
				},
			});
		}
		try {
			return await original(target, requestOptions);
		} catch (error) {
			throw Object.assign(
				new Error(`Failed to fetch ${target}: ${error?.message || error}`),
				{ cause: error },
			);
		}
	};
	return utils;
}
