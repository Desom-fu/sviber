import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	COMMAND_DEFINITIONS,
	MENU_DEFINITION,
	TOOLBAR_ITEMS,
	CommandRegistry,
} from "../js/commands.js";
import { withEventEditing } from "../js/app-event-editing.js";
import { withHistoryCommands } from "../js/app-history-commands.js";
import { ChartModel } from "../js/core/chart-model.js";
import { MESSAGES } from "../js/i18n.js";

function keyboardEvent(key, target) {
	return {
		key, target, defaultPrevented: false, isComposing: false,
		ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false,
		preventDefault() { this.defaultPrevented = true; },
		stopImmediatePropagation() {},
	};
}

test("v11 localization is loaded from matching JSON dictionaries", async () => {
	const [source, english, chinese] = await Promise.all([
		readFile(new URL("../js/i18n.js", import.meta.url), "utf8"),
		readFile(new URL("../json/i18n.en-US.json", import.meta.url), "utf8").then(JSON.parse),
		readFile(new URL("../json/i18n.zh-CN.json", import.meta.url), "utf8").then(JSON.parse),
	]);
	assert.match(source, /i18n\.en-US\.json/);
	assert.match(source, /i18n\.zh-CN\.json/);
	assert.deepEqual(Object.keys(english).sort(), Object.keys(chinese).sort());
	assert.equal(english["option.language.chinese"], "Simplified Chinese");
	assert.equal(MESSAGES["en-US"]["option.language.chinese"], "Simplified Chinese");
	assert.equal(chinese["option.language.english"], "英文");
});

