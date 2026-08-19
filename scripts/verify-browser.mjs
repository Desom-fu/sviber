import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path, { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PNG } from "pngjs";
import { chromium } from "playwright-core";
import { runInteractionChecks } from "./verify-browser-interactions.mjs";
import { runMacroChecks } from "./verify-browser-macros.mjs";
import { runProjectChecks } from "./verify-browser-project.mjs";
import { runV8BrowserChecks } from "./verify-browser-v8.mjs";
import { runPreferenceAndLicenseChecks } from "./verify-browser-preferences.mjs";
import { measureLargeChartEditing, measureLargeChartPlayback } from "./browser-performance.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const repositoryDirectory = path.resolve(projectDirectory, "..");
const outputDirectory = path.join(projectDirectory, "test-results");
const baseUrl = process.env.SVIBER_BASE_URL || "http://127.0.0.1:4173/sviber/";
const executableCandidates = [
	process.env.SVIBER_CHROME,
	"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
].filter(Boolean);

const MIME_TYPES = {
	".css": "text/css; charset=utf-8",
	".gif": "image/gif",
	".html": "text/html; charset=utf-8",
	".jpg": "image/jpeg",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".otf": "font/otf",
	".png": "image/png",
	".svg": "image/svg+xml",
	".ttf": "font/ttf",
	".wav": "audio/wav",
	".webm": "audio/webm",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".wasm": "application/wasm",
};

