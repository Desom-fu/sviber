// The out-of-bound behaviour matrix: every editing path that can push a note past the chart
// boundary is exercised twice, once with the boundary enforced and once with it lifted, and the
// two outcomes are compared. Each check drives the page through the harness published by
// verify-browser-bounds-harness.mjs.
import assert from "node:assert/strict";

import { installBoundsHarness, releaseBoundsHarness } from "./verify-browser-bounds-harness.mjs";

async function checkArrowInspectorAndDrag(page) {
	const result = await page.evaluate(() => {
		const app = globalThis.sviber;
		const harness = globalThis.__sviberBoundsHarness;
		harness.install({ allow: false, events: [harness.tap(0, 95, 40)] });
		const boundedArrowApplied = app.translateSelected(12.5, 0);
		const boundedArrow = { x: app.model.events[0].x, applied: boundedArrowApplied };
		app.editSelectedProperty("x", 150);
		app.editSelectedProperty("y", 70);
		const boundedInspector = { x: app.model.events[0].x, y: app.model.events[0].y };
		app.movePosition(0, { x: 150, y: 70 });
		const boundedDrag = { x: app.model.events[0].x, y: app.model.events[0].y };

		harness.install({ allow: true, events: [harness.tap(0, 95, 40)] });
		const unboundedArrowApplied = app.translateSelected(12.5, 0);
		const unboundedArrow = { x: app.model.events[0].x, applied: unboundedArrowApplied };
		app.editSelectedProperty("x", 150);
		app.editSelectedProperty("y", 70);
		const unboundedInspector = { x: app.model.events[0].x, y: app.model.events[0].y };
		app.movePosition(0, { x: 175, y: 80 });
		const unboundedDrag = { x: app.model.events[0].x, y: app.model.events[0].y };
		return { boundedArrow, boundedInspector, boundedDrag, unboundedArrow, unboundedInspector, unboundedDrag };
	});
	assert.deepEqual(result.boundedArrow, { x: 95, applied: false });
	assert.deepEqual(result.boundedInspector, { x: 100, y: 50 });
	assert.deepEqual(result.boundedDrag, { x: 100, y: 50 });
	assert.deepEqual(result.unboundedArrow, { x: 107.5, applied: true });
	assert.deepEqual(result.unboundedInspector, { x: 150, y: 70 });
	assert.deepEqual(result.unboundedDrag, { x: 175, y: 80 });
}

async function checkFreeTransform(page) {
	const result = await page.evaluate(() => {
		const app = globalThis.sviber;
		const harness = globalThis.__sviberBoundsHarness;
		harness.install({ allow: false, events: [harness.tap(0, 90, 40), harness.tap(1, 95, 45)] });
		const boundedFreeStarted = app.startFreeTransform();
		const boundedFreeApplied = app.previewFreeTransform([1, 0, 0, 1, 20, 20]);
		const boundedFree = app.model.events.map(event => ({ x: event.x, y: event.y }));
		app.cancelFreeTransform();
		harness.install({ allow: true, events: [harness.tap(0, 90, 40), harness.tap(1, 95, 45)] });
		const unboundedFreeStarted = app.startFreeTransform();
		const unboundedFreeApplied = app.previewFreeTransform([1, 0, 0, 1, 20, 20]);
		const unboundedFree = app.model.events.map(event => ({ x: event.x, y: event.y }));
		app.cancelFreeTransform();
		return {
			boundedFreeStarted,
			boundedFreeApplied,
			boundedFree,
			unboundedFreeStarted,
			unboundedFreeApplied,
			unboundedFree,
		};
	});
	assert.equal(result.boundedFreeStarted, true);
	assert.equal(result.boundedFreeApplied, true);
	assert.deepEqual(result.boundedFree, [
		{ x: 95, y: 45 },
		{ x: 100, y: 50 },
	]);
	assert.equal(result.unboundedFreeStarted, true);
	assert.equal(result.unboundedFreeApplied, true);
	assert.deepEqual(result.unboundedFree, [
		{ x: 110, y: 60 },
		{ x: 115, y: 65 },
	]);
}

