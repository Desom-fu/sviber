// Command registration, split by menu so that no function exceeds the lint budget.
// The handlers still live on the app; this module only wires ids to those methods.

import { composeTraits } from "../core/mixin.js";
import { MOVABLE_TYPES, selected } from "./app-helpers.js";
import { eventUsesChannel } from "../core/grouping.js";

function register(app, id, action, enabled = true) {
	app.registry.register(id, { action, enabled });
}

function registerFileCommands(app) {
	register(app, "file.newProject", () => void app.newProject());
	register(app, "file.newChart", () => void app.newChart());
	register(app, "file.openProject", () => void app.openProject());
	register(app, "file.openChart", () => {
		app.exitModes();
		document.getElementById("chart-file-input").click();
	});
	register(app, "file.openRecent", () => void app.openRecent(), () => app.recentOpens().length > 0);
	register(app, "file.openAutosave", () => void app.openAutosave(), () => app.autosave.index.length > 0);
	register(app, "file.reloadChart", () => void app.reloadChartFromDisk(), () => app.canReloadChartFromDisk());
	register(app, "file.importFile", () => {
		app.exitModes();
		document.getElementById("open-file-input").click();
	});
	register(app, "file.setMusic", () => {
		app.exitModes();
		document.getElementById("music-file-input").click();
	});
	register(app, "file.setBackground", () => {
		app.exitModes();
		document.getElementById("background-file-input").click();
	});
	register(app, "file.save", () => void app.saveChart());
	register(app, "file.saveAs", () => void app.saveChartAs());
	register(app, "file.saveProject", () => void app.saveProject(), () => Boolean(globalThis.nw && app.editingProject));
	register(app, "file.saveLevel", () => void app.saveLevel());
	register(app, "file.importClipboard", () => void app.importClipboard());
	register(app, "file.exportLyrica", () => void app.exportLyrica());
	register(app, "file.exportClipboard", () => void app.exportClipboard());
	register(
		app,
		"file.openProjectFolder",
		() => app.files.openProjectFolder(),
		() => Boolean(globalThis.nw && app.files.projectPath),
	);
	register(app, "file.chartProperties", () => void app.showChartProperties(false));
	register(
		app,
		"file.renameChart",
		() => void app.renameChartDialog(),
		() => Boolean(globalThis.nw && app.editingProject),
	);
	register(
		app,
		"file.deleteChart",
		() => void app.deleteDifficulty(),
		() => Boolean(app.editingProject && app.difficulties.length > 1),
	);
	register(app, "file.close", () => void app.closeDocument());
	register(app, "file.preferences", () => void app.showPreferences());
}

function registerEditCommands(app) {
	register(app, "edit.undo", () => app.undo(), () => app.history.canUndo);
	register(app, "edit.redo", () => app.redo(), () => app.history.canRedo);
	register(app, "edit.cut", () => void app.cutEvents(), () => selected(app.model).length > 0);
	register(app, "edit.copy", () => void app.copyEvents(), () => selected(app.model).length > 0);
	register(app, "edit.saveClip", () => void app.saveEventsToClip(), () => selected(app.model).length > 0);
	register(app, "edit.paste", () => void app.pasteEvents(false));
	register(app, "edit.pasteOptions", () => void app.showPasteOptions());
	register(
		app,
		"edit.selectAll",
		() => app.selectEvents(app.model.allEvents().map(event => event.id), "replace"),
		() => app.model.allEvents().length > 0,
	);
	register(app, "edit.selectChannel", () =>
		app.selectEvents(
			app.model
				.allEvents()
				.filter(event => eventUsesChannel(event, [app.model.editor.currentChannel]))
				.map(event => event.id),
			"replace",
		),
	);
	register(app, "edit.selectNone", () => app.selectEvents([], "replace"), () => selected(app.model).length > 0);
	register(
		app,
		"edit.selectAttached",
		() => selectAttachedEvents(app),
		() => app.model.snappees.some(snappee => snappee.selected),
	);
	register(app, "edit.selectFilter", () => void app.showSelectionFilter(), () => app.model.allEvents().length > 0);
	register(app, "edit.delete", () => app.deleteSelected(), () => selected(app.model).some(event => !event.locked));
	register(app, "edit.checks", () => void app.showChecksDialog());
}

