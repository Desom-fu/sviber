import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { ChartModel } from "../js/core/chart-model.js";
import { withMcpInstance } from "../js/app/app-mcp-instance.js";
import { MCP_CONSENT_WARNING } from "../js/mcp/mcp-consent.js";
import { resolveMcpClientIdentity } from "../js/mcp/mcp-client-identity.js";
import { instancePidFromName, processIsAlive, pruneStaleInstanceEndpoints } from "../js/mcp/mcp-instance-directory.js";
import {
	markPairedEditor,
	pairingRecordLabel,
	pendingPairingRecords,
	readPairingRecords,
	registerPairingRecord,
	removePairingRecord,
} from "../js/mcp/mcp-pairing.js";
import { instanceSocketPath, instanceTransport, pairingRecordPath, sviberDirectory } from "../js/mcp/mcp-paths.js";
import { createSocketBackend } from "../js/mcp/mcp-socket-backend.js";
import { dispatchMcpLine, startMcpStdio } from "../js/mcp/mcp-server.js";
import { MCP_TOOL_NAMES, callMcpTool, mcpToolsListResult } from "../js/mcp/mcp-tools.js";
import { getOpenDocument, handleEditorMcpTool } from "../js/mcp/mcp-editor-handlers.js";
import { encodeWavPcm16 } from "../js/mcp/mcp-audio-snippet.js";

const TOOL_LOG = path.join(os.tmpdir(), "sviber-mcp-tools.json");
const INSTANCE_TOOLS = MCP_TOOL_NAMES.filter(name => name !== "list_instances");

function createEditorApp(options = {}) {
	const model = ChartModel.createDefault();
	const snapshots = [];
	const files = new Map(Object.entries(options.projectFiles || {}));
	const storage = new Map();
	if (options.globalMacros) {
		storage.set("sviber.macros", JSON.stringify(options.globalMacros));
	}
	return {
		model,
		mcpUndoAllowed: false,
		files: {
			projectPath: options.projectPath || "",
			chartPath: options.chartPath || "",
			listProjectFiles: async ext => [...files.keys()].filter(name => name.endsWith(ext)),
			writeProjectText: async (filename, text) => {
				files.set(filename, String(text));
			},
			readProjectText: async filename => files.get(filename) ?? null,
			renameProjectText: async (from, to) => {
				if (!files.has(from)) {
					throw new Error(`missing ${from}`);
				}
				files.set(to, files.get(from));
				files.delete(from);
			},
		},
		macroStorage: {
			getItem: key => storage.get(key) ?? null,
			setItem: (key, value) => storage.set(key, String(value)),
		},
		commit(_label, mutation) {
			snapshots.push(model.snapshot());
			mutation(model);
		},
		undo() {
			const snapshot = snapshots.pop();
			if (snapshot) {
				model.restore(snapshot);
			}
		},
		audio: options.audio || null,
		writeMusicSnippetFile: options.writeMusicSnippetFile,
	};
}

function editorBackend(app) {
	return {
		callInstance: async (_id, name, args) => handleEditorMcpTool(name, args, app),
	};
}

test("socket path is ~/.sviber/${pid}.sock and is not customizable", () => {
	assert.equal(sviberDirectory("/home/chart"), "/home/chart/.sviber");
	assert.equal(instanceSocketPath(4242, "/home/chart"), "/home/chart/.sviber/4242.sock");
	assert.equal(instanceSocketPath(7, "C:\\Users\\me"), "C:\\Users\\me\\.sviber\\7.sock");
});

test("win32 instances bind a named pipe and keep <pid>.sock as the discovery marker", () => {
	// Node implements the Windows local domain with named pipes only: binding a filesystem
	// path there fails with EACCES, which used to leave every Windows instance invisible.
	const windows = instanceTransport(4242, { platform: "win32", home: "C:\\Users\\me" });
	assert.equal(windows.kind, "pipe");
	assert.equal(windows.path, "\\\\.\\pipe\\sviber-4242");
	assert.equal(windows.markerPath, "C:\\Users\\me\\.sviber\\4242.sock");
	const linux = instanceTransport(4242, { platform: "linux", home: "/home/chart" });
	assert.equal(linux.kind, "socket");
	assert.equal(linux.path, "/home/chart/.sviber/4242.sock");
	assert.equal(linux.markerPath, null);
});

