// MCP stdio JSON-RPC server. Stdout is protocol-only; logs go to stderr.

import { readFileSync } from "node:fs";
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

export function startMcpStdio(options = {}) {
	const input = options.stdin || process.stdin;
	const output = options.stdout || process.stdout;
	const backend = options.backend || createSocketBackend();
	const version = options.version || packageVersion();
	let buffer = "";
	input.setEncoding?.("utf8");
	input.on("data", chunk => {
		buffer += chunk;
		const lines = buffer.split(/\r?\n/);
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			void dispatchMcpLine(line, backend, version).then(response => {
				if (response) {
					output.write(encodeJsonRpc(response));
				}
			});
		}
	});
	return { backend };
}
