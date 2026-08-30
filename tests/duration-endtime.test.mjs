import assert from "node:assert/strict";
import test from "node:test";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { ChartModel } from "../js/core/chart-model.js";

// The inspection panel's duration and end-time linkage: every duration-bearing type also
// exposes an end time equal to time + duration, the end time cannot precede the time
// (nor equal it for types that require a nonzero duration), and a bunch edit of the end
// time aligns every selected event by adjusting each duration individually.
function makeApp(model) {
	const App = withEventEditing(class {});
	const app = new App();
	app.model = model;
	app.commit = (label, mutation) => mutation(model);
	app.rememberCreationDefaults = () => {};
	return app;
}

function modelWith(events) {
	return new ChartModel({
		channels: [{ id: 0, name: "Main", active: true }],
		editor: { currentChannel: 0 },
		events,
	});
}

test("setting an end time derives each duration from the event time", () => {
	const model = modelWith([
		{ id: 1, type: "hold", channel: 0, time: [1, 0, 1], duration: [2, 0, 1], x: 0, y: 0, selected: true },
		{ id: 2, type: "bgNote", channel: 0, time: [3, 0, 1], duration: [4, 0, 1], x: 5, y: 5, selected: true },
	]);
	const app = makeApp(model);
	app.editSelectedProperty("endTime", [5, 0, 1]);
	assert.deepEqual(model.events[0].duration, [4, 0, 1]);
	assert.deepEqual(model.events[1].duration, [2, 0, 1]);
});

test("the end time may equal the time only for bgNote and comment", () => {
	const zeroAllowed = modelWith([
		{ id: 1, type: "bgNote", channel: 0, time: [2, 0, 1], duration: [1, 0, 1], x: 0, y: 0, selected: true },
		{ id: 2, type: "comment", channel: 0, time: [2, 0, 1], duration: [1, 0, 1], text: "x", selected: true },
	]);
	makeApp(zeroAllowed).editSelectedProperty("endTime", [2, 0, 1]);
	assert.deepEqual(zeroAllowed.events.map(event => event.duration), [[0, 0, 1], [0, 0, 1]]);

	const rejected = modelWith([
		{ id: 1, type: "hold", channel: 0, time: [2, 0, 1], duration: [1, 0, 1], x: 0, y: 0, selected: true },
	]);
	makeApp(rejected).editSelectedProperty("endTime", [2, 0, 1]);
	// The refusal leaves the original duration untouched.
	assert.deepEqual(rejected.events[0].duration, [1, 0, 1]);
});

test("the end time cannot move before the event time", () => {
	const model = modelWith([
		{ id: 1, type: "hold", channel: 0, time: [4, 0, 1], duration: [1, 0, 1], x: 0, y: 0, selected: true },
	]);
	const app = makeApp(model);
	app.editSelectedProperty("endTime", [3, 0, 1]);
	assert.deepEqual(model.events[0].duration, [1, 0, 1]);
});

test("editing the duration keeps it nonzero for hold and allows zero for bgNote", () => {
	const model = modelWith([
		{ id: 1, type: "hold", channel: 0, time: [0, 0, 1], duration: [1, 0, 1], x: 0, y: 0, selected: true },
		{ id: 2, type: "bgNote", channel: 0, time: [0, 0, 1], duration: [1, 0, 1], x: 5, y: 5, selected: true },
	]);
	const app = makeApp(model);
	app.editSelectedProperty("duration", [0, 0, 1]);
	assert.deepEqual(model.events[0].duration, [1, 0, 1]);
	assert.deepEqual(model.events[1].duration, [0, 0, 1]);
});
