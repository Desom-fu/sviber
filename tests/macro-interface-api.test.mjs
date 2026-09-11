import assert from "node:assert/strict";
import test from "node:test";
import { assertSourceContracts, readSource } from "./audit-contract-helpers.mjs";
import { manualArticle } from "./module-source.mjs";

test("macro interface sandbox Monaco API and documentation are present", async () => {
	const [page, macros, sandbox, jsApi, rubyApi, completions, manualEn, manualZh] = await Promise.all([
		readSource("macros.html"),
		readSource("js/macro/macros.js"),
		readSource("js/macro/macro-sandbox.js"),
		readSource("js/macro/macro-api.js"),
		readSource("js/macro/macro-api.rb"),
		readSource("js/macro/macro-completions.js"),
		readSource("docs/manual.en-US.html"),
		readSource("docs/manual.zh-CN.html"),
	]);
	assert.match(page, /sidebar|console|editor|macro/);
	assert.match(macros, /localStorage|Monaco|F8|runMacro|renderTabs|closeTab/);
	assert.match(sandbox, /iframe|postMessage|console/);
	const apiNames = [
		"Chart",
		"Vector2D",
		"AffineMatrix2D",
		"Location",
		"TipPoint",
		"BpmChange",
		"BarLine",
		"Channel",
		"Snappee",
		"Event",
		"Clip",
	];
	for (const name of apiNames) {
		assert.match(jsApi + rubyApi, new RegExp(name));
	}
	assert.match(completions, /completion|Chart|Event|Snappee/);
	assert.match(manualArticle(manualEn) + manualArticle(manualZh), /Macros API|宏 API|TipPoint|Clip/);
});

test("macro API classes and global helpers expose the documented surface", async () => {
	await assertSourceContracts([
		["js/macro/macro-api-chart.js", [/class Clip|createChartFacade/]],
		["js/macro/macro-api-event.js", [/class Event|ensureAlive/]],
		["js/macro/macro-api-location.js", [/class Location|attach|detach/]],
		["js/macro/macro-api-math.js", [/Vector2D|AffineMatrix2D|normalizeColor/]],
		["js/macro/macro-api.js", [/bBang|bpm|tpc|tpd|transform/]],
		["js/macro/macro-api.rb", [/bg_note|AffineMatrix2D|to_ary|Rational/]],
	]);
});

// ruby.wasm boots with RubyGems disabled, so the libraries Ruby 4.0 moved out of the
// standard library (base64 among them) are bundled gems in the image but unresolvable until
// RubyGems is loaded. The prelude must load RubyGems before requiring them.
test("the Ruby macro prelude loads RubyGems before the bundled base64 gem", async () => {
	const rubyApi = await readSource("js/macro/macro-api.rb");
	const rubygemsIndex = rubyApi.indexOf('require "rubygems"');
	const base64Index = rubyApi.indexOf('require "base64"');
	assert.ok(rubygemsIndex >= 0, "the prelude must load RubyGems");
	assert.ok(base64Index > rubygemsIndex, "base64 must be required after RubyGems is loaded");
	assert.doesNotMatch(rubyApi, /rescue LoadError/, "the gem ships with the runtime; no shim is needed");
});
