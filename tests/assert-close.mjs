// Shared floating-point assertion for the core test files. It is not a *.test.mjs file so the
// test runner does not pick it up as a suite of its own.
import assert from "node:assert/strict";

export function assertClose(actual, expected, epsilon = 1e-10) {
	assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}
