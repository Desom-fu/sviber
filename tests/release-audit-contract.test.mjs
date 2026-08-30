import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { COMMAND_DEFINITIONS } from "../js/app/commands.js";

async function readManual(language) {
	const filename = language === "en" ? "manual.en.json" : "manual.zh-CN.json";
	const source = await readFile(new URL(`../json/${filename}`, import.meta.url), "utf8");
	return JSON.parse(source).article;
}

test("bilingual help manuals mention every v22 shortcut and recovery behavior", async () => {
	const [english, chinese] = await Promise.all([readManual("en"), readManual("zh-CN")]);
	for (const [manual, directionShortcuts] of [
		[english, ["Ctrl+Alt+Up", "Ctrl+Alt+Down"]],
		[chinese, ["Ctrl+Alt+上", "Ctrl+Alt+下"]],
	]) {
		for (const shortcut of [
			"Ctrl+,",
			"Ctrl+K",
			"Ctrl+Alt+K",
			"Ctrl+J",
			"Ctrl+Alt+J",
			...directionShortcuts,
			"PageUp",
			"PageDown",
		]) {
			assert.ok(manual.includes(shortcut), `${shortcut} is missing from the manual`);
		}
		assert.match(manual, /Open auto-save|打开自动保存/);
		assert.match(manual, /undo|撤销/i);
		assert.match(manual, /music|音乐/i);
		assert.match(manual, /image|图片/i);
	}
	assert.equal(COMMAND_DEFINITIONS["music.seekBackward3"].shortcut, "Ctrl+,");
});

test("service worker cache version matches the v0.13.2 application shell", async () => {
	const [serviceWorker, index, packageSource] = await Promise.all([
		readFile(new URL("../service-worker.js", import.meta.url), "utf8"),
		readFile(new URL("../index.html", import.meta.url), "utf8"),
		readFile(new URL("../package.json", import.meta.url), "utf8"),
	]);
	assert.equal(JSON.parse(packageSource).version, "0.13.2");
	assert.match(serviceWorker, /CACHE_VERSION = "sviber-v01320"/);
	assert.match(serviceWorker, /js\/app\/app\.js\?v=65/);
	assert.match(index, /js\/app\/app\.js\?v=65/);
});
