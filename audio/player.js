import { decodeAudioBytes } from "./decoder.js";
import { HIT_SOUND_TYPES } from "./scheduler.js";
import { WaveformPeaks } from "./waveform.js";

function audioFormatHint(file) {
	const extension = String(file?.name || "").split(".").pop()?.toLowerCase();
	if (extension === "m4a" || extension === "mp4") return "m4a";
	if (extension === "aac") return "aac";
	const mimeType = String(file?.type || "").toLowerCase();
	if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
	if (mimeType.includes("aac")) return "aac";
	return "";
}

export function sunniesnowHitSample(type, time) {
	const value = Math.max(0, Number(time) || 0);
	if (type === "drag") {
		return 0.45 * Math.sin(2 * Math.PI * 0.0008 / (value + 0.006) ** 2) * Math.exp(-35 * value);
	}
	if (type === "flick") {
		return Math.sin(2 * Math.PI * 0.15 / (value + 0.006)) * Math.exp(-40 * value);
	}
	return (
		0.4 * Math.sin(2 * Math.PI * 0.1 / (value + 0.005))
		+ 0.6 * Math.sin(2 * Math.PI * 0.12 / (value + 0.01))
	) * Math.exp(-40 * value);
}

export function createSunniesnowHitSamples(type, sampleRate, duration = 0.3) {
	const result = new Float32Array(Math.floor(duration * sampleRate));
	for (let index = 0; index < result.length; index += 1) {
		result[index] = sunniesnowHitSample(type, index / sampleRate);
	}
	return result;
}

export class AudioPlayer extends EventTarget {
	constructor() {
		super();
		this.context = null;
		this.buffer = null;
		this.source = null;
		this.gain = null;
		this.waveform = null;
		this.objectUrl = null;
		this.filename = "";
		this.playing = false;
		this.rate = 1;
		this.position = 0;
		this.startedAt = 0;
		this.startedPosition = 0;
		this.syntheticEnd = 10;
		this.animationFrame = 0;
		this.hitSources = new Set();
		this.hitBuffers = new Map();
		this.lastEffectBeat = -Infinity;
	}

	get duration() {
		return this.buffer?.duration || this.syntheticEnd;
	}

	get currentTime() {
		if (!this.playing || !this.context) return this.position;
		return this.startedPosition + (this.context.currentTime - this.startedAt) * this.rate;
	}

	async ensureContext() {
		if (!this.context) {
			const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
			if (!AudioContext) return null;
			this.context = new AudioContext({ latencyHint: "interactive" });
			this.gain = this.context.createGain();
			this.gain.gain.value = 1;
			this.gain.connect(this.context.destination);
		}
		if (this.context.state === "suspended") await this.context.resume();
		return this.context;
	}

	async load(file) {
		await this.stop();
		const context = await this.ensureContext();
		if (!context) throw new Error("Web Audio is not supported by this browser.");
		const bytes = await file.arrayBuffer();
		this.buffer = await decodeAudioBytes(bytes, context, {
			format: audioFormatHint(file),
			mimeType: file.type,
			sourceName: file.name,
		});
		this.waveform = WaveformPeaks.fromAudioBuffer(this.buffer);
		if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
		this.objectUrl = URL.createObjectURL(file);
		this.filename = file.name;
		this.position = 0;
		this.dispatchEvent(new CustomEvent("load", { detail: { file, duration: this.duration } }));
		this.#emitTime();
		return this.buffer;
	}

	async unload() {
		await this.stop();
		this.buffer = null;
		this.waveform = null;
		this.filename = "";
		this.syntheticEnd = 10;
		if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
		this.objectUrl = null;
		this.#emitTime();
	}

	setRate(rate) {
		const nextRate = Math.max(0.1, Math.min(4, Number(rate) || 1));
		const wasPlaying = this.playing;
		const time = this.currentTime;
		if (wasPlaying) this.#stopSource();
		this.#stopHitSources();
		this.position = time;
		this.rate = nextRate;
		if (wasPlaying) this.#startSource();
		this.dispatchEvent(new CustomEvent("ratechange", { detail: nextRate }));
	}

