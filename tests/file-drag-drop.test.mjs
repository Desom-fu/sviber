import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { classifyFile, isExternalFileDrop } from "../js/app/app-file-drop.js";

test("dropped files are classified as chart, audio or image", () => {
	assert.equal(classifyFile({ name: "chart.json", type: "application/json" }), "chart");
	assert.equal(classifyFile({ name: "level.ssc", type: "" }), "chart");
	assert.equal(classifyFile({ name: "song.ogg", type: "audio/ogg" }), "audio");
	assert.equal(classifyFile({ name: "cover.png", type: "image/png" }), "image");
	assert.equal(classifyFile({ name: "notes.txt", type: "text/plain" }), "chart");
});

test("status-panel icon drags are not treated as external file drops", () => {
	assert.equal(isExternalFileDrop(null), false);
	assert.equal(isExternalFileDrop({ types: ["text/uri-list"], files: [], items: [] }), false);
	assert.equal(
		isExternalFileDrop({
			types: ["Files"],
			files: [{ name: "cover.png", type: "image/png" }],
			items: [{ kind: "file" }],
		}),
		true,
	);
});

test("status panel button icons cannot start a background image drag", async () => {
	const [html, css, drop] = await Promise.all([
		readFile(new URL("../index.html", import.meta.url), "utf8"),
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-file-drop.js", import.meta.url), "utf8"),
	]);
	assert.match(html, /class="status-option"[^>]*>[\s\S]*?<img draggable="false"/);
	assert.match(css, /\.status-option img\s*\{[^}]*-webkit-user-drag:\s*none/);
	assert.match(drop, /status-panel/);
	assert.match(drop, /dragstart/);
	assert.match(drop, /isExternalFileDrop/);
});
