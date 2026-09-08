import assert from "node:assert/strict";
import test from "node:test";

import { isHeadlessInvocation, parseCliArguments } from "../js/cli/cli.js";

test("--render marks the invocation as headless and captures the output path", () => {
	const args = parseCliArguments(["project.sviber", "--render", "out.mkv", "--nickname", "Poet"]);
	assert.equal(args.renderPath, "out.mkv");
	assert.equal(args.input, "project.sviber");
	assert.equal(args.nickname, "Poet");
	assert.equal(isHeadlessInvocation(args), true, "rendering must run headless without opening the editor");
});

test("render option flags capture their values and stay out of the unknown list", () => {
	const args = parseCliArguments([
		"chart.json",
		"--render",
		"cover.png",
		"--avatar",
		"upload",
		"--avatar-upload",
		"me.png",
		"--width",
		"1280",
		"--height",
		"720",
		"--fps",
		"30",
		"--speed",
		"1.5",
		"--results-duration",
		"2",
		"--ffmpeg",
		"/opt/ffmpeg",
	]);
	assert.equal(args.avatar, "upload");
	assert.equal(args.avatarUpload, "me.png");
	assert.equal(args.renderWidth, "1280");
	assert.equal(args.renderHeight, "720");
	assert.equal(args.renderFps, "30");
	assert.equal(args.renderSpeed, "1.5");
	assert.equal(args.renderResultsDuration, "2");
	assert.equal(args.renderFfmpeg, "/opt/ffmpeg");
	assert.deepEqual(args.unknown, []);
});

test("an image output renders the cover and everything else renders video", () => {
	const video = parseCliArguments(["in.sviber", "--render", "out.mkv"]);
	const image = parseCliArguments(["in.sviber", "--render", "out.png"]);
	assert.ok(!/\.png$/i.test(video.renderPath), "mkv output is a video render");
	assert.ok(/\.png$/i.test(image.renderPath), "png output is a cover render");
});
