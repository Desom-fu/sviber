import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readManual } from "./module-source.mjs";
import { ChartModel } from "../js/core/chart-model.js";
import { fillInheritedTipPointParams, inheritedTipPointSource } from "../js/core/tip-point.js";

test("inspector hides inactive tip-point input rows and preserves panel scroll", async () => {
	const [panels, lists, css] = await Promise.all([
		readFile(new URL("../js/ui/panels.js", import.meta.url), "utf8"),
		readFile(new URL("../js/ui/panel-lists.js", import.meta.url), "utf8"),
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
	]);
	assert.match(css, /\.property-row\[hidden\]\s*\{\s*display:\s*none;/);
	assert.match(panels, /control\?\.dataset\?\.hidden === "true"\)\s*\{?\s*row\.hidden = true/);
	assert.match(panels, /setControlHidden\(distanceControl, !spawnFieldsEnabled \|\| absolute !== false\)/);
	assert.match(
		panels,
		/setControlHidden\(absoluteWrapper, !spawnFieldsEnabled \|\| absolute !== true \|\| attached === true\)/,
	);
	assert.match(panels, /setControlHidden\(secondsControl, !spawnFieldsEnabled \|\| timeInBeats !== false\)/);
	assert.match(panels, /setControlHidden\(beatsControl, !spawnFieldsEnabled \|\| timeInBeats !== true\)/);
	assert.match(lists, /const scrollTop = Number\(this\.element\.scrollTop\)/);
	assert.match(lists, /this\.element\.scrollTop = scrollTop/);
});

test("actually hides inapplicable tip-point inspector rows", async () => {
	const [css, panels, regressions, manual] = await Promise.all([
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
		readFile(new URL("../js/ui/panels.js", import.meta.url), "utf8"),
		readFile(new URL("../scripts/verify-browser-regressions.mjs", import.meta.url), "utf8"),
		readManual(),
	]);
	assert.match(css, /\.property-row\[hidden\]\s*\{\s*display:\s*none;/);
	assert.match(panels, /label: String\(item\.name \|\| `Channel \$\{index \+ 1\}`\)/);
	assert.match(regressions, /getComputedStyle\(row\)\.display/);
	assert.match(regressions, /relativeSeconds\["绝对"\]\.display, "none"/);
	assert.match(regressions, /absoluteBeats\["生成距离"\]\.display, "none"/);
	assert.match(regressions, /channelLabels.includes\("Lead"\)/);
	assert.match(regressions, /ordinal-only channel labels/);
	assert.match(manual, /unused fields are hidden/);
	assert.match(manual, /不适用的输入行会隐藏/);
	assert.match(manual, /channel dropdown lists channel names/);
	assert.match(manual, /通道下拉菜单显示通道名称/);
});

test("inherit/none hide spawn fields and inherit to chain copies inherited params", () => {
	const model = ChartModel.createDefault({
		channels: [{ id: 0 }],
		events: [
			{
				id: 1,
				type: "tap",
				time: [1, 0, 1],
				channel: 0,
				x: 0,
				y: 0,
				tipPointSpawnType: "drop",
				tipPointSpawnAbsolutePosition: true,
				tipPointSpawnX: 12,
				tipPointSpawnY: -8,
				tipPointSpawnTime: 1.5,
			},
			{ id: 2, type: "tap", time: [2, 0, 1], channel: 0, x: 10, y: 0, tipPointSpawnType: "inherit" },
		],
	});
	const next = model.events[1];
	assert.equal(inheritedTipPointSource(model.events, next).id, 1);
	fillInheritedTipPointParams(next, model.events);
	assert.equal(next.tipPointSpawnAbsolutePosition, true);
	assert.equal(next.tipPointSpawnX, 12);
	assert.equal(next.tipPointSpawnY, -8);
});
