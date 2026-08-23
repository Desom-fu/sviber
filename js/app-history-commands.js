import { i18n } from "./i18n.js";
import { CommandRegistry } from "./commands.js";
import { DialogManager, MenuBar, ToastManager, Toolbar, TooltipManager } from "./ui.js";
import { ChartModel, DIFFICULTY_COLORS, EVENT_TYPES, connectSelectedTipPointChain, createEvent } from "./core/chart-model.js";
import { uniqueChartFilename } from "./core/project.js";
import { History, captureHistoryView } from "./core/history.js";
import { Rational } from "./core/rational.js";
import { TimingMap } from "./core/timing.js";
import { CHART_BOUNDS, applyTransform, clampPointToChartBounds, findNearestSnapPoint, invertTransform, isPointWithinChartBounds, multiplyTransforms, penCommandsFromNodes, resolveAttachedPosition, sampleSnappee, transformAngle } from "./core/geometry.js";
import { AudioPlayer } from "./audio/player.js";
import { collectHitSchedule, collectHoldReleaseSchedule } from "./audio/scheduler.js";
import { TimelineView } from "./render/timeline.js";
import { StageView } from "./render/stage.js";
import { AutosaveManager, FileManager } from "./platform.js";
import { HistoryPanel, InspectorPanel, SnappeesPanel } from "./panels.js";
import { MOVABLE_TYPES, DURATION_TYPES, PATTERN_TYPES, SNAPPEE_COLORS, LAST_OPEN_KEY, RECENT_OPEN_KEY, loadPreferences, storePreferences, deepClone, formatTime, formatBeat, evaluateExpression, selected, allowsOutOfBounds, pointAllowed, attachedMoveAllowed, attachedNotesStayWithinBounds, mutateSnappeeWithinBounds, constrainPastedEvent, difficultyColor, eventTypeLabel, localizedErrorMessage, localizedImportWarning, metadataFields, applyPresetDifficultyColor } from "./app-helpers.js";
import { eventUsesChannel, flattenEvents } from "./core/grouping.js";
import { listRunnableMacros, runChosenMacro } from "./app-macro-bridge.js";

export function toggledCreationMode(current, type) {
	return current === type ? null : type;
}

