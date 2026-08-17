(() => {
	const nw = globalThis.nw;
	if (!nw || nw.App?.manifest?.["sviber-source"] !== true) return;
	try {
		const path = nw.require("node:path");
		const root = nw.App.startPath || globalThis.process.cwd();
		const bundler = nw.require(path.join(root, "scripts", "audio-decoder-bundle.cjs"));
		bundler.bundleAudioDecoderSync(path.join(root, "audio", "audio-decode.bundle.js"), { minify: true });
	} catch (error) {
		globalThis.sviberSourceBootstrapError = error;
		console.error("Unable to prepare the NW.js audio decoder bundle.", error);
	}
})();
