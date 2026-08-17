import { performance } from "node:perf_hooks";

import { collectIndexedHitSchedule } from "../js/audio/scheduler.js";
import { TimingMap } from "../js/core/timing.js";
import { ChartRenderIndex } from "../js/render/chart-index.js";

const EVENT_COUNT = 100_000;
const FRAME_COUNT = 600;
const channels = Array.from({ length: 4 }, (_, id) => ({ id }));
const events = Array.from({ length: EVENT_COUNT }, (_, id) => ({
	id,
	type: id % 11 === 0 ? "hold" : "tap",
	channel: id % channels.length,
	time: [Math.floor(id / 16), id % 16, 16],
	duration: [1, 0, 1],
	x: id % 200 - 100,
	y: id % 100 - 50,
	text: "",
	tipPointSpawnType: id < channels.length ? "chain" : "inherit",
	tipPointSpawnTime: 1,
}));
const project = { channels, events, snappees: [] };
const timing = new TimingMap({ initialBpm: 120 });

const buildStarted = performance.now();
const index = new ChartRenderIndex(project, timing);
const buildMilliseconds = performance.now() - buildStarted;
const frameDurations = [];
let visitedRecords = 0;
for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
	const now = frame * index.maximumTime / FRAME_COUNT;
	const started = performance.now();
	visitedRecords += index.visibleMovableRecords(now).length;
	visitedRecords += index.timelineRecords(now, now + 10).length;
	visitedRecords += index.activeTipGuides(now).length;
	visitedRecords += index.activeDoubleTapPairs(now).length;
	visitedRecords += index.hudHitCount(now) > 0 ? 1 : 0;
	visitedRecords += collectIndexedHitSchedule(index.hitRecords, now, 1, new Set()).length;
	frameDurations.push(performance.now() - started);
}
frameDurations.sort((left, right) => left - right);
const average = frameDurations.reduce((sum, duration) => sum + duration, 0) / frameDurations.length;
const percentile95 = frameDurations[Math.floor(frameDurations.length * 0.95)];
const maximum = frameDurations.at(-1);
const result = {
	events: EVENT_COUNT,
	frames: FRAME_COUNT,
	buildMilliseconds: Number(buildMilliseconds.toFixed(3)),
	averageFrameQueryMilliseconds: Number(average.toFixed(3)),
	percentile95FrameQueryMilliseconds: Number(percentile95.toFixed(3)),
	maximumFrameQueryMilliseconds: Number(maximum.toFixed(3)),
	visitedRecords,
};
console.log(JSON.stringify(result, null, 2));
if (percentile95 >= 10) {
	throw new Error(`Render-index CPU p95 exceeded 10 ms: ${percentile95.toFixed(3)} ms.`);
}
