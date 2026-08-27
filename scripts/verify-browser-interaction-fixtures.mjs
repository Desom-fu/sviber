// Shared fixtures for the interaction checks: a two-note selection on the first channel that
// every pointer, inspector and playback check starts from, plus the restore that puts the
// editor back the way the check run found it.

export async function settleFrames(page) {
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

export async function installInteractionFixture(page) {
	const interactionFixture = await page.evaluate(() => {
		const app = globalThis.sviber;
		const snapshot = app.model.snapshot();
		const historyLabel = app.history.currentEntry.label;
		const savedSignature = app.savedSignature;
		app.model.editor.currentTime = [0, 0, 1];
		app.model.editor.timeSnapped = true;
		app.model.editor.visibleRangeBeginning = 0;
		app.model.editor.visibleRangeEnd = 4;
		const channel = app.model.channels[0].id;
		app.model.addEvent("tap", { time: [0, 0, 1], channel, x: -24, y: 8, selected: true });
		app.model.addEvent("tap", { time: [0, 0, 1], channel, x: 24, y: -8, selected: true });
		app.refreshNow();
		return { snapshot, historyLabel, savedSignature };
	});
	await settleFrames(page);
	return interactionFixture;
}

export async function restoreInteractionFixture(page, fixture) {
	await page.evaluate(({ snapshot, historyLabel, savedSignature }) => {
		const app = globalThis.sviber;
		app.cancelPreview();
		app.model.restore(snapshot);
		app.history.reset(snapshot, historyLabel);
		app.savedSignature = savedSignature;
		app.updateDirty();
		app.refreshNow();
	}, fixture);
}
