import assert from "node:assert/strict";
import test from "node:test";
import { withProjectFiles } from "../js/app/app-project-files.js";
import { withHistoryCommands } from "../js/app/app-history-commands.js";

// The File > Open recent... decision tree, exercised through recentChartPlan: the
// currently open chart is a no-operation, a chart of the currently open project activates
// in place, a chart of another project offers to open its project (or to add to / open
// beside the current project), and a standalone chart is offered to the open project.
function makeHarness({ editingProject = false, projectPath = "", chartPath = "", containing = null }) {
	const calls = { confirms: [], answer: true };
	const App = withProjectFiles(withHistoryCommands(class {}));
	const app = new App();
	app.editingProject = editingProject;
	app.files = {
		projectPath,
		chartPath,
		async containingProjectPath() {
			return containing;
		},
		projectChartFilename(path) {
			return path.split(/[\\/]/).pop() || "";
		},
		async fileFromLocalPath() {
			return null;
		},
	};
	app.dialogs = {
		confirm: async ({ titleKey }) => {
			calls.confirms.push(titleKey);
			return calls.answer;
		},
	};
	app.toast = { error() {} };
	app.confirmAddToProject = async () => {
		calls.confirms.push("dialog.addChartToProject");
		return calls.answer;
	};
	app._syncAudioLoop = () => {};
	app.refreshInteractionPreview = () => {};
	app.audio = { playing: false };
	return { app, calls };
}

const entry = { kind: "chart", path: "C:/charts/hard.json" };

test("open recent is a no-operation for the currently open chart", async () => {
	const { app } = makeHarness({ chartPath: "C:/charts/hard.json" });
	assert.deepEqual(await app.recentChartPlan(entry), { action: "none" });
});

test("a chart of the currently open project activates in place", async () => {
	const { app, calls } = makeHarness({
		editingProject: true,
		projectPath: "C:/proj",
		containing: "C:/proj",
	});
	assert.deepEqual(await app.recentChartPlan(entry), { action: "activate", filename: "hard.json" });
	assert.deepEqual(calls.confirms, []);
});

test("a chart of another project offers to open that project", async () => {
	const { app, calls } = makeHarness({ containing: "C:/other" });
	assert.deepEqual(await app.recentChartPlan(entry), {
		action: "openProject",
		directoryPath: "C:/other",
		chartPath: entry.path,
	});
	assert.deepEqual(calls.confirms, ["dialog.openRecent"]);
});

test("declining the other project while a project is open offers adding it", async () => {
	const { app, calls } = makeHarness({ editingProject: true, containing: "C:/other" });
	calls.answer = false;
	assert.deepEqual(await app.recentChartPlan(entry), { action: "openChart" });
	assert.deepEqual(calls.confirms, ["dialog.openRecent", "dialog.addChartToProject"]);
});

test("accepting the add prompt while a project is open adds the chart to it", async () => {
	const { app, calls } = makeHarness({ editingProject: true, containing: "C:/other" });
	// First confirm (open in its project) refused, second (add to current) accepted.
	const confirmations = ["dialog.openRecent", "dialog.addChartToProject"];
	app.dialogs.confirm = async ({ titleKey }) => {
		calls.confirms.push(titleKey);
		return calls.confirms.length > 1;
	};
	const plan = await app.recentChartPlan(entry);
	assert.equal(plan.action, "addToProject");
	assert.deepEqual(calls.confirms, confirmations);
});

test("a standalone chart with a project open offers adding it to the project", async () => {
	const { app, calls } = makeHarness({ editingProject: true });
	assert.deepEqual(await app.recentChartPlan(entry), { action: "addToProject" });
	assert.deepEqual(calls.confirms, ["dialog.addChartToProject"]);
});

test("a standalone chart without a project opens directly", async () => {
	const { app, calls } = makeHarness({});
	assert.deepEqual(await app.recentChartPlan(entry), { action: "openChart" });
	assert.deepEqual(calls.confirms, []);
});
