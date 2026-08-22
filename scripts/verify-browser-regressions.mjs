import assert from "node:assert/strict";

export async function runRegressionChecks(page) {
	const bpmButton = page.locator('#tool-bar [data-command="events.bpmChange"]');
	assert.equal(await bpmButton.evaluate(button => button.previousElementSibling?.getAttribute("role")), "separator");
	const inspectorVisibility = await page.evaluate(() => {
		const app = globalThis.sviber;
		const snapshot = app.model.snapshot();
		app.model.events = [];
		app.model.addEvent("tap", { time: [0, 0, 1], channel: app.model.channels[0].id, x: 0, y: 0, selected: true,
			tipPointSpawnType: "chain", tipPointSpawnAbsolutePosition: false, tipPointSpawnTimeBeats: false, tipPointSpawnTime: 1 });
		app.refreshNow();
		const rows = () => Object.fromEntries([...document.querySelectorAll("#inspector-panel .property-row")]
			.map(row => [row.querySelector("label")?.textContent || "", row.hidden]));
		const relativeSeconds = rows();
		const event = app.model.events[0];
		event.tipPointSpawnAbsolutePosition = true;
		event.tipPointSpawnTimeBeats = true;
		app.refreshNow();
		const absoluteBeats = rows();
		app.model.restore(snapshot);
		app.refreshNow();
		return { relativeSeconds, absoluteBeats };
	});
	assert.equal(inspectorVisibility.relativeSeconds["生成距离"], false);
	assert.equal(inspectorVisibility.relativeSeconds["生成方向"], false);
	assert.equal(inspectorVisibility.relativeSeconds["绝对"], true);
	assert.equal(inspectorVisibility.relativeSeconds["生成提前量（秒）"], false);
	assert.equal(inspectorVisibility.relativeSeconds["生成提前量（拍）"], true);
	assert.equal(inspectorVisibility.absoluteBeats["生成距离"], true);
	assert.equal(inspectorVisibility.absoluteBeats["生成方向"], true);
	assert.equal(inspectorVisibility.absoluteBeats["绝对"], false);
	assert.equal(inspectorVisibility.absoluteBeats["生成提前量（秒）"], true);
	assert.equal(inspectorVisibility.absoluteBeats["生成提前量（拍）"], false);
	await page.locator("#snappees-tab").click();
	const snappeeScroll = await page.evaluate(() => {
		const app = globalThis.sviber;
		const snapshot = app.model.snapshot();
		for (let index = 0; index < 12; index += 1) app.model.addSnappee("rectangularMesh", { name: `Scroll ${index}` });
		app.refreshNow();
		const panel = document.getElementById("snappees-panel");
		panel.scrollTop = 64;
		app.refreshNow();
		const value = panel.scrollTop;
		app.model.restore(snapshot);
		app.refreshNow();
		return value;
	});
	assert.equal(snappeeScroll, 64, "Snappees panel rerender reset its scroll position");
}
