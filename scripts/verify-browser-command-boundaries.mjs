// Checks for the boundaries of individual commands, measured against throwaway chart states:
// Activate follows the selection, snappee-duplicating paste remaps every copied reference, and
// Seek to start lands on the closest subdivision inside the visible range. The throwaway states
// are built by a browser-side harness that is always released, even when a check fails.
import assert from "node:assert/strict";

async function installCommandBoundaryHarness(page, fixture) {
	await page.evaluate(({ snapshot, historyLabel, savedSignature }) => {
		const app = globalThis.sviber;
		const harness = {
			liveSnapshot: app.model.snapshot(),
			liveHistoryLabel: app.history.currentEntry.label,
			liveSavedSignature: app.savedSignature,
			originalClipboard: structuredClone(app.internalClipboard),
			originalBuffer: app.audio.buffer,
		};
		harness.install = state => {
			app.cancelPreview();
			app.model.restore(state);
			app.history.reset(state, historyLabel);
			app.savedSignature = savedSignature;
			app.stageMoveAttachmentException = null;
		};
		harness.makeState = (events = [], snappees = [], timing = snapshot.timing) => ({
			...structuredClone(snapshot),
			timing: structuredClone(timing),
			channels: [{ id: 0 }],
			events,
			snappees,
			nextIds: {
				channel: 1,
				event: Math.max(1, ...events.map(event => event.id + 1)),
				snappee: Math.max(0, ...snappees.map(snappee => snappee.id + 1)),
			},
		});
		globalThis.__sviberCommandBoundaryHarness = harness;
	}, fixture);
}

async function releaseCommandBoundaryHarness(page) {
	await page.evaluate(() => {
		const app = globalThis.sviber;
		const harness = globalThis.__sviberCommandBoundaryHarness;
		app.cancelPreview();
		app.model.restore(harness.liveSnapshot);
		app.history.reset(harness.liveSnapshot, harness.liveHistoryLabel);
		app.savedSignature = harness.liveSavedSignature;
		app.internalClipboard = harness.originalClipboard;
		app.audio.buffer = harness.originalBuffer;
		app.stageMoveAttachmentException = null;
		app.updateDirty();
		app.refreshNow();
		delete globalThis.__sviberCommandBoundaryHarness;
	});
}

async function measureActivateEnablement(page) {
	return page.evaluate(() => {
		const app = globalThis.sviber;
		const harness = globalThis.__sviberCommandBoundaryHarness;
		const selectedState = harness.makeState([
			{ id: 0, type: "tap", time: [0, 0, 1], channel: 0, selected: true, attached: false, x: 0, y: 0 },
		]);
		harness.install(selectedState);
		app.refreshNow();
		const activateWithSelection = app.registry.isEnabled("snappee.activate", app);
		app.model.events[0].selected = false;
		const activateWithoutSelection = app.registry.isEnabled("snappee.activate", app);
		return { activateWithSelection, activateWithoutSelection };
	});
}

async function measureSnappeeAwarePaste(page) {
	return page.evaluate(async () => {
		const app = globalThis.sviber;
		const harness = globalThis.__sviberCommandBoundaryHarness;
		const sourceSnappee = {
			id: 0,
			type: "radialMesh",
			name: "clipboard source",
			color: "#00e0ad",
			active: true,
			selected: false,
			transformation: [1, 0, 0, 1, 0, 0],
			centerX: 0,
			centerY: 0,
			radius: 40,
			azimuthalTiles: 4,
			radialTiles: 1,
			startingAngle: 0,
		};
		const sourceEvent = {
			id: 0,
			type: "tap",
			time: [0, 0, 1],
			channel: 0,
			selected: true,
			attached: true,
			snappee: 0,
			snapPoint: [0, 0],
			tipPointSpawnType: "chain",
			tipPointSpawnAbsolutePosition: true,
			tipPointSpawnAttached: true,
			tipPointSpawnSnappee: 0,
			tipPointSpawnSnapPoint: [0, 1],
			tipPointSpawnTimeBeats: true,
			tipPointSpawnTime: [1, 0, 1],
		};
		harness.install(harness.makeState([sourceEvent], [sourceSnappee]));
		await app.copyEvents();
		const destination = harness.makeState([]);
		harness.install(destination);
		await app.pasteEvents(true);
		const pastedEvent = app.model.events[0];
		const pastedSnappee = app.model.snappees.find(snappee => snappee.id === pastedEvent?.snappee);
		return {
			pastedEvent: pastedEvent && {
				attached: pastedEvent.attached,
				snappee: pastedEvent.snappee,
				tipPointSpawnSnappee: pastedEvent.tipPointSpawnSnappee,
			},
			pastedSnappee: pastedSnappee && pastedSnappee.name,
		};
	});
}

async function measureSeekToStart(page) {
	return page.evaluate(() => {
		const app = globalThis.sviber;
		const harness = globalThis.__sviberCommandBoundaryHarness;
		const seekState = harness.makeState([], [], { offset: 0.2, initialBpm: 120, bpmChanges: [] });
		seekState.editor = {
			...seekState.editor,
			currentTime: [5, 0, 1],
			visibleRangeBeginning: 1,
			visibleRangeEnd: 5,
			subdivision: 2,
			timeSnapped: true,
		};
		harness.install(seekState);
		app.audio.buffer = null;
		app.seekStart();
		return {
			seekSeconds: app.currentSeconds(),
			seekVisible: [app.model.editor.visibleRangeBeginning, app.model.editor.visibleRangeEnd],
			seekBounds: app.timeBounds(),
			seekRenderBounds: app.timeBounds(true),
		};
	});
}

export async function runCommandBoundaryChecks(page, fixture) {
	await installCommandBoundaryHarness(page, fixture);
	let commandBoundaryBehavior;
	try {
		commandBoundaryBehavior = {
			...(await measureActivateEnablement(page)),
			...(await measureSnappeeAwarePaste(page)),
			...(await measureSeekToStart(page)),
		};
	} finally {
		await releaseCommandBoundaryHarness(page);
	}
	assert.equal(
		commandBoundaryBehavior.activateWithSelection,
		true,
		"Activate must stay enabled whenever events are selected",
	);
	assert.equal(
		commandBoundaryBehavior.activateWithoutSelection,
		false,
		"Activate must be disabled when no events are selected",
	);
	assert.equal(
		commandBoundaryBehavior.pastedEvent.attached,
		true,
		"Ctrl+Shift+V detached an event from its duplicated snappee",
	);
	assert.equal(
		commandBoundaryBehavior.pastedEvent.snappee,
		commandBoundaryBehavior.pastedEvent.tipPointSpawnSnappee,
		"Ctrl+Shift+V did not remap all copied snappee references",
	);
	assert.ok(Number.isInteger(commandBoundaryBehavior.pastedEvent.snappee));
	assert.equal(commandBoundaryBehavior.pastedSnappee, "clipboard source 2");
	assert.ok(
		Math.abs(commandBoundaryBehavior.seekSeconds + 0.05) < 1e-8,
		"Seek to start did not choose the closest subdivision",
	);
	assert.ok(commandBoundaryBehavior.seekRenderBounds[0] <= commandBoundaryBehavior.seekSeconds + 1e-8);
	assert.ok(
		commandBoundaryBehavior.seekSeconds >= commandBoundaryBehavior.seekVisible[0] - 1e-8 &&
			commandBoundaryBehavior.seekSeconds <= commandBoundaryBehavior.seekVisible[1] + 1e-8,
		"Seek to start left the snapped current time outside the visible range",
	);
}
