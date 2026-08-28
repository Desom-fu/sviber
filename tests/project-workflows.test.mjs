import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { withClipboard } from "../js/app/app-clipboard.js";
import { SviberAppCore } from "../js/app/app-core.js";
import { withFileWorkflows } from "../js/app/app-file-workflows.js";
import { ChartModel } from "../js/core/chart-model.js";
import { createProjectManifest } from "../js/core/project.js";
import { FileManager } from "../js/platform/platform.js";

test("switching clean difficulties does not create a dirty project", () => {
	const app = Object.create(SviberAppCore.prototype);
	const first = ChartModel.createDefault({
		metadata: { title: "Project", artist: "Artist", difficultyName: "Easy" },
	});
	const second = ChartModel.createDefault({
		metadata: { title: "Project", artist: "Artist", difficultyName: "Hard" },
	});
	app.installProject(
		[
			{ id: "difficulty-1", file: "easy.json", model: first },
			{ id: "difficulty-2", file: "hard.json", model: second },
		],
		{ activeChart: "difficulty-1", name: "Project", title: "Project", artist: "Artist", saved: true },
	);
	assert.equal(app.dirty, false);
	app.activeDifficultyId = "difficulty-2";
	app.model = app.difficulties[1].model;
	app.history = app.difficulties[1].history;
	app.savedSignature = app.difficulties[1].savedSignature;
	app.updateDirty();
	assert.equal(app.dirty, false);
});

test("opening a chart from the project folder adds it without dropping other difficulties", async () => {
	const WorkflowApp = withClipboard(withFileWorkflows(class {}));
	const app = new WorkflowApp();
	const master = ChartModel.createDefault({ metadata: { title: "Project", difficultyName: "Master" } });
	const special = ChartModel.createDefault({ metadata: { title: "Project", difficultyName: "Special" } });
	app.files = { projectPath: "C:/project", projectChartFilename: () => "Special.json" };
	app.difficulties = [{ id: "difficulty-0", file: "Master.json", model: master, history: {}, savedSignature: null }];
	app.activeDifficultyId = "difficulty-0";
	app.model = master;
	app.projectTitle = "Project";
	app.projectArtist = "";
	app.projectMusic = "";
	app.projectImage = "";
	app.nextDifficultyId = 1;
	app.projectDirty = false;
	app.modelSignature = SviberAppCore.prototype.modelSignature.bind(app);
	app.syncProjectSharedFields = SviberAppCore.prototype.syncProjectSharedFields.bind(app);
	app.updateDirty = () => {};
	app.refresh = () => {};
	app.rememberLastOpen = () => {};
	app.syncMediaFromModel = async () => {};
	app.confirmUnsaved = async () => true;
	app.requestImportOptions = async () => ({});
	app.toast = { show() {} };
	app.files.parseFile = async () => ({
		document: JSON.parse(special.serialize()),
		chartPath: "C:/project/Special.json",
	});
	await app.openFile({ name: "Special.json" }, { silent: true });
	assert.deepEqual(
		app.difficulties.map(entry => entry.file),
		["Master.json", "Special.json"],
	);
	assert.equal(app.model.metadata.difficultyName, "Special");
});

test("project manifest contains chart membership, active chart and v17 macros", () => {
	const manifest = createProjectManifest({
		charts: [
			{ id: "hard", file: "hard.json" },
			{ id: "master", file: "master.json" },
		],
		activeChart: "master",
	});
	assert.deepEqual(manifest, {
		charts: [
			{ id: "hard", file: "hard.json" },
			{ id: "master", file: "master.json" },
		],
		activeChart: "master",
		macros: [],
	});
});

