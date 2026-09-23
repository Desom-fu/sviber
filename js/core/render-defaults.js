// Default output path and last-used nickname/avatar for Render video/cover (PROMPT-v26).

export const RENDER_DEFAULTS_KEY = "sviber.renderDefaults";

export const RENDER_AVATAR_KINDS = Object.freeze(["online", "upload", "gravatar", "weavatar"]);

export function chartFileNameWithoutExt(filename) {
	const base = String(filename || "")
		.replace(/\\/g, "/")
		.split("/")
		.pop();
	if (!base) {
		return "chart";
	}
	return base.replace(/\.[^/.]+$/, "") || "chart";
}

export function joinFilesystemPath(directory, filename) {
	const value = String(directory || "");
	if (!value) {
		return "";
	}
	const slash = value.includes("\\") ? "\\" : "/";
	return `${value.replace(/[\\/]+$/, "")}${slash}${filename}`;
}

export function defaultRenderOutputPath({ projectFolder, chartFileName } = {}) {
	if (!projectFolder) {
		return "";
	}
	return joinFilesystemPath(projectFolder, `${chartFileNameWithoutExt(chartFileName)}.mkv`);
}

// Shared fields (nickname, avatar source) apply to both the video and the cover dialog;
// the per-kind fields live in `video` / `cover` so e.g. both dialogs can remember their
// own width/height independently (PROMPT-v26, remembered per item from v0.17.20).
export function normalizeRenderDefaults(source = {}) {
	const avatar = String(source.avatar || "online");
	const kind = RENDER_AVATAR_KINDS.includes(avatar) ? avatar : "online";
	return {
		nickname: source.nickname == null ? null : String(source.nickname),
		avatar: kind,
		avatarOnline: source.avatarOnline == null ? null : String(source.avatarOnline),
		avatarUpload: source.avatarUpload == null ? null : String(source.avatarUpload),
		avatarGravatar: source.avatarGravatar == null ? null : String(source.avatarGravatar),
		avatarWeavatar: source.avatarWeavatar == null ? null : String(source.avatarWeavatar),
		video: normalizeVideoDefaults(source.video),
		cover: normalizeCoverDefaults(source.cover),
	};
}

const VIDEO_DEFAULT_KEYS = [
	"output",
	"useBundledFfmpeg",
	"speed",
	"width",
	"height",
	"fps",
	"resultsDuration",
	"waitForMusic",
];

const COVER_DEFAULT_KEYS = ["output", "width", "height"];

export function normalizeVideoDefaults(source = {}) {
	const normalized = { output: null };
	for (const key of VIDEO_DEFAULT_KEYS.slice(1)) {
		const value = source?.[key];
		normalized[key] = typeof value === "boolean" ? value : value == null || value === "" ? null : Number(value);
	}
	normalized.output = source?.output == null ? null : String(source.output);
	return normalized;
}

export function normalizeCoverDefaults(source = {}) {
	const normalized = { output: null };
	for (const key of COVER_DEFAULT_KEYS.slice(1)) {
		const value = source?.[key];
		normalized[key] = value == null || value === "" ? null : Number(value);
	}
	normalized.output = source?.output == null ? null : String(source.output);
	normalized.coverTheme = normalizeCoverThemeState(source?.coverTheme);
	return normalized;
}

// The remembered diamond is the widget's view state, not the texture-space values sent
// to sunniesnow-record (those are derived in coverThemeSelection at read time).
export function normalizeCoverThemeState(source = {}) {
	const number = value => (value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));
	return {
		x: number(source?.x),
		y: number(source?.y),
		width: number(source?.width),
		contained: Boolean(source?.contained),
	};
}

export function loadRenderDefaults(storage = globalThis.localStorage) {
	try {
		return normalizeRenderDefaults(JSON.parse(storage?.getItem(RENDER_DEFAULTS_KEY) || "{}"));
	} catch {
		return normalizeRenderDefaults({});
	}
}

// `kind` ("video" | "cover") selects which per-kind block the dialog values are saved
// into; shared fields are always updated. The legacy call form saveRenderDefaults(values,
// storage) still works and only refreshes the shared fields.
export function saveRenderDefaults(values, kind, storage = globalThis.localStorage) {
	let storedKind = kind;
	let store = storage;
	if (kind && (typeof kind === "object" || (kind !== "video" && kind !== "cover"))) {
		store = kind;
		storedKind = undefined;
	}
	const previous = loadRenderDefaults(store);
	const shared = {};
	for (const key of ["nickname", "avatar", "avatarOnline", "avatarUpload", "avatarGravatar", "avatarWeavatar"]) {
		if (values[key] !== undefined) {
			shared[key] = values[key];
		}
	}
	const normalized = normalizeRenderDefaults({ ...previous, ...shared });
	if (storedKind === "video") {
		normalized.video = normalizeVideoDefaults({ ...previous.video, ...pickDefined(values, VIDEO_DEFAULT_KEYS) });
	}
	if (storedKind === "cover") {
		normalized.cover = normalizeCoverDefaults({
			...previous.cover,
			...pickDefined(values, COVER_DEFAULT_KEYS),
			coverTheme: values.coverThemeState ?? previous.cover.coverTheme,
		});
	}
	try {
		store?.setItem(RENDER_DEFAULTS_KEY, JSON.stringify(normalized));
	} catch {
		/* Storage may be unavailable. */
	}
	return normalized;
}

function pickDefined(values, keys) {
	const picked = {};
	for (const key of keys) {
		if (values[key] !== undefined) {
			picked[key] = values[key];
		}
	}
	return picked;
}

export function renderNicknameDefault(last, charter) {
	if (last?.nickname != null && last.nickname !== "") {
		return last.nickname;
	}
	return String(charter || "");
}

export function avatarFieldHidden(kind, current) {
	return current !== kind;
}
