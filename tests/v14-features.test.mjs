import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ChartModel } from "../js/core/chart-model.js";
import { fillInheritedTipPointParams, inheritedTipPointSource } from "../js/core/tip-point.js";
import {
	AFFINE_MATRIX_GRID,
	clampAffineToChartBounds,
	applyTransform,
	isPointWithinChartBounds,
} from "../js/core/geometry.js";
import { TimingMap } from "../js/core/timing.js";
import { COMMAND_DEFINITIONS, MENU_DEFINITION, TOOLBAR_ITEMS } from "../js/commands.js";
import { canonicalizeRationalTuple, validateField } from "../js/ui-fields.js";
import { StageView } from "../js/render/stage.js";
import {
	assignLyricaExportChannels,
	chooseClosestNonRandomSpawn,
	createLyricaRng,
	decodeTipPointCodes,
	evaluateLyricaSpawn,
	exportLyricaChart,
	importLyricaChart,
	isLyricaChartText,
	isLyricaFirstTipEvent,
	lyricaChannelCategory,
	parseLyricaChart,
	parseLyricaEvent,
	parseLyricaHeader,
} from "../js/core/lyrica.js";
import { STAGE_NOTE_MODULES, readSources } from "./module-source.mjs";

const SAMPLE_LYRICA = [
	"120|Demo|Artist|0|4|0",
	"#1",
	"0.5|-60|20|10|1|0|A|5|0,1.0|-60|20|10|1|0|B|0|1,0.5|-40|80|-10|3|90|C|6|0,2.5|20|0|0|1|0|D|20|0",
	"#2",
	[
		"0.25|40|0|0|4|1|a1|0|0",
		"0.75|60|-20|5|4|0.5|墨|0|0",
		"1.5|60|0|0|11|1_2|img|0|0",
		"1.6|60|0|0|12|1_3|img|0|0",
		"1.7|60|0|0|13|1|fx|0|0",
		"3|100|10|10|1|0|Z|0|0",
	].join(","),
	"#3",
	"",
	"#4",
	"2|200|0|0|4|2| |0|0",
	"",
].join("\n");

test("Lyrica header and event parse follow the v14 field tables", () => {
	const parsed = parseLyricaChart(SAMPLE_LYRICA);
	assert.equal(parsed.header.initialBpm, 120);
	assert.equal(parsed.header.title, "Demo");
	assert.equal(parsed.header.artist, "Artist");
	assert.equal(parsed.header.offset, 0);
	assert.ok(parsed.events.some(event => event.channel === -60 && event.text === "A"));
	assert.ok(parsed.events.some(event => event.channel === 200 && event.arg === 2));
	const header = parseLyricaHeader("199|rainbow|ああああ|0.6029994|4|0");
	assert.equal(header.title, "rainbow");
	const event = parseLyricaEvent("0.3571429|60|-75|-50|13|1_0|不|0|0");
	assert.equal(event.channel, 60);
	assert.equal(event.type, 13);
	assert.equal(isLyricaChartText(SAMPLE_LYRICA), true);
	assert.equal(isLyricaChartText('{ "title": 1 }'), false);
});

test("Lyrica import ignores 11/12/13, marks disabled channels inactive, and maps spawn units", () => {
	const state = importLyricaChart(SAMPLE_LYRICA, { charter: "Tester", seed: 1, quantizationDenominator: 16 });
	assert.equal(state.metadata.charter, "Tester");
	assert.ok(!state.events.some(event => event.text === "img" || event.text === "fx"));
	const disabled = state.channels.find(channel => channel.lyricaChannel === 100);
	assert.equal(disabled.active, false);
	assert.ok(state.events.some(event => event.channel === disabled.id && event.text === "Z"));
	const main = state.channels.find(channel => channel.lyricaChannel === -60);
	const chainHead = state.events.find(event => event.channel === main.id && event.text === "A");
	const inherited = state.events.find(event => event.channel === main.id && event.text === "B");
	assert.equal(chainHead.tipPointSpawnType, "chain");
	assert.equal(inherited.tipPointSpawnType, "inherit");
	assert.equal(chainHead.tipPointSpawnAbsolutePosition, false);
	assert.equal(chainHead.tipPointSpawnTimeBeats, false);
	const independent = state.channels.find(channel => channel.lyricaChannel === 20);
	const drop = state.events.find(event => event.channel === independent.id);
	assert.equal(drop.tipPointSpawnType, "drop");
	const bpm = new TimingMap(state.timing).bpmChanges[0];
	assert.equal(bpm.bpm, 240);
});

