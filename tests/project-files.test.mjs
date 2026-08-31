// Project and platform file behaviour: saving a chart back to the path it was opened from,
// exporting a chart document without schema padding, normalizing project manifests, and the
// full project-folder round trip that also produces a Sunniesnow level archive.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import JSZip from "jszip";

import { ChartModel } from "../js/core/chart-model.js";
import {
	LEGACY_PROJECT_FILENAME,
	PROJECT_FILENAME,
	createProjectManifest,
	exportSunniesnowChartDocument,
	normalizeProjectManifest,
	projectManagedFiles,
} from "../js/core/project.js";
import { FileManager } from "../js/platform/platform.js";
import { directoryFileExists } from "../js/platform/platform-project-directory.js";

function restoreGlobal(name, value) {
	if (value === undefined) {
		delete globalThis[name];
	} else {
		globalThis[name] = value;
	}
}

async function withNwRequire(run) {
	const previousNw = globalThis.nw;
	globalThis.nw = { require: createRequire(import.meta.url) };
	try {
		return await run();
	} finally {
		restoreGlobal("nw", previousNw);
	}
}

async function withProjectArchiveGlobals(run) {
	const previousZip = globalThis.JSZip;
	const previousReady = globalThis.sviberDependenciesReady;
	globalThis.JSZip = JSZip;
	globalThis.sviberDependenciesReady = Promise.resolve();
	try {
		return await withNwRequire(run);
	} finally {
		restoreGlobal("JSZip", previousZip);
		restoreGlobal("sviberDependenciesReady", previousReady);
	}
}

