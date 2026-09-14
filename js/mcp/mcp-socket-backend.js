// MCP server backend: talk to editor instances over ~/.sviber/${pid}.sock.

import fs from "node:fs";
import net from "node:net";
import { resolveMcpClientIdentity } from "./mcp-client-identity.js";
import { instancePidFromName, pruneStaleInstanceEndpoints, processIsAlive } from "./mcp-instance-directory.js";
import { readPairingRecords } from "./mcp-pairing.js";
import { instanceTransport, socketPathFromName, sviberDirectory } from "./mcp-paths.js";

// Discovery always lists `<pid>.sock`: POSIX publishes the socket itself, win32 publishes an
// empty marker file next to the named pipe (the pipe namespace cannot be enumerated).
export function listInstanceSocketPaths(home, { isAlive = processIsAlive } = {}) {
	const directory = sviberDirectory(home);
	// An editor killed instead of closed never runs its cleanup, so its marker stays behind
	// and would make list_instances advertise a phantom whose endpoint accepts nothing.
	// Sweeping dead entries at discovery time heals the directory even when no editor starts
	// again; entries that cannot be unlinked are still filtered out of the listing.
	pruneStaleInstanceEndpoints({ fs, directory, isAlive });
	let entries = [];
	try {
		entries = fs.readdirSync(directory);
	} catch {
		return [];
	}
	return entries.flatMap(name => {
		const pid = instancePidFromName(name);
		return pid > 0 && isAlive(pid) ? [{ pid, path: socketPathFromName(directory, name) }] : [];
	});
}

// Generous enough for a user to answer a pairing prompt before the call gives up.
function sendSocketRequest(socketPath, payload, timeoutMs = 60000) {
	return new Promise((resolve, reject) => {
		const client = net.connect({ path: socketPath });
		let buffer = "";
		const timer = setTimeout(() => {
			client.destroy();
			reject(new Error("editor instance timed out"));
		}, timeoutMs);
		client.on("error", error => {
			clearTimeout(timer);
			reject(error);
		});
		client.on("data", chunk => {
			buffer += chunk;
			const index = buffer.indexOf("\n");
			if (index < 0) {
				return;
			}
			clearTimeout(timer);
			client.end();
			try {
				const message = JSON.parse(buffer.slice(0, index));
				if (message.error) {
					reject(new Error(message.error));
					return;
				}
				resolve(message.result);
			} catch (error) {
				reject(error);
			}
		});
		client.on("connect", () => {
			client.write(`${JSON.stringify(payload)}\n`);
		});
	});
}

// A request opens a fresh connection, so the editor cannot recognize the caller from the
// socket alone. Every request therefore carries the server's stable `client` id and its
// display name: the id is what the editor pairs once, the name is what the pairing prompt shows.
export function createSocketBackend(home, options = {}) {
	const identity = resolveMcpClientIdentity({
		env: options.env,
		clientId: options.clientId,
		clientName: options.clientName,
	});
	return {
		clientId: identity.id,
		clientName: identity.name,
		listInstances() {
			// `pairedWith` is how the MCP side tells which editor instance a client is talking to.
			const records = readPairingRecords({ fs, home });
			return {
				instances: listInstanceSocketPaths(home, { isAlive: options.isAlive }).map(item => ({
					id: String(item.pid),
					pid: item.pid,
					path: instanceTransport(item.pid, { home }).path,
					pairedWith: records
						.filter(record => record.pairedWith.some(entry => entry.pid === item.pid))
						.map(record => ({ id: record.id, name: record.name })),
				})),
			};
		},
		callInstance(instance, name, args) {
			const pid = Number(instance);
			const socketPath = instanceTransport(pid, { home }).path;
			return sendSocketRequest(socketPath, {
				method: name,
				arguments: args || {},
				client: identity.id,
				clientName: identity.name,
			});
		},
	};
}