async function checkAttachment(page) {
	const result = await page.evaluate(() => {
		const app = globalThis.sviber;
		const harness = globalThis.__sviberBoundsHarness;
		const outsideMesh = () => [{ ...harness.mesh(false), topLeftX: 130 }];
		harness.install({ allow: false, events: [harness.tap(0, 129, 0)], snappees: outsideMesh() });
		app.attachSelected();
		const boundedAttach = app.model.events[0].attached;
		harness.install({ allow: true, events: [harness.tap(0, 129, 0)], snappees: outsideMesh() });
		app.attachSelected();
		const unboundedAttach = app.model.events[0].attached;

		harness.install({ allow: false, events: harness.attachedPair(), snappees: [harness.mesh(false)] });
		app.movePosition(0, { x: 130, y: 0, snappeeId: 0, snapPoint: [1, 0] });
		const boundedAttachedMove = structuredClone(app.model.events[0].snapPoint);
		harness.install({ allow: true, events: harness.attachedPair(), snappees: [harness.mesh(false)] });
		app.movePosition(0, { x: 130, y: 0, snappeeId: 0, snapPoint: [1, 0] });
		const unboundedAttachedMove = structuredClone(app.model.events[0].snapPoint);
		return { boundedAttach, unboundedAttach, boundedAttachedMove, unboundedAttachedMove };
	});
	assert.equal(result.boundedAttach, false);
	assert.equal(result.unboundedAttach, true);
	assert.deepEqual(result.boundedAttachedMove, [0, 0]);
	assert.deepEqual(result.unboundedAttachedMove, [1, 0]);
}

async function checkCurveFill(page) {
	const result = await page.evaluate(() => {
		const app = globalThis.sviber;
		const harness = globalThis.__sviberBoundsHarness;
		const commands = () => [
			{ type: "M", x: 0, y: 0 },
			{ type: "L", x: 130, y: 0 },
		];
		harness.install({ allow: false, snappees: [harness.mesh(true)] });
		const curve = app.model.snappees[0];
		curve.type = "penCurve";
		curve.commands = commands();
		curve.segments = 2;
		curve.closed = false;
		app.fillSelectedCurve();
		const boundedFill = app.model.events.map(
			event =>
				app.model
					.generateSunniesnowEvents()
					.find(item => item.type === "drag" && item.time === app.model.timing.beatToSeconds(event.time))
					?.properties.x,
		);
		harness.install({
			allow: true,
			snappees: [{ ...harness.mesh(true), type: "penCurve", commands: commands(), segments: 2, closed: false }],
		});
		app.fillSelectedCurve();
		const unboundedFill = app.model
			.generateSunniesnowEvents()
			.filter(event => event.type === "drag")
			.map(event => event.properties.x);
		return { boundedFill, unboundedFill };
	});
	assert.ok(result.boundedFill.length > 0);
	assert.ok(result.unboundedFill.length > result.boundedFill.length);
	assert.ok(result.boundedFill.every(x => x <= 100));
	assert.ok(result.unboundedFill.some(x => x > 100));
}

