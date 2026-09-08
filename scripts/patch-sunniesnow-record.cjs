// sunniesnow-record's npm tarball omits game/index.html: its `files` whitelist only
// matches js/mjs/json, but the module reads game/index.html at import time to build the
// settings DOM (ScriptsLoader -> Settings.initWithJsdom). This script restores the file
// from the vendored copy pinned to the game commit that sunniesnow-record's `game`
// submodule points at. Runs on every `npm install` via the postinstall hook; the NW.js
// build packages node_modules from here, so the packaged app gets the fix too.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = path.join(root, "vendor", "sunniesnow-record", "game", "index.html");
const target = path.join(root, "node_modules", "sunniesnow-record", "game", "index.html");

if (!fs.existsSync(source)) {
	console.warn(`[patch-sunniesnow-record] missing vendored file: ${source}`);
	process.exit(0);
}

const targetDirectory = path.dirname(target);
fs.mkdirSync(targetDirectory, { recursive: true });
const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
const replacement = fs.readFileSync(source, "utf8");
if (current !== replacement) {
	fs.copyFileSync(source, target);
	console.log("[patch-sunniesnow-record] restored node_modules/sunniesnow-record/game/index.html");
}