	seek(seconds) {
		const provided = Number(seconds);
		const nextTime = Math.min(this.duration, Number.isFinite(provided) ? provided : 0);
		const wasPlaying = this.playing;
		if (wasPlaying) this.#stopSource();
		this.#stopHitSources();
		this.position = nextTime;
		if (wasPlaying) this.#startSource();
		this.dispatchEvent(new CustomEvent("seek", { detail: nextTime }));
		this.#emitTime();
	}

	async play() {
		if (this.playing) return;
		await this.ensureContext();
		this.playing = true;
		if (this.position >= this.duration) this.position = 0;
		this.#startSource();
		this.dispatchEvent(new Event("play"));
		this.#tick();
	}

	pause() {
		if (!this.playing) {
			this.#stopHitSources();
			return;
		}
		this.position = Math.min(this.duration, this.currentTime);
		this.playing = false;
		this.#stopSource();
		this.#stopHitSources();
		cancelAnimationFrame(this.animationFrame);
		this.dispatchEvent(new Event("pause"));
		this.#emitTime();
	}

	async stop() {
		this.pause();
		this.position = 0;
		this.#emitTime();
	}

	#startSource() {
		if (!this.context) return;
		this.startedAt = this.context.currentTime;
		this.startedPosition = this.position;
		if (!this.buffer) return;
		const source = this.context.createBufferSource();
		source.buffer = this.buffer;
		source.playbackRate.value = this.rate;
		source.connect(this.gain);
		source.onended = () => {
			if (this.source !== source || !this.playing) return;
			if (this.currentTime >= this.duration - 0.01) {
				this.position = this.duration;
				this.playing = false;
				this.source = null;
				cancelAnimationFrame(this.animationFrame);
				this.dispatchEvent(new Event("ended"));
				this.#emitTime();
			}
		};
		const startAt = this.context.currentTime + Math.max(0, -this.position / this.rate);
		const offset = Math.min(Math.max(0, this.position), Math.max(0, this.buffer.duration - 0.001));
		source.start(startAt, offset);
		this.source = source;
	}

	#stopSource() {
		if (!this.source) return;
		this.source.onended = null;
		try { this.source.stop(); } catch { /* Already stopped. */ }
		this.source.disconnect();
		this.source = null;
	}

	#stopHitSources() {
		for (const record of this.hitSources) {
			record.source.onended = null;
			try { record.source.stop(); } catch { /* Already stopped. */ }
			record.source.disconnect();
			record.gain.disconnect();
		}
		this.hitSources.clear();
	}

	#tick = () => {
		if (!this.playing) return;
		if (!this.buffer && this.currentTime >= this.syntheticEnd) {
			this.position = this.syntheticEnd;
			this.playing = false;
			this.dispatchEvent(new Event("ended"));
			this.#emitTime();
			return;
		}
		this.#emitTime();
		this.animationFrame = requestAnimationFrame(this.#tick);
	};

	#emitTime() {
		this.dispatchEvent(new CustomEvent("timeupdate", { detail: this.currentTime }));
	}

	async playHit(type = "tap", delay = 0) {
		if (!HIT_SOUND_TYPES.has(type)) return null;
		const context = await this.ensureContext();
		if (!context) return null;
		const time = context.currentTime + Math.max(0, Number(delay) || 0);
		const sampleType = type === "hold" ? "tap" : type;
		if (!this.hitBuffers.has(sampleType)) {
			const buffer = context.createBuffer(1, Math.floor(0.3 * context.sampleRate), context.sampleRate);
			buffer.copyToChannel(createSunniesnowHitSamples(sampleType, context.sampleRate), 0);
			this.hitBuffers.set(sampleType, buffer);
		}
		const source = context.createBufferSource();
		const gain = context.createGain();
		source.buffer = this.hitBuffers.get(sampleType);
		gain.gain.setValueAtTime(1, context.currentTime);
		source.connect(gain);
		gain.connect(context.destination);
		const record = { source, gain };
		this.hitSources.add(record);
		source.onended = () => {
			this.hitSources.delete(record);
			source.disconnect();
			gain.disconnect();
		};
		source.start(time);
		return record;
	}

	destroy() {
		this.pause();
		this.#stopHitSources();
		if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
		this.objectUrl = null;
		this.context?.close();
		this.context = null;
		this.hitBuffers.clear();
	}
}
