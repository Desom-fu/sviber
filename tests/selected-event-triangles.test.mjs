import assert from "node:assert/strict";
import test from "node:test";
import { dedupeCornerMarkers, selectedEventMarker, trianglePath } from "../js/core/selected-event-markers.js";

test("selected event triangles point toward off-screen events", () => {
	const viewport = {};
	assert.equal(
		selectedEventMarker(
			{
				event: { selected: true },
				time: 5,
				channelIndex: 1,
				visibleChannelCount: 3,
				rangeStart: 0,
				rangeEnd: 10,
			},
			viewport,
		),
		null,
	);
	assert.equal(
		selectedEventMarker(
			{
				event: { selected: true },
				time: 5,
				channelIndex: 1,
				visibleChannelCount: 3,
				rangeStart: 0,
				rangeEnd: 10,
				hiddenSeparatorVisible: true,
			},
			viewport,
		),
		null,
	);
	assert.equal(
		selectedEventMarker(
			{
				event: { selected: true },
				time: -1,
				channelIndex: 0,
				visibleChannelCount: 3,
				rangeStart: 0,
				rangeEnd: 10,
			},
			viewport,
		).kind,
		"left",
	);
	assert.equal(
		selectedEventMarker(
			{
				event: { selected: true },
				time: 12,
				channelIndex: 0,
				visibleChannelCount: 3,
				rangeStart: 0,
				rangeEnd: 10,
			},
			viewport,
		).kind,
		"right",
	);
	assert.equal(
		selectedEventMarker(
			{
				event: { selected: true },
				time: 4,
				channelIndex: -1,
				visibleChannelCount: 3,
				rangeStart: 0,
				rangeEnd: 10,
			},
			viewport,
		).kind,
		"up",
	);
	assert.equal(
		selectedEventMarker(
			{
				event: { selected: true },
				time: -1,
				channelIndex: -1,
				visibleChannelCount: 3,
				rangeStart: 0,
				rangeEnd: 10,
			},
			viewport,
		).kind,
		"up-left",
	);
	const corners = dedupeCornerMarkers([{ kind: "up-left" }, { kind: "up-left" }, { kind: "left" }]);
	assert.equal(corners.length, 2);
	assert.ok(trianglePath("left", 8).length === 3);
});

test("hidden-channel events outside the range mark the separator with left or right triangles", () => {
	const viewport = {};
	const hiddenLeft = selectedEventMarker(
		{
			event: { selected: true },
			time: -1,
			channelIndex: -1,
			visibleChannelCount: 3,
			rangeStart: 0,
			rangeEnd: 10,
			hiddenSeparatorVisible: true,
		},
		viewport,
	);
	assert.equal(hiddenLeft.kind, "left");
	assert.equal(hiddenLeft.onHiddenSeparator, true);
	const hiddenRight = selectedEventMarker(
		{
			event: { selected: true },
			time: 12,
			channelIndex: -1,
			visibleChannelCount: 3,
			rangeStart: 0,
			rangeEnd: 10,
			hiddenSeparatorVisible: true,
		},
		viewport,
	);
	assert.equal(hiddenRight.kind, "right");
	assert.equal(hiddenRight.onHiddenSeparator, true);
});
