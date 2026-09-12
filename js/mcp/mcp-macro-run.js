// Run JavaScript macros with the shipped createSviberMacroApi (same entry as the sandbox).

import { createSviberMacroApi } from "../macro/macro-api.js";

function stringify(value) {
	try {
		return typeof value === "string" ? value : JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function consoleProxy(output) {
	const write = kind => (...values) => output(kind, values);
	return { log: write("log"), info: write("log"), warn: write("log"), error: write("error") };
}

function runWithGlobals(globals, consoleObject, body) {
	const names = Object.keys(globals);
	const AsyncFunction = Object.getPrototypeOf(async function macroFunction() {}).constructor;
	return new AsyncFunction("console", ...names, body)(
		consoleObject,
		...names.map(name => globals[name]),
	);
}

export async function runJavaScriptSnippet(state, code) {
	const logs = [];
	const errors = [];
	const output = (kind, values) => {
		const line = values.map(stringify).join(" ");
		if (kind === "error") {
			errors.push(line);
		} else {
			logs.push(line);
		}
	};
	const runtime = createSviberMacroApi(state, output);
	await runWithGlobals(runtime.globals, consoleProxy(output), String(code ?? ""));
	return { state: runtime.state, stdout: logs.join("\n"), stderr: errors.join("\n") };
}

export async function runJavaScriptExpression(state, code) {
	const runtime = createSviberMacroApi(state, () => {});
	const value = await runWithGlobals(runtime.globals, consoleProxy(() => {}), `return (${code});`);
	return { state: runtime.state, value: toJsonValue(value) };
}

export function toJsonValue(value) {
	if (value == null || typeof value !== "object") {
		return value;
	}
	if (typeof value.toJSON === "function") {
		return value.toJSON();
	}
	try {
		return JSON.parse(JSON.stringify(value));
	} catch {
		return String(value);
	}
}
