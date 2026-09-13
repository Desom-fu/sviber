// Housekeeping for the shared instance directory (~/.sviber). An editor that is killed instead
// of closed never runs its cleanup, so its `<pid>.sock` entry stays behind: POSIX leaves the
// socket file, win32 leaves the marker next to the (already gone) named pipe. A leftover entry
// makes `list_instances` advertise a phantom instance whose endpoint no longer accepts
// connections, so a starting editor prunes the entries whose process is gone.

import { SVIBER_SOCKET_EXTENSION, socketPathFromName } from "./mcp-paths.js";

export function instancePidFromName(name) {
	const value = String(name || "");
	if (!value.endsWith(SVIBER_SOCKET_EXTENSION)) {
		return 0;
	}
	const pid = Number(value.slice(0, -SVIBER_SOCKET_EXTENSION.length));
	return Number.isSafeInteger(pid) && pid > 0 ? pid : 0;
}

// Signal 0 only probes for existence. EPERM means the process is there but belongs to someone
// else, which must count as alive; a missing `process` (browser) can never prune anything.
export function processIsAlive(pid) {
	try {
		globalThis.process?.kill?.(pid, 0);
		return true;
	} catch (error) {
		return error?.code === "EPERM";
	}
}

export function pruneStaleInstanceEndpoints({ fs, directory, isAlive = processIsAlive, keepPid = 0 } = {}) {
	let names = [];
	try {
		names = fs.readdirSync(directory);
	} catch {
		return [];
	}
	const removed = [];
	for (const name of names) {
		const pid = instancePidFromName(name);
		if (!pid || pid === Number(keepPid) || isAlive(pid)) {
			continue;
		}
		try {
			fs.unlinkSync(socketPathFromName(directory, name));
			removed.push(name);
		} catch {
			/* already gone */
		}
	}
	return removed;
}
