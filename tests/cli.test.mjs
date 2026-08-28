import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { createNodeCliIo } from "../js/cli/cli-node-io.js";
import { runCli } from "../js/cli/cli-operations.js";
import {
	helpText,
	isHeadlessInvocation,
	lyricaOptionsFrom,
	parseCliArguments,
	timingOptionsFrom,
} from "../js/cli/cli.js";
import { ChartModel } from "../js/core/chart-model.js";
import { PROJECT_FILENAME } from "../js/core/project.js";

function makeIo(lines) {
	return createNodeCliIo({
		fs,
		path,
		JSZip,
		print: text => lines.out.push(text.trimEnd()),
		printError: text => lines.error.push(text.trimEnd()),
	});
}

function sampleChart() {
	const model = ChartModel.createDefault({
		metadata: {
			title: "CLI Song",
			artist: "Artist",
			charter: "Charter",
			difficultyName: "Master",
			difficultyColor: "#8c68f3",
			difficulty: "12",
			difficultySup: "",
		},
	});
	model.addEvent("tap", { time: [1, 0, 1], x: 10, y: 20 });
	model.addEvent("hold", { time: [2, 0, 1], x: -10, y: 0, duration: [1, 0, 1] });
	return model;
}

test("the CLI help message documents every documented usage", () => {
	const text = helpText();
	for (const fragment of [
		"--export OUTPUT.ssc",
		"--export OUTPUT.json",
		"--export OUTPUT.txt",
		"--import OUTPUT.json",
		"--import OUTPUT-DIR",
		"--help",
	]) {
		assert.ok(text.includes(fragment), `help is missing ${fragment}`);
	}
});

test("CLI arguments separate paths, flags and repeated BPM changes", () => {
	const args = parseCliArguments([
		"chart.json",
		"--export",
		"out.ssc",
		"--bpm-change",
		"0:120",
		"--bpm-change",
		"16:150",
	]);
	assert.equal(args.input, "chart.json");
	assert.equal(args.exportPath, "out.ssc");
	assert.deepEqual(args.bpmChanges, ["0:120", "16:150"]);
	assert.equal(isHeadlessInvocation(args), true);
	assert.equal(isHeadlessInvocation(parseCliArguments(["chart.json"])), false);
	assert.equal(isHeadlessInvocation(parseCliArguments([])), false);
	const timing = timingOptionsFrom(
		parseCliArguments([
			"--offset",
			"0.25",
			"--initial-bpm",
			"175",
			"--largest-denominator",
			"96",
			"--bpm-change",
			"1+1/2:180",
		]),
	);
	assert.equal(timing.offset, 0.25);
	assert.equal(timing.initialBpm, 175);
	assert.equal(timing.largestDenominator, 96);
	assert.deepEqual(timing.bpmChanges, [{ time: [1, 1, 2], bpm: 180 }]);
	const lyrica = lyricaOptionsFrom(parseCliArguments(["--seed", "7", "--difficulty-name", "Special"]));
	assert.equal(lyrica.seed, "7");
	assert.equal(lyrica.difficultyName, "Special");
});

test("the CLI exports a chart, a Lyrica chart and a level and imports them back", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "sviber-cli-"));
	const lines = { out: [], error: [] };
	const io = makeIo(lines);
	const chartPath = path.join(directory, "chart.json");
	await fs.promises.writeFile(chartPath, sampleChart().serialize(2), "utf8");

	const sunniesnowPath = path.join(directory, "exported.json");
	assert.equal(await runCli([chartPath, "--export", sunniesnowPath], io), 0);
	const exported = JSON.parse(await readFile(sunniesnowPath, "utf8"));
	assert.equal(exported.title, "CLI Song");
	assert.ok(exported.events.length >= 2);

	const lyricaPath = path.join(directory, "exported.txt");
	assert.equal(await runCli([chartPath, "--export", lyricaPath], io), 0);
	assert.ok((await readFile(lyricaPath, "utf8")).length > 0);

	const levelPath = path.join(directory, "exported.ssc");
	assert.equal(await runCli([chartPath, "--export", levelPath], io), 0);
	const zip = await JSZip.loadAsync(await readFile(levelPath));
	const names = Object.keys(zip.files);
	assert.ok(names.some(name => name.endsWith(".json")));
	// v17 requires normalized Zip timestamps for reproducibility.
	const firstEntry = zip.files[names[0]];
	assert.equal(firstEntry.date.getTime(), Date.UTC(1980, 0, 1, 0, 0, 0));

	const importedChart = path.join(directory, "imported.json");
	assert.equal(await runCli([sunniesnowPath, "--import", importedChart, "--initial-bpm", "150"], io), 0);
	const reimported = ChartModel.import(JSON.parse(await readFile(importedChart, "utf8")));
	assert.equal(reimported.timing.initialBpm, 150);

	const importedProject = path.join(directory, "project");
	assert.equal(await runCli([levelPath, "--import", importedProject], io), 0);
	const manifest = JSON.parse(await readFile(path.join(importedProject, PROJECT_FILENAME), "utf8"));
	assert.equal(manifest.charts.length, 1);
	assert.deepEqual(manifest.macros, []);

	const projectLevel = path.join(directory, "project.ssc");
	assert.equal(await runCli([importedProject, "--export", projectLevel], io), 0);
	assert.ok((await readFile(projectLevel)).length > 0);
	assert.equal(lines.error.length, 0);
});

test("the CLI reports unknown options and missing inputs", async () => {
	const lines = { out: [], error: [] };
	const io = makeIo(lines);
	assert.equal(await runCli(["--nope"], io), 2);
	assert.match(lines.error.join("\n"), /Unknown option/);
	lines.error.length = 0;
	assert.equal(await runCli(["--export", "out.ssc"], io), 2);
	assert.match(lines.error.join("\n"), /input path is required/);
	lines.error.length = 0;
	assert.equal(await runCli(["missing.json", "--export", "out.json"], io), 1);
	assert.ok(lines.error.length > 0);
	assert.equal(await runCli(["--help"], io), 0);
	assert.equal(await runCli(["chart.json"], io), null);
});
