import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import { runInteractionChecks } from "./verify-browser-interactions.mjs";
import { runMacroChecks } from "./verify-browser-macros.mjs";
import { runProjectChecks } from "./verify-browser-project.mjs";
import { runV8BrowserChecks } from "./verify-browser-v8.mjs";
import { runPreferenceAndLicenseChecks } from "./verify-browser-preferences.mjs";
import { measureLargeChartEditing, measureLargeChartPlayback, measureRealDrag } from "./browser-performance.mjs";
import { runClipLayoutChecks } from "./verify-browser-clips.mjs";
import { runKeyboardShortcutLayoutChecks } from "./verify-browser-shortcuts.mjs";
import { runRegressionChecks } from "./verify-browser-regressions.mjs";
import { runV14BrowserChecks } from "./verify-browser-v14.mjs";
import { runOutOfBoundsChecks } from "./verify-browser-bounds.mjs";
import { browserExecutable, isReachable, startTemporaryServer } from "./verify-browser-host.mjs";
import { assertCanvas } from "./verify-browser-canvas.mjs";
import { measureTapRadius, waitForEditor } from "./verify-browser-editor-probes.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(projectDirectory, "test-results");
const baseUrl = process.env.SVIBER_BASE_URL || "http://127.0.0.1:4173/sviber/";

await mkdir(outputDirectory, { recursive: true });
let activeBaseUrl = baseUrl;
let temporaryServer;
if (!(await isReachable(activeBaseUrl))) {
	const started = await startTemporaryServer(activeBaseUrl);
	temporaryServer = started.server;
	activeBaseUrl = started.baseUrl;
}
const browser = await chromium.launch({ executablePath: await browserExecutable(), headless: true });
const context = await browser.newContext({
	viewport: { width: 1440, height: 900 },
	locale: "zh-CN",
	acceptDownloads: true,
	serviceWorkers: "allow",
});
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(activeBaseUrl).origin });
const startupAutosaveTimestamp = Date.now() - 1000;
await context.addInitScript(
	({ timestamp }) => {
		const chart = {
			title: "Recovery fixture",
			artist: "",
			charter: "",
			difficultyName: "Normal",
			difficultyColor: "#f19e56",
			difficulty: "1",
			events: [{ type: "tap", time: 0, properties: { x: 0, y: 0 } }],
		};
		localStorage.setItem("sviber.autosaves", JSON.stringify([timestamp]));
		localStorage.setItem(
			`sviber.autosave.${timestamp}`,
			JSON.stringify({
				version: 1,
				document: chart,
				source: { projectPath: "", projectName: "", chartPath: "", chartFilename: "recovery.json" },
			}),
		);
		localStorage.removeItem("sviber.manualSaveTime");
	},
	{ timestamp: startupAutosaveTimestamp },
);
await context.addInitScript(() => {
	Object.defineProperty(globalThis, "showSaveFilePicker", { value: undefined, configurable: true });
});
const page = await context.newPage();
let playbackBenchmark;
let editingBenchmark;
let dragBenchmark;
let macroChecks;
const pageErrors = [];
const resourceErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));
page.on("console", message => {
	if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
		pageErrors.push(message.text());
	}
});
page.on("response", response => {
	if (response.status() >= 400) {
		resourceErrors.push(`${response.status()} ${response.url()}`);
	}
});
page.on("requestfailed", request => {
	resourceErrors.push(`${request.failure()?.errorText || "request failed"} ${request.url()}`);
});

