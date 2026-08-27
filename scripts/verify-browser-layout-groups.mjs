// Checks for how the editor lays out channels and edits groups: the timeline grows with its
// first three channels only, a multi-selection dragged on the stage moves rigidly, clicking a
// selected note drops it from the selection, and Ctrl+G produces a group with its own inspector.
import assert from "node:assert/strict";
import path from "node:path";

import { settleFrames } from "./verify-browser-interaction-fixtures.mjs";

async function captureLayoutFixture(page) {
	return page.evaluate(() => ({
		snapshot: globalThis.sviber.model.snapshot(),
		historyLabel: globalThis.sviber.history.currentEntry.label,
		savedSignature: globalThis.sviber.savedSignature,
	}));
}

async function installLayoutFixture(page, fixture, { channels, events }) {
	await page.evaluate(
		({ original, channels: fixtureChannels, events: fixtureEvents }) => {
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
		},
		{ original: fixture, channels, events },
	);
	await settleFrames(page);
}

async function restoreLayoutFixture(page, fixture) {
	await page.evaluate(original => {
		globalThis.sviber.model.restore(original.snapshot);
		globalThis.sviber.history.reset(original.snapshot, original.historyLabel);
		globalThis.sviber.savedSignature = original.savedSignature;
		globalThis.sviber.updateDirty();
		globalThis.sviber.refresh();
	}, fixture);
	await settleFrames(page);
}

async function checkTimelineChannelGrowth(page, fixture) {
	const timelineHeights = [];
	for (let channelCount = 1; channelCount <= 4; channelCount += 1) {
		await installLayoutFixture(page, fixture, {
			channels: Array.from({ length: channelCount }, (_, index) => index),
			events: [],
		});
		timelineHeights.push((await page.locator(".timeline-row").boundingBox()).height);
	}
	assert.ok(
		timelineHeights[1] > timelineHeights[0] && timelineHeights[2] > timelineHeights[1],
		`timeline did not grow with its first three channels: ${timelineHeights.join(", ")}`,
	);
	assert.equal(
		timelineHeights[3],
		timelineHeights[2],
		`timeline grew beyond three channels: ${timelineHeights.join(", ")}`,
	);
}

async function checkStageGroupEditing(page, fixture) {
	await installLayoutFixture(page, fixture, {
		channels: [0],
		events: [
			{ id: 0, type: "tap", time: [0, 0, 1], channel: 0, selected: true, attached: false, x: -30, y: 0 },
			{ id: 1, type: "tap", time: [0, 0, 1], channel: 0, selected: true, attached: false, x: 30, y: 0 },
		],
	});
	const stagePointer = async eventId =>
		page.evaluate(id => {
			const app = globalThis.sviber;
			const event = app.model.events.find(candidate => candidate.id === id);
			const surface = app.stage.surface;
			const rectangle = surface.canvas.getBoundingClientRect();
			const scale = Math.min(surface.width / 250, surface.height / 150);
			return {
				x: rectangle.left + ((surface.width / 2 + event.x * scale) * rectangle.width) / surface.width,
				y: rectangle.top + ((surface.height / 2 - event.y * scale) * rectangle.height) / surface.height,
			};
		}, eventId);
	const stageBeforeMove = await page.evaluate(() =>
		globalThis.sviber.model.events.map(event => ({ x: event.x, y: event.y })),
	);
	let stagePointerPosition = await stagePointer(0);
	await page.mouse.move(stagePointerPosition.x, stagePointerPosition.y);
	await page.mouse.down();
	await page.mouse.move(stagePointerPosition.x + 36, stagePointerPosition.y - 18);
	await page.mouse.up();
	const stageAfterMove = await page.evaluate(() =>
		globalThis.sviber.model.events.map(event => ({
			x: event.x,
			y: event.y,
			selected: event.selected,
		})),
	);
	assert.ok(
		stageAfterMove.every(event => event.selected),
		"dragging one selected stage event collapsed the group selection",
	);
	assert.ok(
		stageAfterMove[0].x > stageBeforeMove[0].x && stageAfterMove[0].y > stageBeforeMove[0].y,
		"the primary stage event did not move",
	);
	assert.ok(
		Math.abs(stageAfterMove[0].x - stageBeforeMove[0].x - (stageAfterMove[1].x - stageBeforeMove[1].x)) < 1e-6 &&
			Math.abs(stageAfterMove[0].y - stageBeforeMove[0].y - (stageAfterMove[1].y - stageBeforeMove[1].y)) < 1e-6,
		"stage multi-selection did not move as a rigid group",
	);
	stagePointerPosition = await stagePointer(0);
	await page.mouse.click(stagePointerPosition.x, stagePointerPosition.y);
	assert.deepEqual(
		await page.evaluate(() => globalThis.sviber.model.events.map(event => event.selected)),
		[false, true],
		"clicking a selected stage event without dragging did not remove that event from the selection",
	);
	await page.keyboard.press("Control+a");
	await page.keyboard.press("Control+g");
	await page.waitForFunction(
		() =>
			globalThis.sviber.model.events.length === 1 &&
			globalThis.sviber.model.events[0].type === "group" &&
			globalThis.sviber.model.events[0].selected,
	);
	await page.waitForFunction(() => globalThis.sviber.stage.hitRegions.some(region => region.type === "group-anchor"));
	const groupInspector = await page.evaluate(() => ({
		text: document.querySelector("#inspector-panel")?.textContent || "",
		colorInputs: document.querySelectorAll('#inspector-panel input[type="color"]').length,
		selects: document.querySelectorAll("#inspector-panel select").length,
		anchors: globalThis.sviber.stage.hitRegions.filter(region => region.type === "group-anchor").length,
	}));
	assert.match(groupInspector.text, /分组/);
	assert.match(groupInspector.text, /时间/);
	assert.match(groupInspector.text, /颜色/);
	assert.equal(groupInspector.colorInputs, 1, "group color input is missing");
	assert.equal(groupInspector.selects, 0, "group inspector still exposes an event-type selector");
	assert.ok(groupInspector.anchors > 0, "selected group anchor is missing from the main editor hit regions");
}

export async function runLayoutAndGroupChecks(page, outputDirectory) {
	const layoutFixture = await captureLayoutFixture(page);
	await checkTimelineChannelGrowth(page, layoutFixture);
	await checkStageGroupEditing(page, layoutFixture);
	await restoreLayoutFixture(page, layoutFixture);
	await page.screenshot({ path: path.join(outputDirectory, "sviber-desktop-zh-CN.png"), fullPage: true });
}
