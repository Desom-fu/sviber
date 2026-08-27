// Checks for what playback does to the editor: the animation loop keeps running without
// rebuilding the sidebar panels every frame, and clicking the stage or timeline while playing
// neither pauses playback nor edits the chart.
import assert from "node:assert/strict";

async function instrumentPanelRenders(page) {
	await page.evaluate(() => {
		const app = globalThis.sviber;
		app.playbackFrameCount = 0;
		app.__playbackPanelRenderCounts = { inspector: 0, snappees: 0, history: 0 };
		app.__playbackPanelRenderOriginals = [
			[app.inspectorPanel, "inspector"],
			[app.snappeesPanel, "snappees"],
			[app.historyPanel, "history"],
		].map(([panel, key]) => {
			const original = panel.render;
			panel.render = function (...args) {
				app.__playbackPanelRenderCounts[key] += 1;
				return original.apply(this, args);
			};
			return [panel, original];
		});
	});
}

async function restorePanelRenders(page) {
	await page.evaluate(() => {
		const app = globalThis.sviber;
		for (const [panel, original] of app.__playbackPanelRenderOriginals || []) {
			panel.render = original;
		}
		delete app.__playbackPanelRenderOriginals;
		delete app.__playbackPanelRenderCounts;
	});
}

async function checkPlaybackRenderBudget(page) {
	const playbackRenderStats = await page.evaluate(() => ({
		frames: globalThis.sviber.playbackFrameCount,
		panels: globalThis.sviber.__playbackPanelRenderCounts,
	}));
	assert.ok(
		playbackRenderStats.frames >= 5,
		`playback did not maintain animation frames: ${JSON.stringify(playbackRenderStats)}`,
	);
	assert.ok(
		Object.values(playbackRenderStats.panels).every(count => count <= 2),
		`playback rebuilt sidebar panels every frame: ${JSON.stringify(playbackRenderStats)}`,
	);
}

async function checkPlaybackIsReadOnlyForPointer(page, stage) {
	const playbackState = await page.evaluate(() => ({
		events: globalThis.sviber.model.events.map(({ selected: _selected, ...event }) => event),
		saveEnabled: globalThis.sviber.registry.isEnabled("file.save", globalThis.sviber),
		moveEnabled: globalThis.sviber.registry.isEnabled("transform.moveRight", globalThis.sviber),
		musicEnabled: globalThis.sviber.registry.isEnabled("music.seekForward", globalThis.sviber),
		inspectorInert: document.querySelector("#inspector-panel").inert,
		operationalPanelsInert: [...document.querySelectorAll("#channels-panel,#snappees-panel,.history-panel")].some(
			element => element.inert,
		),
	}));
	assert.equal(playbackState.saveEnabled, true);
	assert.equal(playbackState.moveEnabled, true);
	assert.equal(playbackState.musicEnabled, true);
	assert.equal(playbackState.inspectorInert, false);
	assert.equal(playbackState.operationalPanelsInert, false);
	const playbackStageBox = await stage.boundingBox();
	await page.mouse.click(
		playbackStageBox.x + playbackStageBox.width * 0.84,
		playbackStageBox.y + playbackStageBox.height * 0.76,
	);
	const timelineBoxWhilePlaying = await page.locator("#timeline-surface canvas").boundingBox();
	await page.mouse.click(
		timelineBoxWhilePlaying.x + timelineBoxWhilePlaying.width * 0.73,
		timelineBoxWhilePlaying.y + timelineBoxWhilePlaying.height * 0.55,
	);
	await page.waitForTimeout(120);
	assert.equal(
		await page.evaluate(() => globalThis.sviber.audio.playing),
		true,
		"an editor-canvas click paused playback",
	);
	assert.deepEqual(
		await page.evaluate(() => globalThis.sviber.model.events.map(({ selected: _selected, ...event }) => event)),
		playbackState.events,
		"an editor-canvas interaction edited events during playback",
	);
}

export async function runPlaybackInteractionChecks(page) {
	const stage = page.locator("#stage-surface canvas");
	await instrumentPanelRenders(page);
	await page.locator('.tool-button[data-command="music.playPause"]').click();
	await page.waitForFunction(() => globalThis.sviber.audio.playing === true);
	await page.waitForTimeout(250);
	await checkPlaybackRenderBudget(page);
	await checkPlaybackIsReadOnlyForPointer(page, stage);
	await page.locator('.tool-button[data-command="music.playPause"]').click();
	await page.waitForFunction(() => globalThis.sviber.audio.playing === false);
	await restorePanelRenders(page);
}
