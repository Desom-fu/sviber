import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { COMMAND_DEFINITIONS } from "../js/app/commands.js";
import { ChartModel } from "../js/core/chart-model.js";
import { DEFAULT_EDITOR, DIFFICULTY_COLORS } from "../js/core/chart-vocabulary.js";
import {
	CHECK_DEFINITIONS,
	CHECK_IDS,
	createChecksSteps,
	defaultChecks,
	runChecks,
	sortViolations,
} from "../js/core/checks.js";
import { withChecks } from "../js/app/app-checks.js";
import { withFreeTransform } from "../js/app/app-free-transform.js";
import { withHistoryCommands } from "../js/app/app-history-commands.js";
import { History } from "../js/core/history.js";

const CHECK_ID_LIST = [
	"emptyMetadata",
	"irregularDifficulty",
	"requiredFingers",
	"outOfBoundaryNotes",
	"shortHold",
	"shortBgPattern",
	"shortTipPoint",
	"sharpTipPointTurn",
	"teleportingTipPoint",
	"multiCharacterCjk",
	"eventsOutsideMusic",
	"dragScreening",
	"simultaneousOverlappingNotes",
	"badCharacters",
	"driftingTipPoint",
	"blockedTexts",
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

test("all chart checks exist and are enabled by default", () => {
	assert.deepEqual([...CHECK_IDS], CHECK_ID_LIST);
	assert.equal(CHECK_DEFINITIONS.length, CHECK_ID_LIST.length);
	const defaults = defaultChecks();
	for (const id of CHECK_ID_LIST) {
		assert.equal(defaults[id].enabled, true, id);
	}
	assert.equal(defaults.requiredFingers.fingers, 2);
	assert.equal(defaults.shortHold.seconds, 0.1);
	assert.equal(defaults.shortBgPattern.seconds, 0.1);
	assert.equal(defaults.shortTipPoint.seconds, 0.3);
	assert.equal(defaults.dragScreening.seconds, 0.4);
	assert.equal(defaults.dragScreening.distance, 40);
	assert.equal(defaults.simultaneousOverlappingNotes.invisibleOnly, false);
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

test("outOfBoundaryNotes includes bg notes when the bgNotes parameter is on", () => {
	const notes = validChart();
	const note = addNote(notes, "tap", 1, 150, 0);
	const noteHits = violationsFor(notes, "outOfBoundaryNotes");
	assert.equal(noteHits.length, 1);
	assert.deepEqual(noteHits[0].eventIds, [note.id]);

	const backgrounds = validChart();
	const bgNote = addNote(backgrounds, "bgNote", 1, 150, 0);
	const bgHits = violationsFor(backgrounds, "outOfBoundaryNotes");
	assert.equal(bgHits.length, 1);
	assert.deepEqual(bgHits[0].eventIds, [bgNote.id]);
	assert.equal(violationsFor(backgrounds, "outOfBoundaryNotes", { bgNotes: false }).length, 0);

	const inside = validChart();
	addNote(inside, "tap", 1, 100, 50);
	addNote(inside, "bgNote", 1, -100, -50);
	assert.equal(violationsFor(inside, "outOfBoundaryNotes").length, 0);
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
	assert.equal(pkg.scripts.test, "eslint . --max-warnings 0 && node --test tests/*.test.mjs");
	assert.equal(pkg.scripts.build, "node scripts/build-nw.mjs");
	assert.equal(pkg.scripts["check:size"], undefined);
	assert.equal(COMMAND_DEFINITIONS["music.seekBackward3"].shortcut, "Ctrl+,");
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


// Check ids carry the extra parameters documented with each check.
test("each check carries exactly the extra parameters it documents", () => {
	const parameters = new Map(CHECK_DEFINITIONS.map(definition =>
		[definition.id, definition.parameters.map(parameter => parameter.id)]));
	assert.deepEqual(parameters.get("requiredFingers"), ["fingers"]);
	assert.deepEqual(parameters.get("outOfBoundaryNotes"), ["bgNotes"]);
	assert.deepEqual(parameters.get("shortHold"), ["seconds"]);
	assert.deepEqual(parameters.get("shortBgPattern"), ["seconds"]);
	assert.deepEqual(parameters.get("shortTipPoint"), ["seconds"]);
	assert.deepEqual(parameters.get("dragScreening"), ["seconds", "distance"]);
	assert.deepEqual(parameters.get("simultaneousOverlappingNotes"), ["invisibleOnly"]);
	assert.deepEqual(parameters.get("driftingTipPoint"), ["seconds"]);
	const parameterized = [
		"requiredFingers",
		"outOfBoundaryNotes",
		"shortHold",
		"shortBgPattern",
		"shortTipPoint",
		"dragScreening",
		"simultaneousOverlappingNotes",
		"driftingTipPoint",
	];
	for (const id of CHECK_ID_LIST.filter(id => !parameterized.includes(id))) {
		assert.deepEqual(parameters.get(id), [], `${id} should have no parameters`);
	}
});

test("checks dialog groups parameters under their check and disables them when it is off", async () => {
	const { withChecks } = await import("../js/app/app-checks.js");
	const [css, fieldsSource] = await Promise.all([
		readFile(new URL("../css/dialogs.css", import.meta.url), "utf8"),
		readFile(new URL("../js/ui/ui-fields.js", import.meta.url), "utf8"),
	]);
	const fields = new (withChecks(class {}))()._checkFields();
	assert.equal(fields.length, CHECK_DEFINITIONS.length);
	for (const field of fields) {
		assert.equal(field.type, "group", field.id);
		assert.equal(field.hideLabel, true, field.id);
		assert.equal(field.fields[0].id, "enabled");
		assert.equal(field.fields[0].type, "checkbox");
		const definition = CHECK_DEFINITIONS.find(item => item.id === field.id);
		assert.equal(field.fields.length, 1 + definition.parameters.length, field.id);
		for (const parameter of definition.parameters) {
			const nested = field.fields.find(item => item.id === parameter.id);
			assert.ok(nested, `${field.id}.${parameter.id}`);
			assert.equal(nested.disabled({ enabled: false }), true);
			assert.equal(nested.disabled({ enabled: true }), false);
		}
	}
	assert.match(fieldsSource, /type === "group"/);
	assert.match(css, /\.dialog-group > \.dialog-field:not\(:first-child\)/);
	assert.match(css, /\.dialog-field\.is-disabled/);
});

test("dragScreening flags an unjudged drag that screens a later non-drag note", () => {
	// Default timing is 120 BPM, so one beat lasts 0.5 s; with a 0.6 s screening
	// window a tap one beat after the drag sits inside the after window.
	const model = validChart();
	const drag = addNote(model, "drag", 2, 0, 0);
	addNote(model, "tap", 3, 10, 0);
	const hits = violationsFor(model, "dragScreening", { seconds: 0.6 });
	assert.deepEqual(hits.map(item => item.eventIds[0]), [drag.id]);
	assert.equal(hits[0].target, "event");
});

test("dragScreening ignores covered, drag-only, distant and after-window cases", () => {
	const covered = validChart();
	addNote(covered, "drag", 2, 0, 0);
	addNote(covered, "tap", 1, 0, 0);
	addNote(covered, "tap", 3, 0, 0);
	assert.equal(violationsFor(covered, "dragScreening", { seconds: 0.6 }).length, 0);

	const dragOnly = validChart();
	addNote(dragOnly, "drag", 2, 0, 0);
	addNote(dragOnly, "drag", 3, 0, 0);
	assert.equal(violationsFor(dragOnly, "dragScreening", { seconds: 0.6 }).length, 0);

	const distant = validChart();
	addNote(distant, "drag", 2, 0, 0);
	addNote(distant, "tap", 3, 50, 0);
	assert.equal(violationsFor(distant, "dragScreening", { seconds: 0.6 }).length, 0);

	const afterWindow = validChart();
	addNote(afterWindow, "drag", 2, 0, 0);
	addNote(afterWindow, "tap", 4, 0, 0);
	assert.equal(violationsFor(afterWindow, "dragScreening", { seconds: 0.6 }).length, 0);

	const defaults = validChart();
	addNote(defaults, "drag", 2, 0, 0);
	addNote(defaults, "tap", 3, 0, 0);
	assert.equal(violationsFor(defaults, "dragScreening").length, 0);
});

test("a lightweight commit refreshes the live checks panel off the interaction path", async () => {
	globalThis.document = { title: "", getElementById: () => null };
	const renders = [];
	// The stub refresh() deliberately does not touch the checks panel (only refreshNow
	// does in the real app), so the assertion below can only pass through the lightweight
	// commit path.
	const App = withHistoryCommands(
		withChecks(
			withFreeTransform(
				class {
					commit(label, mutation, options = {}) {
						return this._finishCommit(label, mutation, options, false);
					}

					_invalidatePlaybackSchedule() {}

					_normalizeGroupSelectionScope() {}

					refresh() {}

					refreshInteractionPreview() {}

					requestStatusUpdate() {}

					syncActiveDifficultyState() {}

					broadcastLiveChartUpdate() {}
				},
			),
		),
	);
	const app = new App();
	app.model = validChart();
	app.history = new History(app.model.snapshot());
	app.checksPanel = { render: violations => renders.push(violations.map(item => item.check)) };
	app.refreshChecks();
	assert.deepEqual(renders.at(-1), []);

	app.commit("break checks", model => {
		model.addEvent("tap", { time: [1, 0, 1], x: 500, y: 0, selected: true });
	});
	// The commit must not re-run the checks synchronously; the scheduled refresh follows
	// on an idle slice.
	assert.deepEqual(renders.at(-1), []);
	await new Promise(resolve => setTimeout(resolve, 60));
	assert.deepEqual(renders.at(-1), ["outOfBoundaryNotes"]);
});

test("stepwise checks produce exactly the runChecks result", () => {
	const model = validChart();
	addNote(model, "hold", 2, 200, 0);
	addNote(model, "drag", 4, 0, 0);
	addNote(model, "tap", 4, 0, 0);
	addNote(model, "bgNote", 1, 500, 0);

	const expected = runChecks(model);
	const { violations, steps } = createChecksSteps(model);
	for (const step of steps) {
		step();
	}
	assert.deepEqual(sortViolations(violations), expected);
	// Every check id the full run reports appears in the stepwise result exactly once
	// per violation.
	assert.equal(violations.length, expected.length);
});
