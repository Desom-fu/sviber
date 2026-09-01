import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MANUAL_FILES = ["en-US", "zh-CN", "zh-TW", "ja-JP"];

test("manual article HTML remains stored as readable language-specific fragments", async () => {
	for (const language of MANUAL_FILES) {
		const source = await readFile(new URL(`../docs/manual.${language}.html`, import.meta.url), "utf8");
		const lines = source.split(/\r?\n/);
		const article = source;
		assert.ok(lines.length > 500, `${language} article should retain semantic segments`);
		assert.doesNotMatch(article, /id="(?:en|zh)-v[0-9]+"/, `${language} article should not append a release summary`);
		const longestLine = Math.max(...lines.map(line => line.length));
		assert.ok(longestLine <= 120, `${language} manual line is too long: ${longestLine}`);
		assert.ok(
			lines.filter(part => /<\/(?:h[1-4]|p|li|tr|th|td)>/.test(part)).length > 100,
			`${language} article should split at HTML element boundaries`,
		);
		for (const part of lines) {
			assert.doesNotMatch(part, /<[^>]*$/, `${language} article contains a split HTML tag`);
		}
		assert.equal(
			article.startsWith("\n"),
			true,
			`${language} article should preserve leading spacing`,
		);
	}
});

test("manual loader fetches language-specific HTML fragments before rendering", async () => {
	const source = await readFile(new URL("../docs/docs.js", import.meta.url), "utf8");
	assert.match(source, /fetch\(`manual\.\$\{language\}\.html`/);
	assert.match(source, /articleSource\.replace\(\/<!---->\\r\?\\n/);
	assert.match(source, /fetch\(`\.\.\/json\/i18n\.\$\{language\}\.json`/);
	assert.match(source, /contents\.setAttribute\("aria-label", activeUi\.contentsLabel\)/);
});
