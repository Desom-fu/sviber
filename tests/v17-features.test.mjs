import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { exportOrderedEvents, rationalGcd } from "../js/app-attachment.js";
import { loadPreferences, PREFERENCES_KEY, storePreferences } from "../js/app-helpers.js";
import { AudioPlayer } from "../js/audio/player.js";
import { COMMAND_DEFINITIONS, MENU_DEFINITION } from "../js/commands.js";
import { ChartModel } from "../js/core/chart-model.js";
import { CHECK_DEFINITIONS, CHECK_IDS, defaultChecks, runChecks } from "../js/core/checks.js";
import { DIFFICULTY_COLORS, DEFAULT_EDITOR } from "../js/core/chart-vocabulary.js";
import { NDArray } from "../js/core/ndarray.js";
import { Rational } from "../js/core/rational.js";
import { AUTO_TIMING_DEFAULTS } from "../js/dsp/auto-timing.js";
import { nodesToValues, tautString, timingFromDenoisedBeats } from "../js/dsp/beat-denoise.js";
import { computeNovelty } from "../js/dsp/novelty.js";

const CHECK_ID_LIST = [
	"emptyMetadata",
	"irregularDifficulty",
	"requiredFingers",
	"outOfBoundaryNotes",
	"outOfBoundaryBgNotes",
	"shortHold",
	"shortBgPattern",
	"shortTipPoint",
	"sharpTipPointTurn",
	"teleportingTipPoint",
	"multiCharacterCjk",
	"eventsOutsideMusic",
];

function memoryStorage(initial = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: key => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
	};
}

function menuById(id) {
	return MENU_DEFINITION.find(menu => menu.id === id);
}

function commandIndex(menuId, commandId) {
	return menuById(menuId).items.findIndex(item => item.command === commandId);
}

function validChart(overrides = {}) {
	const { metadata, ...rest } = overrides;
	return ChartModel.createDefault({
		metadata: {
			title: "Song",
			artist: "Artist",
			charter: "Charter",
			difficultyName: "Master",
			difficultyColor: DIFFICULTY_COLORS.master,
			difficulty: "12",
			difficultySup: "",
			...metadata,
		},
		...rest,
	});
}

function enabledOnly(id, extra = {}) {
	const settings = defaultChecks();
	for (const checkId of CHECK_IDS) {
		settings[checkId].enabled = checkId === id;
	}
	Object.assign(settings[id], extra);
	return settings;
}

function violationsFor(model, id, extra = {}, options = {}) {
	return runChecks(model, { checks: enabledOnly(id, extra), ...options }).filter(
		item => item.check === id,
	);
}

function addNote(model, type, beat, x = 0, y = 0, extra = {}) {
	return model.addEvent(type, { time: [beat, 0, 1], x, y, ...extra });
}

function attachTimeIndices(times) {
	const values = times.map(time => Rational.from(time));
	const origin = values[0];
	let step = new Rational(0, 1);
	for (const time of values) {
		step = rationalGcd(step, time.sub(origin));
	}
	return values.map(time => {
		if (step.numerator === 0n) {
			return 0;
		}
		return Math.round(time.sub(origin).div(step).toNumber());
	});
}

function assertCommand(id, fields) {
	const command = COMMAND_DEFINITIONS[id];
	assert.ok(command, id);
	for (const [key, value] of Object.entries(fields)) {
		assert.equal(command[key], value, `${id}.${key}`);
	}
}

