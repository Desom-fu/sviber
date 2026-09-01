import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

import { withProjectFiles } from "../js/app/app-project-files.js";
import { FileManager } from "../js/platform/platform.js";
import { ChartModel } from "../js/core/chart-model.js";
import { PROJECT_FILENAME } from "../js/core/project.js";

function restoreGlobal(name, value) {
	if (value === undefined) {
		delete globalThis[name];
	} else {
		globalThis[name] = value;
	}
}

test("opening a project manifest path loads its containing project", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "sviber-manifest-open-"));
	const previousNw = globalThis.nw;
	const previousPath = globalThis.sviberOpenPath;
	try {
		globalThis.nw = { require: createRequire(import.meta.url), App: { argv: [] } };
		const chart = ChartModel.createDefault({ metadata: { difficultyName: "Master" } });
		await writeFile(path.join(directory, "master.json"), chart.serialize(2));
		await writeFile(
			path.join(directory, PROJECT_FILENAME),
			JSON.stringify({ charts: [{ id: "master", file: "master.json" }], activeChart: "master" }),
		);

		const App = withProjectFiles(class {});
		const app = new App();
		app.files = new FileManager();
		let openedOptions = null;
		app.openProject = async options => {
			openedOptions = options;
			return { manifest: {} };
		};
		globalThis.sviberOpenPath = path.join(directory, PROJECT_FILENAME);

		assert.equal(await app.openArgvPath(), true);
		assert.equal(openedOptions.directoryPath, directory);
		assert.equal(openedOptions.skipUnsaved, true);
	} finally {
		restoreGlobal("nw", previousNw);
		restoreGlobal("sviberOpenPath", previousPath);
		await rm(directory, { recursive: true, force: true });
	}
});
