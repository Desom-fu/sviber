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
import { ChartRenderIndex } from "../js/render/chart-index.js";
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

test("incremental note edits keep crossed tip-point tracks without waiting for playback", () => {
	const model = ChartModel.createDefault({
		channels: [{ id: 0 }, { id: 1 }],
		events: [
			{ id: 1, type: "tap", time: [0, 0, 1], channel: 0, x: 0, y: 0, tipPointSpawnType: "chain" },
			{ id: 2, type: "tap", time: [2, 0, 1], channel: 0, x: 10, y: 0, tipPointSpawnType: "inherit" },
			{ id: 3, type: "tap", time: [6, 0, 1], channel: 1, x: 20, y: 10, tipPointSpawnType: "inherit" },
		],
		nextIds: { event: 4, channel: 2 },
	});
	writeTipPointSwitch(model.channels, [4, 0, 1], [1, 0]);
	const index = new ChartRenderIndex(model, model.timing);
	const before = index.tipGuides.find(guide => guide.events.some(event => event.id === 1));
	assert.deepEqual(
		before.events.map(event => event.id),
		[1, 2, 3],
	);
	const revision = index.timelineTipRevision;
	const created = model.addEvent("tap", {
		time: [8, 0, 1],
		channel: 1,
		x: 30,
		y: 10,
		tipPointSpawnType: "inherit",
	});
	assert.equal(index.appendRootEvent(created), true);
	assert.ok(index.timelineTipRevision > revision);
	const after = index.tipGuides.find(guide => guide.events.some(event => event.id === 1));
	assert.deepEqual(
		after.events.map(event => event.id),
		[1, 2, 3, created.id],
	);
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

test("inactive channels contribute no events to a tip point track", () => {
	const model = ChartModel.createDefault();
	model.addChannel(1);
	model.addEvent("tap", { time: [0, 0, 1], channel: 0, x: 0, y: 0, tipPointSpawnType: "chain" });
	model.addEvent("tap", { time: [8, 0, 1], channel: 1, x: 10, y: 0, tipPointSpawnType: "inherit" });
	writeTipPointSwitch(model.channels, [4, 0, 1], [1, 0]);
	assert.equal(tipPointTrackEvents(model, 0).length, 2);
	model.channels[0].active = false;
	const afterFirstInactive = tipPointTrackEvents(model, 0);
	assert.equal(afterFirstInactive.length, 1);
	assert.equal(afterFirstInactive[0].channel, 1);
	model.channels[0].active = true;
	model.channels[1].active = false;
	const afterImageInactive = tipPointTrackEvents(model, 0);
	assert.equal(afterImageInactive.length, 1);
	assert.equal(afterImageInactive[0].channel, 0);
	model.channels[0].active = false;
	assert.equal(tipPointTrackEvents(model, 0).length, 0);
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
