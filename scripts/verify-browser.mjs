import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path, { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PNG } from "pngjs";
import { chromium } from "playwright-core";

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
	if (pathname === "/sviber" || pathname.startsWith("/sviber/")) {
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
	await page.waitForFunction(() => globalThis.sviber?.model && document.querySelectorAll("canvas").length === 2);
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
	await page.locator('.dialog-button[data-dialog-action="cancel"]').click();
	await waitForEditor(page);
	assert.ok(await page.evaluate(timestamp => Number(localStorage.getItem("sviber.manualSaveTime")) > timestamp,
		startupAutosaveTimestamp), "discarding startup recovery did not suppress the same autosave on reload");
	assert.equal(await page.locator("#inspector-tab").textContent(), "检查器");
	assert.equal(await page.locator(".menu-root-button").count(), 7);
	await page.locator('.menu-root[data-menu-id="file"] .menu-root-button').click();
	const importFileCommand = page.locator('.menu-command[data-command="file.importFile"]');
	assert.equal((await importFileCommand.textContent()).trim(), "导入谱面/关卡文件...");
	const fileChooserPromise = page.waitForEvent("filechooser");
	await importFileCommand.click();
	const fileChooser = await fileChooserPromise;
	assert.match(await fileChooser.element().getAttribute("accept"), /\.json/);
	await fileChooser.setFiles([]);
	await page.locator("#difficulty-add").hover();
	await page.waitForFunction(() => document.querySelector("#tooltip-text")?.textContent === "添加难度");
	await page.mouse.move(1, 1);

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
			let previewOpaque = 0;
			for (let index = 3; index < previewPixels.length; index += 4) {
				if (previewPixels[index] > 0) previewOpaque += 1;
			}
			return { stagePixels, previewOpaque };
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
		};
	});
	assert.equal(snappeeVisibility.deactivatedDifference, 0,
		"a deactivated snappee remains visible on the stage");
	assert.ok(snappeeVisibility.activatedDifference > 0,
		"the activated snappee visibility fixture did not draw anything");
	assert.equal(snappeeVisibility.deactivatedPreviewOpaque, 0,
		"a deactivated snappee preview remains visible in the sidebar");
	assert.ok(snappeeVisibility.activatedPreviewOpaque > 0,
		"the activated snappee preview is not visible in the sidebar");

	const canvasSummaries = {
		timeline: await assertCanvas(page.locator("#timeline-surface canvas"), "timeline-desktop"),
		stage: await assertCanvas(page.locator("#stage-surface canvas"), "stage-desktop"),
	};
	const desktopTapMetric = await measureTapRadius(page);
	assert.ok(Math.abs(desktopTapMetric.radius / desktopTapMetric.scale - 11.875) < 1e-8,
		`desktop Tap radius does not match Sunniesnow: ${JSON.stringify(desktopTapMetric)}`);

	const outOfBoundsFixture = await page.evaluate(() => ({
		snapshot: globalThis.sviber.model.snapshot(),
		historyLabel: globalThis.sviber.history.currentEntry.label,
		savedSignature: globalThis.sviber.savedSignature,
	}));
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
	await page.locator('.menu-root[data-menu-id="transform"] .menu-root-button').click();
	const allowOutOfBoundsItem = page.locator('.menu-command[data-command="transform.allowOutOfBounds"]');
	assert.equal(await allowOutOfBoundsItem.textContent().then(text => text.trim()), "允许音符超界");
	assert.equal(await allowOutOfBoundsItem.getAttribute("aria-checked"), "false");
	const historyBeforeOutOfBoundsToggle = await page.evaluate(() => globalThis.sviber.history.length);
	await allowOutOfBoundsItem.click();
	await page.waitForFunction(() => globalThis.sviber.model.editor.allowOutOfBounds === true);
	assert.equal(await page.evaluate(() => globalThis.sviber.history.length), historyBeforeOutOfBoundsToggle + 1);
	assert.equal(await page.evaluate(() => globalThis.sviber.dirty), true);
	const persistedOutOfBoundsSetting = await page.evaluate(() => {
		const app = globalThis.sviber;
		const json = app.model.toJSON();
		return {
			saved: json.sviber.editor.allowOutOfBounds,
			reopened: app.model.constructor.import(json).editor.allowOutOfBounds,
		};
	});
	assert.deepEqual(persistedOutOfBoundsSetting, { saved: true, reopened: true });
	await page.keyboard.press("Control+z");
	await page.waitForFunction(() => globalThis.sviber.model.editor.allowOutOfBounds === false);
	await page.keyboard.press("Control+y");
	await page.waitForFunction(() => globalThis.sviber.model.editor.allowOutOfBounds === true);

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

		install({ allow: false, events: [{ ...tap(0, 0, 0), attached: true, snappee: 0, snapPoint: [0, 0], x: undefined, y: undefined }], snappees: [mesh(false)] });
		app.movePosition(0, { x: 130, y: 0, snappeeId: 0, snapPoint: [1, 0] });
		const boundedAttachedMove = structuredClone(app.model.events[0].snapPoint);
		install({ allow: true, events: [{ ...tap(0, 0, 0), attached: true, snappee: 0, snapPoint: [0, 0], x: undefined, y: undefined }], snappees: [mesh(false)] });
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
	await page.waitForFunction(() => globalThis.sviber.creationMode === null && globalThis.sviber.model.editor.subdivision === 4);
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
	assert.ok(clipboardShape.length === 2 && clipboardShape.every(event => Array.isArray(event.beat)));
	assert.ok(clipboardShape.every(event => !Object.hasOwn(event, "time") && Number.isInteger(event.channel)));
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
	assert.equal(await page.locator('#inspector-panel label[title="生成距离"] + input').isDisabled(), false);

	const positionX = page.locator('#inspector-panel label[title="位置"] + .attached-input input').first();
	await positionX.fill("100 / 4");
	await positionX.press("Tab");
	await page.waitForFunction(() => globalThis.sviber.model.events.every(event => event.x === 25));
	await page.evaluate(() => document.activeElement?.blur());
	await page.keyboard.press("Control+z");
	await page.waitForFunction(() => globalThis.sviber.model.events.some(event => event.x !== 25));
	const radiansToggle = page.locator('#inspector-panel label[title="生成方向"] + .angle-input input[type="checkbox"]');
	await radiansToggle.check();
	const directionInput = page.locator('#inspector-panel label[title="生成方向"] + .angle-input > input');
	await directionInput.fill("pi / 3");
	await directionInput.press("Tab");
	await page.waitForFunction(() => globalThis.sviber.model.events.every(event => Math.abs(event.tipPointSpawnAngle - Math.PI / 3) < 1e-9));

	const eventType = page.locator('#inspector-panel label[title="类型"] + select');
	await eventType.selectOption("bgNote");
	await page.waitForFunction(() => globalThis.sviber.model.events.every(event => event.type === "bgNote"));
	const durationInputs = page.locator('#inspector-panel label[title="持续拍数"] + .rational-input input');
	await durationInputs.nth(0).fill("0");
	await durationInputs.nth(1).fill("0");
	await durationInputs.nth(2).fill("1");
	await durationInputs.nth(2).press("Tab");
	await page.waitForFunction(() => globalThis.sviber.model.events.every(event => JSON.stringify(event.duration) === JSON.stringify([0, 0, 1])));
	await page.evaluate(() => document.activeElement?.blur());
	await page.keyboard.press("Control+d");
	await page.locator('.tool-button[data-command="events.bgNote"]').click();
	const defaultDurationStageBox = await stage.boundingBox();
	await page.mouse.click(defaultDurationStageBox.x + defaultDurationStageBox.width * 0.72,
		defaultDurationStageBox.y + defaultDurationStageBox.height * 0.64);
	await page.waitForFunction(() => globalThis.sviber.model.events.length === 3);
	assert.deepEqual(await page.evaluate(() => globalThis.sviber.model.events.find(event => event.selected).duration), [0, 0, 1],
		"bgNote creation did not remember the most recently edited duration");
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
	await page.mouse.move(transformCenter.x, transformCenter.y);
	await page.mouse.down();
	await page.mouse.move(transformCenter.x + 24, transformCenter.y - 12);
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

	await page.locator('.tool-button[data-command="music.playPause"]').click();
	await page.waitForFunction(() => globalThis.sviber.audio.playing === true);
	const playbackState = await page.evaluate(() => ({
		selection: globalThis.sviber.model.events.map(event => event.selected),
		events: globalThis.sviber.model.events.map(event => ({ ...event })),
		saveEnabled: globalThis.sviber.registry.isEnabled("file.save", globalThis.sviber),
		moveEnabled: globalThis.sviber.registry.isEnabled("transform.moveRight", globalThis.sviber),
		musicEnabled: globalThis.sviber.registry.isEnabled("music.seekForward", globalThis.sviber),
		panelsInert: [...document.querySelectorAll("#inspector-panel,#snappees-panel,.history-panel")]
			.every(element => element.inert),
	}));
	assert.equal(playbackState.saveEnabled, false);
	assert.equal(playbackState.moveEnabled, false);
	assert.equal(playbackState.musicEnabled, true);
	assert.equal(playbackState.panelsInert, true);
	const playbackStageBox = await stage.boundingBox();
	await page.mouse.click(playbackStageBox.x + playbackStageBox.width * 0.84,
		playbackStageBox.y + playbackStageBox.height * 0.76);
	const timelineBoxWhilePlaying = await page.locator("#timeline-surface canvas").boundingBox();
	await page.mouse.click(timelineBoxWhilePlaying.x + timelineBoxWhilePlaying.width * 0.73,
		timelineBoxWhilePlaying.y + timelineBoxWhilePlaying.height * 0.55);
	await page.waitForTimeout(120);
	assert.equal(await page.evaluate(() => globalThis.sviber.audio.playing), true,
		"an editor-canvas click paused playback");
	assert.deepEqual(await page.evaluate(() => globalThis.sviber.model.events.map(event => event.selected)), playbackState.selection,
		"an editor-canvas click changed selection during playback");
	assert.deepEqual(await page.evaluate(() => globalThis.sviber.model.events.map(event => ({ ...event }))), playbackState.events,
		"an editor-canvas interaction edited events during playback");
	await page.locator('.tool-button[data-command="music.playPause"]').click();
	await page.waitForFunction(() => globalThis.sviber.audio.playing === false);

	const difficultyFixture = await page.evaluate(() => {
		const app = globalThis.sviber;
		const originalForm = app.dialogs.form;
		const originalConfirm = app.dialogs.confirm;
		const firstId = app.activeDifficultyId;
		const firstCount = app.model.events.length;
		app.commit("browser difficulty fixture", model => {
			model.addEvent("tap", {
				time: [64, 0, 1], channel: model.channels[0].id, x: -37.5, y: 12.5,
			});
		});
		app.dialogs.form = async options => options.titleKey === "dialog.newDifficulty" ? {
			...app.model.metadata,
			difficultyName: "Master",
			difficultyColor: "#de59a3",
			difficulty: "12",
			difficultySup: "+",
			offset: app.model.timing.offset,
			initialBpm: app.model.timing.initialBpm,
		} : originalForm(options);
		app.dialogs.confirm = async () => true;
		globalThis.__difficultyFixture = { originalForm, originalConfirm, firstId, firstCount };
		return { firstId, firstCount };
	});
	await page.locator("#difficulty-add").click();
	await page.waitForFunction(firstId => globalThis.sviber.difficulties.length === 2
		&& globalThis.sviber.activeDifficultyId !== firstId, difficultyFixture.firstId);
	await page.waitForFunction(() => document.querySelectorAll("#difficulty-select option").length === 2);
	const secondId = await page.evaluate(() => globalThis.sviber.activeDifficultyId);
	assert.equal(await page.locator("#difficulty-select option").count(), 2);
	assert.match(await page.locator("#difficulty-select").inputValue(), /^difficulty-/);
	assert.equal(await page.evaluate(() => globalThis.sviber.model.metadata.difficultyName), "Master");
	assert.equal(await page.evaluate(() => globalThis.sviber.model.events.length), 0);
	await page.evaluate(() => {
		const app = globalThis.sviber;
		app.commit("browser master fixture", model => {
			model.addEvent("tap", {
				time: [8, 0, 1], channel: model.channels[0].id, x: 37.5, y: -12.5,
			});
		});
	});
	await page.locator("#difficulty-select").selectOption(difficultyFixture.firstId);
	await page.waitForFunction(firstId => globalThis.sviber.activeDifficultyId === firstId, difficultyFixture.firstId);
	assert.equal(await page.evaluate(() => globalThis.sviber.model.events.length), difficultyFixture.firstCount + 1);
	await page.keyboard.press("Control+z");
	await page.waitForFunction(count => globalThis.sviber.model.events.length === count, difficultyFixture.firstCount);
	await page.locator("#difficulty-select").selectOption(secondId);
	await page.waitForFunction(id => globalThis.sviber.activeDifficultyId === id, secondId);
	assert.equal(await page.evaluate(() => globalThis.sviber.model.events.length), 1,
		"undoing the first difficulty changed the second difficulty history");
	const sharedProjectState = await page.evaluate(() => {
		const app = globalThis.sviber;
		const original = {
			title: app.projectTitle,
			artist: app.projectArtist,
			music: app.projectMusic,
			image: app.projectImage,
		};
		app.projectTitle = "Shared browser title";
		app.projectArtist = "Shared browser artist";
		app.projectMusic = "shared.ogg";
		app.projectImage = "cover.png";
		app.syncProjectSharedFields();
		app.syncProjectHistorySharedFields();
		app.undo();
		const afterUndo = app.difficulties.map(entry => ({
			title: entry.model.metadata.title,
			artist: entry.model.metadata.artist,
			music: entry.model.music,
			image: entry.model.image,
		}));
		app.redo();
		const afterRedo = app.difficulties.map(entry => ({
			title: entry.model.metadata.title,
			artist: entry.model.metadata.artist,
			music: entry.model.music,
			image: entry.model.image,
		}));
		app.projectTitle = original.title;
		app.projectArtist = original.artist;
		app.projectMusic = original.music;
		app.projectImage = original.image;
		app.syncProjectSharedFields();
		app.syncProjectHistorySharedFields();
		return { afterUndo, afterRedo, eventCount: app.model.events.length };
	});
	const expectedShared = {
		title: "Shared browser title", artist: "Shared browser artist", music: "shared.ogg", image: "cover.png",
	};
	assert.ok(sharedProjectState.afterUndo.every(state => JSON.stringify(state) === JSON.stringify(expectedShared)),
		`shared project fields diverged after undo: ${JSON.stringify(sharedProjectState.afterUndo)}`);
	assert.ok(sharedProjectState.afterRedo.every(state => JSON.stringify(state) === JSON.stringify(expectedShared)),
		`shared project fields diverged after redo: ${JSON.stringify(sharedProjectState.afterRedo)}`);
	assert.equal(sharedProjectState.eventCount, 1);
	const sharedMetadataHistory = await page.evaluate(async () => {
		const app = globalThis.sviber;
		const originalForm = app.dialogs.form;
		const original = { title: app.projectTitle, artist: app.projectArtist };
		app.dialogs.form = async () => ({
			...app.model.metadata,
			title: "Renamed browser project",
			artist: "Renamed browser artist",
			offset: app.model.timing.offset,
			initialBpm: app.model.timing.initialBpm,
		});
		try { await app.showChartProperties(false); }
		finally { app.dialogs.form = originalForm; }
		const values = () => app.difficulties.map(entry => ({
			title: entry.model.metadata.title,
			artist: entry.model.metadata.artist,
		}));
		const changed = values();
		app.undo();
		const undone = values();
		app.redo();
		const redone = values();
		return { original, changed, undone, redone };
	});
	assert.ok(sharedMetadataHistory.changed.every(value => value.title === "Renamed browser project"
		&& value.artist === "Renamed browser artist"));
	assert.ok(sharedMetadataHistory.undone.every(value => value.title === sharedMetadataHistory.original.title
		&& value.artist === sharedMetadataHistory.original.artist));
	assert.deepEqual(sharedMetadataHistory.redone, sharedMetadataHistory.changed);
	await page.screenshot({ path: path.join(outputDirectory, "sviber-multi-difficulty.png"), fullPage: true });

	await page.evaluate(() => {
		const files = new Map();
		const directoryHandle = {
			name: "browser-project",
			async getFileHandle(name, options = {}) {
				if (!options.create && !files.has(name)) throw new DOMException("Missing file", "NotFoundError");
				return {
					name,
					async getFile() {
						const blob = files.get(name);
						return new File([blob], name, { type: blob?.type || "application/octet-stream" });
					},
					async createWritable() {
						const parts = [];
						return {
							async write(value) { parts.push(value); },
							async close() { files.set(name, new Blob(parts)); },
						};
					},
				};
			},
			async removeEntry(name) {
				if (!files.delete(name)) throw new DOMException("Missing file", "NotFoundError");
			},
		};
		globalThis.__browserProjectFiles = files;
		globalThis.__browserProjectDirectory = directoryHandle;
		globalThis.sviber.files.projectDirectoryHandle = directoryHandle;
		globalThis.sviber.files.projectPath = "";
	});
	await page.keyboard.press("Control+s");
	await page.waitForFunction(() => globalThis.__browserProjectFiles?.has("sviber-project.json"));
	const savedProject = await page.evaluate(async () => {
		const files = globalThis.__browserProjectFiles;
		const manifest = JSON.parse(await files.get("sviber-project.json").text());
		const charts = await Promise.all(manifest.charts.map(async entry => ({
			file: entry.file,
			document: JSON.parse(await files.get(entry.file).text()),
		})));
		return { files: [...files.keys()].sort(), manifest, charts };
	});
	assert.equal(savedProject.manifest.charts.length, 2);
	assert.equal(savedProject.manifest.activeChart, secondId);
	assert.deepEqual(savedProject.files,
		["Master.json", "Normal.json", "sviber-project.json"].sort());
	assert.ok(savedProject.charts.every(entry => entry.document.sviber),
		"editable project charts must retain their Sviber state");
	assert.deepEqual(savedProject.charts.map(entry => entry.document.difficultyName).sort(), ["Master", "Normal"]);
	const reopenedProject = await page.evaluate(async () => {
		const app = globalThis.sviber;
		const files = globalThis.__browserProjectFiles;
		const manifest = JSON.parse(await files.get("sviber-project.json").text());
		manifest.music = "music.wav";
		manifest.image = "cover.svg";
		files.set("sviber-project.json", new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: "application/json" }));

		const sampleRate = 8000;
		const sampleCount = sampleRate / 4;
		const wav = new ArrayBuffer(44 + sampleCount * 2);
		const view = new DataView(wav);
		const text = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
		text(0, "RIFF"); view.setUint32(4, 36 + sampleCount * 2, true); text(8, "WAVE"); text(12, "fmt ");
		view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
		view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
		view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data");
		view.setUint32(40, sampleCount * 2, true);
		files.set("music.wav", new Blob([wav], { type: "audio/wav" }));
		files.set("cover.svg", new Blob([
			'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#235b69"/></svg>',
		], { type: "image/svg+xml" }));

		const originalChooseProjectDirectory = app.files.chooseProjectDirectory;
		app.files.clearProjectTarget();
		app.files.chooseProjectDirectory = async () => ({ type: "browser", handle: globalThis.__browserProjectDirectory });
		try { await app.openProject(); }
		finally { app.files.chooseProjectDirectory = originalChooseProjectDirectory; }
		return {
			difficulties: app.difficulties.map(entry => entry.model.metadata.difficultyName),
			active: app.activeDifficultyId,
			music: app.files.musicFile?.name,
			musicReference: app.projectMusic,
			duration: app.audio.buffer?.duration,
			image: app.files.imageFile?.name,
			imageReference: app.projectImage,
			backgroundLoaded: Boolean(app.stage.backgroundImage),
		};
	});
	assert.deepEqual(reopenedProject.difficulties, ["Normal", "Master"]);
	assert.equal(reopenedProject.active, secondId);
	assert.equal(reopenedProject.music, "music.wav");
	assert.equal(reopenedProject.musicReference, "music.wav");
	assert.ok(reopenedProject.duration > 0.24 && reopenedProject.duration < 0.26);
	assert.equal(reopenedProject.image, "cover.svg");
	assert.equal(reopenedProject.imageReference, "cover.svg");
	assert.equal(reopenedProject.backgroundLoaded, true);

	await page.locator("#difficulty-delete").click();
	await page.waitForFunction(firstId => globalThis.sviber.difficulties.length === 1
		&& globalThis.sviber.activeDifficultyId === firstId, difficultyFixture.firstId);
	await page.waitForFunction(() => document.querySelectorAll("#difficulty-select option").length === 1
		&& document.querySelector("#difficulty-delete")?.disabled);
	assert.equal(await page.locator("#difficulty-select option").count(), 1);
	assert.equal(await page.locator("#difficulty-delete").isDisabled(), true);
	await page.keyboard.press("Control+s");
	await page.waitForFunction(async () => {
		const files = globalThis.__browserProjectFiles;
		if (!files?.has("sviber-project.json")) return false;
		const manifest = JSON.parse(await files.get("sviber-project.json").text());
		return manifest.charts.length === 1 && !files.has("Master.json");
	});
	await page.evaluate(() => {
		const app = globalThis.sviber;
		app.dialogs.form = globalThis.__difficultyFixture.originalForm;
		app.dialogs.confirm = globalThis.__difficultyFixture.originalConfirm;
		delete globalThis.__difficultyFixture;
		delete globalThis.__browserProjectFiles;
		delete globalThis.__browserProjectDirectory;
	});

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
	assert.ok(toolbarGeometry.switcher.left >= toolbarGeometry.toolbar.right - 1,
		`difficulty controls overlap the toolbar: ${JSON.stringify(toolbarGeometry)}`);
	assert.ok(toolbarGeometry.switcher.left >= toolbarGeometry.row.left - 1
		&& toolbarGeometry.switcher.right <= toolbarGeometry.row.right + 1
		&& toolbarGeometry.switcher.top >= toolbarGeometry.row.top - 1
		&& toolbarGeometry.switcher.bottom <= toolbarGeometry.row.bottom + 1,
	`difficulty controls leave the tool row: ${JSON.stringify(toolbarGeometry)}`);
	assert.equal(toolbarGeometry.buttons.length, 34);
	assert.ok(toolbarGeometry.buttons.every(button => button.width > 0
		&& button.left >= toolbarGeometry.toolbar.left - 1 && button.right <= toolbarGeometry.toolbar.right + 1),
		`not every toolbar command is visible at 960px: ${JSON.stringify(toolbarGeometry)}`);
	for (const canvas of narrowLayout.canvases) {
		assert.ok(Math.abs(canvas.left - canvas.parentLeft) <= 1 && Math.abs(canvas.right - canvas.parentRight) <= 1,
			`canvas width ${canvas.width} does not match host width ${canvas.parentWidth}`);
	}
	await assertCanvas(page.locator("#timeline-surface canvas"), "timeline-narrow");
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
	await assertCanvas(page.locator("#stage-surface canvas"), "stage-offline");
	await page.screenshot({ path: path.join(outputDirectory, "sviber-offline.png"), fullPage: true });

	const unexpectedErrors = pageErrors;
	const unexpectedResources = resourceErrors.filter(message => !message.includes("/sviber/assets/fonts/"));
	assert.deepEqual(unexpectedErrors, [], `browser errors: ${unexpectedErrors.join(" | ")}`);
	assert.deepEqual(unexpectedResources, [], `resource errors: ${unexpectedResources.join(" | ")}`);
	console.log(JSON.stringify({ baseUrl: activeBaseUrl, canvasSummaries, screenshots: outputDirectory }, null, 2));
} finally {
	await context.setOffline(false).catch(() => {});
	await context.close();
	await browser.close();
	if (temporaryServer) await new Promise(resolveClose => temporaryServer.close(() => resolveClose()));
}
