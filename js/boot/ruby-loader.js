(function loadSviberRubyRuntime(global) {
	// The sandboxed macro iframe has an opaque origin, so hostname/protocol checks
	// cannot distinguish local development from a hosted page. The local script
	// fails quickly when it is not packaged, then the matching CDN build is used.
	const sources = [
		"node_modules/@ruby/4.0-wasm-wasi/dist/browser.umd.js",
		"https://cdn.jsdelivr.net/npm/@ruby/4.0-wasm-wasi@2.10.1/dist/browser.umd.js",
	];

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
		if (global["ruby-wasm-wasi"]?.DefaultRubyVM) {
			return global["ruby-wasm-wasi"];
		}
		let failure;
		for (const source of sources) {
			try {
				await inject(source);
				if (global["ruby-wasm-wasi"]?.DefaultRubyVM) {
					return global["ruby-wasm-wasi"];
				}
			} catch (error) {
				failure = error;
			}
		}
		throw failure || new Error("ruby.wasm runtime is unavailable.");
	})();
})(globalThis);
