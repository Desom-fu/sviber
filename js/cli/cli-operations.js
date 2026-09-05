// The file operations behind the CLI. Every filesystem and Zip dependency is injected
// so that the whole thing can be exercised from the test suite without NW.js.

import { ChartModel } from "../core/chart-model.js";
import { exportLyricaChart, importLyricaChart, isLyricaChartText } from "../core/lyrica.js";
import {
	PROJECT_FILENAME,
	LEGACY_PROJECT_FILENAME,
	normalizeProjectManifest,
	uniqueChartFilename,
} from "../core/project.js";
import {
	helpText,
	isHeadlessInvocation,
	lyricaOptionsFrom,
	parseCliArguments,
	timingOptionsFrom,
	versionText,
} from "./cli.js";
import packageJson from "../../package.json" with { type: "json" };

const CHART_ORDER_EPSILON = 1e-9;

function extensionOf(pathname) {
	const match = /\.([^./\\]+)$/.exec(String(pathname));
	return match ? match[1].toLowerCase() : "";
}

async function readJson(io, pathname) {
	return JSON.parse(await io.readText(pathname));
}

async function loadProject(io, directory) {
	const hasFile = pathname => (io.fileExists ? io.fileExists(pathname) : true);
	const filename = (await hasFile(io.join(directory, PROJECT_FILENAME))) ? PROJECT_FILENAME : LEGACY_PROJECT_FILENAME;
	if (!(await hasFile(io.join(directory, filename)))) {
		throw new Error("The directory does not contain a Sviber project manifest.");
	}
	const manifest = normalizeProjectManifest(await readJson(io, io.join(directory, filename)));
	const charts = [];
	for (const entry of manifest.charts) {
		const document = await readJson(io, io.join(directory, entry.file));
		charts.push({ id: entry.id, file: entry.file, model: ChartModel.import(document) });
	}
	return { manifest, charts, directory };
}

// A path is treated as a project when it holds a project.sviber or legacy manifest.
async function loadInput(io, pathname, args) {
	if (await io.isDirectory(pathname)) {
		return { kind: "project", project: await loadProject(io, pathname) };
	}
	const extension = extensionOf(pathname);
	if (extension === "ssc") {
		const level = await io.readLevel(pathname);
		return { kind: "level", level };
	}
	const text = await io.readText(pathname);
	if (extension === "txt" || isLyricaChartText(text)) {
		return { kind: "lyrica", model: new ChartModel(importLyricaChart(text, lyricaOptionsFrom(args))) };
	}
	const document = JSON.parse(text);
	if (document?.lyrica) {
		return { kind: "lyrica", model: new ChartModel(importLyricaChart(document.lyrica, lyricaOptionsFrom(args))) };
	}
	const options = document?.sviber ? {} : timingOptionsFrom(args);
	return { kind: "chart", model: ChartModel.import(document, options) };
}

function chartsOf(input) {
	if (input.kind === "project") {
		return input.project.charts;
	}
	if (input.kind === "level") {
		return input.level.charts;
	}
	return [
		{
			id: "difficulty-0",
			file: uniqueChartFilename(input.model.metadata.difficultyName),
			model: input.model,
		},
	];
}

function pickChart(charts, selector) {
	if (!selector) {
		return charts[0];
	}
	const key = String(selector).toLowerCase();
	return (
		charts.find(entry => String(entry.id).toLowerCase() === key) ||
		charts.find(entry => String(entry.file).toLowerCase() === key) ||
		charts.find(entry => String(entry.model.metadata.difficultyName).toLowerCase() === key) ||
		charts[0]
	);
}

async function exportLevel(io, input, output) {
	const charts = chartsOf(input);
	const assets =
		input.kind === "project" ? await io.projectAssets(input.project.directory, charts) : input.level?.assets || [];
	await io.writeLevel(output, charts, assets);
	return `Exported ${charts.length} chart${charts.length === 1 ? "" : "s"} to ${output}`;
}

async function runExport(io, args, input) {
	const output = args.exportPath;
	const extension = extensionOf(output);
	if (extension === "ssc") {
		return exportLevel(io, input, output);
	}
	const chart = pickChart(chartsOf(input), args.chart);
	if (!chart) {
		throw new Error("The input does not contain a chart.");
	}
	if (extension === "txt") {
		await io.writeText(output, exportLyricaChart(chart.model));
		return `Exported a Lyrica chart to ${output}`;
	}
	if (extension !== "json") {
		throw new Error(`Unsupported export format: ${output}`);
	}
	const document = chart.model.exportSunniesnow({ includeSchema: true });
	await io.writeText(output, `${JSON.stringify(document, null, 2)}\n`);
	return `Exported a Sunniesnow chart to ${output}`;
}

async function runImport(io, args, input) {
	const output = args.importPath;
	const charts = chartsOf(input);
	if (extensionOf(output) === "json") {
		const chart = pickChart(charts, args.chart);
		await io.writeText(output, chart.model.serialize(2));
		return `Imported ${input.kind} as the sviber chart ${output}`;
	}
	await io.makeDirectory(output);
	const used = [];
	const entries = charts.map((chart, index) => {
		const file = uniqueChartFilename(chart.model.metadata.difficultyName, used);
		used.push(file);
		return { id: chart.id || `difficulty-${index}`, file, model: chart.model };
	});
	for (const entry of entries) {
		await io.writeText(io.join(output, entry.file), entry.model.serialize(2));
	}
	const manifest = {
		charts: entries.map(entry => ({ id: entry.id, file: entry.file })),
		activeChart: entries[0].id,
		macros: [],
	};
	await io.writeText(io.join(output, PROJECT_FILENAME), `${JSON.stringify(manifest, null, 2)}\n`);
	for (const asset of input.level?.assets || []) {
		await io.writeBinary(io.join(output, asset.name), asset.data);
	}
	return `Imported ${input.kind} as the sviber project ${output}`;
}

export async function runCli(argv, io) {
	const args = parseCliArguments(argv);
	if (args.help) {
		io.print(helpText());
		return 0;
	}
	if (args.version) {
		io.print(versionText(packageJson.version));
		return 0;
	}
	if (args.unknown.length) {
		io.printError(`Unknown option: ${args.unknown[0]}`);
		io.print(helpText());
		return 2;
	}
	if (!isHeadlessInvocation(args)) {
		return null;
	}
	if (!args.input) {
		io.printError("An input path is required.");
		return 2;
	}
	try {
		const input = await loadInput(io, args.input, args);
		const message = args.exportPath ? await runExport(io, args, input) : await runImport(io, args, input);
		io.print(message);
		return 0;
	} catch (error) {
		io.printError(String(error?.message || error));
		return 1;
	}
}

export { CHART_ORDER_EPSILON };
