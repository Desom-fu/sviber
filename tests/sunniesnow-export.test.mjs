import assert from "node:assert/strict";
import test from "node:test";
import { exportOrderedEvents } from "../js/app/app-attachment.js";
import { ChartModel } from "../js/core/chart-model.js";
import { DIFFICULTY_COLORS } from "../js/core/chart-vocabulary.js";

function validChart(overrides = {}) {
	const { metadata, ...rest } = overrides;
	return ChartModel.createDefault({
		metadata: {
			title: "Song",
			artist: "Artist",
			charter: "Charter",
			difficultyName: "Master",
			difficultyColor: DIFFICULTY_COLORS.master,
			difficulty: "12",
			difficultySup: "",
			...metadata,
		},
		...rest,
	});
}

function addNote(model, type, beat, x = 0, y = 0, extra = {}) {
	return model.addEvent(type, { time: [beat, 0, 1], x, y, ...extra });
}

test("Sunniesnow export orders active events by channel, time, and timeline stacking", () => {
	const model = ChartModel.createDefault({
		channels: [
			{ id: 10, name: "Top" },
			{ id: 20, name: "Bottom" },
			{ id: 30, active: false },
		],
		events: [
			{ id: 1, type: "tap", channel: 20, time: [0, 0, 1], x: 1, y: 0 },
			{ id: 2, type: "tap", channel: 10, time: [2, 0, 1], x: 2, y: 0 },
			{ id: 3, type: "tap", channel: 10, time: [1, 0, 1], x: 3, y: 0 },
			{ id: 4, type: "tap", channel: 30, time: [0, 0, 1], x: 4, y: 0 },
			{ id: 5, type: "tap", channel: 10, time: [1, 0, 1], x: 5, y: 0 },
		],
	});
	const taps = model.generateSunniesnowEvents().filter(event => event.type === "tap");
	assert.deepEqual(
		taps.map(event => event.properties.x),
		[3, 5, 2, 1],
	);
	assert.equal(
		taps.some(event => event.properties.x === 4),
		false,
	);
});

test("exportOrderedEvents sorts by time, then channel, then stacking order", () => {
	const model = validChart();
	const later = addNote(model, "tap", 2, 0, 0, { channel: 0 });
	const early = addNote(model, "tap", 1, 0, 0, { channel: 0 });
	const lower = model.addChannel();
	const otherChannel = addNote(model, "tap", 2, 1, 0, { channel: lower.id });
	const stacked = addNote(model, "tap", 2, 2, 0, { channel: 0 });
	const ordered = exportOrderedEvents(model, [otherChannel, stacked, later, early]);
	assert.deepEqual(
		ordered.map(event => event.id),
		[early.id, later.id, stacked.id, otherChannel.id],
	);
});
