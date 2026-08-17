(() => {
	const nw = globalThis.nw;
	if (!nw || nw.App?.manifest?.["sviber-source"] !== true) return;
	globalThis.sviberSourcePreparation = (async () => {
		const path = nw.require("node:path");
		const fs = nw.require("node:fs");
		const root = nw.App.startPath || globalThis.process.cwd();
		const fontCache = path.join(root, "node_modules", ".cache", "sviber", "fonts");
		const fontDestination = path.join(root, "assets", "fonts");
		const fontNames = [
			"LXGWWenKai-Regular.ttf", "NotoSansMath-Regular.ttf", "NotoSansCJKtc-Regular.otf",
			"HanWangShinSuMedium.ttf", "YujiBoku-Regular.ttf",
		];
		try {
			if (fs.existsSync(fontCache)) {
				fs.mkdirSync(fontDestination, { recursive: true });
				for (const name of fontNames) {
					const source = path.join(fontCache, name);
					if (fs.existsSync(source)) fs.copyFileSync(source, path.join(fontDestination, name));
				}
			}
		} catch (error) {
			globalThis.sviberSourceFontError = error;
			console.error("Unable to prepare the NW.js local fonts.", error);
		}
		try {
			const bundler = nw.require(path.join(root, "scripts", "audio-decoder-bundle.cjs"));
			await bundler.bundleAudioDecoder(path.join(root, "js", "audio", "audio-decode.bundle.js"), { minify: true });
		} catch (error) {
			globalThis.sviberSourceBootstrapError = error;
			console.error("Unable to prepare the NW.js audio decoder bundle.", error);
		}
	})();
})();
