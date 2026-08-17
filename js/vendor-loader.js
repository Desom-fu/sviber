(function loadSviberDependencies() {
	"use strict";

	const isNw = Boolean(globalThis.nw);
	const localFirst = location.hostname === "localhost"
		|| location.hostname === "127.0.0.1"
		|| location.protocol === "file:"
		|| isNw;
	const dependencies = [
		{
			name: "PIXI",
			local: "node_modules/pixi.js/dist/pixi.min.js",
			cdn: "https://cdn.jsdelivr.net/npm/pixi.js@8.18.1/dist/pixi.min.js",
		},
		{
			name: "math",
			local: "node_modules/mathjs/lib/browser/math.js",
			cdn: "https://cdn.jsdelivr.net/npm/mathjs@15.2.0/lib/browser/math.js",
		},
		{
			name: "JSZip",
			local: "node_modules/jszip/dist/jszip.min.js",
			cdn: "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
		},
	];

	function inject(source) {
		return new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src = source;
			script.async = false;
			script.onload = resolve;
			script.onerror = () => reject(new Error(`Unable to load ${source}`));
			document.head.append(script);
		});
	}

	async function loadDependency(dependency) {
		if (globalThis[dependency.name]) return;
		const sources = isNw
			? [dependency.local]
			: localFirst
			? [dependency.local, dependency.cdn]
			: [dependency.cdn, dependency.local];
		let error;
		for (const source of sources) {
			try {
				await inject(source);
				if (globalThis[dependency.name]) return;
			} catch (currentError) {
				error = currentError;
			}
		}
		throw error || new Error(`Unable to load ${dependency.name}`);
	}

	globalThis.sviberDependenciesReady = (async () => {
		const failures = [];
		for (const dependency of dependencies) {
			try {
				await loadDependency(dependency);
			} catch (error) {
				failures.push({ name: dependency.name, error });
			}
		}
		globalThis.sviberDependencyFailures = failures;
		return failures;
	})();
}());
