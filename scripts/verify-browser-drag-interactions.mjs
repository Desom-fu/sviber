// Pointer interaction checks for the stage and timeline: a multi-selection dragged from either
// view keeps its spacing, Ctrl+Space pans the main field, Ctrl-drag duplicates the selection,
// and Ctrl+T raises free-transform handles for a line-shaped group.
import assert from "node:assert/strict";

import { settleFrames } from "./verify-browser-interaction-fixtures.mjs";

async function canvasPoint(page, viewName, collectionName) {
	return page.evaluate(
		({ viewName: view, collectionName: collection }) => {
			const renderer = globalThis.sviber[view];
			const item = renderer[collection].find(record => record.event.selected);
			if (!item) {
				return null;
			}
			const rectangle = renderer.surface.canvas.getBoundingClientRect();
			const point = item.screen || item;
			return {
				x: rectangle.left + (point.x * rectangle.width) / renderer.surface.width,
				y: rectangle.top + (point.y * rectangle.height) / renderer.surface.height,
			};
		},
		{ viewName, collectionName },
	);
}

async function eventState(page) {
	return page.evaluate(() =>
		globalThis.sviber.model.events.map(event => ({
			id: event.id,
			x: Number(event.x),
			y: Number(event.y),
			time: event.time[0] + event.time[1] / event.time[2],
			channel: event.channel,
			selected: Boolean(event.selected),
		})),
	);
}

async function checkGroupFreeTransformHandles(page) {
	const groupTransformFixture = await page.evaluate(() => {
		const app = globalThis.sviber;
		const snapshot = app.model.snapshot();
		const historyLabel = app.history.currentEntry.label;
		const savedSignature = app.savedSignature;
		app.model.events = [
			{
				id: 700,
				type: "group",
				channel: app.model.channels[0].id,
				time: [0, 0, 1],
				x: 0,
				y: 0,
				selected: true,
				events: [
					{ id: 701, type: "tap", channel: app.model.channels[0].id, time: [0, 0, 1], x: 0, y: -20 },
					{ id: 702, type: "tap", channel: app.model.channels[0].id, time: [1, 0, 1], x: 0, y: 20 },
				],
			},
		];
		app.groupSelectionScope = null;
		app.model.editor.currentTime = [0, 0, 1];
		app.model.editor.visibleRangeBeginning = 0;
		app.model.editor.visibleRangeEnd = 4;
		app.refreshNow();
		return { snapshot, historyLabel, savedSignature };
	});
	await page.keyboard.press("Control+T");
	await page.waitForTimeout(50);
	const groupTransformState = await page.evaluate(() => ({
		free: Boolean(globalThis.sviber.freeTransform),
		corners: globalThis.sviber.stage.hitRegions.filter(region => region.type === "free-scale").length,
	}));
	assert.equal(groupTransformState.free, true, "Ctrl+T did not start free transform for a line-shaped group");
	assert.equal(groupTransformState.corners, 4, "group free transform did not render four corner handles");
	await page.evaluate(({ snapshot, historyLabel, savedSignature }) => {
		const app = globalThis.sviber;
		app.cancelFreeTransform();
		app.model.restore(snapshot);
		app.history.reset(snapshot, historyLabel);
		app.savedSignature = savedSignature;
		app.updateDirty();
		app.refreshNow();
	}, groupTransformFixture);
}

async function checkStageDrag(page) {
	const stageDragPoint = await canvasPoint(page, "stage", "visibleEvents");
	assert.ok(stageDragPoint, "selected stage event was not rendered for drag verification");
	const beforeStageDrag = await eventState(page);
	await page.mouse.move(stageDragPoint.x, stageDragPoint.y);
	await page.mouse.down();
	await page.mouse.move(stageDragPoint.x + 36, stageDragPoint.y - 18, { steps: 3 });
	await page.mouse.up();
	const afterStageDrag = await eventState(page);
	const stageDeltas = afterStageDrag.map((event, index) => ({
		x: event.x - beforeStageDrag[index].x,
		y: event.y - beforeStageDrag[index].y,
	}));
	assert.ok(Math.hypot(stageDeltas[0].x, stageDeltas[0].y) > 1, "stage drag did not move the selection");
	assert.ok(
		stageDeltas.every(
			delta => Math.abs(delta.x - stageDeltas[0].x) < 1e-8 && Math.abs(delta.y - stageDeltas[0].y) < 1e-8,
		),
		"stage drag did not preserve multi-selection spacing",
	);
}