function selectAttachedEvents(app) {
	const snappee = app.model.snappees.find(candidate => candidate.selected);
	if (!snappee) {
		return;
	}
	const activeChannels = new Set(
		app.model.channels.filter(channel => channel.active !== false).map(channel => channel.id),
	);
	app.selectEvents(
		app.model
			.allEvents()
			.filter(
				event => event.attached && event.snappee === snappee.id && eventUsesChannel(event, activeChannels),
			)
			.map(event => event.id),
		"replace",
	);
}

function registerEventCommands(app) {
	for (const type of ["tap", "hold", "drag", "flick", "bgNote"]) {
		register(app, `events.${type}`, () => app.chooseEventTool(type), () => app.currentChannelActive());
	}
	register(app, "events.bgPattern", () => void app.showBackgroundPatternDialog(), () => app.currentChannelActive());
	register(app, "events.bpmChange", () => void app.showBpmDialog());
	register(app, "events.comment", () => void app.showCommentDialog());
	register(app, "events.group", () => app.groupSelected(), () =>
		selected(app.model).some(event => !event.locked),
	);
	register(
		app,
		"events.ungroup",
		() => app.ungroupSelected(),
		() => selected(app.model).some(event => event.type === "group" && !event.locked),
	);
	register(
		app,
		"events.lock",
		() => app.lockSelected(),
		() => selected(app.model).some(event => !event.locked),
	);
	register(
		app,
		"events.unlock",
		() => app.unlockSelected(),
		() => selected(app.model).some(event => event.locked),
	);
	register(app, "events.moveChannelAbove", () => app.moveSelectedChannel(-1), () => app.canMoveSelectedChannel(-1));
	register(app, "events.moveChannelBelow", () => app.moveSelectedChannel(1), () => app.canMoveSelectedChannel(1));
	register(
		app,
		"events.fillCurveDrag",
		() => app.fillSelectedCurve(),
		() => app.model.snappees.some(snappee => snappee.selected && !snappee.type.endsWith("Mesh")),
	);
}

function registerTimingCommands(app) {
	register(app, "timing.offsetAndBpm", () => void app.showTimingDialog());
	register(app, "timing.adjustOffset", () => app.toggleOffsetAdjustment());
	register(app, "timing.automatic", () => void app.showAutoTimingDialog(), () => Boolean(app.audio.buffer));
	register(app, "timing.barLine", () => app.toggleBarLine());
	register(app, "timing.copy", () => void app.copyTiming());
	register(app, "timing.paste", () => void app.pasteTiming());
}

function registerChannelCommands(app) {
	register(app, "channel.createAbove", () => app.createChannel(0));
	register(app, "channel.createBelow", () => app.createChannel(1));
	register(
		app,
		"channel.deactivate",
		() => app.toggleChannel(app.model.editor.currentChannel),
		() => app.currentChannelActive(),
	);
	register(
		app,
		"channel.activateAll",
		() => app.activateAllChannels(),
		() => app.model.channels.some(channel => channel.active === false),
	);
	register(
		app,
		"channel.hide",
		() => app.hideCurrentChannel(),
		() => app.currentChannelHidden() === false,
	);
	register(
		app,
		"channel.showAll",
		() => app.showAllChannels(),
		() => app.model.channels.some(channel => channel.hidden === true),
	);
	register(
		app,
		"channel.moveAboveWithinChannel",
		() => app.moveSelectedWithinChannel(-1),
		() => app.canMoveSelectedWithinChannel(-1),
	);
	register(
		app,
		"channel.moveBelowWithinChannel",
		() => app.moveSelectedWithinChannel(1),
		() => app.canMoveSelectedWithinChannel(1),
	);
	register(app, "channel.delete", () => void app.deleteCurrentChannel(), () => app.model.channels.length > 1);
	register(app, "channel.moveUp", () => app.moveCurrentChannel(-1), () => app.currentChannelIndex() > 0);
	register(
		app,
		"channel.moveDown",
		() => app.moveCurrentChannel(1),
		() => app.currentChannelIndex() < app.model.channels.length - 1,
	);
	register(app, "channel.selectAbove", () => app.changeCurrentChannel(-1), () => app.canChangeCurrentChannel(-1));
	register(app, "channel.selectBelow", () => app.changeCurrentChannel(1), () => app.canChangeCurrentChannel(1));
	for (let index = 1; index <= 9; index += 1) {
		register(
			app,
			`channel.select${index}`,
			() => app.selectChannelByOrdinal(index),
			() => app.canSelectChannelByOrdinal(index),
		);
	}
	register(app, "channel.selectLast", () => app.selectChannelByOrdinal(-1), () => app.canSelectChannelByOrdinal(-1));
}

