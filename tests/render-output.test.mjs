import assert from "node:assert/strict";
import test from "node:test";

import {
	VIDEO_OUTPUT_EXTENSIONS,
	extensionOfPath,
	removeRenderWorkDirectory,
	replacePathExtension,
} from "../js/app/render-output.js";
import {
	coverThemeDiamond,
	coverThemeSelection,
	coverThemeSpriteLayout,
	destroyCoverThemeApp,
	isDisplayableImageUrl,
	paintCoverThemeOverlay,
	resolveCoverThemeImageSource,
} from "../js/app/app-render-cover-widget.js";

test("video output suffixes rewrite the save path in place", () => {
	assert.deepEqual(VIDEO_OUTPUT_EXTENSIONS, ["mkv", "mp4", "webm"]);
	assert.equal(replacePathExtension("C:/out/chart-video.mkv", "mp4"), "C:/out/chart-video.mp4");
	assert.equal(replacePathExtension("C:\\out\\chart-video.mkv", "webm"), "C:\\out\\chart-video.webm");
	assert.equal(replacePathExtension("chart-video", "mp4"), "chart-video.mp4");
	assert.equal(replacePathExtension("", "mkv"), "");
	assert.equal(extensionOfPath("a/b.webm"), "webm");
	assert.equal(extensionOfPath("no-extension", "mkv"), "mkv");
});

test("removeRenderWorkDirectory retries until the directory is gone", async () => {
	const attempts = [];
	const fs = {
		rmSync(directory) {
			attempts.push(directory);
			if (attempts.length < 3) {
				throw new Error("EBUSY");
			}
		},
		existsSync() {
			return attempts.length < 3;
		},
	};
	const waits = [];
	assert.equal(
		await removeRenderWorkDirectory(fs, "/tmp/sviber-render-x", milliseconds => {
			waits.push(milliseconds);
			return Promise.resolve();
		}),
		true,
	);
	assert.equal(attempts.length, 3);
	assert.deepEqual(waits, [250, 500]);
	assert.equal(await removeRenderWorkDirectory(fs, ""), true);
});

test("cover theme diamond matches the game's rounded 4-gon", () => {
	const diamond = coverThemeDiamond({ width: 480, height: 270 }, { x: 0, y: 0, width: 1 });
	assert.equal(diamond.centerX, 240);
	assert.equal(diamond.centerY, 135);
	assert.equal(diamond.radius, 120);
	assert.equal(diamond.corner, 12);
	const calls = [];
	const overlay = {
		rect: (...args) => calls.push(["rect", args]),
		fill: (...args) => calls.push(["fill", args]),
		roundPoly: (...args) => calls.push(["roundPoly", args]),
		cut: (...args) => calls.push(["cut", args]),
		stroke: (...args) => calls.push(["stroke", args]),
	};
	paintCoverThemeOverlay(overlay, { width: 480, height: 270 }, diamond);
	assert.equal(calls.filter(call => call[0] === "roundPoly").length, 2);
	assert.deepEqual(calls.find(call => call[0] === "roundPoly")[1], [240, 135, 120, 4, 12]);
	assert.ok(calls.some(call => call[0] === "cut"));
	assert.deepEqual(
		coverThemeSelection(null, { width: 100, height: 100 }, { x: 0, y: 0, width: 1 }),
		{ x: null, y: null, width: null },
	);
});

test("cover theme image uses the stage blob URL instead of the chart filename", () => {
	assert.equal(isDisplayableImageUrl("cover.png"), false);
	assert.equal(isDisplayableImageUrl("blob:nodedata:abc"), true);
	assert.deepEqual(
		resolveCoverThemeImageSource({
			backgroundUrl: "blob:stage",
			files: { backgroundUrl: "blob:files" },
			model: { image: "cover.png" },
		}),
		{ url: "blob:stage", revoke: false },
	);
	assert.deepEqual(
		resolveCoverThemeImageSource({
			files: { backgroundUrl: "blob:files" },
			model: { image: "cover.png" },
		}),
		{ url: "blob:files", revoke: false },
	);
	assert.equal(
		resolveCoverThemeImageSource({ model: { image: "cover.png" }, files: {} }).url,
		null,
		"a bare filename is not a displayable image URL",
	);
	const file = new File(["x"], "cover.png", { type: "image/png" });
	const fromFile = resolveCoverThemeImageSource({
		files: { imageFile: file },
		model: { image: "cover.png" },
	});
	assert.match(fromFile.url, /^blob:/);
	assert.equal(fromFile.revoke, true);
	URL.revokeObjectURL(fromFile.url);
	const placed = coverThemeSpriteLayout({ width: 480, height: 270 }, { width: 1920, height: 1080 });
	assert.equal(placed.scale, 270 / 1080);
	assert.equal(placed.x, (480 - 1920 * placed.scale) / 2);
});

test("destroyCoverThemeApp swallows PIXI destroy failures so the dialog can close", () => {
	assert.doesNotThrow(() => destroyCoverThemeApp({ app: null }));
	const theme = {
		app: {
			ticker: { stop() { throw new Error("ticker"); } },
			destroy() { throw new Error("destroy"); },
		},
	};
	assert.doesNotThrow(() => destroyCoverThemeApp(theme));
	assert.equal(theme.app, null);
});
