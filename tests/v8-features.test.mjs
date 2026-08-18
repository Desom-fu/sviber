import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { COMMAND_DEFINITIONS } from "../js/commands.js";
import { SviberAppCore } from "../js/app-core.js";
import { withEventEditing } from "../js/app-event-editing.js";
import { ChartModel, createEvent } from "../js/core/chart-model.js";
import { TimingMap } from "../js/core/timing.js";
import { MESSAGES } from "../js/i18n.js";
import { ChartRenderIndex } from "../js/render/chart-index.js";
import { TIMELINE_COMMENT_TEXT_COLOR, timelineTipConnector } from "../js/render/timeline-helpers.js";

function contrastRatio(foreground, background) {
	const luminance = color => {
		const channels = color.match(/[0-9a-f]{2}/gi).map(channel => parseInt(channel, 16) / 255)
			.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
		return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
	};
	const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
	return (values[0] + 0.05) / (values[1] + 0.05);
}

test("v8 commands have shortcuts and complete English and Chinese text", () => {
	const expectedShortcuts = {
		"events.comment": "Ctrl+M",
		"channel.selectAbove": "Alt+ArrowUp",
		"channel.selectBelow": "Alt+ArrowDown",
		"timeline.pageForward": "PageUp",
		"timeline.pageBackward": "PageDown",
	};
	for (const [id, shortcut] of Object.entries(expectedShortcuts)) {
		assert.equal(COMMAND_DEFINITIONS[id].shortcut, shortcut);
	}
	for (const language of Object.keys(MESSAGES)) {
		for (const definition of Object.values(COMMAND_DEFINITIONS)) {
			assert.ok(MESSAGES[language][definition.labelKey], `${language} lacks ${definition.labelKey}`);
			assert.ok(MESSAGES[language][definition.hintKey], `${language} lacks ${definition.hintKey}`);
		}
		for (const key of [
			"menu.help", "panel.channels", "dialog.comment", "dialog.editChannel", "dialog.about",
			"dialog.copy", "field.endTime", "event.comment", "panel.channel.activate",
			"panel.channel.deactivate", "panel.channel.duplicate", "panel.channel.delete",
			"panel.channel.edit", "history.editChannel", "about.repository", "about.license",
			"about.version", "about.commit", "about.commitDate", "about.nwVersion",
			"about.browserVersion", "about.engineVersion", "about.nodeVersion", "about.v8Version",
			"about.operatingSystem",
		]) assert.ok(MESSAGES[language][key], `${language} lacks ${key}`);
	}
});

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
	assert.deepEqual(model.channels.map(channel => [channel.name, channel.active]), [
		["Muted", false], ["Gameplay", true],
	]);
	assert.equal(model.snappees[0].selected, false);
	assert.equal(model.events[0].selected, false);
	assert.deepEqual(createEvent("comment", { duration: [-1, 0, 1] }).duration, [0, 0, 1]);
	assert.equal(model.addEvent("comment", {
		channel: 4, duration: [1, 0, 1], text: "new muted note", selected: true,
	}).selected, false);
	model.removeEvent(model.events.at(-1).id);

	const document = model.toJSON();
	assert.deepEqual(document.events.map(event => event.type), ["tap"]);
	assert.deepEqual(document.sviber.events.map(event => event.type), ["tap", "comment", "tap", "comment"]);
	assert.equal(document.sviber.events[3].text, "active note");
	assert.deepEqual(document.sviber.events[3].duration, [2, 0, 1]);
	assert.equal(document.sviber.editor.currentChannel, 9);

	const reopened = ChartModel.import(document);
	assert.deepEqual(reopened.channels, model.channels);
	assert.deepEqual(reopened.events, model.events);
});

