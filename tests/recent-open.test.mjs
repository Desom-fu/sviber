import assert from "node:assert/strict";
import test from "node:test";
import { withDocumentLifecycle } from "../js/app/app-document-lifecycle.js";
import { withOpenSave } from "../js/app/app-open-save.js";
import { LAST_OPEN_KEY, RECENT_OPEN_KEY } from "../js/app/app-helpers.js";

function memoryStorage() {
	const values = new Map();
	return {
		getItem: key => (values.has(key) ? values.get(key) : null),
		setItem: (key, value) => {
			values.set(key, String(value));
		},
	};
}

function makeApp({ editingProject = false, saveAsPath = "/tmp/song-Master.json", projectPath = "/tmp/my-project" } = {}) {
	const App = withOpenSave(withDocumentLifecycle(class {}));
	const app = new App();
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
	return app;
}

async function withDesktopStorage(run) {
	const previousNw = globalThis.nw;
	const previousStorage = globalThis.localStorage;
	const storage = memoryStorage();
	globalThis.nw = {};
	globalThis.localStorage = storage;
	try {
		await run(storage);
	} finally {
		globalThis.nw = previousNw;
		globalThis.localStorage = previousStorage;
	}
}

function recents(storage) {
	return JSON.parse(storage.getItem(RECENT_OPEN_KEY) || "[]");
}

test("saving a newly created standalone chart adds it to recents", async () => {
	await withDesktopStorage(async storage => {
		const app = makeApp();
		await app.saveChart();
		assert.equal(recents(storage)[0].kind, "chart");
		assert.equal(recents(storage)[0].path, "/tmp/song-Master.json");
		assert.deepEqual(JSON.parse(storage.getItem(LAST_OPEN_KEY)), {
			kind: "chart",
			path: "/tmp/song-Master.json",
		});
	});
});

test("saving a newly created project adds it to recents", async () => {
	await withDesktopStorage(async storage => {
		const app = makeApp({ editingProject: true });
		await app.saveProject();
		assert.equal(recents(storage)[0].kind, "project");
		assert.equal(recents(storage)[0].path, "/tmp/my-project");
	});
});

test("saving a chart inside a project remembers the project", async () => {
	await withDesktopStorage(async storage => {
		const app = makeApp({ editingProject: true });
		await app.saveChart();
		assert.equal(recents(storage)[0].kind, "project");
		assert.equal(recents(storage)[0].path, "/tmp/my-project");
	});
});

test("Save As records the new standalone chart path", async () => {
	await withDesktopStorage(async storage => {
		const app = makeApp({ saveAsPath: "/tmp/copy.json" });
		await app.saveChartAs();
		assert.equal(recents(storage)[0].kind, "chart");
		assert.equal(recents(storage)[0].path, "/tmp/copy.json");
	});
});