test("NW.js saves an opened chart back to its known path and resolves relative assets", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "sviber-platform-"));
	const chartPath = path.join(directory, "opened.json");
	const musicPath = path.join(directory, "music.bin");
	try {
		await withNwRequire(async () => {
			const source = ChartModel.createDefault({ metadata: { title: "Opened", difficultyName: "Hard" } });
			await writeFile(chartPath, source.serialize(2));
			await writeFile(musicPath, new Uint8Array([1, 2, 3, 4]));
			const file = {
				name: "opened.json",
				path: chartPath,
				text: () => readFile(chartPath, "utf8"),
			};
			const manager = new FileManager();
			const parsed = await manager.parseFile(file);
			manager.adoptChartSource(parsed);
			const model = ChartModel.import(parsed.document);
			model.metadata.title = "Saved in place";
			assert.equal(await manager.saveChart(model), chartPath);
			assert.equal(JSON.parse(await readFile(chartPath, "utf8")).title, "Saved in place");

			const asset = await manager.fileForAsset("music.bin", "music");
			assert.equal(asset.name, "music.bin");
			assert.deepEqual([...new Uint8Array(await asset.arrayBuffer())], [1, 2, 3, 4]);
			assert.equal(manager.localPathFor(asset), musicPath);
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("chart export does not enforce external JSON Schema required fields", () => {
	const model = ChartModel.createDefault({
		metadata: {
			title: "",
			artist: "",
			charter: "",
			difficultyName: "",
			difficulty: "",
		},
		events: [],
	});
	const chart = exportSunniesnowChartDocument(model);
	assert.equal(chart.artist, "");
	assert.equal(chart.charter, "");
	assert.deepEqual(chart.events, []);
	assert.match(chart.$schema, /chart-1\.0\.json$/);
});

test("project manifests preserve ordered difficulties and reject unsafe paths", () => {
	const manifest = createProjectManifest({
		activeChart: "master",
		charts: [
			{ id: "hard", file: "hard.json" },
			{ id: "master", file: "master.json" },
		],
	});
	assert.deepEqual(
		manifest.charts.map(entry => entry.id),
		["hard", "master"],
	);
	assert.equal(manifest.activeChart, "master");
	assert.throws(
		() =>
			normalizeProjectManifest({
				...manifest,
				charts: [{ id: "bad", file: "charts/bad.json" }],
			}),
		/project folder root/,
	);
	assert.deepEqual([...projectManagedFiles(manifest)].sort(), ["hard.json", "master.json"]);
	// v17 adds the project macros list to the manifest.
	assert.deepEqual(Object.keys(manifest).sort(), ["activeChart", "charts", "macros"]);
	assert.deepEqual(manifest.macros, []);
	assert.deepEqual(
		normalizeProjectManifest({
			...manifest,
			macros: [{ file: "helper.rb", name: "helper" }, { file: "nested/bad.js" }],
		}).macros,
		[{ file: "helper.rb", name: "helper" }],
	);
	assert.deepEqual(normalizeProjectManifest({ ...manifest, format: "sviber-project", version: 1 }), manifest);
});

function createFolderChart(difficultyName, difficulty, x) {
	const model = ChartModel.createDefault({
		metadata: {
			title: "Folder Song",
			artist: "Artist",
			charter: "Charter",
			difficultyName,
			difficultyColor: "#e75e74",
			difficulty,
			difficultySup: "",
		},
	});
	model.addEvent("tap", { time: [1, 0, 1], x, y: 0 });
	return model;
}

async function saveFolderProject(directory) {
	const hard = createFolderChart("Hard", "9", -25);
	const master = createFolderChart("Master", "12", 25);
	const music = Object.assign(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/ogg" }), { name: "song.ogg" });
	const cover = Object.assign(new Blob([new Uint8Array([4, 5, 6])], { type: "image/png" }), {
		name: "cover.png",
	});
	const alternateMusic = Object.assign(new Blob([new Uint8Array([7, 8, 9])], { type: "audio/ogg" }), {
		name: "alternate.ogg",
	});
	const manager = new FileManager();
	manager.rememberAsset("source-song.ogg", music, "music");
	manager.rememberAsset("source-cover.png", cover, "image");
	manager.rememberAsset("source-alternate.ogg", alternateMusic);
	hard.music = "source-song.ogg";
	hard.image = "source-cover.png";
	master.music = "source-alternate.ogg";
	master.image = "source-cover.png";
	const result = await manager.saveProject(
		{
			name: "Folder Song",
			activeChart: "master",
			charts: [
				{ id: "hard", file: "hard.json", model: hard },
				{ id: "master", file: "master.json", model: master },
			],
		},
		{ directoryPath: directory },
	);
	assert.deepEqual(Object.keys(result.manifest).sort(), ["activeChart", "charts", "macros"]);
	const diskManifest = JSON.parse(await readFile(path.join(directory, PROJECT_FILENAME), "utf8"));
	assert.deepEqual(
		diskManifest.charts.map(entry => entry.file),
		["hard.json", "master.json"],
	);
	assert.ok(JSON.parse(await readFile(path.join(directory, "hard.json"), "utf8")).sviber);
	return { hard, manager };
}

async function reopenFolderProject(directory) {
	const reopenedManager = new FileManager();
	const reopened = await reopenedManager.openProject({ directoryPath: directory });
	assert.equal(reopened.manifest.activeChart, "master");
	assert.deepEqual(
		reopened.charts.map(entry => entry.document.difficultyName),
		["Hard", "Master"],
	);
	assert.equal(await reopenedManager.containingProjectPath(path.join(directory, "master.json")), directory);
	assert.equal(reopenedManager.projectChartFilename(path.join(directory, "master.json")), "master.json");
	const models = reopened.charts.map(entry => ({ ...entry, model: ChartModel.import(entry.document) }));
	assert.deepEqual(
		models.map(entry => [entry.model.music, entry.model.image]),
		[
			["song.ogg", "cover.png"],
			["alternate.ogg", "cover.png"],
		],
	);
	return { models, reopenedManager };
}

async function assertLevelArchive(reopenedManager, models) {
	const levelBlob = await reopenedManager.createLevelArchive({ name: "Folder Song", charts: models });
	const archive = await JSZip.loadAsync(await levelBlob.arrayBuffer());
	assert.deepEqual(Object.keys(archive.files).sort(), [
		"alternate.ogg",
		"cover.png",
		"hard.json",
		"master.json",
		"song.ogg",
	]);
	for (const filename of ["hard.json", "master.json"]) {
		const chart = JSON.parse(await archive.file(filename).async("text"));
		assert.equal(Object.hasOwn(chart, "sviber"), false);
		assert.deepEqual(
			Object.keys(chart).sort(),
			[
				"$schema",
				"artist",
				"charter",
				"difficulty",
				"difficultyColor",
				"difficultyName",
				"difficultySup",
				"events",
				"title",
			].sort(),
		);
	}
}

async function assertResaveKeepsUserFiles(directory, manager, hard) {
	await writeFile(path.join(directory, "keep-me.txt"), "user file");
	const replacementMusic = Object.assign(new Blob([new Uint8Array([7, 8, 9])], { type: "audio/ogg" }), {
		name: "replacement.ogg",
	});
	const replacementCover = Object.assign(new Blob([new Uint8Array([10, 11, 12])], { type: "image/png" }), {
		name: "replacement.png",
	});
	manager.rememberAsset("replacement.ogg", replacementMusic, "music");
	manager.rememberAsset("replacement.png", replacementCover, "image");
	hard.music = "replacement.ogg";
	hard.image = "replacement.png";
	await manager.saveProject({
		name: "Folder Song",
		activeChart: "hard",
		charts: [{ id: "hard", file: "hard.json", model: hard }],
	});
	assert.deepEqual(
		(await readdir(directory)).sort(),
		[
			"alternate.ogg",
			"cover.png",
			"hard.json",
			"keep-me.txt",
			"master.json",
			"replacement.ogg",
			"replacement.png",
			"song.ogg",
			PROJECT_FILENAME,
		].sort(),
	);
}

test("project folders round-trip all difficulties and level export contains only strict root charts", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "sviber-project-"));
	try {
		await withProjectArchiveGlobals(async () => {
			const { hard, manager } = await saveFolderProject(directory);
			const { models, reopenedManager } = await reopenFolderProject(directory);
			await assertLevelArchive(reopenedManager, models);
			await assertResaveKeepsUserFiles(directory, manager, hard);
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("copyAssetIntoProject reuses a file already in the project folder", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "sviber-copy-"));
	try {
		await withNwRequire(async () => {
			const musicPath = path.join(directory, "song.ogg");
			await writeFile(musicPath, new Uint8Array([1, 2, 3]));
			const manager = new FileManager();
			manager.projectPath = directory;
			const file = await manager.fileFromLocalPath(musicPath, "audio/ogg");
			const first = await manager.copyAssetIntoProject(file, "music", "song.ogg");
			const second = await manager.copyAssetIntoProject(file, "music", "song.ogg");
			assert.equal(first, "song.ogg");
			assert.equal(second, "song.ogg");
			const copied = await manager.fileForAsset("song.ogg", "music");
			assert.deepEqual([...new Uint8Array(await copied.arrayBuffer())], [1, 2, 3]);
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("legacy project manifests open first and migrate on save", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "sviber-legacy-project-"));
	try {
		await withNwRequire(async () => {
			const chart = ChartModel.createDefault({ metadata: { difficultyName: "Legacy" } });
			await writeFile(path.join(directory, "legacy.json"), chart.serialize(2));
			await writeFile(
				path.join(directory, LEGACY_PROJECT_FILENAME),
				JSON.stringify({ charts: [{ id: "legacy", file: "legacy.json" }], activeChart: "legacy" }),
			);
			const manager = new FileManager();
			assert.equal(await manager.isProjectDirectory(directory), true);
			const opened = await manager.openProject({ directoryPath: directory });
			assert.equal(opened.charts[0].file, "legacy.json");
			assert.equal(await manager.containingProjectPath(path.join(directory, "legacy.json")), directory);

			await manager.saveProject({
				name: "Legacy",
				activeChart: "legacy",
				charts: [{ id: "legacy", file: "legacy.json", model: ChartModel.import(opened.charts[0].document) }],
			});
			assert.equal(await directoryFileExists({ type: "nw", path: directory }, PROJECT_FILENAME), true);
			assert.equal(await directoryFileExists({ type: "nw", path: directory }, LEGACY_PROJECT_FILENAME), false);

			const preferred = ChartModel.createDefault({ metadata: { difficultyName: "Preferred" } });
			await writeFile(path.join(directory, "preferred.json"), preferred.serialize(2));
			await writeFile(
				path.join(directory, LEGACY_PROJECT_FILENAME),
				JSON.stringify({ charts: [{ id: "legacy", file: "legacy.json" }], activeChart: "legacy" }),
			);
			await writeFile(
				path.join(directory, PROJECT_FILENAME),
				JSON.stringify({ charts: [{ id: "preferred", file: "preferred.json" }], activeChart: "preferred" }),
			);
			const preferredOpen = await new FileManager().openProject({ directoryPath: directory });
			assert.equal(preferredOpen.charts[0].file, "preferred.json");
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
