import assert from "node:assert/strict";
import test from "node:test";
import { ChartModel } from "../js/core/chart-model.js";
import {
	clearTipPointSwitch,
	hasTipPointSwitches,
	normalizeTipPointSwitches,
	packTracksIntoChannels,
	permutationImages,
	switchedChannelsAt,
	tipPointTrackEvents,
	writeTipPointSwitch,
} from "../js/core/tip-point-track.js";
import { inheritedTipPointSource } from "../js/core/tip-point.js";
import { buildTipPointGuides } from "../js/render/stage-helpers.js";
import { TimingMap } from "../js/core/timing.js";

test("tipPointSwitches persist only when the permutation image differs", () => {
	assert.deepEqual(normalizeTipPointSwitches([{ time: [4, 0, 1], target: 0 }], 0), []);
	assert.equal(normalizeTipPointSwitches([{ time: [4, 0, 1], target: 2 }], 1)[0].target, 2);
});

test("a tip point track follows channel permutations across switches", () => {
	const model = ChartModel.createDefault();
	model.addChannel(1);
	model.addEvent("tap", { time: [0, 0, 1], channel: 0, x: 0, y: 0, tipPointSpawnType: "chain" });
	model.addEvent("tap", { time: [8, 0, 1], channel: 1, x: 10, y: 0, tipPointSpawnType: "inherit" });
	writeTipPointSwitch(model.channels, [4, 0, 1], [1, 0]);
	const track = tipPointTrackEvents(model, 0);
	assert.equal(track.length, 2);
	assert.equal(track[0].channel, 0);
	assert.equal(track[1].channel, 1);
	assert.equal(inheritedTipPointSource(model.events, track[1], model)?.channel, 0);
	const guides = buildTipPointGuides(model, new TimingMap(model.timing));
	assert.equal(guides.length, 1);
	assert.equal(guides[0].events.length, 2);
});

test("writing an identity permutation deletes the switch", () => {
	const model = ChartModel.createDefault();
	model.addChannel(1);
	writeTipPointSwitch(model.channels, [2, 0, 1], [1, 0]);
	assert.equal(hasTipPointSwitches(model), true);
	assert.equal(switchedChannelsAt(model.channels, [2, 0, 1]).length, 2);
	clearTipPointSwitch(model.channels, [2, 0, 1]);
	assert.equal(hasTipPointSwitches(model), false);
	assert.deepEqual(permutationImages(model.channels, [2, 0, 1]), [0, 1]);
});

test("packing tracks assigns channels and can insert a switch", () => {
	const model = ChartModel.createDefault();
	const early = model.addEvent("tap", { time: [0, 0, 1], x: 0, y: 0 });
	const lateA = model.addEvent("tap", { time: [4, 0, 1], x: 1, y: 0 });
	const lateB = model.addEvent("tap", { time: [4, 0, 1], x: 2, y: 0 });
	early._importSequence = 0;
	lateA._importSequence = 2;
	lateB._importSequence = 1;
	packTracksIntoChannels(model, [{ events: [early, lateA] }, { events: [lateB] }]);
	assert.ok(model.channels.length >= 2);
	assert.notEqual(lateA.channel, lateB.channel);
});
