import assert from "node:assert/strict";
import test from "node:test";
import { COMMAND_DEFINITIONS, MENU_DEFINITION } from "../js/app/commands.js";
import { assertSourceContracts, readSource } from "./audit-contract-helpers.mjs";

test("file commands expose open import save export project and preference workflows", async () => {
	const [openSave, platform, project, prefs] = await Promise.all([
		readSource("js/app/app-open-save.js"),
		readSource("js/platform/platform.js"),
		readSource("js/core/project.js"),
		readSource("js/app/app-preferences-media.js"),
	]);
	const fileFunctions = [
		"openProject",
		"openFile",
		"saveChart",
		"saveChartAs",
		"saveProject",
		"exportLyrica",
		"hostedLevel",
	];
	for (const item of fileFunctions) {
		assert.match(openSave, new RegExp(item));
	}
	assert.match(platform, /parseFile|parseLevel|JSZip|audio|image/);
	assert.match(project, /createProjectManifest|exportSunniesnowChartDocument/);
	assert.match(prefs, /showPreferences|localStorage|autoSaveInterval|liveReloadPort/);
});

test("edit timing event channel and transform commands are wired", async () => {
	await assertSourceContracts([
		["js/app/commands.js", [/edit\.undo|edit\.redo|edit\.cut|edit\.copy|edit\.paste|edit\.selectAll|edit\.delete|edit\.checks/]],
		["js/app/app-command-bindings.js", [/selectAttachedEvents|showSelectionFilter/]],
		["js/app/app-history-commands.js", [/toggleAbLoop|seekStart|seekSeconds|setSubdivision|setSpeed/]],
		["js/app/app-event-tools.js", [/chooseEventTool|createPositionedEvent|groupSelected|ungroupSelected|lockSelected|fillSelectedCurve/]],
		["js/app/app-channel-commands.js", [/moveSelectedChannel|moveSelectedWithinChannel|activateAllChannels|setChannelHidden|duplicateChannel/]],
		["js/app/app-attachment.js", [/attachSelectedToCurveByOrder|attachSelectedToCurveByTime|flipWithReattachment/]],
		["js/app/app-selection-transform.js", [/applyTransformToSelection|showTransformDialog/]],
	]);
	assert.ok(MENU_DEFINITION.length > 0);
	assert.ok(COMMAND_DEFINITIONS["edit.undo"]);
});

test("automatic timing algorithms and worker fallback are wired", async () => {
	await assertSourceContracts([
		["js/dsp/auto-timing.js", [/worker|taut|string|denoise|PLP|dynamic|spectral|phase|complex/i]],
		["js/dsp/auto-timing-worker.js", [/postMessage|onmessage|ErrorEvent/]],
		["js/dsp/novelty.js", [/energy|spectral|phase|complex/i]],
		["js/dsp/tempogram.js", [/fourier|autocorrelation/i]],
		["js/dsp/beat-tracking.js", [/predominant|dynamic/i]],
		["js/dsp/beat-denoise.js", [/taut|string|TV|variation/i]],
		["js/ui/auto-timing-form.js", [/details|energy|spectral|phase|complex|fourier|autocorrelation|predominant|dynamic/]],
	]);
});

test("music playback reverse loop SE and metronome are wired", async () => {
	await assertSourceContracts([
		["js/app/app-playback-transport.js", [/playFollowOffset|playReverse|seekBackAfterPlaying|_syncAudioLoop/]],
		["js/audio/player.js", [/playReverse|setLoopRange|metronome|bgNote|hit/]],
		["js/audio/scheduler.js", [/lookahead|metronome|reverse|loop/]],
		["js/audio/decoder.js", [/audio-decode|decodeAudioData|CDN|bundle/i]],
	]);
});