export const withHistoryCommands = Base => class extends Base {
	rememberCreationDefaults(events) {
		for (const event of events || []) {
			if (event.type === "hold" && event.duration) this.lastHoldDuration = deepClone(event.duration);
			else if (event.type === "bgNote" && event.duration) this.lastBgNoteDuration = deepClone(event.duration);
			else if (event.type === "flick" && Number.isFinite(Number(event.angle))) this.lastFlickAngle = Number(event.angle);
		}
	}

	goToHistory(index) {
		if (this.model.editor.readOnly) return false;
		if (this.freeTransform) this.cancelFreeTransform();
		this.cancelPreview();
		this.creationMode = null;
		this.curveDraft = null;
		this.restoreHistorySnapshot(this.history.goTo(index));
		this.curveDraft = deepClone(this.history.currentMetadata?.curveDraft || null);
		this.updateDirty();
		this.queueMediaSync();
		this.refresh();
		return true;
	}

	_registerCommands() {
		const command = (id, action, enabled = true) => this.registry.register(id, { action, enabled });
		command("file.newProject", () => void this.newProject());
		command("file.newChart", () => void this.newChart());
		command("file.openProject", () => void this.openProject());
		command("file.openChart", () => { this.exitModes(); document.getElementById("chart-file-input").click(); });
		command("file.openRecent", () => void this.openRecent(), () => this.recentOpens().length > 0);
		command("file.openAutosave", () => void this.openAutosave(), () => this.autosave.listed().length > 0);
		command("file.importFile", () => { this.exitModes(); document.getElementById("open-file-input").click(); });
		command("file.setMusic", () => { this.exitModes(); document.getElementById("music-file-input").click(); });
		command("file.setBackground", () => { this.exitModes(); document.getElementById("background-file-input").click(); });
		command("file.save", () => void this.saveChart());
		command("file.saveAs", () => void this.saveChartAs());
		command("file.saveProject", () => void this.saveProject());
		command("file.saveLevel", () => void this.saveLevel());
		command("file.importClipboard", () => void this.importClipboard());
		command("file.exportLyrica", () => void this.exportLyrica());
		command("file.exportClipboard", () => void this.exportClipboard());
		command("file.openProjectFolder", () => this.files.openProjectFolder(),
			() => Boolean(globalThis.nw && this.files.projectPath));
		command("file.chartProperties", () => void this.showChartProperties(false));
		command("file.deleteChart", () => void this.deleteDifficulty(), () => Boolean(
			this.files.projectPath || this.files.projectDirectoryHandle,
		));
		command("file.preferences", () => void this.showPreferences());

		command("edit.undo", () => this.undo(), () => this.history.canUndo);
		command("edit.redo", () => this.redo(), () => this.history.canRedo);
		command("edit.cut", () => void this.cutEvents(), () => selected(this.model).length > 0);
		command("edit.copy", () => void this.copyEvents(), () => selected(this.model).length > 0);
		command("edit.saveClip", () => void this.saveEventsToClip(), () => selected(this.model).length > 0);
		command("edit.paste", () => void this.pasteEvents(false));
		command("edit.pasteOptions", () => void this.showPasteOptions());
		command("edit.selectAll", () => this.selectEvents(this.model.allEvents().map(event => event.id), "replace"), () => this.model.allEvents().length > 0);
		command("edit.selectChannel", () => this.selectEvents(this.model.allEvents().filter(event =>
			eventUsesChannel(event, [this.model.editor.currentChannel])).map(event => event.id), "replace"));
		command("edit.selectNone", () => this.selectEvents([], "replace"), () => selected(this.model).length > 0);
		command("edit.selectAttached", () => {
			const snappee = this.model.snappees.find(candidate => candidate.selected);
			if (!snappee) return;
			const activeChannels = new Set(this.model.channels
				.filter(channel => channel.active !== false).map(channel => channel.id));
			this.selectEvents(this.model.allEvents().filter(event => event.attached && event.snappee === snappee.id
				&& eventUsesChannel(event, activeChannels)).map(event => event.id), "replace");
		}, () => this.model.snappees.some(snappee => snappee.selected));
		command("edit.selectFilter", () => void this.showSelectionFilter(), () => this.model.allEvents().length > 0);
		command("edit.delete", () => this.deleteSelected(), () => selected(this.model).length > 0);

		for (const type of ["tap", "hold", "drag", "flick", "bgNote"]) {
			command(`events.${type}`, () => this.chooseEventTool(type), () => this.currentChannelActive());
		}
		command("events.bgPattern", () => void this.showBackgroundPatternDialog(), () => this.currentChannelActive());
		command("events.bpmChange", () => void this.showBpmDialog());
		command("events.comment", () => void this.showCommentDialog());
		command("events.group", () => this.groupSelected(), () => selected(this.model).length > 0);
		command("events.ungroup", () => this.ungroupSelected(), () => selected(this.model).some(event => event.type === "group"));
		command("events.moveChannelAbove", () => this.moveSelectedChannel(-1), () => this.canMoveSelectedChannel(-1));
		command("events.moveChannelBelow", () => this.moveSelectedChannel(1), () => this.canMoveSelectedChannel(1));
		command("events.reverseTime", () => this.reverseSelectedTime(), () => selected(this.model).length > 0);
		command("events.fillCurveDrag", () => this.fillSelectedCurve(), () => this.model.snappees.some(snappee => snappee.selected && !snappee.type.endsWith("Mesh")));
		command("timing.offsetAndBpm", () => void this.showTimingDialog());
		command("timing.barLine", () => this.toggleBarLine());
		command("timing.copy", () => void this.copyTiming());
		command("timing.paste", () => void this.pasteTiming());

		command("channel.createAbove", () => this.createChannel(0));
		command("channel.createBelow", () => this.createChannel(1));
		command("channel.delete", () => void this.deleteCurrentChannel(), () => this.model.channels.length > 1);
		command("channel.moveUp", () => this.moveCurrentChannel(-1), () => this.currentChannelIndex() > 0);
		command("channel.moveDown", () => this.moveCurrentChannel(1), () => this.currentChannelIndex() < this.model.channels.length - 1);
		command("channel.selectAbove", () => this.changeCurrentChannel(-1), () => this.canChangeCurrentChannel(-1));
		command("channel.selectBelow", () => this.changeCurrentChannel(1), () => this.canChangeCurrentChannel(1));
		for (let index = 1; index <= 9; index += 1) {
			command(`channel.select${index}`, () => this.selectChannelByOrdinal(index),
				() => this.canSelectChannelByOrdinal(index));
		}
		command("channel.selectLast", () => this.selectChannelByOrdinal(-1),
			() => this.canSelectChannelByOrdinal(-1));

		command("snappee.rectangularMesh", () => void this.showSnappeeDialog("rectangularMesh"));
		command("snappee.radialMesh", () => void this.showSnappeeDialog("radialMesh"));
		command("snappee.parametricMesh", () => void this.showSnappeeDialog("parametricMesh"));
		command("snappee.regularPolygon", () => void this.showSnappeeDialog("regularPolygonCurve"));
		command("snappee.bezierCurve", () => this.startCurveDraft("bezierCurve"));
		command("snappee.circularArc", () => this.startCurveDraft("circularArcCurve"));
		command("snappee.pen", () => this.startCurveDraft("penCurve"));
		command("snappee.parametricCurve", () => void this.showSnappeeDialog("parametricCurve"));
		command("snappee.preset", () => void this.showPresetSnappeeDialog());
		command("snappee.activate", () => this.setAttachedSnappeesActive(true), () => selected(this.model).length > 0);
		command("snappee.deactivate", () => this.setAttachedSnappeesActive(false), () => selected(this.model).length > 0);
		command("snappee.attach", () => this.attachSelected(), () => selected(this.model).some(event => MOVABLE_TYPES.has(event.type)) && this.model.snappees.some(snappee => snappee.active));
		command("snappee.detach", () => this.detachSelected(), () => selected(this.model).some(event => event.attached));

		for (const [id, dx, dy] of [
			["transform.moveLeft", -1, 0], ["transform.moveDown", 0, -1], ["transform.moveUp", 0, 1], ["transform.moveRight", 1, 0],
			["transform.moveLeftLarge", -12.5, 0], ["transform.moveDownLarge", 0, -12.5], ["transform.moveUpLarge", 0, 12.5], ["transform.moveRightLarge", 12.5, 0],
		]) command(id, () => this.translateSelected(dx, dy), () => this.transformationAvailable());
		command("transform.flipHorizontal", () => this.applyTransformToSelection([-1, 0, 0, 1, 0, 0]), () => this.transformationAvailable());
		command("transform.flipVertical", () => this.applyTransformToSelection([1, 0, 0, -1, 0, 0]), () => this.transformationAvailable());
		command("transform.free", () => this.startFreeTransform(), () => this.transformationAvailable());
		command("transform.matrix", () => void this.showTransformDialog(), () => this.transformationAvailable());
		command("transform.moveForward", () => this.moveSelectedInTime(1), () => selected(this.model).length > 0);
		command("transform.moveBackward", () => this.moveSelectedInTime(-1), () => selected(this.model).length > 0);
		command("transform.timeDilation", () => void this.showTimeDilationDialog(), () => selected(this.model).length > 0);

		command("music.playPause", (_context, event) => {
			if (event?.type === "keydown" && !this.audio.playing) {
				this.spacePlaybackStartedAt = performance.now();
				this.spacePlaybackCommand = "music.playPause";
			}
			return void this.togglePlayback();
		});
		command("music.playReverse", (_context, event) => {
			if (event?.type === "keydown" && (!this.audio.playing || this.audio.direction > 0)) {
				this.spacePlaybackStartedAt = performance.now();
				this.spacePlaybackCommand = "music.playReverse";
			}
			return void this.toggleReversePlayback();
		});
		command("music.seekStart", () => this.seekStart());
		command("music.seekForward", () => this.navigateWheel(1, false));
		command("music.seekBackward", () => this.navigateWheel(-1, false));
		command("music.seekForward3", () => this.seekSeconds(3));
		command("music.seekBackward3", () => this.seekSeconds(-3));
		command("music.abLoop", () => this.toggleAbLoop(), () => !this.audio.playing);
		for (const value of [1, 2, 3, 4, 6, 8]) command(`music.subdivision${value}`, () => this.setSubdivision(value));
		command("music.subdivisionOther", () => void this.showSubdivisionDialog());
		command("music.speedDecrease", () => this.setSpeed(this.model.editor.speed - 0.1));
		command("music.speedIncrease", () => this.setSpeed(this.model.editor.speed + 0.1));
		command("music.speed025", () => this.setSpeed(0.25));
		command("music.speed05", () => this.setSpeed(0.5));
		command("music.speed1", () => this.setSpeed(1));
		command("music.zoomIn", () => this.navigateWheel(-1, true, true));
		command("music.zoomOut", () => this.navigateWheel(1, true, true));
		command("timeline.pageForward", () => this.pageVisibleRange(-1));
		command("timeline.pageBackward", () => this.pageVisibleRange(1));
		command("macros.open", () => this.openMacros());
		command("macros.run", () => void this.runMacroDialog(), () => !this.model.editor.readOnly);
		command("help.documentation", () => this.help.openDocumentation());
		command("help.keyboardShortcuts", () => void this.help.showKeyboardShortcuts(this.registry.definitions));
		command("help.reportIssues", () => void this.help.reportIssues());
		command("help.about", () => void this.help.showAbout());
	}

	undo() {
		if (this.freeTransform) this.cancelFreeTransform();
		this.cancelPreview();
		const previousMode = this.creationMode;
		const creationAction = this.history.currentMetadata?.creationMode;
		this.creationMode = creationAction ? previousMode || creationAction : null;
		this.curveDraft = null;
		const snapshot = this.history.undo();
		if (!snapshot) return;
		this.restoreHistorySnapshot(snapshot);
		this.curveDraft = deepClone(this.history.currentMetadata?.curveDraft || null);
		this.updateDirty();
		this.queueMediaSync();
		this.refresh();
	}

	redo() {
		if (this.freeTransform) this.cancelFreeTransform();
		this.cancelPreview();
		const previousMode = this.creationMode;
		const creationAction = this.history.entries[this.history.cursor + 1]?.metadata?.creationMode;
		this.creationMode = creationAction ? previousMode || creationAction : null;
		this.curveDraft = null;
		const snapshot = this.history.redo();
		if (!snapshot) return;
		this.restoreHistorySnapshot(snapshot);
		this.curveDraft = deepClone(this.history.currentMetadata?.curveDraft || null);
		this.updateDirty();
		this.queueMediaSync();
		this.refresh();
	}

	chooseEventTool(type) {
		const nextMode = toggledCreationMode(this.creationMode, type);
		if (nextMode === null) {
			this.exitCreationModes();
			return;
		}
		const alreadyCreating = Boolean(this.creationMode);
		this.curveDraft = null;
		this.cancelFreeTransform();
		this.cancelPreview();
		const chosen = selected(this.model).filter(event => event.type !== "group" && !PATTERN_TYPES.has(event.type));
		if (!alreadyCreating && chosen.length) {
			const changes = chosen.map(event => {
				const overrides = { ...event, id: event.id, selected: true };
				if (type === "hold" && event.duration == null) overrides.duration = this.lastHoldDuration;
				if (type === "bgNote" && event.duration == null) overrides.duration = this.lastBgNoteDuration;
				if (type === "flick" && event.angle == null) overrides.angle = this.lastFlickAngle;
				return { oldEvent: event, newEvent: createEvent(type, overrides) };
			});
			const currentIndex = this.renderIndex?.eventSource === this.model.events ? this.renderIndex : null;
			const commitOptions = {
				historyPatch: () => ({ kind: "replaceEvents", changes: changes.map(change => ({ id: change.newEvent.id, event: change.newEvent })), view: captureHistoryView(this.model) }),
				lightweight: true, rebuildIndex: false, scheduleDirty: true, skipCommands: true,
			};
			this.commit(i18n.t("history.editEvent", { type: eventTypeLabel(type) }), model => {
				for (const change of changes) {
					model.replaceEvent(change.oldEvent.id, change.newEvent);
				}
				if (!currentIndex?.replaceEvents?.(changes)) commitOptions.rebuildIndex = true;
				return changes;
			}, commitOptions);
			this.rememberCreationDefaults(selected(this.model));
			return;
		}
		this.creationMode = nextMode;
		this._refreshLightweight?.({ rebuildIndex: false, skipInspector: true, skipHistory: true });
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
		const created = this.commit(i18n.t("history.createEvent", { type: eventTypeLabel(type) }), model => {
			const currentIndex = this.renderIndex?.eventSource === model.events ? this.renderIndex : null;
			for (const event of currentIndex?.selectedEvents || model.allEvents().filter(event => event.selected)) {
				event.selected = false;
			}
			const event = model.addEvent(type, overrides);
			currentIndex?.appendRootEvent?.(event);
			currentIndex?.replaceSelection?.([event]);
			return event;
		}, {
			metadata: { creationMode: type },
			historyPatch: (event, model) => ({
				kind: "appendRootEvent", event, nextEventId: event.id + 1,
				view: captureHistoryView(model, { selectedEventIds: [event.id] }),
			}),
			lightweight: true, selectionOnly: true, selectionSynced: true,
			rebuildIndex: false, skipCommands: true,
		});
		if (created) this.rememberCreationDefaults([created]);
	}

	deleteSelected() {
		this.commit(i18n.t("history.deleteEvents"), model => {
			const currentIndex = this.renderIndex?.eventSource === model.events ? this.renderIndex : null;
			const removed = [];
			const removeSelected = items => {
				const kept = [];
				for (const event of items || []) {
					if (event.type === "group" && event.selected) {
						removed.push(...flattenEvents([event], true));
						continue;
					}
					if (event.type === "group") {
						const children = removeSelected(event.events);
						event.events.splice(0, event.events.length, ...children);
						if (!event.events.length) { removed.push(event); continue; }
					}
					if (event.selected) removed.push(event);
					else kept.push(event);
				}
				return kept;
			};
			const kept = removeSelected(model.events);
			model.events.splice(0, model.events.length, ...kept);
			currentIndex?.removeEvents?.(removed);
			return removed;
		}, {
			allowReadOnly: this.model.editor.readOnly && selected(this.model).every(event => event.type === "comment"),
			historyPatch: (removed, model) => ({
				kind: "removeEvents", eventIds: (removed || []).map(event => event.id),
				view: captureHistoryView(model),
			}),
			lightweight: true, selectionOnly: true, selectionSynced: true,
			rebuildIndex: false, scheduleDirty: true,
		});
	}

	groupSelected() {
		const used = this.model.allEvents().filter(event => event.type === "group").map(event => event.color);
		const color = SNAPPEE_COLORS.find(candidate => !used.includes(candidate)) || SNAPPEE_COLORS[used.length % SNAPPEE_COLORS.length];
		this.commit(i18n.t("history.groupEvents"), model => model.groupSelected(color));
	}

	ungroupSelected() {
		this.commit(i18n.t("history.ungroupEvents"), model => model.ungroupSelected());
	}

	canMoveSelectedChannel(direction) {
		const moved = this._selectedChannelLeaves();
		if (!moved.length) return false;
		const channelIndices = new Map(this.model.channels.map((channel, index) => [channel.id, index]));
		return moved.every(event => {
			const index = channelIndices.get(event.channel);
			const target = this.model.channels[index + direction];
			return Boolean(target && target.active !== false);
		});
	}

	_selectedChannelLeaves() {
		if (this.renderIndex?.eventSource === this.model.events) {
			return this.renderIndex.selectedEvents.filter(event => event.type !== "group");
		}
		const chosen = selected(this.model);
		return [...new Set(chosen.flatMap(event => event.type === "group"
			? this.model.groupDescendants(event.id).filter(item => item.type !== "group") : [event]))];
	}

	moveSelectedChannel(direction) {
		const moved = this._selectedChannelLeaves();
		const channelIndices = new Map(this.model.channels.map((channel, index) => [channel.id, index]));
		const changes = moved.map(event => ({
			event, from: event.channel, to: this.model.channels[channelIndices.get(event.channel) + direction]?.id,
		})).filter(change => change.to != null
			&& this.model.channels[channelIndices.get(change.from) + direction]?.active !== false);
		if (!changes.length || changes.length !== moved.length) return false;
		const currentIndex = this.renderIndex?.eventSource === this.model.events ? this.renderIndex : null;
		const commitOptions = {
			historyPatch: updates => ({ kind: "setEventChannels", changes: updates }),
			lightweight: true, selectionOnly: true, selectionSynced: true,
			rebuildIndex: false, scheduleDirty: false, skipCommands: true,
		};
		const result = this.commit(i18n.t("history.moveEvents"), () => {
			for (const change of changes) change.event.channel = change.to;
			if (!currentIndex?.moveEventsToChannels?.(changes)) commitOptions.rebuildIndex = true;
			return changes.map(change => ({ id: change.event.id, channel: change.to }));
		}, commitOptions);
		this.registry.notify("events.moveChannelAbove");
		this.registry.notify("events.moveChannelBelow");
		return result;
	}

	reverseSelectedTime() {
		this.commit(i18n.t("history.moveEvents"), model => {
			const chosen = model.allEvents().filter(event => event.selected);
			if (!chosen.length) return;
			const moved = [...new Set(chosen.flatMap(event => event.type === "group"
				? model.groupDescendants(event.id).filter(item => item.type !== "group") : [event]))];
			const beats = moved.map(event => Rational.from(event.time));
			const minimum = beats.reduce((left, right) => left.compare(right) <= 0 ? left : right);
			const maximum = beats.reduce((left, right) => left.compare(right) >= 0 ? left : right);
			for (const event of moved) event.time = minimum.add(maximum).sub(event.time).toJSON();
		});
	}

	currentChannelIndex() {
		return this.model.channels.findIndex(channel => channel.id === this.model.editor.currentChannel);
	}

	currentChannelActive() {
		return this.model.channels.some(channel => channel.id === this.model.editor.currentChannel && channel.active !== false);
	}

	canChangeCurrentChannel(direction) {
		const step = Math.sign(Number(direction));
		const current = this.currentChannelIndex();
		for (let index = current + step; index >= 0 && index < this.model.channels.length; index += step) {
			if (this.model.channels[index].active !== false) return true;
		}
		return false;
	}

	createChannel(relative) {
		this.exitModes();
		this.commit(i18n.t("history.createChannel"), model => {
			const index = model.channels.findIndex(channel => channel.id === model.editor.currentChannel);
			model.addChannel(index + relative);
		});
	}

	selectChannel(id) {
		const channel = this.model.channels.find(candidate => candidate.id === id);
		if (!channel || channel.active === false) return false;
		this.model.editor.currentChannel = id;
		this.timeline.revealChannel(id);
		this._refreshLightweight?.({ rebuildIndex: false, channelOnly: true, skipInspector: true, skipHistory: true, skipCommands: true });
		return true;
	}

	canSelectChannelByOrdinal(ordinal) {
		const channels = this.model.channels;
		const index = ordinal === -1 ? channels.length - 1 : ordinal - 1;
		if (index < 0 || index >= channels.length || ordinal !== -1 && (ordinal < 1 || ordinal > 9)) return false;
		return channels[index].active !== false;
	}

	selectChannelByOrdinal(ordinal) {
		const channels = this.model.channels;
		const index = ordinal === -1 ? channels.length - 1 : ordinal - 1;
		const channel = channels[index];
		return channel && channel.active !== false ? this.selectChannel(channel.id) : false;
	}

	uniqueChannelName(base) {
		const name = String(base || "Channel");
		const names = new Set(this.model.channels.map(channel => channel.name));
		if (!names.has(name)) return name;
		let suffix = 2;
		while (names.has(`${name} ${suffix}`)) suffix += 1;
		return `${name} ${suffix}`;
	}

	toggleChannel(id) {
		this.commit(i18n.t("history.editChannel"), model => {
			const index = model.channels.findIndex(channel => channel.id === id);
			const channel = model.channels[index];
			if (!channel) return;
			const activating = channel.active === false;
			channel.active = activating;
			if (activating) {
				if (!model.channels.some(candidate => candidate.id !== id && candidate.active !== false)) {
					model.editor.currentChannel = id;
				}
				return;
			}
			for (const event of model.allEvents()) {
				if (event.channel === id) event.selected = false;
			}
			const activeChannels = new Set(model.channels.filter(candidate => candidate.active !== false).map(candidate => candidate.id));
			for (const event of model.allEvents().filter(candidate => candidate.type === "group")) {
				if (!eventUsesChannel(event, activeChannels)) event.selected = false;
			}
			if (model.channels.length <= 1) return;
			const above = model.channels.slice(0, index).reverse().find(candidate => candidate.active !== false);
			const below = model.channels.slice(index + 1).find(candidate => candidate.active !== false);
			model.editor.currentChannel = (above || below || channel).id;
		}, { allowReadOnly: true, lightweight: true, activeChannels: true, channelOnly: true, rebuildIndex: false,
			selectionOnly: true, selectionSynced: true, scheduleDirty: true, skipCommands: true });
	}

	duplicateChannel(id) {
		this.commit(i18n.t("history.createChannel"), model => {
			const index = model.channels.findIndex(channel => channel.id === id);
			const source = model.channels[index];
			if (!source) return;
			const previousCurrent = model.editor.currentChannel;
			const duplicate = model.addChannel(index + 1, {
				name: this.uniqueChannelName(source.name),
				active: source.active !== false,
			});
			const sourceEvents = model.allEvents({ includeGroups: false }).filter(event =>
				event.channel === id && !model.ancestorsOf(event.id).length);
			for (const event of sourceEvents) model.addEvent({ ...deepClone(event), id: null, channel: duplicate.id, selected: false });
			if (duplicate.active === false) model.editor.currentChannel = previousCurrent;
		});
	}

	async deleteChannel(id) {
		if (this.model.channels.length <= 1) return;
		if (!await this.dialogs.confirm({ titleKey: "dialog.deleteChannel", messageKey: "dialog.deleteChannelMessage" })) return;
		const currentIndex = this.renderIndex?.eventSource === this.model.events ? this.renderIndex : null;
		this.commit(i18n.t("history.deleteChannel"), model => {
			const before = model.allEvents();
			const removed = model.removeChannel(id);
			if (!removed) return removed;
			const remaining = new Set(model.allEvents().map(event => event.id));
			currentIndex?.removeChannel?.(id, before.filter(event => !remaining.has(event.id)));
			return removed;
		}, {
			lightweight: true, rebuildIndex: false, channelOnly: true, channelLayout: true, scheduleDirty: true,
			historyPatch: (_removed, model) => ({
				kind: "removeChannel", channelId: id, view: captureHistoryView(model),
			}),
		});
	}

	async editChannel(id) {
		if (this.audio.playing) return;
		const channel = this.model.channels.find(candidate => candidate.id === id);
		if (!channel) return;
		const values = await this.dialogs.form({
			titleKey: "dialog.editChannel",
			values: { name: channel.name },
			fields: [{ id: "name", type: "text", labelKey: "field.name", required: true }],
		});
		if (!values) return;
		this.commit(i18n.t("history.editChannel"), model => {
			const target = model.channels.find(candidate => candidate.id === id);
			if (target) target.name = String(values.name);
		});
	}

	async deleteCurrentChannel() {
		return this.deleteChannel(this.model.editor.currentChannel);
	}

	moveCurrentChannel(direction) {
		this.moveChannel(this.model.editor.currentChannel, direction);
	}

	moveChannel(id, direction) {
		this.commit(i18n.t("history.moveChannel"), model => {
			const index = model.channels.findIndex(channel => channel.id === id);
			const target = index + direction;
			if (index < 0 || target < 0 || target >= model.channels.length) return;
			[model.channels[index], model.channels[target]] = [model.channels[target], model.channels[index]];
		}, { lightweight: true, viewOnly: true, channelOnly: true, rebuildIndex: false, skipInspector: true, scheduleDirty: false, skipCommands: true });
	}

	recentOpens() {
		try {
			const parsed = JSON.parse(localStorage.getItem(RECENT_OPEN_KEY) || "[]");
			if (Array.isArray(parsed) && parsed.length) {
				return parsed.filter(item => item?.path && ["project", "chart"].includes(item.kind));
			}
		} catch { /* Ignore a damaged recent list. */ }
		try {
			const last = JSON.parse(localStorage.getItem(LAST_OPEN_KEY) || "null");
			if (last?.path && ["project", "chart"].includes(last.kind)) return [last];
		} catch { /* Ignore a damaged last-open record. */ }
		return [];
	}

	async openRecent() {
		this.exitModes();
		const recent = this.recentOpens();
		if (!recent.length) { this.toast?.show("toast.noRecentFiles"); return; }
		const values = await this.dialogs.form({
			titleKey: "dialog.openRecent",
			values: { item: `${recent[0].kind}:${recent[0].path}` },
			fields: [{
				id: "item", type: "select", labelKey: "field.recentFile",
				options: recent.map(item => ({
					value: `${item.kind}:${item.path}`,
					label: `${item.title || i18n.t("field.untitled")} — ${item.path}`,
				})),
			}],
		});
		if (!values) return;
		const [kind, ...rest] = String(values.item).split(":");
		const entry = { kind, path: rest.join(":") };
		const opened = entry.kind === "project"
			? await this.openProject({ directoryPath: entry.path })
			: await this.openFile(await this.files.fileFromLocalPath(entry.path));
		if (!opened) this.toast?.error("toast.openFailed", { message: i18n.t("toast.recentUnavailable") });
	}

	async openAutosave() {
		this.exitModes();
		const recoveries = this.autosave.listed();
		if (!recoveries.length) { this.toast?.show("toast.noAutosaves"); return; }
		const values = await this.dialogs.form({
			titleKey: "dialog.openAutosave",
			values: { recovery: String(recoveries[0].timestamp) },
			fields: [{
				id: "recovery", type: "select", labelKey: "field.autosave",
				options: recoveries.map(entry => ({
					value: String(entry.timestamp),
					label: `${new Date(entry.timestamp).toLocaleString()} - ${entry.model.metadata.title || i18n.t("field.untitled")}`,
				})),
			}],
		});
		if (!values || !await this.confirmUnsaved()) return;
		const recovery = recoveries.find(entry => String(entry.timestamp) === String(values.recovery)) || recoveries[0];
		await this.clearRuntimeMedia();
		this.files.restoreLocalSourceContext(recovery.source);
		this.installProject([{
			id: "difficulty-0",
			file: recovery.source?.chartFilename || uniqueChartFilename(recovery.model.metadata.difficultyName),
			model: recovery.model,
		}], { activeChart: "difficulty-0", name: recovery.source?.projectName || recovery.model.metadata.title, saved: false });
		if (this.files.supportsLocalPaths) await this.syncMediaFromModel();
		this.refresh();
	}

	async runMacroDialog() {
		this.exitModes();
		if (this.model.editor.readOnly) return;
		const lists = await listRunnableMacros(this);
		const first = lists.global[0] || lists.project[0];
		const values = await this.dialogs.form({
			titleKey: "dialog.runMacro",
			values: { scope: lists.global.length || !lists.project.length ? "global" : "project", macro: first?.id || "" },
			fields: [
				{ id: "scope", type: "radio", labelKey: "field.macroScope", options: [
					{ value: "global", labelKey: "field.macroGlobal" },
					{ value: "project", labelKey: "field.macroProject" },
				] },
				{ id: "macro", type: "select", labelKey: "field.macro", options: [...lists.global, ...lists.project].map(item => ({
					value: item.id, label: item.label,
				})) },
			],
			onChange: (next, dialogState) => {
				const select = dialogState.entries.find(item => item.field.id === "macro")?.control?.element;
				const scope = dialogState.entries.find(item => item.field.id === "scope")?.control?.element;
				if (!select || !scope?.contains?.(dialogState.event?.target)) return;
				select.replaceChildren(...(lists[next.scope] || []).map(item => {
					const option = document.createElement("option");
					option.value = item.id;
					option.textContent = item.label;
					return option;
				}));
			},
		});
		if (!values?.macro) return;
		try { await runChosenMacro(this, values.macro); }
		catch (error) { this.toast.error("toast.macroFailed", { message: localizedErrorMessage(error) }); }
	}

	async togglePlayback() {
		if (this.audio.playing) {
			this.audio.pause();
			return;
		}
		this._syncAudioLoop();
		this.audio.seek(this.currentSeconds());
		this.audio.setRate(this.model.editor.speed);
		await this.audio.play();
	}

	async toggleReversePlayback() {
		if (this.audio.playing && this.audio.direction < 0) {
			this.audio.pause();
			return;
		}
		this._syncAudioLoop();
		this.audio.setRate(this.model.editor.speed);
		if (!this.audio.playing) this.audio.seek(this.currentSeconds());
		await this.audio.playReverse();
	}

	toggleAbLoop() {
		if (this.audio.playing) return false;
		const current = Rational.from(this.model.editor.currentTime);
		const marks = (this.model.editor.abLoopMarks || []).map(mark => Rational.from(mark));
		if (!marks.length) marks.push(current);
		else if (marks.length === 1) {
			if (!marks[0].equals(current)) marks.push(current);
		} else marks.length = 0;
		marks.sort((left, right) => left.compare(right));
		this.model.editor.abLoopMarks = marks.map(mark => mark.toJSON());
		this._syncAudioLoop();
		this.refreshInteractionPreview?.({ rebuildIndex: false });
		return true;
	}

	seekStart() {
		const start = this.timeBounds()[0];
		const span = this.model.editor.visibleRangeEnd - this.model.editor.visibleRangeBeginning;
		if (this.audio.playing) {
			this.audio.seek(start);
			if (!this.model.editor.lockVisibleRange
				&& (start < this.model.editor.visibleRangeBeginning || start > this.model.editor.visibleRangeEnd)) {
				this.setVisibleRange(start, start + span);
			}
			return;
		}
		const beat = this.timing().secondsToSnappedBeat(start, this.model.editor.subdivision);
		this.seekBeat(beat.toJSON());
		const snappedStart = this.currentSeconds();
		if (!this.model.editor.lockVisibleRange
			&& (snappedStart < this.model.editor.visibleRangeBeginning || snappedStart > this.model.editor.visibleRangeEnd)) {
			this.setVisibleRange(snappedStart, snappedStart + span, true);
		}
	}

	seekSeconds(delta) {
		const seconds = Math.max(this.timeBounds()[0], Math.min(this.timeBounds()[1], this.currentSeconds() + delta));
		if (this.audio.playing) {
			this.audio.seek(seconds);
			if (!this.model.editor.lockVisibleRange) {
				const span = this.model.editor.visibleRangeEnd - this.model.editor.visibleRangeBeginning;
				if (seconds < this.model.editor.visibleRangeBeginning || seconds > this.model.editor.visibleRangeEnd) {
					this.setVisibleRange(seconds - span / 2, seconds + span / 2, true);
				}
			}
			return;
		}
		this.seekBeat(this.timing().secondsToSnappedBeat(seconds, this.model.editor.subdivision).toJSON());
		if (!this.model.editor.lockVisibleRange
			&& (seconds < this.model.editor.visibleRangeBeginning || seconds > this.model.editor.visibleRangeEnd)) {
			const span = this.model.editor.visibleRangeEnd - this.model.editor.visibleRangeBeginning;
			this.setVisibleRange(seconds - span / 2, seconds + span / 2, true);
		}
	}

	setSubdivision(value) {
		const subdivision = Math.max(1, Math.floor(value));
		this.model.editor.subdivision = subdivision;
		if (!this.audio.playing) this.model.editor.currentTime = this.currentBeat().snap(subdivision).toJSON();
		this.refreshInteractionPreview?.({ rebuildIndex: false });
	}

	setSpeed(value) {
		const speed = Math.max(0.1, Math.min(4, Math.round(Number(value) * 100) / 100));
		this.model.editor.speed = speed;
		this.audio.setRate(speed);
		this._syncCheckedCommands?.(); this.refreshInteractionPreview?.({ rebuildIndex: false });
	}

};
