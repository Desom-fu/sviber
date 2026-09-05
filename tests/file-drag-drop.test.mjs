import assert from "node:assert/strict";
import test from "node:test";
import { classifyFile } from "../js/app/app-file-drop.js";

test("dropped files are classified as chart, audio or image", () => {
	assert.equal(classifyFile({ name: "chart.json", type: "application/json" }), "chart");
	assert.equal(classifyFile({ name: "level.ssc", type: "" }), "chart");
	assert.equal(classifyFile({ name: "song.ogg", type: "audio/ogg" }), "audio");
	assert.equal(classifyFile({ name: "cover.png", type: "image/png" }), "image");
	assert.equal(classifyFile({ name: "notes.txt", type: "text/plain" }), "chart");
});
