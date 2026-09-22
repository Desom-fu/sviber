import assert from "node:assert/strict";
import test from "node:test";

import {
	avatarFieldHidden,
	chartFileNameWithoutExt,
	defaultRenderOutputPath,
	joinFilesystemPath,
	normalizeRenderDefaults,
	renderNicknameDefault,
	saveRenderDefaults,
	loadRenderDefaults,
} from "../js/core/render-defaults.js";

test("render default path is projectFolder/chartFileNameWithoutExt.mkv", () => {
	assert.equal(chartFileNameWithoutExt("lead.json"), "lead");
	assert.equal(
		defaultRenderOutputPath({ projectFolder: "D:/charts/song", chartFileName: "Hard.json" }),
		"D:/charts/song/Hard.mkv",
	);
	assert.equal(joinFilesystemPath("C:\\charts", "a.mkv"), "C:\\charts\\a.mkv");
	assert.equal(defaultRenderOutputPath({}), "");
});

test("first nickname falls back to charter; later values persist", () => {
	const storage = new Map();
	const fake = {
		getItem: key => storage.get(key) || null,
		setItem: (key, value) => storage.set(key, value),
	};
	assert.equal(renderNicknameDefault(normalizeRenderDefaults({}), "Alice"), "Alice");
	saveRenderDefaults({ nickname: "Bob", avatar: "gravatar", avatarGravatar: "b@example.com" }, fake);
	const loaded = loadRenderDefaults(fake);
	assert.equal(loaded.nickname, "Bob");
	assert.equal(loaded.avatar, "gravatar");
	assert.equal(loaded.avatarGravatar, "b@example.com");
	assert.equal(renderNicknameDefault(loaded, "Alice"), "Bob");
});

test("unused avatar inputs are hidden, not merely disabled", () => {
	assert.equal(avatarFieldHidden("online", "upload"), true);
	assert.equal(avatarFieldHidden("upload", "upload"), false);
	assert.equal(avatarFieldHidden("gravatar", "online"), true);
	assert.equal(avatarFieldHidden("weavatar", "gravatar"), true);
	assert.equal(avatarFieldHidden("weavatar", "weavatar"), false);
});

test("video and cover dialogs remember their fields independently", () => {
	const storage = new Map();
	const fake = {
		getItem: key => storage.get(key) || null,
		setItem: (key, value) => storage.set(key, value),
	};
	saveRenderDefaults(
		{
			nickname: "Poet",
			avatar: "weavatar",
			avatarWeavatar: "poet@example.com",
			output: "C:/out/last-video.mkv",
			speed: 1.5,
			width: 1280,
			height: 720,
			fps: 30,
			useBundledFfmpeg: false,
			waitForMusic: false,
			resultsDuration: 2,
		},
		"video",
		fake,
	);
	const video = loadRenderDefaults(fake);
	assert.equal(video.avatar, "weavatar", "the shared avatar kind persists");
	assert.equal(video.avatarWeavatar, "poet@example.com");
	assert.equal(video.video.output, "C:/out/last-video.mkv");
	assert.equal(video.video.speed, 1.5);
	assert.equal(video.video.fps, 30);
	assert.equal(video.video.waitForMusic, false);
	assert.equal(video.cover.output, null, "the cover dialog keeps its own output path");
	assert.equal(video.cover.width, null);

	saveRenderDefaults(
		{
			nickname: "Poet",
			avatar: "weavatar",
			avatarWeavatar: "poet@example.com",
			output: "C:/out/cover.png",
			width: 3840,
			height: 2160,
			coverThemeState: { x: 0.25, y: -0.5, width: 0.75, contained: true },
		},
		"cover",
		fake,
	);
	const both = loadRenderDefaults(fake);
	assert.equal(both.video.width, 1280, "the video size is untouched by the cover dialog");
	assert.equal(both.cover.width, 3840);
	assert.equal(both.cover.output, "C:/out/cover.png");
	assert.deepEqual(both.cover.coverTheme, { x: 0.25, y: -0.5, width: 0.75, contained: true });
	assert.equal(both.avatar, "weavatar", "the shared fields update from either dialog");
});

test("a legacy flat render-defaults payload still loads", () => {
	const normalized = normalizeRenderDefaults({ avatar: "gravatar", avatarGravatar: "a@b.c", nickname: "Old" });
	assert.equal(normalized.avatar, "gravatar");
	assert.equal(normalized.avatarGravatar, "a@b.c");
	assert.equal(normalized.nickname, "Old");
	assert.equal(normalized.video.output, null);
	assert.deepEqual(normalized.cover.coverTheme, { x: null, y: null, width: null, contained: false });
});
