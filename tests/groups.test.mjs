import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { ChartModel } from "../js/core/chart-model.js";
import { TimingMap } from "../js/core/timing.js";
import { SSCHARTER_VERSION } from "../js/platform/live-hosting.js";
import { ChartRenderIndex } from "../js/render/chart-index.js";

test("nested groups keep recursive IDs, bounds, clips, and Sunniesnow export flat", () => {
	const model = ChartModel.createDefault({
		channels: [
			{ id: 0, name: "One" },
			{ id: 1, name: "Two" },
		],
		events: [
			{
				id: 4,
				type: "group",
				channel: 0,
				x: 200,
				y: 200,
				color: "#ff9d3d",
				selected: true,
				events: [
					{ id: 7, type: "tap", channel: 0, time: [1, 0, 1], x: -20, y: 10 },
					{
						id: 8,
						type: "group",
						channel: 1,
						x: 0,
						y: 0,
						events: [{ id: 9, type: "flick", channel: 1, time: [2, 0, 1], x: 30, y: -10 }],
					},
				],
			},
		],
	});
	const ids = model.allEvents().map(event => event.id);
	assert.equal(new Set(ids).size, ids.length);
	assert.equal(model.groupDescendants(4).length, 3);
	assert.deepEqual(model.groupBounds(4), { minX: -20, maxX: 30, minY: -10, maxY: 10 });
	model.addClip({ events: [{ type: "tap", time: [0, 0, 1], channel: 0 }], channels: [], snappees: [] });
	assert.equal(ChartModel.import(JSON.parse(model.serialize())).clips.length, 1);
	const exported = model.exportSunniesnow({ sscharterVersion: SSCHARTER_VERSION });
	assert.equal(exported.sscharter.version, "0.10.1");
	assert.equal(exported.events.filter(event => event.type === "tap").length, 1);
	assert.equal(exported.events.filter(event => event.type === "flick").length, 1);
});

test("nested group selection enters one level at a time", () => {
	const model = ChartModel.createDefault({
		events: [
			{
				id: 10,
				type: "group",
				channel: 0,
				x: 0,
				y: 0,
				events: [
					{
						id: 11,
						type: "group",
						channel: 0,
						x: 0,
						y: 0,
						events: [{ id: 12, type: "tap", channel: 0, time: [0, 0, 1], x: 1, y: 2 }],
					},
				],
			},
		],
	});
	const leaf = model.findEvent(12);
	assert.equal(new ChartRenderIndex(model, new TimingMap(), {}).selectionTarget(leaf).id, 11);
	assert.equal(new ChartRenderIndex(model, new TimingMap(), { selectionScope: 10 }).selectionTarget(leaf).id, 11);
	assert.equal(new ChartRenderIndex(model, new TimingMap(), { selectionScope: 11 }).selectionTarget(leaf).id, 12);
	model.findEvent(10).selected = true;
	model.findEvent(11).selected = true;
	model.ungroupSelected();
	assert.equal(model.findEvent(10), null);
	assert.equal(model.findEvent(11), null);
	assert.equal(model.findEvent(12).type, "tap");
});

test("removing a channel prunes empty nested groups", () => {
	const model = ChartModel.createDefault({
		channels: [{ id: 0 }, { id: 1 }],
		events: [
			{
				id: 4,
				type: "group",
				channel: 0,
				x: 0,
				y: 0,
				events: [{ id: 5, type: "tap", channel: 1, time: [0, 0, 1], x: 0, y: 0 }],
			},
		],
	});
	model.removeChannel(1);
	assert.equal(model.findEvent(4), null);
});

test("group anchors stay in the main-field index and out of timeline and scroll indexes", () => {
	const model = ChartModel.createDefault({
		events: [
			{
				id: 10,
				type: "group",
				channel: 0,
				time: [2, 0, 1],
				x: 0,
				y: 0,
				color: "#123456",
				events: [{ id: 11, type: "tap", channel: 0, time: [2, 0, 1], x: 10, y: 5 }],
			},
		],
	});
	const index = new ChartRenderIndex(model, new TimingMap({ initialBpm: 60 }));
	assert.deepEqual(
		index.scrollEventRecords(1, 3).map(record => record.event.id),
		[11],
	);
	assert.deepEqual(
		index.timelineRecords(1, 3).map(record => record.event.id),
		[11],
	);
	assert.equal(index.groupRecords[0].event.color, "#123456");
	assert.equal(index.groupRecords[0].start, 2);
	assert.equal("time" in index.groupRecords[0].event, false);
	assert.equal("channel" in index.groupRecords[0].event, false);
});

test("only top-level selected groups draw their own bounds", () => {
	const model = ChartModel.createDefault({
		events: [
			{
				id: 10,
				type: "group",
				selected: true,
				x: 0,
				y: 0,
				events: [
					{
						id: 11,
						type: "group",
						selected: true,
						x: 0,
						y: 0,
						events: [{ id: 12, type: "tap", channel: 0, time: [1, 0, 1], x: 5, y: 5 }],
					},
				],
			},
		],
	});
	const index = new ChartRenderIndex(model, new TimingMap({ initialBpm: 60 }));
	assert.equal(index.isRootSelectedGroup(model.findEvent(10)), true);
	assert.equal(index.isRootSelectedGroup(model.findEvent(11)), false);
});

