// Global and project macro CRUD used by MCP instance tools. Global storage uses the same
// `sviber.macros` key as the macros window.

export const GLOBAL_MACRO_KEY = "sviber.macros";

export function storageOf(app) {
	return app?.macroStorage || globalThis.localStorage;
}

export function readGlobalMacroMap(storage = globalThis.localStorage) {
	try {
		const value = JSON.parse(storage?.getItem?.(GLOBAL_MACRO_KEY) || "{}");
		return value && typeof value === "object" && !Array.isArray(value) ? value : {};
	} catch {
		return {};
	}
}

export function writeGlobalMacroMap(map, storage = globalThis.localStorage) {
	storage?.setItem?.(GLOBAL_MACRO_KEY, JSON.stringify(map));
	return map;
}

export function listGlobalMacros(storage = globalThis.localStorage) {
	return Object.entries(readGlobalMacroMap(storage)).flatMap(([name, stored]) => {
		if (!name) {
			return [];
		}
		const content = stored && typeof stored === "object" ? stored.content : stored;
		return [
			{
				id: `global:${name}`,
				scope: "global",
				name,
				language: stored && typeof stored === "object" && stored.language === "ruby" ? "ruby" : "javascript",
				filename: name,
				content: String(content ?? ""),
			},
		];
	});
}

export async function listProjectMacros(app) {
	if (typeof app?.files?.listProjectFiles !== "function") {
		return [];
	}
	let files = [];
	try {
		files = [...(await app.files.listProjectFiles(".js")), ...(await app.files.listProjectFiles(".rb"))].sort(
			(left, right) => left.localeCompare(right),
		);
	} catch {
		return [];
	}
	return files.map(filename => ({
		id: `project:${filename}`,
		scope: "project",
		name: filename.replace(/\.(js|rb)$/i, ""),
		filename,
		language: /\.rb$/i.test(filename) ? "ruby" : "javascript",
	}));
}

export function describeMacro(item) {
	return {
		id: item.id,
		name: item.name,
		scope: item.scope,
		language: item.language,
		filename: item.filename || item.label || item.name,
	};
}

export function macroFilename(name, language) {
	const value = String(name || "").trim();
	if (/\.(js|rb)$/i.test(value)) {
		return value;
	}
	return `${value}.${language === "ruby" ? "rb" : "js"}`;
}
