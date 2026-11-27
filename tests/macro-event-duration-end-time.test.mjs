import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("JS macro API Event supports duration and endTime getters/setters on perdurant events", async () => {
	await import("../js/macro/macro-api.js");
	const runtime = globalThis.createSviberMacroApi({
		channels: [{ id: 0, name: "Main" }],
		events: [],
		snappees: [],
		editor: { currentChannel: 0, currentTime: [0, 0, 1] },
	});
	const { Tap, Hold, Drag, Flick, BgNote, Comment, Grid, Group, Location } = runtime.globals;

	const hold = new Hold({
		location: new Location(0, 0),
		time: [0, 1, 3],
		duration: [0, 1, 6],
	});
	assert.deepEqual(hold.duration, [0, 1, 6]);
	assert.deepEqual(hold.endTime, [0, 1, 2]);

	hold.duration = [1, 1, 2];
	assert.deepEqual(hold.duration, [1, 1, 2]);
	assert.deepEqual(hold.endTime, [1, 5, 6]);

	hold.endTime = [2, 1, 3];
	assert.deepEqual(hold.time, [0, 1, 3]);
	assert.deepEqual(hold.duration, [2, 0, 1]);
	assert.deepEqual(hold.endTime, [2, 1, 3]);

	// bgNote and comment accept zero duration (endTime == time), while hold and patterns require positive duration.
	const bgNote = new BgNote({ location: new Location(1, 2), time: [3, 0, 1], duration: [1, 0, 1] });
	bgNote.endTime = [3, 0, 1];
	assert.deepEqual(bgNote.duration, [0, 0, 1]);
	assert.deepEqual(bgNote.endTime, [3, 0, 1]);

	const comment = new Comment({ time: [2, 0, 1], duration: [0, 0, 1], text: "note" });
	comment.endTime = [4, 1, 2];
	assert.deepEqual(comment.duration, [2, 1, 2]);

	const grid = new Grid({ time: [1, 0, 1], duration: [2, 0, 1] });
	assert.deepEqual(grid.endTime, [3, 0, 1]);
	grid.endTime = [5, 0, 1];
	assert.deepEqual(grid.duration, [4, 0, 1]);

	assert.throws(() => {
		hold.duration = 0;
	}, RangeError);
	assert.throws(() => {
		hold.endTime = [0, 1, 3];
	}, RangeError);
	assert.throws(() => {
		hold.endTime = [0, 0, 1];
	}, RangeError);
	assert.throws(() => {
		bgNote.endTime = [2, 0, 1];
	}, RangeError);

	// Non-perdurant events reject duration and endTime access.
	const tap = new Tap({ location: new Location(0, 0), time: [1, 0, 1] });
	const drag = new Drag({ location: new Location(0, 0), time: [1, 0, 1] });
	const flick = new Flick({ location: new Location(0, 0), time: [1, 0, 1], angle: 0 });
	const group = new Group({ events: [tap] });
	for (const event of [drag, flick, group]) {
		assert.throws(() => event.duration, /do not have a duration/);
		assert.throws(() => {
			event.duration = 1;
		}, /do not have a duration/);
		assert.throws(() => event.endTime, /do not have a duration/);
		assert.throws(() => {
			event.endTime = 2;
		}, /do not have a duration/);
	}

	hold.delete();
	assert.throws(() => hold.duration, /deleted/);
	assert.throws(() => hold.endTime, /deleted/);
});

test("Ruby macro API and sandbox bundle expose Event#duration, #duration=, #end_time, #end_time=", async () => {
	const [rubySource, bundleSource] = await Promise.all([
		readFile(new URL("../js/macro/macro-api.rb", import.meta.url), "utf8"),
		readFile(new URL("../js/macro/macro-sandbox.bundle.js", import.meta.url), "utf8"),
	]);
	assert.match(rubySource, /def duration\b/);
	assert.match(rubySource, /def duration=/);
	assert.match(rubySource, /def end_time\b/);
	assert.match(rubySource, /def end_time=/);
	assert.match(bundleSource, /get endTime\(/);
	assert.match(bundleSource, /set endTime\(/);

	let rubyAvailable = true;
	try {
		execFileSync("ruby", ["--version"], { stdio: "ignore" });
	} catch {
		rubyAvailable = false;
	}
	if (!rubyAvailable) {
		return;
	}
	const initialState = JSON.stringify({
		editor: { currentChannel: 0, currentTime: [0, 0, 1] },
		channels: [{ id: 0, name: "Main", color: "#ffffff", active: true }],
		events: [],
		snappees: [],
		clips: [],
		timing: { offset: 0, initialBpm: 120, bpmChanges: [], barLines: [] },
	});
	const output = execFileSync(
		"ruby",
		[
			"-e",
			[
				'require_relative "js/macro/macro-api.rb"',
				"$stdout = STDOUT",
				`SviberMacroInternals.load_json(${JSON.stringify(initialState)})`,
				"hold = Hold.new(location: Location.new(0, 0), time: Rational(1, 3), duration: Rational(1, 6))",
				'raise "initial duration" unless hold.duration == Rational(1, 6)',
				'raise "initial end_time" unless hold.end_time == Rational(1, 2)',
				"hold.duration = Rational(3, 2)",
				'raise "updated end_time" unless hold.end_time == Rational(11, 6)',
				"hold.end_time = Rational(7, 3)",
				'raise "time stayed" unless hold.time == Rational(1, 3)',
				'raise "duration from end_time" unless hold.duration == Rational(2, 1)',
				"bg = BgNote.new(location: Location.new(0, 0), time: 3, duration: 1)",
				"bg.end_time = 3",
				'raise "bg zero duration" unless bg.duration == 0',
				"tap = Tap.new(location: Location.new(0, 0), time: 1)",
				"tap_failed = false",
				"begin; tap.end_time; rescue RuntimeError; tap_failed = true; end",
				'raise "tap end_time should fail" unless tap_failed',
				"neg_failed = false",
				"begin; hold.end_time = hold.time; rescue ArgumentError; neg_failed = true; end",
				'raise "hold zero end_time should fail" unless neg_failed',
				'puts "ok"',
			].join("\n"),
		],
		{ encoding: "utf8" },
	);
	assert.equal(output.trim(), "ok");
});
