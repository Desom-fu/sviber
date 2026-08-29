import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { spawn } from "node:child_process";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const CHECK_PATTERN = /Check failed: base_url_value->IsString()/;
const STARTUP_MS = 8000;

function findNwBinary() {
	const nwRoot = path.join(root, "node_modules", "nw");
	if (!fs.existsSync(nwRoot)) {
		return null;
	}
	const binaryName = process.platform === "win32" ? "nw.exe" : "nw";
	for (const name of fs.readdirSync(nwRoot)) {
		if (!name.startsWith("nwjs-")) {
			continue;
		}
		const unpacked = path.join(nwRoot, name, binaryName);
		if (fs.existsSync(unpacked)) {
			return unpacked;
		}
		const mac = path.join(nwRoot, name, "nwjs.app", "Contents", "MacOS", "nwjs");
		if (fs.existsSync(mac)) {
			return mac;
		}
	}
	return null;
}

function collect(child) {
	let text = "";
	const append = chunk => {
		text += String(chunk);
	};
	child.stdout.on("data", append);
	child.stderr.on("data", append);
	return {
		get text() {
			return text;
		},
	};
}

function isCrashExit(code, signal) {
	return signal === "SIGSEGV" || signal === "SIGABRT" || code === 139 || code === 134;
}

// A fresh directory per run isolates the launch without deleting an existing one, which
// some sandboxes refuse to do.
function createUserDataDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "sviber-nw-user-data-"));
}

function discardUserDataDir(directory) {
	try {
		fs.rmSync(directory, { recursive: true, force: true });
	} catch {
		// Best effort only: a leftover temporary directory must never fail the launch check.
	}
}

test("nw --headless . starts without the base_url CHECK", async t => {
	const binary = findNwBinary();
	assert.ok(binary);
	const userDataDir = createUserDataDir();
	let child;
	try {
		child = spawn(
			binary,
			[
				root,
				"--user-data-dir=" + userDataDir,
				"--" + "ozone-platform=" + "headless",
			],
			{ cwd: root },
		);
	} catch (error) {
		discardUserDataDir(userDataDir);
		t.skip(`NW.js launch environment unavailable (${error.code || error.message})`);
		return;
	}
	const output = collect(child);
	const result = await new Promise(resolve => {
		const timer = setTimeout(() => resolve({ timedOut: true }), STARTUP_MS);
		child.on("error", error => {
			clearTimeout(timer);
			resolve({ error });
		});
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			resolve({ code, signal });
		});
	});
	if (result.error) {
		discardUserDataDir(userDataDir);
		t.skip(`NW.js launch environment unavailable (${result.error.code || result.error.message})`);
		return;
	}
	assert.doesNotMatch(output.text, CHECK_PATTERN);
	assert.equal(result.timedOut, true);
	if (!result.timedOut) {
		assert.equal(isCrashExit(result.code, result.signal), false, output.text);
	}
	if (child.pid && result.timedOut) {
		child.kill();
		await new Promise(resolve => child.once("close", resolve));
	}
	discardUserDataDir(userDataDir);
});
