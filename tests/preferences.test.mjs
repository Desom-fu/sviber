import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	DEFAULT_PREFERENCES,
	PREFERENCES_KEY,
	applyThemePreference,
	loadPreferences,
	resolvePreferenceLanguage,
	storePreferences,
} from "../js/app-helpers.js";

function memoryStorage(initial = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: key => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
		value: key => values.get(key),
	};
}

test("preferences migrate old values and normalize theme and language choices", () => {
	const oldStorage = memoryStorage({
		[PREFERENCES_KEY]: JSON.stringify({ noteSpeed: 3.5, allowOutOfBounds: true }),
	});
	assert.deepEqual(loadPreferences(oldStorage), {
		theme: "system", language: "system", noteSpeed: 3.5,
		seVolume: 1, musicVolume: 1, autoSaveInterval: 120,
		liveHostingAddress: "0.0.0.0:8011", liveReloadPort: 31108,
	});

	const invalidStorage = memoryStorage({
		[PREFERENCES_KEY]: JSON.stringify({ theme: "purple", language: "fr", noteSpeed: -2 }),
	});
	assert.deepEqual(loadPreferences(invalidStorage), DEFAULT_PREFERENCES);
});

test("stored appearance and language preferences round-trip", () => {
	const storage = memoryStorage();
	const stored = storePreferences({
		theme: "dark", language: "zh-CN", noteSpeed: 4, allowOutOfBounds: true,
	}, storage);
	assert.deepEqual(JSON.parse(storage.value(PREFERENCES_KEY)), stored);
	assert.equal(Object.hasOwn(stored, "allowOutOfBounds"), false);
	assert.deepEqual(loadPreferences(storage), stored);
	assert.equal(resolvePreferenceLanguage("system", "zh-HK"), "zh-CN");
	assert.equal(resolvePreferenceLanguage("system", "en-GB"), "en-US");
	assert.equal(resolvePreferenceLanguage("en-US", "zh-CN"), "en-US");
});

test("explicit themes update the document root and title color", () => {
	const attributes = new Map();
	let titleColor = "";
	const root = {
		ownerDocument: { querySelector: () => ({ setAttribute: (_name, value) => { titleColor = value; } }) },
		setAttribute: (name, value) => attributes.set(name, value),
		removeAttribute: name => attributes.delete(name),
	};
	assert.equal(applyThemePreference("dark", root), "dark");
	assert.equal(attributes.get("data-theme"), "dark");
	assert.equal(titleColor, "#292c30");
	assert.equal(applyThemePreference("system", root), "system");
	assert.equal(attributes.has("data-theme"), false);
});

test("theme CSS and standalone pages expose explicit preference states", async () => {
	const [themes, appStyles, macroStyles, docsStyles, index, macroPage, docsPage,
		labels, viewer, navigation, bootstrap, serviceWorker] = await Promise.all([
		readFile(new URL("../css/themes.css", import.meta.url), "utf8"),
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
		readFile(new URL("../css/macros.css", import.meta.url), "utf8"),
		readFile(new URL("../docs/docs.css", import.meta.url), "utf8"),
		readFile(new URL("../index.html", import.meta.url), "utf8"),
		readFile(new URL("../macros.html", import.meta.url), "utf8"),
		readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
		readFile(new URL("../javascript.html", import.meta.url), "utf8"),
		readFile(new URL("../source-viewer.html", import.meta.url), "utf8"),
		readFile(new URL("../js/license-page.js", import.meta.url), "utf8"),
		readFile(new URL("../js/theme-bootstrap.js", import.meta.url), "utf8"),
		readFile(new URL("../service-worker.js", import.meta.url), "utf8"),
	]);
	assert.match(themes, /:root\[data-theme="dark"\]/);
	assert.match(themes, /:root:not\(\[data-theme\]\)/);
	assert.match(appStyles, /:root\[data-theme="dark"\] \.tool-button img/);
	assert.match(appStyles, /:root:not\(\[data-theme\]\) \.tool-button img/);
	assert.doesNotMatch(appStyles, /drop-shadow/);
	for (const standaloneStyles of [macroStyles, docsStyles]) {
		assert.match(standaloneStyles, /:root\[data-theme="dark"\]/);
		assert.match(standaloneStyles, /:root:not\(\[data-theme\]\)/);
	}
	assert.match(macroPage, /src="js\/theme-bootstrap\.js"/);
	assert.match(docsPage, /src="\.\.\/js\/theme-bootstrap\.js"/);
	assert.match(index, /src="js\/theme-bootstrap\.js"/);
	assert.match(bootstrap, /sviber\.preferences/);
	assert.match(bootstrap, /sviber-theme-change/);
	assert.match(serviceWorker, /\.\/js\/theme-bootstrap\.js/);
	assert.match(index, /href="javascript\.html" target="sviber-license"/);
	assert.match(labels, /data-return-editor/);
	assert.match(labels, /data-view-source="js\/app\.js"/);
	assert.match(labels, /data-view-source="js\/theme-bootstrap\.js"/);
	assert.match(viewer, /href="javascript\.html"/);
	assert.match(viewer, /data-return-editor/);
	assert.match(navigation, /SOURCES\.has\(filename\)/);
});