try {
	await page.goto(activeBaseUrl, { waitUntil: "networkidle", timeout: 60_000 });
	await page.waitForSelector(".dialog", { state: "visible" });
	const startupRecoveryState = await page.evaluate(() => ({
		loadingHidden: document.querySelector("#loading-screen").hidden,
		modalHidden: document.querySelector("#modal-layer").hidden,
		dialogTitle: document.querySelector(".dialog-titlebar")?.textContent,
		appBusy: document.querySelector("#app").getAttribute("aria-busy"),
	}));
	assert.deepEqual(startupRecoveryState, {
		loadingHidden: true,
		modalHidden: false,
		dialogTitle: "恢复自动保存",
		appBusy: "false",
	});
	await page.locator('.dialog-button[data-dialog-action="discard"]').click();
	await waitForEditor(page);
	playbackBenchmark = await measureLargeChartPlayback(page);
	assert.ok(
		playbackBenchmark.cpuTaskPercentile95Milliseconds < 10,
		`100k-event playback CPU p95 exceeded 10 ms: ${playbackBenchmark.cpuTaskPercentile95Milliseconds} ms`,
	);
	assert.ok(
		playbackBenchmark.percentile95Milliseconds < 20,
		`100k-event playback p95 exceeded 60 Hz frame pacing: ${playbackBenchmark.percentile95Milliseconds} ms`,
	);
	assert.ok(
		playbackBenchmark.droppedFrames <= 2,
		`100k-event playback dropped ${playbackBenchmark.droppedFrames} of ${playbackBenchmark.frames} frames`,
	);
	editingBenchmark = await measureLargeChartEditing(page);
	assert.ok(
		editingBenchmark.cpuTaskPercentile95Milliseconds < 10,
		`100k-event editing CPU p95 exceeded 10 ms: ${editingBenchmark.cpuTaskPercentile95Milliseconds} ms`,
	);
	assert.ok(
		editingBenchmark.percentile95Milliseconds < 20,
		`100k-event editing p95 exceeded 60 Hz frame pacing: ${editingBenchmark.percentile95Milliseconds} ms`,
	);
	assert.ok(
		editingBenchmark.droppedFrames <= 2,
		`100k-event editing dropped ${editingBenchmark.droppedFrames} of ${editingBenchmark.frames} frames`,
	);
	dragBenchmark = await measureRealDrag(page);
	for (const [view, result] of Object.entries(dragBenchmark)) {
		assert.ok(
			result.frames >= 8,
			`${view} drag did not produce enough animation frames: ${JSON.stringify(result)}`,
		);
		assert.ok(
			result.percentile95Milliseconds < 25,
			`${view} drag p95 exceeded interactive 60 Hz pacing: ${JSON.stringify(result)}`,
		);
		assert.ok(result.droppedFrames <= 2, `${view} drag dropped too many frames: ${JSON.stringify(result)}`);
	}
	assert.ok(
		await page.evaluate(
			timestamp => Number(localStorage.getItem("sviber.manualSaveTime")) > timestamp,
			startupAutosaveTimestamp,
		),
		"discarding startup recovery did not suppress the same autosave on reload",
	);
	assert.equal(await page.locator("#inspector-tab").textContent(), "检查器");
	assert.equal(await page.locator(".menu-root-button").count(), 10);
	assert.equal(await page.locator('.menu-root[data-menu-id="macros"] .menu-root-button').count(), 1);
	macroChecks = await runMacroChecks(browser, activeBaseUrl);
	await page.locator('.menu-root[data-menu-id="file"] .menu-root-button').click();
	const importFileCommand = page.locator('.menu-command[data-command="file.importFile"]');
	assert.equal((await importFileCommand.textContent()).trim(), "导入谱面/关卡文件...");
	assert.equal(await page.locator('.menu-command[data-command="file.newProject"]').count(), 0);
	assert.equal(await page.locator('.menu-command[data-command="file.openProject"]').count(), 0);
	assert.equal(await page.locator('.menu-command[data-command="file.openChart"]').count(), 1);
	const fileChooserPromise = page.waitForEvent("filechooser");
	await importFileCommand.click();
	const fileChooser = await fileChooserPromise;
	assert.match(await fileChooser.element().getAttribute("accept"), /\.json/);
	await fileChooser.setFiles([]);
	assert.equal(
		await page.locator(".difficulty-switcher").isHidden(),
		true,
		"the project chart selector must stay hidden on the webpage",
	);

	const layout = await page.evaluate(() => {
		const box = selector => {
			const rectangle = document.querySelector(selector).getBoundingClientRect();
			return { top: rectangle.top, bottom: rectangle.bottom, left: rectangle.left, right: rectangle.right };
		};
		return {
			innerHeight,
			bodyHeight: document.body.scrollHeight,
			menu: box("#menu-bar"),
			toolbar: box("#tool-bar"),
			timeline: box(".timeline-row"),
			editor: box(".editor-row"),
			footer: box("#tooltip-bar"),
		};
	});
	assert.ok(layout.bodyHeight <= layout.innerHeight + 1, "desktop page scrolls as a whole");
	assert.ok(layout.menu.bottom <= layout.toolbar.top + 1);
	assert.ok(layout.toolbar.bottom <= layout.timeline.top + 1);
	assert.ok(layout.timeline.bottom <= layout.editor.top + 1);
	assert.ok(layout.editor.bottom <= layout.footer.top + 1);
	assert.ok(layout.footer.bottom <= layout.innerHeight + 1);
	const stageBox = await page.locator("#stage-surface").boundingBox();
	assert.ok(stageBox, "stage surface has no layout box");
	await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
	assert.equal(await page.locator("#scroll-view-toggle").evaluate(button => getComputedStyle(button).opacity), "0");
	assert.equal(await page.locator("#side-panel-toggle").evaluate(button => getComputedStyle(button).opacity), "0");
	await page.mouse.move(stageBox.x + 8, stageBox.y + stageBox.height / 2);
	assert.equal(await page.locator("#scroll-view-toggle").evaluate(button => getComputedStyle(button).opacity), "1");
	assert.equal(await page.locator("#side-panel-toggle").evaluate(button => getComputedStyle(button).opacity), "0");
	await page.mouse.move(stageBox.x + stageBox.width - 8, stageBox.y + stageBox.height / 2);
	assert.equal(await page.locator("#scroll-view-toggle").evaluate(button => getComputedStyle(button).opacity), "0");
	assert.equal(await page.locator("#side-panel-toggle").evaluate(button => getComputedStyle(button).opacity), "1");
	const timelineCanvas = page.locator("#timeline-surface canvas");
	await timelineCanvas.hover({ position: { x: 320, y: 80 } });
	await page.mouse.wheel(0, 100);
	await page.waitForFunction(
		() => JSON.stringify(globalThis.sviber.model.editor.currentTime) === JSON.stringify([0, 1, 2]),
	);
	await page.mouse.wheel(0, -100);
	await page.waitForFunction(
		() => JSON.stringify(globalThis.sviber.model.editor.currentTime) === JSON.stringify([0, 0, 1]),
	);
	const spanBeforeZoom = await page.evaluate(() => {
		const editor = globalThis.sviber.model.editor;
		return editor.visibleRangeEnd - editor.visibleRangeBeginning;
	});
	await page.keyboard.down("Control");
	await page.mouse.wheel(0, -100);
	await page.keyboard.up("Control");
	await page.waitForFunction(previous => {
		const editor = globalThis.sviber.model.editor;
		return editor.visibleRangeEnd - editor.visibleRangeBeginning < previous;
	}, spanBeforeZoom);
	const spanAfterWheelUp = await page.evaluate(() => {
		const editor = globalThis.sviber.model.editor;
		return editor.visibleRangeEnd - editor.visibleRangeBeginning;
	});
	await page.keyboard.down("Control");
	await page.mouse.wheel(0, 100);
	await page.keyboard.up("Control");
	await page.waitForFunction(previous => {
		const editor = globalThis.sviber.model.editor;
		return editor.visibleRangeEnd - editor.visibleRangeBeginning > previous;
	}, spanAfterWheelUp);
	const timelineGestureBefore = await page.evaluate(() => {
		const editor = globalThis.sviber.model.editor;
		return { zoom: editor.mainFieldZoom, span: editor.visibleRangeEnd - editor.visibleRangeBeginning };
	});
	await page.keyboard.down("Control");
	await page.keyboard.down("Shift");
	await page.mouse.wheel(0, -100);
	await page.keyboard.up("Shift");
	await page.keyboard.up("Control");
	await page.waitForFunction(
		previous => globalThis.sviber.model.editor.mainFieldZoom > previous,
		timelineGestureBefore.zoom,
	);
	assert.equal(
		await page.evaluate(() => {
			const editor = globalThis.sviber.model.editor;
			return editor.visibleRangeEnd - editor.visibleRangeBeginning;
		}),
		timelineGestureBefore.span,
		"timeline Ctrl+Shift+wheel changed its visible range",
	);
	await runRegressionChecks(page);
	await runV14BrowserChecks(page);
	await page.locator("#inspector-tab").click();
	await page.evaluate(() => {
		globalThis.sviber.model.editor.mainFieldPanX = 12;
		globalThis.sviber.refreshNow();
	});
	const resetView = page.locator("#reset-main-field-view");
	assert.equal(await resetView.isHidden(), false);
	const resetContrast = await resetView.evaluate(button => {
		const style = getComputedStyle(button);
		return [style.color, style.backgroundColor, style.borderTopColor];
	});
	assert.notEqual(resetContrast[0], resetContrast[1], "reset view control has insufficient contrast");
	await page.evaluate(() => globalThis.sviber.resetMainFieldView());
	const stoppedZoomScrollPixelDifference = await page.evaluate(async () => {
		const app = globalThis.sviber;
		const editor = app.model.editor;
		const originalRange = [editor.visibleRangeBeginning, editor.visibleRangeEnd];
		const pixels = () =>
			app.scrollView.surface.context
				.getImageData(0, 0, app.scrollView.surface.width, app.scrollView.surface.height)
				.data.slice();
		await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const before = pixels();
		const center = (originalRange[0] + originalRange[1]) / 2;
		const span = (originalRange[1] - originalRange[0]) * 0.82;
		app.setVisibleRange(center - span / 2, center + span / 2);
		await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const after = pixels();
		app.setVisibleRange(...originalRange);
		let difference = 0;
		for (let index = 0; index < before.length; index += 4) {
			if (
				before[index] !== after[index] ||
				before[index + 1] !== after[index + 1] ||
				before[index + 2] !== after[index + 2]
			) {
				difference += 1;
			}
		}
		return difference;
	});
	assert.ok(
		stoppedZoomScrollPixelDifference > 0,
		"changing the visible range while stopped did not redraw the Scroll View",
	);
	const scrollEventLayer = await page.evaluate(() => {
		const app = globalThis.sviber;
		const snapshot = app.model.snapshot();
		app.model.events = [];
		app.model.addEvent("bgNote", { time: [1, 0, 1], duration: [0, 1, 1], channel: 0, x: 0, y: 0 });
		app.model.addEvent("tap", { time: [1, 0, 1], channel: 0, x: 0, y: 0 });
		app.model.editor.currentTime = [0, 0, 1];
		app.model.editor.timeSnapped = true;
		app.refreshNow();
		const point = app.scrollView.hitRegions.find(region => region.event.type === "tap");
		const pixel = app.scrollView.surface.context.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data;
		app.model.restore(snapshot);
		app.refreshNow();
		return [...pixel];
	});
	assert.deepEqual(
		scrollEventLayer.slice(0, 3),
		[85, 215, 191],
		"a bgNote was drawn above the ordinary note in the Scroll View",
	);
	const snappeeVisibility = await page.evaluate(() => {
		const app = globalThis.sviber;
		const snapshot = app.model.snapshot();
		const pixels = active => {
			app.model.snappees = [];
			if (active !== null) {
				app.model.addSnappee("rectangularMesh", {
					active,
					color: "#ff00ff",
					topLeftX: -75,
					topLeftY: -35,
					bottomRightX: 75,
					bottomRightY: 35,
					horizontalTiles: 3,
					verticalTiles: 2,
				});
			}
			app.refreshNow();
			app.stage.render();
			const { buffer, context } = app.stage.surface;
			const stagePixels = context.getImageData(0, 0, buffer.width, buffer.height).data.slice();
			const preview = document.querySelector("#snappees-panel .snappee-preview canvas");
			const previewPixels =
				preview?.getContext("2d")?.getImageData(0, 0, preview.width, preview.height).data || [];
			let previewOpacity = 0;
			if (preview) {
				previewOpacity = Number.parseFloat(getComputedStyle(preview.parentElement).opacity || "0");
			}
			let previewOpaque = 0;
			for (let index = 3; index < previewPixels.length; index += 4) {
				if (previewPixels[index] > 0) {
					previewOpaque += 1;
				}
			}
			return { stagePixels, previewOpaque, previewOpacity };
		};
		const absent = pixels(null).stagePixels;
		const deactivated = pixels(false);
		const activated = pixels(true);
		let deactivatedDifference = 0;
		let activatedDifference = 0;
		for (let index = 0; index < absent.length; index += 1) {
			if (absent[index] !== deactivated.stagePixels[index]) {
				deactivatedDifference += 1;
			}
			if (absent[index] !== activated.stagePixels[index]) {
				activatedDifference += 1;
			}
		}
		app.model.restore(snapshot);
		app.refreshNow();
		return {
			deactivatedDifference,
			activatedDifference,
			deactivatedPreviewOpaque: deactivated.previewOpaque,
			activatedPreviewOpaque: activated.previewOpaque,
			deactivatedPreviewOpacity: deactivated.previewOpacity,
			activatedPreviewOpacity: activated.previewOpacity,
		};
	});
	assert.equal(snappeeVisibility.deactivatedDifference, 0, "a deactivated snappee remains visible on the stage");
	assert.ok(
		snappeeVisibility.activatedDifference > 0,
		"the activated snappee visibility fixture did not draw anything",
	);
	assert.ok(
		snappeeVisibility.deactivatedPreviewOpaque > 0,
		"the deactivated snappee preview is missing from the sidebar",
	);
	assert.ok(
		snappeeVisibility.deactivatedPreviewOpacity < snappeeVisibility.activatedPreviewOpacity,
		"the deactivated snappee preview is not translucent in the sidebar",
	);
	assert.ok(
		snappeeVisibility.activatedPreviewOpaque > 0,
		"the activated snappee preview is not visible in the sidebar",
	);
	const selectedInvisibleTextDifference = await page.evaluate(() => {
		const app = globalThis.sviber;
		const snapshot = app.model.snapshot();
		app.model.events = [];
		app.model.snappees = [];
		app.model.editor.timeSnapped = true;
		app.model.editor.currentTime = [0, 0, 1];
		const event = app.model.addEvent("tap", {
			time: [100, 0, 1],
			channel: app.model.channels[0].id,
			x: 0,
			y: 0,
			selected: true,
			text: "",
		});
		app.refreshNow();
		const withoutText = app.stage.surface.context
			.getImageData(0, 0, app.stage.surface.buffer.width, app.stage.surface.buffer.height)
			.data.slice();
		event.text = "A";
		app.refreshNow();
		const withText = app.stage.surface.context.getImageData(
			0,
			0,
			app.stage.surface.buffer.width,
			app.stage.surface.buffer.height,
		).data;
		let difference = 0;
		for (let index = 0; index < withText.length; index += 1) {
			if (withText[index] !== withoutText[index]) {
				difference += 1;
			}
		}
		app.model.restore(snapshot);
		app.refreshNow();
		return difference;
	});
	assert.ok(
		selectedInvisibleTextDifference > 0,
		"a selected note outside its animation window did not render its text",
	);

	const canvasSummaries = {
		timeline: await assertCanvas(page.locator("#timeline-surface canvas"), "timeline-desktop", outputDirectory),
		scroll: await assertCanvas(page.locator("#scroll-surface canvas"), "scroll-desktop", outputDirectory),
		stage: await assertCanvas(page.locator("#stage-surface canvas"), "stage-desktop", outputDirectory),
	};
	const desktopTapMetric = await measureTapRadius(page);
	assert.ok(
		Math.abs(desktopTapMetric.radius / desktopTapMetric.scale - 11.875) < 1e-8,
		`desktop Tap radius does not match Sunniesnow: ${JSON.stringify(desktopTapMetric)}`,
	);

	await runOutOfBoundsChecks(page);
	const batchChainBehavior = await page.evaluate(() => {
		const app = globalThis.sviber;
		const snapshot = app.model.snapshot();
		const historyLabel = app.history.currentEntry.label;
		const savedSignature = app.savedSignature;
		app.model.events = [];
		const channel = app.model.channels[0].id;
		for (let index = 0; index < 4; index += 1) {
			app.model.addEvent("tap", {
				time: [index, 0, 1],
				channel,
				selected: index < 3,
				tipPointSpawnType: index < 3 ? "drop" : "inherit",
			});
		}
		app.history.reset(app.model.snapshot(), historyLabel);
		const historyLength = app.history.length;
		const result = app.editSelectedProperty("tipPointSpawnType", "chain");
		const modes = app.model.events.map(event => event.tipPointSpawnType);
		const guideIds = app.model
			.generateSunniesnowEvents()
			.filter(event => event.type === "tap")
			.map(event => event.properties.tipPoint ?? null);
		const historyDelta = app.history.length - historyLength;
		app.model.restore(snapshot);
		app.history.reset(snapshot, historyLabel);
		app.savedSignature = savedSignature;
		app.updateDirty();
		app.refresh();
		return { result, modes, guideIds, historyDelta };
	});
	assert.equal(batchChainBehavior.result.ok, true, "batch Chain edit must be accepted");
	assert.deepEqual(batchChainBehavior.modes, ["chain", "inherit", "inherit", "none"]);
	assert.equal(
		new Set(batchChainBehavior.guideIds.slice(0, 3)).size,
		1,
		"batch Chain edit must export one shared Sunniesnow tipPoint",
	);
	assert.equal(batchChainBehavior.guideIds[3], null, "batch Chain edit must stop before the next note");
	assert.equal(batchChainBehavior.historyDelta, 1, "batch Chain edit must create one history entry");
	await runInteractionChecks(page, outputDirectory);
	await runProjectChecks(page, outputDirectory);
	await runV8BrowserChecks(page);
	await runPreferenceAndLicenseChecks(browser, activeBaseUrl, outputDirectory);
	await runClipLayoutChecks(page, outputDirectory);
	await runKeyboardShortcutLayoutChecks(page, outputDirectory);
	await page.setViewportSize({ width: 960, height: 620 });
	await page.waitForTimeout(150);
	const narrowTapMetric = await measureTapRadius(page);
	assert.ok(
		Math.abs(narrowTapMetric.radius / narrowTapMetric.scale - 11.875) < 1e-8,
		`narrow Tap radius does not match Sunniesnow: ${JSON.stringify(narrowTapMetric)}`,
	);
	assert.notEqual(narrowTapMetric.scale, desktopTapMetric.scale, "stage resize did not change the note scale");
	assert.notEqual(
		narrowTapMetric.radius,
		desktopTapMetric.radius,
		"stage resize did not change the displayed note radius",
	);
	const narrowLayout = await page.evaluate(() => ({
		innerWidth,
		innerHeight,
		scrollX,
		bodyHeight: document.body.scrollHeight,
		bodyWidth: document.body.scrollWidth,
		menuVisible: document.querySelector("#menu-bar").getBoundingClientRect().height > 0,
		footerBottom: document.querySelector("#tooltip-bar").getBoundingClientRect().bottom,
		status: (() => {
			const value = document.querySelector("#status-panel").getBoundingClientRect();
			return { left: value.left, right: value.right, width: value.width };
		})(),
		side: (() => {
			const value = document.querySelector(".side-panel").getBoundingClientRect();
			return { left: value.left, right: value.right, width: value.width };
		})(),
		canvases: [...document.querySelectorAll(".render-surface canvas")].map(canvas => {
			const rectangle = canvas.getBoundingClientRect();
			const parent = canvas.parentElement.getBoundingClientRect();
			return {
				left: rectangle.left,
				right: rectangle.right,
				width: rectangle.width,
				parentLeft: parent.left,
				parentRight: parent.right,
				parentWidth: parent.width,
			};
		}),
	}));
	assert.ok(narrowLayout.bodyHeight <= narrowLayout.innerHeight + 1, "narrow page scrolls as a whole");
	assert.equal(narrowLayout.menuVisible, true);
	assert.ok(narrowLayout.footerBottom <= narrowLayout.innerHeight + 1);
	assert.equal(narrowLayout.scrollX, 0, `window scrolled horizontally: ${JSON.stringify(narrowLayout)}`);
	assert.ok(
		narrowLayout.bodyWidth <= narrowLayout.innerWidth + 1,
		`page overflows horizontally: ${JSON.stringify(narrowLayout)}`,
	);
	assert.ok(
		narrowLayout.status.width >= 120 && narrowLayout.status.right <= narrowLayout.innerWidth + 1,
		`status panel is outside the viewport: ${JSON.stringify(narrowLayout)}`,
	);
	assert.ok(
		narrowLayout.side.width >= 180 && narrowLayout.side.right <= narrowLayout.innerWidth + 1,
		`side panel is outside the viewport: ${JSON.stringify(narrowLayout)}`,
	);
	const toolbarGeometry = await page.evaluate(() => {
		const toolbar = document.querySelector("#tool-bar").getBoundingClientRect();
		const switcher = document.querySelector(".difficulty-switcher").getBoundingClientRect();
		const row = document.querySelector(".tool-row").getBoundingClientRect();
		return {
			toolbar: { left: toolbar.left, right: toolbar.right },
			switcher: { left: switcher.left, right: switcher.right, top: switcher.top, bottom: switcher.bottom },
			row: { left: row.left, right: row.right, top: row.top, bottom: row.bottom },
			buttons: [...document.querySelectorAll("#tool-bar .tool-button")].map(button => {
				const rectangle = button.getBoundingClientRect();
				return { left: rectangle.left, right: rectangle.right, width: rectangle.width };
			}),
		};
	});
	assert.equal(
		toolbarGeometry.switcher.right - toolbarGeometry.switcher.left,
		0,
		`the web chart selector occupies layout space: ${JSON.stringify(toolbarGeometry)}`,
	);
	assert.equal(toolbarGeometry.buttons.length, 36);
	assert.ok(
		toolbarGeometry.buttons.every(
			button =>
				button.width > 0 &&
				button.left >= toolbarGeometry.toolbar.left - 1 &&
				button.right <= toolbarGeometry.toolbar.right + 1,
		),
		`not every toolbar command is visible at 960px: ${JSON.stringify(toolbarGeometry)}`,
	);
	for (const canvas of narrowLayout.canvases) {
		assert.ok(
			Math.abs(canvas.left - canvas.parentLeft) <= 1 && Math.abs(canvas.right - canvas.parentRight) <= 1,
			`canvas width ${canvas.width} does not match host width ${canvas.parentWidth}`,
		);
	}
	await assertCanvas(page.locator("#timeline-surface canvas"), "timeline-narrow", outputDirectory);
	await assertCanvas(page.locator("#scroll-surface canvas"), "scroll-narrow", outputDirectory);
	await assertCanvas(page.locator("#stage-surface canvas"), "stage-narrow", outputDirectory);
	await page.screenshot({ path: path.join(outputDirectory, "sviber-960x620-zh-CN.png"), fullPage: true });

	const englishContext = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		locale: "en-US",
		colorScheme: "dark",
		serviceWorkers: "allow",
	});
	try {
		const englishPage = await englishContext.newPage();
		await englishPage.goto(activeBaseUrl, { waitUntil: "networkidle", timeout: 60_000 });
		await waitForEditor(englishPage);
		assert.equal(await englishPage.locator("#inspector-tab").textContent(), "Inspector");
		assert.match(
			await englishPage.locator('.menu-root[data-menu-id="file"] .menu-root-button').textContent(),
			/File/,
		);
		assert.equal(await englishPage.locator("html").getAttribute("lang"), "en-US");
		const darkColors = await englishPage.evaluate(() => ({
			body: getComputedStyle(document.body).backgroundColor,
			panel: getComputedStyle(document.querySelector(".side-panel")).backgroundColor,
		}));
		assert.equal(darkColors.body, "rgb(24, 26, 29)");
		assert.equal(darkColors.panel, "rgb(32, 35, 39)");
		await assertCanvas(englishPage.locator("#scroll-surface canvas"), "scroll-dark-en-US", outputDirectory);
		await assertCanvas(englishPage.locator("#stage-surface canvas"), "stage-dark-en-US", outputDirectory);
		await englishPage.screenshot({
			path: path.join(outputDirectory, "sviber-desktop-dark-en-US.png"),
			fullPage: true,
		});
	} finally {
		await englishContext.close();
	}

	await page.evaluate(async () => navigator.serviceWorker?.ready);
	await page.reload({ waitUntil: "networkidle" });
	await waitForEditor(page);
	assert.equal(
		await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
		true,
		"service worker did not control the page",
	);
	await context.setOffline(true);
	await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
	await waitForEditor(page);
	assert.equal(await page.locator("#inspector-tab").textContent(), "检查器");
	await assertCanvas(page.locator("#scroll-surface canvas"), "scroll-offline", outputDirectory);
	await assertCanvas(page.locator("#stage-surface canvas"), "stage-offline", outputDirectory);
	await page.screenshot({ path: path.join(outputDirectory, "sviber-offline.png"), fullPage: true });

	const unexpectedErrors = pageErrors;
	const unexpectedResources = resourceErrors.filter(message => !message.includes("/sviber/assets/fonts/"));
	assert.deepEqual(unexpectedErrors, [], `browser errors: ${unexpectedErrors.join(" | ")}`);
	assert.deepEqual(unexpectedResources, [], `resource errors: ${unexpectedResources.join(" | ")}`);
	console.log(
		JSON.stringify(
			{
				baseUrl: activeBaseUrl,
				playbackBenchmark,
				editingBenchmark,
				dragBenchmark,
				macroChecks,
				canvasSummaries,
				screenshots: outputDirectory,
			},
			null,
			2,
		),
	);
} finally {
	await context.setOffline(false).catch(() => {});
	await context.close();
	await browser.close();
	if (temporaryServer) {
		await new Promise(resolveClose => temporaryServer.close(() => resolveClose()));
	}
}