test("v17 command definitions cover the new file, edit, timing and channel actions", () => {
	assertCommand("file.reloadChart", { desktopOnly: true });
	assertCommand("file.renameChart", { desktopOnly: true });
	assertCommand("edit.checks", {});
	assertCommand("timing.adjustOffset", {
		checkable: true,
		icon: "svg/icons/adjust-offset.svg",
	});
	assertCommand("timing.automatic", {});
	assertCommand("channel.deactivate", { shortcut: "Ctrl+," });
	assertCommand("channel.activateAll", { shortcut: "Ctrl+Alt+," });
	assertCommand("snappee.deactivateAll", { shortcut: "Alt+Shift+A" });
	assertCommand("snappee.attachCurveOrder", {});
	assertCommand("snappee.attachCurveTime", {});
	assertCommand("transform.flipHorizontalReattach", { shortcut: "Ctrl+%" });
	assertCommand("transform.flipVerticalReattach", { shortcut: 'Ctrl+"' });
	assertCommand("transform.timeTranslation", {});
	assertCommand("transform.reverseTime", {});
	assertCommand("music.speedOther", { shortcut: "Ctrl+0" });
	assertCommand("music.seekBackward3", { shortcut: "Ctrl+Shift+," });
	for (const id of ["music.subdivision5", "music.subdivision7", "music.subdivision9"]) {
		assert.ok(COMMAND_DEFINITIONS[id], id);
	}
	for (const suffix of [3, 5, 6, 7, 8, 9]) {
		assert.ok(COMMAND_DEFINITIONS[`music.speedInverse${suffix}`], `speedInverse${suffix}`);
	}
});

test("v17 menus place reload, rename, checks, timing, reverseTime and attach-curve", () => {
	const fileItems = menuById("file").items;
	const autosave = commandIndex("file", "file.openAutosave");
	const reload = commandIndex("file", "file.reloadChart");
	assert.ok(reload > autosave);
	assert.equal(fileItems[autosave + 1].command, "file.reloadChart");
	const rename = commandIndex("file", "file.renameChart");
	const properties = commandIndex("file", "file.chartProperties");
	assert.ok(rename < properties);
	assert.equal(fileItems[rename + 1].command, "file.chartProperties");

	const editItems = menuById("edit").items;
	assert.equal(editItems.at(-1).command, "edit.checks");

	const timingItems = menuById("timing").items;
	const adjust = commandIndex("timing", "timing.adjustOffset");
	assert.equal(timingItems[adjust].command, "timing.adjustOffset");
	assert.equal(timingItems[adjust + 1].command, "timing.automatic");
	assert.equal(timingItems[adjust + 2].type, "separator");

	assert.ok(commandIndex("transform", "transform.reverseTime") >= 0);
	assert.equal(commandIndex("events", "transform.reverseTime"), -1);
	assert.ok(commandIndex("snappee", "snappee.attachCurveOrder") >= 0);
	assert.ok(commandIndex("snappee", "snappee.attachCurveTime") >= 0);
});

test("all 12 chart checks exist and are enabled by default", () => {
	assert.deepEqual([...CHECK_IDS], CHECK_ID_LIST);
	assert.equal(CHECK_DEFINITIONS.length, 12);
	const defaults = defaultChecks();
	for (const id of CHECK_ID_LIST) {
		assert.equal(defaults[id].enabled, true, id);
	}
	assert.equal(defaults.requiredFingers.fingers, 2);
	assert.equal(defaults.shortHold.seconds, 0.1);
	assert.equal(defaults.shortBgPattern.seconds, 0.1);
	assert.equal(defaults.shortTipPoint.seconds, 0.3);
	for (const id of ["emptyMetadata", "irregularDifficulty"]) {
		const definition = CHECK_DEFINITIONS.find(item => item.id === id);
		assert.equal(definition.target, "chartProperties");
	}
});

test("emptyMetadata flags empty title, artist and charter", () => {
	const model = validChart({ metadata: { title: "", artist: "", charter: "" } });
	const violations = violationsFor(model, "emptyMetadata");
	assert.deepEqual(
		violations.map(item => item.params.field).sort(),
		["artist", "charter", "title"],
	);
	assert.ok(violations.every(item => item.target === "chartProperties"));
	assert.equal(violationsFor(validChart(), "emptyMetadata").length, 0);
});

test("irregularDifficulty flags name, color, Easy non-integer and Special 2-char", () => {
	assert.ok(
		violationsFor(validChart({ metadata: { difficultyName: "Insane" } }), "irregularDifficulty")
			.length > 0,
	);
	assert.ok(
		violationsFor(
			validChart({
				metadata: {
					difficultyName: "Easy",
					difficultyColor: DIFFICULTY_COLORS.hard,
					difficulty: "4",
				},
			}),
			"irregularDifficulty",
		).length > 0,
	);
	assert.ok(
		violationsFor(
			validChart({
				metadata: {
					difficultyName: "Easy",
					difficultyColor: DIFFICULTY_COLORS.easy,
					difficulty: "4.5",
				},
			}),
			"irregularDifficulty",
		).length > 0,
	);
	assert.ok(
		violationsFor(
			validChart({
				metadata: {
					difficultyName: "Special",
					difficultyColor: DIFFICULTY_COLORS.special,
					difficulty: "SS",
				},
			}),
			"irregularDifficulty",
		).length > 0,
	);
});

