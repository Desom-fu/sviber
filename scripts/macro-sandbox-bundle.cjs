const path = require("node:path");
const esbuild = require("esbuild");

const sviberDirectory = path.resolve(__dirname, "..");

function bundleMacroSandbox(outfile = path.join(sviberDirectory, "js", "macro", "macro-sandbox.bundle.js")) {
	return esbuild.build({
		entryPoints: [path.join(sviberDirectory, "js", "macro", "macro-sandbox.js")],
		outfile,
		bundle: true,
		format: "iife",
		legalComments: "eof",
		minify: true,
		platform: "browser",
		target: "chrome136",
	});
}

if (require.main === module) {
	bundleMacroSandbox().then(() => console.log("Macro sandbox bundle generated."));
}

module.exports = { bundleMacroSandbox };
