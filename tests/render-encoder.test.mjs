import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
	applyVideoEncoderDefaults,
	defaultVideoFfmpegOutputOptions,
	installRecordEncoderGuards,
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
