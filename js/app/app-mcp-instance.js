// Editor-side MCP instance endpoint: a Unix socket at ~/.sviber/${pid}.sock, or on Windows a
// named pipe plus an empty `<pid>.sock` marker (Node's local domain is pipes-only there).
// Connecting still asks for allow/deny consent in a popup.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { handleEditorMcpTool } from "../mcp/mcp-editor-handlers.js";
import { pruneStaleInstanceEndpoints } from "../mcp/mcp-instance-directory.js";
import { instanceSocketPath, instanceTransport, socketPathFromName, sviberDirectory } from "../mcp/mcp-paths.js";

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
		const transport = instanceTransport(pid);
		try {
			fs.mkdirSync(sviberDirectory(), { recursive: true });
			try {
				// POSIX leaves the socket file behind; win32 leaves the marker file behind.
				fs.unlinkSync(transport.markerPath || socketPath);
			} catch {
				/* leftover socket */
			}
			pruneStaleInstanceEndpoints({ fs, directory: sviberDirectory(), keepPid: pid });
		} catch (error) {
			console.warn("MCP instance directory failed", error);
			return;
		}
		const server = net.createServer(socket => void this._acceptMcpConnection(socket));
		server.on("error", error => console.warn("MCP instance socket failed", error));
		// win32 binds a named pipe, so the `<pid>.sock` marker has to be written once the
		// pipe actually exists; otherwise the directory listing would advertise a dead instance.
		server.on("listening", () => {
			if (!transport.markerPath) {
				return;
			}
			try {
				fs.writeFileSync(transport.markerPath, "");
			} catch (error) {
				console.warn("MCP instance marker failed", error);
			}
		});
		server.listen(transport.path);
		this._mcpServer = server;
		this._mcpSocketPath = transport.markerPath || socketPath;
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
		let buffer = "";
		socket.on("data", chunk => {
			buffer += chunk;
			let index = buffer.indexOf("\n");
			while (index >= 0) {
				const line = buffer.slice(0, index);
				buffer = buffer.slice(index + 1);
				index = buffer.indexOf("\n");
				void this._handleMcpSocketLine(socket, line);
			}
		});
	}

	// One consent decision per MCP server process (PROMPT-v26: the popup belongs to "a MCP
	// server wants to connect", not to every tool call). A decision lives as long as this
	// editor window; restart the MCP server to be asked again.
	async _confirmMcpClient(client) {
		const key = String(client || "");
		const decisions = (this._mcpClientConsent ||= new Map());
		if (key && decisions.has(key)) {
			return decisions.get(key);
		}
		const allowed = await this._confirmMcpConsent();
		if (key) {
			decisions.set(key, allowed);
		}
		return allowed;
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
		if (!(await this._confirmMcpClient(message.client))) {
			socket.write(`${JSON.stringify({ error: "denied" })}\n`);
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
