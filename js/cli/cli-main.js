// NW.js `node-main` entry point (v17).
//
// It runs in the Node context before the editor window is shown. When CLI flags are
// present the requested file operation is performed and the app quits without ever
// showing the GUI; otherwise the window is revealed and a path argument is handed to
// the editor through `global.sviberOpenPath`.
//
// A dynamic import from this file runs inside NW.js generated background page (Blink) and
// aborts with "Check failed: base_url_value->IsString()." GUI launches must not do that.

const fs = require("node:fs");
const path = require("node:path");

const CLI_OPERATION_FLAGS = new Set(["--export", "--import", "--help", "-h", "--version", "-v"]);
const VALUE_FLAGS = new Set([
	"--export",
	"--import",
	"--offset",
	"--initial-bpm",
	"--largest-denominator",
	"--bpm-change",
	"--seed",
	"--quantization-denominator",
	"--charter",
	"--difficulty-name",
	"--difficulty-color",
	"--difficulty",
	"--difficulty-sup",
	"--chart",
]);

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

function isCliOperation(argv) {
	return argv.some(token => CLI_OPERATION_FLAGS.has(String(token)));
}

function firstInputPath(argv) {
	for (let index = 0; index < argv.length; index += 1) {
		const token = String(argv[index]);
		if (token === "--help" || token === "-h" || token === "--version" || token === "-v") {
			continue;
		}
		if (token === "--bpm-change" || VALUE_FLAGS.has(token)) {
			index += 1;
			continue;
		}
		if (token.startsWith("-")) {
			continue;
		}
		return token;
	}
	return null;
}

function loadCliModules() {
	const directory = nodeMainDirectory();
	return {
		cli: require(path.join(directory, "cli.js")),
		operations: require(path.join(directory, "cli-operations.js")),
		io: require(path.join(directory, "cli-node-io.js")),
	};
}

async function main() {
	const argv = argumentList();
	if (!isCliOperation(argv)) {
		const input = firstInputPath(argv);
		if (input) {
			global.sviberOpenPath = path.resolve(input);
		}
		showWindow();
		return;
	}
	const { cli, operations, io } = loadCliModules();
	const args = cli.parseCliArguments(argv);
	if (!cli.isHeadlessInvocation(args)) {
		if (args.input) {
			global.sviberOpenPath = path.resolve(args.input);
		}
		showWindow();
		return;
	}
	const cliIo = io.createNodeCliIo({
		fs,
		path,
		JSZip: require("jszip"),
		print: text => process.stdout.write(text),
		printError: text => process.stderr.write(text),
	});
	const code = await operations.runCli(argv, cliIo);
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
