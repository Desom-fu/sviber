import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import {
	AUDIO_DECODE_CDN_URL,
	AudioDecodeError,
	decodeAudioBytes,
	isNwRuntime,
	resolveAudioDecode,
} from "../audio/decoder.js";
import { AudioPlayer, createSunniesnowHitSamples } from "../audio/player.js";
import { collectHitSchedule, collectHoldReleaseSchedule } from "../audio/scheduler.js";
import { TimingMap } from "../js/core/timing.js";
import { ChartModel } from "../js/core/chart-model.js";
import { AutosaveManager } from "../js/platform.js";

function wavBytes(sampleRate = 8000, sampleCount = 800) {
	const buffer = new ArrayBuffer(44 + sampleCount * 2);
	const view = new DataView(buffer);
	const text = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
	text(0, "RIFF");
	view.setUint32(4, 36 + sampleCount * 2, true);
	text(8, "WAVE");
	text(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	text(36, "data");
	view.setUint32(40, sampleCount * 2, true);
	for (let index = 0; index < sampleCount; index += 1) {
		view.setInt16(44 + index * 2, Math.round(Math.sin(index / 8) * 16000), true);
	}
	return buffer;
}

function fakeAudioContext() {
	return {
		createBuffer(channelCount, length, sampleRate) {
			const channels = Array.from({ length: channelCount }, () => new Float32Array(length));
			return {
				numberOfChannels: channelCount,
				length,
				sampleRate,
				duration: length / sampleRate,
				copyToChannel(source, index) { channels[index].set(source); },
				getChannelData(index) { return channels[index]; },
			};
		},
	};
}

test("audio-decode uses the versioned CDN on web and the bundled module in NW.js", async () => {
	assert.equal(isNwRuntime({}), false);
	assert.equal(isNwRuntime({ process: { versions: { nw: "0.114.2" } } }), true);
	let importedUrl = "";
	const webDecoder = () => {};
	assert.equal(await resolveAudioDecode({
		nw: false,
		importModule: async url => {
			importedUrl = url;
			return { default: webDecoder };
		},
	}), webDecoder);
	assert.equal(importedUrl, AUDIO_DECODE_CDN_URL);

	let nwUrl = "";
	const decoder = await resolveAudioDecode({
		nw: {},
		importModule: async url => {
			nwUrl = String(url);
			return import("audio-decode");
		},
	});
	assert.match(nwUrl, /audio-decode\.bundle\.js$/);
	const decoded = await decoder(new Uint8Array(wavBytes()));
	assert.equal(decoded.sampleRate, 8000);
	assert.equal(decoded.channelData.length, 1);
	assert.ok(decoded.channelData[0].length >= 800);

	const buffer = await decodeAudioBytes(wavBytes(), fakeAudioContext(), { decoder });
	assert.equal(buffer.sampleRate, 8000);
	assert.equal(buffer.numberOfChannels, 1);
	assert.ok(buffer.getChannelData(0).some(sample => sample !== 0));
});

test("audio-decode falls back to native decodeAudioData", async () => {
	const expected = { duration: 2 };
	let nativeCalls = 0;
	const context = {
		decodeAudioData: async () => {
			nativeCalls += 1;
			return expected;
		},
	};
	const result = await decodeAudioBytes(new Uint8Array([1, 2, 3]), context, {
		decoder: async () => { throw new Error("unsupported by audio-decode"); },
	});
	assert.equal(result, expected);
	assert.equal(nativeCalls, 1);
});

test("audio-decode honors an explicit M4A format hint", async () => {
	let genericCalls = 0;
	let m4aCalls = 0;
	const decoder = async () => {
		genericCalls += 1;
		throw new Error("generic decoder should not run");
	};
	decoder.m4a = async () => {
		m4aCalls += 1;
		return { channelData: [new Float32Array([0.25, -0.25])], sampleRate: 44100 };
	};
	const buffer = await decodeAudioBytes(new Uint8Array([1, 2, 3]), fakeAudioContext(), {
		decoder,
		format: "m4a",
	});
	assert.equal(genericCalls, 0);
	assert.equal(m4aCalls, 1);
	assert.equal(buffer.sampleRate, 44100);
});

test("audio decode failures retain and log both underlying errors", async () => {
	const decoderError = new Error("AAC decoder rejected the MP4 sample table");
	const nativeError = new DOMException("Unable to decode audio data", "EncodingError");
	const logged = [];
	const logger = { error(...values) { logged.push(values); } };
	await assert.rejects(
		decodeAudioBytes(new Uint8Array([1, 2, 3]), {
			decodeAudioData: async () => { throw nativeError; },
		}, {
			decoder: async () => { throw decoderError; },
			logger,
			mimeType: "audio/mp4",
			sourceName: "problem.m4a",
		}),
		error => {
			assert.ok(error instanceof AudioDecodeError);
			assert.equal(error.cause, decoderError);
			assert.deepEqual(error.errors, [decoderError, nativeError]);
			assert.match(error.message, /problem\.m4a/);
			assert.match(error.message, /AAC decoder rejected the MP4 sample table/);
			assert.match(error.message, /EncodingError: Unable to decode audio data/);
			return true;
		},
	);
	assert.equal(logged.length, 2);
	assert.equal(logged[0][1], decoderError);
	assert.equal(logged[1][1], nativeError);
});

test("hit scheduling looks ahead in wall-clock time and excludes bgNote", () => {
	const events = [
		{ id: 1, type: "tap", time: 0.1 },
		{ id: 2, type: "hold", time: 0.2 },
		{ id: 3, type: "drag", time: 0.25 },
		{ id: 4, type: "flick", time: 0.3 },
		{ id: 5, type: "bgNote", time: 0.15 },
	];
	const timing = { beatToSeconds: value => Number(value) };
	const schedule = collectHitSchedule(events, timing, 0.1, 2, new Set());
	assert.deepEqual(schedule.map(({ event }) => event.id), [1, 2, 3, 4]);
	assert.deepEqual(schedule.map(({ delay }) => Number(delay.toFixed(3))), [0, 0.05, 0.075, 0.1]);
	assert.deepEqual(collectHitSchedule(events, timing, 0.1, 2, new Set([2])).map(({ event }) => event.id), [1, 3, 4]);
});

test("hold release FX scheduling uses the duration without scheduling another sound", () => {
	const events = [
		{ id: 1, type: "hold", time: 1, duration: 2 },
		{ id: 2, type: "tap", time: 2, duration: 1 },
	];
	const timing = new TimingMap({ initialBpm: 60, bpmChanges: [{ time: 2, bpm: 120 }] });
	const schedule = collectHoldReleaseSchedule(events, timing, 2.35, 2, new Set());
	assert.deepEqual(schedule.map(({ event }) => event.id), [1]);
	assert.deepEqual(schedule.map(({ delay }) => Number(delay.toFixed(3))), [0.075]);
	assert.deepEqual(collectHoldReleaseSchedule(events, timing, 2.35, 2, new Set([1])), []);
});

test("AudioPlayer preserves negative pre-roll and schedules the music source at time zero", async () => {
	const starts = [];
	const context = {
		currentTime: 5,
		state: "running",
		destination: {},
		createBufferSource() {
			return {
				playbackRate: { value: 1 },
				connect() {}, disconnect() {}, stop() {},
				start(...args) { starts.push(args); },
			};
		},
	};
	const previousRequest = globalThis.requestAnimationFrame;
	const previousCancel = globalThis.cancelAnimationFrame;
	globalThis.requestAnimationFrame = () => 1;
	globalThis.cancelAnimationFrame = () => {};
	try {
		const player = new AudioPlayer();
		player.context = context;
		player.gain = {};
		player.buffer = { duration: 10 };
		player.rate = 2;
		player.seek(-2);
		await player.play();
		assert.deepEqual(starts, [[6, 0]]);
		assert.equal(player.currentTime, -2);
		context.currentTime = 5.5;
		assert.equal(player.currentTime, -1);
		player.pause();
		assert.equal(player.position, -1);
		assert.equal(await player.playHit("bgNote"), null);
	} finally {
		globalThis.requestAnimationFrame = previousRequest;
		globalThis.cancelAnimationFrame = previousCancel;
	}
});

test("Sunniesnow hit sample buffers are finite and type-specific", () => {
	const tap = createSunniesnowHitSamples("tap", 8000);
	const drag = createSunniesnowHitSamples("drag", 8000);
	const flick = createSunniesnowHitSamples("flick", 8000);
	assert.equal(tap.length, 2400);
	assert.ok(tap.every(Number.isFinite));
	assert.ok(drag.every(Number.isFinite));
	assert.ok(flick.every(Number.isFinite));
	assert.notDeepEqual([...tap.slice(0, 16)], [...drag.slice(0, 16)]);
	assert.notDeepEqual([...tap.slice(0, 16)], [...flick.slice(0, 16)]);
});

class MemoryStorage {
	constructor() {
		this.values = new Map();
		this.indexFailures = 0;
	}
	getItem(key) { return this.values.get(key) ?? null; }
	removeItem(key) { this.values.delete(key); }
	setItem(key, value) {
		if (key === "sviber.autosaves" && this.indexFailures > 0) {
			this.indexFailures -= 1;
			throw new DOMException("Quota exceeded", "QuotaExceededError");
		}
		this.values.set(key, String(value));
	}
}

test("AutosaveManager evicts the oldest payload when writing its index exceeds quota", () => {
	const storage = new MemoryStorage();
	const manager = new AutosaveManager({ storage });
	const first = manager.save({ revision: 1 });
	storage.indexFailures = 1;
	const second = manager.save({ revision: 2 });
	assert.deepEqual(manager.index, [second]);
	assert.equal(storage.getItem(`sviber.autosave.${first}`), null);
	assert.notEqual(storage.getItem(`sviber.autosave.${second}`), null);
});

test("AutosaveManager lists every recovery newer than the last manual save", () => {
	const storage = new MemoryStorage();
	const manager = new AutosaveManager({ storage });
	const firstModel = ChartModel.createDefault({ metadata: { title: "First" } });
	const secondModel = ChartModel.createDefault({ metadata: { title: "Second" } });
	const first = manager.save(firstModel);
	const second = manager.save(secondModel);
	const recoveries = manager.recoverable();
	assert.deepEqual(recoveries.map(entry => entry.timestamp), [second, first]);
	assert.deepEqual(recoveries.map(entry => entry.model.metadata.title), ["Second", "First"]);
	assert.equal(manager.latestRecoverable().timestamp, second);
});

test("service worker returns Response.error on an uncached offline CDN request", async () => {
	const source = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");
	const listeners = new Map();
	const context = {
		Response,
		URL,
		fetch: async () => { throw new Error("offline"); },
		caches: {
			match: async () => null,
			open: async () => ({ put: async () => {}, addAll: async () => {} }),
			keys: async () => [],
			delete: async () => true,
		},
		self: {
			addEventListener: (type, listener) => listeners.set(type, listener),
			skipWaiting: async () => {},
			clients: { claim: async () => {} },
			location: { href: "https://example.test/sviber/service-worker.js" },
		},
	};
	vm.runInNewContext(`${source}\nglobalThis.testStaleWhileRevalidate = staleWhileRevalidate;`, context);
	let installPromise;
	listeners.get("install")({ waitUntil: promise => { installPromise = promise; } });
	await installPromise;
	const response = await context.testStaleWhileRevalidate("https://cdn.jsdelivr.net/npm/missing/+esm");
	assert.equal(response.type, "error");
	assert.match(source, /\.\/audio\/decoder\.js/);
	assert.match(source, /audio-decode@3\.12\.0\/\+esm/);
});

test("new charts are explicitly left dirty", async () => {
	const source = await readFile(new URL("../js/app-file-workflows.js", import.meta.url), "utf8");
	const newChart = source.match(/async newChart\(\) \{([\s\S]*?)\n\tasync showChartProperties/)?.[1] || "";
	assert.match(newChart, /this\.installProject\([\s\S]*?saved: false/);
	assert.doesNotMatch(newChart, /this\.markSaved\(\)/);
});