test("irregularDifficulty allows + on difficulty 7 and rejects other superscripts", () => {
	assert.ok(
		violationsFor(
			validChart({ metadata: { difficulty: "7", difficultySup: "x" } }),
			"irregularDifficulty",
		).length > 0,
	);
	assert.equal(
		violationsFor(
			validChart({ metadata: { difficulty: "7", difficultySup: "+" } }),
			"irregularDifficulty",
		).length,
		0,
	);
});

test("requiredFingers reports a third simultaneous tap when n=2", () => {
	const two = validChart();
	addNote(two, "tap", 1, -20);
	addNote(two, "tap", 1, 0);
	assert.equal(violationsFor(two, "requiredFingers").length, 0);
	assert.ok(violationsFor(two, "requiredFingers", { fingers: 1 }).length > 0);

	const three = validChart();
	addNote(three, "tap", 1, -20);
	addNote(three, "tap", 1, 0);
	const third = addNote(three, "tap", 1, 20);
	const over = violationsFor(three, "requiredFingers");
	assert.equal(over.length, 1);
	assert.deepEqual(over[0].eventIds, [third.id]);
	assert.equal(violationsFor(three, "requiredFingers", { fingers: 3 }).length, 0);
});

test("requiredFingers counts a hold through its end inclusive against a tap", () => {
	const during = validChart();
	addNote(during, "hold", 1, 0, 0, { duration: [2, 0, 1] });
	addNote(during, "tap", 2, 20);
	assert.ok(violationsFor(during, "requiredFingers", { fingers: 1 }).length > 0);
	assert.equal(violationsFor(during, "requiredFingers").length, 0);

	const atEnd = validChart();
	addNote(atEnd, "hold", 1, 0, 0, { duration: [1, 0, 1] });
	addNote(atEnd, "tap", 2, 20);
	// A hold occupies its finger through the end beat inclusive.
	assert.ok(violationsFor(atEnd, "requiredFingers", { fingers: 1 }).length > 0);
	assert.equal(violationsFor(atEnd, "requiredFingers").length, 0);
});

test("requiredFingers lets a hold share a finger with a drag", () => {
	const holdDrag = validChart();
	addNote(holdDrag, "hold", 1, 0, 0, { duration: [2, 0, 1] });
	addNote(holdDrag, "drag", 2, 20);
	// A drag during a hold reuses the holding finger.
	assert.equal(violationsFor(holdDrag, "requiredFingers", { fingers: 1 }).length, 0);
});

test("requiredFingers treats a same-position tap+drag as one finger", () => {
	const sameSpot = validChart();
	addNote(sameSpot, "tap", 1, 0, 0);
	addNote(sameSpot, "drag", 1, 0, 0);
	assert.equal(violationsFor(sameSpot, "requiredFingers", { fingers: 1 }).length, 0);

	const split = validChart();
	addNote(split, "tap", 1, 0, 0);
	addNote(split, "drag", 1, 20, 0);
	assert.ok(violationsFor(split, "requiredFingers", { fingers: 1 }).length > 0);
	assert.equal(violationsFor(split, "requiredFingers").length, 0);
});

test("outOfBoundaryNotes and outOfBoundaryBgNotes are independent", () => {
	const notes = validChart();
	const note = addNote(notes, "tap", 1, 150, 0);
	const noteHits = violationsFor(notes, "outOfBoundaryNotes");
	assert.equal(noteHits.length, 1);
	assert.deepEqual(noteHits[0].eventIds, [note.id]);
	assert.equal(violationsFor(notes, "outOfBoundaryBgNotes").length, 0);

	const backgrounds = validChart();
	const bgNote = addNote(backgrounds, "bgNote", 1, 150, 0);
	const bgHits = violationsFor(backgrounds, "outOfBoundaryBgNotes");
	assert.equal(bgHits.length, 1);
	assert.deepEqual(bgHits[0].eventIds, [bgNote.id]);
	assert.equal(violationsFor(backgrounds, "outOfBoundaryNotes").length, 0);

	const inside = validChart();
	addNote(inside, "tap", 1, 100, 50);
	addNote(inside, "bgNote", 1, -100, -50);
	assert.equal(violationsFor(inside, "outOfBoundaryNotes").length, 0);
	assert.equal(violationsFor(inside, "outOfBoundaryBgNotes").length, 0);
});

