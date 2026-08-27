// Field definitions for the "Automatic timing..." popup form. Each algorithm radio
// group is followed by one <details> element per option holding that option's
// parameters; the <details> is hidden unless its radio input is checked.

import { NOVELTY_ALGORITHMS } from "./dsp/novelty.js";
import { TEMPOGRAM_ALGORITHMS } from "./dsp/tempogram.js";
import { BEAT_ALGORITHMS } from "./dsp/beat-tracking.js";

const WINDOW_TYPE_OPTIONS = Object.freeze([
	{ value: "hann", labelKey: "option.window.hann" },
	{ value: "hamming", labelKey: "option.window.hamming" },
	{ value: "blackman", labelKey: "option.window.blackman" },
	{ value: "rectangular", labelKey: "option.window.rectangular" },
]);

function number(id, defaultValue, options = {}) {
	return {
		id,
		type: options.integer ? "integer" : "number",
		labelKey: `field.autoTiming.${id.split(".").at(-1)}`,
		tooltipKey: `field.autoTiming.${id.split(".").at(-1)}.hint`,
		value: defaultValue,
		min: options.min,
		step: options.integer ? 1 : "any",
	};
}

function windowSelect(id, defaultValue) {
	return {
		id,
		type: "select",
		labelKey: "field.autoTiming.windowType",
		tooltipKey: "field.autoTiming.windowType.hint",
		value: defaultValue,
		options: WINDOW_TYPE_OPTIONS,
	};
}

function details(id, summaryKey, fields, visibleWhen) {
	return { id, type: "details", summaryKey, hideLabel: true, fields, hidden: visibleWhen };
}

const NOVELTY_FIELDS = Object.freeze({
	energy: () => [
		number("windowLength", 1024, { integer: true, min: 16 }),
		number("hopSize", 256, { integer: true, min: 1 }),
		windowSelect("windowType", "hann"),
		{
			id: "logarithmic",
			type: "checkbox",
			labelKey: "field.autoTiming.logarithmic",
			tooltipKey: "field.autoTiming.logarithmic.hint",
			value: true,
		},
		number("gamma", 10, { min: 1 }),
		number("localAverageWindow", 5, { integer: true, min: 0 }),
	],
	spectral: () => [
		number("windowLength", 1024, { integer: true, min: 16 }),
		number("hopSize", 512, { integer: true, min: 1 }),
		windowSelect("windowType", "hann"),
		number("gamma", 100, { min: 1 }),
		number("localAverageWindow", 10, { integer: true, min: 0 }),
	],
	phase: () => [
		number("windowLength", 1024, { integer: true, min: 16 }),
		number("hopSize", 512, { integer: true, min: 1 }),
		windowSelect("windowType", "hann"),
		number("localAverageWindow", 10, { integer: true, min: 0 }),
	],
	complex: () => [
		number("windowLength", 1024, { integer: true, min: 16 }),
		number("hopSize", 512, { integer: true, min: 1 }),
		windowSelect("windowType", "hann"),
		number("localAverageWindow", 10, { integer: true, min: 0 }),
	],
});

function tempogramFields(algorithm) {
	return [
		number("windowSeconds", 8, { min: 0.5 }),
		number("hopSeconds", 0.25, { min: 0.01 }),
		windowSelect("windowType", algorithm === "autocorrelation" ? "rectangular" : "hann"),
		number("minimumTempo", 60, { min: 1 }),
		number("maximumTempo", 200, { min: 2 }),
		number("tempoStep", 1, { min: 0.1 }),
	];
}

const BEAT_FIELDS = Object.freeze({
	plp: () => [number("peakThreshold", 0.1, { min: 0 })],
	dynamicProgramming: () => [
		number("lambda", 10, { min: 0 }),
		{
			id: "tempoSource",
			type: "radio",
			labelKey: "field.autoTiming.tempoSource",
			tooltipKey: "field.autoTiming.tempoSource.hint",
			value: "tempogram",
			options: [
				{ value: "tempogram", labelKey: "option.tempoSource.tempogram" },
				{ value: "manual", labelKey: "option.tempoSource.manual" },
			],
		},
		{
			...number("manualTempo", 120, { min: 1 }),
			disabled: values => values.tempoSource !== "manual",
		},
	],
});

