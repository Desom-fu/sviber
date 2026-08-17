const DEFAULT_MAX_DENOMINATOR = 1_000_000;

function absBigInt(value) {
	return value < 0n ? -value : value;
}

function gcd(left, right) {
	left = absBigInt(left);
	right = absBigInt(right);
	while (right !== 0n) {
		[left, right] = [right, left % right];
	}
	return left || 1n;
}

function toBigInt(value, label) {
	if (typeof value === "bigint") return value;
	if (typeof value !== "number" || !Number.isSafeInteger(value)) {
		throw new TypeError(`${label} must be a safe integer`);
	}
	return BigInt(value);
}

function safeNumber(value, label) {
	const result = Number(value);
	if (!Number.isSafeInteger(result)) {
		throw new RangeError(`${label} cannot be represented as a safe JSON integer`);
	}
	return result;
}

function decimalStringToRatio(value) {
	const text = String(value).toLowerCase();
	const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/.exec(text);
	if (!match) return null;

	const sign = match[1] === "-" ? -1n : 1n;
	const fraction = match[3] || "";
	const exponent = Number(match[4] || 0) - fraction.length;
	let numerator = BigInt(`${match[2]}${fraction}` || "0") * sign;
	let denominator = 1n;
	if (exponent >= 0) {
		numerator *= 10n ** BigInt(exponent);
	} else {
		denominator = 10n ** BigInt(-exponent);
	}
	return [numerator, denominator];
}

function limitRatio(numerator, denominator, maxDenominator) {
	const sign = numerator < 0n ? -1n : 1n;
	numerator = absBigInt(numerator);
	const maximum = BigInt(maxDenominator);
	if (denominator <= maximum) return [numerator * sign, denominator];

	let p0 = 0n;
	let q0 = 1n;
	let p1 = 1n;
	let q1 = 0n;
	let n = numerator;
	let d = denominator;

	while (d !== 0n) {
		const quotient = n / d;
		const q2 = q0 + quotient * q1;
		if (q2 > maximum) break;
		[p0, p1] = [p1, p0 + quotient * p1];
		[q0, q1] = [q1, q2];
		[n, d] = [d, n - quotient * d];
	}

	if (q1 === 0n) return [p0 * sign, q0];
	const k = (maximum - q0) / q1;
	const candidateA = [p0 + k * p1, q0 + k * q1];
	const candidateB = [p1, q1];
	const errorA = absBigInt(numerator * candidateA[1] - candidateA[0] * denominator) * candidateB[1];
	const errorB = absBigInt(numerator * candidateB[1] - candidateB[0] * denominator) * candidateA[1];
	const chosen = errorB <= errorA ? candidateB : candidateA;
	return [chosen[0] * sign, chosen[1]];
}

function roundRatio(numerator, denominator) {
	const quotient = numerator / denominator;
	const remainder = numerator % denominator;
	if (remainder === 0n) return quotient;
	const doubled = absBigInt(remainder) * 2n;
	if (doubled < denominator) return quotient;
	return quotient + (numerator < 0n ? -1n : 1n);
}

/**
 * An immutable exact rational number.
 *
 * JSON tuples use `whole + numerator / denominator`. Negative mixed numbers
 * are canonicalized toward zero, for example -1.5 is `[-1, -1, 2]`.
 */
export class Rational {
	constructor(numerator = 0, denominator = 1) {
		let normalizedNumerator = toBigInt(numerator, "numerator");
		let normalizedDenominator = toBigInt(denominator, "denominator");
		if (normalizedDenominator === 0n) throw new RangeError("denominator must not be zero");
		if (normalizedDenominator < 0n) {
			normalizedNumerator = -normalizedNumerator;
			normalizedDenominator = -normalizedDenominator;
		}
		const divisor = gcd(normalizedNumerator, normalizedDenominator);
		this.numerator = normalizedNumerator / divisor;
		this.denominator = normalizedDenominator / divisor;
		Object.freeze(this);
	}

	static from(value = 0) {
		if (value instanceof Rational) return value;
		if (typeof value === "bigint") return new Rational(value, 1n);
		if (typeof value === "number") {
			return Number.isInteger(value)
				? new Rational(toBigInt(value, "value"), 1n)
				: Rational.fromNumber(value);
		}
		if (typeof value === "string") return Rational.parse(value);
		if (Array.isArray(value)) {
			if (value.length === 3) {
				const whole = toBigInt(value[0], "whole");
				const numerator = toBigInt(value[1], "numerator");
				const denominator = toBigInt(value[2], "denominator");
				return new Rational(whole * denominator + numerator, denominator);
			}
			if (value.length === 2) return new Rational(value[0], value[1]);
		}
		if (value && typeof value === "object") {
			if (Object.hasOwn(value, "whole")) {
				return Rational.from([value.whole, value.numerator ?? 0, value.denominator ?? 1]);
			}
			if (Object.hasOwn(value, "numerator")) {
				return new Rational(value.numerator, value.denominator ?? 1);
			}
		}
		throw new TypeError("value is not a rational number");
	}

