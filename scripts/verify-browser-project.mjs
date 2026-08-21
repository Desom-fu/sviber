import assert from "node:assert/strict";
import path from "node:path";

export async function runProjectChecks(page, outputDirectory) {
	const difficultyFixture = await page.evaluate(() => {
		const app = globalThis.sviber;
		const originalForm = app.dialogs.form;
		const originalConfirm = app.dialogs.confirm;
		const originalConfirmUnsavedChart = app.confirmUnsavedChart;
		const firstId = app.activeDifficultyId;
		const firstCount = app.model.events.length;
		app.commit("browser difficulty fixture", model => {
			model.addEvent("tap", {
				time: [64, 0, 1], channel: model.channels[0].id, x: -37.5, y: 12.5,
			});
		});
		app.dialogs.form = async options => options.titleKey === "dialog.newChart" ? {
			...app.model.metadata,
			difficultyName: "Master",
			difficultyColor: "#de59a3",
			difficulty: "12",
			difficultySup: "+",
			offset: app.model.timing.offset,
			initialBpm: app.model.timing.initialBpm,
		} : originalForm(options);
		app.dialogs.confirm = async () => true;
		app.confirmUnsavedChart = async () => true;
		document.querySelector(".difficulty-switcher").hidden = false;
		globalThis.__difficultyFixture = { originalForm, originalConfirm, originalConfirmUnsavedChart, firstId, firstCount };
		return { firstId, firstCount };
	});
	await page.evaluate(() => globalThis.sviber.newDifficulty());
	await page.waitForFunction(firstId => globalThis.sviber.difficulties.length === 2
		&& globalThis.sviber.activeDifficultyId !== firstId, difficultyFixture.firstId);
	await page.waitForFunction(() => document.querySelectorAll("#difficulty-select option").length === 2);
	const secondId = await page.evaluate(() => globalThis.sviber.activeDifficultyId);
	assert.equal(await page.locator("#difficulty-select option").count(), 2);
	assert.match(await page.locator("#difficulty-select").inputValue(), /^difficulty-/);
	assert.equal(await page.evaluate(() => globalThis.sviber.model.metadata.difficultyName), "Master");
	assert.equal(await page.evaluate(() => globalThis.sviber.model.events.length), 0);
	await page.locator('.status-option:has(#allow-out-of-bound) img').click();
	await page.waitForFunction(() => globalThis.sviber.model.editor.allowOutOfBound === true);
	assert.deepEqual(await page.evaluate(() => {
		const editor = globalThis.sviber.model.toJSON().sviber.editor;
		return { value: editor.allowOutOfBound, hasLegacy: Object.hasOwn(editor, "allowOutOfBounds") };
	}), { value: true, hasLegacy: false });
	await page.locator("#difficulty-select").selectOption(difficultyFixture.firstId);
	await page.waitForFunction(firstId => globalThis.sviber.activeDifficultyId === firstId, difficultyFixture.firstId);
	assert.equal(await page.evaluate(() => globalThis.sviber.model.editor.allowOutOfBound), false,
		"out-of-bound state leaked into the first difficulty");
	await page.locator("#difficulty-select").selectOption(secondId);
	await page.waitForFunction(id => globalThis.sviber.activeDifficultyId === id, secondId);
	assert.equal(await page.evaluate(() => globalThis.sviber.model.editor.allowOutOfBound), true,
		"out-of-bound state was not retained by the second difficulty");
	await page.locator('.status-option:has(#allow-out-of-bound) img').click();
	await page.waitForFunction(() => globalThis.sviber.model.editor.allowOutOfBound === false);
	await page.evaluate(() => {
		const app = globalThis.sviber;
		app.commit("browser master fixture", model => {
			model.addEvent("tap", {
				time: [8, 0, 1], channel: model.channels[0].id, x: 37.5, y: -12.5,
			});
		});
	});
	await page.locator("#difficulty-select").selectOption(difficultyFixture.firstId);
	await page.waitForFunction(firstId => globalThis.sviber.activeDifficultyId === firstId, difficultyFixture.firstId);
	assert.equal(await page.evaluate(() => globalThis.sviber.model.events.length), difficultyFixture.firstCount + 1);
	await page.keyboard.press("Control+z");
	await page.waitForFunction(count => globalThis.sviber.model.events.length === count, difficultyFixture.firstCount);
	await page.locator("#difficulty-select").selectOption(secondId);
	await page.waitForFunction(id => globalThis.sviber.activeDifficultyId === id, secondId);
	assert.equal(await page.evaluate(() => globalThis.sviber.model.events.length), 1,
		"undoing the first difficulty changed the second difficulty history");
	const sharedProjectState = await page.evaluate(() => {
		const app = globalThis.sviber;
		const original = {
			title: app.projectTitle,
			artist: app.projectArtist,
			music: app.projectMusic,
			image: app.projectImage,
		};
		app.projectTitle = "Shared browser title";
		app.projectArtist = "Shared browser artist";
		app.projectMusic = "shared.ogg";
		app.projectImage = "cover.png";
		app.syncProjectSharedFields();
		app.syncProjectHistorySharedFields();
		app.undo();
		const afterUndo = app.difficulties.map(entry => ({
			title: entry.model.metadata.title,
			artist: entry.model.metadata.artist,
			music: entry.model.music,
			image: entry.model.image,
		}));
		app.redo();
		const afterRedo = app.difficulties.map(entry => ({
			title: entry.model.metadata.title,
			artist: entry.model.metadata.artist,
			music: entry.model.music,
			image: entry.model.image,
		}));
		app.projectTitle = original.title;
		app.projectArtist = original.artist;
		app.projectMusic = original.music;
		app.projectImage = original.image;
		app.syncProjectSharedFields();
		app.syncProjectHistorySharedFields();
		return { afterUndo, afterRedo, eventCount: app.model.events.length };
	});
	const expectedShared = {
		title: "Shared browser title", artist: "Shared browser artist", music: "shared.ogg", image: "cover.png",
	};
	assert.ok(sharedProjectState.afterUndo.every(state => JSON.stringify(state) === JSON.stringify(expectedShared)),
		`shared project fields diverged after undo: ${JSON.stringify(sharedProjectState.afterUndo)}`);
	assert.ok(sharedProjectState.afterRedo.every(state => JSON.stringify(state) === JSON.stringify(expectedShared)),
		`shared project fields diverged after redo: ${JSON.stringify(sharedProjectState.afterRedo)}`);
	assert.equal(sharedProjectState.eventCount, 1);
	const sharedMetadataHistory = await page.evaluate(async () => {
		const app = globalThis.sviber;
		const originalForm = app.dialogs.form;
		const original = { title: app.projectTitle, artist: app.projectArtist };
		app.dialogs.form = async () => ({
			...app.model.metadata,
			title: "Renamed browser project",
			artist: "Renamed browser artist",
			offset: app.model.timing.offset,
			initialBpm: app.model.timing.initialBpm,
		});
		try { await app.showChartProperties(false); }
		finally { app.dialogs.form = originalForm; }
		const values = () => app.difficulties.map(entry => ({
			title: entry.model.metadata.title,
			artist: entry.model.metadata.artist,
		}));
		const changed = values();
		app.undo();
		const undone = values();
		app.redo();
		const redone = values();
		return { original, changed, undone, redone };
	});
	assert.ok(sharedMetadataHistory.changed.every(value => value.title === "Renamed browser project"
		&& value.artist === "Renamed browser artist"));
	assert.ok(sharedMetadataHistory.undone.every(value => value.title === sharedMetadataHistory.original.title
		&& value.artist === sharedMetadataHistory.original.artist));
	assert.deepEqual(sharedMetadataHistory.redone, sharedMetadataHistory.changed);
	await page.screenshot({ path: path.join(outputDirectory, "sviber-multi-difficulty.png"), fullPage: true });

	await page.evaluate(() => {
		const files = new Map();
		const directoryHandle = {
			name: "browser-project",
			async getFileHandle(name, options = {}) {
				if (!options.create && !files.has(name)) throw new DOMException("Missing file", "NotFoundError");
				return {
					name,
					async getFile() {
						const blob = files.get(name);
						return new File([blob], name, { type: blob?.type || "application/octet-stream" });
					},
					async createWritable() {
						const parts = [];
						return {
							async write(value) { parts.push(value); },
							async close() { files.set(name, new Blob(parts)); },
						};
					},
				};
			},
			async removeEntry(name) {
				if (!files.delete(name)) throw new DOMException("Missing file", "NotFoundError");
			},
		};
		globalThis.__browserProjectFiles = files;
		globalThis.__browserProjectDirectory = directoryHandle;
		globalThis.sviber.files.projectDirectoryHandle = directoryHandle;
		globalThis.sviber.files.projectPath = "";
	});
	await page.evaluate(async () => {
		const app = globalThis.sviber;
		await app.files.saveProject(app.projectSnapshot());
		app.markProjectSaved();
	});
	await page.waitForFunction(() => globalThis.__browserProjectFiles?.has("sviber-project.json"));
	const savedProject = await page.evaluate(async () => {
		const files = globalThis.__browserProjectFiles;
		const manifest = JSON.parse(await files.get("sviber-project.json").text());
		const charts = await Promise.all(manifest.charts.map(async entry => ({
			file: entry.file,
			document: JSON.parse(await files.get(entry.file).text()),
		})));
		return { files: [...files.keys()].sort(), manifest, charts };
	});
	assert.equal(savedProject.manifest.charts.length, 2);
	assert.equal(savedProject.manifest.activeChart, secondId);
	assert.deepEqual(savedProject.files,
		["Master.json", "Normal.json", "sviber-project.json"].sort());
	assert.ok(savedProject.charts.every(entry => entry.document.sviber),
		"editable project charts must retain their Sviber state");
	assert.deepEqual(savedProject.charts.map(entry => entry.document.difficultyName).sort(), ["Master", "Normal"]);
	const reopenedProject = await page.evaluate(async () => {
		const app = globalThis.sviber;
		const files = globalThis.__browserProjectFiles;
		const manifest = JSON.parse(await files.get("sviber-project.json").text());
		manifest.music = "music.wav";
		manifest.image = "cover.svg";
		files.set("sviber-project.json", new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: "application/json" }));

		const sampleRate = 8000;
		const sampleCount = sampleRate / 4;
		const wav = new ArrayBuffer(44 + sampleCount * 2);
		const view = new DataView(wav);
		const text = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
		text(0, "RIFF"); view.setUint32(4, 36 + sampleCount * 2, true); text(8, "WAVE"); text(12, "fmt ");
		view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
		view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
		view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data");
		view.setUint32(40, sampleCount * 2, true);
		files.set("music.wav", new Blob([wav], { type: "audio/wav" }));
		files.set("cover.svg", new Blob([
			'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#235b69"/></svg>',
		], { type: "image/svg+xml" }));

		const originalChooseProjectDirectory = app.files.chooseProjectDirectory;
		app.files.clearProjectTarget();
		app.files.chooseProjectDirectory = async () => ({ type: "browser", handle: globalThis.__browserProjectDirectory });
		try { await app.openProject(); }
		finally { app.files.chooseProjectDirectory = originalChooseProjectDirectory; }
		return {
			difficulties: app.difficulties.map(entry => entry.model.metadata.difficultyName),
			active: app.activeDifficultyId,
			music: app.files.musicFile?.name,
			musicReference: app.projectMusic,
			duration: app.audio.buffer?.duration,
			image: app.files.imageFile?.name,
			imageReference: app.projectImage,
			backgroundLoaded: Boolean(app.stage.backgroundImage),
		};
	});
	assert.deepEqual(reopenedProject.difficulties, ["Normal", "Master"]);
	assert.equal(reopenedProject.active, secondId);
	assert.equal(reopenedProject.music, "music.wav");
	assert.equal(reopenedProject.musicReference, "music.wav");
	assert.ok(reopenedProject.duration > 0.24 && reopenedProject.duration < 0.26);
	assert.equal(reopenedProject.image, "cover.svg");
	assert.equal(reopenedProject.imageReference, "cover.svg");
	assert.equal(reopenedProject.backgroundLoaded, true);

	await page.evaluate(() => globalThis.sviber.deleteDifficulty());
	await page.waitForFunction(firstId => globalThis.sviber.difficulties.length === 1
		&& globalThis.sviber.activeDifficultyId === firstId, difficultyFixture.firstId);
	await page.waitForFunction(() => document.querySelectorAll("#difficulty-select option").length === 1);
	assert.equal(await page.locator("#difficulty-select option").count(), 1);
	await page.evaluate(async () => {
		const app = globalThis.sviber;
		await app.files.saveProject(app.projectSnapshot());
		app.markProjectSaved();
	});
	await page.waitForFunction(async () => {
		const files = globalThis.__browserProjectFiles;
		if (!files?.has("sviber-project.json")) return false;
		const manifest = JSON.parse(await files.get("sviber-project.json").text());
		return manifest.charts.length === 1 && !files.has("Master.json");
	});
	const lastChartReplacement = await page.evaluate(async () => {
		const app = globalThis.sviber;
		const deletedId = app.activeDifficultyId;
		const deleted = await app.deleteDifficulty();
		await app.files.saveProject(app.projectSnapshot());
		app.markProjectSaved();
		return {
			deleted,
			deletedId,
			activeId: app.activeDifficultyId,
			count: app.difficulties.length,
			events: app.model.events.length,
			name: app.model.metadata.difficultyName,
			files: [...globalThis.__browserProjectFiles.keys()].sort(),
		};
	});
	assert.equal(lastChartReplacement.deleted, true);
	assert.equal(lastChartReplacement.count, 1);
	assert.notEqual(lastChartReplacement.activeId, lastChartReplacement.deletedId);
	assert.equal(lastChartReplacement.events, 0);
	assert.equal(lastChartReplacement.name, "Master");
	assert.deepEqual(lastChartReplacement.files,
		["Master.json", "cover.svg", "music.wav", "sviber-project.json"]);
	await page.evaluate(() => {
		const app = globalThis.sviber;
		app.dialogs.form = globalThis.__difficultyFixture.originalForm;
		app.dialogs.confirm = globalThis.__difficultyFixture.originalConfirm;
		app.confirmUnsavedChart = globalThis.__difficultyFixture.originalConfirmUnsavedChart;
		document.querySelector(".difficulty-switcher").hidden = true;
		delete globalThis.__difficultyFixture;
		delete globalThis.__browserProjectFiles;
		delete globalThis.__browserProjectDirectory;
	});

}
