// Editor-side MCP instance endpoint and pairing.
//
// The endpoint is a Unix socket at ~/.sviber/${pid}.sock, or on Windows a named pipe plus an
// empty `<pid>.sock` marker (Node's local domain is pipes-only there).
//
// Pairing is deliberately NOT tied to the first tool call: an MCP server announces itself in
// ~/.sviber/pairing while it runs, and this editor offers to pair as soon as it sees that
// announcement (at startup, or through a directory watcher while it runs). A pairing is per
// editor instance and per run: it lives in this window's memory, so restarting either side
// asks again, and `list_instances` reports which instance a client is paired with.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { handleEditorMcpTool } from "../mcp/mcp-editor-handlers.js";
import { pruneStaleInstanceEndpoints, processIsAlive } from "../mcp/mcp-instance-directory.js";
import {
	markPairedEditor,
	pairingRecordLabel,
	pendingPairingRecords,
	prunePairingRecords,
	readPairingRecords,
} from "../mcp/mcp-pairing.js";
import {
	instanceSocketPath,
	instanceTransport,
	pairingDirectory,
	socketPathFromName,
	sviberDirectory,
} from "../mcp/mcp-paths.js";

const PAIRING_RETRY_MS = 1500;
const PAIRING_DEBOUNCE_MS = 150;
const PAIRING_POLL_MS = 5000;

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
		this._startMcpPairing(fs);
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
		clearTimeout(this._mcpPairingTimer);
		this._mcpPairingTimer = null;
		clearInterval(this._mcpPairingPoll);
		this._mcpPairingPoll = null;
		try {
			this._mcpPairingWatcher?.close?.();
		} catch {
			/* already closed */
		}
		this._mcpPairingWatcher = null;
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

	_startMcpPairing(fs) {
		this._mcpFs = fs;
		this._mcpDecidedClients = new Set();
		this._mcpDeniedClients = new Set();
		this._mcpAnnouncedClients = new Map();
		this._mcpPairedServerPids = new Map();
		try {
			fs.mkdirSync(pairingDirectory(), { recursive: true });
		} catch (error) {
			console.warn("MCP pairing directory failed", error);
		}
		try {
			this._mcpPairingWatcher = fs.watch(pairingDirectory(), () => this._queueMcpPairing());
			this._mcpPairingWatcher?.on?.("error", error => console.warn("MCP pairing watcher failed", error));
		} catch (error) {
			console.warn("MCP pairing watcher failed", error);
		}
		// The watcher catches graceful changes; the poll also catches a server that died hard and
		// left its announcement behind, so a broken pairing never lingers silently.
		this._mcpPairingPoll = setInterval(() => void this._offerMcpPairing(), PAIRING_POLL_MS);
		void this._offerMcpPairing();
	}

	_mcpInstanceLabel() {
		const title = String(this.model?.metadata?.title || "").trim();
		const pid = globalThis.process?.pid;
		return title ? `#${pid} — ${title}` : `#${pid}`;
	}

	_queueMcpPairing(delay = PAIRING_DEBOUNCE_MS) {
		clearTimeout(this._mcpPairingTimer);
		this._mcpPairingTimer = setTimeout(() => void this._offerMcpPairing(), delay);
	}

	// Re-reads the announcements and reconciles this window's decisions with them. A pairing is
	// with one server process, so it breaks when the announcement is gone OR when the same client
	// id re-announces from a different pid (server restarted), OR when that pid is dead (server
	// died hard and could not withdraw its announcement).
	_syncMcpPairing() {
		if (!this._mcpFs) {
			return { records: [], pending: [], lost: [] };
		}
		try {
			prunePairingRecords({ fs: this._mcpFs, isAlive: processIsAlive });
		} catch (error) {
			console.warn("MCP pairing cleanup failed", error);
		}
		const records = readPairingRecords({ fs: this._mcpFs });
		const announced = (this._mcpAnnouncedClients ||= new Map());
		for (const record of records) {
			if (!announced.has(record.id)) {
				announced.set(record.id, record.name);
			}
		}
		const lost = [];
		for (const id of [...(this._mcpDecidedClients || [])]) {
			const record = records.find(item => item.id === id);
			const pairedPid = this._mcpPairedServerPids?.get(id);
			let broken = false;
			if (pairedPid === undefined) {
				// A fallback pairing for a client that never announced itself: there is no server
				// process to go away, so it lasts for this window's lifetime.
				broken = false;
			} else if (!record || record.pid !== pairedPid || !processIsAlive(record.pid)) {
				broken = true;
			}
			if (broken) {
				this._mcpDecidedClients.delete(id);
				this._mcpDeniedClients?.delete(id);
				lost.push({ id, name: announced.get(id) || "" });
			}
		}
		const pending = pendingPairingRecords({
			records,
			decidedIds: this._mcpDecidedClients ? [...this._mcpDecidedClients] : [],
		});
		return { records, pending, lost };
	}

	_mcpPendingPairingRecords() {
		return this._syncMcpPairing().pending;
	}

	async _offerMcpPairing() {
		if (!this._mcpFs || this._mcpPairingBusy) {
			return;
		}
		const { pending, lost } = this._syncMcpPairing();
		const labels = records => records.map(record => pairingRecordLabel(record)).join("、");
		if (lost.length) {
			this.toast?.show?.("toast.mcpPairingLost", { clients: labels(lost) });
		}
		if (!pending.length) {
			return;
		}
		// Another dialog is up (or the user is mid-edit): ask again shortly instead of failing.
		if (this.dialogs?.active) {
			this._queueMcpPairing(PAIRING_RETRY_MS);
			return;
		}
		this._mcpPairingBusy = true;
		let allowed = false;
		try {
			allowed = await this._confirmMcpPairing(pending);
		} catch (error) {
			console.warn("MCP pairing prompt failed", error);
			this._queueMcpPairing(PAIRING_RETRY_MS);
			return;
		} finally {
			this._mcpPairingBusy = false;
		}
		const pid = globalThis.process?.pid;
		for (const record of pending) {
			this._mcpDecidedClients.add(record.id);
			if (!allowed) {
				this._mcpDeniedClients.add(record.id);
				continue;
			}
			// The pairing belongs to this server process: if the same client id comes back from
			// another pid, that is a new server and the editor pairs again.
			if (record.pid) {
				this._mcpPairedServerPids.set(record.id, record.pid);
			}
			try {
				const chart = String(this.model?.metadata?.title || "");
				markPairedEditor({ fs: this._mcpFs, clientId: record.id, pid, chart });
			} catch (error) {
				console.warn("MCP pairing mark failed", error);
			}
			this.toast?.show?.("toast.mcpPaired", { clients: labels([record]) });
		}
	}

	async _confirmMcpPairing(records) {
		const names = records.map(record => pairingRecordLabel(record)).join("、");
		const result = await this.dialogs.open({
			titleKey: "dialog.mcpConsent",
			fields: [
				{
					id: "warning",
					type: "custom",
					hideLabel: true,
					render: ({ document: documentRef }) => {
						const element = documentRef.createElement("div");
						const warning = documentRef.createElement("p");
						warning.textContent = i18n.t("dialog.mcpConsentWarning");
						element.append(warning);
						const pending = documentRef.createElement("p");
						pending.textContent = i18n.t("dialog.mcpPairingPending", { clients: names });
						element.append(pending);
						const instance = documentRef.createElement("p");
						const instanceText = this._mcpInstanceLabel();
						instance.textContent = i18n.t("dialog.mcpPairingInstance", { instance: instanceText });
						element.append(instance);
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

	// Paired in this run → silent. A client that never announced itself (older build, or a
	// one-shot process that exited before its announcement was seen) is asked here for this run.
	// If a pairing dialog is already on screen (the startup offer), the request waits for the
	// user to answer it instead of failing — that is the "allow the second editor" case with
	// several instances. The server-side request timeout is what eventually bounds this wait.
	async _mcpClientAllowed(client, clientName) {
		const key = String(client || "");
		while (this.dialogs?.active) {
			await new Promise(resolve => setTimeout(resolve, 250));
		}
		const { pending } = this._syncMcpPairing();
		if (key && this._mcpDecidedClients?.has(key) && !this._mcpDeniedClients?.has(key)) {
			return true;
		}
		if (key && this._mcpDeniedClients?.has(key)) {
			return false;
		}
		if (pending.some(record => record.id === key)) {
			// The startup offer is still on screen for this client: it will decide, not us.
			while (this.dialogs?.active) {
				await new Promise(resolve => setTimeout(resolve, 250));
			}
			return Boolean(key && this._mcpDecidedClients?.has(key) && !this._mcpDeniedClients?.has(key));
		}
		const record = { id: key || "unnamed", name: String(clientName || "") };
		const allowed = await this._confirmMcpPairing([record]);
		this._mcpDecidedClients.add(record.id);
		if (!allowed) {
			this._mcpDeniedClients.add(record.id);
			return false;
		}
		if (key) {
			try {
				const chart = String(this.model?.metadata?.title || "");
				const pid = globalThis.process?.pid;
				markPairedEditor({ fs: this._mcpFs, clientId: key, pid, chart });
			} catch (error) {
				console.warn("MCP pairing mark failed", error);
			}
			this.toast?.show?.("toast.mcpPaired", { clients: pairingRecordLabel(record) });
		}
		return true;
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

	async _handleMcpSocketLine(socket, line) {
		let message;
		try {
			message = JSON.parse(line);
		} catch (error) {
			socket.write(`${JSON.stringify({ error: error.message })}\n`);
			return;
		}
		let allowed = false;
		try {
			allowed = await this._mcpClientAllowed(message.client, message.clientName);
		} catch (error) {
			socket.write(`${JSON.stringify({ error: `pairing failed: ${error.message}` })}\n`);
			return;
		}
		if (!allowed) {
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
