// MCP stdio JSON-RPC server. Stdout is protocol-only; logs go to stderr.

import { readFileSync } from "node:fs";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
	encodeJsonRpc,
	jsonRpcError,
	jsonRpcResult,
	mcpInitializeResult,
	parseJsonRpcLine,
} from "./mcp-protocol.js";
import { callMcpTool, mcpToolsListResult, toolCallContent } from "./mcp-tools.js";
import { registerPairingRecord, removePairingRecord } from "./mcp-pairing.js";
import { createSocketBackend } from "./mcp-socket-backend.js";

function packageVersion() {
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const json = JSON.parse(readFileSync(path.join(here, "..", "..", "package.json"), "utf8"));
		return json.version;
	} catch {
		return "";
	}
}

export async function handleMcpRequest(message, backend, version = packageVersion()) {
	if (message.method === "initialize") {
		return jsonRpcResult(message.id, mcpInitializeResult(version));
	}
	if (message.method === "notifications/initialized" || message.method === "initialized") {
		return null;
	}
	if (message.method === "tools/list") {
		return jsonRpcResult(message.id, mcpToolsListResult());
	}
	if (message.method === "tools/call") {
		const name = message.params?.name;
		const args = message.params?.arguments || {};
		try {
			const value = await callMcpTool(name, args, backend);
			return jsonRpcResult(message.id, toolCallContent(value));
		} catch (error) {
			return jsonRpcError(message.id, -32000, error.message);
		}
	}
	if (message.method === "ping") {
		return jsonRpcResult(message.id, {});
	}
	return jsonRpcError(message.id, -32601, `Method not found: ${message.method}`);
}

export async function dispatchMcpLine(line, backend, version) {
	let message;
	try {
		message = parseJsonRpcLine(line);
	} catch (error) {
		return jsonRpcError(null, -32700, error.message);
	}
	if (!message) {
		return null;
	}
	if (message.method == null) {
		return jsonRpcError(message.id, -32600, "Invalid Request");
	}
	return handleMcpRequest(message, backend, version);
}

// Announce the server in the pairing directory as soon as it starts, and withdraw the
// announcement when it stops. Editors watch that directory (or scan it at startup), so the user
// pairs once, up front, instead of being asked while a tool call is waiting on the answer.
function announcePairing(backend, home) {
	if (!backend?.clientId) {
		return;
	}
	const registered = registerPairingRecord({
		fs,
		home,
		id: backend.clientId,
		name: backend.clientName || "",
		pid: process.pid,
	});
	if (!registered) {
		return;
	}
	const withdraw = () => removePairingRecord({ fs, home, id: backend.clientId });
	process.once("exit", withdraw);
	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.once(signal, () => {
			withdraw();
			process.exit(0);
		});
	}
}

export function startMcpStdio(options = {}) {
	const input = options.stdin || process.stdin;
	const output = options.stdout || process.stdout;
	const stderr = options.stderr || process.stderr;
	const backend = options.backend || createSocketBackend(options.home, options);
	const version = options.version || packageVersion();
	if (!options.backend) {
		announcePairing(backend, options.home);
	}
	let buffer = "";
	input.setEncoding?.("utf8");
	input.on("data", chunk => {
		buffer += chunk;
		const lines = buffer.split(/\r?\n/);
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			void (async () => {
				// Everything an agent does over MCP lands in the client's log, so the user can
				// audit remote operations without watching the editor.
				let label = line.slice(0, 60);
				try {
					const parsed = JSON.parse(line);
					const method = String(parsed?.method || "");
					label = method === "tools/call" ? `tools/call ${parsed?.params?.name || ""}` : method;
				} catch {
					/* the dispatcher reports malformed lines */
				}
				const started = Date.now();
				const response = await dispatchMcpLine(line, backend, version);
				if (response) {
					output.write(encodeJsonRpc(response));
				}
				const failed = response?.error ? ` ERROR ${response.error.message}` : "";
				stderr.write(`sviber-mcp ${label} ${Date.now() - started}ms${failed}\n`);
			})();
		}
	});
	return { backend };
}
