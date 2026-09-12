// MCP tool catalogue and dispatcher (PROMPT-v26). Handlers talk to a backend so tests
// can drive the same functions the stdio server uses without NW.js.

export const MCP_TOOL_NAMES = Object.freeze([
	"list_instances",
	"get_open",
	"list_macros",
	"read_macro",
	"create_macro",
	"rename_macro",
	"edit_macro",
	"run_macro",
	"run_snippet",
	"run_expression",
	"undo_last_run",
	"get_music_snippet",
]);

const INSTANCE_TOOLS = new Set(MCP_TOOL_NAMES.filter(name => name !== "list_instances"));

function tool(name, description, properties, required = []) {
	return {
		name,
		description,
		inputSchema: {
			type: "object",
			properties,
			required,
			additionalProperties: false,
		},
	};
}

const instanceProperty = { instance: { type: "string", description: "sviber instance pid" } };

export function mcpToolDefinitions() {
	return [
		tool("list_instances", "List running sviber editor instances.", {}),
		tool("get_open", "Get whether a chart or project is open and its local path.", instanceProperty, [
			"instance",
		]),
		tool("list_macros", "List global and project macros.", instanceProperty, ["instance"]),
		tool("read_macro", "Read a macro by name.", { ...instanceProperty, name: { type: "string" } }, [
			"instance",
			"name",
		]),
		tool("create_macro", "Create a global or project macro.", {
			...instanceProperty,
			name: { type: "string" },
			code: { type: "string" },
			scope: { type: "string", enum: ["global", "project"] },
		}, ["instance", "name", "code"]),
		tool("rename_macro", "Rename a macro.", {
			...instanceProperty,
			name: { type: "string" },
			newName: { type: "string" },
		}, ["instance", "name", "newName"]),
		tool("edit_macro", "Replace a macro's source.", {
			...instanceProperty,
			name: { type: "string" },
			code: { type: "string" },
		}, ["instance", "name", "code"]),
		tool("run_macro", "Run a named macro and return stdout and stderr.", {
			...instanceProperty,
			name: { type: "string" },
		}, ["instance", "name"]),
		tool("run_snippet", "Run a macro code snippet and return stdout and stderr.", {
			...instanceProperty,
			code: { type: "string" },
			language: { type: "string" },
		}, ["instance", "code"]),
		tool("run_expression", "Run a macro expression and return the JSON value.", {
			...instanceProperty,
			code: { type: "string" },
			language: { type: "string" },
		}, ["instance", "code"]),
		tool("undo_last_run", "Undo the last MCP-initiated modifying macro run.", instanceProperty, [
			"instance",
		]),
		tool("get_music_snippet", "Get music between two beat times as base64 or a local path.", {
			...instanceProperty,
			start: { type: "string" },
			end: { type: "string" },
		}, ["instance", "start", "end"]),
	];
}

export function mcpToolsListResult() {
	return { tools: mcpToolDefinitions() };
}

function requireInstance(args) {
	const instance = String(args?.instance ?? "").trim();
	if (!instance) {
		throw new Error("instance is required");
	}
	return instance;
}

async function callInstance(backend, name, args) {
	if (typeof backend.callInstance !== "function") {
		throw new Error("no editor instance backend");
	}
	return backend.callInstance(requireInstance(args), name, args);
}

const HANDLERS = {
	async list_instances(_args, backend) {
		if (typeof backend.listInstances === "function") {
			return backend.listInstances();
		}
		return { instances: [] };
	},
	get_open: (args, backend) => callInstance(backend, "get_open", args),
	list_macros: (args, backend) => callInstance(backend, "list_macros", args),
	read_macro: (args, backend) => callInstance(backend, "read_macro", args),
	create_macro: (args, backend) => callInstance(backend, "create_macro", args),
	rename_macro: (args, backend) => callInstance(backend, "rename_macro", args),
	edit_macro: (args, backend) => callInstance(backend, "edit_macro", args),
	run_macro: (args, backend) => callInstance(backend, "run_macro", args),
	run_snippet: (args, backend) => callInstance(backend, "run_snippet", args),
	run_expression: (args, backend) => callInstance(backend, "run_expression", args),
	undo_last_run: (args, backend) => callInstance(backend, "undo_last_run", args),
	get_music_snippet: (args, backend) => callInstance(backend, "get_music_snippet", args),
};

export async function callMcpTool(name, args = {}, backend = {}) {
	const handler = HANDLERS[name];
	if (!handler) {
		throw new Error(`unknown tool: ${name}`);
	}
	if (INSTANCE_TOOLS.has(name)) {
		requireInstance(args);
	}
	return handler(args, backend);
}

export function toolCallContent(value) {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return { content: [{ type: "text", text }] };
}
