import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MANUAL_FILES = ["en-US", "en", "zh-CN", "zh-TW", "ja-JP"];

test("v0.14.2 stores manual article HTML as readable line arrays", async () => {
	for (const language of MANUAL_FILES) {
		const manual = JSON.parse(await readFile(new URL(`../json/manual.${language}.json`, import.meta.url), "utf8"));
		assert.ok(Array.isArray(manual.article), `${language} article should be an array`);
		assert.ok(manual.article.length > 100, `${language} article should retain readable line breaks`);
		assert.equal(
			manual.article.join("\n").startsWith("\n"),
			true,
			`${language} article should preserve leading spacing`,
		);
	}
});

test("v0.14.2 joins readable manual articles before rendering", async () => {
	const source = await readFile(new URL("../docs/docs.js", import.meta.url), "utf8");
	assert.match(source, /Array\.isArray\(manual\.article\)/);
	assert.match(source, /manual\.article = manual\.article\.join\("\\n"\)/);
});