test("comment text remains readable on the timeline and status panel", async () => {
	const css = (await Promise.all([
		readFile(new URL("../css/themes.css", import.meta.url), "utf8"),
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
	])).join("\n");
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

test("deleting the current channel chooses a remaining active channel", () => {
	const model = new ChartModel({
		channels: [
			{ id: 0, name: "Inactive above", active: false },
			{ id: 1, name: "Current", active: true },
			{ id: 2, name: "Active below", active: true },
		],
		editor: { currentChannel: 1 },
	});
	model.removeChannel(1);
	assert.equal(model.editor.currentChannel, 2);
});

test("event dragging cannot move selected events into an inactive channel", () => {
	const model = new ChartModel({
		channels: [
			{ id: 0, name: "Active", active: true },
			{ id: 1, name: "Inactive", active: false },
		],
		events: [{ id: 1, type: "tap", channel: 0, time: [0, 0, 1], x: 0, y: 0, selected: true }],
	});
	const EditingApp = withEventEditing(class {});
	const app = new EditingApp();
	app._applyEventMove(model, [1, 0, 1], 1, false);
	assert.equal(model.events[0].channel, 0);
	assert.deepEqual(model.events[0].time, [1, 0, 1]);
});

test("invalidated playback skips stale ticks but permits the zero-tolerance rebuild", () => {
	const event = { id: 1, type: "tap" };
	const hitCalls = [];
	const effectCalls = [];
	const app = {
		playbackScheduleInvalidated: true,
		renderIndex: {
			hitRecords: [{ event, start: 0.05 }],
			holdReleaseRecords: [],
		},
		audio: { rate: 1, playHit: (...args) => { hitCalls.push(args); } },
		stage: { triggerHit: (...args) => { effectCalls.push(args); } },
		scheduledHitIds: new Set(),
		scheduledHoldReleaseIds: new Set(),
	};
	SviberAppCore.prototype._scheduleHits.call(app, 0);
	assert.deepEqual(hitCalls, []);
	assert.equal(app.scheduledHitIds.size, 0);

	SviberAppCore.prototype._scheduleHits.call(app, 0, 0);
	assert.deepEqual(hitCalls, [["tap", 0.05]]);
	assert.equal(effectCalls.length, 1);
	assert.deepEqual([...app.scheduledHitIds], [1]);
});

test("render index separates inactive gameplay from complete timeline and comments", () => {
	const project = {
		channels: [
			{ id: 0, name: "Active", active: true },
			{ id: 1, name: "Inactive", active: false },
		],
		snappees: [],
		events: [
			{ id: 1, type: "tap", channel: 0, time: [1, 0, 1], x: 0, y: 0, tipPointSpawnType: "chain", tipPointSpawnTime: 1 },
			{ id: 2, type: "tap", channel: 0, time: [2, 0, 1], x: 1, y: 0, tipPointSpawnType: "inherit", tipPointSpawnTime: 1 },
			{ id: 3, type: "tap", channel: 1, time: [1, 0, 1], x: 0, y: 1, tipPointSpawnType: "chain", tipPointSpawnTime: 1 },
			{ id: 4, type: "tap", channel: 1, time: [2, 0, 1], x: 1, y: 1, tipPointSpawnType: "inherit", tipPointSpawnTime: 1 },
			{ id: 5, type: "comment", channel: 0, time: [0, 0, 1], duration: [2, 0, 1], text: "active" },
			{ id: 6, type: "comment", channel: 1, time: [0, 0, 1], duration: [2, 0, 1], text: "inactive" },
		],
	};
	const index = new ChartRenderIndex(project, new TimingMap({ initialBpm: 60 }));
	assert.deepEqual(index.hitRecords.map(record => record.event.id), [1, 2]);
	assert.equal(index.tipGuides.length, 1);
	assert.equal(index.allTipGuides.length, 2);
	assert.equal(index.timelineTipGuides(-10, 10).length, 2);
	assert.deepEqual(index.activeComments(0.5).map(event => event.text), ["active", "inactive"]);
	assert.equal(index.eventById.get(4), project.events[3]);

	index.setEventSelected(project.events[0], true);
	assert.equal(index.selectedEventIds.has(1), true);
	index.setEventSelected(project.events[0], false);
	assert.equal(index.selectedEventIds.has(1), false);
});

test("timeline tip connector is fixed just beyond the largest event icon radius", () => {
	const connector = timelineTipConnector([
		{ time: 0, x: 0, y: 0 },
		{ time: 10, x: 1000, y: 0 },
	]);
	assert.equal(connector[0].time, 0);
	assert.equal(Math.hypot(connector[0].x - connector[1].x, connector[0].y - connector[1].y), 12);
});

test("JavaScript license labels cover independent scripts with valid source links", async () => {
	const labels = await readFile(new URL("../javascript.html", import.meta.url), "utf8");
	assert.match(labels, /id="jslicense-labels1"/);
	for (const script of ["js/app.js", "js/license-page.js", "service-worker.js", "docs/docs.js"]) {
		assert.match(labels, new RegExp(`href="${script.replace(".", "\\.")}"`));
	}
	assert.match(labels, /data-return-editor/);
	assert.doesNotMatch(labels, /\/blob\/master\//);
});
