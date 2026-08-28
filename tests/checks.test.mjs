import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { COMMAND_DEFINITIONS } from "../js/app/commands.js";
import { ChartModel } from "../js/core/chart-model.js";
import { DEFAULT_EDITOR, DIFFICULTY_COLORS } from "../js/core/chart-vocabulary.js";
import { CHECK_DEFINITIONS, CHECK_IDS, defaultChecks, runChecks } from "../js/core/checks.js";

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

function violationsFor(model, id, extra = {}, options = {}) {
	return runChecks(model, { checks: enabledOnly(id, extra), ...options }).filter(
		item => item.check === id,
	);
}

function addNote(model, type, beat, x = 0, y = 0, extra = {}) {
	return model.addEvent(type, { time: [beat, 0, 1], x, y, ...extra });
}

function enabledOnly(id, extra = {}) {
	const settings = defaultChecks();
	for (const checkId of CHECK_IDS) {
		settings[checkId].enabled = checkId === id;
	}
	Object.assign(settings[id], extra);
	return settings;
}

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

test("source wiring for checks tab, icons, eslint, lint and editor defaults", async () => {
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

test("left-column checks list cannot cover the scroll view canvas", async () => {
	const [html, css, checks] = await Promise.all([
		readFile(new URL("../index.html", import.meta.url), "utf8"),
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-checks.js", import.meta.url), "utf8"),
	]);
	assert.match(html, /id="checks-panel"[^>]*\bhidden\b/);
	assert.match(css, /grid-template-areas:\s*"tabs"\s*"body"/);
	assert.match(css, /\.scroll-surface,\s*\.checks-panel\s*\{[^}]*grid-area:\s*body/);
	assert.match(css, /\.checks-panel\[hidden\][\s\S]*?display:\s*none/);
	assert.match(css, /\.scroll-surface\.is-inactive\s*\{[^}]*visibility:\s*hidden/);
	assert.match(
		checks,
		/if \(item\.id === "scroll-view"\) \{[\s\S]*is-inactive[\s\S]*\} else \{[\s\S]*item\.panel\.hidden = !active/,
	);
});


// v18 documents which checks carry extra parameters, so the definitions have to keep matching
// that list; the ids themselves are compared against CHECK_ID_LIST above.
test("each check carries exactly the extra parameters v18 documents", () => {
	const parameters = new Map(CHECK_DEFINITIONS.map(definition =>
		[definition.id, definition.parameters.map(parameter => parameter.id)]));
	assert.deepEqual(parameters.get("requiredFingers"), ["fingers"]);
	assert.deepEqual(parameters.get("shortHold"), ["seconds"]);
	assert.deepEqual(parameters.get("shortBgPattern"), ["seconds"]);
	assert.deepEqual(parameters.get("shortTipPoint"), ["seconds"]);
	const parameterized = ["requiredFingers", "shortHold", "shortBgPattern", "shortTipPoint"];
	for (const id of CHECK_ID_LIST.filter(id => !parameterized.includes(id))) {
		assert.deepEqual(parameters.get(id), [], `${id} should have no parameters`);
	}
});
