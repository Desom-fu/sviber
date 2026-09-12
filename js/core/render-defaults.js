// Default output path and last-used nickname/avatar for Render video/cover (PROMPT-v26).

export const RENDER_DEFAULTS_KEY = "sviber.renderDefaults";

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

export function normalizeRenderDefaults(source = {}) {
	const avatar = String(source.avatar || "online");
	const kind = ["online", "upload", "gravatar"].includes(avatar) ? avatar : "online";
	return {
		nickname: source.nickname == null ? null : String(source.nickname),
		avatar: kind,
		avatarOnline: source.avatarOnline == null ? null : String(source.avatarOnline),
		avatarUpload: source.avatarUpload == null ? null : String(source.avatarUpload),
		avatarGravatar: source.avatarGravatar == null ? null : String(source.avatarGravatar),
	};
}

export function loadRenderDefaults(storage = globalThis.localStorage) {
	try {
		return normalizeRenderDefaults(JSON.parse(storage?.getItem(RENDER_DEFAULTS_KEY) || "{}"));
	} catch {
		return normalizeRenderDefaults({});
	}
}

export function saveRenderDefaults(values, storage = globalThis.localStorage) {
	const normalized = normalizeRenderDefaults(values);
	try {
		storage?.setItem(RENDER_DEFAULTS_KEY, JSON.stringify(normalized));
	} catch {
		/* Storage may be unavailable. */
	}
	return normalized;
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
