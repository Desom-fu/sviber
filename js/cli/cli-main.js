// NW.js `node-main` entry point (v17).
//
// It runs in the Node context before the editor window is shown. When CLI flags are
// present the requested file operation is performed and the app quits without ever
// showing the GUI; otherwise the window is revealed and a path argument is handed to
// the editor through `global.sviberOpenPath`.

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Relative dynamic imports need a string module base URL. NW.js `node-main` can
// start without one, and V8 then aborts with "Check failed: base_url_value->IsString()."
// `package.json` `"type": "module"` also means `nw .` may evaluate this file without
// CJS wrappers, so `__dirname` is missing even when `require` is injected.
function nodeMainDirectory() {
	try {
		if (typeof __dirname === "string") {
			return __dirname;
		}
	} catch {
		/* ESM / eval without CJS wrappers. */
	}
	try {
		if (typeof module !== "undefined" && typeof module.filename === "string") {
			return path.dirname(module.filename);
		}
	} catch {
		/* ignore */
	}
	const root = global.nw?.App?.startPath || process.cwd();
	return path.join(root, "js", "cli");
}

function siblingModuleUrl(name) {
	return pathToFileURL(path.join(nodeMainDirectory(), name)).href;
}

function argumentList() {
	try {
		return Array.from(global.nw?.App?.argv || []);
	} catch {
		return [];
	}
}

function showWindow() {
	try {
		global.nw?.Window?.get?.()?.show?.();
	} catch {
		/* The window may not exist yet; index.html shows it as well. */
	}
}

async function main() {
	const argv = argumentList();
	const [{ isHeadlessInvocation, parseCliArguments }, { runCli }, { createNodeCliIo }] = await Promise.all([
		import(siblingModuleUrl("cli.js")),
		import(siblingModuleUrl("cli-operations.js")),
		import(siblingModuleUrl("cli-node-io.js")),
	]);
	const args = parseCliArguments(argv);
	if (!isHeadlessInvocation(args)) {
		if (args.input) {
			global.sviberOpenPath = path.resolve(args.input);
		}
		showWindow();
		return;
	}
	const io = createNodeCliIo({
		fs,
		path,
		JSZip: require("jszip"),
		print: text => process.stdout.write(text),
		printError: text => process.stderr.write(text),
	});
	const code = await runCli(argv, io);
	process.exitCode = code ?? 0;
	try {
		global.nw?.App?.quit?.();
	} catch {
		process.exit(code ?? 0);
	}
}

main().catch(error => {
	process.stderr.write(`${String(error?.message || error)}\n`);
	try {
		global.nw?.App?.quit?.();
	} catch {
		process.exit(1);
	}
});
