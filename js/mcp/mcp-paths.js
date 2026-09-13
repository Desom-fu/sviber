// Editor instance socket path: ~/.sviber/${pid}.sock (PROMPT-v26). Not customizable.
// This module stays browser-safe so the editor can compute the same path NW.js listens on.

export const SVIBER_DIR_NAME = ".sviber";
// Node implements the Windows local domain with named pipes only: `listen()`/`connect()`
// reject a filesystem path there with EACCES ("On Windows, the local domain is implemented
// using a named pipe. The path must refer to an entry in \\?\pipe\ or \\.\pipe\"). So the
// endpoint is a pipe on win32 while `<pid>.sock` stays an empty marker file, which is what
// keeps the directory listing in mcp-socket-backend.js able to enumerate instances.
export const WINDOWS_PIPE_PREFIX = "\\\\.\\pipe\\";
export const INSTANCE_PIPE_PREFIX = "sviber-";

function platformName() {
	try {
		const platform = globalThis.process?.platform;
		if (typeof platform === "string" && platform) {
			return platform;
		}
	} catch {
		/* browser */
	}
	return "";
}

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

// Where an instance actually listens and where the MCP server connects.
// `path` is the bind/connect target; `markerPath` is the empty file that makes the
// instance discoverable through the `<pid>.sock` directory listing (win32 only).
export function instanceTransport(pid, options = {}) {
	const id = Number(pid);
	const home = options.home;
	const platform = options.platform || platformName();
	if (platform === "win32") {
		return {
			kind: "pipe",
			path: `${WINDOWS_PIPE_PREFIX}${INSTANCE_PIPE_PREFIX}${id}`,
			markerPath: instanceSocketPath(id, home),
		};
	}
	return { kind: "socket", path: instanceSocketPath(id, home), markerPath: null };
}
