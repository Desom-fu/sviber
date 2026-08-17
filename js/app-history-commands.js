import { i18n } from "./i18n.js";
import { CommandRegistry } from "./commands.js";
import { DialogManager, MenuBar, ToastManager, Toolbar, TooltipManager } from "./ui.js";
import { ChartModel, DIFFICULTY_COLORS, EVENT_TYPES, connectSelectedTipPointChain, createEvent } from "./core/chart-model.js";
import { uniqueChartFilename } from "./core/project.js";
import { History } from "./core/history.js";
import { Rational } from "./core/rational.js";
import { TimingMap } from "./core/timing.js";
import { CHART_BOUNDS, applyTransform, clampPointToChartBounds, findNearestSnapPoint, invertTransform, isPointWithinChartBounds, multiplyTransforms, penCommandsFromNodes, resolveAttachedPosition, sampleSnappee, transformAngle } from "./core/geometry.js";
import { AudioPlayer } from "../audio/player.js";
import { collectHitSchedule, collectHoldReleaseSchedule } from "../audio/scheduler.js";
import { TimelineView } from "../render/timeline.js";
import { StageView } from "../render/stage.js";
import { AutosaveManager, FileManager } from "./platform.js";
import { HistoryPanel, InspectorPanel, SnappeesPanel } from "./panels.js";
import { MOVABLE_TYPES, DURATION_TYPES, PATTERN_TYPES, SNAPPEE_COLORS, loadPreferences, storePreferences, deepClone, formatTime, formatBeat, evaluateExpression, selected, allowsOutOfBounds, pointAllowed, attachedMoveAllowed, attachedNotesStayWithinBounds, mutateSnappeeWithinBounds, constrainPastedEvent, difficultyColor, eventTypeLabel, localizedErrorMessage, localizedImportWarning, metadataFields, applyPresetDifficultyColor } from "./app-helpers.js";

