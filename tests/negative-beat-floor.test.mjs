import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { Rational, add, snap, sub } from "../js/core/rational.js";
import { formatBeat } from "../js/app/app-helpers.js";
import { ChartModel } from "../js/core/chart-model.js";
import { addBeat, beatTuple, subBeat } from "../js/macro/macro-api-math.js";

test("negative JSON rational 3-tuples always use floor for the integer part", () => {
	assert.deepEqual(Rational.from([-1, 1, 2]).toJSON(), [-1, 1, 2]);
	assert.deepEqual(Rational.from([0, -1, 2]).toJSON(), [-1, 1, 2]);
	assert.deepEqual(Rational.from("-1/2").toJSON(), [-1, 1, 2]);
	assert.deepEqual(Rational.from(-0.5).toJSON(), [-1, 1, 2]);
	assert.deepEqual(Rational.from(-1.5).toJSON(), [-2, 1, 2]);
	assert.deepEqual(Rational.from([-1, -1, 4]).toJSON(), [-2, 3, 4]);
	assert.deepEqual(Rational.from(-1).toJSON(), [-1, 0, 1]);
	assert.deepEqual(Rational.from(0).toJSON(), [0, 0, 1]);
	assert.deepEqual(Rational.from(0.5).toJSON(), [0, 1, 2]);
	assert.deepEqual(Rational.from(1.5).toJSON(), [1, 1, 2]);
	assert.deepEqual(sub([0, 0, 1], [0, 1, 2]).toJSON(), [-1, 1, 2]);
	assert.deepEqual(add([-1, 1, 2], [0, 1, 2]).toJSON(), [0, 0, 1]);
	assert.deepEqual(snap([0, -1, 4], 2).toJSON(), [-1, 1, 2]);

	// ChartModel serialization preserves floored negative rational tuples.
	const model = ChartModel.createDefault({
		events: [{ id: 1, type: "tap", time: [0, -1, 2], channel: 0, x: 0, y: 0 }],
	});
	assert.deepEqual(model.events[0].time, [-1, 1, 2]);
	const serialized = model.serializeSviber();
	assert.deepEqual(serialized.events[0].time, [-1, 1, 2]);
});

test("status panel beat formatting always uses floor for negative beats", () => {
	assert.equal(formatBeat([-1, 1, 2], 4), "-1+2/4");
	assert.equal(formatBeat([0, -1, 2], 4), "-1+2/4");
	assert.equal(formatBeat(-0.25, 4), "-1+3/4");
	assert.equal(formatBeat(-1.5, 4), "-2+2/4");
	assert.equal(formatBeat(-1, 4), "-1+0/4");
	assert.equal(formatBeat(0, 4), "0+0/4");
	assert.equal(formatBeat([1, 1, 2], 4), "1+2/4");
});

test("macro rational beat helpers floor negative integer parts in JS and Ruby", () => {
	assert.deepEqual(beatTuple(-0.5), [-1, 1, 2]);
	assert.deepEqual(beatTuple([0, -1, 2]), [-1, 1, 2]);
	assert.deepEqual(beatTuple(-1.5), [-2, 1, 2]);
	assert.deepEqual(beatTuple(-1), [-1, 0, 1]);
	assert.deepEqual(subBeat([0, 0, 1], [0, 1, 2]), [-1, 1, 2]);
	assert.deepEqual(addBeat([-1, 1, 2], [0, 1, 4]), [-1, 3, 4]);

	let rubyAvailable = true;
	try {
		execFileSync("ruby", ["--version"], { stdio: "ignore" });
	} catch {
		rubyAvailable = false;
	}
	if (!rubyAvailable) {
		return;
	}
	const output = execFileSync(
		"ruby",
		[
			"-e",
			[
				'require_relative "js/macro/macro-api.rb"',
				"$stdout = STDOUT",
				"puts JSON.generate([",
				"  SviberMacroInternals.beat(Rational(-1, 2)),",
				"  SviberMacroInternals.beat(Rational(-3, 2)),",
				"  SviberMacroInternals.beat(Rational(-1, 4)),",
				"  SviberMacroInternals.beat(-1),",
				"  SviberMacroInternals.beat(0),",
				"  SviberMacroInternals.beat(Rational(3, 2))",
				"])",
			].join("\n"),
		],
		{ encoding: "utf8" },
	);
	assert.deepEqual(JSON.parse(output), [
		[-1, 1, 2],
		[-2, 1, 2],
		[-1, 3, 4],
		[-1, 0, 1],
		[0, 0, 1],
		[1, 1, 2],
	]);
});
