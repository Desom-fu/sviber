(function loadSviberRubyRuntime(global) {
	const isNw = Boolean(global.nw);
	const localFirst = isNw || location.protocol === "file:" || /^(?:localhost|127\.0\.0\.1)$/.test(location.hostname);
	const sources = localFirst
		? ["node_modules/@ruby/wasm-wasi/dist/browser.umd.js", "https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi@2.10.1/dist/browser.umd.js"]
		: ["https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi@2.10.1/dist/browser.umd.js", "node_modules/@ruby/wasm-wasi/dist/browser.umd.js"];

	function inject(source) {
		return new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src = source;
			script.onload = resolve;
			script.onerror = () => reject(new Error(`Unable to load ${source}`));
			document.head.append(script);
		});
	}

	global.sviberRubyRuntimeReady = (async () => {
		if (global["ruby-wasm-wasi"]?.DefaultRubyVM) return global["ruby-wasm-wasi"];
		let failure;
		for (const source of sources) {
			try {
				await inject(source);
				if (global["ruby-wasm-wasi"]?.DefaultRubyVM) return global["ruby-wasm-wasi"];
			} catch (error) { failure = error; }
		}
		throw failure || new Error("ruby.wasm runtime is unavailable.");
	})();
}(globalThis));
