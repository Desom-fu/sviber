import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ChartModel } from "../js/core/chart-model.js";
import { COMMAND_DEFINITIONS, MENU_DEFINITION } from "../js/commands.js";
import {
	importLyricaChart,
	lyricaChannelCategory,
	lyricaChannelName,
} from "../js/core/lyrica.js";
import { AutosaveManager } from "../js/platform.js";

const SAMPLE = [
	"120|Demo|Artist|0|4|0",
	"#1",
	"0.5|-60|20|10|1|0|A|5|0",
	"#2",
	"3|100|10|10|1|0|Z|0|0",
	"#3",
	"",
	"#4",
	"",
].join("\n");

test("Show HUD defaults on and persists", () => {
	const model = ChartModel.createDefault();
	assert.equal(model.editor.showHud, true);
	model.editor.showHud = false;
	const restored = ChartModel.import({ sviber: model.serializeSviber(), metadata: model.metadata });
	assert.equal(restored.editor.showHud, false);
});

test("v15 commands add recent, autosave, run macro, and HUD icon", async () => {
	assert.ok(COMMAND_DEFINITIONS["file.openRecent"]);
	assert.ok(COMMAND_DEFINITIONS["file.openAutosave"]);
	assert.ok(COMMAND_DEFINITIONS["macros.run"]);
	const file = MENU_DEFINITION.find(menu => menu.id === "file");
	const macros = MENU_DEFINITION.find(menu => menu.id === "macros");
	assert.ok(file.items.some(item => item.command === "file.openRecent"));
	assert.ok(file.items.some(item => item.command === "file.openAutosave"));
	assert.ok(macros.items.some(item => item.command === "macros.run"));
	const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
	assert.match(html, /id="show-hud"/);
	assert.match(html, /show-hud\.svg/);
});

test("Lyrica import uses numeric channel names, RNOVA default, and treats 100 as inactive bg notes", () => {
	assert.equal(lyricaChannelName(-60), "-60");
	assert.equal(lyricaChannelCategory(100), "bgNote");
	assert.equal(lyricaChannelCategory(120), "disabled");
	const state = importLyricaChart(SAMPLE, { seed: 1, quantizationDenominator: 16, difficultyName: "Hard", difficulty: "10" });
	assert.equal(state.metadata.charter, "RNOVA");
	assert.equal(state.metadata.difficultyName, "Hard");
	assert.equal(state.metadata.difficulty, "10");
	assert.equal(state.channels.find(channel => channel.lyricaChannel === -60).name, "-60");
	const unused = state.channels.find(channel => channel.lyricaChannel === 140);
	assert.equal(unused.active, false);
	assert.equal(unused.name, "140");
	const special = state.channels.find(channel => channel.lyricaChannel === 100);
	assert.equal(special.active, false);
	const note = state.events.find(event => event.text === "Z");
	assert.equal(note.type, "bgNote");
	assert.equal(note.channel, special.id);
});

test("autosave listed entries include older saves", () => {
	const storage = new Map();
	const fake = {
		getItem(key) { return storage.has(key) ? storage.get(key) : null; },
		setItem(key, value) { storage.set(key, String(value)); },
		removeItem(key) { storage.delete(key); },
	};
	const manager = new AutosaveManager({ storage: fake, interval: 0 });
	const first = manager.save(ChartModel.createDefault({ metadata: { title: "One" } }));
	manager.markManualSave();
	const second = manager.save(ChartModel.createDefault({ metadata: { title: "Two" } }));
	assert.equal(manager.recoverable().length, 1);
	assert.equal(manager.listed().length, 2);
	assert.ok(manager.listed().some(entry => entry.timestamp === first));
	assert.ok(manager.listed().some(entry => entry.timestamp === second));
});

test("v15 help and inspector Enter apply the focused field", async () => {
	const [help, panels, zh] = await Promise.all([
		readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
		readFile(new URL("../js/panels.js", import.meta.url), "utf8"),
		readFile(new URL("../json/i18n.zh-CN.json", import.meta.url), "utf8"),
	]);
	assert.match(help, /Show HUD/);
	assert.match(help, /Open recent/);
	assert.match(help, /Open auto-save/);
	assert.match(help, /Run macro/);
	assert.match(help, /显示 HUD/);
	assert.match(help, /打开最近文件/);
	assert.match(help, /运行宏/);
	assert.match(zh, /运行宏/);
	assert.match(panels, /event\.key === "Enter"/);
});
