(function installMacroSandbox(global) {
	const nativeConsole = global.console;
	const stringify = value => {
		try { return typeof value === "string" ? value : JSON.stringify(value); }
		catch { return String(value); }
	};
	const output = (kind, values) => parent.postMessage({
		type: "log", kind,
		values: values.map(value => stringify(value).replace(/\r?\n$/, "")),
	}, "*");
	const consoleProxy = {
		log: (...values) => output("log", values),
		info: (...values) => output("log", values),
		warn: (...values) => output("log", values),
		error: (...values) => output("error", values),
	};

	async function runJavaScript(message) {
		const runtime = global.createSviberMacroApi(message.state, output);
		delete global.createSviberMacroApi;
		const names = Object.keys(runtime.globals);
		const AsyncFunction = Object.getPrototypeOf(async function macroFunction() {}).constructor;
		global.console = consoleProxy;
		try {
			await new AsyncFunction("console", ...names, message.code)(
				consoleProxy, ...names.map(name => runtime.globals[name]),
			);
			return runtime.state;
		} finally {
			global.console = nativeConsole;
		}
	}

	async function runRuby(message) {
		await global.sviberRubyRuntimeReady;
		const runtime = global["ruby-wasm-wasi"];
		if (!runtime?.DefaultRubyVM || !(message.rubyBytes instanceof ArrayBuffer)) {
			throw new Error("ruby.wasm is unavailable in the macro sandbox.");
		}
		const rubyModule = await WebAssembly.compile(message.rubyBytes);
		const { vm } = await runtime.DefaultRubyVM(rubyModule, { consolePrint: false });
		const encode = value => btoa(unescape(encodeURIComponent(String(value))));
		const statePayload = encode(JSON.stringify(message.state));
		const codePayload = encode(message.code || "");
		const source = [
			String(message.rubyApi || ""),
			`SviberMacroInternals.load_json(Base64.strict_decode64("${statePayload}"))`,
			`sviber_macro_source = Base64.strict_decode64("${codePayload}")`,
			"sviber_macro_error = nil",
			"begin",
			"  eval(sviber_macro_source, TOPLEVEL_BINDING, \"(sviber macro)\", 1)",
			"rescue Exception => error",
			"  sviber_macro_error = { \"class\" => error.class.name, \"message\" => error.message, \"backtrace\" => error.backtrace }",
			"end",
			"JSON.generate({ \"state\" => SviberMacroInternals.state, \"logs\" => $__sviber_macro_logs, \"error\" => sviber_macro_error })",
		].join("\n");
		const result = JSON.parse(vm.eval(source).toString());
		for (const record of Array.isArray(result.logs) ? result.logs : []) {
			output(record?.kind === "error" ? "error" : "log", [String(record?.value ?? "")]);
		}
		if (result.error) {
			const heading = `${result.error.class || "Error"}: ${result.error.message || ""}`;
			const backtrace = Array.isArray(result.error.backtrace) ? result.error.backtrace.join("\n") : "";
			throw new Error(backtrace ? `${heading}\n${backtrace}` : heading);
		}
		return result.state;
	}

	global.addEventListener("message", async event => {
		if (event.source !== parent || event.data?.type !== "run") return;
		try {
			const state = event.data.language === "ruby"
				? await runRuby(event.data)
				: await runJavaScript(event.data);
			parent.postMessage({ type: "result", state }, "*");
		} catch (error) {
			parent.postMessage({ type: "error", message: String(error?.stack || error) }, "*");
		}
	});
})(globalThis);
