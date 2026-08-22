import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ChartModel } from "../js/core/chart-model.js";
import { TimingMap } from "../js/core/timing.js";
import { COMMAND_DEFINITIONS, MENU_DEFINITION, TOOLBAR_ITEMS } from "../js/commands.js";

test("bar lines drive rational beat lines and snapping", () => {
	const timing = new TimingMap({ initialBpm: 120, barLines: [{ time: [1, 2, 3] }] });
	const lines = timing.beatLinesBetween([0, 0, 1], [3, 0, 1], 2);
	assert.ok(lines.some(line => line.barLine && line.beat.equals([1, 2, 3])));
	assert.equal(lines.find(line => line.beat.equals([2, 1, 6])).relative.toString(), "1/2");
	assert.equal(timing.snapBeat([2, 1, 6], 2).toString(), "2+1/6");
	assert.deepEqual(timing.toJSON().barLines, [{ time: [1, 2, 3] }]);
});

test("v13 editor view and background visibility fields round-trip", () => {
	const model = ChartModel.createDefault({ editor: {
		showBgEventsInTimeline: false, showBgEventsInMainField: false,
		mainFieldPanX: 12, mainFieldPanY: -4, mainFieldZoom: 1.75,
	} });

	const restored = ChartModel.import({ sviber: model.serializeSviber(), metadata: model.metadata });
	assert.equal(restored.editor.showBgEventsInTimeline, false);
	assert.equal(restored.editor.showBgEventsInMainField, false);
	assert.equal(restored.editor.mainFieldPanX, 12);
	assert.equal(restored.editor.mainFieldPanY, -4);
	assert.equal(restored.editor.mainFieldZoom, 1.75);
});

test("v13 commands expose bar line and time dilation", () => {
	assert.equal(COMMAND_DEFINITIONS["timing.barLine"].shortcut, "R");
	assert.ok(COMMAND_DEFINITIONS["transform.timeDilation"]);
	const timing = MENU_DEFINITION.find(menu => menu.id === "timing");
	const transform = MENU_DEFINITION.find(menu => menu.id === "transform");
	assert.ok(timing.items.some(item => item.command === "timing.barLine"));
	assert.ok(transform.items.some(item => item.command === "transform.timeDilation"));
});

test("v13 inspector hides inactive tip-point input rows and preserves panel scroll", async () => {
	const panels = await readFile(new URL("../js/panels.js", import.meta.url), "utf8");
	assert.match(panels, /if \(control\?\.dataset\?\.hidden === "true"\) row\.hidden = true/);
	assert.match(panels, /setControlHidden\(distanceControl, !spawnFieldsEnabled \|\| absolute !== false\)/);
	assert.match(panels, /setControlHidden\(absoluteWrapper, !spawnFieldsEnabled \|\| absolute !== true \|\| attached === true\)/);
	assert.match(panels, /setControlHidden\(secondsControl, !spawnFieldsEnabled \|\| timeInBeats !== false\)/);
	assert.match(panels, /setControlHidden\(beatsControl, !spawnFieldsEnabled \|\| timeInBeats !== true\)/);
	const snappeeStart = panels.indexOf("export class SnappeesPanel");
	const channelsStart = panels.indexOf("export class ChannelsPanel");
	const snappees = panels.slice(snappeeStart, channelsStart);
	assert.match(snappees, /const scrollTop = Number\(this\.element\.scrollTop\)/);
	assert.match(snappees, /this\.element\.scrollTop = scrollTop/);
});

test("v13 build/package metadata is shared through JSON and Nix", async () => {
	const [fonts, build, defaultNix, flake] = await Promise.all([
		readFile(new URL("../json/font-assets.json", import.meta.url), "utf8"),
		readFile(new URL("../scripts/build-nw.mjs", import.meta.url), "utf8"),
		readFile(new URL("../default.nix", import.meta.url), "utf8"),
		readFile(new URL("../flake.nix", import.meta.url), "utf8"),
	]);
	assert.ok(JSON.parse(fonts).length >= 5);
	assert.match(build, /font-assets\.json/);
	assert.match(defaultNix, /callPackage|mkDerivation/);
	assert.match(flake, /nixos-unstable/);
});

test("v13 macro wrappers expose timing, location, grouping, channels, and clips", async () => {
	await import("../js/macro-api.js");
	const api = globalThis.createSviberMacroApi({
		editor: { currentChannel: 0, currentTime: [0, 0, 1] },
		channels: [{ id: 0, name: "Main", active: true }], events: [], snappees: [], clips: [],
	});
	const channel = api.Channel.current;
	assert.equal(channel.name, "Main");
	channel.name = "Edited";
	const note = api.Event.new({ type: "tap", location: new api.Location(2, 3), time: [1, 1, 2] });
	assert.deepEqual(note.time, [1, 1, 2]);
	note.angle = "up";
	assert.equal(note.type, "tap");
	const group = api.g([note], 0xff0000);
	assert.equal(group.groupQ(), true);
	group.location = new api.Location(5, 6);
	assert.equal(group.events[0].location.x, 7);
	const bar = new api.BarLine([1, 1, 2]);
	assert.equal(api.Chart.bar_lines.length, 1);
	bar.delete();
	const clip = api.Clip.new([note], "test");
	assert.equal(api.Chart.clips[0].name, "test");
	assert.equal(clip.paste([2, 0, 1], channel).length, 1);
});

test("v13 macro geometry, tip-point serialization, relative copy, and deletion are enforced", async () => {
	await import("../js/macro-api.js");
	const api = globalThis.createSviberMacroApi({
		editor: { currentChannel: 0, currentTime: [3, 0, 1] },
		channels: [{ id: 0, name: "Main", active: true }], events: [], snappees: [], clips: [],
	});
	const mesh = new api.RectangularMesh(-10, 10, 10, -10, 2, 2);
	assert.deepEqual(mesh.pos(2, 2).toArray(), [10, -10]);
	const attached = new api.Location(mesh, [1, 1]);
	const note = api.Event.new({ type: "tap", location: attached, time: [1, 1, 2] });
	assert.equal(note.location.attachedQ(), true);
	const tip = api.TipPoint.chain({ location: new api.Location(4, 5), timeBeats: [1, 1, 2] });
	note.tipPoint = tip;
	assert.equal(note.toJSON().tipPointSpawnAbsolutePosition, true);
	const matrix = new api.AffineMatrix2D().translate(2, 3).rotate(Math.PI / 2);
	assert.ok(Math.abs(matrix.a) < 1e-12);
	api.transform(note, new api.AffineMatrix2D().translate(1, 0));
	const copies = api.copy([note]);
	assert.equal(copies.length, 1);
	assert.deepEqual(copies[0].time, [3, 0, 1]);
	const channel = api.Channel.new("Temporary");
	channel.delete();
	assert.throws(() => channel.select(), /deleted/);
});

test("v0.4.1 toolbar and wheel routing keep main-field controls discoverable", async () => {
	assert.equal(TOOLBAR_ITEMS[TOOLBAR_ITEMS.indexOf("events.bpmChange") - 1], "separator");
	const [css, timeline] = await Promise.all([
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
		readFile(new URL("../js/render/timeline.js", import.meta.url), "utf8"),
	]);
	assert.match(css, /\.reset-main-field-view[^\{]*\{[^}]*border: 2px solid var\(--text\)/s);
	assert.match(timeline, /if \(event\.ctrlKey && event\.shiftKey\) \{[\s\S]*onMainFieldZoom/s);
});
