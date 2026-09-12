import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
	applyVideoEncoderDefaults,
	defaultVideoFfmpegOutputOptions,
	installAtomicVideoOutput,
	installRecordEncoderGuards,
	partialOutputPath,
	videoEncoderFailure,
} from "../js/app/render-encoder.js";

test("video encoder options force yuv420p and cap x264 threads", () => {
	assert.equal(defaultVideoFfmpegOutputOptions(32), "-pix_fmt yuv420p -preset faster -threads 8");
	assert.equal(defaultVideoFfmpegOutputOptions(2), "-pix_fmt yuv420p -preset faster -threads 2");
	assert.equal(defaultVideoFfmpegOutputOptions(0), "-pix_fmt yuv420p -preset faster -threads 1");
	const options = applyVideoEncoderDefaults({});
	assert.match(options.ffmpegOutputOptions, /-pix_fmt yuv420p/);
	const kept = applyVideoEncoderDefaults({ ffmpegOutputOptions: "-c:v hevc_nvenc" });
	assert.equal(kept.ffmpegOutputOptions, "-c:v hevc_nvenc", "an explicit override is left intact");
});

test("encoder pipe EOF becomes a thrown screenshot error instead of crashing the worker", async () => {
	class Record {
		async createVideoGeneratingFfmpeg() {
			this.videoPipe = new PassThrough();
			this.videoGeneratingFfmpeg = new EventEmitter();
			this.tempPixels = Buffer.from([1, 2, 3, 4]);
		}

		async screenshot() {
			await new Promise(resolve => this.videoPipe.write(this.tempPixels, resolve));
		}
	}
	installRecordEncoderGuards(Record);
	installRecordEncoderGuards(Record);
	const record = new Record();
	await record.createVideoGeneratingFfmpeg();
	record.videoPipe.destroy(Object.assign(new Error("write EOF"), { code: "EOF" }));
	await assert.rejects(() => record.screenshot(), /FFmpeg 视频编码失败/);
});

test("a non-zero FFmpeg exit is reported on the next screenshot", async () => {
	class Record {
		async createVideoGeneratingFfmpeg() {
			this.videoPipe = new PassThrough();
			this.videoGeneratingFfmpeg = new EventEmitter();
			this.tempPixels = Buffer.from([1, 2, 3, 4]);
		}

		async screenshot() {
			await new Promise(resolve => this.videoPipe.write(this.tempPixels, resolve));
		}
	}
	installRecordEncoderGuards(Record);
	const record = new Record();
	await record.createVideoGeneratingFfmpeg();
	record.videoGeneratingFfmpeg.emit("exit", 1, null);
	await assert.rejects(() => record.screenshot(), /exited with code 1/);
});

test("videoEncoderFailure keeps the cause for the copyable error box", () => {
	const wrapped = videoEncoderFailure(Object.assign(new Error("malloc failed"), { stderr: "x264" }));
	assert.match(wrapped.message, /malloc failed/);
	assert.equal(wrapped.stderr, "x264");
	assert.equal(wrapped.cause.message, "malloc failed");
});

test("the partial output path keeps the extension beside the target", () => {
	// The extension is what tells FFmpeg which container to mux, and the directory keeps the
	// final rename on one volume.
	assert.equal(partialOutputPath("D:\\charts\\run.mkv", 12), "D:\\charts\\run.sviber-partial-12.mkv");
	assert.equal(partialOutputPath("/home/u/out.webm", 3), "/home/u/out.sviber-partial-3.webm");
	assert.equal(partialOutputPath("/home/u/video.tar.gz", 1), "/home/u/video.tar.sviber-partial-1.gz");
	assert.equal(partialOutputPath("/home/u/noext", 4), "/home/u/noext.sviber-partial-4");
	assert.equal(partialOutputPath("relative.mkv", 6), "relative.sviber-partial-6.mkv");
	// A leading dot names the file, it does not start an extension.
	assert.equal(partialOutputPath("/home/u/.hidden", 7), "/home/u/.hidden.sviber-partial-7");
});

test("an interrupted mux leaves the existing output file untouched", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "sviber-atomic-"));
	try {
		const target = path.join(directory, "video.mkv");
		await writeFile(target, "ORIGINAL");
		class Record {
			async runFfmpeg() {
				assert.notEqual(this.output, target, "FFmpeg must not write the target while muxing");
				await writeFile(this.output, "HALF-WRITTEN");
				throw new Error("FFmpeg died");
			}
		}
		installAtomicVideoOutput(Record, fs, { pid: 7 });
		const record = new Record();
		record.output = target;
		await assert.rejects(() => record.runFfmpeg(), /FFmpeg died/);
		assert.equal(await readFile(target, "utf8"), "ORIGINAL");
		assert.deepEqual(await readdir(directory), ["video.mkv"], "the partial file is cleaned up");
		assert.equal(record.output, target, "the output path is restored after a failure");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("a finished mux replaces the old file only once FFmpeg exited cleanly", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "sviber-atomic-"));
	try {
		const target = path.join(directory, "video.mkv");
		await writeFile(target, "ORIGINAL");
		class Record {
			async runFfmpeg() {
				assert.match(path.basename(this.output), /^video\.sviber-partial-4242\.mkv$/);
				await writeFile(this.output, "RENDERED");
			}
		}
		installAtomicVideoOutput(Record, fs, { pid: 4242 });
		const record = new Record();
		record.output = target;
		await record.runFfmpeg();
		assert.equal(await readFile(target, "utf8"), "RENDERED");
		assert.deepEqual(await readdir(directory), ["video.mkv"], "the partial file is gone");
		assert.equal(record.output, target);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("a target that cannot be replaced keeps the finished render next to it", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "sviber-atomic-"));
	try {
		// A directory at the target path makes the rename fail, standing in for a locked or
		// read-only file (OneDrive, a player holding it).
		const target = path.join(directory, "video.mkv");
		await mkdir(target, { recursive: true });
		class Record {
			async runFfmpeg() {
				await writeFile(this.output, "RENDERED");
			}
		}
		installAtomicVideoOutput(Record, fs, { pid: 9 });
		const record = new Record();
		record.output = target;
		const partial = path.join(directory, "video.sviber-partial-9.mkv");
		await assert.rejects(
			() => record.runFfmpeg(),
			error => {
				assert.match(error.message, /无法覆盖目标文件/);
				assert.equal(error.partialPath, partial);
				return true;
			},
		);
		assert.equal(await readFile(partial, "utf8"), "RENDERED");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
