import assert from "node:assert/strict";
import test from "node:test";
import { ChartModel } from "../js/core/chart-model.js";
import {
	convertBackslashEscapes,
	eventTextsToString,
	stringToEventTexts,
	bulkEditableEventsInChannel,
} from "../js/core/bulk-edit-texts.js";

test("bulk edit texts round-trip movable and unmovable events", () => {
	const model = ChartModel.createDefault();
	const tap = model.addEvent("tap", { time: [0, 0, 1], text: "a b", x: 0, y: 0 });
	const hold = model.addEvent("hold", { time: [1, 0, 1], text: "x", duration: [1, 0, 1], x: 0, y: 0 });
	const big = model.addEvent("bigText", { time: [2, 0, 1], text: "hello", duration: [1, 0, 1] });
	const encoded = eventTextsToString([tap, hold, big]);
	assert.equal(encoded, "a\\sb x\nhello");
	stringToEventTexts("p q\nworld", [tap, hold, big]);
	assert.equal(tap.text, "p");
	assert.equal(hold.text, "q");
	assert.equal(big.text, "world");
	assert.equal(convertBackslashEscapes("a\\sb"), "a b");
	assert.equal(bulkEditableEventsInChannel(model, 0).length, 3);
});

test("bulk edit texts ignore leftover tokens and clear missing ones", () => {
	const events = [{ type: "tap", text: "a" }, { type: "tap", text: "b" }];
	stringToEventTexts("only", events);
	assert.equal(events[0].text, "only");
	assert.equal(events[1].text, "");
});
