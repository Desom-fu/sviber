// Pairing between an MCP server and each editor instance.
//
// The consent prompt belongs to "an MCP server wants to connect", so it must not wait for the
// first tool call: the server announces itself in `~/.sviber/pairing/<id>.json` while it runs
// and an editor offers to pair as soon as it sees that announcement.
//
// A pairing is deliberately **per run and per editor instance**: the editor keeps its decision
// in memory only, so closing the editor (or the server) and starting it again asks again, and
// two running editors each pair on their own. When an editor allows a client it marks the
// announcement with the instance it paired for, which is how the MCP side can tell which
// editor a client is paired with.
//
// Nothing here is a socket: callers pass the fs they have (node:fs on the MCP side,
// nw.require("fs") in the editor), which keeps this module loadable in the browser build.

import { pairingDirectory, pairingRecordPath, safeMcpClientId, sviberDirectory } from "./mcp-paths.js";

const PAIRING_VERSION = 1;

function readJson(fs, pathname) {
	try {
		return JSON.parse(fs.readFileSync(pathname, "utf8"));
	} catch {
		return null;
	}
}

export function readPairingRecords({ fs, home }) {
	let names = [];
	try {
		names = fs.readdirSync(pairingDirectory(home));
	} catch {
		return [];
	}
	const records = [];
	for (const name of names) {
		if (!name.endsWith(".json")) {
			continue;
		}
		const record = readJson(fs, pairingRecordPath(name.slice(0, -".json".length), home));
		if (!record || typeof record !== "object" || !record.id) {
			continue;
		}
		const rawPairedWith = Array.isArray(record.pairedWith) ? record.pairedWith : [];
		records.push({
			id: String(record.id),
			name: String(record.name || ""),
			pid: Number(record.pid) || 0,
			startedAt: String(record.startedAt || ""),
			// Editor instances that paired with this client, `{ pid, chart }` each.
			pairedWith: rawPairedWith
				.filter(entry => entry && typeof entry === "object")
				.map(entry => ({
					pid: Number(entry.pid) || 0,
					chart: String(entry.chart || ""),
				})),
		});
	}
	return records;
}

export function registerPairingRecord({ fs, home, id, name = "", pid = 0, now = new Date().toISOString() }) {
	try {
		fs.mkdirSync(pairingDirectory(home), { recursive: true });
		const pathname = pairingRecordPath(id, home);
		const payload = {
			id: String(id || ""),
			name: String(name || ""),
			pid: Number(pid) || 0,
			startedAt: now,
			pairedWith: [],
		};
		fs.writeFileSync(pathname, `${JSON.stringify(payload, null, 2)}\n`);
		return pathname;
	} catch {
		return null;
	}
}

export function removePairingRecord({ fs, home, id }) {
	try {
		fs.unlinkSync(pairingRecordPath(id, home));
		return true;
	} catch {
		return false;
	}
}

export function prunePairingRecords({ fs, home, isAlive, keepId = "" }) {
	const removed = [];
	for (const record of readPairingRecords({ fs, home })) {
		if (record.id === keepId || !record.pid || isAlive(record.pid)) {
			continue;
		}
		if (removePairingRecord({ fs, home, id: record.id })) {
			removed.push(record.id);
		}
	}
	return removed;
}

// Announcements this editor has not answered in this run yet, newest first so the prompt leads
// with the server that just started.
export function pendingPairingRecords({ records, decidedIds = [] } = {}) {
	const decided = new Set(Array.from(decidedIds || [], value => String(value)));
	return (records || [])
		.filter(record => !decided.has(record.id))
		.sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)));
}

// The editor records which of its instances paired with the client, so the MCP side can show
// which editor a client is talking to. One entry per editor instance (deduplicated by pid).
export function markPairedEditor({ fs, home, clientId, pid, chart = "", now = new Date().toISOString() }) {
	const pathname = pairingRecordPath(clientId, home);
	const record = readJson(fs, pathname) || { id: String(clientId || ""), name: "", pid: 0, startedAt: now };
	const previous = Array.isArray(record.pairedWith) ? record.pairedWith : [];
	const pairedWith = previous.filter(entry => Number(entry.pid) !== Number(pid));
	pairedWith.push({ pid: Number(pid) || 0, chart: String(chart || "") });
	fs.mkdirSync(pairingDirectory(home), { recursive: true });
	fs.writeFileSync(
		pathname,
		`${JSON.stringify({ ...record, pairedWith, pairedAt: now, version: PAIRING_VERSION }, null, 2)}\n`,
	);
	return pairedWith;
}

export function pairingRecordLabel(record) {
	return record.name ? `${record.name} (${safeMcpClientId(record.id)})` : safeMcpClientId(record.id);
}
