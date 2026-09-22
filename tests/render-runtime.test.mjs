import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	defaultAvatarCandidate,
	filesystemPathForFetch,
	installRecordFetchFallback,
	isDefaultAvatarName,
	prepareAvatarOptions,
	resolveFfmpegForRecord,
	sviberAppRoot,
} from "../js/app/render-runtime.js";

test("the built-in default avatar ships with the app", () => {
	assert.equal(fs.existsSync(defaultAvatarCandidate(sviberAppRoot())), true);
});

test("Windows drive paths are local files, not fetchable URLs", () => {
	assert.equal(filesystemPathForFetch("E:/charts/avatar.png"), "E:/charts/avatar.png");
	assert.equal(filesystemPathForFetch("E:\\谱面\\头像.png"), "E:\\谱面\\头像.png");
	assert.equal(filesystemPathForFetch("\\\\server\\share\\a.png"), "\\\\server\\share\\a.png");
	assert.equal(filesystemPathForFetch("https://example.com/a.png"), null);
	assert.equal(filesystemPathForFetch("default.svg"), null);
	assert.equal(isDefaultAvatarName("default.svg"), true);
	assert.equal(isDefaultAvatarName("https://sunniesnow.example/avatar/default.svg"), true);
	assert.equal(isDefaultAvatarName("E:/charts/avatar.png"), false);
	assert.equal(isDefaultAvatarName("poet.svg"), false);
});

test("the built-in default avatar is used instead of the community server", () => {
	const bundled = defaultAvatarCandidate(sviberAppRoot());
	const options = prepareAvatarOptions(
		{ avatar: "online", avatarOnline: "default.svg" },
		{ defaultAvatar: bundled, exists: target => target === bundled },
	);
	assert.equal(options.avatar, "upload");
	assert.equal(options.avatarUpload, bundled);
	assert.equal(options.avatarOnline, undefined);
});

test("an avatar path typed into the online field is read from disk", () => {
	const picked = "E:/charts/avatar.png";
	const options = prepareAvatarOptions(
		{ avatar: "online", avatarOnline: picked },
		{ defaultAvatar: "svg/default-avatar.svg", exists: target => target === picked },
	);
	assert.equal(options.avatar, "upload");
	assert.equal(options.avatarUpload, picked);
});

test("a missing avatar file is reported before the game starts", () => {
	assert.throws(
		() => prepareAvatarOptions(
			{ avatar: "upload", avatarUpload: "E:/missing/avatar.png" },
			{ exists: () => false },
		),
		/Local file not found: E:\/missing\/avatar\.png/,
	);
});

test("gravatar and custom online names are left for the game", () => {
	const gravatar = prepareAvatarOptions(
		{ avatar: "gravatar", avatarGravatar: "me@example.com", avatarOnline: "default.svg" },
		{ defaultAvatar: "svg/default-avatar.svg", exists: () => true },
	);
	assert.equal(gravatar.avatar, "gravatar");
	assert.equal(gravatar.avatarUpload, undefined);
	const custom = prepareAvatarOptions(
		{ avatar: "online", avatarOnline: "poet.svg" },
		{ defaultAvatar: "svg/default-avatar.svg", exists: () => true },
	);
	assert.equal(custom.avatar, "online");
	assert.equal(custom.avatarOnline, "poet.svg");
});

test("video rendering uses the bundled FFmpeg executable when the bare name was requested", () => {
	const bundled = "E:/Sunniesnow/sviber 0.17.16/package.nw/sviber/bin/ffmpeg.exe";
	assert.equal(
		resolveFfmpegForRecord("ffmpeg", { bundled, exists: target => target === bundled }),
		bundled,
	);
	assert.equal(
		resolveFfmpegForRecord(undefined, { bundled, exists: target => target === bundled }),
		bundled,
	);
	const custom = "C:/tools/ffmpeg.exe";
	assert.equal(
		resolveFfmpegForRecord(custom, {
			bundled,
			exists: target => target === custom || target === bundled,
		}),
		custom,
	);
	assert.equal(
		resolveFfmpegForRecord("ffmpeg", { bundled: "missing.exe", exists: () => false }),
		"ffmpeg",
	);
});

test("a Windows path that reaches fetch is read from disk", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "sviber-avatar-"));
	try {
		const file = path.join(directory, "avatar.svg");
		await writeFile(file, "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
		const utils = {
			async strictFetch() {
				throw new Error("network should not be used");
			},
		};
		installRecordFetchFallback(utils);
		const response = await utils.strictFetch(file);
		assert.equal(response.headers.get("content-type"), "image/svg+xml");
		assert.match(await response.text(), /<svg/);
		await assert.rejects(() => utils.strictFetch("E:/no/such/avatar.png"), /Local file not found/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
