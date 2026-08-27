import assert from "node:assert/strict";

async function checkToolbarSeparator(page) {
	const bpmButton = page.locator('#tool-bar [data-command="events.bpmChange"]');
	assert.equal(await bpmButton.evaluate(button => button.previousElementSibling?.getAttribute("role")), "separator");
}

async function measureInspectorVisibility(page) {
	return page.evaluate(() => {
		const app = globalThis.sviber;
		const snapshot = app.model.snapshot();
		app.model.events = [];
		app.model.addEvent("tap", {
			time: [0, 0, 1],
			channel: app.model.channels[0].id,
			x: 0,
			y: 0,
			selected: true,
			tipPointSpawnType: "chain",
			tipPointSpawnAbsolutePosition: false,
			tipPointSpawnTimeBeats: false,
			tipPointSpawnTime: 1,
		});
		app.refreshNow();
		const rows = () =>
			Object.fromEntries(
				[...document.querySelectorAll("#inspector-panel .property-row")].map(row => [
					row.querySelector("label")?.textContent || "",
					{
						hidden: row.hidden,
						display: getComputedStyle(row).display,
					},
				]),
			);
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
}

async function checkTipPointInspectorRows(page) {
	const inspectorVisibility = await measureInspectorVisibility(page);
	assert.equal(inspectorVisibility.relativeSeconds["生成距离"].hidden, false);
	assert.equal(inspectorVisibility.relativeSeconds["生成距离"].display, "grid");
	assert.equal(inspectorVisibility.relativeSeconds["生成方向"].hidden, false);
	assert.equal(inspectorVisibility.relativeSeconds["生成方向"].display, "grid");
	assert.equal(inspectorVisibility.relativeSeconds["绝对"].hidden, true);
	assert.equal(inspectorVisibility.relativeSeconds["绝对"].display, "none");
	assert.equal(inspectorVisibility.relativeSeconds["附着"].hidden, true);
	assert.equal(inspectorVisibility.relativeSeconds["附着"].display, "none");
	assert.equal(inspectorVisibility.relativeSeconds["生成提前量（秒）"].hidden, false);
	assert.equal(inspectorVisibility.relativeSeconds["生成提前量（拍）"].hidden, true);
	assert.equal(inspectorVisibility.absoluteBeats["生成距离"].hidden, true);
	assert.equal(inspectorVisibility.absoluteBeats["生成距离"].display, "none");
	assert.equal(inspectorVisibility.absoluteBeats["生成方向"].hidden, true);
	assert.equal(inspectorVisibility.absoluteBeats["生成方向"].display, "none");
	assert.equal(inspectorVisibility.absoluteBeats["绝对"].hidden, false);
	assert.equal(inspectorVisibility.absoluteBeats["绝对"].display, "grid");
	assert.equal(inspectorVisibility.absoluteBeats["生成提前量（秒）"].hidden, true);
	assert.equal(inspectorVisibility.absoluteBeats["生成提前量（拍）"].hidden, false);
}

async function checkChannelDropdownLabels(page) {
	const channelLabels = await page.evaluate(() => {
		const app = globalThis.sviber;
		const snapshot = app.model.snapshot();
		app.model.channels[0].name = "Lead";
		app.model.addChannel(app.model.channels.length, { name: "Harmony" });
		app.model.events = [];
		app.model.addEvent("tap", {
			time: [0, 0, 1],
			channel: app.model.channels[0].id,
			x: 0,
			y: 0,
			selected: true,
		});
		app.refreshNow();
		const select = [...document.querySelectorAll("#inspector-panel .property-row")]
			.find(row => row.querySelector("label")?.textContent === "通道")
			?.querySelector("select");
		const labels = [...(select?.options || [])].map(option => option.textContent);
		app.model.restore(snapshot);
		app.refreshNow();
		return labels;
	});
	assert.ok(channelLabels.includes("Lead"), `channel dropdown missing names: ${JSON.stringify(channelLabels)}`);
	assert.ok(channelLabels.includes("Harmony"), `channel dropdown missing names: ${JSON.stringify(channelLabels)}`);
	assert.ok(
		!channelLabels.some(label => /^\d+$/.test(label)),
		`ordinal-only channel labels: ${JSON.stringify(channelLabels)}`,
	);
}

async function checkSnappeePanelScrollRetention(page) {
	await page.locator("#snappees-tab").click();
	const snappeeScroll = await page.evaluate(() => {
		const app = globalThis.sviber;
		const snapshot = app.model.snapshot();
		for (let index = 0; index < 12; index += 1) {
			app.model.addSnappee("rectangularMesh", { name: `Scroll ${index}` });
		}
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

export async function runRegressionChecks(page) {
	await checkToolbarSeparator(page);
	await checkTipPointInspectorRows(page);
	await checkChannelDropdownLabels(page);
	await checkSnappeePanelScrollRetention(page);
}
