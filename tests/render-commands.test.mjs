import assert from "node:assert/strict";
import test from "node:test";

import {
	buildRenderRecordOptions,
	renderErrorDetails,
	renderProgressState,
	withRender,
} from "../js/app/app-render.js";

function makeRenderApp({ music = "song.mp3", nw = true } = {}) {
	const shellStub = {
		Shell: { openItem: () => true, showItemInFolder: () => true },
		App: { startDir: "/app" },
	};
	globalThis.nw = nw ? shellStub : undefined;
	const RenderApp = withRender(
		class {
			constructor() {
				this.files = {
					bundledFfmpegPath: () => "/app/bin/ffmpeg.exe",
					bundledFontsDir: () => "/app/assets/fonts",
					showItemInFileExplorer: () => true,
					createLevelArchive: async () => new Blob(["level"]),
					backgroundUrl: "blob:background",
				};
				this.model = {
					metadata: { title: "My Chart", charter: "The Charter" },
					music,
					image: "bg.png",
				};
				this.editingProject = false;
				this.activeDifficultyId = "difficulty-0";
			}
		},
	);
	return new RenderApp();
}

test("render commands are grayed out outside NW.js and without music", () => {
	const app = makeRenderApp({ nw: false });
	assert.equal(app.canRenderVideo(), false);
	assert.equal(app.canRenderCover(), false);
	const withMusic = makeRenderApp();
	assert.equal(withMusic.canRenderVideo(), true);
	assert.equal(withMusic.canRenderCover(), true);
	const withoutMusic = makeRenderApp({ music: null });
	assert.equal(withoutMusic.canRenderVideo(), false, "video needs the currently loaded music");
	assert.equal(withoutMusic.canRenderCover(), true);
	globalThis.nw = undefined;
});

test("video options map dialog values onto sunniesnow-record settings", () => {
	const options = buildRenderRecordOptions(
		"video",
		"C:/out/video.mkv",
		{
			nickname: "",
			avatar: "gravatar",
			avatarOnline: "default.svg",
			avatarUpload: "",
			avatarGravatar: "me@example.com",
			useBundledFfmpeg: true,
			speed: "2",
			width: "1280",
			height: "720",
			fps: "30",
			resultsDuration: "2",
			waitForMusic: true,
		},
		"/app/bin/ffmpeg.exe",
		"/app/assets/fonts",
		null,
	);
	assert.equal(options.output, "C:/out/video.mkv");
	assert.equal(options.speed, 2, "the video speed defaults to 2 regardless of editor preferences");
	assert.equal(options.fps, 30);
	assert.equal(options.width, 1280);
	assert.equal(options.height, 720);
	assert.equal(options.resultsDuration, 2);
	assert.equal(options.waitForMusic, true);
	assert.equal(options.ffmpeg, "/app/bin/ffmpeg.exe", "the bundled FFmpeg is used when available");
	assert.equal(options.assetsDir, "/app/assets/fonts", "bundled fonts are reused instead of downloaded");
	assert.equal(options.avatar, "gravatar");
	assert.equal(options.avatarGravatar, "me@example.com");
	assert.equal(options.avatarOnline, undefined, "unused avatar sources are dropped");
});

test("cover options carry the theme area and drop FFmpeg settings", () => {
	const theme = { x: -0.25, y: 0.5, width: 1.5 };
	const options = buildRenderRecordOptions(
		"cover",
		"C:/out/cover.png",
		{
			nickname: "Poet",
			avatar: "upload",
			avatarUpload: "me.png",
			useBundledFfmpeg: true,
			width: "1920",
			height: "1080",
		},
		null,
		"/app/assets/fonts",
		theme,
	);
	assert.deepEqual(
		[options.coverThemeImageX, options.coverThemeImageY, options.coverThemeImageWidth],
		[-0.25, 0.5, 1.5],
	);
	assert.equal(options.ffmpeg, undefined, "covers never need FFmpeg");
	assert.equal(options.nickname, "Poet");
});

test("without bundled FFmpeg the renderer falls back to PATH", () => {
	const options = buildRenderRecordOptions(
		"video",
		"out.mkv",
		{ avatar: "online", useBundledFfmpeg: true, waitForMusic: true },
		null,
		null,
		null,
	);
	assert.equal(options.ffmpeg, "ffmpeg");
	assert.equal(options.assetsDir, undefined);
});

test("render progress states map to a ratio and a status text", () => {
	const loading = renderProgressState({ status: "loading", modulesCount: 2, totalModules: 4 });
	assert.ok(loading.ratio > 0 && loading.ratio <= 0.1);
	const rendering = renderProgressState({ status: "renderingGame", framesCount: 120, currentTime: 2, endTime: 10 });
	assert.equal(rendering.ratio > 0.1, true);
	const combining = renderProgressState({ status: "done" });
	assert.equal(combining.ratio, 1);
});

test("renderErrorDetails keeps the message, stderr, and stack for copying", () => {
	// A plain error renders as its message (the stack is omitted when it only repeats it).
	const plain = renderErrorDetails(new Error("boom"));
	assert.match(plain, /boom/);
	// FFmpeg stderr sections are appended when attached to the error.
	const detailed = renderErrorDetails(
		Object.assign(new Error("ffmpeg exited"), {
			stderr: ["line one", "line two"],
		}),
	);
	assert.match(detailed, /--- FFmpeg stderr ---/);
	assert.match(detailed, /line one\nline two/);
	// A stack that carries the message replaces the bare message so frames stay visible.
	const withStack = renderErrorDetails({ message: "only", stack: "Error: only\n    at run" });
	assert.equal(withStack, "Error: only\n    at run");
	// A stack that does not contain the message is appended after it.
	const split = renderErrorDetails({ message: "reason", stack: "at somewhere" });
	assert.match(split, /reason[\s\S]+at somewhere/);
	// Nothing to show renders as an empty string.
	assert.equal(renderErrorDetails(null), "");
});