test("shortHold and shortBgPattern use the 0.1s default", () => {
	const short = validChart();
	const hold = addNote(short, "hold", 1, 0, 0, { duration: [0, 1, 16] });
	const holdHits = violationsFor(short, "shortHold");
	assert.equal(holdHits.length, 1);
	assert.deepEqual(holdHits[0].eventIds, [hold.id]);
	assert.equal(holdHits[0].params.seconds, 0.1);

	const longHold = validChart();
	addNote(longHold, "hold", 1, 0, 0, { duration: [1, 0, 1] });
	assert.equal(violationsFor(longHold, "shortHold").length, 0);

	const pattern = validChart();
	const grid = addNote(pattern, "grid", 1, 0, 0, { duration: [0, 1, 16] });
	const patternHits = violationsFor(pattern, "shortBgPattern");
	assert.equal(patternHits.length, 1);
	assert.deepEqual(patternHits[0].eventIds, [grid.id]);
});

test("shortTipPoint uses the 0.3s default", () => {
	const short = validChart();
	const event = addNote(short, "tap", 4, 0, 0, {
		tipPointSpawnType: "drop",
		tipPointSpawnTime: 0.05,
	});
	const hits = violationsFor(short, "shortTipPoint");
	assert.equal(hits.length, 1);
	assert.deepEqual(hits[0].eventIds, [event.id]);
	assert.equal(hits[0].params.seconds, 0.3);

	const longLived = validChart();
	addNote(longLived, "tap", 4, 0, 0, { tipPointSpawnType: "drop", tipPointSpawnTime: 1 });
	assert.equal(violationsFor(longLived, "shortTipPoint").length, 0);
});

test("sharpTipPointTurn flags a pi reversal along a chain", () => {
	const model = validChart();
	const vertex = addNote(model, "tap", 2, 0, 0, { tipPointSpawnType: "chain" });
	addNote(model, "tap", 3, 0, 100, { tipPointSpawnType: "inherit" });
	const hits = violationsFor(model, "sharpTipPointTurn");
	assert.equal(hits.length, 1);
	assert.deepEqual(hits[0].eventIds, [vertex.id]);
});

test("teleportingTipPoint flags simultaneous connected events at different positions", () => {
	const model = validChart();
	const first = addNote(model, "tap", 2, 0, 0, { tipPointSpawnType: "chain" });
	const second = addNote(model, "tap", 2, 30, 0, { tipPointSpawnType: "inherit" });
	const hits = violationsFor(model, "teleportingTipPoint");
	assert.equal(hits.length, 1);
	assert.deepEqual(hits[0].eventIds, [first.id, second.id]);

	const aligned = validChart();
	addNote(aligned, "tap", 2, 0, 0, { tipPointSpawnType: "chain" });
	addNote(aligned, "tap", 2, 0, 0, { tipPointSpawnType: "inherit" });
	assert.equal(violationsFor(aligned, "teleportingTipPoint").length, 0);
});

test("multiCharacterCjk flags mixed and doubled CJK but not a single CJK or ASCII", () => {
	const mixed = validChart();
	const badMixed = addNote(mixed, "tap", 1, 0, 0, { text: "啊a" });
	assert.deepEqual(violationsFor(mixed, "multiCharacterCjk").map(item => item.eventIds[0]), [
		badMixed.id,
	]);

	const doubled = validChart();
	const badDouble = addNote(doubled, "tap", 1, 0, 0, { text: "啊啊" });
	assert.deepEqual(violationsFor(doubled, "multiCharacterCjk").map(item => item.eventIds[0]), [
		badDouble.id,
	]);

	const ok = validChart();
	addNote(ok, "tap", 1, 0, 0, { text: "啊" });
	addNote(ok, "tap", 2, 0, 0, { text: "aa" });
	assert.equal(violationsFor(ok, "multiCharacterCjk").length, 0);
});

