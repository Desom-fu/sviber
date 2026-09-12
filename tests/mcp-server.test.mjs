import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";

import { MCP_CONSENT_WARNING } from "../js/mcp/mcp-consent.js";
import { instanceSocketPath, sviberDirectory } from "../js/mcp/mcp-paths.js";
import { dispatchMcpLine } from "../js/mcp/mcp-server.js";
import { MCP_TOOL_NAMES, callMcpTool, mcpToolsListResult } from "../js/mcp/mcp-tools.js";
import { getOpenDocument } from "../js/mcp/mcp-editor-handlers.js";
import { encodeWavPcm16 } from "../js/mcp/mcp-audio-snippet.js";

const TOOL_LOG = "C:\\Users\\ADMINI~1\\AppData\\Local\\Temp\\grok-goal-430012d88547\\implementer\\mcp-tools.json";

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
	const open = getOpenDocument({ files: { projectPath: "/charts/song", chartPath: "" } });
	assert.equal(open.kind, "project");
	assert.equal(open.path, "/charts/song");
	const value = await callMcpTool("get_open", { instance: "9" }, {
		callInstance: async (instance, name) => {
			assert.equal(instance, "9");
			assert.equal(name, "get_open");
			return open;
		},
	});
	assert.equal(value.kind, "project");
});

test("music snippet encoder writes a WAV header", () => {
	const wav = encodeWavPcm16(new Float32Array([0, 0.5, -0.5]), 44100);
	assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
	assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
});
