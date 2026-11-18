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

export async function checkHistoryTrim(page) {
	const result = await page.evaluate(async () => {
		const [{ History }, { HistoryPanel }, { I18n }] = await Promise.all([
			import("./js/core/history.js"),
			import("./js/ui/panel-history.js"),
			import("./js/ui/i18n.js"),
		]);
		let history = new History(0);
		for (let value = 1; value < history.limit; value++) {
			history.record(value, "Create Tap");
		}
		history.goTo(2);
		history.markCurrent("save");
		history.goTo(history.length - 1);
		const element = document.createElement("div");
		const i18n = new I18n("en-US");
		let jumpedTo;
		const panel = new HistoryPanel({ element, i18n, onGoTo: index => (jumpedTo = history.goTo(index)) });
		panel.sync(history);
		const original = new Set(element.children);
		const savedRow = element.children[2];
		const savedIcon = savedRow.querySelector(".history-marker");

		history.record(1000, "Change selection");
		panel.sync(history);
		const retainedRows = [...element.children].filter(button => original.has(button)).length;
		const markerRetained = savedRow.querySelector(".history-marker") === savedIcon;
		savedRow.click();
		panel.sync(history);
		const navigation = {
			value: jumpedTo,
			current: savedRow.classList.contains("is-current"),
			future: savedRow.nextElementSibling.classList.contains("is-future"),
		};

		history.markCurrent("autosave");
		history.record(1001, "Change selection");
		i18n.setLanguage("zh-CN", null);
		panel.sync(history, { readOnly: true });
		const branch = {
			rows: element.children.length,
			retained: savedRow === element.children[1],
			label: savedRow.querySelector(".history-label").textContent,
			markers: [...savedRow.querySelectorAll(".history-marker")].map(icon => icon.alt),
			disabled: savedRow.disabled,
			lastLabel: element.lastElementChild.querySelector(".history-label").textContent,
		};

		history = new History(-1, { initialLabel: "Other chart" });
		history.record(-2, "Other edit");
		panel.sync(history);
		element.lastElementChild.click();
		return {
			retainedRows,
			markerRetained,
			navigation,
			branch,
			otherChart: [element.firstElementChild.querySelector(".history-label").textContent, jumpedTo],
		};
	});
	assert.deepEqual(result, {
		retainedRows: 999,
		markerRetained: true,
		navigation: { value: 2, current: true, future: true },
		branch: {
			rows: 3,
			retained: true,
			label: "创建 Tap",
			markers: ["手动保存", "自动保存"],
			disabled: true,
			lastLabel: "更改选择",
		},
		otherChart: ["Other chart", -2],
	});
}

export async function runRegressionChecks(page) {
	await checkToolbarSeparator(page);
	await checkTipPointInspectorRows(page);
	await checkChannelDropdownLabels(page);
	await checkSnappeePanelScrollRetention(page);
	await checkHistoryTrim(page);
}
