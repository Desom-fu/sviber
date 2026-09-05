import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_PREFERENCES, loadPreferences, storePreferences } from "../js/app/app-helpers.js";

test("lock layout is an editor preference defaulting to false", () => {
	assert.equal(DEFAULT_PREFERENCES.lockLayout, false);
	const storage = {
		data: {},
		getItem(key) {
			return this.data[key] ?? null;
		},
		setItem(key, value) {
			this.data[key] = value;
		},
	};
	const stored = storePreferences({ ...DEFAULT_PREFERENCES, lockLayout: true }, storage);
	assert.equal(stored.lockLayout, true);
	assert.equal(loadPreferences(storage).lockLayout, true);
});

test("lock-layout control is in the status panel and layout code respects it", async () => {
	const [index, layout, css] = await Promise.all([
		readFile(new URL("../index.html", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-layout.js", import.meta.url), "utf8"),
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
	]);
	assert.match(index, /id="lock-layout"/);
	assert.match(index, /lock-layout\.svg/);
	assert.match(layout, /lockLayout/);
	assert.match(css, /is-layout-locked/);
});
