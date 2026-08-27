// Recognizing what a file is and what it may be called.
//
// Everything sviber loads or saves is identified by its filename: which extensions count as
// music or cover art, which MIME type to hand a Blob, which names Sunniesnow shows as level
// readme texts, and which characters a filename may not contain. Keeping those tables in one
// module means the chart loader, the project writer and the level packer agree.
//
// Split out of js/platform.js.

export const MIME_TYPES = Object.freeze({
	mp3: "audio/mpeg",
	ogg: "audio/ogg",
	wav: "audio/wav",
	flac: "audio/flac",
	m4a: "audio/mp4",
	aac: "audio/aac",
	opus: "audio/ogg",
	webm: "audio/webm",
	wma: "audio/x-ms-wma",
	aiff: "audio/aiff",
	aif: "audio/aiff",
	caf: "audio/x-caf",
	qoa: "audio/qoa",
	amr: "audio/amr",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	avif: "image/avif",
	bmp: "image/bmp",
	svg: "image/svg+xml",
});

export const AUDIO_EXTENSIONS = new Set([
	"mp3",
	"ogg",
	"wav",
	"flac",
	"m4a",
	"aac",
	"opus",
	"webm",
	"wma",
	"aiff",
	"aif",
	"caf",
	"qoa",
	"amr",
]);

export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg"]);

// Mirrors Sunniesnow.Utils.needsDisplayTextFile: files that the game shows as level
// readme texts.
const DISPLAY_TEXT_PATTERNS = Object.freeze([
	/^READ_?ME/i,
	/^LICEN[SC]/i,
	/^NOTICE/i,
	/^COPYING/i,
	/^COPYRIGHT/i,
	/^PATENT/i,
	/^CHANGE_?LOG/i,
	/^CODE_?OF_?CONDUCT/i,
	/^ATTRIBUTION/i,
	/^VERSION/i,
	/^CONTRIBUT/i,
]);

export function needsDisplayTextFile(filename) {
	const name = String(filename || "");
	if (/\.(md|markdown|txt|text)$/i.test(name)) {
		return true;
	}
	return DISPLAY_TEXT_PATTERNS.some(pattern => pattern.test(name));
}

export function extension(name) {
	return String(name).split(".").pop()?.toLowerCase() || "";
}

// A Lyrica chart has no distinguishing extension, so it is recognized by its header line:
// pipe-separated fields starting with a BPM, and no JSON brace anywhere in it.
export function looksLikeLyrica(text) {
	const first = String(text || "")
		.split(/\r?\n/)
		.find(line => line.trim());
	if (!first || first.includes("{")) {
		return false;
	}
	const fields = first.split("|");
	return fields.length >= 4 && Number.isFinite(Number(fields[0]));
}

export function sanitizeFilename(name, fallback = "chart") {
	const result = String(name || fallback)
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
		.trim();
	return result || fallback;
}

// Appends `-2`, `-3`, ... before the extension until the name is unused.
export function nextAvailableFilename(preferred, isTaken) {
	const dot = preferred.lastIndexOf(".");
	const stem = dot > 0 ? preferred.slice(0, dot) : preferred;
	const extensionPart = dot > 0 ? preferred.slice(dot) : "";
	let filename = preferred;
	let suffix = 2;
	while (isTaken(filename)) {
		filename = `${stem}-${suffix++}${extensionPart}`;
	}
	return filename;
}