async function isReachable(url) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 1_500);
	try {
		const response = await fetch(url, { signal: controller.signal });
		return response.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

function isInside(root, filename) {
	const normalizedRoot = resolve(root);
	const normalizedFile = resolve(filename);
	return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}${path.sep}`);
}

function fileForRequest(requestUrl) {
	const pathname = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
	let root = projectDirectory;
	let relativePath = pathname;
	if (pathname.startsWith("/sviber/assets/fonts/")) {
		root = path.join(projectDirectory, "node_modules", ".cache", "sviber", "fonts");
		relativePath = pathname.slice("/sviber/assets/fonts/".length);
	} else if (pathname === "/sviber" || pathname.startsWith("/sviber/")) {
		relativePath = pathname.slice("/sviber".length);
	} else {
		root = repositoryDirectory;
	}
	relativePath = relativePath.replace(/^\/+/, "") || "index.html";
	const filename = resolve(root, relativePath);
	return { root, filename };
}

async function startTemporaryServer(requestedUrl) {
	const requested = new URL(requestedUrl);
	if (!["127.0.0.1", "localhost", "::1"].includes(requested.hostname)) {
		throw new Error(`Cannot start a local server for ${requested.hostname}; set SVIBER_BASE_URL to a reachable URL.`);
	}
	const host = requested.hostname === "localhost" ? "127.0.0.1" : requested.hostname;
	const server = createServer(async (request, response) => {
		if (request.method !== "GET" && request.method !== "HEAD") {
			response.writeHead(405, { Allow: "GET, HEAD" });
			response.end();
			return;
		}
		try {
			const { root, filename: requestedFilename } = fileForRequest(request.url || "/");
			if (!isInside(root, requestedFilename)) throw new Error("path traversal");
			let filename = requestedFilename;
			let information = await stat(filename);
			if (information.isDirectory()) {
				filename = path.join(filename, "index.html");
				if (!isInside(root, filename)) throw new Error("path traversal");
				information = await stat(filename);
			}
			if (!information.isFile()) throw new Error("not a file");
			const body = await readFile(filename);
			response.writeHead(200, {
				"Cache-Control": "no-store",
				"Content-Length": body.length,
				"Content-Type": MIME_TYPES[extname(filename).toLowerCase()] || "application/octet-stream",
			});
			if (request.method === "HEAD") response.end();
			else response.end(body);
		} catch {
			response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("Not found");
		}
	});
	const listen = port => new Promise((resolveListen, rejectListen) => {
		const onError = error => {
			server.off("listening", onListening);
			rejectListen(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolveListen(server.address().port);
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen({ host, port });
	});
	let port;
	try {
		const requestedPort = requested.port === "" ? 80 : Number(requested.port);
		port = await listen(requestedPort);
	} catch (error) {
		if (error.code !== "EADDRINUSE") {
			await new Promise(resolveClose => server.close(() => resolveClose()));
			throw error;
		}
		port = await listen(0);
	}
	const activeUrl = new URL(requested);
	activeUrl.hostname = host;
	activeUrl.port = String(port);
	return { server, baseUrl: activeUrl.href };
}

async function browserExecutable() {
	for (const candidate of executableCandidates) {
		try {
			await access(candidate);
			return candidate;
		} catch { /* Try the next browser. */ }
	}
	throw new Error("No supported Chrome or Edge executable was found. Set SVIBER_CHROME.");
}

function pixelSummary(buffer) {
	const image = PNG.sync.read(buffer);
	const colors = new Set();
	let opaque = 0;
	for (let offset = 0; offset < image.data.length; offset += 4) {
		if (image.data[offset + 3] > 0) opaque += 1;
		if ((offset / 4) % 7 === 0 && colors.size < 256) {
			colors.add(`${image.data[offset]},${image.data[offset + 1]},${image.data[offset + 2]},${image.data[offset + 3]}`);
		}
	}
	return { width: image.width, height: image.height, opaque, colors: colors.size };
}

async function assertCanvas(locator, name) {
	const buffer = await locator.screenshot();
	const summary = pixelSummary(buffer);
	await writeFile(path.join(outputDirectory, `${name}.png`), buffer);
	assert.ok(summary.width > 100 && summary.height > 60, `${name} canvas is too small`);
	assert.ok(summary.opaque > summary.width * summary.height * 0.9, `${name} canvas is mostly transparent`);
	assert.ok(summary.colors > 4, `${name} canvas appears blank or single-colored`);
	return summary;
}

async function waitForEditor(page) {
	await page.waitForFunction(() => document.querySelector("#loading-screen")?.hidden === true, null, { timeout: 30_000 });
	await page.waitForFunction(() => globalThis.sviber?.model && document.querySelectorAll(".render-surface canvas").length === 3);
}

async function measureTapRadius(page) {
	return page.evaluate(() => {
		const app = globalThis.sviber;
		const snapshot = app.model.snapshot();
		app.model.events = [];
		app.model.editor.currentTime = [0, 0, 1];
		app.model.editor.timeSnapped = true;
		app.model.addEvent("tap", { time: [0, 0, 1], channel: app.model.channels[0].id, x: 0, y: 0 });
		app.refreshNow();
		app.stage.render();
		const surface = app.stage.surface;
		const region = app.stage.hitRegions.find(candidate => candidate.type === "event" && candidate.event.type === "tap");
		const result = {
			width: surface.width,
			height: surface.height,
			scale: Math.min(surface.width / 250, surface.height / 150),
			radius: region?.radius,
		};
		app.model.restore(snapshot);
		app.refreshNow();
		return result;
	});
}

async function stageChartPoint(page, x, y) {
	return page.evaluate(({ chartX, chartY }) => {
		const surface = globalThis.sviber.stage.surface;
		const rectangle = surface.canvas.getBoundingClientRect();
		const scale = Math.min(surface.width / 250, surface.height / 150);
		return {
			x: rectangle.left + (surface.width / 2 + chartX * scale) * rectangle.width / surface.width,
			y: rectangle.top + (surface.height / 2 - chartY * scale) * rectangle.height / surface.height,
		};
	}, { chartX: x, chartY: y });
}

await mkdir(outputDirectory, { recursive: true });
let activeBaseUrl = baseUrl;
let temporaryServer;
if (!await isReachable(activeBaseUrl)) {
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
await context.addInitScript(({ timestamp }) => {
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
	localStorage.setItem(`sviber.autosave.${timestamp}`, JSON.stringify(chart));
	localStorage.removeItem("sviber.manualSaveTime");
}, { timestamp: startupAutosaveTimestamp });
await context.addInitScript(() => {
	Object.defineProperty(globalThis, "showSaveFilePicker", { value: undefined, configurable: true });
});
const page = await context.newPage();
let playbackBenchmark;
let editingBenchmark;
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
	if (response.status() >= 400) resourceErrors.push(`${response.status()} ${response.url()}`);
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
	assert.ok(playbackBenchmark.cpuTaskPercentile95Milliseconds < 10,
		`100k-event playback CPU p95 exceeded 10 ms: ${playbackBenchmark.cpuTaskPercentile95Milliseconds} ms`);
	assert.ok(playbackBenchmark.percentile95Milliseconds < 20,
		`100k-event playback p95 exceeded 60 Hz frame pacing: ${playbackBenchmark.percentile95Milliseconds} ms`);
	assert.ok(playbackBenchmark.droppedFrames <= 2,
		`100k-event playback dropped ${playbackBenchmark.droppedFrames} of ${playbackBenchmark.frames} frames`);
	editingBenchmark = await measureLargeChartEditing(page);
	assert.ok(editingBenchmark.cpuTaskPercentile95Milliseconds < 10,
		`100k-event editing CPU p95 exceeded 10 ms: ${editingBenchmark.cpuTaskPercentile95Milliseconds} ms`);
	assert.ok(editingBenchmark.percentile95Milliseconds < 20,
		`100k-event editing p95 exceeded 60 Hz frame pacing: ${editingBenchmark.percentile95Milliseconds} ms`);
	assert.ok(editingBenchmark.droppedFrames <= 2,
		`100k-event editing dropped ${editingBenchmark.droppedFrames} of ${editingBenchmark.frames} frames`);
	assert.ok(await page.evaluate(timestamp => Number(localStorage.getItem("sviber.manualSaveTime")) > timestamp,
		startupAutosaveTimestamp), "discarding startup recovery did not suppress the same autosave on reload");
	assert.equal(await page.locator("#inspector-tab").textContent(), "检查器");
	assert.equal(await page.locator(".menu-root-button").count(), 9);
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
	assert.equal(await page.locator(".difficulty-switcher").isHidden(), true,
		"the project chart selector must stay hidden on the webpage");

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
	const timelineCanvas = page.locator("#timeline-surface canvas");
	await timelineCanvas.hover({ position: { x: 320, y: 80 } });
	await page.mouse.wheel(0, 100);
	await page.waitForFunction(() => JSON.stringify(globalThis.sviber.model.editor.currentTime) === JSON.stringify([0, 1, 2]));
	await page.mouse.wheel(0, -100);
	await page.waitForFunction(() => JSON.stringify(globalThis.sviber.model.editor.currentTime) === JSON.stringify([0, 0, 1]));
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
			const previewPixels = preview?.getContext("2d")
				?.getImageData(0, 0, preview.width, preview.height).data || [];
			const previewOpacity = preview
				? Number.parseFloat(getComputedStyle(preview.parentElement).opacity || "0") : 0;
			let previewOpaque = 0;
			for (let index = 3; index < previewPixels.length; index += 4) {
				if (previewPixels[index] > 0) previewOpaque += 1;
			}
			return { stagePixels, previewOpaque, previewOpacity };
		};
		const absent = pixels(null).stagePixels;
		const deactivated = pixels(false);
		const activated = pixels(true);
		let deactivatedDifference = 0;
		let activatedDifference = 0;
		for (let index = 0; index < absent.length; index += 1) {
			if (absent[index] !== deactivated.stagePixels[index]) deactivatedDifference += 1;
			if (absent[index] !== activated.stagePixels[index]) activatedDifference += 1;
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
	assert.equal(snappeeVisibility.deactivatedDifference, 0,
		"a deactivated snappee remains visible on the stage");
	assert.ok(snappeeVisibility.activatedDifference > 0,
		"the activated snappee visibility fixture did not draw anything");
	assert.ok(snappeeVisibility.deactivatedPreviewOpaque > 0,
		"the deactivated snappee preview is missing from the sidebar");
	assert.ok(snappeeVisibility.deactivatedPreviewOpacity < snappeeVisibility.activatedPreviewOpacity,
		"the deactivated snappee preview is not translucent in the sidebar");
	assert.ok(snappeeVisibility.activatedPreviewOpaque > 0,
		"the activated snappee preview is not visible in the sidebar");
	const selectedInvisibleTextDifference = await page.evaluate(() => {
		const app = globalThis.sviber;
		const snapshot = app.model.snapshot();
		app.model.events = [];
		app.model.snappees = [];
		app.model.editor.timeSnapped = true;
		app.model.editor.currentTime = [0, 0, 1];
		const event = app.model.addEvent("tap", {
			time: [100, 0, 1], channel: app.model.channels[0].id,
			x: 0, y: 0, selected: true, text: "",
		});
		app.refreshNow();
		const withoutText = app.stage.surface.context.getImageData(
			0, 0, app.stage.surface.buffer.width, app.stage.surface.buffer.height).data.slice();
		event.text = "A";
		app.refreshNow();
		const withText = app.stage.surface.context.getImageData(
			0, 0, app.stage.surface.buffer.width, app.stage.surface.buffer.height).data;
		let difference = 0;
		for (let index = 0; index < withText.length; index += 1) {
			if (withText[index] !== withoutText[index]) difference += 1;
		}
		app.model.restore(snapshot);
		app.refreshNow();
		return difference;
	});
	assert.ok(selectedInvisibleTextDifference > 0,
		"a selected note outside its animation window did not render its text");

	const canvasSummaries = {
		timeline: await assertCanvas(page.locator("#timeline-surface canvas"), "timeline-desktop"),
		scroll: await assertCanvas(page.locator("#scroll-surface canvas"), "scroll-desktop"),
		stage: await assertCanvas(page.locator("#stage-surface canvas"), "stage-desktop"),
	};
	const desktopTapMetric = await measureTapRadius(page);
	assert.ok(Math.abs(desktopTapMetric.radius / desktopTapMetric.scale - 11.875) < 1e-8,
		`desktop Tap radius does not match Sunniesnow: ${JSON.stringify(desktopTapMetric)}`);

	const outOfBoundsFixture = await page.evaluate(() => {
		const app = globalThis.sviber;
		app.preferences = { ...app.preferences, noteSpeed: 2, allowOutOfBounds: false };
		app.model.editor.allowOutOfBounds = false;
		app.model.snappees = [];
		localStorage.setItem("sviber.preferences", JSON.stringify(app.preferences));
		app.refreshNow();
		return {
			snapshot: app.model.snapshot(),
			historyLabel: app.history.currentEntry.label,
			savedSignature: app.savedSignature,
		};
	});
	await page.locator('.tool-button[data-command="events.tap"]').click();
	const boundedCreationPoint = await stageChartPoint(page, 115, 0);
	await page.mouse.click(boundedCreationPoint.x, boundedCreationPoint.y);
	await page.waitForFunction(() => globalThis.sviber.model.events.length === 1);
	assert.ok(Math.abs(await page.evaluate(() => globalThis.sviber.model.events[0].x) - 100) < 1e-8,
		"default creation did not clamp to the chart boundary");
	await page.keyboard.press("Escape");
	await page.evaluate(fixture => {
		const app = globalThis.sviber;
		app.model.restore(fixture.snapshot);
		app.history.reset(fixture.snapshot, fixture.historyLabel);
		app.savedSignature = fixture.savedSignature;
		app.updateDirty();
		app.refreshNow();
	}, outOfBoundsFixture);
	const historyBeforeOutOfBoundsToggle = await page.evaluate(() => globalThis.sviber.history.length);
	await page.locator('.menu-root[data-menu-id="file"] .menu-root-button').click();
	await page.locator('.menu-command[data-command="file.preferences"]').click();
	await page.getByRole("spinbutton", { name: "音符速度" }).fill("3");
	assert.equal(await page.getByRole("spinbutton", { name: "自动保存间隔（秒）" }).inputValue(), "120");
	await page.locator('.dialog-field input[type="checkbox"]').check();
	await page.locator('.dialog-button[data-dialog-action="ok"]').click();
	await page.waitForFunction(() => globalThis.sviber.model.editor.allowOutOfBounds === true);
	assert.equal(await page.evaluate(() => globalThis.sviber.history.length), historyBeforeOutOfBoundsToggle);
	const persistedOutOfBoundsSetting = await page.evaluate(() => {
		const app = globalThis.sviber;
		return {
			model: app.model.editor.allowOutOfBounds,
			preferences: JSON.parse(localStorage.getItem("sviber.preferences")),
		};
	});
	assert.deepEqual(persistedOutOfBoundsSetting, {
		model: true,
		preferences: {
			theme: "system", language: "system", noteSpeed: 3,
			seVolume: 1, musicVolume: 1, autoSaveInterval: 120, allowOutOfBounds: true,
		},
	});

	await page.locator('.tool-button[data-command="events.tap"]').click();
	const outsideCreationPoint = await stageChartPoint(page, 115, 0);
	await page.mouse.click(outsideCreationPoint.x, outsideCreationPoint.y);
	await page.waitForFunction(() => globalThis.sviber.model.events.some(event => event.x > 100));
	assert.ok(Math.abs(await page.evaluate(() => globalThis.sviber.model.events.at(-1).x) - 115) < 1,
		"enabled out-of-bounds creation did not preserve the clicked chart coordinate");
	await page.keyboard.press("Escape");

	const outOfBoundsBehavior = await page.evaluate(async fixture => {
		const app = globalThis.sviber;
		const originalClipboard = structuredClone(app.internalClipboard);
		const baseState = () => {
			const state = structuredClone(fixture.snapshot);
			state.channels = [{ id: 0 }];
			state.editor = { ...state.editor, currentChannel: 0, currentTime: [0, 0, 1], timeSnapped: true };
			state.events = [];
			state.snappees = [];
			state.nextIds = { channel: 1, event: 10, snappee: 10 };
			return state;
		};
		const install = ({ allow, events = [], snappees = [] }) => {
			app.freeTransform = null;
			app.previewBase = null;
			const state = baseState();
			state.editor.allowOutOfBounds = allow;
			state.events = events;
			state.snappees = snappees;
			app.model.restore(state);
			app.history.reset(state, fixture.historyLabel);
			app.refreshNow();
		};
		const tap = (id, x, y, selected = true) => ({
			id, type: "tap", time: [0, 0, 1], channel: 0, selected, attached: false, x, y,
		});
		const mesh = selected => ({
			id: 0, type: "rectangularMesh", name: "boundary mesh", color: "#00e0ad",
			transformation: [1, 0, 0, 1, 0, 0], active: true, selected,
			topLeftX: 0, topLeftY: 0, bottomRightX: 130, bottomRightY: 0,
			horizontalTiles: 1, verticalTiles: 1,
		});

		install({ allow: false, events: [tap(0, 95, 40)] });
		const boundedArrowApplied = app.translateSelected(12.5, 0);
		const boundedArrow = { x: app.model.events[0].x, applied: boundedArrowApplied };
		app.editSelectedProperty("x", 150);
		app.editSelectedProperty("y", 70);
		const boundedInspector = { x: app.model.events[0].x, y: app.model.events[0].y };
		app.movePosition(0, { x: 150, y: 70 });
		const boundedDrag = { x: app.model.events[0].x, y: app.model.events[0].y };

		install({ allow: true, events: [tap(0, 95, 40)] });
		const unboundedArrowApplied = app.translateSelected(12.5, 0);
		const unboundedArrow = { x: app.model.events[0].x, applied: unboundedArrowApplied };
		app.editSelectedProperty("x", 150);
		app.editSelectedProperty("y", 70);
		const unboundedInspector = { x: app.model.events[0].x, y: app.model.events[0].y };
		app.movePosition(0, { x: 175, y: 80 });
		const unboundedDrag = { x: app.model.events[0].x, y: app.model.events[0].y };

		install({ allow: false, events: [tap(0, 90, 40), tap(1, 95, 45)] });
		const boundedFreeStarted = app.startFreeTransform();
		const boundedFreeApplied = app.previewFreeTransform([1, 0, 0, 1, 20, 20]);
		const boundedFree = app.model.events.map(event => ({ x: event.x, y: event.y }));
		app.cancelFreeTransform();
		install({ allow: true, events: [tap(0, 90, 40), tap(1, 95, 45)] });
		const unboundedFreeStarted = app.startFreeTransform();
		const unboundedFreeApplied = app.previewFreeTransform([1, 0, 0, 1, 20, 20]);
		const unboundedFree = app.model.events.map(event => ({ x: event.x, y: event.y }));
		app.cancelFreeTransform();

		install({ allow: false, events: [tap(0, 129, 0)], snappees: [{ ...mesh(false), topLeftX: 130 }] });
		app.attachSelected();
		const boundedAttach = app.model.events[0].attached;
		install({ allow: true, events: [tap(0, 129, 0)], snappees: [{ ...mesh(false), topLeftX: 130 }] });
		app.attachSelected();
		const unboundedAttach = app.model.events[0].attached;

		const attachedPair = () => [
			{ ...tap(0, 0, 0), attached: true, snappee: 0, snapPoint: [0, 0], x: undefined, y: undefined },
			{ ...tap(1, 0, 0), attached: true, snappee: 0, snapPoint: [0, 0], x: undefined, y: undefined },
		];
		install({ allow: false, events: attachedPair(), snappees: [mesh(false)] });
		app.movePosition(0, { x: 130, y: 0, snappeeId: 0, snapPoint: [1, 0] });
		const boundedAttachedMove = structuredClone(app.model.events[0].snapPoint);
		install({ allow: true, events: attachedPair(), snappees: [mesh(false)] });
		app.movePosition(0, { x: 130, y: 0, snappeeId: 0, snapPoint: [1, 0] });
		const unboundedAttachedMove = structuredClone(app.model.events[0].snapPoint);

		install({ allow: false, snappees: [mesh(true)] });
		const curve = app.model.snappees[0];
		curve.type = "penCurve";
		curve.commands = [{ type: "M", x: 0, y: 0 }, { type: "L", x: 130, y: 0 }];
		curve.segments = 2;
		curve.closed = false;
		app.fillSelectedCurve();
		const boundedFill = app.model.events.map(event => app.model.generateSunniesnowEvents().find(item => item.type === "drag" && item.time === app.model.timing.beatToSeconds(event.time))?.properties.x);
		install({ allow: true, snappees: [{ ...mesh(true), type: "penCurve", commands: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 130, y: 0 }], segments: 2, closed: false }] });
		app.fillSelectedCurve();
		const unboundedFill = app.model.generateSunniesnowEvents().filter(event => event.type === "drag").map(event => event.properties.x);

		const pasteData = async (allow, data, duplicateSnappees) => {
			install({ allow });
			app.internalClipboard = structuredClone(data);
			await navigator.clipboard.writeText(JSON.stringify(data.events));
			await app.pasteEvents(duplicateSnappees);
			const event = app.model.events[0];
			const generated = app.model.generateSunniesnowEvents().find(item => item.type === "tap");
			return {
				attached: event.attached,
				x: event.x,
				y: event.y,
				generatedX: generated?.properties.x,
				generatedY: generated?.properties.y,
			};
		};
		const directClipboard = {
			version: 1,
			events: [{ type: "tap", beat: [0, 0, 1], channel: 0, attached: false, x: 150, y: 70 }],
			snappees: [],
		};
		const boundedDirectPaste = await pasteData(false, directClipboard, false);
		const unboundedDirectPaste = await pasteData(true, directClipboard, false);
		const pastedMesh = { ...mesh(false), topLeftX: 150, topLeftY: 70, bottomRightX: 150, bottomRightY: 70 };
		const attachedClipboard = {
			version: 1,
			events: [{ type: "tap", beat: [0, 0, 1], channel: 0, attached: true, snappee: 0, snapPoint: [0, 0] }],
			snappees: [pastedMesh],
		};
		const boundedAttachedPaste = await pasteData(false, attachedClipboard, true);
		const unboundedAttachedPaste = await pasteData(true, attachedClipboard, true);
		const missingSnappeePaste = await pasteData(true, { ...attachedClipboard, snappees: [] }, true);

		const attachedEvent = { ...tap(0, 0, 0), attached: true, snappee: 0, snapPoint: [0, 0], x: undefined, y: undefined };
		install({ allow: false, events: [attachedEvent], snappees: [mesh(false)] });
		const boundedHandleHistory = app.history.length;
		app.setSnappeeHandle(0, 0, { x: 150, y: 70 });
		const boundedSnappeeHandle = {
			x: app.model.snappees[0].topLeftX,
			y: app.model.snappees[0].topLeftY,
			historyDelta: app.history.length - boundedHandleHistory,
		};
		install({ allow: true, events: [attachedEvent], snappees: [mesh(false)] });
		app.setSnappeeHandle(0, 0, { x: 150, y: 70 });
		const unboundedSnappeeHandle = {
			x: app.model.snappees[0].topLeftX,
			y: app.model.snappees[0].topLeftY,
			generatedX: app.model.generateSunniesnowEvents().find(item => item.type === "tap")?.properties.x,
			generatedY: app.model.generateSunniesnowEvents().find(item => item.type === "tap")?.properties.y,
		};

		const editSnappeeThroughDialog = async allow => {
			install({ allow, events: [attachedEvent], snappees: [mesh(false)] });
			const originalForm = app.dialogs.form;
			app.dialogs.form = async () => ({
				...app.snappeeFormValues("rectangularMesh", app.model.snappees[0]),
				topLeft: [150, 70],
			});
			try { await app.showSnappeeDialog("rectangularMesh", 0); }
			finally { app.dialogs.form = originalForm; }
			return {
				x: app.model.snappees[0].topLeftX,
				y: app.model.snappees[0].topLeftY,
				generatedX: app.model.generateSunniesnowEvents().find(item => item.type === "tap")?.properties.x,
				generatedY: app.model.generateSunniesnowEvents().find(item => item.type === "tap")?.properties.y,
			};
		};
		const boundedSnappeeDialog = await editSnappeeThroughDialog(false);
		const unboundedSnappeeDialog = await editSnappeeThroughDialog(true);

		app.model.restore(fixture.snapshot);
		app.history.reset(fixture.snapshot, fixture.historyLabel);
		app.savedSignature = fixture.savedSignature;
		app.internalClipboard = originalClipboard;
		app.updateDirty();
		app.refreshNow();
		return {
			boundedArrow, boundedInspector, boundedDrag,
			unboundedArrow, unboundedInspector, unboundedDrag,
			boundedFreeStarted, boundedFreeApplied, boundedFree,
			unboundedFreeStarted, unboundedFreeApplied, unboundedFree,
			boundedAttach, unboundedAttach, boundedAttachedMove, unboundedAttachedMove,
			boundedFill, unboundedFill,
			boundedDirectPaste, unboundedDirectPaste, boundedAttachedPaste, unboundedAttachedPaste, missingSnappeePaste,
			boundedSnappeeHandle, unboundedSnappeeHandle, boundedSnappeeDialog, unboundedSnappeeDialog,
		};
	}, outOfBoundsFixture);
	assert.deepEqual(outOfBoundsBehavior.boundedArrow, { x: 95, applied: false });
	assert.deepEqual(outOfBoundsBehavior.boundedInspector, { x: 100, y: 50 });
	assert.deepEqual(outOfBoundsBehavior.boundedDrag, { x: 100, y: 50 });
	assert.deepEqual(outOfBoundsBehavior.unboundedArrow, { x: 107.5, applied: true });
	assert.deepEqual(outOfBoundsBehavior.unboundedInspector, { x: 150, y: 70 });
	assert.deepEqual(outOfBoundsBehavior.unboundedDrag, { x: 175, y: 80 });
	assert.equal(outOfBoundsBehavior.boundedFreeStarted, true);
	assert.equal(outOfBoundsBehavior.boundedFreeApplied, false);
	assert.deepEqual(outOfBoundsBehavior.boundedFree, [{ x: 90, y: 40 }, { x: 95, y: 45 }]);
	assert.equal(outOfBoundsBehavior.unboundedFreeStarted, true);
	assert.equal(outOfBoundsBehavior.unboundedFreeApplied, true);
	assert.deepEqual(outOfBoundsBehavior.unboundedFree, [{ x: 110, y: 60 }, { x: 115, y: 65 }]);
	assert.equal(outOfBoundsBehavior.boundedAttach, false);
	assert.equal(outOfBoundsBehavior.unboundedAttach, true);
	assert.deepEqual(outOfBoundsBehavior.boundedAttachedMove, [0, 0]);
	assert.deepEqual(outOfBoundsBehavior.unboundedAttachedMove, [1, 0]);
	assert.ok(outOfBoundsBehavior.boundedFill.length > 0);
	assert.ok(outOfBoundsBehavior.unboundedFill.length > outOfBoundsBehavior.boundedFill.length);
	assert.ok(outOfBoundsBehavior.boundedFill.every(x => x <= 100));
	assert.ok(outOfBoundsBehavior.unboundedFill.some(x => x > 100));
	assert.deepEqual(outOfBoundsBehavior.boundedDirectPaste,
		{ attached: false, x: 100, y: 50, generatedX: 100, generatedY: 50 });
	assert.deepEqual(outOfBoundsBehavior.unboundedDirectPaste,
		{ attached: false, x: 150, y: 70, generatedX: 150, generatedY: 70 });
	assert.deepEqual(outOfBoundsBehavior.boundedAttachedPaste,
		{ attached: false, x: 100, y: 50, generatedX: 100, generatedY: 50 });
	assert.deepEqual(outOfBoundsBehavior.unboundedAttachedPaste,
		{ attached: true, x: undefined, y: undefined, generatedX: 150, generatedY: 70 });
	assert.deepEqual(outOfBoundsBehavior.missingSnappeePaste,
		{ attached: false, x: 0, y: 0, generatedX: 0, generatedY: 0 });
	assert.deepEqual(outOfBoundsBehavior.boundedSnappeeHandle, { x: 0, y: 0, historyDelta: 0 });
	assert.deepEqual(outOfBoundsBehavior.unboundedSnappeeHandle,
		{ x: 150, y: 70, generatedX: 150, generatedY: 70 });
	assert.deepEqual(outOfBoundsBehavior.boundedSnappeeDialog,
		{ x: 0, y: 0, generatedX: 0, generatedY: 0 });
	assert.deepEqual(outOfBoundsBehavior.unboundedSnappeeDialog,
		{ x: 150, y: 70, generatedX: 150, generatedY: 70 });
	const batchChainBehavior = await page.evaluate(() => {
		const app = globalThis.sviber;
		const snapshot = app.model.snapshot();
		const historyLabel = app.history.currentEntry.label;
		const savedSignature = app.savedSignature;
		app.model.events = [];
		const channel = app.model.channels[0].id;
		for (let index = 0; index < 4; index += 1) {
			app.model.addEvent("tap", {
				time: [index, 0, 1], channel, selected: index < 3,
				tipPointSpawnType: index < 3 ? "drop" : "inherit",
			});
		}
		app.history.reset(app.model.snapshot(), historyLabel);
		const historyLength = app.history.length;
		const result = app.editSelectedProperty("tipPointSpawnType", "chain");
		const modes = app.model.events.map(event => event.tipPointSpawnType);
		const guideIds = app.model.generateSunniesnowEvents()
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
	assert.equal(new Set(batchChainBehavior.guideIds.slice(0, 3)).size, 1,
		"batch Chain edit must export one shared Sunniesnow tipPoint");
	assert.equal(batchChainBehavior.guideIds[3], null, "batch Chain edit must stop before the next note");
	assert.equal(batchChainBehavior.historyDelta, 1, "batch Chain edit must create one history entry");
	await runInteractionChecks(page, outputDirectory);
	await runProjectChecks(page, outputDirectory);
	await runV8BrowserChecks(page);
	await runPreferenceAndLicenseChecks(browser, activeBaseUrl, outputDirectory);
	await page.setViewportSize({ width: 960, height: 620 });
	await page.waitForTimeout(150);
	const narrowTapMetric = await measureTapRadius(page);
	assert.ok(Math.abs(narrowTapMetric.radius / narrowTapMetric.scale - 11.875) < 1e-8,
		`narrow Tap radius does not match Sunniesnow: ${JSON.stringify(narrowTapMetric)}`);
	assert.notEqual(narrowTapMetric.scale, desktopTapMetric.scale, "stage resize did not change the note scale");
	assert.notEqual(narrowTapMetric.radius, desktopTapMetric.radius, "stage resize did not change the displayed note radius");
	const narrowLayout = await page.evaluate(() => ({
		innerWidth,
		innerHeight,
		scrollX,
		bodyHeight: document.body.scrollHeight,
		bodyWidth: document.body.scrollWidth,
		menuVisible: document.querySelector("#menu-bar").getBoundingClientRect().height > 0,
		footerBottom: document.querySelector("#tooltip-bar").getBoundingClientRect().bottom,
		status: (() => { const value = document.querySelector("#status-panel").getBoundingClientRect();
			return { left: value.left, right: value.right, width: value.width }; })(),
		side: (() => { const value = document.querySelector(".side-panel").getBoundingClientRect();
			return { left: value.left, right: value.right, width: value.width }; })(),
		canvases: [...document.querySelectorAll(".render-surface canvas")].map(canvas => {
			const rectangle = canvas.getBoundingClientRect();
			const parent = canvas.parentElement.getBoundingClientRect();
			return { left: rectangle.left, right: rectangle.right, width: rectangle.width,
				parentLeft: parent.left, parentRight: parent.right, parentWidth: parent.width };
		}),
	}));
	assert.ok(narrowLayout.bodyHeight <= narrowLayout.innerHeight + 1, "narrow page scrolls as a whole");
	assert.equal(narrowLayout.menuVisible, true);
	assert.ok(narrowLayout.footerBottom <= narrowLayout.innerHeight + 1);
	assert.equal(narrowLayout.scrollX, 0, `window scrolled horizontally: ${JSON.stringify(narrowLayout)}`);
	assert.ok(narrowLayout.bodyWidth <= narrowLayout.innerWidth + 1, `page overflows horizontally: ${JSON.stringify(narrowLayout)}`);
	assert.ok(narrowLayout.status.width >= 120 && narrowLayout.status.right <= narrowLayout.innerWidth + 1,
		`status panel is outside the viewport: ${JSON.stringify(narrowLayout)}`);
	assert.ok(narrowLayout.side.width >= 180 && narrowLayout.side.right <= narrowLayout.innerWidth + 1,
		`side panel is outside the viewport: ${JSON.stringify(narrowLayout)}`);
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
	assert.equal(toolbarGeometry.switcher.right - toolbarGeometry.switcher.left, 0,
		`the web chart selector occupies layout space: ${JSON.stringify(toolbarGeometry)}`);
	assert.equal(toolbarGeometry.buttons.length, 35);
	assert.ok(toolbarGeometry.buttons.every(button => button.width > 0
		&& button.left >= toolbarGeometry.toolbar.left - 1 && button.right <= toolbarGeometry.toolbar.right + 1),
		`not every toolbar command is visible at 960px: ${JSON.stringify(toolbarGeometry)}`);
	for (const canvas of narrowLayout.canvases) {
		assert.ok(Math.abs(canvas.left - canvas.parentLeft) <= 1 && Math.abs(canvas.right - canvas.parentRight) <= 1,
			`canvas width ${canvas.width} does not match host width ${canvas.parentWidth}`);
	}
	await assertCanvas(page.locator("#timeline-surface canvas"), "timeline-narrow");
	await assertCanvas(page.locator("#scroll-surface canvas"), "scroll-narrow");
	await assertCanvas(page.locator("#stage-surface canvas"), "stage-narrow");
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
		assert.match(await englishPage.locator('.menu-root[data-menu-id="file"] .menu-root-button').textContent(), /File/);
		assert.equal(await englishPage.locator("html").getAttribute("lang"), "en-US");
		const darkColors = await englishPage.evaluate(() => ({
			body: getComputedStyle(document.body).backgroundColor,
			panel: getComputedStyle(document.querySelector(".side-panel")).backgroundColor,
		}));
		assert.equal(darkColors.body, "rgb(24, 26, 29)");
		assert.equal(darkColors.panel, "rgb(32, 35, 39)");
		await assertCanvas(englishPage.locator("#scroll-surface canvas"), "scroll-dark-en-US");
		await assertCanvas(englishPage.locator("#stage-surface canvas"), "stage-dark-en-US");
		await englishPage.screenshot({ path: path.join(outputDirectory, "sviber-desktop-dark-en-US.png"), fullPage: true });
	} finally {
		await englishContext.close();
	}

	await page.evaluate(async () => navigator.serviceWorker?.ready);
	await page.reload({ waitUntil: "networkidle" });
	await waitForEditor(page);
	assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true, "service worker did not control the page");
	await context.setOffline(true);
	await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
	await waitForEditor(page);
	assert.equal(await page.locator("#inspector-tab").textContent(), "检查器");
	await assertCanvas(page.locator("#scroll-surface canvas"), "scroll-offline");
	await assertCanvas(page.locator("#stage-surface canvas"), "stage-offline");
	await page.screenshot({ path: path.join(outputDirectory, "sviber-offline.png"), fullPage: true });

	const unexpectedErrors = pageErrors;
	const unexpectedResources = resourceErrors.filter(message => !message.includes("/sviber/assets/fonts/"));
	assert.deepEqual(unexpectedErrors, [], `browser errors: ${unexpectedErrors.join(" | ")}`);
	assert.deepEqual(unexpectedResources, [], `resource errors: ${unexpectedResources.join(" | ")}`);
	console.log(JSON.stringify({ baseUrl: activeBaseUrl, playbackBenchmark, editingBenchmark, macroChecks,
		canvasSummaries, screenshots: outputDirectory }, null, 2));
} finally {
	await context.setOffline(false).catch(() => {});
	await context.close();
	await browser.close();
	if (temporaryServer) await new Promise(resolveClose => temporaryServer.close(() => resolveClose()));
}
