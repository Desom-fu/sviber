import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MESSAGES, SUPPORTED_LANGUAGES } from "../js/ui/i18n.js";
import { monacoLocale } from "../js/macro/macro-completions.js";

test("macro window resolves every supported language", async () => {
	const source = await readFile(new URL("../js/macro/macros.js", import.meta.url), "utf8");
	assert.match(source, /SUPPORTED_LANGUAGES\.includes\(query\)/);
	assert.match(source, /SUPPORTED_LANGUAGES\.includes\(stored\)/);
	assert.match(source, /normalizeLanguage\(navigator\.language\)/);
	assert.match(source, /t\("closeTab"\)/);
	assert.equal(monacoLocale("zh-TW"), "zh-tw");
	assert.equal(monacoLocale("ja-JP"), "ja");
	assert.equal(monacoLocale("fr-FR"), "en");
	for (const language of SUPPORTED_LANGUAGES) {
		assert.ok(MESSAGES[language]["macro.editor.aria"]);
		assert.ok(MESSAGES[language]["macro.closeTab"]);
	}
	assert.notEqual(MESSAGES["zh-TW"]["macro.page.title"], MESSAGES["en-US"]["macro.page.title"]);
	assert.notEqual(MESSAGES["ja-JP"]["macro.page.title"], MESSAGES["en-US"]["macro.page.title"]);
	const page = await readFile(new URL("../macros.html", import.meta.url), "utf8");
	assert.match(page, /data-i18n-aria="editor\.aria"/);
});
