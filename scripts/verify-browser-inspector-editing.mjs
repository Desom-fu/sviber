// Checks for editing through the inspector: the tip-point fields appear and hide with the spawn
// mode, numeric fields accept expressions and undo cleanly, and a batch type change carries the
// edited duration into the next note created with the tool.
import assert from "node:assert/strict";

async function checkTipPointInspectorFields(page) {
	await page.waitForFunction(() =>
		document.querySelector("#inspector-panel")?.textContent.includes("生成提前量（秒）"),
	);
	const inspectorText = await page.locator("#inspector-panel").textContent();
	for (const label of [
		"生成类型",
		"生成位置",
		"生成距离",
		"生成方向",
		"时间单位",
		"生成提前量（秒）",
		"生成提前量（拍）",
	]) {
		assert.ok(inspectorText.includes(label), `tip point inspector is missing ${label}`);
	}
	const inspectorChoices = page.locator('#inspector-panel input[type="radio"]');
	assert.equal(await inspectorChoices.count(), 4);
	assert.equal(await page.locator('#inspector-panel input[type="radio"][value="relative"]').isChecked(), true);
	assert.equal(await page.locator('#inspector-panel input[type="radio"][value="seconds"]').isChecked(), true);
	assert.equal(
		await page.locator('#inspector-panel label[title="绝对"] + .attached-input').getAttribute("data-hidden"),
		"true",
	);
	assert.equal(
		await page.locator('#inspector-panel label[title="生成距离"] + input').getAttribute("data-hidden"),
		"true",
		"tip-point spawn fields must be hidden for inherit mode",
	);
	await page.locator('#inspector-panel label[title="生成类型"] + select').selectOption("chain");
	assert.equal(
		await page.locator('#inspector-panel label[title="生成距离"] + input').getAttribute("data-hidden"),
		"true",
		"mixed chain/inherit selection must keep spawn fields disabled",
	);
	await page.evaluate(() => {
		const firstSelected = globalThis.sviber.model.events.find(event => event.selected);
		if (firstSelected) {
			globalThis.sviber.selectEvents([firstSelected.id], "replace");
		}
	});
	await page.waitForFunction(() => globalThis.sviber.model.events.filter(event => event.selected).length === 1);
	await page.waitForFunction(
		() => !document.querySelector('#inspector-panel label[title="生成距离"] + input')?.disabled,
	);
}

async function checkExpressionInputsAndUndo(page) {
	const positionX = page.locator('#inspector-panel label[title="位置"] + .attached-input input').first();
	await positionX.fill("100 / 4");
	await positionX.press("Tab");
	await page.waitForFunction(() =>
		globalThis.sviber.model.events.filter(event => event.selected).every(event => event.x === 25),
	);
	await page.evaluate(() => document.activeElement?.blur());
	await page.keyboard.press("Control+z");
	await page.waitForFunction(() =>
		globalThis.sviber.model.events.filter(event => event.selected).some(event => event.x !== 25),
	);
	const radiansToggle = page.locator(
		'#inspector-panel label[title="生成方向"] + .angle-input input[type="checkbox"]',
	);
	await radiansToggle.check();
	const directionInput = page.locator('#inspector-panel label[title="生成方向"] + .angle-input > input');
	await directionInput.fill("pi / 3");
	await directionInput.press("Tab");
	await page.waitForFunction(() =>
		globalThis.sviber.model.events
			.filter(event => event.selected)
			.every(event => Math.abs(event.tipPointSpawnAngle - Math.PI / 3) < 1e-9),
	);

	await page.evaluate(() =>
		globalThis.sviber.selectEvents(
			globalThis.sviber.model.events.map(event => event.id),
			"replace",
		),
	);
}

async function checkBatchTypeAndDuration(page) {
	const stage = page.locator("#stage-surface canvas");
	await page.waitForFunction(() => globalThis.sviber.model.events.every(event => event.selected));
	const eventType = page.locator('#inspector-panel label[title="类型"] + select');
	await eventType.selectOption("bgNote");
	await page.waitForFunction(() => globalThis.sviber.model.events.every(event => event.type === "bgNote"));
	await page.waitForSelector('#inspector-panel label[title="持续拍数"] + .rational-input');
	await page.evaluate(() => {
		const inputs = [
			...document
				.querySelector('#inspector-panel label[title="持续拍数"] + .rational-input')
				.querySelectorAll("input"),
		];
		inputs[0].value = "0";
		inputs[1].value = "0";
		inputs[2].value = "1";
		inputs[2].dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
	});
	await page.waitForFunction(() =>
		globalThis.sviber.model.events.every(event => JSON.stringify(event.duration) === JSON.stringify([0, 0, 1])),
	);
	await page.evaluate(() => document.activeElement?.blur());
	await page.keyboard.press("Control+d");
	await page.locator('.tool-button[data-command="events.bgNote"]').click();
	const defaultDurationStageBox = await stage.boundingBox();
	await page.mouse.click(
		defaultDurationStageBox.x + defaultDurationStageBox.width * 0.72,
		defaultDurationStageBox.y + defaultDurationStageBox.height * 0.64,
	);
	await page.waitForFunction(() => globalThis.sviber.model.events.length === 3);
	assert.deepEqual(
		await page.evaluate(() => globalThis.sviber.model.events.find(event => event.selected).duration),
		[0, 0, 1],
		"bgNote creation did not remember the edited duration",
	);
	await page.keyboard.press("Escape");
	await page.keyboard.press("Control+a");
}

export async function runInspectorEditingChecks(page) {
	await checkTipPointInspectorFields(page);
	await checkExpressionInputsAndUndo(page);
	await checkBatchTypeAndDuration(page);
}
