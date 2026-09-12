// Instance-side MCP tool handlers. Tests drive these with a fake app object.

import { listRunnableMacros } from "../app/app-macro-bridge.js";
import { encodeWavPcm16 } from "./mcp-audio-snippet.js";

export function getOpenDocument(app) {
	const projectPath = String(app?.files?.projectPath || "");
	const chartPath = String(app?.files?.chartPath || "");
	if (projectPath) {
		return { kind: "project", path: projectPath };
	}
	if (chartPath) {
		return { kind: "chart", path: chartPath };
	}
	return { kind: "none", path: "" };
}

function describeMacro(item) {
	return {
		id: item.id,
		name: item.name,
		scope: item.scope,
		language: item.language,
		filename: item.filename || item.label || item.name,
	};
}

export async function handleEditorMcpTool(name, args, app) {
	if (name === "get_open") {
		return getOpenDocument(app);
	}
	if (name === "list_macros") {
		const lists = await listRunnableMacros(app);
		return {
			global: (lists.global || []).map(describeMacro),
			project: (lists.project || []).map(describeMacro),
		};
	}
	if (typeof app.handleMcpTool === "function") {
		return app.handleMcpTool(name, args);
	}
	throw new Error(`unsupported tool: ${name}`);
}

export function musicSnippetFromChannels(channels, sampleRate, startSeconds, endSeconds, options = {}) {
	const rate = Number(sampleRate) || 44100;
	const start = Math.max(0, Math.floor((Number(startSeconds) || 0) * rate));
	const end = Math.max(start + 1, Math.floor((Number(endSeconds) || 0) * rate));
	const length = channels?.[0]?.length || 0;
	const from = Math.min(start, length);
	const to = Math.min(end, length);
	const mono = new Float32Array(Math.max(0, to - from));
	for (let index = 0; index < mono.length; index += 1) {
		let sum = 0;
		for (const channel of channels || []) {
			sum += channel[from + index] || 0;
		}
		mono[index] = sum / Math.max(1, channels.length);
	}
	const wav = encodeWavPcm16(mono, rate);
	const maxInline = options.maxInline ?? 256 * 1024;
	if (wav.length <= maxInline || typeof options.writeFile !== "function") {
		return { encoding: "base64", data: bytesToBase64(wav) };
	}
	return { encoding: "path", path: options.writeFile(wav) };
}

function bytesToBase64(bytes) {
	if (typeof Buffer === "function") {
		return Buffer.from(bytes).toString("base64");
	}
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return globalThis.btoa(binary);
}
