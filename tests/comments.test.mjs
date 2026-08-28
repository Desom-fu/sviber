import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ChartModel, createEvent } from "../js/core/chart-model.js";
import { TIMELINE_COMMENT_TEXT_COLOR } from "../js/render/timeline-helpers.js";

function contrastRatio(foreground, background) {
	const luminance = color => {
		const channels = color
			.match(/[0-9a-f]{2}/gi)
			.map(channel => parseInt(channel, 16) / 255)
			.map(channel => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
		return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
	};
	const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
	return (values[0] + 0.05) / (values[1] + 0.05);
}

test("comments and channel state round-trip without leaking into Sunniesnow events", () => {
	const model = new ChartModel({
		channels: [
			{ id: 4, name: "Muted", active: false },
			{ id: 9, name: "Gameplay", active: true },
		],
		snappees: [{ id: 8, type: "rectangularMesh", active: false, selected: true }],
		editor: { currentChannel: 4 },
		events: [
			{ id: 1, type: "tap", channel: 4, time: [0, 0, 1], x: 0, y: 0, selected: true },
			{ id: 2, type: "comment", channel: 4, time: [0, 0, 1], duration: [0, 0, 1], text: "muted note" },
			{ id: 3, type: "tap", channel: 9, time: [1, 0, 1], x: 1, y: 2 },
			{ id: 4, type: "comment", channel: 9, time: [1, 0, 1], duration: [2, 0, 1], text: "active note" },
		],
	});
	assert.equal(model.editor.currentChannel, 9);
	assert.deepEqual(
		model.channels.map(channel => [channel.name, channel.active]),
		[
			["Muted", false],
			["Gameplay", true],
		],
	);
	assert.equal(model.snappees[0].selected, false);
	assert.equal(model.events[0].selected, false);
	assert.deepEqual(createEvent("comment", { duration: [-1, 0, 1] }).duration, [0, 0, 1]);
	assert.equal(
		model.addEvent("comment", {
			channel: 4,
			duration: [1, 0, 1],
			text: "new muted note",
			selected: true,
		}).selected,
		false,
	);
	model.removeEvent(model.events.at(-1).id);

	const document = model.toJSON();
	assert.deepEqual(
		document.events.map(event => event.type),
		["tap"],
	);
	assert.deepEqual(
		document.sviber.events.map(event => event.type),
		["tap", "comment", "tap", "comment"],
	);
	assert.equal(document.sviber.events[3].text, "active note");
	assert.deepEqual(document.sviber.events[3].duration, [2, 0, 1]);
	assert.equal(document.sviber.editor.currentChannel, 9);

	const reopened = ChartModel.import(document);
	assert.deepEqual(reopened.channels, model.channels);
	assert.deepEqual(reopened.events, model.events);
});

test("comment text remains readable on the timeline and status panel", async () => {
	const css = (
		await Promise.all([
			readFile(new URL("../css/themes.css", import.meta.url), "utf8"),
			readFile(new URL("../css/app.css", import.meta.url), "utf8"),
		])
	).join("\n");
	const commentColors = [...css.matchAll(/--comment-text:\s*(#[0-9a-f]{6})/gi)].map(match => match[1]);
	const panelColors = [...css.matchAll(/--panel:\s*(#[0-9a-f]{6})/gi)].map(match => match[1]);
	assert.ok(commentColors.length >= 2);
	assert.equal(commentColors.length, panelColors.length);
	for (const [index, color] of commentColors.entries()) {
		assert.ok(contrastRatio(color, panelColors[index]) >= 7);
	}
	assert.ok(contrastRatio(TIMELINE_COMMENT_TEXT_COLOR, "#090a0c") >= 7);
	assert.match(css, /\.status-comment\s*\{[\s\S]*?color:\s*var\(--comment-text\)/);
});