test("layout toggles preserve the stage grid slot when hiding a side", async () => {
	const [css, layout, editing, timeline] = await Promise.all([
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
		readFile(new URL("../js/ui-layout.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app-event-editing.js", import.meta.url), "utf8"),
		readFile(new URL("../js/render/timeline.js", import.meta.url), "utf8"),
	]);
	assert.match(css, /\.editor-row\.is-scroll-hidden\s+#scroll-view-panel,[\s\S]*?visibility:\s*hidden/);
	assert.match(css, /\.editor-row\.is-side-hidden\s+\.side-panel[\s\S]*?pointer-events:\s*none/);
	assert.doesNotMatch(css, /\.editor-row\.is-scroll-hidden[^\{]*\{\s*display:\s*none/);
	assert.doesNotMatch(css, /\.render-surface:hover\s+\.edge-toggle/);
	assert.match(css, /\.stage-surface\.is-hovering-left-edge\s+\.edge-toggle-left/);
	assert.match(css, /\.stage-surface\.is-hovering-right-edge\s+\.edge-toggle-right/);
	assert.match(layout, /offset <= 28/);
	assert.match(layout, /offset >= bounds\.width - 28/);
	assert.match(editing, /this\.timeline\.requestRender\(\);\s*this\.scrollView\?\.requestRender\(\);/);
	assert.match(editing, /onTimelineResize: \(\) => this\.scrollView\?\.requestRender\(\)/);
	assert.match(timeline, /this\.callbacks\.onTimelineResize\?\.\(\)/);
});

test("v11 command surfaces remove duplicate channel rename and add shortcuts and macros", () => {
	const channelMenu = MENU_DEFINITION.find(menu => menu.id === "channel");
	assert.ok(channelMenu);
	assert.equal(COMMAND_DEFINITIONS["channel.rename"], undefined);
	assert.equal(channelMenu.items.some(item => item.command === "channel.rename"), false);
	assert.equal(COMMAND_DEFINITIONS["file.preferences"].shortcut, "Ctrl+/");
	assert.equal(COMMAND_DEFINITIONS["help.documentation"].shortcut, "F1");
	assert.equal(COMMAND_DEFINITIONS["macros.open"].icon, "svg/icons/macros.svg");
	assert.equal(TOOLBAR_ITEMS.includes("macros.open"), true);
});

test("difficulty selector focus preserves Space and numeric shortcuts", () => {
	let executions = 0;
	const registry = new CommandRegistry({
		space: { id: "space", shortcut: "Space" },
		number: { id: "number", shortcut: "1" },
	});
	registry.register("space", () => { executions += 1; });
	registry.register("number", () => { executions += 1; });
	const difficulty = {
		closest() { return difficulty; },
		matches(selector) { return selector === "#difficulty-select"; },
	};
	assert.equal(registry.handleKeyboard(keyboardEvent(" ", difficulty), {}), true);
	assert.equal(registry.handleKeyboard(keyboardEvent("1", difficulty), {}), true);
	assert.equal(executions, 2);
});

test("read-only command policy keeps navigation, Music, comments, and macro access", () => {
	const registry = new CommandRegistry();
	for (const id of Object.keys(COMMAND_DEFINITIONS)) registry.register(id, () => {});
	const context = {
		model: { editor: { readOnly: true } },
		readOnlyCommandAllowed: id => id === "edit.delete",
	};
	for (const id of ["music.playPause", "timeline.pageForward", "edit.selectAll", "events.comment", "macros.open"]) {
		assert.equal(registry.isEnabled(id, context), true, `${id} should remain enabled`);
	}
	for (const id of ["file.save", "edit.undo", "events.tap", "channel.createAbove", "snappee.pen", "transform.free"]) {
		assert.equal(registry.isEnabled(id, context), false, `${id} should be disabled`);
	}
	assert.equal(registry.isEnabled("edit.delete", context), true);
});

test("read-only state round-trips and blocks history navigation", () => {
	const model = ChartModel.createDefault({ editor: { readOnly: true } });
	assert.equal(ChartModel.import(JSON.parse(model.serialize())).editor.readOnly, true);
	let historyCalls = 0;
	const HistoryApp = withHistoryCommands(class {});
	const app = new HistoryApp();
	app.model = model;
	app.history = { goTo() { historyCalls += 1; } };
	assert.equal(app.goToHistory(0), false);
	assert.equal(historyCalls, 0);
});

test("read-only inspector mutations allow comment fields but not type conversion", () => {
	const EditingApp = withEventEditing(class {
		constructor(model) { this.model = model; }
		commit(_label, mutation, options = {}) {
			if (this.model.editor.readOnly && !options.allowReadOnly) return null;
			return mutation(this.model);
		}
		rememberCreationDefaults() {}
	});
	const model = ChartModel.createDefault({
		editor: { readOnly: true },
		events: [{
			id: 1, type: "comment", channel: 0, time: [0, 0, 1], duration: [1, 0, 1],
			text: "before", selected: true,
		}],
	});
	const app = new EditingApp(model);
	app.editSelectedProperty("text", "after");
	assert.equal(model.events[0].text, "after");
	app.editSelectedProperty("type", "tap");
	assert.equal(model.events[0].type, "comment");
});

test("v11 UI uses icon controls, sliders, fullscreen, read-only macros, and PWA caching", async () => {
	const [index, styles, fields, core, macros, bridge, manifestText, worker] = await Promise.all([
		readFile(new URL("../index.html", import.meta.url), "utf8"),
		readFile(new URL("../css/app-v11.css", import.meta.url), "utf8"),
		readFile(new URL("../js/ui-fields.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app-core.js", import.meta.url), "utf8"),
		readFile(new URL("../js/macros.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app-macro-bridge.js", import.meta.url), "utf8"),
		readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8"),
		readFile(new URL("../service-worker.js", import.meta.url), "utf8"),
	]);
	for (const id of ["lock-visible-range", "play-se", "seek-back-after-playing", "metronome", "read-only", "fullscreen"]) {
		assert.match(index, new RegExp(`id="${id}"[\\s\\S]*?<img`));
	}
	assert.match(styles, /\.status-option input:checked \+ img/);
	assert.match(fields, /input\.type = 'range'/);
	assert.match(fields, /createElement\('output'\)/);
	assert.match(core, /event\.key === "F11"/);
	assert.match(core, /sviber-macro-read-only/);
	assert.match(macros, /if \(readOnly\).*?error\.readOnly/);
	assert.match(macros, /editor\.updateOptions\(\{ readOnly: !editable \}\)/);
	assert.match(bridge, /readOnly: Boolean\(app\.model\.editor\.readOnly\)/);
	const manifest = JSON.parse(manifestText);
	assert.equal(manifest.id, "./");
	assert.equal(manifest.display, "standalone");
	assert.match(worker, /json\/i18n\.en-US\.json/);
	assert.match(worker, /json\/i18n\.zh-CN\.json/);
	assert.match(worker, /js\/ui-layout\.js/);
});

test("v11 Scroll View, manual, and release notes describe the implemented behavior", async () => {
	const [scrollView, manual, manualScript, manualStyles, readme, readmeZh] = await Promise.all([
		readFile(new URL("../js/render/scroll-view.js", import.meta.url), "utf8"),
		readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
		readFile(new URL("../docs/docs.js", import.meta.url), "utf8"),
		readFile(new URL("../docs/docs.css", import.meta.url), "utf8"),
		readFile(new URL("../README.md", import.meta.url), "utf8"),
		readFile(new URL("../README.zh-CN.md", import.meta.url), "utf8"),
	]);
	assert.match(scrollView, /timeScale = Math\.max\(0\.1, timelineWidth \/ visibleSpan\)/);
	assert.match(scrollView, /xScale = Math\.max/);
	assert.match(manual, /icon controls have no visible text labels/);
	assert.match(manual, /状态栏图标控件没有可见文字/);
	assert.match(manual, /same pixels-per-second scale/);
	assert.match(manual, /纵向每秒像素比例与时间轴/);
	assert.match(manual, /id="manual-search-input"/);
	assert.match(manualScript, /function applySearch/);
	assert.match(manualScript, /searchLabels/);
	assert.match(manualStyles, /#manual-search-input/);
	assert.match(readme, /macOS provides x86_64 and aarch64 ZIP archives/);
	assert.match(readmeZh, /macOS 提供 x86_64 和 aarch64 ZIP/);
});
