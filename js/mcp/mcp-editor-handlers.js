// Instance-side MCP tool handlers. Tests and the editor socket both call handleEditorMcpTool.

import { describeMacro, listGlobalMacros, listProjectMacros, storageOf } from "./mcp-macro-store.js";
import { getOpenDocument } from "./mcp-open-snippet.js";
import {
	findMacro,
	handleCreateMacro,
	handleEditMacro,
	handleMusicSnippet,
	handleRenameMacro,
	handleRunExpression,
	handleRunMacro,
	handleRunSnippet,
	handleUndoLastRun,
} from "./mcp-editor-tools.js";

export { getOpenDocument, musicSnippetFromChannels } from "./mcp-open-snippet.js";

const HANDLERS = {
	get_open: (_args, app) => getOpenDocument(app),
	list_macros: handleListMacros,
	read_macro: handleReadMacro,
	create_macro: handleCreateMacro,
	rename_macro: handleRenameMacro,
	edit_macro: handleEditMacro,
	run_macro: handleRunMacro,
	run_snippet: handleRunSnippet,
	run_expression: handleRunExpression,
	undo_last_run: handleUndoLastRun,
	get_music_snippet: handleMusicSnippet,
};

export async function handleEditorMcpTool(name, args, app) {
	const handler = HANDLERS[name];
	if (!handler) {
		throw new Error(`unsupported tool: ${name}`);
	}
	return handler(args || {}, app);
}

async function handleListMacros(_args, app) {
	const project = await listProjectMacros(app);
	return {
		global: listGlobalMacros(storageOf(app)).map(describeMacro),
		project: project.map(describeMacro),
	};
}

async function handleReadMacro(args, app) {
	const found = await findMacro(app, args.name);
	if (!found) {
		throw new Error(`macro not found: ${args.name}`);
	}
	let code = found.content;
	if (found.scope === "project") {
		code = await app.files.readProjectText(found.filename);
		if (code == null) {
			throw new Error(`macro not found: ${args.name}`);
		}
	}
	return { ...describeMacro(found), code: String(code ?? "") };
}
