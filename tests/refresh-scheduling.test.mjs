import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readSources } from "./module-source.mjs";
import { withFreeTransform } from "../js/app/app-free-transform.js";

test("drops bgNote angle and avoids long-session full snapshots/refreshes", async () => {
	await import("../js/macro/macro-api.js");
	const runtime = globalThis.createSviberMacroApi({
		editor: { currentChannel: 0, currentTime: [0, 0, 1] },
		channels: [{ id: 0, name: "Main", color: "#ffffff", active: true }],
		events: [],
		snappees: [],
		clips: [],
		timing: { offset: 0, initialBpm: 120, bpmChanges: [], barLines: [] },
	});
	const api = runtime.globals;
	const ink = api.bgNote(new api.Location(1, 2), [1, 0, 1], "hello");
	assert.equal(ink.text, "hello");
	assert.throws(() => ink.angle, /angle is only valid for flick/);
	assert.deepEqual(runtime.state.events.at(-1).duration, [1, 0, 1]);
	assert.equal(Object.hasOwn(runtime.state.events.at(-1), "angle"), false);
	const caption = api.bgNote(new api.Location(3, 4), "caption");
	assert.equal(caption.text, "caption");
	assert.deepEqual(runtime.state.events.at(-1).duration, [0, 0, 1]);
	const [core, transport, editing, transform, stage, index, jsApi, rubyApi] = await Promise.all([
		readFile(new URL("../js/app/app-core.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-playback-transport.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-event-editing.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-free-transform.js", import.meta.url), "utf8"),
		readSources(["../js/render/stage-core.js", "../js/render/stage-snappees.js"]),
		readFile(new URL("../js/render/chart-index.js", import.meta.url), "utf8"),
		readFile(new URL("../js/macro/macro-api.js", import.meta.url), "utf8"),
		readFile(new URL("../js/macro/macro-api.rb", import.meta.url), "utf8"),
	]);
	assert.match(transform, /if \(snapshotsEqual\(after, before\)\)/);
	for (const source of [core, transport]) {
		assert.doesNotMatch(source, /JSON\.stringify\((?:this|app)\.model\.snapshot\(\)\)/);
	}
	assert.match(transport, /\.audio\.addEventListener\("play"[\s\S]*\.refreshPlaybackFrame\(\)/);
	assert.match(transport, /refreshPlaybackFrame\(\)[\s\S]*?_updatePlaybackStatus\?\.\(\)/);
	assert.doesNotMatch(editing, /JSON\.stringify\(this\.model\.snapshot\(\)\)/);
	assert.doesNotMatch(
		await readFile(new URL("../js/app/app-selection-preview.js", import.meta.url), "utf8"),
		/renderIndex\.eventById\.size === this\.model\.allEvents\(\)\.length/,
	);
	assert.match(stage, /_canReuseStaticLayer/);
	assert.match(stage, /snappeePaths\?\.get\(snappee\)/);
	assert.match(index, /this\.snappeePaths = new Map\(\)/);
	assert.match(jsApi, /bgNote: \(location, duration = 0, text = ""\)/);
	assert.doesNotMatch(jsApi, /bgNote: \(location, angle,/);
	assert.match(rubyApi, /def bg_note\(location, duration = 0, text = ""\)/);
	assert.doesNotMatch(rubyApi, /def bg_note\(location, angle,/);
});

test("status controls use targeted refreshes instead of rebuilding the editor", async () => {
	const [statusBindings, viewRefresh, workflows] = await Promise.all([
		readFile(new URL("../js/app/app-status-bindings.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-view-refresh.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-open-save.js", import.meta.url), "utf8"),
	]);
	const statusBinding = statusBindings.slice(
		statusBindings.indexOf("for (const id of STATUS_TOGGLE_IDS)"),
		statusBindings.indexOf('document.getElementById("read-only")'),
	);
	assert.match(viewRefresh, /refreshStatusViews\(options = \{\}\)/);
	assert.match(statusBinding, /refreshStatusViews\(STATUS_TOGGLE_VIEWS\[id\] \|\| \{\}\)/);
	assert.doesNotMatch(statusBinding, /\bthis\.refresh\(\);/);
	assert.match(statusBinding, /lightweight: true,\s*viewOnly: true,\s*dirty: false/);
	assert.match(workflows, /this\.requestStatusUpdate\(\);[\s\S]*?return true;/);
});

test("commits use incremental refresh by default and reserve full refresh for panel domains", () => {
	const App = withFreeTransform(
		class {
			refresh() {
				this.full = true;
			}

			_invalidatePlaybackSchedule() {}
		},
	);
	const makeApp = () => {
		const app = new App();
		app._refreshLightweight = function () {
			this.light = true;
		};
		app.model = {
			value: 0,
			music: "",
			image: "",
			metadata: { title: "t" },
			channels: [],
			snappees: [],
			clips: [],
			snapshot() {
				return { value: this.value };
			},
			allEvents() {
				return [];
			},
		};
		app.history = { record: () => true };
		return app;
	};
	const incremental = makeApp();
	incremental._finishCommit("edit", model => {
		model.value = 1;
	});
	assert.equal(incremental.light, true);
	assert.equal(incremental.full, undefined);
	const full = makeApp();
	full._finishCommit("metadata", model => {
		model.metadata.title = "next";
	});
	assert.equal(full.full, true);
	assert.equal(full.light, undefined);
});
