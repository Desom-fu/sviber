import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MANUAL_FILES = ["en-US", "en", "zh-CN", "zh-TW", "ja-JP"];

test("manual article HTML remains stored as readable semantic segments", async () => {
	for (const language of MANUAL_FILES) {
		const source = await readFile(new URL(`../json/manual.${language}.json`, import.meta.url), "utf8");
		const manual = JSON.parse(source);
		assert.ok(Array.isArray(manual.article), `${language} article should be an array`);
		assert.ok(manual.article.length > 500, `${language} article should retain semantic segments`);
		const article = manual.article.join("");
		assert.doesNotMatch(article, /id="(?:en|zh)-v[0-9]+"/, `${language} article should not append a release summary`);
		const longestLine = Math.max(...source.split(/\r?\n/).map(line => line.length));
		assert.ok(longestLine <= 120, `${language} manual line is too long: ${longestLine}`);
		assert.ok(
			manual.article.filter(part => /<\/(?:h[1-4]|p|li|tr|th|td)>/.test(part)).length > 100,
			`${language} article should split at HTML element boundaries`,
		);
		for (const part of manual.article) {
			assert.doesNotMatch(part, /<[^>]*$/, `${language} article contains a split HTML tag`);
		}
		assert.equal(
			article.startsWith("\n"),
			true,
			`${language} article should preserve leading spacing`,
		);
	}
});

test("manual loader joins readable article arrays before rendering", async () => {
	const source = await readFile(new URL("../docs/docs.js", import.meta.url), "utf8");
	assert.match(source, /Array\.isArray\(manual\.article\)/);
	assert.match(source, /manual\.article = manual\.article\.join\(""\)/);
});
