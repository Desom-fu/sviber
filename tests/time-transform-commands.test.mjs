import assert from "node:assert/strict";
import test from "node:test";
import { withAttachment } from "../js/app/app-attachment.js";
import { withTimeDilation } from "../js/app/app-time-dilation.js";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { withEventTools } from "../js/app/app-event-tools.js";
import { ChartModel } from "../js/core/chart-model.js";
import { Rational } from "../js/core/rational.js";

// The Transform menu time tools: move forward/backward by one beat subdivision, time
// dilation around the earliest selected event with an optional duration-preserving mode,
// and reversing the selection in time (t becomes m + M - t).
function makeApp(model) {
	const App = withEventTools(withAttachment(withTimeDilation(withEventEditing(class {}))));
	const app = new App();
	app.model = model;
	app.commit = (label, mutation) => mutation(model);
	app.currentBeat = () => Rational.from(model.editor.currentTime);
	app.exitModes = () => {};
	app.dialogs = { form: async () => null };
	return app;
}

function timeOf(event) {
	return Rational.from(event.time).toNumber();
}

function modelWith(events) {
	return new ChartModel({
		editor: { subdivision: 2, currentChannel: 0 },
		channels: [{ id: 0, name: "Main", active: true }],
		events,
	});
}

test("move forward and backward shift selected events by one subdivision", () => {
	const model = modelWith([
		{ id: 1, type: "tap", channel: 0, time: [3, 0, 1], x: 0, y: 0, selected: true },
		{ id: 2, type: "tap", channel: 0, time: [4, 1, 2], x: 10, y: 0, selected: false },
	]);
	const app = makeApp(model);
	app.moveSelectedInTime(1);
	assert.equal(timeOf(model.events[0]), 3.5);
	app.moveSelectedInTime(-1);
	assert.equal(timeOf(model.events[0]), 3);
	// Locked events and unselected events never move.
	model.events[0].locked = true;
	app.moveSelectedInTime(1);
	assert.equal(timeOf(model.events[0]), 3);
	assert.equal(timeOf(model.events[1]), 4.5);
});

test("time dilation scales times around the earliest selected event", () => {
	const model = modelWith([
		{ id: 1, type: "hold", channel: 0, time: [1, 0, 1], duration: [2, 0, 1], x: 0, y: 0, selected: true },
		{ id: 2, type: "tap", channel: 0, time: [3, 0, 1], x: 10, y: 0, selected: true },
	]);
	const app = makeApp(model);
	// Doubling around the origin at beat 1: beat 3 goes to beat 5, and the two-beat hold
	// doubles to four beats.
	app._dilateSelection(model, Rational.from(2), false);
	assert.deepEqual(model.events.map(timeOf), [1, 5]);
	assert.deepEqual(model.events[0].duration, [4, 0, 1]);
});

test("time dilation can preserve durations while scaling positions", () => {
	const model = modelWith([
		{ id: 1, type: "hold", channel: 0, time: [1, 0, 1], duration: [2, 0, 1], x: 0, y: 0, selected: true },
	]);
	const app = makeApp(model);
	app._dilateSelection(model, Rational.from(2), true);
	assert.deepEqual(model.events.map(timeOf), [1]);
	assert.deepEqual(model.events[0].duration, [2, 0, 1]);
});

test("reverse in time mirrors selected events between their earliest and latest", () => {
	const model = modelWith([
		{ id: 1, type: "tap", channel: 0, time: [1, 0, 1], x: 0, y: 0, selected: true },
		{ id: 2, type: "tap", channel: 0, time: [4, 0, 1], x: 10, y: 0, selected: true },
		{ id: 3, type: "tap", channel: 0, time: [9, 0, 1], x: 20, y: 0, selected: false },
	]);
	const app = makeApp(model);
	app.reverseSelectedTime();
	// m = 1 and M = 4 over the selection only; the unselected event stays at beat 9.
	assert.deepEqual(model.events.slice(0, 2).map(timeOf), [4, 1]);
	assert.equal(timeOf(model.events[2]), 9);
});

test("time translation shifts every selected event by the given beat offset", async () => {
	const model = modelWith([
		{ id: 1, type: "tap", channel: 0, time: [1, 0, 1], x: 0, y: 0, selected: true },
	]);
	const app = makeApp(model);
	app.dialogs = { form: async () => ({ offset: [2, 1, 2] }) };
	await app.showTimeTranslationDialog();
	assert.equal(timeOf(model.events[0]), 3.5);
});
