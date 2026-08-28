import assert from "node:assert/strict";
import test from "node:test";
import { NDArray } from "../js/core/ndarray.js";
import { AUTO_TIMING_DEFAULTS, runAutoTiming, toMonoSamples } from "../js/dsp/auto-timing.js";
import { nodesToValues, tautString, timingFromDenoisedBeats } from "../js/dsp/beat-denoise.js";
import { computeNovelty } from "../js/dsp/novelty.js";
import { withAutoTiming } from "../js/app/app-auto-timing.js";
import { renderClickTrack, steadyBeatTimes, tempoChangeBeatTimes } from "./auto-timing-signal.mjs";

test("NDArray zeros, get and set", () => {
	const array = NDArray.zeros([2, 3]);
	assert.equal(array.get(0, 0), 0);
	assert.equal(array.get(1, 2), 0);
	array.set(1, 2, 5);
	assert.equal(array.get(1, 2), 5);
	assert.equal(array.get(0, 1), 0);
});

test("energy novelty of an impulse has a peak", () => {
	const sampleRate = 4000;
	const samples = new Float32Array(2000);
	samples[1000] = 1;
	const result = computeNovelty(samples, sampleRate, "energy", {
		windowLength: 256,
		hopSize: 64,
		localAverageWindow: 3,
	});
	let peak = -Infinity;
	let peakIndex = -1;
	for (let index = 0; index < result.novelty.length; index += 1) {
		if (result.novelty[index] > peak) {
			peak = result.novelty[index];
			peakIndex = index;
		}
	}
	assert.ok(peak > 0.5);
	assert.ok(peakIndex > 2);
	assert.ok(peakIndex < result.novelty.length - 2);
});

test("tautString recovers a single BPM from a constant-BPM sequence", () => {
	const beats = Array.from({ length: 8 }, (_, index) => index * 0.5);
	const nodes = tautString(beats, beats, beats);
	const values = nodesToValues(nodes, beats.length);
	const intervals = [];
	for (let index = 1; index < values.length; index += 1) {
		intervals.push(values[index] - values[index - 1]);
	}
	const timing = timingFromDenoisedBeats({ beats: Array.from(values), intervals });
	assert.ok(Math.abs(timing.initialBpm - 120) < 1e-6);
	assert.equal(timing.bpmChanges.length, 0);
});

test("AUTO_TIMING_DEFAULTS use energy novelty, fourier tempogram and plp beats", () => {
	assert.equal(AUTO_TIMING_DEFAULTS.novelty, "energy");
	assert.equal(AUTO_TIMING_DEFAULTS.tempogram, "fourier");
	assert.equal(AUTO_TIMING_DEFAULTS.beat, "plp");
});

// The tests above exercise single stages. These run the whole pipeline over synthesized click
// tracks, which is the only way to tell that automatic timing actually recovers a tempo rather
// than merely returning a well-shaped object.

test("automatic timing recovers the offset and BPM of a synthesized click track", () => {
	for (const bpm of [96, 120, 150]) {
		const offset = 0.37;
		const { samples, sampleRate } = renderClickTrack(steadyBeatTimes(bpm, 48, offset));
		const result = runAutoTiming(samples, sampleRate, {});
		assert.ok(
			Math.abs(result.timing.offset - offset) < 0.02,
			`offset ${result.timing.offset} should be within 20ms of ${offset} at ${bpm} BPM`,
		);
		assert.ok(
			Math.abs(result.timing.initialBpm - bpm) < 0.5,
			`initial BPM ${result.timing.initialBpm} should be within 0.5 of ${bpm}`,
		);
		// The global tempo estimate is independent of the beat tracker, so it is worth its own
		// assertion: a half- or double-tempo estimate is the classic failure here.
		assert.ok(
			Math.abs(result.estimatedTempo - bpm) < 1,
			`estimated tempo ${result.estimatedTempo} should be within 1 of ${bpm}`,
		);
		assert.ok(result.beatCount >= 40, `expected at least 40 tracked beats, got ${result.beatCount}`);
	}
});

test("automatic timing finds a tempo change and reports it as a BPM change", () => {
	const times = tempoChangeBeatTimes(120, 24, 160, 24, 0.25);
	const { samples, sampleRate } = renderClickTrack(times);
	const result = runAutoTiming(samples, sampleRate, {});
	assert.ok(Math.abs(result.timing.offset - 0.25) < 0.02, `offset ${result.timing.offset} should be near 0.25`);
	assert.ok(
		Math.abs(result.timing.initialBpm - 120) < 0.5,
		`initial BPM ${result.timing.initialBpm} should be near 120`,
	);
	assert.ok(result.timing.bpmChanges.length > 0, "a tempo change must produce at least one BPM change");
	// Every reported change should be at the new tempo, and the first of them should land near
	// the point where the click track actually speeds up.
	for (const change of result.timing.bpmChanges) {
		assert.ok(Math.abs(change.bpm - 160) < 2, `BPM change to ${change.bpm} should be near 160`);
	}
	const switchTime = times[24];
	const first = result.timing.bpmChanges[0];
	assert.ok(
		Math.abs(first.time - switchTime) < 1,
		`the first BPM change at ${first.time} should be within a second of ${switchTime}`,
	);
});

