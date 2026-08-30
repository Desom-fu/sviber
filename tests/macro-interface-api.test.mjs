import assert from "node:assert/strict";
import test from "node:test";
import { assertSourceContracts, readJson, readSource } from "./audit-contract-helpers.mjs";

test("macro interface sandbox Monaco API and documentation are present", async () => {
	const [page, macros, sandbox, jsApi, rubyApi, completions, manualEn, manualZh] = await Promise.all([
		readSource("macros.html"),
		readSource("js/macro/macros.js"),
		readSource("js/macro/macro-sandbox.js"),
		readSource("js/macro/macro-api.js"),
		readSource("js/macro/macro-api.rb"),
		readSource("js/macro/macro-completions.js"),
		readJson("json/manual.en.json"),
		readJson("json/manual.zh-CN.json"),
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
	assert.match(manualEn.article + manualZh.article, /Macros API|宏 API|TipPoint|Clip/);
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