test("main-channel-determined spawn uses absolute position and event-time spawn uses beats", () => {
	const rng = createLyricaRng(0);
	const spawn = evaluateLyricaSpawn(
		{ b: 1, c: 0, x: 40, y: 10, time: 3, channel: -40 },
		{ x1: 12, y1: -8, t1: 1.25, previousTime: 0 },
		rng,
	);
	assert.equal(spawn.positionFromMain, true);
	assert.equal(spawn.timeFromEvent, true);
	assert.equal(spawn.x, 12);
	assert.equal(spawn.y, -8);
	assert.equal(spawn.time, 1.25);
	const codes = decodeTipPointCodes(11, null);
	assert.equal(codes.b, 1);
	assert.equal(codes.c, 1);
	assert.equal(isLyricaFirstTipEvent({ b: 0, c: 0, time: 1, channel: -60 }, null), true);
	assert.equal(isLyricaFirstTipEvent({ b: 0, c: 0, time: 1.2, channel: -60 }, { b: 5, c: 0, time: 0.5 }), false);
	assert.equal(lyricaChannelCategory(100), "bgNote");
});

// Every exported chain head repeats the same relative spawn fields; only its position, distance
// and angle change, so the fixture below builds them from one shape.
function spawnHead({ id, channel, x, y, distance, angle, spawnType = "chain", time = [2, 0, 1] }) {
	return {
		id,
		type: "tap",
		time,
		channel,
		x,
		y,
		tipPointSpawnType: spawnType,
		tipPointSpawnAbsolutePosition: false,
		tipPointSpawnDistance: distance,
		tipPointSpawnAngle: angle,
		tipPointSpawnTime: 1,
	};
}

function inheritingTap(id, channel, x, y) {
	return { id, type: "tap", time: [3, 0, 1], channel, x, y, tipPointSpawnType: "inherit" };
}

function createOverlappingChainModel() {
	return ChartModel.createDefault({
		metadata: { title: "Out", artist: "A" },
		timing: { offset: 0, initialBpm: 120 },
		channels: [
			{ id: 0, name: "A" },
			{ id: 1, name: "B" },
			{ id: 2, name: "C" },
			{ id: 3, name: "D" },
			{ id: 4, name: "E" },
			{ id: 5, name: "F" },
		],
		events: [
			spawnHead({
				id: 1,
				channel: 0,
				x: 10,
				y: 0,
				distance: 100,
				angle: Math.PI,
				spawnType: "drop",
				time: [1, 0, 1],
			}),
			spawnHead({ id: 2, channel: 1, x: 0, y: 0, distance: 100, angle: Math.PI / 2 }),
			inheritingTap(3, 1, 10, 0),
			spawnHead({ id: 4, channel: 2, x: 20, y: 0, distance: 100, angle: 0 }),
			inheritingTap(5, 2, 30, 0),
			spawnHead({ id: 6, channel: 3, x: -20, y: 0, distance: 100, angle: Math.PI }),
			inheritingTap(7, 3, -10, 0),
			spawnHead({ id: 8, channel: 4, x: 40, y: 10, distance: 80, angle: -Math.PI / 2 }),
			inheritingTap(9, 4, 50, 10),
			spawnHead({ id: 10, channel: 5, x: -40, y: 10, distance: 90, angle: Math.PI / 4 }),
			inheritingTap(11, 5, -30, 10),
		],
	});
}