test("standalone saves use absolute media paths and project saves use relative paths", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "sviber-v16-"));
	const standaloneDirectory = path.join(root, "standalone");
	const projectDirectory = path.join(root, "project");
	await mkdir(standaloneDirectory);
	await mkdir(projectDirectory);
	await writeFile(path.join(projectDirectory, "keep.txt"), "keep");
	await writeFile(path.join(projectDirectory, "chart.json"), "unrelated chart");
	await writeFile(path.join(projectDirectory, "music.ogg"), "unrelated music");
	await writeFile(path.join(standaloneDirectory, "music.ogg"), new Uint8Array([1, 2, 3]));
	await writeFile(path.join(standaloneDirectory, "cover.png"), new Uint8Array([4, 5, 6]));
	const previousNw = globalThis.nw;
	globalThis.nw = { require: createRequire(import.meta.url) };
	try {
		const chartPath = path.join(standaloneDirectory, "chart.json");
		const model = ChartModel.createDefault({ music: "music.ogg", image: "cover.png" });
		const standaloneManager = new FileManager();
		standaloneManager.chartPath = chartPath;
		await standaloneManager.saveChart(model);
		const standalone = JSON.parse(await readFile(chartPath, "utf8"));
		assert.equal(standalone.sviber.music, path.join(standaloneDirectory, "music.ogg"));
		assert.equal(standalone.sviber.image, path.join(standaloneDirectory, "cover.png"));

		const projectManager = new FileManager();
		const result = await projectManager.saveProject(
			{
				name: "Project",
				activeChart: "chart",
				charts: [{ id: "chart", file: "chart.json", model }],
			},
			{ directoryPath: projectDirectory },
		);
		assert.deepEqual(Object.keys(result.manifest).sort(), ["activeChart", "charts", "macros"]);
		assert.equal(result.manifest.charts[0].file, "chart-2.json");
		const projectChart = JSON.parse(await readFile(path.join(projectDirectory, "chart-2.json"), "utf8"));
		assert.equal(projectChart.sviber.music, "music-2.ogg");
		assert.equal(projectChart.sviber.image, "cover.png");
		assert.equal(await readFile(path.join(projectDirectory, "keep.txt"), "utf8"), "keep");
		assert.equal(await readFile(path.join(projectDirectory, "chart.json"), "utf8"), "unrelated chart");
		assert.equal(await readFile(path.join(projectDirectory, "music.ogg"), "utf8"), "unrelated music");
		await projectManager.saveChart(model, { projectFilename: result.manifest.charts[0].file });
		assert.equal(model.music, "music-2.ogg");
		assert.equal(model.image, "cover.png");

		model.music = path.join(standaloneDirectory, "music.ogg");
		model.image = path.join(standaloneDirectory, "cover.png");
		await projectManager.saveChart(model, { projectFilename: result.manifest.charts[0].file });
		const savedProjectChart = JSON.parse(await readFile(path.join(projectDirectory, "chart-2.json"), "utf8"));
		assert.equal(path.isAbsolute(savedProjectChart.sviber.music), false);
		assert.equal(path.isAbsolute(savedProjectChart.sviber.image), false);
		assert.equal(await readFile(path.join(projectDirectory, savedProjectChart.sviber.music), "hex"), "010203");
		assert.equal(await readFile(path.join(projectDirectory, savedProjectChart.sviber.image), "hex"), "040506");

		const secondManager = new FileManager();
		await assert.rejects(
			() =>
				secondManager.saveProject(
					{
						name: "Other",
						activeChart: "chart",
						charts: [{ id: "chart", file: "other.json", model }],
					},
					{ directoryPath: projectDirectory },
				),
			/already contains sviber-project\.json/,
		);
	} finally {
		if (previousNw === undefined) {
			delete globalThis.nw;
		} else {
			globalThis.nw = previousNw;
		}
		await rm(root, { recursive: true, force: true });
	}
});

test("browser project folders are unavailable", async () => {
	const manager = new FileManager();
	await assert.rejects(() => manager.chooseProjectDirectory(), /desktop app/);
	await assert.rejects(() => manager.openProject({ directoryHandle: {} }), /desktop app/);
	await assert.rejects(() => manager.saveProject({ charts: [] }, { directoryHandle: {} }), /desktop app/);
	const WorkflowApp = withFileWorkflows(class {});
	const app = new WorkflowApp();
	app.editingProject = false;
	await app.newProject();
	assert.equal(app.editingProject, false);
});

test("chart deletion optionally removes the file and never deletes the last project chart", async () => {
	const WorkflowApp = withFileWorkflows(class {});
	const app = new WorkflowApp();
	const first = ChartModel.createDefault({ music: "one.ogg", image: "one.png" });
	const second = ChartModel.createDefault({ music: "two.ogg", image: "two.png" });
	app.editingProject = true;
	app.difficulties = [
		{ id: "one", file: "one.json", model: first, history: {}, savedSignature: "one" },
		{ id: "two", file: "two.json", model: second, history: {}, savedSignature: "two" },
	];
	app.activeDifficultyId = "one";
	app.model = first;
	app.projectMusic = first.music;
	app.projectImage = first.image;
	let deleteDialog;
	app.dialogs = {
		form: async options => {
			deleteDialog = options;
			return { deleteFile: true };
		},
	};
	const deleted = [];
	app.files = {
		deleteProjectChart: async filename => {
			deleted.push(filename);
		},
	};
	app.syncProjectSharedFields = () => {};
	app.updateDirty = () => {};
	app.refresh = () => {};
	app.queueMediaSync = async () => {};
	assert.equal(await app.deleteDifficulty(), true);
	assert.equal(deleteDialog.values.deleteFile, true);
	assert.deepEqual(deleteDialog.fields, [{ id: "deleteFile", type: "checkbox", labelKey: "field.deleteChartFile" }]);
	assert.deepEqual(deleted, ["one.json"]);
	assert.equal(app.activeDifficultyId, "two");
	assert.equal(app.projectMusic, "two.ogg");
	assert.equal(await app.deleteDifficulty(), false);
});

