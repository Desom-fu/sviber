import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const LANGUAGES = ["en-US", "zh-CN", "zh-TW", "ja-JP"];
const EXPECTED = {
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

test("v0.14.1 localizes every editor language selector option", async () => {
	const [source, dictionaries] = await Promise.all([
		readFile(new URL("../js/app/app-preferences-media.js", import.meta.url), "utf8"),
		Promise.all(LANGUAGES.map(async language => [
			language,
			JSON.parse(await readFile(new URL(`../json/i18n.${language}.json`, import.meta.url), "utf8")),
		])),
	]);
	assert.match(source, /SUPPORTED_LANGUAGES\.map\(value => \(\{ value, labelKey: `option\.language\.\$\{value\}` \}\)\)/);
	for (const [language, messages] of dictionaries) {
		for (const [selected, label] of Object.entries(EXPECTED[language])) {
			assert.equal(messages[`option.language.${selected}`], label, `${language} label for ${selected}`);
		}
		assert.equal(
			messages["option.language.chinese"],
			EXPECTED[language]["zh-CN"],
			`${language} legacy Chinese label`,
		);
	}
});

test("v0.14.1 localizes every manual language selector option", async () => {
	const source = await readFile(new URL("../docs/docs.js", import.meta.url), "utf8");
	assert.match(source, /option\.textContent = activeUi\.languages\[option\.value\]/);
	for (const language of LANGUAGES) {
		const manual = JSON.parse(await readFile(new URL(`../json/manual.${language}.json`, import.meta.url), "utf8"));
		assert.deepEqual(manual.ui.languages, EXPECTED[language]);
	}
});
