import assert from "node:assert/strict";
import path from "node:path";

export async function runClipLayoutChecks(page, outputDirectory) {
	const geometry = await page.evaluate(() => {
		const app = globalThis.sviber;
		const snapshot = app.model.snapshot();
		app.model.addClip({
			events: [{ type: "tap", time: [0, 0, 1], channel: 0, x: -40, y: 20 },
				{ type: "tap", time: [1, 0, 1], channel: 0, x: 40, y: -20 }],
			channels: [], snappees: [],
		}, "Clip 1");
		app.refreshNow();
		document.querySelector("#clips-tab").click();
		const row = document.querySelector(".clip-item");
		const thumbnail = row.querySelector(".clip-thumbnail").getBoundingClientRect();
		const name = row.querySelector(".snappee-name").getBoundingClientRect();
		const actions = [...row.querySelectorAll(".snappee-action")].map(element => element.getBoundingClientRect());
		const result = {
			columns: getComputedStyle(row).gridTemplateColumns,
			thumbnail: { left: thumbnail.left, right: thumbnail.right, width: thumbnail.width },
			name: { left: name.left, right: name.right },
			actions: actions.map(rectangle => ({ left: rectangle.left, right: rectangle.right, width: rectangle.width })),
			row: { left: row.getBoundingClientRect().left, right: row.getBoundingClientRect().right },
		};
		app.model.restore(snapshot);
		app.refreshNow();
		document.querySelector("#inspector-tab").click();
		return result;
	});
	assert.match(geometry.columns, /^42px\s/);
	assert.equal(geometry.actions.length, 5);
	assert.ok(Math.abs(geometry.thumbnail.width - 42) < 0.1);
	assert.ok(geometry.name.left >= geometry.thumbnail.right - 0.1,
		`clip name overlaps thumbnail: ${JSON.stringify(geometry)}`);
	assert.ok(geometry.actions[0].left >= geometry.name.right - 0.1,
		`clip name overlaps actions: ${JSON.stringify(geometry)}`);
	assert.ok(geometry.actions.at(-1).right <= geometry.row.right + 0.1,
		`clip actions overflow row: ${JSON.stringify(geometry)}`);
	await page.locator("#clips-tab").click();
	await page.locator("#clips-panel").screenshot({ path: path.join(outputDirectory, "sviber-clips-layout.png") });
	await page.locator("#inspector-tab").click();
	return geometry;
}
