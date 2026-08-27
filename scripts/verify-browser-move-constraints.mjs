// Checks for the rules that constrain moving events: a partial-attachment selection may only
// continue a move that started from the same selection, and moves stay inside the music bounds
// while keeping channel spacing.
import assert from "node:assert/strict";

async function measureAttachmentExceptions(page, fixture) {
	return page.evaluate(({ snapshot, historyLabel, savedSignature }) => {
		const app = globalThis.sviber;
		const makeState = events => ({
			...structuredClone(snapshot),
			channels: [{ id: 0 }],
			events,
			snappees: [
				{
					id: 0,
					type: "radialMesh",
					name: "movement provenance",
					color: "#00e0ad",
					transformation: [1, 0, 0, 1, 0, 0],
					active: true,
					selected: false,
					centerX: 0,
					centerY: 0,
					radius: 40,
					azimuthalTiles: 4,
					radialTiles: 1,
					startingAngle: 0,
				},
			],
			nextIds: { channel: 1, event: 3, snappee: 1 },
			editor: { ...snapshot.editor, currentChannel: 0, currentTime: [0, 0, 1], timeSnapped: true },
		});
		const install = events => {
			const state = makeState(events);
			app.cancelPreview();
			app.model.restore(state);
			app.history.reset(state, historyLabel);
			app.stageMoveAttachmentException = null;
		};
		const eventState = () =>
			app.model.events.map(event => ({
				id: event.id,
				selected: event.selected,
				attached: event.attached,
				x: event.x,
				y: event.y,
				snappee: event.snappee,
				snapPoint: event.snapPoint,
			}));

		install([
			{
				id: 0,
				type: "tap",
				time: [0, 0, 1],
				channel: 0,
				selected: true,
				attached: true,
				snappee: 0,
				snapPoint: [0, 0],
			},
			{ id: 1, type: "tap", time: [0, 0, 1], channel: 0, selected: true, attached: false, x: 20, y: 0 },
		]);
		const manualPartialBefore = eventState();
		app.movePosition(0, { x: 30, y: 0 });
		const manualPartialAfter = eventState();

		install([
			{ id: 0, type: "tap", time: [0, 0, 1], channel: 0, selected: true, attached: false, x: -30, y: 0 },
			{ id: 1, type: "tap", time: [0, 0, 1], channel: 0, selected: false, attached: false, x: 20, y: 0 },
			{ id: 2, type: "tap", time: [0, 0, 1], channel: 0, selected: false, attached: false, x: -50, y: 0 },
		]);
		app.movePosition(0, { x: 0, y: 0, snappeeId: 0, snapPoint: [0, 0] });
		const afterInitialAttach = eventState();
		app.selectEvents([1, 2], "add");
		app.movePosition(0, { x: 40, y: 0, snappeeId: 0, snapPoint: [0, 1] });
		const afterAllowedContinuation = eventState();
		app.selectEvents([2], "remove");
		app.selectEvents([2], "add");
		const beforeInvalidatedContinuation = eventState();
		app.movePosition(0, { x: 0, y: 0, snappeeId: 0, snapPoint: [0, 0] });
		const afterInvalidatedContinuation = eventState();

		app.cancelPreview();
		app.model.restore(snapshot);
		app.history.reset(snapshot, historyLabel);
		app.savedSignature = savedSignature;
		app.stageMoveAttachmentException = null;
		app.updateDirty();
		app.refreshNow();
		return {
			manualPartialBefore,
			manualPartialAfter,
			afterInitialAttach,
			afterAllowedContinuation,
			beforeInvalidatedContinuation,
			afterInvalidatedContinuation,
		};
	}, fixture);
}

