// JSON-RPC 2.0 framing for the MCP stdio server. Stdout is protocol-only.

export const MCP_PROTOCOL_VERSION = "2024-11-05";

export function jsonRpcError(id, code, message, data) {
	const error = { code, message };
	if (data !== undefined) {
		error.data = data;
	}
	return { jsonrpc: "2.0", id: id ?? null, error };
}

export function jsonRpcResult(id, result) {
	return { jsonrpc: "2.0", id, result };
}

export function parseJsonRpcLine(line) {
	const text = String(line ?? "").trim();
	if (!text) {
		return null;
	}
	const message = JSON.parse(text);
	if (!message || message.jsonrpc !== "2.0") {
		throw new Error("not a JSON-RPC 2.0 message");
	}
	return message;
}

export function encodeJsonRpc(message) {
	return `${JSON.stringify(message)}\n`;
}

export function mcpInitializeResult(version) {
	return {
		protocolVersion: MCP_PROTOCOL_VERSION,
		capabilities: { tools: {} },
		serverInfo: { name: "sviber-mcp", version: String(version || "") },
	};
}
