// Editor instance socket path: ~/.sviber/${pid}.sock (PROMPT-v26). Not customizable.
// This module stays browser-safe so the editor can compute the same path NW.js listens on.

export const SVIBER_DIR_NAME = ".sviber";

function homeDirectory(home) {
	if (home) {
		return String(home);
	}
	try {
		const os = globalThis.nw?.require?.("os") || globalThis.process;
		if (typeof os?.homedir === "function") {
			return os.homedir();
		}
	} catch {
		/* browser */
	}
	return String(globalThis.process?.env?.HOME || globalThis.process?.env?.USERPROFILE || "");
}

function joinHomePath(...parts) {
	const root = parts[0] || "";
	const slash = String(root).includes("\\") ? "\\" : "/";
	return parts
		.filter(part => part != null && part !== "")
		.map((part, index) => {
			const value = String(part);
			if (index === 0) {
				return value.replace(/[\\/]+$/, "");
			}
			return value.replace(/^[\\/]+|[\\/]+$/g, "");
		})
		.join(slash);
}

export function sviberDirectory(home) {
	return joinHomePath(homeDirectory(home), SVIBER_DIR_NAME);
}

export function instanceSocketPath(pid, home) {
	return joinHomePath(sviberDirectory(home), `${Number(pid)}.sock`);
}

export function socketPathFromName(directory, name) {
	return joinHomePath(directory, name);
}