async function checkClipboardPaste(page) {
	const result = await page.evaluate(async () => {
		const harness = globalThis.__sviberBoundsHarness;
		const directClipboard = {
			version: 1,
			events: [{ type: "tap", beat: [0, 0, 1], channel: 0, attached: false, x: 150, y: 70 }],
			snappees: [],
		};
		const boundedDirectPaste = await harness.pasteData(false, directClipboard, false);
		const unboundedDirectPaste = await harness.pasteData(true, directClipboard, false);
		const pastedMesh = {
			...harness.mesh(false),
			topLeftX: 150,
			topLeftY: 70,
			bottomRightX: 150,
			bottomRightY: 70,
		};
		const attachedClipboard = {
			version: 1,
			events: [{ type: "tap", beat: [0, 0, 1], channel: 0, attached: true, snappee: 0, snapPoint: [0, 0] }],
			snappees: [pastedMesh],
		};
		const boundedAttachedPaste = await harness.pasteData(false, attachedClipboard, true);
		const unboundedAttachedPaste = await harness.pasteData(true, attachedClipboard, true);
		const missingSnappeePaste = await harness.pasteData(true, { ...attachedClipboard, snappees: [] }, true);
		return {
			boundedDirectPaste,
			unboundedDirectPaste,
			boundedAttachedPaste,
			unboundedAttachedPaste,
			missingSnappeePaste,
		};
	});
	assert.deepEqual(result.boundedDirectPaste, { attached: false, x: 100, y: 50, generatedX: 100, generatedY: 50 });
	assert.deepEqual(result.unboundedDirectPaste, { attached: false, x: 150, y: 70, generatedX: 150, generatedY: 70 });
	assert.deepEqual(result.boundedAttachedPaste, { attached: false, x: 100, y: 50, generatedX: 100, generatedY: 50 });
	assert.deepEqual(result.unboundedAttachedPaste, {
		attached: true,
		x: undefined,
		y: undefined,
		generatedX: 150,
		generatedY: 70,
	});
	assert.deepEqual(result.missingSnappeePaste, { attached: false, x: 0, y: 0, generatedX: 0, generatedY: 0 });
}

async function checkSnappeeHandleAndDialog(page) {
	const result = await page.evaluate(async () => {
		const app = globalThis.sviber;
		const harness = globalThis.__sviberBoundsHarness;
		harness.install({ allow: false, events: [harness.attachedEvent], snappees: [harness.mesh(false)] });
		const boundedHandleHistory = app.history.length;
		app.setSnappeeHandle(0, 0, { x: 150, y: 70 });
		const boundedSnappeeHandle = {
			x: app.model.snappees[0].topLeftX,
			y: app.model.snappees[0].topLeftY,
			historyDelta: app.history.length - boundedHandleHistory,
		};
		harness.install({ allow: true, events: [harness.attachedEvent], snappees: [harness.mesh(false)] });
		app.setSnappeeHandle(0, 0, { x: 150, y: 70 });
		const unboundedSnappeeHandle = {
			x: app.model.snappees[0].topLeftX,
			y: app.model.snappees[0].topLeftY,
			generatedX: app.model.generateSunniesnowEvents().find(item => item.type === "tap")?.properties.x,
			generatedY: app.model.generateSunniesnowEvents().find(item => item.type === "tap")?.properties.y,
		};
		const boundedSnappeeDialog = await harness.editSnappeeThroughDialog(false);
		const unboundedSnappeeDialog = await harness.editSnappeeThroughDialog(true);
		return { boundedSnappeeHandle, unboundedSnappeeHandle, boundedSnappeeDialog, unboundedSnappeeDialog };
	});
	assert.deepEqual(result.boundedSnappeeHandle, { x: 0, y: 0, historyDelta: 0 });
	assert.deepEqual(result.unboundedSnappeeHandle, { x: 150, y: 70, generatedX: 150, generatedY: 70 });
	assert.deepEqual(result.boundedSnappeeDialog, { x: 0, y: 0, generatedX: 0, generatedY: 0 });
	assert.deepEqual(result.unboundedSnappeeDialog, { x: 150, y: 70, generatedX: 150, generatedY: 70 });
}

export async function runBoundsBehaviorMatrix(page, fixture) {
	await installBoundsHarness(page, fixture);
	await checkArrowInspectorAndDrag(page);
	await checkFreeTransform(page);
	await checkAttachment(page);
	await checkCurveFill(page);
	await checkClipboardPaste(page);
	await checkSnappeeHandleAndDialog(page);
	await releaseBoundsHarness(page);
}
