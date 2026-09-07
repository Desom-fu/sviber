// Small numeric helpers shared across the core layer.

// Clamps `value` into the closed interval [`minimum`, `maximum`].
export function clamp(value, minimum, maximum) {
	return Math.min(maximum, Math.max(minimum, value));
}