test("eventsOutsideMusic uses the provided music bounds", () => {
	const model = validChart();
	const early = addNote(model, "tap", 0);
	const late = addNote(model, "tap", 8);
	const hits = violationsFor(model, "eventsOutsideMusic", {}, { music: { start: 0, duration: 2 } });
	assert.deepEqual(
		hits.map(item => item.eventIds[0]),
		[late.id],
	);
	const shifted = violationsFor(
		model,
		"eventsOutsideMusic",
		{},
		{ music: { start: 1, duration: 5 } },
	);
	assert.ok(shifted.some(item => item.eventIds[0] === early.id));
});

test("disabled checks produce no violations and null-time sorts first", () => {
	const model = validChart({ metadata: { title: "" } });
	addNote(model, "tap", 1, 150, 0);
	const disabled = defaultChecks();
	disabled.emptyMetadata.enabled = false;
	assert.equal(
		runChecks(model, { checks: disabled }).filter(item => item.check === "emptyMetadata").length,
		0,
	);

	const mixed = defaultChecks();
	for (const id of CHECK_IDS) {
		mixed[id].enabled = id === "emptyMetadata" || id === "outOfBoundaryNotes";
	}
	const ordered = runChecks(model, { checks: mixed });
	assert.ok(ordered.length >= 2);
	assert.equal(ordered[0].time, null);
	assert.equal(ordered[0].check, "emptyMetadata");
	assert.ok(ordered[1].time != null);
});

test("exportOrderedEvents sorts by time, then channel, then stacking order", () => {
	const model = validChart();
	const later = addNote(model, "tap", 2, 0, 0, { channel: 0 });
	const early = addNote(model, "tap", 1, 0, 0, { channel: 0 });
	const lower = model.addChannel();
	const otherChannel = addNote(model, "tap", 2, 1, 0, { channel: lower.id });
	const stacked = addNote(model, "tap", 2, 2, 0, { channel: 0 });
	const ordered = exportOrderedEvents(model, [otherChannel, stacked, later, early]);
	assert.deepEqual(
		ordered.map(event => event.id),
		[early.id, later.id, stacked.id, otherChannel.id],
	);
});

test("rationalGcd drives attach-by-time indices", () => {
	const half = new Rational(1, 2);
	const third = new Rational(1, 3);
	const gcd = rationalGcd(half, third);
	assert.equal(gcd.numerator, 1n);
	assert.equal(gcd.denominator, 6n);
	assert.equal(rationalGcd(new Rational(0, 1), half).toNumber(), 0.5);
	assert.deepEqual(attachTimeIndices([[0, 0, 1], [0, 1, 2], [1, 0, 1]]), [0, 1, 2]);
	assert.deepEqual(attachTimeIndices([[1, 0, 1], [1, 0, 1]]), [0, 0]);
});

test("NDArray zeros, get and set", () => {
	const array = NDArray.zeros([2, 3]);
	assert.equal(array.get(0, 0), 0);
	assert.equal(array.get(1, 2), 0);
	array.set(1, 2, 5);
	assert.equal(array.get(1, 2), 5);
	assert.equal(array.get(0, 1), 0);
});

test("energy novelty of an impulse has a peak", () => {
	const sampleRate = 4000;
	const samples = new Float32Array(2000);
	samples[1000] = 1;
	const result = computeNovelty(samples, sampleRate, "energy", {
		windowLength: 256,
		hopSize: 64,
		localAverageWindow: 3,
	});
	let peak = -Infinity;
	let peakIndex = -1;
	for (let index = 0; index < result.novelty.length; index += 1) {
		if (result.novelty[index] > peak) {
			peak = result.novelty[index];
			peakIndex = index;
		}
	}
	assert.ok(peak > 0.5);
	assert.ok(peakIndex > 2);
	assert.ok(peakIndex < result.novelty.length - 2);
});

