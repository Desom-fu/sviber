// Open-document lookup and music-snippet extraction for MCP instance tools.

import { Rational } from "../core/rational.js";
import { encodeWavPcm16 } from "./mcp-audio-snippet.js";
import { socketPathFromName, sviberDirectory } from "./mcp-paths.js";

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
	if (wav.length <= maxInline) {
		return { encoding: "base64", data: bytesToBase64(wav) };
	}
	if (typeof options.writeFile !== "function") {
		throw new Error("large music snippets require a local file writer");
	}
	return { encoding: "path", path: options.writeFile(wav) };
}

export function defaultMusicSnippetWriter(bytes, app) {
	if (typeof app?.writeMusicSnippetFile === "function") {
		return app.writeMusicSnippetFile(bytes);
	}
	const fs = app?.fs;
	if (!fs?.writeFileSync) {
		throw new Error("large music snippets require a local file writer");
	}
	const directory = sviberDirectory();
	fs.mkdirSync?.(directory, { recursive: true });
	const pathname = socketPathFromName(directory, `snippet-${Date.now()}.wav`);
	fs.writeFileSync(pathname, bytes);
	return pathname;
}

export function snippetSeconds(app, beat) {
	const timing = typeof app.timing === "function" ? app.timing() : app.model?.timing;
	if (!timing?.beatToSeconds) {
		throw new Error("no timing map");
	}
	return timing.beatToSeconds(Rational.from(beat));
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