test("Lyrica export puts sole tip points on independent and dumps overlapping multi chains", () => {
	const model = createOverlappingChainModel();
	const text = exportLyricaChart(model);
	assert.match(text, /^120\|Out\|A\|0\|4\|0/m);
	const parsed = parseLyricaChart(text);
	assert.ok(
		parsed.events.some(event => event.channel === 20),
		"sole-event chains go to independent",
	);
	const multiChannels = new Set(
		parsed.events.filter(event => [-60, -40, -20, 0].includes(event.channel)).map(event => event.channel),
	);
	assert.ok(multiChannels.size <= 4);
	assert.ok(
		parsed.events.some(event => event.channel === -100),
		"one overlapping chain dumps to no-tip-point",
	);
	assert.ok(
		parsed.events.every(event => ![2, 3, 4].includes(event.b)),
		"export never picks random spawn types",
	);
	const chosen = chooseClosestNonRandomSpawn({ x: 0, y: 0 }, { x: 0, y: -100 }, null, -60);
	assert.equal(chosen.b, 20);
	const four = assignLyricaExportChannels([
		{ events: [1, 2], start: 0, end: 2 },
		{ events: [3, 4], start: 0, end: 2 },
		{ events: [5, 6], start: 0, end: 2 },
		{ events: [7, 8], start: 0, end: 2 },
	]);
	assert.equal(four.assigned.length, 4);
	assert.equal(four.dumped.length, 0);
	const packed = assignLyricaExportChannels([
		{ events: [1, 2], start: 0, end: 2 },
		{ events: [3, 4], start: 0, end: 2 },
		{ events: [5, 6], start: 0, end: 2 },
		{ events: [7, 8], start: 0, end: 2 },
		{ events: [9, 10, 11], start: 0, end: 2 },
	]);
	assert.equal(packed.assigned.length, 4);
	assert.equal(packed.dumped.length, 1);
	assert.equal(packed.dumped[0].events.length, 2);
	assert.ok(
		parsed.events.some(event => Math.abs(event.time - 0.5) < 1e-6 && event.type === 1),
		"solo taps export as type 1",
	);
	assert.ok(
		parsed.events.some(event => event.type === 2),
		"overlapping same-time taps export as type 2",
	);
});

test("Lyrica export uses type 2 for simultaneous taps", () => {
	const model = ChartModel.createDefault({
		metadata: { title: "Multi", artist: "A" },
		timing: { offset: 0, initialBpm: 120 },
		channels: [
			{ id: 0, name: "A" },
			{ id: 1, name: "B" },
		],
		events: [
			{ id: 1, type: "tap", time: [1, 0, 1], channel: 0, x: -20, y: 0, tipPointSpawnType: "none" },
			{ id: 2, type: "tap", time: [1, 0, 1], channel: 1, x: 20, y: 0, tipPointSpawnType: "none" },
			{ id: 3, type: "tap", time: [2, 0, 1], channel: 0, x: 0, y: 0, tipPointSpawnType: "none" },
		],
	});
	const parsed = parseLyricaChart(exportLyricaChart(model));
	const atFirstBeat = parsed.events.filter(event => Math.abs(event.time - 0.5) < 1e-6);
	const atSecondBeat = parsed.events.filter(event => Math.abs(event.time - 1) < 1e-6);
	assert.equal(atFirstBeat.length, 2);
	assert.ok(atFirstBeat.every(event => event.type === 2));
	assert.equal(atSecondBeat.length, 1);
	assert.equal(atSecondBeat[0].type, 1);
});

test("v14 commands move Channel items, add Lyrica export, bar-line icon, and shortcut 0", () => {
	assert.ok(COMMAND_DEFINITIONS["file.exportLyrica"]);
	assert.equal(COMMAND_DEFINITIONS["music.subdivisionOther"].shortcut, "0");
	assert.match(COMMAND_DEFINITIONS["timing.barLine"].icon, /bar-line\.svg$/);
	const file = MENU_DEFINITION.find(menu => menu.id === "file");
	const events = MENU_DEFINITION.find(menu => menu.id === "events");
	const channel = MENU_DEFINITION.find(menu => menu.id === "channel");
	assert.ok(file.items.some(item => item.command === "file.exportLyrica"));
	assert.ok(!events.items.some(item => item.command === "events.moveChannelAbove"));
	assert.ok(!events.items.some(item => item.command === "events.moveChannelBelow"));
	assert.equal(channel.items[0].command, "events.moveChannelAbove");
	assert.equal(channel.items[1].command, "events.moveChannelBelow");
	assert.equal(channel.items[2].type, "separator");
	assert.ok(TOOLBAR_ITEMS.includes("timing.barLine"));
	assert.ok(TOOLBAR_ITEMS.includes("events.moveChannelAbove"));
});

test("rulers default off and persist in editor state", () => {
	const model = ChartModel.createDefault();
	assert.equal(model.editor.showRulers, false);
	model.editor.showRulers = true;
	const restored = ChartModel.import({ sviber: model.serializeSviber(), metadata: model.metadata });
	assert.equal(restored.editor.showRulers, true);
});

test("Chinese calls Lyrica 阳春白雪", async () => {
	const zh = JSON.parse(await readFile(new URL("../json/i18n.zh-CN.json", import.meta.url), "utf8"));
	assert.match(zh["command.file.exportLyrica"], /阳春白雪/);
	assert.match(zh["dialog.importLyrica"], /阳春白雪/);
	assert.match(zh["toast.lyricaExported"], /阳春白雪/);
});