test("tautString recovers a single BPM from a constant-BPM sequence", () => {
	const beats = Array.from({ length: 8 }, (_, index) => index * 0.5);
	const nodes = tautString(beats, beats, beats);
	const values = nodesToValues(nodes, beats.length);
	const intervals = [];
	for (let index = 1; index < values.length; index += 1) {
		intervals.push(values[index] - values[index - 1]);
	}
	const timing = timingFromDenoisedBeats({ beats: Array.from(values), intervals });
	assert.ok(Math.abs(timing.initialBpm - 120) < 1e-6);
	assert.equal(timing.bpmChanges.length, 0);
});

test("AUTO_TIMING_DEFAULTS use energy novelty, fourier tempogram and plp beats", () => {
	assert.equal(AUTO_TIMING_DEFAULTS.novelty, "energy");
	assert.equal(AUTO_TIMING_DEFAULTS.tempogram, "fourier");
	assert.equal(AUTO_TIMING_DEFAULTS.beat, "plp");
});

test("v17 source wiring for checks tab, icons, eslint, lint and editor defaults", async () => {
	const [html, eslintSource, packageSource, offsetIcon, bgNoteIcon, boundaryIcon] =
		await Promise.all([
			readFile(new URL("../index.html", import.meta.url), "utf8"),
			readFile(new URL("../eslint.config.mjs", import.meta.url), "utf8"),
			readFile(new URL("../package.json", import.meta.url), "utf8"),
			readFile(new URL("../svg/icons/adjust-offset.svg", import.meta.url), "utf8"),
			readFile(new URL("../svg/icons/bg-note-se.svg", import.meta.url), "utf8"),
			readFile(new URL("../svg/icons/show-chart-boundary.svg", import.meta.url), "utf8"),
		]);
	assert.match(html, /id="checks-tab"/);
	assert.match(html, /id="play-bg-note-se"/);
	assert.match(html, /id="show-chart-boundary"/);
	const history = html.match(/<section class="history-panel"[\s\S]*?<\/section>/);
	assert.ok(history);
	assert.doesNotMatch(history[0], /<h[1-6]\b/i);
	assert.match(offsetIcon, /<svg/i);
	assert.match(bgNoteIcon, /<svg/i);
	assert.match(boundaryIcon, /<svg/i);
	assert.match(eslintSource, /max-lines[\s\S]*max:\s*1000/);
	assert.match(eslintSource, /max-lines-per-function[\s\S]*max:\s*100/);
	assert.match(eslintSource, /max-len[\s\S]*code:\s*120/);
	assert.match(eslintSource, /curly:\s*\["error",\s*"all"\]/);
	assert.match(eslintSource, /"multiline-ternary":\s*\["error",\s*"never"\]/);
	const pkg = JSON.parse(packageSource);
	assert.equal(pkg.scripts.lint, "eslint . --max-warnings 0");
	assert.match(pkg.scripts.test, /check-source-size\.mjs && eslint \. --max-warnings 0 && node --test/);
	assert.equal(pkg.scripts.build, "npm test && node scripts/build-nw.mjs");
	assert.equal(COMMAND_DEFINITIONS["music.seekBackward3"].shortcut, "Ctrl+Shift+,");
	assert.equal(DEFAULT_EDITOR.showChartBoundary, true);
	assert.equal(DEFAULT_EDITOR.playBgNoteSe, false);
	assert.equal(ChartModel.createDefault().editor.showChartBoundary, true);
	assert.equal(ChartModel.createDefault().editor.playBgNoteSe, false);
});

test("v17 music volume clamps to 1 while SE volume still allows 2", () => {
	const stored = storePreferences({ seVolume: 2.5, musicVolume: 1.5 }, memoryStorage());
	assert.equal(stored.seVolume, 2);
	assert.equal(stored.musicVolume, 1);
	const loaded = loadPreferences(
		memoryStorage({
			[PREFERENCES_KEY]: JSON.stringify({ seVolume: 2, musicVolume: 1.5 }),
		}),
	);
	assert.equal(loaded.seVolume, 2);
	assert.equal(loaded.musicVolume, 1);
	const player = new AudioPlayer();
	player.setMusicVolume(1.5);
	assert.equal(player.musicVolume, 1);
	player.setSeVolume(2.5);
	assert.equal(player.seVolume, 2);
	player.setMusicVolume(-1);
	assert.equal(player.musicVolume, 0);
});
