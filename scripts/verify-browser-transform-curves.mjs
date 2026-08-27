// Checks for free transform and curve drafting on the stage: the anchor, scale and rotation
// handles each drive the preview matrix, Enter commits and Escape reverts, and the Bezier, pen
// and circular-arc tools each record their control points as separate history entries.
import assert from "node:assert/strict";
import path from "node:path";

async function checkFreeTransformTranslate(page, outputDirectory) {
	const positionsBeforeTransform = await page.evaluate(() =>
		globalThis.sviber.model.events.map(event => ({ x: event.x, y: event.y })),
	);
	await page.evaluate(() => document.activeElement?.blur());
	await page.keyboard.press("Control+t");
	await page.waitForFunction(() => Boolean(globalThis.sviber.freeTransform));
	assert.equal(
		await page.evaluate(() => globalThis.sviber.registry.isEnabled("file.save", globalThis.sviber)),
		false,
		"save must be disabled while a free transform preview is active",
	);
	await page.waitForFunction(() => document.querySelectorAll("#inspector-panel .matrix-input input").length === 6);
	assert.equal(await page.locator("#inspector-panel .matrix-input input").count(), 6);
	const transformCenter = await page.evaluate(() => {
		const { bounds } = globalThis.sviber.freeTransform;
		const surface = globalThis.sviber.stage.surface;
		const rectangle = surface.canvas.getBoundingClientRect();
		const scale = Math.min(surface.width / 250, surface.height / 150);
		const x = surface.width / 2 + ((bounds.minX + bounds.maxX) / 2) * scale;
		const y = surface.height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale;
		return {
			x: rectangle.left + (x * rectangle.width) / surface.width,
			y: rectangle.top + (y * rectangle.height) / surface.height,
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
	return positionsBeforeTransform;
}

async function checkBezierCurveDraft(page, stage) {
	const historyBeforeCurve = await page.evaluate(() => globalThis.sviber.history.length);
	await page.locator('.tool-button[data-command="snappee.bezierCurve"]').click();
	await page.waitForFunction(() => globalThis.sviber.curveDraft?.type === "bezierCurve");
	const curveStageBox = await stage.boundingBox();
	const curvePoints = [
		{ x: curveStageBox.x + curveStageBox.width * 0.36, y: curveStageBox.y + curveStageBox.height * 0.55 },
		{ x: curveStageBox.x + curveStageBox.width * 0.5, y: curveStageBox.y + curveStageBox.height * 0.38 },
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
	await page.waitForFunction(
		() =>
			globalThis.sviber.curveDraft === null &&
			globalThis.sviber.model.snappees.some(snappee => snappee.type === "bezierCurve"),
	);
	await page.locator(".dialog").waitFor();
	assert.equal(
		await page.evaluate(() => {
			const entry = globalThis.sviber.dialogs.active?.entries.find(
				candidate => candidate.field.id === "segments",
			);
			return Boolean(
				entry?.control.element.contains(document.activeElement) ||
					entry?.control.element === document.activeElement,
			);
		}),
		true,
		"the curve parameter dialog did not focus the segments field",
	);
	await page.locator('.dialog-button[data-dialog-action="cancel"]').click();
	const historyAfterCurve = await page.evaluate(() => globalThis.sviber.history.length);
	assert.ok(
		historyAfterCurve >= historyBeforeCurve + 4,
		`curve control-point actions were not recorded separately: ${historyBeforeCurve} -> ${historyAfterCurve}`,
	);
}

async function checkTransformScaleAndCancel(page, positionsBeforeTransform) {
	const positionsAfterTransform = await page.evaluate(() =>
		globalThis.sviber.model.events.map(event => ({ x: event.x, y: event.y })),
	);
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
		return {
			x: rectangle.left + (x * rectangle.width) / surface.width,
			y: rectangle.top + (y * rectangle.height) / surface.height,
		};
	});
	await page.mouse.move(scaleHandle.x, scaleHandle.y);
	await page.mouse.down();
	await page.mouse.move(scaleHandle.x + 18, scaleHandle.y - 10);
	await page.mouse.up();
	await page.waitForFunction(
		() =>
			Math.abs(globalThis.sviber.freeTransform.matrix[0] - 1) > 0.01 &&
			Math.abs(globalThis.sviber.freeTransform.matrix[3] - 1) > 0.01,
	);
	await page.keyboard.press("Escape");
	assert.deepEqual(
		await page.evaluate(() => globalThis.sviber.model.events.map(event => ({ x: event.x, y: event.y }))),
		positionsAfterTransform,
	);
}

async function checkCurveDraftUndo(page, stage) {
	await page.locator('.tool-button[data-command="snappee.bezierCurve"]').click();
	await page.waitForFunction(() => globalThis.sviber.curveDraft?.type === "bezierCurve");
	const undoDraftBox = await stage.boundingBox();
	await page.mouse.click(undoDraftBox.x + undoDraftBox.width * 0.44, undoDraftBox.y + undoDraftBox.height * 0.72);
	await page.waitForFunction(() => globalThis.sviber.curveDraft?.points.length === 1);
	await page.keyboard.press("Control+z");
	await page.waitForFunction(
		() => globalThis.sviber.curveDraft?.type === "bezierCurve" && globalThis.sviber.curveDraft.points.length === 0,
	);
	await page.keyboard.press("Escape");
}

async function checkTransformRotation(page) {
	await page.keyboard.press("Control+t");
	await page.waitForFunction(() => Boolean(globalThis.sviber.freeTransform));
	const rotationHandle = await page.evaluate(() => {
		const { bounds } = globalThis.sviber.freeTransform;
		const surface = globalThis.sviber.stage.surface;
		const rectangle = surface.canvas.getBoundingClientRect();
		const scale = Math.min(surface.width / 250, surface.height / 150);
		const center = {
			x: surface.width / 2 + ((bounds.minX + bounds.maxX) / 2) * scale,
			y: surface.height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
		};
		const top = { x: center.x, y: surface.height / 2 - bounds.maxY * scale };
		const length = Math.hypot(top.x - center.x, top.y - center.y) || 1;
		const point = { x: top.x + ((top.x - center.x) / length) * 28, y: top.y + ((top.y - center.y) / length) * 28 };
		return {
			x: rectangle.left + (point.x * rectangle.width) / surface.width,
			y: rectangle.top + (point.y * rectangle.height) / surface.height,
		};
	});
	await page.mouse.move(rotationHandle.x, rotationHandle.y);
	await page.mouse.down();
	await page.mouse.move(rotationHandle.x + 28, rotationHandle.y + 5);
	await page.mouse.up();
	await page.waitForFunction(() => Math.abs(globalThis.sviber.freeTransform.matrix[1]) > 0.01);
	await page.keyboard.press("Enter");
	await page.waitForFunction(() => globalThis.sviber.freeTransform === null);
}

async function checkPenAndArcCurves(page, stage) {
	await page.locator('.tool-button[data-command="snappee.pen"]').click();
	await page.waitForFunction(() => globalThis.sviber.curveDraft?.type === "penCurve");
	const penStageBox = await stage.boundingBox();
	const penPoints = [
		{ x: penStageBox.x + penStageBox.width * 0.32, y: penStageBox.y + penStageBox.height * 0.68 },
		{ x: penStageBox.x + penStageBox.width * 0.5, y: penStageBox.y + penStageBox.height * 0.48 },
		{ x: penStageBox.x + penStageBox.width * 0.68, y: penStageBox.y + penStageBox.height * 0.66 },
	];
	for (const [index, point] of penPoints.entries()) {
		await page.mouse.move(point.x, point.y);
		await page.mouse.down();
		if (index < 2) {
			await page.mouse.move(point.x + 28, point.y - 14);
		}
		await page.mouse.up();
	}
	await page.keyboard.press("Enter");
	await page.waitForFunction(
		() =>
			globalThis.sviber.curveDraft === null &&
			globalThis.sviber.model.snappees.some(snappee => snappee.type === "penCurve"),
	);
	await page.locator(".dialog").waitFor();
	assert.equal(
		await page.evaluate(() => {
			const entry = globalThis.sviber.dialogs.active?.entries.find(
				candidate => candidate.field.id === "segments",
			);
			return Boolean(
				entry?.control.element.contains(document.activeElement) ||
					entry?.control.element === document.activeElement,
			);
		}),
		true,
		"the pen parameter dialog did not focus the segments field",
	);
	await page.locator('.dialog-button[data-dialog-action="cancel"]').click();
	const penCommands = await page.evaluate(
		() => globalThis.sviber.model.snappees.find(snappee => snappee.type === "penCurve").commands,
	);
	assert.equal(penCommands[0].type, "M");
	assert.ok(
		penCommands.some(command => command.type === "C"),
		"dragging a pen node did not create a Bezier segment",
	);
	assert.ok(
		penCommands.some(
			command =>
				command.type === "C" &&
				(command.x1 !== command.x ||
					command.y1 !== command.y ||
					command.x2 !== command.x ||
					command.y2 !== command.y),
		),
		"pen control handles collapsed onto their endpoint",
	);
	await page.locator('.tool-button[data-command="snappee.circularArc"]').click();
	await page.waitForFunction(() => globalThis.sviber.curveDraft?.type === "circularArcCurve");
	const arcCenter = { x: penStageBox.x + penStageBox.width * 0.78, y: penStageBox.y + penStageBox.height * 0.4 };
	const arcEnd = { x: arcCenter.x + 42, y: arcCenter.y };
	await page.mouse.click(arcCenter.x, arcCenter.y);
	await page.mouse.click(arcEnd.x, arcEnd.y);
	await page.mouse.click(arcEnd.x, arcEnd.y);
	await page.waitForFunction(
		() =>
			globalThis.sviber.curveDraft === null &&
			globalThis.sviber.model.snappees.some(snappee => snappee.type === "circularArcCurve" && snappee.closed),
	);
}

export async function runTransformAndCurveChecks(page, outputDirectory) {
	const stage = page.locator("#stage-surface canvas");
	const positionsBeforeTransform = await checkFreeTransformTranslate(page, outputDirectory);
	await checkBezierCurveDraft(page, stage);
	await checkTransformScaleAndCancel(page, positionsBeforeTransform);
	await checkCurveDraftUndo(page, stage);
	await checkTransformRotation(page);
	await checkPenAndArcCurves(page, stage);
}