function registerSnappeeCommands(app) {
	register(app, "snappee.rectangularMesh", () => void app.showSnappeeDialog("rectangularMesh"));
	register(app, "snappee.radialMesh", () => void app.showSnappeeDialog("radialMesh"));
	register(app, "snappee.parametricMesh", () => void app.showSnappeeDialog("parametricMesh"));
	register(app, "snappee.regularPolygon", () => void app.showSnappeeDialog("regularPolygonCurve"));
	register(app, "snappee.bezierCurve", () => app.startCurveDraft("bezierCurve"));
	register(app, "snappee.circularArc", () => app.startCurveDraft("circularArcCurve"));
	register(app, "snappee.pen", () => app.startCurveDraft("penCurve"));
	register(app, "snappee.parametricCurve", () => void app.showSnappeeDialog("parametricCurve"));
	register(app, "snappee.preset", () => void app.showPresetSnappeeDialog());
	register(app, "snappee.activate", () => app.setSnappeesActive(true), () => app.canSetSnappeesActive());
	register(app, "snappee.deactivate", () => app.setSnappeesActive(false), () => app.canSetSnappeesActive());
	register(
		app,
		"snappee.deactivateAll",
		() => app.deactivateAllSnappees(),
		() => app.model.snappees.some(snappee => snappee.active !== false),
	);
	register(
		app,
		"snappee.attach",
		() => app.attachSelected(),
		() => {
			const movable = selected(app.model).some(event => MOVABLE_TYPES.has(event.type));
			return movable && app.model.snappees.some(snappee => snappee.active);
		},
	);
	register(
		app,
		"snappee.detach",
		() => app.detachSelected(),
		() => selected(app.model).some(event => event.attached),
	);
	register(app, "snappee.attachCurveOrder", () => app.attachSelectedToCurveByOrder(), () => app.canAttachToCurve());
	register(app, "snappee.attachCurveTime", () => app.attachSelectedToCurveByTime(), () => app.canAttachToCurve());
	register(
		app,
		"snappee.copy",
		() => void app.copySnappee(),
		() => app.model.snappees.some(snappee => snappee.selected),
	);
	register(app, "snappee.paste", () => void app.pasteSnappee());
}

function registerTransformCommands(app) {
	for (const [id, dx, dy] of [
		["transform.moveLeft", -1, 0],
		["transform.moveDown", 0, -1],
		["transform.moveUp", 0, 1],
		["transform.moveRight", 1, 0],
		["transform.moveLeftLarge", -12.5, 0],
		["transform.moveDownLarge", 0, -12.5],
		["transform.moveUpLarge", 0, 12.5],
		["transform.moveRightLarge", 12.5, 0],
	]) {
		register(app, id, () => app.translateSelected(dx, dy), () => app.transformationAvailable());
	}
	register(
		app,
		"transform.flipHorizontal",
		() => app.applyTransformToSelection([-1, 0, 0, 1, 0, 0]),
		() => app.transformationAvailable(),
	);
	register(
		app,
		"transform.flipHorizontalReattach",
		() => app.flipWithReattachment([-1, 0, 0, 1, 0, 0]),
		() => app.transformationAvailable(),
	);
	register(
		app,
		"transform.flipVertical",
		() => app.applyTransformToSelection([1, 0, 0, -1, 0, 0]),
		() => app.transformationAvailable(),
	);
	register(
		app,
		"transform.flipVerticalReattach",
		() => app.flipWithReattachment([1, 0, 0, -1, 0, 0]),
		() => app.transformationAvailable(),
	);
	register(app, "transform.free", () => app.startFreeTransform(), () => app.transformationAvailable());
	register(app, "transform.matrix", () => void app.showTransformDialog(), () => app.transformationAvailable());
	register(app, "transform.moveForward", () => app.moveSelectedInTime(1), () =>
		selected(app.model).some(event => !event.locked),
	);
	register(app, "transform.moveBackward", () => app.moveSelectedInTime(-1), () =>
		selected(app.model).some(event => !event.locked),
	);
	register(
		app,
		"transform.timeDilation",
		() => void app.showTimeDilationDialog(),
		() => selected(app.model).some(event => !event.locked),
	);
	register(
		app,
		"transform.timeTranslation",
		() => void app.showTimeTranslationDialog(),
		() => selected(app.model).some(event => !event.locked),
	);
	register(app, "transform.reverseTime", () => app.reverseSelectedTime(), () =>
		selected(app.model).some(event => !event.locked),
	);
}

