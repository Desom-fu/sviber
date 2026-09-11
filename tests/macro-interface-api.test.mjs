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

// Ruby 4.0 dropped base64 from the standard library and ruby.wasm's stdlib bundle does not
// ship the bundled gem, so the prelude has to provide the codec itself; the sandbox bridge
// and user macros both call Base64.strict_decode64.
test("the Ruby macro prelude survives a missing base64 gem", async () => {
	const rubyApi = await readSource("js/macro/macro-api.rb");
	assert.match(rubyApi, /begin\s*\n\s*require "base64"\s*\nrescue LoadError/);
	assert.match(rubyApi, /module Base64/);
	for (const method of [
		"strict_encode64",
		"strict_decode64",
		"encode64",
		"decode64",
		"urlsafe_encode64",
		"urlsafe_decode64",
	]) {
		assert.match(rubyApi, new RegExp(method), `Base64 fallback is missing ${method}`);
	}
	assert.doesNotMatch(rubyApi, /^require "base64"$/m, "a bare require would break the sandbox");
	assert.match(rubyApi, /\$LOADED_FEATURES << "base64\.rb"/, "user macros must be able to require base64");
});