async function checkViewportPan(page) {
	const stageCanvas = page.locator("#stage-surface canvas");
	const panCanvasBox = await stageCanvas.boundingBox();
	assert.ok(panCanvasBox, "stage canvas has no bounding box for viewport-pan verification");
	await page.evaluate(() => globalThis.sviber.resetMainFieldView());
	const panStart = { x: panCanvasBox.x + panCanvasBox.width / 2, y: panCanvasBox.y + panCanvasBox.height / 2 };
	await page.keyboard.down("Control");
	await page.keyboard.down("Space");
	await page.mouse.move(panStart.x, panStart.y);
	await page.mouse.down();
	await page.mouse.move(panStart.x + 80, panStart.y + 40, { steps: 4 });
	await page.keyboard.up("Control");
	await page.mouse.up();
	await page.keyboard.up("Space");
	await page.waitForFunction(
		() =>
			Math.hypot(globalThis.sviber.model.editor.mainFieldPanX, globalThis.sviber.model.editor.mainFieldPanY) > 1,
	);
}

async function checkTimelineMove(page) {
	const timelineMovePoint = await canvasPoint(page, "timeline", "eventCenters");
	assert.ok(timelineMovePoint, "selected timeline event was not rendered for drag verification");
	const beforeTimelineMove = await eventState(page);
	await page.mouse.move(timelineMovePoint.x, timelineMovePoint.y);
	await page.mouse.down();
	await page.mouse.move(timelineMovePoint.x + 72, timelineMovePoint.y, { steps: 3 });
	await page.mouse.up();
	const afterTimelineMove = await eventState(page);
	const timelineDelta = afterTimelineMove[0].time - beforeTimelineMove[0].time;
	assert.ok(timelineDelta > 0, "timeline drag did not move the selection in time");
	assert.ok(
		afterTimelineMove.every(
			(event, index) => Math.abs(event.time - beforeTimelineMove[index].time - timelineDelta) < 1e-8,
		),
		"timeline drag did not preserve multi-selection timing",
	);
	await settleFrames(page);
}

async function checkTimelineCopyDrag(page) {
	const timelineCopyPoint = await canvasPoint(page, "timeline", "eventCenters");
	assert.ok(timelineCopyPoint, "selected timeline event was not rendered for copy-drag verification");
	const beforeTimelineCopy = await eventState(page);
	await page.keyboard.down("Control");
	await page.mouse.move(timelineCopyPoint.x, timelineCopyPoint.y);
	await page.mouse.down();
	await page.mouse.move(timelineCopyPoint.x + 72, timelineCopyPoint.y, { steps: 3 });
	await page.mouse.up();
	await page.keyboard.up("Control");
	const afterTimelineCopy = await eventState(page);
	assert.equal(
		afterTimelineCopy.length,
		beforeTimelineCopy.length * 2,
		"Ctrl-drag did not duplicate all selected events",
	);
	const originalsAfterCopy = afterTimelineCopy.filter(event =>
		beforeTimelineCopy.some(original => original.id === event.id),
	);
	const copiesAfterCopy = afterTimelineCopy.filter(
		event => !beforeTimelineCopy.some(original => original.id === event.id),
	);
	assert.deepEqual(
		originalsAfterCopy,
		beforeTimelineCopy.map(event => ({ ...event, selected: false })),
		"Ctrl-drag changed an original event",
	);
	assert.equal(copiesAfterCopy.length, beforeTimelineCopy.length);
	assert.ok(
		copiesAfterCopy.every(event => event.selected),
		"Ctrl-drag copies were not selected",
	);
	const copyDelta = copiesAfterCopy[0].time - beforeTimelineCopy[0].time;
	assert.ok(copyDelta > 0, "Ctrl-drag copies were not moved away from their originals");
	assert.ok(
		copiesAfterCopy.every(
			(event, index) => Math.abs(event.time - beforeTimelineCopy[index].time - copyDelta) < 1e-8,
		),
		"Ctrl-drag did not preserve copied event timing",
	);
}

export async function runDragInteractionChecks(page) {
	await checkGroupFreeTransformHandles(page);
	await checkStageDrag(page);
	await checkViewportPan(page);
	await checkTimelineMove(page);
	await checkTimelineCopyDrag(page);
}
