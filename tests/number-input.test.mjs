import assert from "node:assert/strict";
import test from "node:test";
import * as math from "mathjs";
import { evaluateExpression } from "../js/app/app-helpers.js";

globalThis.math = math;

test("evaluateExpression evaluates direct numeric values", () => {
	assert.equal(evaluateExpression(42), 42);
	assert.equal(evaluateExpression(0), 0);
	assert.equal(evaluateExpression(-12.5), -12.5);
	assert.equal(evaluateExpression(NaN, 5), 5);
	assert.equal(evaluateExpression(Infinity, 10), 10);
});

test("evaluateExpression evaluates numeric and mathematical strings", () => {
	assert.equal(evaluateExpression("100"), 100);
	assert.equal(evaluateExpression("-50.5"), -50.5);
	assert.equal(evaluateExpression("1/2"), 0.5);
	assert.equal(evaluateExpression("1/4"), 0.25);
	assert.equal(evaluateExpression("10 + 2.5"), 12.5);
	assert.equal(evaluateExpression("100 - 25"), 75);
	assert.equal(evaluateExpression("2 * 12.5"), 25);
	assert.equal(evaluateExpression("100 / 4"), 25);
	assert.equal(evaluateExpression("2 + 1/4"), 2.25);
	assert.equal(evaluateExpression("sin(0)"), 0);
});

test("evaluateExpression falls back on invalid expressions", () => {
	assert.equal(evaluateExpression("invalid", 0), 0);
	assert.equal(evaluateExpression("abc", 99), 99);
	assert.equal(evaluateExpression("", 0), 0);
});
