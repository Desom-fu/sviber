import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CHECK_DEFINITIONS } from "../js/core/checks-config.js";
import { I18n, MESSAGES } from "../js/ui/i18n.js";

test("localization is loaded from matching JSON dictionaries", async () => {
	const [source, english, chinese, index] = await Promise.all([
		readFile(new URL("../js/ui/i18n.js", import.meta.url), "utf8"),
		readFile(new URL("../json/i18n.en-US.json", import.meta.url), "utf8").then(JSON.parse),
		readFile(new URL("../json/i18n.zh-CN.json", import.meta.url), "utf8").then(JSON.parse),
		readFile(new URL("../index.html", import.meta.url), "utf8"),
	]);
	assert.match(source, /i18n\.en-US\.json/);
	assert.match(source, /i18n\.zh-CN\.json/);
	assert.deepEqual(Object.keys(english).sort(), Object.keys(chinese).sort());
	assert.equal(english["option.language.chinese"], "Simplified Chinese");
	assert.equal(MESSAGES["en-US"]["option.language.chinese"], "Simplified Chinese");
	assert.equal(chinese["option.language.english"], "英文");
	assert.equal(english["option.language.zh-TW"], "Traditional Chinese");
	assert.equal(chinese["option.language.zh-TW"], "繁体中文");
	assert.equal(english["footer.javascriptLicense"], "JavaScript license information");
	assert.equal(chinese["footer.javascriptLicense"], "JavaScript 许可信息");
	assert.match(index, /data-i18n="footer\.javascriptLicense"/);
});

test("history labels are translated again after the interface language changes", () => {
	const translations = new I18n("en-US");
	const english = translations.t("history.createEvent", { type: translations.t("event.tap") });
	translations.setLanguage("zh-CN", null);
	assert.equal(translations.localize(english), "创建 Tap");
	assert.equal(translations.localize("Ungroup events"), "解组事件");
});

test("Chinese calls Lyrica 阳春白雪", async () => {
	const zh = JSON.parse(await readFile(new URL("../json/i18n.zh-CN.json", import.meta.url), "utf8"));
	assert.match(zh["command.file.exportLyrica"], /阳春白雪/);
	assert.match(zh["dialog.importLyrica"], /阳春白雪/);
	assert.match(zh["toast.lyricaExported"], /阳春白雪/);
});

test("language options are localized in each interface", () => {
	const expected = {
		"en-US": ["English", "Simplified Chinese", "Traditional Chinese", "Japanese"],
		"zh-CN": ["英文", "简体中文", "繁体中文", "日文"],
		"zh-TW": ["英文", "簡體中文", "繁體中文", "日文"],
		"ja-JP": ["英語", "簡体字中国語", "繁体字中国語", "日本語"],
	};
	for (const [language, names] of Object.entries(expected)) {
		for (const [index, name] of names.entries()) {
			assert.equal(MESSAGES[language][`option.language.${["en-US", "zh-CN", "zh-TW", "ja-JP"][index]}`], name);
		}
	}
});

// A check parameter whose label or hint key is missing renders as the raw key inside the
// checks dialog (v0.16.27 fixed check.conflictingBgPatterns.strict), so every definition the
// dialog builds a key from is required in every dictionary.
test("every check definition and parameter has its label and hint localized", async () => {
	const languages = ["zh-CN", "zh-TW", "en-US", "ja-JP"];
	const tables = await Promise.all(
		languages.map(language =>
			readFile(new URL(`../json/i18n.${language}.json`, import.meta.url), "utf8").then(JSON.parse),
		),
	);
	const required = [];
	for (const definition of CHECK_DEFINITIONS) {
		required.push(`check.${definition.id}`, `check.${definition.id}.hint`);
		for (const parameter of definition.parameters) {
			required.push(`check.${definition.id}.${parameter.id}`, `check.${definition.id}.${parameter.id}.hint`);
		}
	}
	for (const [index, language] of languages.entries()) {
		const missing = required.filter(key => !(key in tables[index]));
		assert.deepEqual(missing, [], `${language} is missing check keys: ${missing.join(", ")}`);
	}
});