test("an instance endpoint really accepts a connection on this platform", async () => {
	const home = mkdtempSync(path.join(os.tmpdir(), "sviber-mcp-home-"));
	const pid = 424242;
	const transport = instanceTransport(pid, { home });
	mkdirSync(sviberDirectory(home), { recursive: true });
	if (transport.markerPath) {
		writeFileSync(transport.markerPath, "");
	}
	const received = [];
	const server = net.createServer(socket => {
		socket.on("data", chunk => {
			for (const line of String(chunk).split("\n").filter(Boolean)) {
				received.push(JSON.parse(line));
				socket.write(`${JSON.stringify({ result: { ok: true, pid } })}\n`);
			}
		});
	});
	await new Promise((resolve, reject) => {
		server.on("error", reject);
		server.listen(transport.path, resolve);
	});
	try {
		// The endpoint is real but the pid is invented: liveness is stubbed so discovery does
		// not sweep the entry as a phantom.
		const backend = createSocketBackend(home, { isAlive: () => true });
		const listed = backend.listInstances().instances;
		assert.deepEqual(
			listed.map(item => ({ pid: item.pid, path: item.path })),
			[{ pid, path: transport.path }],
		);
		assert.deepEqual(await backend.callInstance(String(pid), "list_macros", {}), { ok: true, pid });
		await backend.callInstance(String(pid), "get_open", {});
		assert.equal(received.length, 2);
		assert.equal(received[0].method, "list_macros");
		// One stable client id per MCP server process is what keeps the consent popup to
		// once per server rather than once per tool call.
		assert.equal(typeof received[0].client, "string");
		assert.ok(received[0].client.length > 0);
		assert.equal(received[1].client, received[0].client);
		const named = createSocketBackend(home, { clientId: "agent-7" });
		await named.callInstance(String(pid), "get_open", {});
		assert.equal(received[2].client, "agent-7");
	} finally {
		await new Promise(resolve => server.close(resolve));
		rmSync(home, { recursive: true, force: true });
	}
});

test("the editor publishes a discoverable instance and asks for consent once", async () => {
	const home = mkdtempSync(path.join(os.tmpdir(), "sviber-mcp-editor-"));
	const fs = await import("node:fs");
	const net = await import("node:net");
	const previousNw = globalThis.nw;
	// The trait only needs nw.require to hand back real modules plus a home to place the
	// endpoint in, so this exercises the shipped editor code instead of a copy of it.
	globalThis.nw = {
		require: name => {
			if (name === "fs") {
				return fs;
			}
			if (name === "net") {
				return net;
			}
			if (name === "os") {
				return { homedir: () => home };
			}
			return null;
		},
	};
	const app = new (withMcpInstance(class {}))();
	let prompts = 0;
	app.dialogs = {
		open: async () => {
			prompts += 1;
			return { button: "allow" };
		},
	};
	// What a killed editor leaves behind: an entry for a pid that cannot exist.
	const stalePath = path.join(sviberDirectory(home), "9007199254740991.sock");
	mkdirSync(sviberDirectory(home), { recursive: true });
	writeFileSync(stalePath, "");
	app._startMcpInstance();
	try {
		const transport = instanceTransport(process.pid, { home });
		const published = transport.markerPath || transport.path;
		const deadline = Date.now() + 5000;
		while (!fs.existsSync(published) && Date.now() < deadline) {
			await new Promise(resolve => setTimeout(resolve, 25));
		}
		assert.ok(fs.existsSync(published), `instance endpoint was not published at ${published}`);
		assert.equal(fs.existsSync(stalePath), false, "a starting editor prunes endpoints of dead processes");
		const backend = createSocketBackend(home);
		assert.deepEqual(backend.listInstances().instances.map(item => item.pid), [process.pid]);
		// A real request over the real endpoint reaching the real editor handler.
		const opened = { kind: "none", path: "" };
		assert.deepEqual(await backend.callInstance(String(process.pid), "get_open", {}), opened);
		assert.deepEqual(await backend.callInstance(String(process.pid), "get_open", {}), opened);
		assert.equal(prompts, 1, "consent is asked once per MCP server, not once per call");
		app._stopMcpInstance();
		assert.equal(fs.existsSync(published), false, "stopping the editor unpublishes the endpoint");
	} finally {
		app._stopMcpInstance();
		globalThis.nw = previousNw;
		rmSync(home, { recursive: true, force: true });
	}
});

