// Editor-side MCP instance socket at ~/.sviber/${pid}.sock with an allow/deny consent popup.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { handleEditorMcpTool } from "../mcp/mcp-editor-handlers.js";
import { instanceSocketPath, socketPathFromName, sviberDirectory } from "../mcp/mcp-paths.js";

function nwNode(name) {
	try {
		return globalThis.nw?.require?.(name) || null;
	} catch {
		return null;
	}
}

class McpInstanceTrait {
	_startMcpInstance() {
		if (!globalThis.nw || this._mcpServer) {
			return;
		}
		const fs = nwNode("fs");
		const net = nwNode("net");
		const pid = globalThis.process?.pid;
		if (!fs || !net || !Number.isSafeInteger(pid)) {
			return;
		}
		const socketPath = instanceSocketPath(pid);
		try {
			fs.mkdirSync(sviberDirectory(), { recursive: true });
			try {
				fs.unlinkSync(socketPath);
			} catch {
				/* leftover socket */
			}
		} catch (error) {
			console.warn("MCP instance directory failed", error);
			return;
		}
		const server = net.createServer(socket => void this._acceptMcpConnection(socket));
		server.on("error", error => console.warn("MCP instance socket failed", error));
		server.listen(socketPath);
		this._mcpServer = server;
		this._mcpSocketPath = socketPath;
		this._mcpFs = fs;
		const cleanup = () => this._stopMcpInstance();
		globalThis.addEventListener?.("pagehide", cleanup);
		globalThis.addEventListener?.("unload", cleanup);
		globalThis.process?.on?.("exit", cleanup);
	}

	_stopMcpInstance() {
		try {
			this._mcpServer?.close?.();
		} catch {
			/* already closed */
		}
		this._mcpServer = null;
		if (this._mcpSocketPath && this._mcpFs) {
			try {
				this._mcpFs.unlinkSync(this._mcpSocketPath);
			} catch {
				/* gone */
			}
		}
	}

	writeMusicSnippetFile(bytes) {
		const fs = this._mcpFs || nwNode("fs");
		if (!fs?.writeFileSync) {
			throw new Error("large music snippets require a local file writer");
		}
		const directory = sviberDirectory();
		fs.mkdirSync(directory, { recursive: true });
		const pathname = socketPathFromName(directory, `snippet-${Date.now()}.wav`);
		fs.writeFileSync(pathname, bytes);
		return pathname;
	}

	async _acceptMcpConnection(socket) {
		const allowed = await this._confirmMcpConsent();
		if (!allowed) {
			socket.end(`${JSON.stringify({ error: "denied" })}\n`);
			socket.destroy();
			return;
		}
		let buffer = "";
		socket.on("data", chunk => {
			buffer += chunk;
			const index = buffer.indexOf("\n");
			if (index < 0) {
				return;
			}
			const line = buffer.slice(0, index);
			buffer = buffer.slice(index + 1);
			void this._handleMcpSocketLine(socket, line);
		});
	}

	async _confirmMcpConsent() {
		const result = await this.dialogs.open({
			titleKey: "dialog.mcpConsent",
			fields: [
				{
					id: "warning",
					type: "custom",
					hideLabel: true,
					render: ({ document: documentRef }) => {
						const element = documentRef.createElement("p");
						element.textContent = i18n.t("dialog.mcpConsentWarning");
						return { element, read: () => true };
					},
				},
			],
			buttons: [
				{ id: "allow", labelKey: "dialog.mcpAllow", primary: true, value: true },
				{ id: "deny", labelKey: "dialog.mcpDeny", cancel: true, value: false, validate: false },
			],
		});
		return Boolean(result?.button === "allow" || result === true);
	}

	async _handleMcpSocketLine(socket, line) {
		let message;
		try {
			message = JSON.parse(line);
		} catch (error) {
			socket.write(`${JSON.stringify({ error: error.message })}\n`);
			return;
		}
		try {
			const result = await handleEditorMcpTool(message.method, message.arguments || {}, this);
			socket.write(`${JSON.stringify({ result })}\n`);
		} catch (error) {
			socket.write(`${JSON.stringify({ error: error.message })}\n`);
		}
	}
}

export const withMcpInstance = composeTraits("McpInstanceLayer", McpInstanceTrait);
