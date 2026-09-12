// Video-encoder helpers shared by the NW.js render job, the standalone worker, and the CLI.
// sunniesnow-record pipes 1920x1080 RGBA into FFmpeg with no output pixel format, so libx264
// defaults to High 4:4:4 Predictive at one thread per logical CPU. That is what OOMs as
// `x264 [error]: malloc of size ... failed` — especially when a cover worker has just run.
// This module must stay browser-safe: app-render.js imports it from the editor page.

const MAX_ENCODER_THREADS = 8;

export function defaultVideoFfmpegOutputOptions(cpuCount = MAX_ENCODER_THREADS) {
	const threads = Math.max(1, Math.min(MAX_ENCODER_THREADS, Math.floor(Number(cpuCount) || 1)));
	return `-pix_fmt yuv420p -preset faster -threads ${threads}`;
}

export function applyVideoEncoderDefaults(options, cpuCount) {
	if (!options.ffmpegOutputOptions) {
		options.ffmpegOutputOptions = defaultVideoFfmpegOutputOptions(cpuCount);
	}
	return options;
}

export function videoEncoderFailure(error) {
	const detail = error?.message ? String(error.message) : String(error ?? "unknown error");
	const wrapped = new Error(`FFmpeg 视频编码失败: ${detail}. FFmpeg video encoding failed: ${detail}.`);
	wrapped.cause = error;
	if (typeof error?.stderr === "string") {
		wrapped.stderr = error.stderr;
	}
	return wrapped;
}

export function installRecordEncoderGuards(Record) {
	if (Record.__sviberEncoderGuards) {
		return Record;
	}
	Record.__sviberEncoderGuards = true;
	const originalCreate = Record.prototype.createVideoGeneratingFfmpeg;
	Record.prototype.createVideoGeneratingFfmpeg = async function createVideoGeneratingFfmpegGuarded() {
		await originalCreate.call(this);
		attachVideoEncoderGuards(this);
	};
	const originalScreenshot = Record.prototype.screenshot;
	Record.prototype.screenshot = async function screenshotGuarded() {
		throwIfVideoEncoderFailed(this);
		await originalScreenshot.call(this);
		throwIfVideoEncoderFailed(this);
	};
	return Record;
}

function attachVideoEncoderGuards(record) {
	const pipe = record.videoPipe;
	if (!pipe || pipe.__sviberGuarded) {
		return;
	}
	pipe.__sviberGuarded = true;
	const fail = error => {
		record.videoEncoderError = record.videoEncoderError || error;
	};
	pipe.on("error", fail);
	record.videoGeneratingFfmpeg?.on("error", fail);
	record.videoGeneratingFfmpeg?.on("exit", (code, signal) => {
		if (code) {
			const suffix = signal ? ` (${signal})` : "";
			fail(new Error(`FFmpeg video encoder exited with code ${code}${suffix}`));
		}
	});
	wrapPipeWrite(pipe, fail);
}

function wrapPipeWrite(pipe, fail) {
	const originalWrite = pipe.write.bind(pipe);
	pipe.write = (chunk, encoding, callback) => {
		const hasEncoding = typeof encoding === "string";
		const writeCallback = hasEncoding ? callback : encoding;
		const wrapped = error => {
			if (error) {
				fail(error);
			}
			writeCallback?.(error);
		};
		try {
			return hasEncoding ? originalWrite(chunk, encoding, wrapped) : originalWrite(chunk, wrapped);
		} catch (error) {
			fail(error);
			throw error;
		}
	};
}

function throwIfVideoEncoderFailed(record) {
	if (record.videoEncoderError) {
		throw videoEncoderFailure(record.videoEncoderError);
	}
	if (record.videoPipe && !record.videoPipe.writable) {
		throw videoEncoderFailure(new Error("FFmpeg video encoder closed unexpectedly."));
	}
}
