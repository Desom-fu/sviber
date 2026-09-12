// MCP server backend: talk to editor instances over ~/.sviber/${pid}.sock.

import fs from "node:fs";
import net from "node:net";
import { instanceSocketPath, socketPathFromName, sviberDirectory } from "./mcp-paths.js";

export function listInstanceSocketPaths(home) {
	const directory = sviberDirectory(home);
	let entries = [];
	try {
		entries = fs.readdirSync(directory);
	} catch {
		return [];
	}
	return entries
		.filter(name => name.endsWith(".sock"))
		.map(name => ({
			pid: Number(name.slice(0, -".sock".length)),
			path: socketPathFromName(directory, name),
		}))
		.filter(item => Number.isSafeInteger(item.pid) && item.pid > 0);
}

function sendSocketRequest(socketPath, payload, timeoutMs = 15000) {
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

export function createSocketBackend(home) {
	return {
		listInstances() {
			return {
				instances: listInstanceSocketPaths(home).map(item => ({
					id: String(item.pid),
					pid: item.pid,
					path: item.path,
				})),
			};
		},
		callInstance(instance, name, args) {
			const pid = Number(instance);
			const socketPath = instanceSocketPath(pid, home);
			return sendSocketRequest(socketPath, { method: name, arguments: args || {} });
		},
	};
}
