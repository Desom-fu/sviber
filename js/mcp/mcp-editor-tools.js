// Macro mutate/run/undo handlers for MCP instance tools.

import { ChartModel } from "../core/chart-model.js";
import { runJavaScriptExpression, runJavaScriptSnippet } from "./mcp-macro-run.js";
import {
	listGlobalMacros,
	listProjectMacros,
	macroFilename,
	readGlobalMacroMap,
	storageOf,
	writeGlobalMacroMap,
} from "./mcp-macro-store.js";
import { defaultMusicSnippetWriter, musicSnippetFromChannels, snippetSeconds } from "./mcp-open-snippet.js";

export async function findMacro(app, name) {
	const wanted = String(name || "").trim();
	const global = listGlobalMacros(storageOf(app));
	const project = await listProjectMacros(app);
	return (
		[...global, ...project].find(
			item => item.name === wanted || item.id === wanted || item.filename === wanted,
		) || null
	);
}

export async function handleCreateMacro(args, app) {
	const name = String(args.name || "").trim();
	if (!name) {
		throw new Error("macro name is required");
	}
	const language = args.language === "ruby" ? "ruby" : "javascript";
	if (args.scope === "project") {
		return createProjectMacro(app, name, args.code, language);
	}
	const storage = storageOf(app);
	const map = readGlobalMacroMap(storage);
	if (Object.hasOwn(map, name)) {
		throw new Error(`macro already exists: ${name}`);
	}
	map[name] = { language, content: String(args.code ?? "") };
	writeGlobalMacroMap(map, storage);
	return { name, scope: "global", language };
}

async function createProjectMacro(app, name, code, language) {
	if (typeof app?.files?.writeProjectText !== "function") {
		throw new Error("project macros are unavailable");
	}
	const filename = macroFilename(name, language);
	await app.files.writeProjectText(filename, String(code ?? ""));
	return { name: filename.replace(/\.(js|rb)$/i, ""), scope: "project", language, filename };
}

export async function handleRenameMacro(args, app) {
	const found = await findMacro(app, args.name);
	if (!found) {
		throw new Error(`macro not found: ${args.name}`);
	}
	const newName = String(args.newName || "").trim();
	if (!newName) {
		throw new Error("newName is required");
	}
	if (found.scope === "project") {
		const filename = macroFilename(newName, found.language);
		await app.files.renameProjectText(found.filename, filename);
		return { name: newName, scope: "project", filename };
	}
	const storage = storageOf(app);
	const map = readGlobalMacroMap(storage);
	if (Object.hasOwn(map, newName)) {
		throw new Error(`macro already exists: ${newName}`);
	}
	map[newName] = map[found.name];
	delete map[found.name];
	writeGlobalMacroMap(map, storage);
	return { name: newName, scope: "global" };
}

export async function handleEditMacro(args, app) {
	const found = await findMacro(app, args.name);
	if (!found) {
		throw new Error(`macro not found: ${args.name}`);
	}
	const code = String(args.code ?? "");
	if (found.scope === "project") {
		await app.files.writeProjectText(found.filename, code);
		return { name: found.name, scope: "project" };
	}
	const storage = storageOf(app);
	const map = readGlobalMacroMap(storage);
	map[found.name] = { ...(map[found.name] || {}), content: code };
	writeGlobalMacroMap(map, storage);
	return { name: found.name, scope: "global" };
}

export async function handleRunMacro(args, app) {
	const found = await findMacro(app, args.name);
	if (!found) {
		throw new Error(`macro not found: ${args.name}`);
	}
	let code = found.content;
	if (found.scope === "project") {
		code = await app.files.readProjectText(found.filename);
	}
	return runAndApply(app, code, found.language, false);
}

export function handleRunSnippet(args, app) {
	return runAndApply(app, args.code, args.language, false);
}

export function handleRunExpression(args, app) {
	return runAndApply(app, args.code, args.language, true);
}

export function handleUndoLastRun(_args, app) {
	if (!app?.mcpUndoAllowed) {
		throw new Error("no MCP-initiated modifying run to undo");
	}
	app.mcpUndoAllowed = false;
	if (typeof app.undo !== "function") {
		throw new Error("undo is unavailable");
	}
	app.undo();
	return { undone: true };
}

export function handleMusicSnippet(args, app) {
	const waveform = app.audio?.waveform;
	if (!waveform?.channels?.length) {
		throw new Error("no music loaded");
	}
	const start = snippetSeconds(app, args.start);
	const end = snippetSeconds(app, args.end);
	return musicSnippetFromChannels(waveform.channels, waveform.sampleRate, start, end, {
		maxInline: args.maxInline,
		writeFile: bytes => defaultMusicSnippetWriter(bytes, app),
	});
}

function chartCore(state) {
	return {
		events: state?.events,
		channels: state?.channels,
		snappees: state?.snappees,
		timing: state?.timing,
		metadata: state?.metadata,
		music: state?.music,
		image: state?.image,
		currentTime: state?.editor?.currentTime,
		currentChannel: state?.editor?.currentChannel,
	};
}

function chartWasModified(before, after) {
	return JSON.stringify(chartCore(before)) !== JSON.stringify(chartCore(after));
}

async function runAndApply(app, code, language, expression) {
	if (app?.model?.editor?.readOnly) {
		throw new Error("The chart is read-only.");
	}
	const lang = language === "ruby" ? "ruby" : "javascript";
	if (lang === "ruby") {
		throw new Error("Ruby MCP runs require a live editor sandbox");
	}
	const before = app.model.snapshot();
	let result;
	if (expression) {
		result = await runJavaScriptExpression(before, code);
	} else {
		result = await runJavaScriptSnippet(before, code);
	}
	const changed = chartWasModified(before, result.state);
	app.mcpUndoAllowed = false;
	if (changed) {
		applyMacroState(app, result.state);
		app.mcpUndoAllowed = true;
	}
	if (expression) {
		return { value: result.value, modified: changed };
	}
	return { stdout: result.stdout, stderr: result.stderr, modified: changed };
}

function applyMacroState(app, state) {
	if (typeof app.commit === "function") {
		app.commit("MCP macro", model => model.restore(state));
		return;
	}
	if (app.model instanceof ChartModel) {
		app.model.restore(state);
	}
}
