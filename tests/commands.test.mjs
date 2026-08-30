import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { toggledCreationMode } from "../js/app/app-history-commands.js";
import { COMMAND_DEFINITIONS, CommandRegistry, MENU_DEFINITION, TOOLBAR_ITEMS } from "../js/app/commands.js";
import { MESSAGES } from "../js/ui/i18n.js";

function menuById(id) {
	return MENU_DEFINITION.find(menu => menu.id === id);
}

function commandIndex(menuId, commandId) {
	return menuById(menuId).items.findIndex(item => item.command === commandId);
}

function assertCommand(id, fields) {
	const command = COMMAND_DEFINITIONS[id];
	assert.ok(command, id);
	for (const [key, value] of Object.entries(fields)) {
		assert.equal(command[key], value, `${id}.${key}`);
	}
}

test("opening a menu updates only commands in that menu", async () => {
	const source = await readFile(new URL("../js/ui/ui-shell.js", import.meta.url), "utf8");
	assert.match(source, /Array\.isArray\(id\)/);
	assert.match(source, /this\.definition\[index\]\.items[\s\S]*?this\.updateState\(/);
});

test("command surfaces remove duplicate channel rename and add shortcuts and macros", () => {
	const channelMenu = MENU_DEFINITION.find(menu => menu.id === "channel");
	assert.ok(channelMenu);
	assert.equal(COMMAND_DEFINITIONS["channel.rename"], undefined);
	assert.equal(
		channelMenu.items.some(item => item.command === "channel.rename"),
		false,
	);
	assert.equal(COMMAND_DEFINITIONS["file.preferences"].shortcut, "Ctrl+/");
	assert.equal(COMMAND_DEFINITIONS["help.documentation"].shortcut, "F1");
	assert.equal(COMMAND_DEFINITIONS["macros.open"].icon, "svg/icons/macros.svg");
	assert.equal(TOOLBAR_ITEMS.includes("macros.open"), true);
});

test("checked commands notify the UI only when their state changes", () => {
	const registry = new CommandRegistry({ toggle: { id: "toggle" } });
	let notifications = 0;
	registry.subscribe(() => {
		notifications += 1;
	});
	registry.setChecked("toggle", false);
	registry.setChecked("toggle", true);
	registry.setChecked("toggle", true);
	assert.equal(notifications, 1);
});

test("event tools toggle the active creation mode and groups keep shortcuts", async () => {
	assert.equal(toggledCreationMode("tap", "tap"), null);
	assert.equal(toggledCreationMode(null, "tap"), "tap");
	assert.equal(toggledCreationMode("tap", "hold"), "hold");
	assert.equal(COMMAND_DEFINITIONS["events.group"].shortcut, "Ctrl+G");
	assert.equal(COMMAND_DEFINITIONS["events.ungroup"].shortcut, "Ctrl+Shift+G");
	const [english, chinese, css, overlays] = await Promise.all([
		readFile(new URL("../json/i18n.en-US.json", import.meta.url), "utf8"),
		readFile(new URL("../json/i18n.zh-CN.json", import.meta.url), "utf8"),
		readFile(new URL("../css/app.css", import.meta.url), "utf8"),
		readFile(new URL("../css/overlays.css", import.meta.url), "utf8"),
	]);
	const shortcutStyles = `${css}\n${overlays}`;
	assert.equal(JSON.parse(english)["event.group"], "Group");
	assert.equal(JSON.parse(chinese)["event.group"], "分组");
	assert.match(shortcutStyles, /\.dialog\.keyboard-shortcuts-dialog\s*\{[^}]*width:\s*min\(980px/);
	assert.match(shortcutStyles, /\.shortcut-columns\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
	assert.match(
		shortcutStyles,
		/@media\s*\(max-width:\s*760px\)[\s\S]*\.shortcut-columns\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
	);
	assert.match(shortcutStyles, /\.shortcut-item\s*\{/);
	assert.match(
		shortcutStyles,
		/\.shortcut-group-list\s*\{[^}]*grid-template-columns:\s*max-content\s+minmax\(0,\s*1fr\)/,
	);
	assert.match(shortcutStyles, /\.shortcut-item\s*\{[^}]*grid-template-columns:\s*subgrid/);
	assert.match(shortcutStyles, /\.shortcut-columns kbd\s*\{[^}]*border:\s*1px solid/);
	assert.equal(JSON.parse(english)["command.snappee.bezierCurve"], "Bézier curve");
	assert.equal(JSON.parse(chinese)["command.snappee.bezierCurve"], "Bézier 曲线");
	assert.equal(MENU_DEFINITION.find(menu => menu.id === "timing").mnemonic, "t");
	assert.equal(MENU_DEFINITION.find(menu => menu.id === "transform").mnemonic, "r");
});

test("commands expose bar line and time dilation", () => {
	assert.equal(COMMAND_DEFINITIONS["timing.barLine"].shortcut, "R");
	assert.ok(COMMAND_DEFINITIONS["transform.timeDilation"]);
	const timing = MENU_DEFINITION.find(menu => menu.id === "timing");
	const transform = MENU_DEFINITION.find(menu => menu.id === "transform");
	assert.ok(timing.items.some(item => item.command === "timing.barLine"));
	assert.ok(transform.items.some(item => item.command === "transform.timeDilation"));
});

test("commands move Channel items, add Lyrica export, bar-line icon, and shortcut 0", () => {
	assert.ok(COMMAND_DEFINITIONS["file.exportLyrica"]);
	assert.equal(COMMAND_DEFINITIONS["music.subdivisionOther"].shortcut, "0");
	assert.match(COMMAND_DEFINITIONS["timing.barLine"].icon, /bar-line\.svg$/);
	const file = MENU_DEFINITION.find(menu => menu.id === "file");
	const events = MENU_DEFINITION.find(menu => menu.id === "events");
	const channel = MENU_DEFINITION.find(menu => menu.id === "channel");
	assert.ok(file.items.some(item => item.command === "file.exportLyrica"));
	assert.ok(!events.items.some(item => item.command === "events.moveChannelAbove"));
	assert.ok(!events.items.some(item => item.command === "events.moveChannelBelow"));
	assert.equal(channel.items[0].command, "events.moveChannelAbove");
	assert.equal(channel.items[1].command, "events.moveChannelBelow");
	assert.equal(channel.items[2].command, "channel.moveAboveWithinChannel");
	assert.equal(channel.items[3].command, "channel.moveBelowWithinChannel");
	assert.equal(channel.items[4].type, "separator");
	assert.ok(channel.items.some(item => item.command === "channel.hide"));
	assert.ok(channel.items.some(item => item.command === "channel.showAll"));
	assert.ok(TOOLBAR_ITEMS.includes("timing.barLine"));
	assert.ok(TOOLBAR_ITEMS.includes("events.moveChannelAbove"));
});

test("commands add recent, autosave, run macro, and HUD icon", async () => {
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

test("File menu adds Close and disables Open recent on the web", () => {
	assert.ok(COMMAND_DEFINITIONS["file.close"]);
	assert.equal(COMMAND_DEFINITIONS["file.close"].shortcut, null);
	assert.equal(COMMAND_DEFINITIONS["file.openRecent"].desktopOnly, true);
	const fileItems = MENU_DEFINITION.find(menu => menu.id === "file").items;
	assert.ok(fileItems.some(item => item.command === "file.close"));
	assert.ok(
		fileItems.findIndex(item => item.command === "file.close") >
			fileItems.findIndex(item => item.command === "file.deleteChart"),
	);
});

test("command definitions cover the new file, edit, timing and channel actions", () => {
	assertCommand("file.reloadChart", { desktopOnly: true });
	assertCommand("file.renameChart", { desktopOnly: true });
	assertCommand("edit.checks", {});
	assertCommand("timing.adjustOffset", {
		checkable: true,
		icon: "svg/icons/adjust-offset.svg",
	});
	assertCommand("timing.automatic", {});
	assertCommand("channel.deactivate", { shortcut: "Ctrl+K" });
	assertCommand("channel.activateAll", { shortcut: "Ctrl+Alt+K" });
	assertCommand("channel.hide", { shortcut: "Ctrl+J" });
	assertCommand("channel.showAll", { shortcut: "Ctrl+Alt+J" });
	assertCommand("channel.moveAboveWithinChannel", { shortcut: "Ctrl+Alt+ArrowUp" });
	assertCommand("channel.moveBelowWithinChannel", { shortcut: "Ctrl+Alt+ArrowDown" });
	assertCommand("snappee.deactivateAll", { shortcut: "Alt+Shift+A" });
	assertCommand("snappee.attachCurveOrder", {});
	assertCommand("snappee.attachCurveTime", {});
	assertCommand("transform.flipHorizontalReattach", { shortcut: "Ctrl+%" });
	assertCommand("transform.flipVerticalReattach", { shortcut: 'Ctrl+"' });
	assertCommand("transform.timeTranslation", {});
	assertCommand("transform.reverseTime", {});
	assertCommand("music.speedOther", { shortcut: "Ctrl+0" });
	assertCommand("music.seekBackward3", { shortcut: "Ctrl+," });
	for (const id of ["music.subdivision5", "music.subdivision7", "music.subdivision9"]) {
		assert.ok(COMMAND_DEFINITIONS[id], id);
	}
	for (const suffix of [3, 5, 6, 7, 8, 9]) {
		assert.ok(COMMAND_DEFINITIONS[`music.speedInverse${suffix}`], `speedInverse${suffix}`);
	}
});

test("menus place reload, rename, checks, timing, reverseTime and attach-curve", () => {
	const fileItems = menuById("file").items;
	const autosave = commandIndex("file", "file.openAutosave");
	const reload = commandIndex("file", "file.reloadChart");
	assert.ok(reload > autosave);
	assert.equal(fileItems[autosave + 1].command, "file.reloadChart");
	const rename = commandIndex("file", "file.renameChart");
	const properties = commandIndex("file", "file.chartProperties");
	assert.ok(rename < properties);
	assert.equal(fileItems[rename + 1].command, "file.chartProperties");

	const editItems = menuById("edit").items;
	assert.equal(editItems.at(-1).command, "edit.checks");

	const timingItems = menuById("timing").items;
	const adjust = commandIndex("timing", "timing.adjustOffset");
	assert.equal(timingItems[adjust].command, "timing.adjustOffset");
	assert.equal(timingItems[adjust + 1].command, "timing.automatic");
	assert.equal(timingItems[adjust + 2].type, "separator");

	assert.ok(commandIndex("transform", "transform.reverseTime") >= 0);
	assert.equal(commandIndex("events", "transform.reverseTime"), -1);
	assert.ok(commandIndex("snappee", "snappee.attachCurveOrder") >= 0);
	assert.ok(commandIndex("snappee", "snappee.attachCurveTime") >= 0);
});

test("commands have shortcuts and complete English and Chinese text", () => {
	const expectedShortcuts = {
		"events.comment": "Ctrl+M",
		"channel.selectAbove": "Alt+ArrowUp",
		"channel.selectBelow": "Alt+ArrowDown",
		"timeline.pageForward": "PageUp",
		"timeline.pageBackward": "PageDown",
	};
	for (const [id, shortcut] of Object.entries(expectedShortcuts)) {
		assert.equal(COMMAND_DEFINITIONS[id].shortcut, shortcut);
	}
	for (const language of Object.keys(MESSAGES)) {
		for (const definition of Object.values(COMMAND_DEFINITIONS)) {
			assert.ok(MESSAGES[language][definition.labelKey], `${language} lacks ${definition.labelKey}`);
			assert.ok(MESSAGES[language][definition.hintKey], `${language} lacks ${definition.hintKey}`);
		}
		for (const key of [
			"menu.help",
			"panel.channels",
			"dialog.comment",
			"dialog.editChannel",
			"dialog.about",
			"dialog.copy",
			"field.endTime",
			"event.comment",
			"panel.channel.activate",
			"panel.channel.deactivate",
			"panel.channel.duplicate",
			"panel.channel.moveUp",
			"panel.channel.moveDown",
			"panel.channel.delete",
			"panel.channel.rename",
			"panel.channel.edit",
			"history.editChannel",
			"about.repository",
			"about.license",
			"about.version",
			"about.commit",
			"about.commitDate",
			"about.nwVersion",
			"about.browserVersion",
			"about.engineVersion",
			"about.nodeVersion",
			"about.v8Version",
			"about.operatingSystem",
		]) {
			assert.ok(MESSAGES[language][key], `${language} lacks ${key}`);
		}
	}
});