test("inherit/none hide spawn fields and inherit to chain copies inherited params", () => {
	const model = ChartModel.createDefault({
		channels: [{ id: 0 }],
		events: [
			{
				id: 1,
				type: "tap",
				time: [1, 0, 1],
				channel: 0,
				x: 0,
				y: 0,
				tipPointSpawnType: "drop",
				tipPointSpawnAbsolutePosition: true,
				tipPointSpawnX: 12,
				tipPointSpawnY: -8,
				tipPointSpawnTime: 1.5,
			},
			{ id: 2, type: "tap", time: [2, 0, 1], channel: 0, x: 10, y: 0, tipPointSpawnType: "inherit" },
		],
	});
	const next = model.events[1];
	assert.equal(inheritedTipPointSource(model.events, next).id, 1);
	fillInheritedTipPointParams(next, model.events);
	assert.equal(next.tipPointSpawnAbsolutePosition, true);
	assert.equal(next.tipPointSpawnX, 12);
	assert.equal(next.tipPointSpawnY, -8);
});

test("non-coprime beat inputs are accepted and auto-reduced", () => {
	assert.deepEqual(canonicalizeRationalTuple([1, 2, 4]), [1, 1, 2]);
	assert.equal(validateField({ type: "rational" }, [1, 2, 4], {}), "");
	assert.ok(validateField({ type: "rational" }, [1, 1, 0], {}));
});

test("free-transform rotation clamps a point onto the chart rectangle", () => {
	const matrix = clampAffineToChartBounds([{ x: 90, y: 0 }], [0, 1, -1, 0, 0, 0], [1, 0, 0, 1, 0, 0]);
	const point = applyTransform({ x: 90, y: 0 }, matrix);
	assert.equal(isPointWithinChartBounds(point), true);
	assert.ok(
		Math.abs(point.x - 100) < 1e-6 ||
			Math.abs(point.x + 100) < 1e-6 ||
			Math.abs(point.y - 50) < 1e-6 ||
			Math.abs(point.y + 50) < 1e-6,
		`rotated point ${JSON.stringify(point)} should land on a boundary`,
	);
});

test("music-stop clears in-flight hit effects through the shipped StageView method", () => {
	const target = { particles: [{ started: 1 }, { started: 2 }], particleAnimationFrame: 0, render() {} };
	StageView.prototype.clearHitEffects.call(target);
	assert.deepEqual(target.particles, []);
});

test("v14 help documents Lyrica, rulers, HUD pause, Channel move, and shortcut 0", async () => {
	const [en, zh, help, core, shortcuts, notes, macros] = await Promise.all([
		readFile(new URL("../json/i18n.en-US.json", import.meta.url), "utf8"),
		readFile(new URL("../json/i18n.zh-CN.json", import.meta.url), "utf8"),
		readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
		readFile(new URL("../js/app-core.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app-global-shortcuts.js", import.meta.url), "utf8"),
		readSources(STAGE_NOTE_MODULES),
		readFile(new URL("../js/macros.js", import.meta.url), "utf8"),
	]);
	assert.match(en, /Export Lyrica chart/);
	assert.match(zh, /阳春白雪/);
	assert.match(help, /Export Lyrica/);
	assert.match(help, /more than four multi-event tip points/);
	assert.match(help, /阳春白雪/);
	assert.match(help, /超过四条多事件游标/);
	assert.match(help, /Rulers/);
	assert.match(help, /pause button/);
	assert.match(help, /<kbd>0<\/kbd>/);
	assert.match(help, /a c tx \/ b d ty/);
	assert.match(help, /type 2/);
	assert.deepEqual([...AFFINE_MATRIX_GRID], [0, 2, 4, 1, 3, 5]);
	assert.match(await readFile(new URL("../js/ui-fields.js", import.meta.url), "utf8"), /AFFINE_MATRIX_GRID/);
	assert.match(await readFile(new URL("../js/panels.js", import.meta.url), "utf8"), /AFFINE_MATRIX_GRID/);
	assert.match(core, /channel\.select/);
	assert.match(shortcuts, /scrollChannelsBy/);
	assert.match(notes, /_drawRulers/);
	assert.match(notes, /_drawSnappeeAttachRings/);
	assert.match(macros, /lastMacroLanguage/);
	assert.match(macros, /scope: activeList/);
});
