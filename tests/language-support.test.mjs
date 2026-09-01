import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MESSAGES, SUPPORTED_LANGUAGES, i18n, normalizeLanguage } from "../js/ui/i18n.js";
import { localizedErrorMessage } from "../js/app/app-helpers.js";

test("interface language support uses four languages with an English fallback", () => {
	assert.deepEqual([...SUPPORTED_LANGUAGES], ["en-US", "zh-CN", "zh-TW", "ja-JP"]);
	assert.equal(normalizeLanguage("zh-HK"), "zh-TW");
	assert.equal(normalizeLanguage("ja-JP"), "ja-JP");
	assert.equal(normalizeLanguage("fr-FR"), "en-US");
	for (const language of SUPPORTED_LANGUAGES) {
		assert.ok(MESSAGES[language]["option.language.zh-CN"]);
		assert.ok(MESSAGES[language]["option.language.ja-JP"]);
	}
});

test("interface and manual language names follow the active language", async () => {
	const names = {
		"en-US": {
			"en-US": "English",
			"zh-CN": "Simplified Chinese",
			"zh-TW": "Traditional Chinese",
			"ja-JP": "Japanese",
		},
		"zh-CN": {
			"en-US": "英文",
			"zh-CN": "简体中文",
			"zh-TW": "繁体中文",
			"ja-JP": "日文",
		},
		"zh-TW": {
			"en-US": "英文",
			"zh-CN": "簡體中文",
			"zh-TW": "繁體中文",
			"ja-JP": "日文",
		},
		"ja-JP": {
			"en-US": "英語",
			"zh-CN": "簡体字中国語",
			"zh-TW": "繁体字中国語",
			"ja-JP": "日本語",
		},
	};
	for (const messages of Object.values(MESSAGES)) {
		const activeLanguage = Object.entries(MESSAGES).find(([, candidate]) => candidate === messages)?.[0];
		for (const [language, name] of Object.entries(names[activeLanguage])) {
			assert.equal(messages[`option.language.${language}`], name);
		}
	}
	for (const language of SUPPORTED_LANGUAGES) {
		const manual = JSON.parse(await readFile(new URL(`../json/manual.${language}.json`, import.meta.url), "utf8"));
		assert.deepEqual(manual.ui.languages, names[language]);
	}
	const licensePage = await readFile(new URL("../js/boot/license-page.js", import.meta.url), "utf8");
	assert.match(licensePage, /SUPPORTED_LANGUAGES/);
	assert.match(licensePage, /zh-tw/);
	assert.match(licensePage, /ja/);
});

test("project manifest filenames are localized in errors", () => {
	const previous = i18n.language;
	try {
		i18n.setLanguage("zh-TW", null);
		assert.match(localizedErrorMessage(new Error("The selected folder already contains project.sviber.")), /project\.sviber/);
		assert.match(localizedErrorMessage(new Error("The directory does not contain a Sviber project manifest.")), /project\.sviber/);
	} finally {
		i18n.setLanguage(previous, null);
	}
});
