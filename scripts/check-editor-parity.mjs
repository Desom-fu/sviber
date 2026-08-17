import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectDirectory = path.resolve(import.meta.dirname, "..");
const originalDirectory = path.resolve(projectDirectory, "..", "sviber_original");
const sharedFiles = [
	"audio/decoder.js", "audio/player.js", "audio/scheduler.js", "audio/waveform.js",
	"js/app-chart-tools.js", "js/app-event-editing.js",
	"js/core/chart-model.js", "js/core/geometry.js", "js/core/history.js",
	"js/core/rational.js", "js/core/timing.js", "js/panels.js",
	"js/ui.js", "js/ui-dialogs.js", "js/ui-fields.js", "js/ui-panels.js",
	"js/ui-shared.js", "js/ui-shell.js",
	"render/pixi-surface.js", "render/stage.js", "render/stage-core.js",
	"render/stage-helpers.js", "render/stage-interactions.js", "render/stage-notes.js",
	"render/timeline.js",
];

let originalAvailable = true;
try {
	await access(originalDirectory);
} catch {
	originalAvailable = false;
	console.log("Shared editor parity check skipped: sviber_original is not present beside sviber.");
}

if (originalAvailable) {
	for (const filename of sharedFiles) {
		const [current, original] = await Promise.all([
			readFile(path.join(projectDirectory, filename)),
			readFile(path.join(originalDirectory, filename)),
		]);
		assert.deepEqual(current, original, `Shared editor module differs: ${filename}`);
	}

	const [currentCommands, originalCommands, currentHelpers, originalHelpers] = await Promise.all([
		import(pathToFileURL(path.join(projectDirectory, "js/commands.js"))),
		import(pathToFileURL(path.join(originalDirectory, "js/commands.js"))),
		import(pathToFileURL(path.join(projectDirectory, "js/app-helpers.js"))),
		import(pathToFileURL(path.join(originalDirectory, "js/app-helpers.js"))),
	]);
	const nonFileCommands = definitions => Object.fromEntries(Object.entries(definitions)
		.filter(([id]) => !id.startsWith("file."))
		.map(([id, definition]) => [id, definition]));
	assert.deepEqual(nonFileCommands(currentCommands.COMMAND_DEFINITIONS),
		nonFileCommands(originalCommands.COMMAND_DEFINITIONS));
	assert.deepEqual(currentCommands.MENU_DEFINITION.filter(menu => menu.id !== "file"),
		originalCommands.MENU_DEFINITION.filter(menu => menu.id !== "file"));
	assert.deepEqual(currentHelpers.metadataFields(), originalHelpers.metadataFields());
	for (const directory of [projectDirectory, originalDirectory]) {
		const translations = await readFile(path.join(directory, "js/i18n.js"), "utf8");
		assert.match(translations, /'field\.artist': '曲师'/);
		assert.match(translations, /'field\.charter': '谱师'/);
	}
	console.log(`Shared editor parity check passed: ${sharedFiles.length} modules plus non-file commands and fields match.`);
}