test("automatic timing keeps its result when the audio is stereo or the tempo is offbeat", () => {
	const times = steadyBeatTimes(132, 40, 0.11);
	const { samples, sampleRate } = renderClickTrack(times);
	// A stereo buffer with one silent channel halves every sample, so down-mixing has to happen
	// before analysis for the result to match the mono run.
	const silent = new Float32Array(samples.length);
	const mono = toMonoSamples([samples, silent], samples.length);
	const doubled = Float32Array.from(mono, value => value * 2);
	const fromMono = runAutoTiming(samples, sampleRate, {});
	const fromStereo = runAutoTiming(doubled, sampleRate, {});
	assert.ok(Math.abs(fromMono.timing.initialBpm - 132) < 0.5, `mono BPM ${fromMono.timing.initialBpm} near 132`);
	const stereoBpm = fromStereo.timing.initialBpm;
	assert.ok(Math.abs(stereoBpm - 132) < 0.5, `stereo BPM ${stereoBpm} near 132`);
	assert.ok(Math.abs(fromMono.timing.offset - fromStereo.timing.offset) < 0.01);
});

test("automatic timing runs in this thread when no Worker is available", async t => {
	// The NW.js build loads the app from a `file:` base where a module worker cannot be
	// constructed, so the in-thread fallback is the path desktop users actually take.
	const App = withAutoTiming(class {});
	const app = new App();
	const original = globalThis.Worker;
	delete globalThis.Worker;
	t.after(() => {
		if (original) {
			globalThis.Worker = original;
		}
	});
	const { samples, sampleRate } = renderClickTrack(steadyBeatTimes(120, 32, 0.2));
	const result = await app.runAutoTimingAnalysis(samples, sampleRate, {});
	assert.ok(Math.abs(result.timing.initialBpm - 120) < 0.5);
	assert.ok(Math.abs(result.timing.offset - 0.2) < 0.02);
});

test("automatic timing falls back to this thread when the worker cannot start", async t => {
	const App = withAutoTiming(class {});
	const app = new App();
	const original = globalThis.Worker;
	// A worker constructor that throws is exactly what a `file:` base URL produces.
	globalThis.Worker = function BrokenWorker() {
		throw new Error("Failed to construct 'Worker'");
	};
	const warnings = [];
	const originalWarn = console.warn;
	console.warn = (...args) => warnings.push(args);
	t.after(() => {
		console.warn = originalWarn;
		if (original) {
			globalThis.Worker = original;
		} else {
			delete globalThis.Worker;
		}
	});
	const { samples, sampleRate } = renderClickTrack(steadyBeatTimes(120, 32, 0.2));
	const result = await app.runAutoTimingAnalysis(samples, sampleRate, {});
	assert.ok(Math.abs(result.timing.initialBpm - 120) < 0.5);
	assert.equal(warnings.length, 1);
});

test("a worker that reports an ErrorEvent still produces a result", async t => {
	const App = withAutoTiming(class {});
	const app = new App();
	const original = globalThis.Worker;
	// Before v18 the rejection stringified an ErrorEvent to "[object ErrorEvent]" and the
	// analysis was abandoned; now the message is reported and the pipeline runs locally.
	globalThis.Worker = class FailingWorker {
		constructor() {
			this.listeners = new Map();
		}

		addEventListener(type, listener) {
			this.listeners.set(type, listener);
		}

		postMessage() {
			this.listeners.get("error")?.({ message: "Cannot load module script" });
		}

		terminate() {}
	};
	const warnings = [];
	const originalWarn = console.warn;
	console.warn = (...args) => warnings.push(args);
	t.after(() => {
		console.warn = originalWarn;
		if (original) {
			globalThis.Worker = original;
		} else {
			delete globalThis.Worker;
		}
	});
	const { samples, sampleRate } = renderClickTrack(steadyBeatTimes(120, 32, 0.2));
	const result = await app.runAutoTimingAnalysis(samples, sampleRate, {});
	assert.ok(Math.abs(result.timing.initialBpm - 120) < 0.5);
	assert.match(String(warnings[0]?.[1]?.message ?? ""), /Cannot load module script/);
});
