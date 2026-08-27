// Browser checks for the per-document "allow out of bound" policy: creating notes clamps to the
// chart boundary until the document opts out, and the opt-out lives in the document rather than
// in the global preferences. The behaviour matrix for every editing path lives in
// verify-browser-bounds-matrix.mjs.
import assert from "node:assert/strict";

import { stageChartPoint } from "./verify-browser-editor-probes.mjs";
import { runBoundsBehaviorMatrix } from "./verify-browser-bounds-matrix.mjs";

export async function runOutOfBoundsChecks(page) {
	const outOfBoundsFixture = await page.evaluate(() => {
		const app = globalThis.sviber;
		app.preferences = { ...app.preferences, noteSpeed: 2 };
		delete app.preferences.allowOutOfBounds;
		app.model.editor.allowOutOfBound = false;
		app.model.snappees = [];
		localStorage.setItem("sviber.preferences", JSON.stringify(app.preferences));
		app.refreshNow();
		return {
			snapshot: app.model.snapshot(),
			historyLabel: app.history.currentEntry.label,
			savedSignature: app.savedSignature,
		};
	});
	await page.locator('.tool-button[data-command="events.tap"]').click();
	const boundedCreationPoint = await stageChartPoint(page, 115, 0);
	await page.mouse.click(boundedCreationPoint.x, boundedCreationPoint.y);
	await page.waitForFunction(() => globalThis.sviber.model.events.length === 1);
	assert.ok(
		Math.abs((await page.evaluate(() => globalThis.sviber.model.events[0].x)) - 100) < 1e-8,
		"default creation did not clamp to the chart boundary",
	);
	await page.keyboard.press("Escape");
	await page.evaluate(fixture => {
		const app = globalThis.sviber;
		app.model.restore(fixture.snapshot);
		app.history.reset(fixture.snapshot, fixture.historyLabel);
		app.savedSignature = fixture.savedSignature;
		app.updateDirty();
		app.refreshNow();
	}, outOfBoundsFixture);
	const historyBeforeOutOfBoundsToggle = await page.evaluate(() => globalThis.sviber.history.length);
	await page.locator('.menu-root[data-menu-id="file"] .menu-root-button').click();
	await page.locator('.menu-command[data-command="file.preferences"]').click();
	await page.getByRole("spinbutton", { name: "音符速度" }).fill("3");
	assert.equal(await page.getByRole("spinbutton", { name: "自动保存间隔（秒）" }).inputValue(), "120");
	assert.equal(
		await page.locator('.dialog-field input[type="checkbox"]').count(),
		0,
		"out-of-bound state must not be exposed as a global preference",
	);
	await page.locator('.dialog-button[data-dialog-action="ok"]').click();
	await page.waitForFunction(() => globalThis.sviber.preferences.noteSpeed === 3);
	await page.locator(".status-option:has(#allow-out-of-bound) img").click();
	await page.waitForFunction(() => globalThis.sviber.model.editor.allowOutOfBound === true);
	assert.equal(await page.evaluate(() => globalThis.sviber.history.length), historyBeforeOutOfBoundsToggle + 1);
	const persistedOutOfBoundsSetting = await page.evaluate(() => {
		const app = globalThis.sviber;
		const serializedEditor = app.model.toJSON().sviber.editor;
		const preferences = JSON.parse(localStorage.getItem("sviber.preferences"));
		return {
			model: app.model.editor.allowOutOfBound,
			hasLegacyModel: Object.hasOwn(app.model.editor, "allowOutOfBounds"),
			serialized: serializedEditor,
			preferences,
		};
	});
	assert.equal(persistedOutOfBoundsSetting.model, true);
	assert.equal(persistedOutOfBoundsSetting.hasLegacyModel, false);
	assert.equal(persistedOutOfBoundsSetting.serialized.allowOutOfBound, true);
	assert.equal(Object.hasOwn(persistedOutOfBoundsSetting.serialized, "allowOutOfBounds"), false);
	assert.equal(Object.hasOwn(persistedOutOfBoundsSetting.preferences, "allowOutOfBounds"), false);
	assert.equal(persistedOutOfBoundsSetting.preferences.noteSpeed, 3);

	await page.locator('.tool-button[data-command="events.tap"]').click();
	const outsideCreationPoint = await stageChartPoint(page, 115, 0);
	await page.mouse.click(outsideCreationPoint.x, outsideCreationPoint.y);
	await page.waitForFunction(() => globalThis.sviber.model.events.some(event => event.x > 100));
	assert.ok(
		Math.abs((await page.evaluate(() => globalThis.sviber.model.events.at(-1).x)) - 115) < 1,
		"enabled out-of-bounds creation did not preserve the clicked chart coordinate",
	);
	await page.keyboard.press("Escape");

	await runBoundsBehaviorMatrix(page, outOfBoundsFixture);
}
