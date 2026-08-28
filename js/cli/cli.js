// Command line interface of the NW.js app (v17).
//
// The GUI is skipped whenever a CLI flag is given; the same binary then performs
// basic file manipulations: exporting a Sunniesnow level, a Sunniesnow chart or a
// Lyrica chart, and importing any of those as a sviber chart or a sviber project.

import { Rational } from "../core/rational.js";
export const CLI_FLAGS = Object.freeze([
	"--export",
	"--import",
	"--help",
	"-h",
	"--offset",
	"--initial-bpm",
	"--largest-denominator",
	"--bpm-change",
	"--seed",
	"--quantization-denominator",
	"--charter",
	"--difficulty-name",
	"--difficulty-color",
	"--difficulty",
	"--difficulty-sup",
	"--chart",
]);

const VALUE_FLAGS = new Map([
	["--export", "exportPath"],
	["--import", "importPath"],
	["--offset", "offset"],
	["--initial-bpm", "initialBpm"],
	["--largest-denominator", "largestDenominator"],
	["--seed", "seed"],
	["--quantization-denominator", "quantizationDenominator"],
	["--charter", "charter"],
	["--difficulty-name", "difficultyName"],
	["--difficulty-color", "difficultyColor"],
	["--difficulty", "difficulty"],
	["--difficulty-sup", "difficultySup"],
	["--chart", "chart"],
]);

export function helpText() {
	return [
		"sviber - Sunniesnow chart editor",
		"",
		"Usage:",
		"  sviber [PATH]                                   open or import a chart, level or project folder",
		"  sviber PATH --export OUTPUT.ssc                 export a Sunniesnow level",
		"  sviber CHART --export OUTPUT.json               export a Sunniesnow chart",
		"  sviber CHART --export OUTPUT.txt                export a Lyrica chart",
		"  sviber INPUT --import OUTPUT.json [options]     import as a sviber chart",
		"  sviber INPUT --import OUTPUT-DIR [options]      import as a sviber project",
		"  sviber --help                                   show this message",
		"",
		"Import options for Sunniesnow charts and levels:",
		"  --offset SECONDS                time of beat 0 (default 0)",
		"  --initial-bpm BPM               BPM before the first BPM change (default 120)",
		"  --largest-denominator N         largest beat denominator used when quantizing (default 192)",
		"  --bpm-change BEAT:BPM           add a BPM change; may be repeated (BEAT accepts 1, 1/2 or 1+1/2)",
		"",
		"Import options for Lyrica charts:",
		"  --seed VALUE                    random seed used for randomized Lyrica events (default 0)",
		"  --quantization-denominator N    largest beat denominator used when quantizing (default 192)",
		"  --charter NAME                  charter written into the imported chart",
		"  --difficulty-name NAME          difficulty name (default Master)",
		"  --difficulty-color COLOR        difficulty color",
		"  --difficulty VALUE              difficulty value",
		"  --difficulty-sup VALUE          difficulty superscript",
		"",
		"Export options:",
		"  --chart ID_OR_FILE              choose one chart of a project when exporting a single chart",
	].join("\n");
}

export function parseCliArguments(argv = []) {
	const result = { paths: [], bpmChanges: [], help: false, unknown: [] };
	for (let index = 0; index < argv.length; index += 1) {
		const token = String(argv[index]);
		if (token === "--help" || token === "-h") {
			result.help = true;
			continue;
		}
		if (token === "--bpm-change") {
			result.bpmChanges.push(String(argv[++index] ?? ""));
			continue;
		}
		if (VALUE_FLAGS.has(token)) {
			result[VALUE_FLAGS.get(token)] = String(argv[++index] ?? "");
			continue;
		}
		if (token.startsWith("-")) {
			result.unknown.push(token);
			continue;
		}
		result.paths.push(token);
	}
	result.input = result.paths[0] || null;
	return result;
}

// True when the arguments ask for a headless operation, so the GUI must not launch.
export function isHeadlessInvocation(args) {
	return Boolean(args.help || args.exportPath || args.importPath || args.unknown.length);
}

function parseBeat(value) {
	const text = String(value).trim();
	const mixed = /^([+-]?\d+)\+(\d+)\/(\d+)$/.exec(text);
	if (mixed) {
		return new Rational(
			Number(mixed[1]) * Number(mixed[3]) + Number(mixed[2]) * Math.sign(Number(mixed[1]) || 1),
			Number(mixed[3]),
		).toJSON();
	}
	const fraction = /^([+-]?\d+)\/(\d+)$/.exec(text);
	if (fraction) {
		return new Rational(Number(fraction[1]), Number(fraction[2])).toJSON();
	}
	return Rational.from(Number(text) || 0).toJSON();
}

export function timingOptionsFrom(args) {
	return {
		offset: Number(args.offset ?? 0) || 0,
		initialBpm: Number(args.initialBpm ?? 120) || 120,
		largestDenominator: Math.max(1, Math.floor(Number(args.largestDenominator ?? 192) || 192)),
		bpmChanges: args.bpmChanges.map(entry => {
			const [beat, bpm] = String(entry).split(":");
			return { time: parseBeat(beat), bpm: Number(bpm) || 120 };
		}),
	};
}

export function lyricaOptionsFrom(args) {
	return {
		charter: String(args.charter ?? ""),
		difficultyName: String(args.difficultyName ?? "Master"),
		difficultyColor: String(args.difficultyColor ?? "#8c68f3"),
		difficulty: String(args.difficulty ?? "12"),
		difficultySup: String(args.difficultySup ?? ""),
		seed: args.seed ?? 0,
		quantizationDenominator: Math.max(1, Math.floor(Number(args.quantizationDenominator ?? 192) || 192)),
	};
}
