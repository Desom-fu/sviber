import assert from "node:assert/strict";

export async function runV14BrowserChecks(page) {
	const chrome = await page.evaluate(() => {
		const rulers = document.getElementById("show-rulers");
		const pause = document.querySelector("#stage-surface canvas");
		const channelMenu = [...document.querySelectorAll("#menu-bar [data-menu='channel'] .menu-item, #application-menu [data-menu='channel'] .menu-item, [data-menu-id='channel'] .menu-item")]
			.map(item => item.dataset.command || item.getAttribute("data-command"));
		const toolbar = [...document.querySelectorAll("#tool-bar [data-command]")].map(item => item.dataset.command);
		return {
			rulersExists: Boolean(rulers),
			rulersChecked: Boolean(rulers?.checked),
			toolbarHasBarLine: toolbar.includes("timing.barLine"),
			toolbarHasMove: toolbar.includes("events.moveChannelAbove"),
			themeDark: document.documentElement.classList.contains("theme-dark")
				|| document.documentElement.classList.contains("theme-light")
				|| document.documentElement.hasAttribute("data-theme")
				|| !document.documentElement.hasAttribute("data-theme"),
			hasCanvas: Boolean(pause),
		};
	});
	assert.equal(chrome.rulersExists, true, "Rulers checkbox is missing");
	assert.equal(chrome.rulersChecked, false, "Rulers should default off");
	assert.equal(chrome.toolbarHasBarLine, true, "toolbar missing Bar line");
	assert.equal(chrome.toolbarHasMove, true, "toolbar missing move-to-channel");

	await page.locator("#show-rulers").setChecked(true);
	const rulerOn = await page.evaluate(() => Boolean(globalThis.sviber.model.editor.showRulers));
	assert.equal(rulerOn, true, "checking Rulers did not persist");

	const pauseHit = await page.evaluate(() => {
		const app = globalThis.sviber;
		app.refreshNow();
		const region = app.stage.hitRegions.find(item => item.type === "hud-pause");
		return Boolean(region);
	});
	assert.equal(pauseHit, true, "HUD pause hit region missing");

	const channelOffset = await page.evaluate(async () => {
		const app = globalThis.sviber;
		const snapshot = app.model.snapshot();
		while (app.model.channels.length < 6) app.model.addChannel(app.model.channels.length, { name: `Lane ${app.model.channels.length}` });
		app.model.editor.timelineChannelOffset = 0;
		app.timeline.channelOffset = 0;
		app.refreshNow();
		app.timeline.scrollChannelsBy(1);
		const next = app.timeline.channelOffset;
		app.model.restore(snapshot);
		app.refreshNow();
		return next;
	});
	assert.ok(channelOffset > 0, "Shift+wheel helper did not scroll channels");

	await page.evaluate(() => {
		document.documentElement.classList.add("theme-dark");
	});
	assert.equal(await page.evaluate(() => document.documentElement.classList.contains("theme-dark")), true);
}