async function checkAttachmentMoveExceptions(page, fixture) {
	const attachmentExceptionBehavior = await measureAttachmentExceptions(page, fixture);
	assert.deepEqual(
		attachmentExceptionBehavior.manualPartialAfter,
		attachmentExceptionBehavior.manualPartialBefore,
		"a manually created partial attachment selection was allowed to move",
	);
	assert.equal(attachmentExceptionBehavior.afterInitialAttach[0].attached, true);
	assert.deepEqual(attachmentExceptionBehavior.afterInitialAttach[0].snapPoint, [0, 0]);
	assert.equal(attachmentExceptionBehavior.afterInitialAttach[1].x, 20);
	assert.deepEqual(
		attachmentExceptionBehavior.afterAllowedContinuation.map(event => event.selected),
		[true, true, true],
	);
	assert.equal(attachmentExceptionBehavior.afterAllowedContinuation[0].attached, true);
	assert.deepEqual(attachmentExceptionBehavior.afterAllowedContinuation[0].snapPoint, [0, 1]);
	assert.equal(attachmentExceptionBehavior.afterAllowedContinuation[1].x, 60);
	assert.equal(attachmentExceptionBehavior.afterAllowedContinuation[2].x, -10);
	assert.deepEqual(
		attachmentExceptionBehavior.afterInvalidatedContinuation,
		attachmentExceptionBehavior.beforeInvalidatedContinuation,
		"removing and re-adding an event did not invalidate the partial-attachment move exception",
	);
}

async function checkBoundedTimelineMoves(page) {
	const boundedTimelineBehavior = await page.evaluate(() => {
		const snapshot = globalThis.sviber.model.snapshot();
		const historyLabel = globalThis.sviber.history.currentEntry.label;
		const savedSignature = globalThis.sviber.savedSignature;
		const originalBuffer = globalThis.sviber.audio.buffer;
		globalThis.sviber.model.editor.subdivision = 4;
		globalThis.sviber.model.editor.currentTime = [0, 1, 2];
		globalThis.sviber.refreshNow();
		const expandedBeatText = document.getElementById("status-beat").textContent;
		globalThis.sviber.audio.buffer = { duration: 3.25 };
		globalThis.sviber.model.events = [
			{
				id: 1000,
				type: "hold",
				time: [100, 0, 1],
				duration: [20, 0, 1],
				channel: 0,
			},
		];
		const musicBounds = globalThis.sviber.timeBounds();
		globalThis.sviber.audio.buffer = null;
		globalThis.sviber.model.restore(snapshot);
		globalThis.sviber.model.addChannel();
		globalThis.sviber.model.addChannel();
		const channels = globalThis.sviber.model.channels.map(channel => channel.id);
		globalThis.sviber.model.addEvent("tap", { channel: channels[1], selected: true });
		globalThis.sviber.model.addEvent("tap", { channel: channels[2], selected: true });
		globalThis.sviber.moveEvents([0, 0, 1], -99, false);
		const movedChannelIndices = globalThis.sviber.model.events.map(event =>
			globalThis.sviber.model.channels.findIndex(channel => channel.id === event.channel),
		);
		globalThis.sviber.model.restore(snapshot);
		globalThis.sviber.history.reset(snapshot, historyLabel);
		globalThis.sviber.audio.buffer = originalBuffer;
		globalThis.sviber.savedSignature = savedSignature;
		globalThis.sviber.updateDirty();
		globalThis.sviber.refresh();
		return { musicBounds, movedChannelIndices, expandedBeatText };
	});
	assert.deepEqual(boundedTimelineBehavior.musicBounds, [0, 3.25], "loaded music must define the upper time bound");
	assert.deepEqual(
		boundedTimelineBehavior.movedChannelIndices,
		[0, 1],
		"multi-event channel spacing must be preserved at a boundary",
	);
	assert.equal(
		boundedTimelineBehavior.expandedBeatText,
		"0+2/4",
		"status beat must retain the subdivision denominator",
	);
}

export async function runMoveConstraintChecks(page, fixture) {
	await checkAttachmentMoveExceptions(page, fixture);
	await checkBoundedTimelineMoves(page);
}
