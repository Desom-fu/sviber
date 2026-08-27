// Checks for the editor chrome: the File menu popup escapes the app chrome without leaving the
// viewport, a modal dialog can be dragged and swallows menu and command shortcuts, and the tool
// buttons toggle creation modes without losing the subdivision.
import assert from "node:assert/strict";

async function checkMenuPopupGeometry(page) {
	await page.locator('.menu-root[data-menu-id="file"] .menu-root-button').click();
	const menuGeometry = await page.evaluate(() => {
		const popup = document.querySelector('.menu-root[data-menu-id="file"] .menu-popup').getBoundingClientRect();
		const chrome = document.querySelector(".app-chrome").getBoundingClientRect();
		return {
			popup: { top: popup.top, bottom: popup.bottom, left: popup.left, right: popup.right },
			chromeBottom: chrome.bottom,
			innerWidth,
		};
	});
	assert.ok(
		menuGeometry.popup.top < menuGeometry.chromeBottom &&
			menuGeometry.popup.bottom > menuGeometry.chromeBottom + 20,
		`menu popup is clipped by the chrome: ${JSON.stringify(menuGeometry)}`,
	);
	assert.ok(
		menuGeometry.popup.left >= 0 && menuGeometry.popup.right <= menuGeometry.innerWidth + 1,
		`menu popup is outside the viewport: ${JSON.stringify(menuGeometry)}`,
	);
}

async function checkModalDialogIsolation(page) {
	await page.locator('.menu-command[data-command="file.chartProperties"]').click();
	const dialog = page.locator(".dialog");
	await dialog.waitFor();
	assert.match(await dialog.locator(".dialog-titlebar").textContent(), /谱面属性/);
	const beforeDrag = await dialog.boundingBox();
	const titleBox = await dialog.locator(".dialog-titlebar").boundingBox();
	await page.mouse.move(titleBox.x + 80, titleBox.y + titleBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(titleBox.x + 120, titleBox.y + titleBox.height / 2 + 30);
	await page.mouse.up();
	const afterDrag = await dialog.boundingBox();
	assert.ok(
		Math.abs(afterDrag.x - beforeDrag.x) > 10 || Math.abs(afterDrag.y - beforeDrag.y) > 10,
		"dialog did not move",
	);
	await page.keyboard.press("Alt+f");
	assert.equal(await page.locator(".menu-root.is-open").count(), 0, "a menu opened behind the modal dialog");
	await page.keyboard.press("t");
	assert.equal(
		await page.evaluate(() => globalThis.sviber.creationMode),
		null,
		"a command shortcut ran behind the modal dialog",
	);
	await dialog.locator('[data-dialog-action="cancel"]').click();
}

async function checkToolButtonsAndCreation(page) {
	await page.locator('.tool-button[data-command="events.tap"]').click();
	await page.waitForFunction(() => globalThis.sviber.creationMode === "tap");
	await page.locator('.tool-button[data-command="music.subdivision4"]').click();
	await page.waitForFunction(
		() => globalThis.sviber.creationMode === "tap" && globalThis.sviber.model.editor.subdivision === 4,
	);
	await page.locator('.tool-button[data-command="music.subdivision2"]').click();

	await page.locator('.tool-button[data-command="events.tap"]').click();
	await page.waitForFunction(() => globalThis.sviber.creationMode === null);
	await page.locator('.tool-button[data-command="events.tap"]').click();
	await page.waitForFunction(() => globalThis.sviber.creationMode === "tap");
	const stage = page.locator("#stage-surface canvas");
	const stageBox = await stage.boundingBox();
	await page.mouse.click(stageBox.x + stageBox.width * 0.62, stageBox.y + stageBox.height * 0.48);
	await page.waitForFunction(() => globalThis.sviber.model.events.length === 1);
	const positionBefore = await page.evaluate(() => {
		const event = globalThis.sviber.model.events[0];
		return { x: event.x, y: event.y, selected: event.selected };
	});
	assert.equal(positionBefore.selected, true);
	await page.keyboard.press("Escape");
	await page.keyboard.press("ArrowRight");
	assert.equal(await page.evaluate(() => globalThis.sviber.model.events[0].x), positionBefore.x + 1);

	await page.keyboard.press("Control+d");
	await page.locator('.tool-button[data-command="events.tap"]').click();
	await page.waitForFunction(() => globalThis.sviber.creationMode === "tap");
	const currentStageBox = await stage.boundingBox();
	await page.mouse.click(
		currentStageBox.x + currentStageBox.width * 0.38,
		currentStageBox.y + currentStageBox.height * 0.6,
	);
	await page.waitForFunction(() => globalThis.sviber.model.events.length === 2);
	await page.keyboard.press("Control+a");
	await page.keyboard.press("Escape");
	await page.evaluate(() => globalThis.sviber.copyEvents());
	const clipboardShape = await page.evaluate(() => globalThis.sviber.internalClipboard.events);
	assert.ok(clipboardShape.length === 2 && clipboardShape.every(event => Array.isArray(event.time)));
	assert.ok(clipboardShape.every(event => !Object.hasOwn(event, "beat") && Number.isInteger(event.channel)));
}

export async function runChromeAndDialogChecks(page) {
	await checkMenuPopupGeometry(page);
	await checkModalDialogIsolation(page);
	await checkToolButtonsAndCreation(page);
}