test("an attached selected group moves together with all descendants", () => {
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	app.model = ChartModel.createDefault({
		events: [
			{
				id: 10,
				type: "group",
				selected: true,
				attached: true,
				snappee: 0,
				snapPoint: [8, 4],
				events: [{ id: 11, type: "tap", channel: 0, time: [3, 0, 1], x: 10, y: 0 }],
			},
		],
	});
	app._applyPositionMove(app.model, 10, { x: 5, y: 7 });
	assert.deepEqual({ x: app.model.findEvent(10).x, y: app.model.findEvent(10).y }, { x: 5, y: 7 });
	assert.deepEqual({ x: app.model.findEvent(11).x, y: app.model.findEvent(11).y }, { x: 15, y: 7 });
	assert.deepEqual(app.model.findEvent(10).time, undefined);
	assert.deepEqual(app.model.findEvent(10).channel, undefined);
});

test("selected group anchors stay drawable when main-field grouping rings are hidden", async () => {
	const source = await readFile(new URL("../js/render/stage-overlays.js", import.meta.url), "utf8");
	const drawGrouping = source.slice(source.indexOf("_drawGrouping("), source.indexOf("_groupBounds("));
	assert.match(drawGrouping, /_drawGroupingRings/);
	assert.match(drawGrouping, /_drawSelectedGroupAnchors/);
	assert.match(drawGrouping, /showGroupingInMainField !== false/);
	const toggle = drawGrouping.indexOf("showGroupingInMainField !== false");
	const toggleBlockEnd = drawGrouping.indexOf("}", toggle);
	const anchorsCall = drawGrouping.indexOf("this._drawSelectedGroupAnchors");
	assert.ok(anchorsCall > toggleBlockEnd, "selected group anchors draw outside the grouping toggle");
	assert.equal(drawGrouping.includes("showGroupingInMainField === false"), false);
});

test("selected-invisible dashed circles skip group events", async () => {
	const source = await readFile(new URL("../js/render/stage-notes.js", import.meta.url), "utf8");
	const fn = source.slice(
		source.indexOf("_drawSelectedInvisible("),
		source.indexOf("_drawSelectedInvisibleText("),
	);
	const groupSkip = fn.indexOf('event.type === "group"');
	const dashedArc = fn.indexOf("context.arc(");
	assert.ok(groupSkip >= 0, "group events must be skipped");
	assert.ok(groupSkip < dashedArc, "group skip must happen before the dashed circle is drawn");
	assert.match(fn, /setLineDash\(\[4, 3\]\)/);
});

test("multiple attached selected groups can move by group-anchor delta", async () => {
	const { resolveAttachedPosition } = await import("../js/core/geometry.js");
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	const snappeeId = ChartModel.createDefault().snappees[0].id;
	app.model = ChartModel.createDefault({
		events: [
			{
				id: 10,
				type: "group",
				selected: true,
				attached: true,
				snappee: snappeeId,
				snapPoint: [0, 0],
				events: [{ id: 11, type: "tap", channel: 0, time: [0, 0, 1], x: 0, y: 0 }],
			},
			{
				id: 20,
				type: "group",
				selected: true,
				attached: true,
				snappee: snappeeId,
				snapPoint: [1, 0],
				events: [{ id: 21, type: "tap", channel: 0, time: [1, 0, 1], x: 10, y: 0 }],
			},
		],
	});
	const before10 = resolveAttachedPosition(app.model.findEvent(10), app.model.snappees);
	const before20 = resolveAttachedPosition(app.model.findEvent(20), app.model.snappees);
	assert.ok(before10 && before20, "both groups resolve on the shared snappee");
	app._applyGroupAnchorMove(app.model, 10, { x: before10.x + 5, y: before10.y + 7 });
	const g10 = app.model.findEvent(10);
	const g20 = app.model.findEvent(20);
	assert.equal(g10.attached, false);
	assert.equal(g20.attached, false);
	assert.deepEqual({ x: g10.x, y: g10.y }, { x: before10.x + 5, y: before10.y + 7 });
	assert.deepEqual({ x: g20.x, y: g20.y }, { x: before20.x + 5, y: before20.y + 7 });
});

test("selected group-anchor hit regions stay registered for multiple attached groups", async () => {
	const source = await readFile(new URL("../js/render/stage-overlays.js", import.meta.url), "utf8");
	const fn = source.slice(
		source.indexOf("_drawSelectedGroupAnchors("),
		source.indexOf("_groupBounds("),
	);
	assert.equal(fn.includes("movableGroups"), false);
	assert.match(fn, /type: "group-anchor"/);
	assert.match(fn, /if \(group\.selected\)/);
});
