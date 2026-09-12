import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";

import { ChartModel } from "../js/core/chart-model.js";
import { MCP_CONSENT_WARNING } from "../js/mcp/mcp-consent.js";
import { instanceSocketPath, sviberDirectory } from "../js/mcp/mcp-paths.js";
import { dispatchMcpLine } from "../js/mcp/mcp-server.js";
import { MCP_TOOL_NAMES, callMcpTool, mcpToolsListResult } from "../js/mcp/mcp-tools.js";
import { getOpenDocument, handleEditorMcpTool } from "../js/mcp/mcp-editor-handlers.js";
import { encodeWavPcm16 } from "../js/mcp/mcp-audio-snippet.js";

const TOOL_LOG = "C:\\Users\\ADMINI~1\\AppData\\Local\\Temp\\grok-goal-430012d88547\\implementer\\mcp-tools.json";
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
		"0.17.0",
	);
	assert.equal(init.result.serverInfo.name, "sviber-mcp");
	assert.equal(init.result.serverInfo.version, "0.17.0");
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
	await assert.rejects(
		() => handleEditorMcpTool("run_snippet", { code: "puts 1", language: "ruby" }, app),
		/live editor sandbox/,
	);
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
