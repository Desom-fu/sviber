import { decodeAudioBytes } from "./decoder.js";
import { HIT_SOUND_TYPES } from "./scheduler.js";
import { WaveformPeaks } from "./waveform.js";

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
		this.seGain = null;
		this.musicVolume = 1;
		this.seVolume = 1;
		this.waveform = null;
		this.objectUrl = null;
		this.filename = "";
		this.playing = false;
		this.direction = 1;
		this.rate = 1;
		this.position = 0;
		this.startedAt = 0;
		this.startedPosition = 0;
		this.syntheticStart = 0;
		this.syntheticEnd = 10;
		this.animationFrame = 0;
		this.loopRange = null;
		this.lastLoopCycle = 0;
		this.hitSources = new Set();
		this.hitBuffers = new Map();
		this.lastEffectBeat = -Infinity;
		this.playbackGeneration = 0;
		this.contextResumePromise = null;
	}

	get duration() {
		return this.buffer?.duration || this.syntheticEnd;
	}

	get currentTime() {
		if (!this.playing || !this.context) return this.position;
		return this.#playbackPosition().time;
	}

	#playbackPosition() {
		const elapsed = Math.max(0, this.context.currentTime - this.startedAt) * this.rate;
		const raw = this.startedPosition + elapsed * this.direction;
		if (!this.loopRange) return { time: raw, cycle: 0 };
		const [beginning, end] = this.loopRange;
		const span = end - beginning;
		if (this.direction > 0 && raw >= end) {
			const cycle = Math.floor((raw - beginning) / span);
			return { time: beginning + ((raw - beginning) % span + span) % span, cycle };
		}
		if (this.direction < 0 && raw < beginning) {
			const cycle = Math.ceil((beginning - raw) / span);
			const distance = ((beginning - raw) % span + span) % span;
			return { time: distance === 0 ? end : end - distance, cycle };
		}
		return { time: raw, cycle: 0 };
	}

	async ensureContext() {
		if (!this.context) {
			const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
			if (!AudioContext) return null;
			this.context = new AudioContext({ latencyHint: "interactive" });
			this.gain = this.context.createGain();
			this.gain.gain.value = this.musicVolume;
			this.gain.connect(this.context.destination);
			this.seGain = this.context.createGain();
			this.seGain.gain.value = this.seVolume;
			this.seGain.connect(this.context.destination);
		}
		if (this.context.state === "suspended") {
			this.contextResumePromise ||= Promise.resolve(this.context.resume()).finally(() => {
				this.contextResumePromise = null;
			});
			await this.contextResumePromise;
		}
		return this.context;
	}

	async load(file) {
		await this.stop();
		const context = await this.ensureContext();
		if (!context) throw new Error("Web Audio is not supported by this browser.");
		const bytes = await file.arrayBuffer();
		this.buffer = await decodeAudioBytes(bytes, context, {
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
		this.playbackGeneration += 1;
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

	setMusicVolume(volume) {
		this.musicVolume = Math.max(0, Math.min(1, Number(volume) || 0));
		if (this.gain) this.gain.gain.value = this.musicVolume;
	}

	setSeVolume(volume) {
		this.seVolume = Math.max(0, Math.min(1, Number(volume) || 0));
		if (this.seGain) this.seGain.gain.value = this.seVolume;
	}

	setLoopRange(range) {
		this.playbackGeneration += 1;
		const values = Array.isArray(range) ? range.map(Number) : [];
		const next = values.length === 2 && values.every(Number.isFinite) && values[1] > values[0]
			? [values[0], values[1]] : null;
		if (JSON.stringify(next) === JSON.stringify(this.loopRange)) return;
		const wasPlaying = this.playing;
		const time = this.currentTime;
		if (wasPlaying) this.#stopSource();
		this.loopRange = next;
		this.position = time;
		this.lastLoopCycle = 0;
		if (wasPlaying) this.#startSource();
	}

	seek(seconds) {
		this.playbackGeneration += 1;
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

	async #playDirection(direction) {
		const nextDirection = direction < 0 ? -1 : 1;
		if (this.playing && this.direction === nextDirection) return;
		const generation = ++this.playbackGeneration;
		const context = await this.ensureContext();
		if (!context || generation !== this.playbackGeneration) return;
		const wasPlaying = this.playing;
		if (wasPlaying) {
			this.position = this.currentTime;
			this.#stopSource();
			this.#stopHitSources();
		}
		this.direction = nextDirection;
		this.playing = true;
		if (this.direction > 0 && this.position >= this.duration) this.position = 0;
		if (this.direction < 0 && this.position <= Math.min(0, this.loopRange?.[0] ?? 0)) {
			this.position = this.loopRange?.[1] ?? this.duration;
		}
		if (this.context) {
			this.startedAt = this.context.currentTime;
			this.startedPosition = this.position;
		}
		if (wasPlaying) {
			this.#startSource();
			this.dispatchEvent(new CustomEvent("directionchange", { detail: this.direction }));
		} else {
			this.dispatchEvent(new CustomEvent("play", { detail: { direction: this.direction } }));
			if (!this.source) this.#startSource({ preserveClock: true });
			this.#tick();
		}
	}

	async play() {
		return this.#playDirection(1);
	}

	async playReverse() {
		return this.#playDirection(-1);
	}

	pause() {
		this.playbackGeneration += 1;
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

	armPlaybackSource() {
		if (!this.playing || !this.context || this.source) return;
		this.#startSource();
	}

	#startSource({ preserveClock = false } = {}) {
		if (!this.context) return;
		if (!preserveClock) {
			this.startedAt = this.context.currentTime;
			this.startedPosition = this.position;
		}
		this.lastLoopCycle = 0;
		if (!this.buffer || this.direction < 0) return;
		const source = this.context.createBufferSource();
		source.buffer = this.buffer;
		source.playbackRate.value = this.rate;
		if (this.loopRange) {
			const maximum = Math.max(0, this.buffer.duration - 0.001);
			const beginning = Math.max(0, Math.min(maximum, this.loopRange[0]));
			const end = Math.max(beginning + 0.001, Math.min(this.buffer.duration, this.loopRange[1]));
			if (end > beginning) {
				source.loop = true;
				source.loopStart = beginning;
				source.loopEnd = end;
			}
		}
		source.connect(this.gain);
		source.onended = () => {
			if (this.source !== source || !this.playing) return;
			if (!source.loop && this.currentTime >= this.duration - 0.01) {
				this.position = this.duration;
				this.playing = false;
				this.source = null;
				cancelAnimationFrame(this.animationFrame);
				this.dispatchEvent(new Event("ended"));
				this.#emitTime();
			}
		};
		const startAt = this.startedAt + Math.max(0, -this.startedPosition / this.rate);
		const offset = Math.min(Math.max(0, this.startedPosition), Math.max(0, this.buffer.duration - 0.001));
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

	#stopHitSources(futureOnly = false) {
		const currentTime = this.context?.currentTime ?? Infinity;
		for (const record of this.hitSources) {
			if (futureOnly && record.startTime <= currentTime) continue;
			record.source.onended = null;
			try { record.source.stop(); } catch { /* Already stopped. */ }
			record.source.disconnect();
			record.gain.disconnect();
			this.hitSources.delete(record);
		}
	}

	#tick = () => {
		if (!this.playing) return;
		const playback = this.#playbackPosition();
		if (playback.cycle !== this.lastLoopCycle) {
			this.lastLoopCycle = playback.cycle;
			this.dispatchEvent(new CustomEvent("loop", { detail: {
				direction: this.direction,
				time: playback.time,
			} }));
		}
		const endedForward = !this.loopRange && this.direction > 0
			&& (!this.buffer && playback.time >= this.syntheticEnd);
		const endedReverse = !this.loopRange && this.direction < 0 && playback.time <= this.syntheticStart;
		if (endedForward || endedReverse) {
			this.position = endedForward ? this.syntheticEnd : this.syntheticStart;
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

	async playHit(type = "tap", delay = 0, scheduledAt = null) {
		if (!HIT_SOUND_TYPES.has(type)) return null;
		if (this.context && this.context.state !== "suspended") return this.#startHit(type, delay, scheduledAt);
		const generation = this.playbackGeneration;
		const context = await this.ensureContext();
		if (!context || generation !== this.playbackGeneration) return null;
		return this.#startHit(type, delay, scheduledAt);
	}

	#startHit(type, delay, scheduledAt) {
		const context = this.context;
		if (!context) return null;
		const requestedTime = scheduledAt == null ? NaN : Number(scheduledAt);
		const time = Number.isFinite(requestedTime)
			? Math.max(context.currentTime, requestedTime)
			: context.currentTime + Math.max(0, Number(delay) || 0);
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
		gain.connect(this.seGain || context.destination);
		const record = { source, gain, startTime: time };
		this.hitSources.add(record);
		source.onended = () => {
			this.hitSources.delete(record);
			source.disconnect();
			gain.disconnect();
		};
		source.start(time);
		return record;
	}

	async playMetronome(delay = 0) {
		const generation = this.playbackGeneration;
		const context = await this.ensureContext();
		if (!context || generation !== this.playbackGeneration || !context.createOscillator || !context.createGain) return null;
		const time = context.currentTime + Math.max(0, Number(delay) || 0);
		const source = context.createOscillator();
		const gain = context.createGain();
		source.type = "square";
		source.frequency.setValueAtTime(400, time);
		gain.gain.setValueAtTime(1, time);
		gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
		source.connect(gain);
		gain.connect(this.seGain || context.destination);
		const record = { source, gain, startTime: time };
		this.hitSources.add(record);
		source.onended = () => {
			this.hitSources.delete(record);
			source.disconnect();
			gain.disconnect();
		};
		source.start(time);
		source.stop(time + 0.05);
		return record;
	}

	playHitAt(type = "tap", audioTime = 0) {
		return this.playHit(type, 0, audioTime);
	}

	cancelHitSounds() {
		this.playbackGeneration += 1;
		this.#stopHitSources();
	}

	cancelScheduledHitSounds() {
		this.playbackGeneration += 1;
		this.#stopHitSources(true);
	}

	destroy() {
		this.playbackGeneration += 1;
		this.pause();
		this.#stopHitSources();
		if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
		this.objectUrl = null;
		this.context?.close();
		this.context = null;
		this.hitBuffers.clear();
	}
}
