import assert from "node:assert/strict";
import test from "node:test";
import { withDocumentLifecycle } from "../js/app/app-document-lifecycle.js";
import { withOpenSave } from "../js/app/app-open-save.js";

function makeApp({
	editingProject = false,
	saveAsPath = "/tmp/song-Master.json",
	projectPath = "/tmp/my-project",
} = {}) {
	const App = withOpenSave(withDocumentLifecycle(class {}));
	const app = new App();
	const remembered = [];
	app.rememberLastOpen = (kind, pathname) => {
		remembered.push({ kind, pathname });
	};
	app.freeTransform = null;
	app.finishFreeTransform = () => {};
	app.markSaved = () => {};
	app.markProjectSaved = () => {};
	app.history = { markCurrent() {} };
	app.autosave = { markManualSave() {} };
	app.toast = { show() {}, error() {} };
	app._refreshLightweight = () => {};
	app.refresh = () => {};
	app.model = { metadata: { title: "Song" } };
	app.editingProject = editingProject;
	app.difficulties = [];
	app.syncProjectSharedFields = () => {};
	app.projectSnapshot = () => ({ charts: [], activeChart: "difficulty-0", name: "Song" });
	app.activeDifficultyState = () => ({ file: "Master.json" });
	app.files = {
		chartPath: "",
		projectPath: editingProject ? projectPath : "",
		projectName: "Song",
		async saveChart(_model, options = {}) {
			if (options.saveAs) {
				this.chartPath = saveAsPath;
				return this.chartPath;
			}
			if (this.projectPath && options.projectFilename) {
				this.chartPath = `${this.projectPath}/${options.projectFilename}`;
				return this.chartPath;
			}
			this.chartPath = saveAsPath;
			return this.chartPath;
		},
		async saveProject() {
			this.projectPath = projectPath;
			return { location: this.projectPath, manifest: { charts: [] } };
		},
	};
	return { app, remembered };
}

test("saving a newly created standalone chart adds it to recents", async () => {
	const { app, remembered } = makeApp();
	await app.saveChart();
	assert.deepEqual(remembered, [{ kind: "chart", pathname: "/tmp/song-Master.json" }]);
});

test("saving a newly created project adds it to recents", async () => {
	const previousNw = globalThis.nw;
	globalThis.nw = {};
	try {
		const { app, remembered } = makeApp({ editingProject: true });
		await app.saveProject();
		assert.deepEqual(remembered, [{ kind: "project", pathname: "/tmp/my-project" }]);
	} finally {
		globalThis.nw = previousNw;
	}
});

test("saving a chart inside a project remembers the project", async () => {
	const { app, remembered } = makeApp({ editingProject: true });
	await app.saveChart();
	assert.deepEqual(remembered, [{ kind: "project", pathname: "/tmp/my-project" }]);
});

test("Save As records the new standalone chart path", async () => {
	const { app, remembered } = makeApp({ saveAsPath: "/tmp/copy.json" });
	await app.saveChartAs();
	assert.deepEqual(remembered, [{ kind: "chart", pathname: "/tmp/copy.json" }]);
});
