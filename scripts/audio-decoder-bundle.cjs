const path = require("node:path");
const esbuild = require("esbuild");

const entryPoint = path.resolve(__dirname, "../node_modules/audio-decode/audio-decode.js");

function options(outfile, overrides = {}) {
	return {
		entryPoints: [entryPoint],
		outfile,
		bundle: true,
		define: {
			process: "undefined",
			"globalThis.process": "undefined",
		},
		external: ["node:module"],
		format: "esm",
		legalComments: "eof",
		platform: "browser",
		supported: { "template-literal": false },
		target: "chrome136",
		...overrides,
	};
}

function bundleAudioDecoderSync(outfile, overrides) {
	esbuild.buildSync(options(outfile, overrides));
}

async function bundleAudioDecoder(outfile, overrides) {
	await esbuild.build(options(outfile, overrides));
}

module.exports = { bundleAudioDecoder, bundleAudioDecoderSync };
