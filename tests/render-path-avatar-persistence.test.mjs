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
});
