import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SNAPPEE_PRESETS, createPresetSnappee } from "../js/core/snappee-presets.js";

test("preset snappees keep documented geometry and localized-ready ids", () => {
	assert.deepEqual(
		SNAPPEE_PRESETS.map(item => item.id),
		["playfieldGrid", "turntable", "hexagon1", "hexagon2", "hexagon3", "hexagon4", "pentagon"],
	);
	const grid = createPresetSnappee("playfieldGrid", "Grid");
	assert.equal(grid.type, "rectangularMesh");
	assert.deepEqual(
		[grid.topLeftX, grid.topLeftY, grid.bottomRightX, grid.bottomRightY, grid.horizontalTiles, grid.verticalTiles],
		[-100, 50, 100, -50, 16, 8],
	);
});

test("preset snappee labels retain the matching legacy default names", async () => {
	const [english, chinese] = await Promise.all([
		readFile(new URL("../json/i18n.en-US.json", import.meta.url), "utf8"),
		readFile(new URL("../json/i18n.zh-CN.json", import.meta.url), "utf8"),
	]);
	const labels = JSON.parse(english);
	const labelsZh = JSON.parse(chinese);
	assert.deepEqual(
		SNAPPEE_PRESETS.map(({ id }) => labels[`snappee.preset.${id}`]),
		[
			"Playfield grid",
			"Radial grid",
			"Outer hexagon",
			"Middle hexagon",
			"Smallest hexagon",
			"Inner hexagon",
			"Pentagon",
		],
	);
	assert.deepEqual(
		SNAPPEE_PRESETS.map(({ id }) => labelsZh[`snappee.preset.${id}`]),
		["游玩区域网格", "径向网格", "外六边形", "中六边形", "最小六边形", "内六边形", "五边形"],
	);
});