test("a starting editor prunes instance entries whose process is gone", () => {
	const home = mkdtempSync(path.join(os.tmpdir(), "sviber-mcp-prune-"));
	const directory = sviberDirectory(home);
	mkdirSync(directory, { recursive: true });
	for (const name of ["11.sock", "22.sock", "33.sock", "not-a-pid.sock", "readme.txt"]) {
		writeFileSync(path.join(directory, name), "");
	}
	try {
		assert.equal(instancePidFromName("11.sock"), 11);
		assert.equal(instancePidFromName("11.txt"), 0);
		assert.equal(instancePidFromName("0.sock"), 0);
		assert.equal(instancePidFromName("-3.sock"), 0);
		assert.equal(processIsAlive(process.pid), true);
		const removed = pruneStaleInstanceEndpoints({
			fs: { readdirSync, unlinkSync },
			directory,
			isAlive: pid => pid === 11,
			keepPid: 22,
		});
		assert.deepEqual(removed, ["33.sock"]);
		assert.deepEqual(readdirSync(directory).sort(), ["11.sock", "22.sock", "not-a-pid.sock", "readme.txt"]);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("pairing announcements record which editor instance paired", () => {
	const home = mkdtempSync(path.join(os.tmpdir(), "sviber-mcp-pairing-"));
	const nodeFs = { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync };
	try {
		const registered = registerPairingRecord({
			fs: nodeFs,
			home,
			id: "client one",
			name: "sviber-mcp",
			pid: process.pid,
		});
		assert.equal(registered, pairingRecordPath("client one", home));
		let records = readPairingRecords({ fs: nodeFs, home });
		assert.equal(records.length, 1);
		// The id becomes a file name, so unsafe characters are folded away.
		assert.equal(records[0].id, "client one");
		assert.ok(existsSync(pairingRecordPath("client one", home)));
		assert.deepEqual(records[0].pairedWith, []);
		assert.deepEqual(pendingPairingRecords({ records }).map(item => item.id), ["client one"]);
		// Marking the same instance twice stays one entry: a pairing is per editor instance.
		markPairedEditor({ fs: nodeFs, home, clientId: "client one", pid: 63280, chart: "NIGHTMARE † CITY" });
		markPairedEditor({ fs: nodeFs, home, clientId: "client one", pid: 63280, chart: "NIGHTMARE † CITY" });
		records = readPairingRecords({ fs: nodeFs, home });
		assert.deepEqual(records[0].pairedWith, [{ pid: 63280, chart: "NIGHTMARE † CITY" }]);
		// Answered clients are not offered again in the same run.
		assert.deepEqual(pendingPairingRecords({ records, decidedIds: ["client one"] }), []);
		// A second server running beside the first announces under its own identity: neither
		// announcement overwrites the other, so pairing with one never breaks the other.
		registerPairingRecord({ fs: nodeFs, home, id: "client two", name: "sviber-mcp", pid: process.pid });
		const both = readPairingRecords({ fs: nodeFs, home });
		assert.equal(both.length, 2);
		const stillPending = pendingPairingRecords({ records: both, decidedIds: ["client one"] });
		assert.deepEqual(stillPending.map(item => item.id), ["client two"]);
		const firstRecord = both.find(item => item.id === "client one");
		assert.deepEqual(firstRecord.pairedWith, [{ pid: 63280, chart: "NIGHTMARE † CITY" }]);
		// A second editor instance pairs on its own and is recorded beside the first.
		markPairedEditor({ fs: nodeFs, home, clientId: "client one", pid: 63281, chart: "other chart" });
		records = readPairingRecords({ fs: nodeFs, home });
		assert.deepEqual(
			records.find(item => item.id === "client one").pairedWith.map(entry => entry.pid),
			[63280, 63281],
		);
		assert.equal(records.find(item => item.id === "client one").pairedWith[0].chart, "NIGHTMARE † CITY");
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("list_instances shows which editor instance a client paired with", () => {
	const home = mkdtempSync(path.join(os.tmpdir(), "sviber-mcp-listed-"));
	const nodeFs = { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync };
	try {
		const backend = createSocketBackend(home, {
			clientId: "client one",
			clientName: "sviber-mcp",
			isAlive: () => true,
		});
		mkdirSync(sviberDirectory(home), { recursive: true });
		writeFileSync(path.join(sviberDirectory(home), "63280.sock"), "");
		const instances = () => backend.listInstances().instances;
		assert.equal(instances().length, 1);
		assert.deepEqual(instances()[0].pairedWith, []);
		registerPairingRecord({ fs: nodeFs, home, id: "client one", name: "sviber-mcp", pid: process.pid });
		markPairedEditor({ fs: nodeFs, home, clientId: "client one", pid: 63280, chart: "NIGHTMARE † CITY" });
		const listed = instances()[0];
		assert.equal(listed.pid, 63280);
		assert.deepEqual(listed.pairedWith, [{ id: "client one", name: "sviber-mcp" }]);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("list_instances sweeps markers of dead editors instead of advertising phantoms", () => {
	const home = mkdtempSync(path.join(os.tmpdir(), "sviber-mcp-ghost-"));
	try {
		const directory = sviberDirectory(home);
		mkdirSync(directory, { recursive: true });
		// What a force-killed editor leaves behind, beside a live instance's marker.
		writeFileSync(path.join(directory, "13952.sock"), "");
		writeFileSync(path.join(directory, "63280.sock"), "");
		const alive = pid => pid === 63280;
		const backend = createSocketBackend(home, { isAlive: alive });
		assert.deepEqual(
			backend.listInstances().instances.map(item => item.pid),
			[63280],
			"a dead editor's marker is not listed as an instance",
		);
		// The sweep deletes the dead marker at discovery time: the phantom disappears even
		// when no editor ever starts again to run the startup prune.
		assert.equal(existsSync(path.join(directory, "13952.sock")), false, "the phantom marker is swept");
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("each MCP server run pairs under its own identity unless one is pinned", () => {
	const first = resolveMcpClientIdentity({ env: {} });
	const second = resolveMcpClientIdentity({ env: {} });
	assert.notEqual(first.id, second.id, "side-by-side servers must not share an announcement");
	assert.equal(first.name, "sviber-mcp");
	const fromEnv = resolveMcpClientIdentity({ env: { SVIBER_MCP_CLIENT_ID: "given" } });
	assert.equal(fromEnv.id, "given");
	assert.equal(resolveMcpClientIdentity({ env: {}, clientName: "agent" }).name, "agent");
	assert.equal(resolveMcpClientIdentity({ env: {}, clientId: "explicit" }).id, "explicit");
});

test("starting the stdio server announces itself and stops cleanly", async () => {
	const home = mkdtempSync(path.join(os.tmpdir(), "sviber-mcp-announce-"));
	const stdin = new EventEmitter();
	stdin.setEncoding = () => {};
	const stdout = { write: () => true };
	let started;
	try {
		started = startMcpStdio({ home, stdin, stdout, clientId: "stdio-announcer", clientName: "sviber-mcp" });
		assert.equal(started.backend.clientId, "stdio-announcer");
		const records = readPairingRecords({ fs: { readFileSync, readdirSync }, home });
		assert.deepEqual(
			records.map(record => ({ id: record.id, name: record.name, pid: record.pid })),
			[{ id: "stdio-announcer", name: "sviber-mcp", pid: process.pid }],
		);
		// Stopping withdraws the announcement and releases the directory watcher, which is what
		// used to keep the server process alive after its client went away.
		started.stop();
		assert.equal(existsSync(pairingRecordPath("stdio-announcer", home)), false, "announcement withdrawn");
	} finally {
		started?.stop();
		rmSync(home, { recursive: true, force: true });
	}
});

test("a starting editor offers to pair an announcing server before any request", async () => {
	const home = mkdtempSync(path.join(os.tmpdir(), "sviber-mcp-announced-"));
	const fs = await import("node:fs");
	const net = await import("node:net");
	const { spawn } = await import("node:child_process");
	// Stand-in MCP servers: live processes, so pid liveness can be tested for real.
	const servers = [];
	const startServer = () => {
		const server = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)"], { stdio: "ignore" });
		servers.push(server);
		return server;
	};
	const isDead = async pid => {
		const deadline = Date.now() + 5000;
		while (processIsAlive(pid) && Date.now() < deadline) {
			await new Promise(resolve => setTimeout(resolve, 25));
		}
		return !processIsAlive(pid);
	};
	const previousNw = globalThis.nw;
	globalThis.nw = {
		require: name => {
			if (name === "fs") {
				return fs;
			}
			if (name === "net") {
				return net;
			}
			if (name === "os") {
				return { homedir: () => home };
			}
			return null;
		},
	};
	// The server announced itself before the editor started, so no tool call is involved.
	// Pairing only needs the directory half, not the socket: the pipe name is derived from this
	// process and another test in the same run already bound it.
	const server = startServer();
	registerPairingRecord({ fs, home, id: "announced-client", name: "sviber-mcp", pid: server.pid });
	const app = new (withMcpInstance(class {}))();
	const dialogs = [];
	const toasts = [];
	app.dialogs = {
		open: async options => {
			dialogs.push(options);
			return { button: "allow" };
		},
	};
	app.toast = {
		show: (key, params) => toasts.push([key, params]),
	};
	app._mcpFs = fs;
	app._startMcpPairing(fs);
	try {
		const deadline = Date.now() + 5000;
		let pairedWith = [];
		while (pairedWith.length === 0 && Date.now() < deadline) {
			pairedWith = readPairingRecords({ fs, home })[0]?.pairedWith || [];
			if (pairedWith.length === 0) {
				await new Promise(resolve => setTimeout(resolve, 25));
			}
		}
		assert.equal(dialogs.length, 1, "pairing is offered at startup, without any request");
		// The pairing is per run and per editor instance: recorded on the announcement, not on disk.
		assert.deepEqual(pairedWith, [{ pid: process.pid, chart: "" }]);
		assert.ok(app._mcpDecidedClients.has("announced-client"));
		assert.deepEqual(app._mcpPairedServerPids.get("announced-client"), server.pid);
		assert.deepEqual(toasts[0], ["toast.mcpPaired", { clients: "sviber-mcp (announced-client)" }]);
		// Once paired, the editor stops offering the same client in this run.
		await app._offerMcpPairing();
		assert.equal(dialogs.length, 1);
		// The MCP server closes: its announcement disappears, so the pairing is broken and the
		// editor tells the user instead of silently keeping a dead pairing.
		removePairingRecord({ fs, home, id: "announced-client" });
		await app._offerMcpPairing();
		assert.equal(app._mcpDecidedClients.has("announced-client"), false, "a closed server unpairs");
		const lostLabel = "sviber-mcp (announced-client)";
		assert.deepEqual(toasts[toasts.length - 1], ["toast.mcpPairingLost", { clients: lostLabel }]);
		// ...and when the server opens again — same client id, new process — the editor pairs once
		// more instead of recognizing the id.
		const restarted = startServer();
		registerPairingRecord({ fs, home, id: "announced-client", name: "sviber-mcp", pid: restarted.pid });
		await app._offerMcpPairing();
		assert.equal(dialogs.length, 2, "a reopened server is offered again");
		assert.deepEqual(app._mcpPairedServerPids.get("announced-client"), restarted.pid);
		assert.equal(toasts.filter(([key]) => key === "toast.mcpPaired").length, 2);
		// A server that dies hard cannot withdraw its announcement: the dead pid is what breaks it.
		restarted.kill();
		assert.ok(await isDead(restarted.pid), "the stand-in server exited");
		registerPairingRecord({ fs, home, id: "announced-client", name: "sviber-mcp", pid: restarted.pid });
		await app._offerMcpPairing();
		assert.equal(app._mcpDecidedClients.has("announced-client"), false, "a dead server pid unpairs");
		assert.equal(toasts[toasts.length - 1][0], "toast.mcpPairingLost");
	} finally {
		for (const process_ of servers.splice(0)) {
			process_.kill();
		}
		app._stopMcpInstance();
		globalThis.nw = previousNw;
		rmSync(home, { recursive: true, force: true });
	}
});

test("a request waits for an open pairing dialog instead of failing", async () => {
	const home = mkdtempSync(path.join(os.tmpdir(), "sviber-mcp-wait-"));
	const fs = await import("node:fs");
	const net = await import("node:net");
	const previousNw = globalThis.nw;
	globalThis.nw = {
		require: name => {
			if (name === "fs") {
				return fs;
			}
			if (name === "net") {
				return net;
			}
			if (name === "os") {
				return { homedir: () => home };
			}
			return null;
		},
	};
	registerPairingRecord({ fs, home, id: "announced-client", name: "sviber-mcp", pid: process.pid });
	const app = new (withMcpInstance(class {}))();
	const dialogs = [];
	let answer = null;
	app.dialogs = {
		active: false,
		open: async options => {
			dialogs.push(options);
			app.dialogs.active = true;
			const result = await new Promise(resolve => {
				answer = resolve;
			});
			app.dialogs.active = false;
			return result;
		},
	};
	app.toast = {
		show: () => {},
	};
	app._mcpFs = fs;
	app._startMcpPairing(fs);
	try {
		const deadline = Date.now() + 5000;
		while (dialogs.length === 0 && Date.now() < deadline) {
			await new Promise(resolve => setTimeout(resolve, 25));
		}
		assert.equal(dialogs.length, 1, "the startup offer is on screen");
		// A tool call arrives while the offer is unanswered: it must wait for the user, and it
		// must not open a second dialog on top of the first one.
		const pendingAllowed = app._mcpClientAllowed("announced-client", "sviber-mcp");
		await new Promise(resolve => setTimeout(resolve, 400));
		assert.equal(dialogs.length, 1, "no second dialog while the offer is open");
		answer({ button: "allow" });
		assert.equal(await pendingAllowed, true, "the call succeeds once the offer is answered");
		assert.deepEqual(readPairingRecords({ fs, home })[0]?.pairedWith, [{ pid: process.pid, chart: "" }]);
	} finally {
		app._stopMcpInstance();
		globalThis.nw = previousNw;
		rmSync(home, { recursive: true, force: true });
	}
});

	// PROMPT-v26: several MCP servers may run at the same time and each one is connected to all
	// sviber instances, so a second server gets its own prompt and its own pairing beside the
	// first — neither announcement overwrites the other (per-run client identities).
	test("a second server is offered its own pairing beside the first", async () => {
		const home = mkdtempSync(path.join(os.tmpdir(), "sviber-mcp-two-"));
		const fs = await import("node:fs");
		const net = await import("node:net");
		const previousNw = globalThis.nw;
		globalThis.nw = {
			require: name => {
				if (name === "fs") {
					return fs;
				}
				if (name === "net") {
					return net;
				}
				if (name === "os") {
					return { homedir: () => home };
				}
				return null;
			},
		};
		registerPairingRecord({ fs, home, id: "first-client", name: "sviber-mcp", pid: process.pid });
		const app = new (withMcpInstance(class {}))();
		const dialogs = [];
		let answer = null;
		app.dialogs = {
			active: false,
			open: async options => {
				dialogs.push(options);
				app.dialogs.active = true;
				const result = await new Promise(resolve => {
					answer = resolve;
				});
				app.dialogs.active = false;
				return result;
			},
		};
		app.toast = {
			show: () => {},
		};
		app._mcpFs = fs;
		app._startMcpPairing(fs);
		try {
			const deadline = Date.now() + 5000;
			while (dialogs.length === 0 && Date.now() < deadline) {
				await new Promise(resolve => setTimeout(resolve, 25));
			}
			assert.equal(dialogs.length, 1);
			answer({ button: "allow" });
			await new Promise(resolve => setTimeout(resolve, 100));
			assert.deepEqual(app._mcpPairedServerPids.get("first-client"), process.pid);
			// The second server announces beside the first and pairs on its own.
			registerPairingRecord({ fs, home, id: "second-client", name: "sviber-mcp", pid: process.pid });
			const secondOffer = app._offerMcpPairing();
			const secondDeadline = Date.now() + 5000;
			while (dialogs.length < 2 && Date.now() < secondDeadline) {
				await new Promise(resolve => setTimeout(resolve, 25));
			}
			assert.equal(dialogs.length, 2, "the second server gets its own prompt");
			answer({ button: "allow" });
			await secondOffer;
			assert.deepEqual(app._mcpPairedServerPids.get("second-client"), process.pid);
			assert.ok(app._mcpDecidedClients.has("first-client"), "the first pairing still holds");
			const records = readPairingRecords({ fs, home });
			assert.equal(records.length, 2);
			for (const record of records) {
				assert.deepEqual(record.pairedWith, [{ pid: process.pid, chart: "" }]);
			}
		} finally {
			app._stopMcpInstance();
			globalThis.nw = previousNw;
			rmSync(home, { recursive: true, force: true });
		}
	});

test("two servers announced together are decided on separate dialogs", async () => {
	const home = mkdtempSync(path.join(os.tmpdir(), "sviber-mcp-separate-"));
	const fs = await import("node:fs");
	const net = await import("node:net");
	const previousNw = globalThis.nw;
	globalThis.nw = {
		require: name => {
			if (name === "fs") {
				return fs;
			}
			if (name === "net") {
				return net;
			}
			if (name === "os") {
				return { homedir: () => home };
			}
			return null;
		},
	};
	// Both servers announce before the editor starts: the offer loop must ask for each of
	// them on its own dialog instead of batching both names into one combined decision.
	registerPairingRecord({ fs, home, id: "first-client", name: "sviber-mcp", pid: process.pid });
	registerPairingRecord({ fs, home, id: "second-client", name: "sviber-mcp", pid: process.pid });
	const app = new (withMcpInstance(class {}))();
	const dialogs = [];
	app.dialogs = {
		open: async options => {
			dialogs.push(options);
			// Allow the first prompt, deny the second: the two decisions must land separately.
			return { button: dialogs.length === 1 ? "allow" : "deny" };
		},
	};
	app.toast = {
		show: () => {},
	};
	app._mcpFs = fs;
	app._startMcpPairing(fs);
	try {
		const deadline = Date.now() + 5000;
		while (dialogs.length < 2 && Date.now() < deadline) {
			await new Promise(resolve => setTimeout(resolve, 25));
		}
		await new Promise(resolve => setTimeout(resolve, 100));
		assert.equal(dialogs.length, 2, "each announced server is asked on its own dialog");
		const pairedId = ["first-client", "second-client"].find(id => app._mcpPairedServerPids.has(id));
		const deniedId = pairedId === "first-client" ? "second-client" : "first-client";
		assert.ok(pairedId, "the allowed prompt pairs only its own client");
		assert.ok(app._mcpDeniedClients.has(deniedId), "the denied prompt does not leak an allow");
		const records = readPairingRecords({ fs, home });
		for (const record of records) {
			if (record.id === pairedId) {
				assert.deepEqual(record.pairedWith, [{ pid: process.pid, chart: "" }]);
			} else {
				assert.deepEqual(record.pairedWith, [], "the denied server stays unpaired");
			}
		}
		// Both clients are decided now, so nothing prompts again in this run.
		await app._offerMcpPairing();
		assert.equal(dialogs.length, 2);
	} finally {
		app._stopMcpInstance();
		globalThis.nw = previousNw;
		rmSync(home, { recursive: true, force: true });
	}
});

test("consent warning tells the user allowing makes undoable external edits possible", () => {
	assert.match(MCP_CONSENT_WARNING, /undoable modifications/);
	assert.match(MCP_CONSENT_WARNING, /outside the editor/);
});

test("MCP JSON-RPC initialize then tools/list exposes the v26 tools", async () => {
	const backend = {
		listInstances: () => ({ instances: [{ id: "1", pid: 1, path: "/tmp/.sviber/1.sock" }] }),
		callInstance: async (_id, name) => ({ ok: true, tool: name }),
	};
	const init = await dispatchMcpLine(
		JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
		backend,
		"0.17.1",
	);
	assert.equal(init.result.serverInfo.name, "sviber-mcp");
	assert.equal(init.result.serverInfo.version, "0.17.1");
	const listed = await dispatchMcpLine(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }), backend);
	const names = listed.result.tools.map(tool => tool.name);
	for (const name of MCP_TOOL_NAMES) {
		assert.ok(names.includes(name), name);
	}
	const called = await dispatchMcpLine(
		JSON.stringify({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "list_instances", arguments: {} },
		}),
		backend,
	);
	assert.match(called.result.content[0].text, /instances/);
	await mkdir(path.dirname(TOOL_LOG), { recursive: true });
	await writeFile(TOOL_LOG, JSON.stringify(mcpToolsListResult(), null, "\t"));
});

test("tools/call get_open returns chart or project path from the editor", async () => {
	const app = createEditorApp({ projectPath: "/charts/song" });
	const open = await handleEditorMcpTool("get_open", {}, app);
	assert.equal(open.kind, "project");
	assert.equal(open.path, "/charts/song");
	assert.deepEqual(getOpenDocument(app), open);
	const value = await callMcpTool("get_open", { instance: "9" }, editorBackend(app));
	assert.equal(value.kind, "project");
	assert.equal(value.path, "/charts/song");
});

test("music snippet encoder writes a WAV header", () => {
	const wav = encodeWavPcm16(new Float32Array([0, 0.5, -0.5]), 44100);
	assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
	assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
});

test("editor socket dispatches every instance tool through handleEditorMcpTool", async () => {
	const source = await readFile(new URL("../js/app/app-mcp-instance.js", import.meta.url), "utf8");
	assert.match(source, /handleEditorMcpTool\(message\.method, message\.arguments \|\| \{\}, this\)/);
	assert.doesNotMatch(source, /handleMcpTool/);
	assert.match(source, /writeMusicSnippetFile/);
	// The endpoint must come from instanceTransport: binding the raw `.sock` path directly
	// fails on Windows, which is what left every packaged instance invisible to MCP.
	assert.match(source, /instanceTransport\(pid\)/);
	assert.match(source, /server\.listen\(transport\.path\)/);
	assert.match(source, /writeFileSync\(transport\.markerPath/);
	// Pairing is offered from the announcement (startup scan or directory watcher), and a
	// request only prompts for a client that never announced itself.
	assert.match(source, /_offerMcpPairing\(\)/);
	assert.match(source, /fs\.watch\(pairingDirectory\(\)/);
	assert.match(source, /_mcpClientAllowed\(message\.client, message\.clientName\)/);
	// The old per-window allowance store is gone: pairing is per run, not persisted.
	assert.doesNotMatch(source, /_mcpPairedClients|paired\.json/);
	assert.match(source, /dialog\.mcpPairingPending/);
	assert.match(source, /dialog\.mcpPairingInstance/);
	// Pairing and break-ups are visible: toasts in the editor, pairing in the server log.
	assert.match(source, /toast\.mcpPaired/);
	assert.match(source, /toast\.mcpPairingLost/);
	// Each pending client is decided on its own dialog: allowing one server never answers
	// for another one announced beside it (no batched prompts).
	assert.match(source, /_confirmMcpPairing\(\[record\]\)/);
	assert.doesNotMatch(source, /_confirmMcpPairing\(pending\)/);
	const app = createEditorApp();
	for (const name of INSTANCE_TOOLS) {
		try {
			await handleEditorMcpTool(name, {}, app);
		} catch (error) {
			assert.notEqual(error.message, `unsupported tool: ${name}`, name);
		}
	}
	await assert.rejects(() => handleEditorMcpTool("nope", {}, app), /unsupported tool: nope/);
});

test("handleEditorMcpTool creates, reads, renames, and edits global and project macros", async () => {
	const app = createEditorApp({ projectPath: "/charts/song" });
	await handleEditorMcpTool("create_macro", {
		name: "greet",
		code: "console.log('hi')",
		language: "javascript",
	}, app);
	await handleEditorMcpTool("create_macro", {
		name: "local",
		code: "console.log('proj')",
		scope: "project",
	}, app);
	const listed = await handleEditorMcpTool("list_macros", {}, app);
	assert.deepEqual(listed.global.map(item => item.name), ["greet"]);
	assert.deepEqual(listed.project.map(item => item.name), ["local"]);
	const globalRead = await handleEditorMcpTool("read_macro", { name: "greet" }, app);
	assert.equal(globalRead.code, "console.log('hi')");
	assert.equal(globalRead.scope, "global");
	const projectRead = await handleEditorMcpTool("read_macro", { name: "local" }, app);
	assert.equal(projectRead.code, "console.log('proj')");
	assert.equal(projectRead.filename, "local.js");
	await handleEditorMcpTool("rename_macro", { name: "greet", newName: "hello" }, app);
	await handleEditorMcpTool("rename_macro", { name: "local", newName: "project-local" }, app);
	await handleEditorMcpTool("edit_macro", { name: "hello", code: "console.log('hello')" }, app);
	await handleEditorMcpTool("edit_macro", { name: "project-local", code: "console.log('edited')" }, app);
	const after = await handleEditorMcpTool("list_macros", {}, app);
	assert.deepEqual(after.global.map(item => item.name), ["hello"]);
	assert.deepEqual(after.project.map(item => item.filename), ["project-local.js"]);
	const hello = await handleEditorMcpTool("read_macro", { name: "hello" }, app);
	const project = await handleEditorMcpTool("read_macro", { name: "project-local" }, app);
	assert.equal(hello.code, "console.log('hello')");
	assert.equal(project.code, "console.log('edited')");
});

test("handleEditorMcpTool run_snippet mutates the chart and undo_last_run restores it", async () => {
	const app = createEditorApp();
	const ran = await handleEditorMcpTool("run_snippet", { code: 't(l(0, 0), "hello")' }, app);
	assert.equal(ran.modified, true);
	assert.equal(app.model.events.length, 1);
	assert.equal(app.model.events[0].type, "tap");
	assert.equal(app.model.events[0].text, "hello");
	const undone = await handleEditorMcpTool("undo_last_run", {}, app);
	assert.equal(undone.undone, true);
	assert.equal(app.model.events.length, 0);
	await assert.rejects(() => handleEditorMcpTool("undo_last_run", {}, app), /no MCP-initiated/);
});

test("handleEditorMcpTool run_macro and run_expression use the shipped macro API", async () => {
	const app = createEditorApp();
	await handleEditorMcpTool("create_macro", {
		name: "place",
		code: 't(l(1, 2), "from-macro")',
	}, app);
	const ran = await handleEditorMcpTool("run_macro", { name: "place" }, app);
	assert.equal(ran.modified, true);
	assert.equal(app.model.events[0].text, "from-macro");
	assert.equal(app.model.events[0].x, 1);
	assert.equal(app.model.events[0].y, 2);
	const expression = await handleEditorMcpTool("run_expression", { code: "1+2" }, app);
	assert.equal(expression.value, 3);
	assert.equal(expression.modified, false);
	const ruby = await handleEditorMcpTool("run_snippet", {
		code: 't(l(1, 2), "from-ruby")\nputs "ruby-ok"',
		language: "ruby",
	}, app);
	assert.equal(ruby.modified, true);
	assert.match(ruby.stdout, /ruby-ok/);
	assert.equal(app.model.events.at(-1).text, "from-ruby");
	const rubyExpr = await handleEditorMcpTool("run_expression", {
		code: "1 + 2",
		language: "ruby",
	}, app);
	assert.equal(rubyExpr.value, 3);
	assert.equal(rubyExpr.modified, false);
});

test("handleEditorMcpTool get_music_snippet writes a local path when the WAV exceeds 256KB", async () => {
	const sampleCount = 200000;
	const written = [];
	const audio = { waveform: { channels: [new Float32Array(sampleCount)], sampleRate: 44100 } };
	const small = await handleEditorMcpTool("get_music_snippet", { start: 0, end: 0 }, createEditorApp({
		audio,
	}));
	assert.equal(small.encoding, "base64");
	assert.equal(String.fromCharCode(...Buffer.from(small.data, "base64").slice(0, 4)), "RIFF");
	await assert.rejects(
		() => handleEditorMcpTool("get_music_snippet", { start: 0, end: 20 }, createEditorApp({ audio })),
		/local file writer/,
	);
	const app = createEditorApp({
		audio,
		writeMusicSnippetFile(bytes) {
			written.push(bytes);
			return "C:\\Users\\me\\.sviber\\snippet-test.wav";
		},
	});
	const large = await handleEditorMcpTool("get_music_snippet", { start: 0, end: 20 }, app);
	assert.equal(large.encoding, "path");
	assert.equal(large.path, "C:\\Users\\me\\.sviber\\snippet-test.wav");
	assert.equal(written[0].length, 44 + sampleCount * 2);
	assert.ok(written[0].length > 256 * 1024);
});

test("stdio tools/call run_snippet reaches handleEditorMcpTool", async () => {
	const app = createEditorApp();
	const called = await dispatchMcpLine(JSON.stringify({
		jsonrpc: "2.0",
		id: 4,
		method: "tools/call",
		params: { name: "run_snippet", arguments: { instance: "1", code: 't(l(0, 0), "via-rpc")' } },
	}), editorBackend(app));
	assert.match(called.result.content[0].text, /"modified":true/);
	assert.equal(app.model.events[0].text, "via-rpc");
});