test("new project charts inherit the active chart media", async () => {
	const WorkflowApp = withFileWorkflows(class {});
	const app = new WorkflowApp();
	const source = ChartModel.createDefault({
		music: "previous.ogg",
		image: "previous.png",
		metadata: { title: "Song", artist: "Artist", difficultyName: "Hard" },
	});
	app.editingProject = true;
	app.model = source;
	app.projectMusic = source.music;
	app.projectImage = source.image;
	app.difficulties = [{ id: "difficulty-0", file: "Hard.json", model: source, history: {}, savedSignature: "saved" }];
	app.nextDifficultyId = 1;
	app.exitModes = () => {};
	app.confirmUnsavedChart = async () => true;
	app.dialogs = { form: async options => ({ ...options.values, difficultyName: "Master" }) };
	app.lastCharter = () => "Charter";
	app.rememberCharter = () => {};
	app.syncProjectSharedFields = () => {};
	app.syncProjectHistorySharedFields = () => {};
	let switchedTo = "";
	app.switchDifficulty = async id => {
		switchedTo = id;
		return true;
	};
	const id = await app.newDifficulty();
	const added = app.difficulties.find(entry => entry.id === id);
	assert.equal(switchedTo, id);
	assert.equal(added.model.music, "previous.ogg");
	assert.equal(added.model.image, "previous.png");
});

test("desktop file opening uses the common add-to-project confirmation", async () => {
	const WorkflowApp = withFileWorkflows(class {});
	const app = new WorkflowApp();
	const previousNw = globalThis.nw;
	globalThis.nw = {};
	let prompted = 0;
	let activated = null;
	app.editingProject = true;
	app.difficulties = [{ id: "one", file: "one.json", model: ChartModel.createDefault() }];
	app.exitModes = () => {};
	app.confirmAddToProject = async () => {
		prompted += 1;
		return true;
	};
	app.confirmUnsavedChart = async () => true;
	app.requestImportOptions = async () => ({});
	app.files = {
		localPathFor: () => "",
		containingProjectPath: async () => "",
		projectChartFilename: () => "",
		parseFile: async () => ({ document: JSON.parse(ChartModel.createDefault().serialize()) }),
		resolveChartAssetReference: value => value,
		projectPath: "C:/project",
	};
	app.activateProjectChart = (model, filename) => {
		activated = { model, filename };
	};
	app.syncMediaFromModel = async () => {};
	app.updateDirty = () => {};
	app.rememberLastOpen = () => {};
	app.toast = {
		show() {},
		error(error) {
			throw error;
		},
	};
	try {
		await app.openFile({ name: "import.json" }, { offerAddToProject: true, silent: true });
	} finally {
		if (previousNw === undefined) {
			delete globalThis.nw;
		} else {
			globalThis.nw = previousNw;
		}
	}
	assert.equal(prompted, 1);
	assert.ok(activated?.model instanceof ChartModel);
	assert.match(activated.filename, /\.json$/);
});

test("Close resolves unsaved changes before replacing the document", async () => {
	const WorkflowApp = withFileWorkflows(class {});
	const app = new WorkflowApp();
	let cleared = 0;
	let installed = null;
	app.exitModes = () => {};
	app.confirmUnsaved = async () => true;
	app.clearRuntimeMedia = async () => {
		cleared += 1;
	};
	app.files = {
		clearProjectTarget() {
			cleared += 1;
		},
	};
	app.installProject = (charts, options) => {
		installed = { charts, options };
		app.model = charts[0].model;
	};
	app.markProjectSaved = () => {};
	app.refresh = () => {};
	app.editingProject = true;
	assert.equal(await app.closeDocument(), true);
	assert.equal(app.editingProject, false);
	assert.equal(cleared, 2);
	assert.equal(installed.charts.length, 1);
	assert.equal(installed.options.saved, true);
});

test("workflows prompt for add-to-project and document the complete behavior", async () => {
	const [lifecycle, openSave, clipboard, statusBindings, commands, help, english, chinese] = await Promise.all([
		readFile(new URL("../js/app/app-document-lifecycle.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-open-save.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-clipboard.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-status-bindings.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-command-bindings.js", import.meta.url), "utf8"),
		readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
		readFile(new URL("../json/i18n.en-US.json", import.meta.url), "utf8"),
		readFile(new URL("../json/i18n.zh-CN.json", import.meta.url), "utf8"),
	]);
	assert.match(lifecycle, /music:\s*this\.projectMusic[\s\S]*image:\s*this\.projectImage/);
	assert.match(openSave, /offerAddToProject[\s\S]*confirmAddToProject/);
	assert.match(clipboard, /importClipboard[\s\S]*confirmAddToProject/);
	assert.match(statusBindings, /open-file-input[\s\S]*offerAddToProject:\s*true/);
	assert.match(commands, /editingProject\s*&&\s*app\.difficulties\.length\s*>\s*1/);
	for (const text of [help, english, chinese]) {
		assert.match(text, /Close chart\/project|关闭谱面\/工程/);
	}
	assert.match(english, /error\.projectManifestExists/);
	assert.match(chinese, /error\.projectManifestExists/);
	assert.match(help, /activeChart/);
	assert.match(help, /absolute media paths/);
	assert.match(help, /绝对媒体路径/);
});
