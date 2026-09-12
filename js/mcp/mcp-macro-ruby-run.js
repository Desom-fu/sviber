// Run Ruby macros in Node / NW.js with @ruby/wasm-wasi (same API surface as the iframe sandbox).
// Dynamically imported so browser bundles that only need JavaScript stay free of node: builtins.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

let runtimePromise = null;

function resolveWasmPath() {
	const candidates = [];
	try {
		candidates.push(require.resolve("@ruby/4.0-wasm-wasi/dist/ruby+stdlib.wasm"));
	} catch {
		/* exports may not map .wasm */
	}
	try {
		const entry = require.resolve("@ruby/4.0-wasm-wasi");
		candidates.push(path.resolve(path.dirname(entry), "..", "ruby+stdlib.wasm"));
		candidates.push(path.resolve(path.dirname(entry), "ruby+stdlib.wasm"));
	} catch {
		/* fall through to relative */
	}
	const relativeWasm = path.resolve(
		here,
		"..",
		"..",
		"node_modules",
		"@ruby",
		"4.0-wasm-wasi",
		"dist",
		"ruby+stdlib.wasm",
	);
	candidates.push(relativeWasm);
	return candidates;
}

async function loadRubyRuntime() {
	if (!runtimePromise) {
		runtimePromise = (async () => {
			const { DefaultRubyVM } = await import("@ruby/wasm-wasi/dist/node");
			let wasmBytes = null;
			let lastError = null;
			for (const candidate of resolveWasmPath()) {
				try {
					wasmBytes = await readFile(candidate);
					break;
				} catch (error) {
					lastError = error;
				}
			}
			if (!wasmBytes) {
				throw lastError || new Error("ruby.wasm binary is unavailable.");
			}
			const rubyModule = await WebAssembly.compile(wasmBytes);
			const { vm } = await DefaultRubyVM(rubyModule, { consolePrint: false });
			const rubyApi = await readFile(path.resolve(here, "..", "macro", "macro-api.rb"), "utf8");
			return { vm, rubyApi };
		})().catch(error => {
			runtimePromise = null;
			throw error;
		});
	}
	return runtimePromise;
}

function encode64(value) {
	return Buffer.from(String(value), "utf8").toString("base64");
}

function splitLogs(records) {
	const stdout = [];
	const stderr = [];
	for (const record of Array.isArray(records) ? records : []) {
		const line = String(record?.value ?? "");
		if (record?.kind === "error") {
			stderr.push(line);
		} else {
			stdout.push(line);
		}
	}
	return { stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

function raiseRubyError(error) {
	const heading = `${error?.class || "Error"}: ${error?.message || ""}`;
	const backtrace = Array.isArray(error?.backtrace) ? error.backtrace.join("\n") : "";
	throw new Error(backtrace ? `${heading}\n${backtrace}` : heading);
}

async function evalRuby(state, code, expression) {
	const { vm, rubyApi } = await loadRubyRuntime();
	const statePayload = encode64(JSON.stringify(state));
	const codePayload = encode64(code ?? "");
	const expressionEval =
		'  sviber_macro_value = eval("(" + sviber_macro_source + ")", ' +
		'TOPLEVEL_BINDING, "(sviber macro expression)", 1)';
	const statementEval = '  eval(sviber_macro_source, TOPLEVEL_BINDING, "(sviber macro)", 1)';
	const evalLine = expression ? expressionEval : statementEval;
	const valueLine = expression ? "sviber_macro_value" : "nil";
	const source = [
		rubyApi,
		`SviberMacroInternals.load_json(Base64.strict_decode64("${statePayload}"))`,
		`sviber_macro_source = Base64.strict_decode64("${codePayload}")`,
		"sviber_macro_error = nil",
		`sviber_macro_value = nil`,
		"begin",
		evalLine,
		"rescue Exception => error",
		'  sviber_macro_error = { "class" => error.class.name, ' +
			'"message" => error.message, "backtrace" => error.backtrace }',
		"end",
		'JSON.generate({ "state" => SviberMacroInternals.state, ' +
			'"logs" => $__sviber_macro_logs, "error" => sviber_macro_error, ' +
			`"value" => (begin; ${valueLine}; rescue StandardError; nil; end) })`,
	].join("\n");
	const parsed = JSON.parse(vm.eval(source).toString());
	if (parsed.error) {
		raiseRubyError(parsed.error);
	}
	const { stdout, stderr } = splitLogs(parsed.logs);
	return { state: parsed.state, stdout, stderr, value: parsed.value };
}

export async function runRubySnippet(state, code) {
	const result = await evalRuby(state, code, false);
	return { state: result.state, stdout: result.stdout, stderr: result.stderr };
}

export async function runRubyExpression(state, code) {
	const result = await evalRuby(state, code, true);
	return { state: result.state, value: result.value ?? null };
}