	static parse(value) {
		const text = String(value).trim();
		let match = /^([+-]?\d+)\s*([+-])\s*(\d+)\s*\/\s*([+-]?\d+)$/.exec(text);
		if (match) {
			const numerator = Number(match[3]) * (match[2] === "-" ? -1 : 1);
			return Rational.from([Number(match[1]), numerator, Number(match[4])]);
		}
		match = /^([+-]?\d+)\s+([+-]?\d+)\s*\/\s*([+-]?\d+)$/.exec(text);
		if (match) return Rational.from(match.slice(1).map(Number));
		match = /^([+-]?\d+)\s*\/\s*([+-]?\d+)$/.exec(text);
		if (match) return new Rational(Number(match[1]), Number(match[2]));
		if (/^[+-]?\d+$/.test(text)) return new Rational(Number(text), 1);
		const number = Number(text);
		if (Number.isFinite(number)) return Rational.fromNumber(number);
		throw new TypeError(`Invalid rational number: ${value}`);
	}

	static fromNumber(value, maxDenominator = DEFAULT_MAX_DENOMINATOR) {
		if (!Number.isFinite(value)) throw new TypeError("value must be finite");
		if (!Number.isSafeInteger(maxDenominator) || maxDenominator < 1) {
			throw new RangeError("maxDenominator must be a positive safe integer");
		}
		if (Object.is(value, -0)) value = 0;
		const ratio = decimalStringToRatio(value);
		if (!ratio) throw new TypeError("value cannot be converted to a rational number");
		const [numerator, denominator] = limitRatio(ratio[0], ratio[1], maxDenominator);
		return new Rational(numerator, denominator);
	}

	static normalize(value) {
		return Rational.from(value).toJSON();
	}

	static compare(left, right) {
		return Rational.from(left).compare(right);
	}

	static snap(value, subdivision) {
		return Rational.from(value).snap(subdivision);
	}

	add(other) {
		const right = Rational.from(other);
		return new Rational(
			this.numerator * right.denominator + right.numerator * this.denominator,
			this.denominator * right.denominator,
		);
	}

	sub(other) {
		const right = Rational.from(other);
		return new Rational(
			this.numerator * right.denominator - right.numerator * this.denominator,
			this.denominator * right.denominator,
		);
	}

	mul(other) {
		const right = Rational.from(other);
		return new Rational(this.numerator * right.numerator, this.denominator * right.denominator);
	}

	div(other) {
		const right = Rational.from(other);
		if (right.numerator === 0n) throw new RangeError("cannot divide by zero");
		return new Rational(this.numerator * right.denominator, this.denominator * right.numerator);
	}

	negate() {
		return new Rational(-this.numerator, this.denominator);
	}

	abs() {
		return this.numerator < 0n ? this.negate() : this;
	}

	compare(other) {
		const right = Rational.from(other);
		const difference = this.numerator * right.denominator - right.numerator * this.denominator;
		return difference < 0n ? -1 : difference > 0n ? 1 : 0;
	}

	equals(other) {
		try {
			return this.compare(other) === 0;
		} catch {
			return false;
		}
	}

	normalize() {
		return this;
	}

	snap(subdivision) {
		if (!Number.isSafeInteger(subdivision) || subdivision < 1) {
			throw new RangeError("subdivision must be a positive safe integer");
		}
		const units = roundRatio(this.numerator * BigInt(subdivision), this.denominator);
		return new Rational(units, BigInt(subdivision));
	}

	toNumber() {
		return Number(this.numerator) / Number(this.denominator);
	}

	toJSON() {
		const whole = this.numerator / this.denominator;
		const remainder = this.numerator % this.denominator;
		return [
			safeNumber(whole, "whole"),
			safeNumber(remainder, "fraction numerator"),
			safeNumber(this.denominator, "denominator"),
		];
	}

	toTuple() {
		return this.toJSON();
	}

	toString() {
		const [whole, numerator, denominator] = this.toJSON();
		if (numerator === 0) return String(whole);
		if (whole === 0) return `${numerator}/${denominator}`;
		return `${whole}${numerator < 0 ? "" : "+"}${numerator}/${denominator}`;
	}

	valueOf() {
		return this.toNumber();
	}
}

export function normalizeRational(value) {
	return Rational.normalize(value);
}

export function snapRational(value, subdivision) {
	return Rational.snap(value, subdivision);
}

export const normalize = normalizeRational;
export const fromNumber = (value, maxDenominator) => Rational.fromNumber(value, maxDenominator);
export const toNumber = (value) => Rational.from(value).toNumber();
export const add = (left, right) => Rational.from(left).add(right);
export const sub = (left, right) => Rational.from(left).sub(right);
export const compare = (left, right) => Rational.compare(left, right);
export const snap = snapRational;

export const ZERO = new Rational(0, 1);
export const ONE = new Rational(1, 1);

export default Rational;
