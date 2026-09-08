// Rounding of rational beat times to a subdivision, with the three tie-break modes the
// Quantization dialog offers (PROMPT-v25 "Quantization...").

import { Rational } from "./rational.js";

export const QUANTIZE_TIE_MODES = Object.freeze(["floor", "ceil", "even"]);

// Divides a BigInt ratio, rounding towards negative infinity.
function floorDiv(numerator, denominator) {
	const truncated = numerator / denominator;
	if (numerator % denominator !== 0n && numerator < 0n) {
		return truncated - 1n;
	}
	return truncated;
}

function absBigInt(value) {
	return value < 0n ? -value : value;
}

// Rounds `value` (a rational beat) to the nearest multiple of 1/subdivision. When the value
// sits exactly halfway between two subdivisions, `tie` decides: "floor" rounds towards
// negative infinity, "ceil" towards positive infinity, and "even" towards the even
// subdivision.
export function quantizeBeat(value, subdivision, tie = "even") {
	if (!QUANTIZE_TIE_MODES.includes(tie)) {
		throw new TypeError(`Unsupported quantization tie mode: ${tie}`);
	}
	const scale = Rational.from(value).mul(new Rational(BigInt(subdivision), 1n));
	const lower = floorDiv(scale.numerator, scale.denominator);
	const remainder = scale.numerator % scale.denominator;
	const upper = remainder === 0n ? lower : lower + 1n;
	let units = lower;
	if (remainder !== 0n) {
		const doubled = absBigInt(remainder) * 2n;
		const negative = scale.numerator < 0n;
		if (doubled === scale.denominator) {
			if (tie === "ceil") {
				units = upper;
			} else if (tie === "even") {
				units = lower % 2n === 0n ? lower : upper;
			}
		} else if (doubled > scale.denominator) {
			units = negative ? lower : upper;
		} else {
			units = negative ? upper : lower;
		}
	}
	return new Rational(units, BigInt(subdivision)).toJSON();
}

// Quantizes the time of `event` and, for perdurant events, its end time. Returns a plain
// overrides object (time plus duration when applicable) without touching the event.
export function quantizeEventTimes(event, subdivision, tie = "even") {
	const result = { time: quantizeBeat(event.time, subdivision, tie) };
	if (event.duration != null) {
		const end = Rational.from(event.time).add(event.duration);
		const quantizedEnd = Rational.from(quantizeBeat(end, subdivision, tie));
		const quantizedStart = Rational.from(result.time);
		result.duration = quantizedEnd.sub(quantizedStart).toJSON();
	}
	return result;
}