export function autoTimingFields() {
	const fields = [
		{
			id: "novelty",
			type: "radio",
			labelKey: "field.autoTiming.novelty",
			tooltipKey: "field.autoTiming.novelty.hint",
			value: "energy",
			options: NOVELTY_ALGORITHMS.map(value => ({ value, labelKey: `option.novelty.${value}` })),
		},
	];
	for (const algorithm of NOVELTY_ALGORITHMS) {
		fields.push(
			details(
				`noveltyParameters.${algorithm}`,
				`option.novelty.${algorithm}`,
				NOVELTY_FIELDS[algorithm](),
				values => values.novelty !== algorithm,
			),
		);
	}
	fields.push({
		id: "tempogram",
		type: "radio",
		labelKey: "field.autoTiming.tempogram",
		tooltipKey: "field.autoTiming.tempogram.hint",
		value: "fourier",
		options: TEMPOGRAM_ALGORITHMS.map(value => ({ value, labelKey: `option.tempogram.${value}` })),
	});
	for (const algorithm of TEMPOGRAM_ALGORITHMS) {
		fields.push(
			details(
				`tempogramParameters.${algorithm}`,
				`option.tempogram.${algorithm}`,
				tempogramFields(algorithm),
				values => values.tempogram !== algorithm,
			),
		);
	}
	fields.push({
		id: "beat",
		type: "radio",
		labelKey: "field.autoTiming.beat",
		tooltipKey: "field.autoTiming.beat.hint",
		value: "plp",
		options: BEAT_ALGORITHMS.map(value => ({ value, labelKey: `option.beat.${value}` })),
	});
	for (const algorithm of BEAT_ALGORITHMS) {
		fields.push(
			details(
				`beatParameters.${algorithm}`,
				`option.beat.${algorithm}`,
				BEAT_FIELDS[algorithm](),
				values => values.beat !== algorithm,
			),
		);
	}
	fields.push(
		details(
			"denoiseParameters",
			"field.autoTiming.denoise",
			[
				number("tolerance", 0.00001, { min: 0 }),
				number("lambda", 0.05, { min: 0 }),
				number("minimumConfidence", 0.1, { min: 0 }),
			],
			() => false,
		),
	);
	fields.push(
		details(
			"refineParameters",
			"field.autoTiming.refine",
			[
				number("searchSeconds", 0.03, { min: 0 }),
				number("stepSamples", 16, { integer: true, min: 1 }),
				number("windowSamples", 256, { integer: true, min: 16 }),
			],
			() => false,
		),
	);
	return fields;
}

export function readAutoTimingOptions(values, defaults) {
	const options = {
		novelty: values.novelty || defaults.novelty,
		tempogram: values.tempogram || defaults.tempogram,
		beat: values.beat || defaults.beat,
		noveltyParameters: {},
		tempogramParameters: {},
		beatParameters: {},
		denoiseParameters: values.denoiseParameters || defaults.denoiseParameters,
		refineParameters: values.refineParameters || defaults.refineParameters,
	};
	for (const algorithm of NOVELTY_ALGORITHMS) {
		options.noveltyParameters[algorithm] =
			values[`noveltyParameters.${algorithm}`] || defaults.noveltyParameters[algorithm];
	}
	for (const algorithm of TEMPOGRAM_ALGORITHMS) {
		options.tempogramParameters[algorithm] =
			values[`tempogramParameters.${algorithm}`] || defaults.tempogramParameters[algorithm];
	}
	for (const algorithm of BEAT_ALGORITHMS) {
		options.beatParameters[algorithm] = values[`beatParameters.${algorithm}`] || defaults.beatParameters[algorithm];
	}
	return options;
}
