import assert from "node:assert/strict";
import path from "node:path";

export async function runInteractionChecks(page, outputDirectory) {
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
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

	const canvasPoint = async (viewName, collectionName) => page.evaluate(({ viewName, collectionName }) => {
		const view = globalThis.sviber[viewName];
		const item = view[collectionName].find(record => record.event.selected);
		if (!item) return null;
		const rectangle = view.surface.canvas.getBoundingClientRect();
		const point = item.screen || item;
		return {
			x: rectangle.left + point.x * rectangle.width / view.surface.width,
			y: rectangle.top + point.y * rectangle.height / view.surface.height,
		};
	}, { viewName, collectionName });
	const eventState = () => page.evaluate(() => globalThis.sviber.model.events.map(event => ({
		id: event.id,
		x: Number(event.x),
		y: Number(event.y),
		time: event.time[0] + event.time[1] / event.time[2],
		channel: event.channel,
		selected: Boolean(event.selected),
	})));

	const stageDragPoint = await canvasPoint("stage", "visibleEvents");
	assert.ok(stageDragPoint, "selected stage event was not rendered for drag verification");
	const beforeStageDrag = await eventState();
	await page.mouse.move(stageDragPoint.x, stageDragPoint.y);
	await page.mouse.down();
	await page.mouse.move(stageDragPoint.x + 36, stageDragPoint.y - 18, { steps: 3 });
	await page.mouse.up();
	const afterStageDrag = await eventState();
	const stageDeltas = afterStageDrag.map((event, index) => ({
		x: event.x - beforeStageDrag[index].x,
		y: event.y - beforeStageDrag[index].y,
	}));
	assert.ok(Math.hypot(stageDeltas[0].x, stageDeltas[0].y) > 1, "stage drag did not move the selection");
	assert.ok(stageDeltas.every(delta => Math.abs(delta.x - stageDeltas[0].x) < 1e-8
		&& Math.abs(delta.y - stageDeltas[0].y) < 1e-8), "stage drag did not preserve multi-selection spacing");

	const timelineMovePoint = await canvasPoint("timeline", "eventCenters");
	assert.ok(timelineMovePoint, "selected timeline event was not rendered for drag verification");
	const beforeTimelineMove = await eventState();
	await page.mouse.move(timelineMovePoint.x, timelineMovePoint.y);
	await page.mouse.down();
	await page.mouse.move(timelineMovePoint.x + 72, timelineMovePoint.y, { steps: 3 });
	await page.mouse.up();
	const afterTimelineMove = await eventState();
	const timelineDelta = afterTimelineMove[0].time - beforeTimelineMove[0].time;
	assert.ok(timelineDelta > 0, "timeline drag did not move the selection in time");
	assert.ok(afterTimelineMove.every((event, index) => Math.abs(event.time - beforeTimelineMove[index].time - timelineDelta) < 1e-8),
		"timeline drag did not preserve multi-selection timing");
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

	const timelineCopyPoint = await canvasPoint("timeline", "eventCenters");
	assert.ok(timelineCopyPoint, "selected timeline event was not rendered for copy-drag verification");
	const beforeTimelineCopy = await eventState();
	await page.keyboard.down("Control");
	await page.mouse.move(timelineCopyPoint.x, timelineCopyPoint.y);
	await page.mouse.down();
	await page.mouse.move(timelineCopyPoint.x + 72, timelineCopyPoint.y, { steps: 3 });
	await page.mouse.up();
	await page.keyboard.up("Control");
	const afterTimelineCopy = await eventState();
	assert.equal(afterTimelineCopy.length, beforeTimelineCopy.length * 2, "Ctrl-drag did not duplicate all selected events");
	const originalsAfterCopy = afterTimelineCopy.filter(event => beforeTimelineCopy.some(original => original.id === event.id));
	const copiesAfterCopy = afterTimelineCopy.filter(event => !beforeTimelineCopy.some(original => original.id === event.id));
	assert.deepEqual(originalsAfterCopy, beforeTimelineCopy.map(event => ({ ...event, selected: false })),
		"Ctrl-drag changed an original event");
	assert.equal(copiesAfterCopy.length, beforeTimelineCopy.length);
	assert.ok(copiesAfterCopy.every(event => event.selected), "Ctrl-drag copies were not selected");
	const copyDelta = copiesAfterCopy[0].time - beforeTimelineCopy[0].time;
	assert.ok(copyDelta > 0, "Ctrl-drag copies were not moved away from their originals");
	assert.ok(copiesAfterCopy.every((event, index) => Math.abs(event.time - beforeTimelineCopy[index].time - copyDelta) < 1e-8),
		"Ctrl-drag did not preserve copied event timing");

	await page.evaluate(({ snapshot, historyLabel, savedSignature }) => {
		const app = globalThis.sviber;
		app.cancelPreview();
		app.model.restore(snapshot);
		app.history.reset(snapshot, historyLabel);
		app.savedSignature = savedSignature;
		app.updateDirty();
		app.refreshNow();
	}, interactionFixture);
	const attachmentExceptionBehavior = await page.evaluate(({ snapshot, historyLabel, savedSignature }) => {
		const app = globalThis.sviber;
		const makeState = events => ({
			...structuredClone(snapshot),
			channels: [{ id: 0 }],
			events,
			snappees: [{
				id: 0, type: "radialMesh", name: "movement provenance", color: "#00e0ad",
				transformation: [1, 0, 0, 1, 0, 0], active: true, selected: false,
				centerX: 0, centerY: 0, radius: 40, azimuthalTiles: 4, radialTiles: 1, startingAngle: 0,
			}],
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
		const eventState = () => app.model.events.map(event => ({
			id: event.id,
			selected: event.selected,
			attached: event.attached,
			x: event.x,
			y: event.y,
			snappee: event.snappee,
			snapPoint: event.snapPoint,
		}));

		install([
			{ id: 0, type: "tap", time: [0, 0, 1], channel: 0, selected: true, attached: true, snappee: 0, snapPoint: [0, 0] },
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
	}, interactionFixture);
	assert.deepEqual(attachmentExceptionBehavior.manualPartialAfter, attachmentExceptionBehavior.manualPartialBefore,
		"a manually created partial attachment selection was allowed to move");
	assert.equal(attachmentExceptionBehavior.afterInitialAttach[0].attached, true);
	assert.deepEqual(attachmentExceptionBehavior.afterInitialAttach[0].snapPoint, [0, 0]);
	assert.equal(attachmentExceptionBehavior.afterInitialAttach[1].x, 20);
	assert.deepEqual(attachmentExceptionBehavior.afterAllowedContinuation.map(event => event.selected), [true, true, true]);
	assert.equal(attachmentExceptionBehavior.afterAllowedContinuation[0].attached, true);
	assert.deepEqual(attachmentExceptionBehavior.afterAllowedContinuation[0].snapPoint, [0, 1]);
	assert.equal(attachmentExceptionBehavior.afterAllowedContinuation[1].x, 60);
	assert.equal(attachmentExceptionBehavior.afterAllowedContinuation[2].x, -10);
	assert.deepEqual(attachmentExceptionBehavior.afterInvalidatedContinuation,
		attachmentExceptionBehavior.beforeInvalidatedContinuation,
		"removing and re-adding an event did not invalidate the partial-attachment move exception");
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
		globalThis.sviber.model.events = [{
			id: 1000, type: "hold", time: [100, 0, 1], duration: [20, 0, 1], channel: 0,
		}];
		const musicBounds = globalThis.sviber.timeBounds();
		globalThis.sviber.audio.buffer = null;
		globalThis.sviber.model.restore(snapshot);
		globalThis.sviber.model.addChannel();
		globalThis.sviber.model.addChannel();
		const channels = globalThis.sviber.model.channels.map(channel => channel.id);
		globalThis.sviber.model.addEvent("tap", { channel: channels[1], selected: true });
		globalThis.sviber.model.addEvent("tap", { channel: channels[2], selected: true });
		globalThis.sviber.moveEvents([0, 0, 1], -99, false);
		const movedChannelIndices = globalThis.sviber.model.events.map(event => (
			globalThis.sviber.model.channels.findIndex(channel => channel.id === event.channel)
		));
		globalThis.sviber.model.restore(snapshot);
		globalThis.sviber.history.reset(snapshot, historyLabel);
		globalThis.sviber.audio.buffer = originalBuffer;
		globalThis.sviber.savedSignature = savedSignature;
		globalThis.sviber.updateDirty();
		globalThis.sviber.refresh();
		return { musicBounds, movedChannelIndices, expandedBeatText };
	});
	assert.deepEqual(boundedTimelineBehavior.musicBounds, [0, 3.25], "loaded music must define the upper time bound");
	assert.deepEqual(boundedTimelineBehavior.movedChannelIndices, [0, 1], "multi-event channel spacing must be preserved at a boundary");
	assert.equal(boundedTimelineBehavior.expandedBeatText, "0+2/4", "status beat must retain the subdivision denominator");

	const layoutFixture = await page.evaluate(() => ({
		snapshot: globalThis.sviber.model.snapshot(),
		historyLabel: globalThis.sviber.history.currentEntry.label,
		savedSignature: globalThis.sviber.savedSignature,
	}));
	const installLayoutFixture = async ({ channels, events }) => {
		await page.evaluate(({ original, channels: fixtureChannels, events: fixtureEvents }) => {
			const state = structuredClone(original.snapshot);
			state.channels = fixtureChannels.map(id => ({ id }));
			state.events = fixtureEvents;
			state.snappees = [];
			state.nextIds = {
				channel: Math.max(...fixtureChannels) + 1,
				event: Math.max(0, ...fixtureEvents.map(event => event.id + 1)),
				snappee: 0,
			};
			state.editor = {
				...state.editor,
				timeSnapped: true,
				currentTime: [0, 0, 1],
				currentChannel: fixtureChannels[0],
				visibleRangeBeginning: 0,
				visibleRangeEnd: 10,
				subdivision: 2,
			};
			globalThis.sviber.model.restore(state);
			globalThis.sviber.history.reset(state, original.historyLabel);
			globalThis.sviber.refresh();
		}, { original: layoutFixture, channels, events });
		await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	};
	const restoreLayoutFixture = async () => {
		await page.evaluate(original => {
			globalThis.sviber.model.restore(original.snapshot);
			globalThis.sviber.history.reset(original.snapshot, original.historyLabel);
			globalThis.sviber.savedSignature = original.savedSignature;
			globalThis.sviber.updateDirty();
			globalThis.sviber.refresh();
		}, layoutFixture);
		await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	};

	const timelineHeights = [];
	for (let channelCount = 1; channelCount <= 4; channelCount += 1) {
		await installLayoutFixture({ channels: Array.from({ length: channelCount }, (_, index) => index), events: [] });
		timelineHeights.push((await page.locator(".timeline-row").boundingBox()).height);
	}
	assert.ok(timelineHeights[1] > timelineHeights[0] && timelineHeights[2] > timelineHeights[1],
		`timeline did not grow with its first three channels: ${timelineHeights.join(", ")}`);
	assert.equal(timelineHeights[3], timelineHeights[2],
		`timeline grew beyond three channels: ${timelineHeights.join(", ")}`);

	await installLayoutFixture({
		channels: [0],
		events: [
			{ id: 0, type: "tap", time: [0, 0, 1], channel: 0, selected: true, attached: false, x: -30, y: 0 },
			{ id: 1, type: "tap", time: [0, 0, 1], channel: 0, selected: true, attached: false, x: 30, y: 0 },
		],
	});
	const stagePointer = async eventId => page.evaluate(id => {
		const app = globalThis.sviber;
		const event = app.model.events.find(candidate => candidate.id === id);
		const surface = app.stage.surface;
		const rectangle = surface.canvas.getBoundingClientRect();
		const scale = Math.min(surface.width / 250, surface.height / 150);
		return {
			x: rectangle.left + (surface.width / 2 + event.x * scale) * rectangle.width / surface.width,
			y: rectangle.top + (surface.height / 2 - event.y * scale) * rectangle.height / surface.height,
		};
	}, eventId);
	const stageBeforeMove = await page.evaluate(() => globalThis.sviber.model.events.map(event => ({ x: event.x, y: event.y })));
	let stagePointerPosition = await stagePointer(0);
	await page.mouse.move(stagePointerPosition.x, stagePointerPosition.y);
	await page.mouse.down();
	await page.mouse.move(stagePointerPosition.x + 36, stagePointerPosition.y - 18);
	await page.mouse.up();
	const stageAfterMove = await page.evaluate(() => globalThis.sviber.model.events.map(event => ({
		x: event.x, y: event.y, selected: event.selected,
	})));
	assert.ok(stageAfterMove.every(event => event.selected), "dragging one selected stage event collapsed the group selection");
	assert.ok(stageAfterMove[0].x > stageBeforeMove[0].x && stageAfterMove[0].y > stageBeforeMove[0].y,
		"the primary stage event did not move");
	assert.ok(Math.abs((stageAfterMove[0].x - stageBeforeMove[0].x) - (stageAfterMove[1].x - stageBeforeMove[1].x)) < 1e-6
		&& Math.abs((stageAfterMove[0].y - stageBeforeMove[0].y) - (stageAfterMove[1].y - stageBeforeMove[1].y)) < 1e-6,
	"stage multi-selection did not move as a rigid group");
	stagePointerPosition = await stagePointer(0);
	await page.mouse.click(stagePointerPosition.x, stagePointerPosition.y);
	assert.deepEqual(await page.evaluate(() => globalThis.sviber.model.events.map(event => event.selected)), [true, false],
		"clicking a selected stage event without dragging did not collapse to a single selection");

	await restoreLayoutFixture();
	await page.screenshot({ path: path.join(outputDirectory, "sviber-desktop-zh-CN.png"), fullPage: true });

	await page.locator('.menu-root[data-menu-id="file"] .menu-root-button').click();
	const menuGeometry = await page.evaluate(() => {
		const popup = document.querySelector('.menu-root[data-menu-id="file"] .menu-popup').getBoundingClientRect();
		const chrome = document.querySelector('.app-chrome').getBoundingClientRect();
		return { popup: { top: popup.top, bottom: popup.bottom, left: popup.left, right: popup.right }, chromeBottom: chrome.bottom, innerWidth };
	});
	assert.ok(menuGeometry.popup.top < menuGeometry.chromeBottom && menuGeometry.popup.bottom > menuGeometry.chromeBottom + 20,
		`menu popup is clipped by the chrome: ${JSON.stringify(menuGeometry)}`);
	assert.ok(menuGeometry.popup.left >= 0 && menuGeometry.popup.right <= menuGeometry.innerWidth + 1,
		`menu popup is outside the viewport: ${JSON.stringify(menuGeometry)}`);
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
	assert.ok(Math.abs(afterDrag.x - beforeDrag.x) > 10 || Math.abs(afterDrag.y - beforeDrag.y) > 10, "dialog did not move");
	await page.keyboard.press("Alt+f");
	assert.equal(await page.locator(".menu-root.is-open").count(), 0, "a menu opened behind the modal dialog");
	await page.keyboard.press("t");
	assert.equal(await page.evaluate(() => globalThis.sviber.creationMode), null, "a command shortcut ran behind the modal dialog");
	await dialog.locator('[data-dialog-action="cancel"]').click();
	await page.locator('.tool-button[data-command="events.tap"]').click();
	await page.waitForFunction(() => globalThis.sviber.creationMode === "tap");
	await page.locator('.tool-button[data-command="music.subdivision4"]').click();
	await page.waitForFunction(() => globalThis.sviber.creationMode === "tap" && globalThis.sviber.model.editor.subdivision === 4);
	await page.locator('.tool-button[data-command="music.subdivision2"]').click();

	await page.locator('.tool-button[data-command="events.tap"]').click();
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
	await page.mouse.click(currentStageBox.x + currentStageBox.width * 0.38, currentStageBox.y + currentStageBox.height * 0.60);
	await page.waitForFunction(() => globalThis.sviber.model.events.length === 2);
	await page.keyboard.press("Control+a");
	await page.keyboard.press("Escape");
	await page.evaluate(() => globalThis.sviber.copyEvents());
	const clipboardShape = await page.evaluate(() => globalThis.sviber.internalClipboard.events);
	assert.ok(clipboardShape.length === 2 && clipboardShape.every(event => Array.isArray(event.time)));
	assert.ok(clipboardShape.every(event => !Object.hasOwn(event, "beat") && Number.isInteger(event.channel)));
	const commandBoundaryBehavior = await page.evaluate(async ({ snapshot, historyLabel, savedSignature }) => {
		const app = globalThis.sviber;
		const liveSnapshot = app.model.snapshot();
		const liveHistoryLabel = app.history.currentEntry.label;
		const liveSavedSignature = app.savedSignature;
		const originalClipboard = structuredClone(app.internalClipboard);
		const originalBuffer = app.audio.buffer;
		const install = state => {
			app.cancelPreview();
			app.model.restore(state);
			app.history.reset(state, historyLabel);
			app.savedSignature = savedSignature;
			app.stageMoveAttachmentException = null;
		};
		const makeState = (events = [], snappees = [], timing = snapshot.timing) => ({
			...structuredClone(snapshot),
			timing: structuredClone(timing),
			channels: [{ id: 0 }],
			events,
			snappees,
			nextIds: { channel: 1, event: Math.max(1, ...events.map(event => event.id + 1)), snappee: Math.max(0, ...snappees.map(snappee => snappee.id + 1)) },
		});
		try {
			const selectedState = makeState([{ id: 0, type: "tap", time: [0, 0, 1], channel: 0, selected: true, attached: false, x: 0, y: 0 }]);
			install(selectedState);
			app.refreshNow();
			const activateWithSelection = app.registry.isEnabled("snappee.activate", app);
			app.model.events[0].selected = false;
			const activateWithoutSelection = app.registry.isEnabled("snappee.activate", app);

			const sourceSnappee = {
				id: 0, type: "radialMesh", name: "clipboard source", color: "#00e0ad", active: true, selected: false,
				transformation: [1, 0, 0, 1, 0, 0], centerX: 0, centerY: 0, radius: 40,
				azimuthalTiles: 4, radialTiles: 1, startingAngle: 0,
			};
			const sourceEvent = {
				id: 0, type: "tap", time: [0, 0, 1], channel: 0, selected: true,
				attached: true, snappee: 0, snapPoint: [0, 0],
				tipPointSpawnType: "chain", tipPointSpawnAbsolutePosition: true, tipPointSpawnAttached: true,
				tipPointSpawnSnappee: 0, tipPointSpawnSnapPoint: [0, 1], tipPointSpawnTimeBeats: true,
				tipPointSpawnTime: [1, 0, 1],
			};
			install(makeState([sourceEvent], [sourceSnappee]));
			await app.copyEvents();
			const destination = makeState([]);
			install(destination);
			await app.pasteEvents(true);
			const pastedEvent = app.model.events[0];
			const pastedSnappee = app.model.snappees.find(snappee => snappee.id === pastedEvent?.snappee);

			const seekState = makeState([], [], { offset: 0.2, initialBpm: 120, bpmChanges: [] });
			seekState.editor = { ...seekState.editor, currentTime: [5, 0, 1], visibleRangeBeginning: 1, visibleRangeEnd: 5, subdivision: 2, timeSnapped: true };
			install(seekState);
			app.audio.buffer = null;
			app.seekStart();
			return {
				activateWithSelection,
				activateWithoutSelection,
				pastedEvent: pastedEvent && {
					attached: pastedEvent.attached,
					snappee: pastedEvent.snappee,
					tipPointSpawnSnappee: pastedEvent.tipPointSpawnSnappee,
				},
				pastedSnappee: pastedSnappee && pastedSnappee.name,
				seekSeconds: app.currentSeconds(),
				seekVisible: [app.model.editor.visibleRangeBeginning, app.model.editor.visibleRangeEnd],
				seekBounds: app.timeBounds(),
				seekRenderBounds: app.timeBounds(true),
			};
		} finally {
			app.cancelPreview();
			app.model.restore(liveSnapshot);
			app.history.reset(liveSnapshot, liveHistoryLabel);
			app.savedSignature = liveSavedSignature;
			app.internalClipboard = originalClipboard;
			app.audio.buffer = originalBuffer;
			app.stageMoveAttachmentException = null;
			app.updateDirty();
			app.refreshNow();
		}
	}, interactionFixture);
	assert.equal(commandBoundaryBehavior.activateWithSelection, true,
		"Activate must stay enabled whenever events are selected");
	assert.equal(commandBoundaryBehavior.activateWithoutSelection, false,
		"Activate must be disabled when no events are selected");
	assert.equal(commandBoundaryBehavior.pastedEvent.attached, true,
		"Ctrl+Shift+V detached an event from its duplicated snappee");
	assert.equal(commandBoundaryBehavior.pastedEvent.snappee, commandBoundaryBehavior.pastedEvent.tipPointSpawnSnappee,
		"Ctrl+Shift+V did not remap all copied snappee references");
	assert.ok(Number.isInteger(commandBoundaryBehavior.pastedEvent.snappee));
	assert.equal(commandBoundaryBehavior.pastedSnappee, "clipboard source 2");
	assert.ok(Math.abs(commandBoundaryBehavior.seekSeconds + 0.05) < 1e-8,
		"Seek to start did not choose the closest subdivision");
	assert.ok(commandBoundaryBehavior.seekRenderBounds[0] <= commandBoundaryBehavior.seekSeconds + 1e-8);
	assert.ok(commandBoundaryBehavior.seekSeconds >= commandBoundaryBehavior.seekVisible[0] - 1e-8
		&& commandBoundaryBehavior.seekSeconds <= commandBoundaryBehavior.seekVisible[1] + 1e-8,
		"Seek to start left the snapped current time outside the visible range");
	await page.waitForFunction(() => document.querySelector("#inspector-panel")?.textContent.includes("生成提前量（秒）"));
	const inspectorText = await page.locator("#inspector-panel").textContent();
	for (const label of ["生成类型", "生成位置", "生成距离", "生成方向", "时间单位", "生成提前量（秒）", "生成提前量（拍）"]) {
		assert.ok(inspectorText.includes(label), `tip point inspector is missing ${label}`);
	}
	const inspectorChoices = page.locator('#inspector-panel input[type="radio"]');
	assert.equal(await inspectorChoices.count(), 4);
	assert.equal(await page.locator('#inspector-panel input[type="radio"][value="relative"]').isChecked(), true);
	assert.equal(await page.locator('#inspector-panel input[type="radio"][value="seconds"]').isChecked(), true);
	assert.equal(await page.locator('#inspector-panel label[title="绝对"] + .attached-input input').first().isDisabled(), true);
	assert.equal(await page.locator('#inspector-panel label[title="生成距离"] + input').isDisabled(), true,
		"tip-point spawn fields must be disabled for inherit mode");
	await page.locator('#inspector-panel label[title="生成类型"] + select').selectOption("chain");
	assert.equal(await page.locator('#inspector-panel label[title="生成距离"] + input').isDisabled(), true,
		"mixed chain/inherit selection must keep spawn fields disabled");
	await page.evaluate(() => {
		const firstSelected = globalThis.sviber.model.events.find(event => event.selected);
		if (firstSelected) globalThis.sviber.selectEvents([firstSelected.id], "replace");
	});
	await page.waitForFunction(() => globalThis.sviber.model.events.filter(event => event.selected).length === 1);
	await page.waitForFunction(() => !document.querySelector('#inspector-panel label[title="生成距离"] + input')?.disabled);

	const positionX = page.locator('#inspector-panel label[title="位置"] + .attached-input input').first();
	await positionX.fill("100 / 4");
	await positionX.press("Tab");
	await page.waitForFunction(() => globalThis.sviber.model.events.filter(event => event.selected).every(event => event.x === 25));
	await page.evaluate(() => document.activeElement?.blur());
	await page.keyboard.press("Control+z");
	await page.waitForFunction(() => globalThis.sviber.model.events.filter(event => event.selected).some(event => event.x !== 25));
	const radiansToggle = page.locator('#inspector-panel label[title="生成方向"] + .angle-input input[type="checkbox"]');
	await radiansToggle.check();
	const directionInput = page.locator('#inspector-panel label[title="生成方向"] + .angle-input > input');
	await directionInput.fill("pi / 3");
	await directionInput.press("Tab");
	await page.waitForFunction(() => globalThis.sviber.model.events.filter(event => event.selected)
		.every(event => Math.abs(event.tipPointSpawnAngle - Math.PI / 3) < 1e-9));

	await page.evaluate(() => globalThis.sviber.selectEvents(globalThis.sviber.model.events.map(event => event.id), "replace"));
	await page.waitForFunction(() => globalThis.sviber.model.events.every(event => event.selected));
	const eventType = page.locator('#inspector-panel label[title="类型"] + select');
	await eventType.selectOption("bgNote");
	await page.waitForFunction(() => globalThis.sviber.model.events.every(event => event.type === "bgNote"));
	await page.waitForSelector('#inspector-panel label[title="持续拍数"] + .rational-input');
	await page.evaluate(() => {
		const inputs = [...document.querySelector('#inspector-panel label[title="持续拍数"] + .rational-input').querySelectorAll('input')];
		inputs[0].value = "0";
		inputs[1].value = "0";
		inputs[2].value = "1";
		inputs[2].dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
	});
	await page.waitForFunction(() => globalThis.sviber.model.events.every(event => JSON.stringify(event.duration) === JSON.stringify([0, 0, 1])));
	await page.evaluate(() => document.activeElement?.blur());
	await page.keyboard.press("Control+d");
	await page.locator('.tool-button[data-command="events.bgNote"]').click();
	const defaultDurationStageBox = await stage.boundingBox();
	await page.mouse.click(defaultDurationStageBox.x + defaultDurationStageBox.width * 0.72,
		defaultDurationStageBox.y + defaultDurationStageBox.height * 0.64);
	await page.waitForFunction(() => globalThis.sviber.model.events.length === 3);
	assert.deepEqual(await page.evaluate(() => globalThis.sviber.model.events.find(event => event.selected).duration), [0, 0, 1],
		"bgNote creation did not remember the edited duration");
	await page.keyboard.press("Escape");
	await page.keyboard.press("Control+a");
	const positionsBeforeTransform = await page.evaluate(() => globalThis.sviber.model.events.map(event => ({ x: event.x, y: event.y })));
	await page.evaluate(() => document.activeElement?.blur());
	await page.keyboard.press("Control+t");
	await page.waitForFunction(() => Boolean(globalThis.sviber.freeTransform));
	assert.equal(await page.evaluate(() => globalThis.sviber.registry.isEnabled("file.save", globalThis.sviber)), false,
		"save must be disabled while a free transform preview is active");
	await page.waitForFunction(() => document.querySelectorAll("#inspector-panel .matrix-input input").length === 6);
	assert.equal(await page.locator("#inspector-panel .matrix-input input").count(), 6);
	const transformCenter = await page.evaluate(() => {
		const { bounds } = globalThis.sviber.freeTransform;
		const surface = globalThis.sviber.stage.surface;
		const rectangle = surface.canvas.getBoundingClientRect();
		const scale = Math.min(surface.width / 250, surface.height / 150);
		const x = surface.width / 2 + (bounds.minX + bounds.maxX) / 2 * scale;
		const y = surface.height / 2 - (bounds.minY + bounds.maxY) / 2 * scale;
		return {
			x: rectangle.left + x * rectangle.width / surface.width,
			y: rectangle.top + y * rectangle.height / surface.height,
		};
	});
	// The centered crosshair is the v12 anchor handle; start just beside it to test translation.
	await page.mouse.move(transformCenter.x + 30, transformCenter.y);
	await page.mouse.down();
	await page.mouse.move(transformCenter.x + 54, transformCenter.y - 12);
	await page.mouse.up();
	await page.waitForFunction(() => Math.abs(globalThis.sviber.freeTransform.matrix[4]) > 0.1);
	await page.screenshot({ path: path.join(outputDirectory, "sviber-free-transform.png"), fullPage: true });
	await page.keyboard.press("Enter");
	await page.waitForFunction(() => globalThis.sviber.freeTransform === null);

	const historyBeforeCurve = await page.evaluate(() => globalThis.sviber.history.length);
	await page.locator('.tool-button[data-command="snappee.bezierCurve"]').click();
	await page.waitForFunction(() => globalThis.sviber.curveDraft?.type === "bezierCurve");
	const curveStageBox = await stage.boundingBox();
	const curvePoints = [
		{ x: curveStageBox.x + curveStageBox.width * 0.36, y: curveStageBox.y + curveStageBox.height * 0.55 },
		{ x: curveStageBox.x + curveStageBox.width * 0.50, y: curveStageBox.y + curveStageBox.height * 0.38 },
		{ x: curveStageBox.x + curveStageBox.width * 0.64, y: curveStageBox.y + curveStageBox.height * 0.55 },
	];
	await page.mouse.click(curvePoints[0].x, curvePoints[0].y);
	await page.mouse.click(curvePoints[1].x, curvePoints[1].y);
	await page.waitForFunction(() => globalThis.sviber.curveDraft?.points.length === 2);
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	const firstCurvePoint = await page.evaluate(() => ({ ...globalThis.sviber.curveDraft.points[0] }));
	await page.mouse.move(curvePoints[0].x, curvePoints[0].y);
	await page.mouse.down();
	await page.mouse.move(curvePoints[0].x + 18, curvePoints[0].y - 10);
	await page.mouse.up();
	await page.waitForFunction(previous => {
		const point = globalThis.sviber.curveDraft?.points[0];
		return point && (Math.abs(point.x - previous.x) > 0.1 || Math.abs(point.y - previous.y) > 0.1);
	}, firstCurvePoint);
	await page.mouse.dblclick(curvePoints[2].x, curvePoints[2].y);
	await page.waitForFunction(() => globalThis.sviber.curveDraft === null
		&& globalThis.sviber.model.snappees.some(snappee => snappee.type === "bezierCurve"));
	await page.locator(".dialog").waitFor();
	assert.equal(await page.evaluate(() => {
		const entry = globalThis.sviber.dialogs.active?.entries.find(candidate => candidate.field.id === "segments");
		return Boolean(entry?.control.element.contains(document.activeElement)
			|| entry?.control.element === document.activeElement);
	}), true, "the curve parameter dialog did not focus the segments field");
	await page.locator('.dialog-button[data-dialog-action="cancel"]').click();
	const historyAfterCurve = await page.evaluate(() => globalThis.sviber.history.length);
	assert.ok(historyAfterCurve >= historyBeforeCurve + 4,
		`curve control-point actions were not recorded separately: ${historyBeforeCurve} -> ${historyAfterCurve}`);
	const positionsAfterTransform = await page.evaluate(() => globalThis.sviber.model.events.map(event => ({ x: event.x, y: event.y })));
	for (let index = 0; index < positionsBeforeTransform.length; index += 1) {
		assert.ok(positionsAfterTransform[index].x > positionsBeforeTransform[index].x);
		assert.ok(positionsAfterTransform[index].y > positionsBeforeTransform[index].y);
	}
	await page.keyboard.press("Control+t");
	await page.waitForFunction(() => Boolean(globalThis.sviber.freeTransform));
	const scaleHandle = await page.evaluate(() => {
		const { bounds } = globalThis.sviber.freeTransform;
		const surface = globalThis.sviber.stage.surface;
		const rectangle = surface.canvas.getBoundingClientRect();
		const scale = Math.min(surface.width / 250, surface.height / 150);
		const x = surface.width / 2 + bounds.maxX * scale;
		const y = surface.height / 2 - bounds.maxY * scale;
		return { x: rectangle.left + x * rectangle.width / surface.width, y: rectangle.top + y * rectangle.height / surface.height };
	});
	await page.mouse.move(scaleHandle.x, scaleHandle.y);
	await page.mouse.down();
	await page.mouse.move(scaleHandle.x + 18, scaleHandle.y - 10);
	await page.mouse.up();
	await page.waitForFunction(() => Math.abs(globalThis.sviber.freeTransform.matrix[0] - 1) > 0.01
		&& Math.abs(globalThis.sviber.freeTransform.matrix[3] - 1) > 0.01);
	await page.keyboard.press("Escape");
	assert.deepEqual(await page.evaluate(() => globalThis.sviber.model.events.map(event => ({ x: event.x, y: event.y }))), positionsAfterTransform);
	await page.locator('.tool-button[data-command="snappee.bezierCurve"]').click();
	await page.waitForFunction(() => globalThis.sviber.curveDraft?.type === "bezierCurve");
	const undoDraftBox = await stage.boundingBox();
	await page.mouse.click(undoDraftBox.x + undoDraftBox.width * 0.44, undoDraftBox.y + undoDraftBox.height * 0.72);
	await page.waitForFunction(() => globalThis.sviber.curveDraft?.points.length === 1);
	await page.keyboard.press("Control+z");
	await page.waitForFunction(() => globalThis.sviber.curveDraft?.type === "bezierCurve"
		&& globalThis.sviber.curveDraft.points.length === 0);
	await page.keyboard.press("Escape");

	await page.keyboard.press("Control+t");
	await page.waitForFunction(() => Boolean(globalThis.sviber.freeTransform));
	const rotationHandle = await page.evaluate(() => {
		const { bounds } = globalThis.sviber.freeTransform;
		const surface = globalThis.sviber.stage.surface;
		const rectangle = surface.canvas.getBoundingClientRect();
		const scale = Math.min(surface.width / 250, surface.height / 150);
		const center = { x: surface.width / 2 + (bounds.minX + bounds.maxX) / 2 * scale,
			y: surface.height / 2 - (bounds.minY + bounds.maxY) / 2 * scale };
		const top = { x: center.x, y: surface.height / 2 - bounds.maxY * scale };
		const length = Math.hypot(top.x - center.x, top.y - center.y) || 1;
		const point = { x: top.x + (top.x - center.x) / length * 28, y: top.y + (top.y - center.y) / length * 28 };
		return { x: rectangle.left + point.x * rectangle.width / surface.width,
			y: rectangle.top + point.y * rectangle.height / surface.height };
	});
	await page.mouse.move(rotationHandle.x, rotationHandle.y);
	await page.mouse.down();
	await page.mouse.move(rotationHandle.x + 28, rotationHandle.y + 5);
	await page.mouse.up();
	await page.waitForFunction(() => Math.abs(globalThis.sviber.freeTransform.matrix[1]) > 0.01);
	await page.keyboard.press("Enter");
	await page.waitForFunction(() => globalThis.sviber.freeTransform === null);

	await page.locator('.tool-button[data-command="snappee.pen"]').click();
	await page.waitForFunction(() => globalThis.sviber.curveDraft?.type === "penCurve");
	const penStageBox = await stage.boundingBox();
	const penPoints = [
		{ x: penStageBox.x + penStageBox.width * 0.32, y: penStageBox.y + penStageBox.height * 0.68 },
		{ x: penStageBox.x + penStageBox.width * 0.50, y: penStageBox.y + penStageBox.height * 0.48 },
		{ x: penStageBox.x + penStageBox.width * 0.68, y: penStageBox.y + penStageBox.height * 0.66 },
	];
	for (const [index, point] of penPoints.entries()) {
		await page.mouse.move(point.x, point.y);
		await page.mouse.down();
		if (index < 2) await page.mouse.move(point.x + 28, point.y - 14);
		await page.mouse.up();
	}
	await page.keyboard.press("Enter");
	await page.waitForFunction(() => globalThis.sviber.curveDraft === null
		&& globalThis.sviber.model.snappees.some(snappee => snappee.type === "penCurve"));
	await page.locator(".dialog").waitFor();
	assert.equal(await page.evaluate(() => {
		const entry = globalThis.sviber.dialogs.active?.entries.find(candidate => candidate.field.id === "segments");
		return Boolean(entry?.control.element.contains(document.activeElement)
			|| entry?.control.element === document.activeElement);
	}), true, "the pen parameter dialog did not focus the segments field");
	await page.locator('.dialog-button[data-dialog-action="cancel"]').click();
	const penCommands = await page.evaluate(() => globalThis.sviber.model.snappees.find(snappee => snappee.type === "penCurve").commands);
	assert.equal(penCommands[0].type, "M");
	assert.ok(penCommands.some(command => command.type === "C"), "dragging a pen node did not create a Bezier segment");
	assert.ok(penCommands.some(command => command.type === "C"
		&& (command.x1 !== command.x || command.y1 !== command.y || command.x2 !== command.x || command.y2 !== command.y)),
	"pen control handles collapsed onto their endpoint");
	await page.locator('.tool-button[data-command="snappee.circularArc"]').click();
	await page.waitForFunction(() => globalThis.sviber.curveDraft?.type === "circularArcCurve");
	const arcCenter = { x: penStageBox.x + penStageBox.width * 0.78, y: penStageBox.y + penStageBox.height * 0.40 };
	const arcEnd = { x: arcCenter.x + 42, y: arcCenter.y };
	await page.mouse.click(arcCenter.x, arcCenter.y);
	await page.mouse.click(arcEnd.x, arcEnd.y);
	await page.mouse.click(arcEnd.x, arcEnd.y);
	await page.waitForFunction(() => globalThis.sviber.curveDraft === null
		&& globalThis.sviber.model.snappees.some(snappee => snappee.type === "circularArcCurve" && snappee.closed));

	await page.evaluate(() => {
		const app = globalThis.sviber;
		app.playbackFrameCount = 0;
		app.__playbackPanelRenderCounts = { inspector: 0, snappees: 0, history: 0 };
		app.__playbackPanelRenderOriginals = [
			[app.inspectorPanel, "inspector"], [app.snappeesPanel, "snappees"], [app.historyPanel, "history"],
		].map(([panel, key]) => {
			const original = panel.render;
			panel.render = function(...args) {
				app.__playbackPanelRenderCounts[key] += 1;
				return original.apply(this, args);
			};
			return [panel, original];
		});
	});
	await page.locator('.tool-button[data-command="music.playPause"]').click();
	await page.waitForFunction(() => globalThis.sviber.audio.playing === true);
	await page.waitForTimeout(250);
	const playbackRenderStats = await page.evaluate(() => ({
		frames: globalThis.sviber.playbackFrameCount,
		panels: globalThis.sviber.__playbackPanelRenderCounts,
	}));
	assert.ok(playbackRenderStats.frames >= 5, `playback did not maintain animation frames: ${JSON.stringify(playbackRenderStats)}`);
	assert.ok(Object.values(playbackRenderStats.panels).every(count => count <= 2),
		`playback rebuilt sidebar panels every frame: ${JSON.stringify(playbackRenderStats)}`);
	const playbackState = await page.evaluate(() => ({
		events: globalThis.sviber.model.events.map(({ selected: _selected, ...event }) => event),
		saveEnabled: globalThis.sviber.registry.isEnabled("file.save", globalThis.sviber),
		moveEnabled: globalThis.sviber.registry.isEnabled("transform.moveRight", globalThis.sviber),
		musicEnabled: globalThis.sviber.registry.isEnabled("music.seekForward", globalThis.sviber),
		inspectorInert: document.querySelector("#inspector-panel").inert,
		operationalPanelsInert: [...document.querySelectorAll("#channels-panel,#snappees-panel,.history-panel")]
			.some(element => element.inert),
	}));
	assert.equal(playbackState.saveEnabled, true);
	assert.equal(playbackState.moveEnabled, true);
	assert.equal(playbackState.musicEnabled, true);
	assert.equal(playbackState.inspectorInert, false);
	assert.equal(playbackState.operationalPanelsInert, false);
	const playbackStageBox = await stage.boundingBox();
	await page.mouse.click(playbackStageBox.x + playbackStageBox.width * 0.84,
		playbackStageBox.y + playbackStageBox.height * 0.76);
	const timelineBoxWhilePlaying = await page.locator("#timeline-surface canvas").boundingBox();
	await page.mouse.click(timelineBoxWhilePlaying.x + timelineBoxWhilePlaying.width * 0.73,
		timelineBoxWhilePlaying.y + timelineBoxWhilePlaying.height * 0.55);
	await page.waitForTimeout(120);
	assert.equal(await page.evaluate(() => globalThis.sviber.audio.playing), true,
		"an editor-canvas click paused playback");
	assert.deepEqual(await page.evaluate(() => globalThis.sviber.model.events
		.map(({ selected: _selected, ...event }) => event)), playbackState.events,
		"an editor-canvas interaction edited events during playback");
	await page.locator('.tool-button[data-command="music.playPause"]').click();
	await page.waitForFunction(() => globalThis.sviber.audio.playing === false);
	await page.evaluate(() => {
		const app = globalThis.sviber;
		for (const [panel, original] of app.__playbackPanelRenderOriginals || []) panel.render = original;
		delete app.__playbackPanelRenderOriginals;
		delete app.__playbackPanelRenderCounts;
	});

}