function registerMusicCommands(app) {
	register(app, "music.playPause", (_context, event) => {
		if (event?.type === "keydown" && !app.audio.playing) {
			app.spacePlaybackStartedAt = performance.now();
			app.spacePlaybackCommand = "music.playPause";
		}
		return void app.togglePlayback();
	});
	register(app, "music.playReverse", (_context, event) => {
		if (event?.type === "keydown" && (!app.audio.playing || app.audio.direction > 0)) {
			app.spacePlaybackStartedAt = performance.now();
			app.spacePlaybackCommand = "music.playReverse";
		}
		return void app.toggleReversePlayback();
	});
	register(app, "music.seekStart", () => app.seekStart());
	register(app, "music.seekForward", () => app.navigateWheel(1, false));
	register(app, "music.seekBackward", () => app.navigateWheel(-1, false));
	register(app, "music.seekForward3", () => app.seekSeconds(3));
	register(app, "music.seekBackward3", () => app.seekSeconds(-3));
	register(app, "music.abLoop", () => app.toggleAbLoop(), () => !app.audio.playing);
	for (const value of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
		register(app, `music.subdivision${value}`, () => app.setSubdivision(value));
	}
	register(app, "music.subdivisionOther", () => void app.showSubdivisionDialog());
	register(app, "music.speedDecrease", () => app.setSpeed(app.model.editor.speed - 0.1));
	register(app, "music.speedIncrease", () => app.setSpeed(app.model.editor.speed + 0.1));
	register(app, "music.speed01", () => app.setSpeed(0.1));
	register(app, "music.speed025", () => app.setSpeed(0.25));
	register(app, "music.speed05", () => app.setSpeed(0.5));
	register(app, "music.speed1", () => app.setSpeed(1));
	for (const value of [3, 5, 6, 7, 8, 9]) {
		register(app, `music.speedInverse${value}`, () => app.setSpeed(1 / value));
	}
	register(app, "music.speedOther", () => void app.showSpeedDialog());
	register(app, "music.zoomIn", () => app.navigateWheel(-1, true, true));
	register(app, "music.zoomOut", () => app.navigateWheel(1, true, true));
	register(app, "timeline.pageForward", () => app.pageVisibleRange(-1));
	register(app, "timeline.pageBackward", () => app.pageVisibleRange(1));
}

function registerHelpCommands(app) {
	register(app, "macros.open", () => app.openMacros());
	register(app, "macros.run", () => void app.runMacroDialog(), () => !app.model.editor.readOnly);
	register(app, "help.documentation", () => app.help.openDocumentation());
	register(app, "help.keyboardShortcuts", () => void app.help.showKeyboardShortcuts(app.registry.definitions));
	register(app, "help.reportIssues", () => void app.help.reportIssues());
	register(app, "help.about", () => void app.help.showAbout());
}

export function registerAllCommands(app) {
	registerFileCommands(app);
	registerEditCommands(app);
	registerEventCommands(app);
	registerTimingCommands(app);
	registerChannelCommands(app);
	registerSnappeeCommands(app);
	registerTransformCommands(app);
	registerMusicCommands(app);
	registerHelpCommands(app);
}

class CommandBindingsTrait {
	_registerCommands() {
		registerAllCommands(this);
	}
}

export const withCommandBindings = composeTraits("CommandBindingsLayer", CommandBindingsTrait);