export const withHistoryCommands = Base => class extends Base {
	rememberCreationDefaults(events) {
		for (const event of events || []) {
			if (event.type === "hold" && event.duration) this.lastHoldDuration = deepClone(event.duration);
			else if (event.type === "bgNote" && event.duration) this.lastBgNoteDuration = deepClone(event.duration);
			else if (event.type === "flick" && Number.isFinite(Number(event.angle))) this.lastFlickAngle = Number(event.angle);
		}
	}

	goToHistory(index) {
		if (this.audio.playing) return;
		if (this.freeTransform) this.cancelFreeTransform();
		this.cancelPreview();
		this.creationMode = null;
		this.curveDraft = null;
		this.restoreHistorySnapshot(this.history.goTo(index));
		this.curveDraft = deepClone(this.history.currentEntry.metadata?.curveDraft || null);
		this.updateDirty();
		this.queueMediaSync();
		this.refresh();
	}

	_registerCommands() {
		const command = (id, action, enabled = true) => this.registry.register(id, { action, enabled });
		command("file.newProject", () => void this.newProject());
		command("file.newChart", () => void this.newChart());
		command("file.openProject", () => void this.openProject());
		command("file.openChart", () => { this.exitModes(); document.getElementById("chart-file-input").click(); });
		command("file.importFile", () => { this.exitModes(); document.getElementById("open-file-input").click(); });
		command("file.setMusic", () => { this.exitModes(); document.getElementById("music-file-input").click(); });
		command("file.setBackground", () => { this.exitModes(); document.getElementById("background-file-input").click(); });
		command("file.save", () => void this.saveChart());
		command("file.saveAs", () => void this.saveChartAs());
		command("file.saveLevel", () => void this.saveLevel());
		command("file.importClipboard", () => void this.importClipboard());
		command("file.exportClipboard", () => void this.exportClipboard());
		command("file.chartProperties", () => void this.showChartProperties(false));
		command("file.preferences", () => void this.showPreferences());

		command("edit.undo", () => this.undo(), () => this.history.canUndo);
		command("edit.redo", () => this.redo(), () => this.history.canRedo);
		command("edit.cut", () => void this.cutEvents(), () => selected(this.model).length > 0);
		command("edit.copy", () => void this.copyEvents(), () => selected(this.model).length > 0);
		command("edit.paste", () => void this.pasteEvents(false));
		command("edit.pasteDuplicateSnappees", () => void this.pasteEvents(true));
		command("edit.selectAll", () => this.selectEvents(this.model.events.map(event => event.id), "replace"), () => this.model.events.length > 0);
		command("edit.selectChannel", () => this.selectEvents(this.model.events.filter(event => event.channel === this.model.editor.currentChannel).map(event => event.id), "replace"));
		command("edit.selectNone", () => this.selectEvents([], "replace"), () => selected(this.model).length > 0);
		command("edit.selectFilter", () => void this.showSelectionFilter(), () => this.model.events.length > 0);
		command("edit.delete", () => this.deleteSelected(), () => selected(this.model).length > 0);

		for (const type of ["tap", "hold", "drag", "flick", "bgNote"]) {
			command(`events.${type}`, () => this.chooseEventTool(type));
		}
		command("events.bgPattern", () => void this.showBackgroundPatternDialog());
		command("events.bpmChange", () => void this.showBpmDialog());
		command("events.moveChannelAbove", () => this.moveSelectedChannel(-1), () => this.canMoveSelectedChannel(-1));
		command("events.moveChannelBelow", () => this.moveSelectedChannel(1), () => this.canMoveSelectedChannel(1));
		command("events.reverseTime", () => this.reverseSelectedTime(), () => selected(this.model).length > 0);
		command("events.fillCurveDrag", () => this.fillSelectedCurve(), () => this.model.snappees.some(snappee => snappee.selected && !snappee.type.endsWith("Mesh")));

		command("channel.createAbove", () => this.createChannel(0));
		command("channel.createBelow", () => this.createChannel(1));
		command("channel.delete", () => void this.deleteCurrentChannel(), () => this.model.channels.length > 1);
		command("channel.moveUp", () => this.moveCurrentChannel(-1), () => this.currentChannelIndex() > 0);
		command("channel.moveDown", () => this.moveCurrentChannel(1), () => this.currentChannelIndex() < this.model.channels.length - 1);

		command("snappee.rectangularMesh", () => void this.showSnappeeDialog("rectangularMesh"));
		command("snappee.radialMesh", () => void this.showSnappeeDialog("radialMesh"));
		command("snappee.parametricMesh", () => void this.showSnappeeDialog("parametricMesh"));
		command("snappee.regularPolygon", () => void this.showSnappeeDialog("regularPolygonCurve"));
		command("snappee.bezierCurve", () => this.startCurveDraft("bezierCurve"));
		command("snappee.circularArc", () => this.startCurveDraft("circularArcCurve"));
		command("snappee.pen", () => this.startCurveDraft("penCurve"));
		command("snappee.parametricCurve", () => void this.showSnappeeDialog("parametricCurve"));
		command("snappee.activate", () => this.setAttachedSnappeesActive(true), () => selected(this.model).length > 0);
		command("snappee.deactivate", () => this.setAttachedSnappeesActive(false), () => selected(this.model).length > 0);
		command("snappee.attach", () => this.attachSelected(), () => selected(this.model).some(event => MOVABLE_TYPES.has(event.type)) && this.model.snappees.some(snappee => snappee.active));
		command("snappee.detach", () => this.detachSelected(), () => selected(this.model).some(event => event.attached));

		for (const [id, dx, dy] of [
			["transform.moveLeft", -1, 0], ["transform.moveDown", 0, -1], ["transform.moveUp", 0, 1], ["transform.moveRight", 1, 0],
			["transform.moveLeftLarge", -12.5, 0], ["transform.moveDownLarge", 0, -12.5], ["transform.moveUpLarge", 0, 12.5], ["transform.moveRightLarge", 12.5, 0],
		]) command(id, () => this.translateSelected(dx, dy), () => selected(this.model).length > 0);
		command("transform.flipHorizontal", () => this.applyTransformToSelection([-1, 0, 0, 1, 0, 0]), () => selected(this.model).length > 0);
		command("transform.flipVertical", () => this.applyTransformToSelection([1, 0, 0, -1, 0, 0]), () => selected(this.model).length > 0);
		command("transform.free", () => this.startFreeTransform(), () => selected(this.model).some(event => MOVABLE_TYPES.has(event.type)));
		command("transform.matrix", () => void this.showTransformDialog(), () => selected(this.model).length > 0);
		command("transform.moveForward", () => this.moveSelectedInTime(1), () => selected(this.model).length > 0);
		command("transform.moveBackward", () => this.moveSelectedInTime(-1), () => selected(this.model).length > 0);

		command("music.playPause", () => void this.togglePlayback());
		command("music.seekStart", () => this.seekStart());
		command("music.seekForward", () => this.navigateWheel(1, false));
		command("music.seekBackward", () => this.navigateWheel(-1, false));
		command("music.seekForward10", () => this.seekSeconds(10));
		command("music.seekBackward10", () => this.seekSeconds(-10));
		for (const value of [1, 2, 3, 4, 6, 8]) command(`music.subdivision${value}`, () => this.setSubdivision(value));
		command("music.subdivisionOther", () => void this.showSubdivisionDialog());
		command("music.speedDecrease", () => this.setSpeed(this.model.editor.speed - 0.1));
		command("music.speedIncrease", () => this.setSpeed(this.model.editor.speed + 0.1));
		command("music.speed025", () => this.setSpeed(0.25));
		command("music.speed05", () => this.setSpeed(0.5));
		command("music.speed1", () => this.setSpeed(1));
		command("music.zoomIn", () => this.navigateWheel(-1, true));
		command("music.zoomOut", () => this.navigateWheel(1, true));
	}

	undo() {
		if (this.freeTransform) this.cancelFreeTransform();
		this.cancelPreview();
		this.creationMode = null;
		this.curveDraft = null;
		const snapshot = this.history.undo();
		if (!snapshot) return;
		this.restoreHistorySnapshot(snapshot);
		this.curveDraft = deepClone(this.history.currentEntry.metadata?.curveDraft || null);
		this.updateDirty();
		this.queueMediaSync();
		this.refresh();
	}

	redo() {
		if (this.freeTransform) this.cancelFreeTransform();
		this.cancelPreview();
		this.creationMode = null;
		this.curveDraft = null;
		const snapshot = this.history.redo();
		if (!snapshot) return;
		this.restoreHistorySnapshot(snapshot);
		this.curveDraft = deepClone(this.history.currentEntry.metadata?.curveDraft || null);
		this.updateDirty();
		this.queueMediaSync();
		this.refresh();
	}

	chooseEventTool(type) {
		this.exitModes();
		const chosen = selected(this.model).filter(event => !PATTERN_TYPES.has(event.type));
		if (chosen.length) {
			this.commit(i18n.t("history.editEvent", { type: eventTypeLabel(type) }), model => {
				for (const event of model.events.filter(item => item.selected && !PATTERN_TYPES.has(item.type))) {
					const overrides = { ...event, id: event.id, selected: true };
					if (type === "hold" && event.duration == null) overrides.duration = this.lastHoldDuration;
					if (type === "bgNote" && event.duration == null) overrides.duration = this.lastBgNoteDuration;
					if (type === "flick" && event.angle == null) overrides.angle = this.lastFlickAngle;
					model.events[model.events.indexOf(event)] = createEvent(type, overrides);
				}
			});
			this.rememberCreationDefaults(selected(this.model));
			return;
		}
		this.creationMode = type;
		this.refresh();
	}

	createPositionedEvent(type, preview) {
		const overrides = {
			time: this.currentBeat().toJSON(),
			channel: this.model.editor.currentChannel,
			selected: true,
			angle: this.lastFlickAngle,
			duration: type === "hold" ? this.lastHoldDuration : this.lastBgNoteDuration,
		};
		const position = allowsOutOfBounds(this.model) ? { x: preview.x, y: preview.y } : clampPointToChartBounds(preview);
		if (preview.snappeeId != null && pointAllowed(this.model, preview)) {
			overrides.attached = true;
			overrides.snappee = preview.snappeeId;
			overrides.snapPoint = deepClone(preview.snapPoint);
		} else {
			overrides.x = position.x;
			overrides.y = position.y;
		}
		this.commit(i18n.t("history.createEvent", { type: eventTypeLabel(type) }), model => {
			for (const event of model.events) event.selected = false;
			model.addEvent(type, overrides);
		});
		this.rememberCreationDefaults(selected(this.model));
	}

	deleteSelected() {
		this.commit(i18n.t("history.deleteEvents"), model => {
			model.events = model.events.filter(event => !event.selected);
		});
	}

	canMoveSelectedChannel(direction) {
		const chosen = selected(this.model);
		if (!chosen.length) return false;
		return chosen.every(event => {
			const index = this.model.channels.findIndex(channel => channel.id === event.channel);
			return index + direction >= 0 && index + direction < this.model.channels.length;
		});
	}

	moveSelectedChannel(direction) {
		this.commit(i18n.t("history.moveEvents"), model => {
			for (const event of model.events.filter(item => item.selected)) {
				const index = model.channels.findIndex(channel => channel.id === event.channel);
				event.channel = model.channels[index + direction].id;
			}
		});
	}

	reverseSelectedTime() {
		this.commit(i18n.t("history.moveEvents"), model => {
			const chosen = model.events.filter(event => event.selected);
			if (!chosen.length) return;
			const beats = chosen.map(event => Rational.from(event.time));
			const minimum = beats.reduce((left, right) => left.compare(right) <= 0 ? left : right);
			const maximum = beats.reduce((left, right) => left.compare(right) >= 0 ? left : right);
			for (const event of chosen) event.time = minimum.add(maximum).sub(event.time).toJSON();
		});
	}

	currentChannelIndex() {
		return this.model.channels.findIndex(channel => channel.id === this.model.editor.currentChannel);
	}

	createChannel(relative) {
		this.exitModes();
		this.commit(i18n.t("history.createChannel"), model => {
			const index = model.channels.findIndex(channel => channel.id === model.editor.currentChannel);
			model.addChannel(index + relative);
		});
	}

	async deleteCurrentChannel() {
		if (!await this.dialogs.confirm({ titleKey: "dialog.deleteChannel", messageKey: "dialog.deleteChannelMessage" })) return;
		this.commit(i18n.t("history.deleteChannel"), model => model.removeChannel(model.editor.currentChannel));
	}

	moveCurrentChannel(direction) {
		this.commit(i18n.t("history.moveChannel"), model => {
			const index = model.channels.findIndex(channel => channel.id === model.editor.currentChannel);
			const target = index + direction;
			if (target < 0 || target >= model.channels.length) return;
			[model.channels[index], model.channels[target]] = [model.channels[target], model.channels[index]];
		});
	}

	async togglePlayback() {
		if (this.audio.playing) {
			this.audio.pause();
			return;
		}
		this.exitModes();
		this.audio.seek(this.currentSeconds());
		this.audio.setRate(this.model.editor.speed);
		await this.audio.play();
	}

	seekStart() {
		const start = this.timeBounds()[0];
		const span = this.model.editor.visibleRangeEnd - this.model.editor.visibleRangeBeginning;
		if (this.audio.playing) {
			this.audio.seek(start);
			if (start < this.model.editor.visibleRangeBeginning || start > this.model.editor.visibleRangeEnd) {
				this.setVisibleRange(start, start + span);
			}
			return;
		}
		const beat = this.timing().secondsToSnappedBeat(start, this.model.editor.subdivision);
		this.seekBeat(beat.toJSON());
		const snappedStart = this.currentSeconds();
		if (snappedStart < this.model.editor.visibleRangeBeginning || snappedStart > this.model.editor.visibleRangeEnd) {
			this.setVisibleRange(snappedStart, snappedStart + span, true);
		}
	}

	seekSeconds(delta) {
		const seconds = Math.max(this.timeBounds()[0], Math.min(this.timeBounds()[1], this.currentSeconds() + delta));
		if (this.audio.playing) {
			this.audio.seek(seconds);
			return;
		}
		this.seekBeat(this.timing().secondsToSnappedBeat(seconds, this.model.editor.subdivision).toJSON());
	}

	setSubdivision(value) {
		const subdivision = Math.max(1, Math.floor(value));
		this.model.editor.subdivision = subdivision;
		if (!this.audio.playing) this.model.editor.currentTime = this.currentBeat().snap(subdivision).toJSON();
		this.refresh();
	}

	setSpeed(value) {
		const speed = Math.max(0.1, Math.min(4, Math.round(value * 10) / 10));
		this.model.editor.speed = speed;
		this.audio.setRate(speed);
		this.refresh();
	}

};
