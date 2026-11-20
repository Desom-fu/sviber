import assert from "node:assert/strict";
import test from "node:test";
import { ChartModel } from "../js/core/chart-model.js";
import {
	convertBackslashEscapes,
	eventTextsToString,
	stringToEventTexts,
	bulkEditableEventsInChannel,
} from "../js/core/bulk-edit-texts.js";

test("channel bulk edit round-trips movable and unmovable texts in beat order", () => {
	const model = ChartModel.createDefault();
	const big = model.addEvent("bigText", { time: [1, 1, 2], text: "hello", duration: [1, 0, 1] });
	const tap = model.addEvent("tap", { time: [1, 1, 3], text: "a b", x: 0, y: 0 });
	const hold = model.addEvent("hold", { time: [1, 1, 3], text: "x", duration: [1, 0, 1], x: 0, y: 0 });
	const encoded = eventTextsToString(bulkEditableEventsInChannel(model, 0));
	assert.equal(encoded, "a\\sb x\nhello");
	stringToEventTexts("p q\nworld", bulkEditableEventsInChannel(model, 0));
	assert.equal(tap.text, "p");
	assert.equal(hold.text, "q");
	assert.equal(big.text, "world");
	assert.equal(convertBackslashEscapes("a\\sb"), "a b");
	assert.deepEqual(model.events.map(event => event.id), [big.id, tap.id, hold.id]);
});

test("bulk edit texts ignore leftover tokens and clear missing ones", () => {
	const events = [{ type: "tap", text: "a" }, { type: "tap", text: "b" }];
	stringToEventTexts("only", events);
	assert.equal(events[0].text, "only");
	assert.equal(events[1].text, "");
});
