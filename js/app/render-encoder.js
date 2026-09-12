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

// FFmpeg muxes straight into the path the user picked, with -y, and a Matroska output is
// opened with O_TRUNC: the file that was already there is destroyed the moment the mux starts,
// not when it finishes. A stop or a crash inside that window — it is short, which is why it
// looks intermittent — leaves a truncated file and loses the original. Sunniesnow-record has
// no staging of its own (record.mjs runFfmpeg passes the output path straight through), so
// the guard below muxes into a sibling temp name and only moves it onto the target after
// FFmpeg exited cleanly. The sibling lives in the target's own directory, so the rename stays
// on one volume and is therefore atomic. The stem keeps the original extension because that
// is what tells FFmpeg which container to write.
export function partialOutputPath(outputPath, pid) {
	const text = String(outputPath ?? "");
	const separator = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
	const directory = separator >= 0 ? text.slice(0, separator + 1) : "";
	const name = text.slice(separator + 1);
	const dot = name.lastIndexOf(".");
	// A leading dot belongs to the name ("/.hidden"), it does not introduce an extension.
	const hasExtension = dot > 0;
	const extension = hasExtension ? name.slice(dot) : "";
	const stem = hasExtension ? name.slice(0, dot) : name;
	return `${directory}${stem}.sviber-partial-${pid}${extension}`;
}

export function installAtomicVideoOutput(Record, fsModule, options = {}) {
	if (Record.__sviberAtomicOutput) {
		return Record;
	}
	Record.__sviberAtomicOutput = true;
	const originalRunFfmpeg = Record.prototype.runFfmpeg;
	Record.prototype.runFfmpeg = async function runFfmpegAtomically() {
		const target = this.output;
		if (!target) {
			return originalRunFfmpeg.call(this);
		}
		const partial = partialOutputPath(target, options.pid ?? 0);
		this.output = partial;
		try {
			await originalRunFfmpeg.call(this);
		} catch (error) {
			await fsModule.promises.rm(partial, { force: true }).catch(() => {});
			throw error;
		} finally {
			this.output = target;
		}
		try {
			await fsModule.promises.rename(partial, target);
		} catch (error) {
			// The video itself is fine — only the swap onto the target failed (a sync client
			// or a player holding it, a read-only target, ...). Keep the render, name it.
			const failure = new Error(
				`视频已渲染完成，但无法覆盖目标文件（可能被占用或只读），结果保存在：${partial}。`
					+ " The video was rendered, but the target file did not get replaced."
					+ ` The result is at: ${partial}`,
			);
			failure.cause = error;
			failure.partialPath = partial;
			throw failure;
		}
	};
	return Record;
}
