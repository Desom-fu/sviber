import assert from "node:assert/strict";
import test from "node:test";
import { COMMAND_DEFINITIONS, MENU_DEFINITION, TOOLBAR_ITEMS } from "../js/app/commands.js";
import { HelpController } from "../js/ui/help.js";
import { assertSourceContracts, readJson, readSource } from "./audit-contract-helpers.mjs";
import { manualArticle } from "./module-source.mjs";

function node(tag) {
	return {
		tag,
		children: [],
		dataset: {},
		className: "",
		textContent: "",
		append(...children) {
			this.children.push(...children);
		},
	};
}

test("menu bar keyboard navigation and dismissal work through the documented controls", async () => {
	const shell = await readSource("js/ui/ui-shell.js");
	await assertSourceContracts([
		["js/ui/ui-shell.js", [/altKey|Alt/, /ArrowUp|ArrowDown|Tab/, /Enter|Space/, /pointerdown|click/, /separator/, /title/]],
	]);
	assert.match(shell, /menu/);
});

test("toolbar exposes the same command shortcut and tooltip surfaces", async () => {
	const [shell, commands] = await Promise.all([
		readSource("js/ui/ui-shell.js"),
		readSource("js/app/commands.js"),
	]);
	assert.match(commands, /TOOLBAR_ITEMS/);
	assert.match(shell, /toolbar|Toolbar/);
	assert.match(shell, /shortcut/);
	assert.match(shell, /tooltip|title/);
	assert.match(shell, /mouseenter|mouseover|click/);
	assert.ok(TOOLBAR_ITEMS.length > 0);
});

test("chart selector formats difficulties and persists active chart changes", async () => {
	await assertSourceContracts([
		["js/app/app-difficulty-state.js", [/difficultyName/, /difficultyColor/, /difficultySup/, /style\.color/, /style\.width/, /globalThis\.nw/]],
		["js/app/app-document-lifecycle.js", [/confirmUnsavedChart/]],
		["js/app/app-project-files.js", [/persistProjectManifest/]],
	]);
});

test("keyboard shortcut dialog contains every defined keyboard shortcut", async () => {
	const previousDocument = globalThis.document;
	const hadDocument = Object.hasOwn(globalThis, "document");
	globalThis.document = { createElement: tag => node(tag) };
	let dialog;
	try {
		const help = new HelpController({
			i18n: { t: key => key, shortcut: shortcut => shortcut },
			dialogs: {
				open: async options => {
					dialog = options;
				},
			},
		});
		await help.showKeyboardShortcuts(COMMAND_DEFINITIONS);
		const commandIds = dialog.content.children
			.flatMap(column => column.children)
			.flatMap(group => group.children[1].children)
			.map(item => item.dataset.command)
			.sort();
		const expected = Object.values(COMMAND_DEFINITIONS)
			.filter(definition => definition.shortcut)
			.map(definition => definition.id)
			.sort();
		assert.deepEqual(commandIds, expected);
	} finally {
		if (hadDocument) {
			globalThis.document = previousDocument;
		} else {
			delete globalThis.document;
		}
	}
});

test("application shell uses the service worker without an entrypoint cache buster", async () => {
	const [serviceWorker, index, packageSource] = await Promise.all([
		readSource("service-worker.js"),
		readSource("index.html"),
		readSource("package.json"),
	]);
	assert.equal(JSON.parse(packageSource).version, "0.14.3");
	assert.match(serviceWorker, /CACHE_VERSION = "sviber-v[^"]+"/);
	assert.match(serviceWorker, /package-lock\.json/);
	assert.match(serviceWorker, /js\/app\/app\.js"/);
	assert.doesNotMatch(serviceWorker, /js\/app\/app\.js\?v=/);
	assert.match(index, /js\/app\/app\.js"/);
	assert.doesNotMatch(index, /js\/app\/app\.js\?v=/);
});

test("bilingual manuals mention the current channel and recovery shortcuts", async () => {
		const [english, chinese] = await Promise.all([
			readJson("json/manual.en.json"),
			readJson("json/manual.zh-CN.json"),
		]);
		for (const [manual, directions] of [
			[manualArticle(english), ["Ctrl+Alt+Up", "Ctrl+Alt+Down"]],
			[manualArticle(chinese), ["Ctrl+Alt+上", "Ctrl+Alt+下"]],
		]) {
			for (const shortcut of [
				"Ctrl+,",
				"Ctrl+K",
				"Ctrl+Alt+K",
				"Ctrl+J",
				"Ctrl+Alt+J",
				...directions,
				"PageUp",
				"PageDown",
			]) {
				assert.ok(manual.includes(shortcut), shortcut);
			}
			assert.match(manual, /Open auto-save|打开自动保存/);
		}
		assert.equal(COMMAND_DEFINITIONS["music.seekBackward3"].shortcut, "Ctrl+,");
	});
