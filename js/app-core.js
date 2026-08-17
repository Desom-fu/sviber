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

export class SviberAppCore {
	constructor() {
		this.preferences = loadPreferences();
		this.model = ChartModel.createDefault({ editor: { allowOutOfBounds: this.preferences.allowOutOfBounds } });
		this.history = new History(this.model.snapshot(), { initialLabel: i18n.t("history.initial"), limit: 1000 });
		this.dirty = false;
		this.creationMode = null;
		this.curveDraft = null;
		this.freeTransform = null;
		this.previewBase = null;
		this.previewLabel = "";
		this.lastHoldDuration = [1, 0, 1];
		this.lastBgNoteDuration = [1, 0, 1];
		this.lastFlickAngle = Math.PI / 2;
		this.internalClipboard = null;
		this.backgroundUrl = null;
		this.scheduledHitIds = new Set();
		this.scheduledHoldReleaseIds = new Set();
		this.playFollowOffset = null;
		this.resumePlaybackAfterSeek = false;
		this.stageMoveAttachmentException = null;
		this.renderQueued = false;
		this.mediaSync = Promise.resolve();
		this.audio = new AudioPlayer();
		this.autosave = new AutosaveManager();

		this.tooltip = new TooltipManager({ i18n });
		this.toast = new ToastManager({ i18n });
		this.dialogs = new DialogManager({ i18n, tooltip: this.tooltip });
		this.files = new FileManager({ dialogs: this.dialogs, toast: this.toast, i18n });
		this.registry = new CommandRegistry(undefined, {
			blocked: () => this.audio.playing || Boolean(this.freeTransform),
			hardBlocked: () => Boolean(this.dialogs.active),
		});
		this.menu = new MenuBar({ registry: this.registry, i18n, tooltip: this.tooltip, contextProvider: () => this });
		this.toolbar = new Toolbar({ registry: this.registry, i18n, tooltip: this.tooltip, contextProvider: () => this });
		this.unsubscribeCommandModes = this.registry.subscribe(change => {
			if (change.type === "execute" && change.phase === "before") this.exitCreationModes();
		});

		this.timeline = new TimelineView(document.getElementById("timeline-surface"), this._timelineCallbacks());
		this.stage = new StageView(document.getElementById("stage-surface"), this._stageCallbacks());
		this.inspectorPanel = new InspectorPanel({
			i18n, tooltip: this.tooltip,
			onChange: (property, value) => this.editSelectedProperty(property, value),
			onTransformChange: (index, value) => {
				if (!this.freeTransform) return;
				const matrix = [...this.freeTransform.matrix];
				matrix[index] = value;
				this.previewFreeTransform(matrix);
			},
		});
		this.snappeesPanel = new SnappeesPanel({
			i18n, tooltip: this.tooltip,
			onSelect: id => this.selectSnappee(id),
			onToggle: id => this.toggleSnappee(id),
			onDuplicate: id => this.duplicateSnappee(id),
			onDelete: id => void this.deleteSnappee(id),
			onEdit: id => void this.editSnappee(id),
		});
		this.historyPanel = new HistoryPanel({ i18n, tooltip: this.tooltip, onGoTo: index => this.goToHistory(index) });
		this.savedSignature = this.modelSignature();
		this.nextDifficultyId = 1;
		this.activeDifficultyId = "difficulty-0";
		this.projectName = this.model.metadata.title;
		this.projectTitle = this.model.metadata.title;
		this.projectArtist = this.model.metadata.artist;
		this.projectMusic = String(this.model.music || "");
		this.projectImage = String(this.model.image || "");
		this.projectDirty = false;
		this.difficulties = [{
			id: this.activeDifficultyId,
			file: uniqueChartFilename(this.model.metadata.difficultyName),
			model: this.model,
			history: this.history,
			savedSignature: this.savedSignature,
		}];
		this.difficultyUiSignature = "";
	}

	async initialize() {
		i18n.apply(document);
		const difficultySwitcher = document.querySelector(".difficulty-switcher");
		if (difficultySwitcher) difficultySwitcher.hidden = !globalThis.nw;
		this.tooltip.bind(document);
		this._bindTabs();
		this._registerCommands();
		this.detachKeyboard = this.registry.attachKeyboard(document, () => this);
		this._bindInputs();
		this._bindAudio();
		this._bindGlobalInteraction();
		await Promise.all([this.timeline.surface.ready, this.stage.surface.ready]);
		this.refreshNow();
		document.getElementById("app").setAttribute("aria-busy", "false");
		document.getElementById("loading-screen").hidden = true;
		await this._offerAutosave();
		this.refreshNow();
		this.autosave.start(() => {
			if (this.modelSignature() === this.savedSignature) return;
			try {
				const timestamp = this.autosave.save(this.model);
				this.history.markCurrent("autosave", timestamp);
				this.historyPanel.render(this.history);
				this.toast.show("toast.autosaved", {}, { duration: 1400 });
			} catch (error) {
				console.warn("Auto-save failed", error);
			}
		});
		if ("serviceWorker" in navigator && location.protocol.startsWith("http") && !globalThis.nw) {
			navigator.serviceWorker.register("service-worker.js").catch(error => console.warn("Service worker registration failed", error));
		}
	}

	viewState() {
		return {
			...this.model.metadata,
			music: this.model.music,
			image: this.model.image,
			editor: this.model.editor,
			timing: this.model.timing,
			channels: this.model.channels,
			events: this.model.events,
			snappees: this.model.snappees,
			preferences: this.preferences,
		};
	}

	timing() {
		return this.model.timing instanceof TimingMap ? this.model.timing : new TimingMap(this.model.timing);
	}

	currentBeat() {
		return this.model.editor.timeSnapped === false
			? this.timing().secondsToBeat(this.model.editor.currentTime)
			: Rational.from(this.model.editor.currentTime);
	}

	currentSeconds() {
		return this.model.editor.timeSnapped === false
			? Number(this.model.editor.currentTime)
			: this.timing().beatToSeconds(this.model.editor.currentTime);
	}

	timeBounds(includeCurrent = false) {
		const baseMinimum = Math.min(0, this.timing().beatToSeconds(0));
		const current = includeCurrent && !this.audio.playing ? this.currentSeconds() : baseMinimum;
		const minimum = Math.min(baseMinimum, Number.isFinite(current) ? current : baseMinimum);
		if (this.audio.buffer) return [minimum, this.audio.buffer.duration];
		let maximum = Math.max(10, minimum + 10);
		for (const event of this.model.events) {
			let beat = Rational.from(event.time);
			if (DURATION_TYPES.has(event.type)) beat = beat.add(event.duration || 0);
			maximum = Math.max(maximum, this.timing().beatToSeconds(beat) + 10);
		}
		this.audio.syntheticEnd = maximum;
		return [minimum, maximum];
	}

	commit(label, mutation, options = {}) {
		if (this.audio.playing) return undefined;
		if (this.freeTransform) this.finishFreeTransform();
		if (this.previewBase) {
			this.model.restore(this.previewBase);
			this.previewBase = null;
		}
		const selectionBefore = new Set(this.model.events.filter(event => event.selected).map(event => event.id));
		const before = JSON.stringify(this.model.snapshot());
		const result = mutation(this.model);
		if (JSON.stringify(this.model.snapshot()) === before) {
			this.refresh();
			return result;
		}
		this._reconcileStageMoveAttachmentException(selectionBefore);
		this.history.record(this.model.snapshot(), label);
		if (options.dirty !== false) this.updateDirty();
		this.refresh();
		return result;
	}

	modelSignature(model = this.model) {
		const snapshot = model.snapshot();
		delete snapshot.editor;
		for (const event of snapshot.events || []) delete event.selected;
		for (const snappee of snapshot.snappees || []) delete snappee.selected;
		return JSON.stringify(snapshot);
	}

	activeDifficultyState() {
		return this.difficulties.find(entry => entry.id === this.activeDifficultyId) || this.difficulties[0] || null;
	}

	syncActiveDifficultyState() {
		const entry = this.activeDifficultyState();
		if (!entry) return;
		entry.model = this.model;
		entry.history = this.history;
		entry.savedSignature = this.savedSignature;
	}

	projectSnapshot() {
		this.syncActiveDifficultyState();
		return {
			name: this.projectName || this.model.metadata.title,
			music: this.projectMusic,
			image: this.projectImage,
			activeChart: this.activeDifficultyId,
			charts: this.difficulties.map(entry => ({ id: entry.id, file: entry.file, model: entry.model })),
		};
	}

	syncProjectSharedFields() {
		for (const entry of this.difficulties) {
			entry.model.metadata.title = this.projectTitle;
			entry.model.metadata.artist = this.projectArtist;
			entry.model.music = this.projectMusic;
			entry.model.image = this.projectImage;
		}
		this.model.metadata.title = this.projectTitle;
		this.model.metadata.artist = this.projectArtist;
		this.model.music = this.projectMusic;
		this.model.image = this.projectImage;
	}

	syncProjectHistorySharedFields(options = {}) {
		const excludeDifficultyId = options.excludeDifficultyId ?? null;
		const metadata = options.metadata !== false;
		const media = options.media !== false;
		for (const entry of this.difficulties) {
			if (entry.id === excludeDifficultyId) continue;
			entry.history.transformStates(state => {
				if (metadata) {
					state.metadata.title = this.projectTitle;
					state.metadata.artist = this.projectArtist;
				}
				if (media) {
					state.music = this.projectMusic;
					state.image = this.projectImage;
				}
				return state;
			});
		}
	}

	restoreHistorySnapshot(snapshot) {
		const title = String(snapshot.metadata?.title ?? this.projectTitle);
		const artist = String(snapshot.metadata?.artist ?? this.projectArtist);
		const metadataChanged = title !== this.projectTitle || artist !== this.projectArtist;
		this.model.restore(snapshot);
		if (metadataChanged) {
			this.projectTitle = title;
			this.projectArtist = artist;
			this.projectName = title;
			this.syncProjectHistorySharedFields({ excludeDifficultyId: this.activeDifficultyId, media: false });
		}
		this.syncProjectSharedFields();
	}

	markProjectSaved() {
		this.syncActiveDifficultyState();
		for (const entry of this.difficulties) entry.savedSignature = this.modelSignature(entry.model);
		this.savedSignature = this.activeDifficultyState()?.savedSignature ?? this.modelSignature();
		this.projectDirty = false;
		this.dirty = false;
	}

	installProject(charts, options = {}) {
		if (!charts?.length) throw new Error("A project must contain at least one difficulty.");
		this.nextDifficultyId = 1;
		const knownFiles = charts.map(item => item.file).filter(Boolean);
		this.difficulties = charts.map(chart => {
			const model = chart.model instanceof ChartModel ? chart.model : ChartModel.import(chart.document);
			model.editor.allowOutOfBounds = this.preferences.allowOutOfBounds;
			const id = String(chart.id || `difficulty-${this.nextDifficultyId++}`);
			const match = id.match(/^difficulty-(\d+)$/);
			if (match) this.nextDifficultyId = Math.max(this.nextDifficultyId, Number(match[1]) + 1);
			const history = new History(model.snapshot(), { initialLabel: i18n.t("history.initial"), limit: 1000 });
			return {
				id,
				file: String(chart.file || uniqueChartFilename(model.metadata.difficultyName, knownFiles)),
				model,
				history,
				savedSignature: options.saved === false ? null : this.modelSignature(model),
			};
		});
		this.activeDifficultyId = this.difficulties.some(entry => entry.id === options.activeChart)
			? options.activeChart
			: this.difficulties[0].id;
		const active = this.activeDifficultyState();
		this.model = active.model;
		this.history = active.history;
		this.savedSignature = active.savedSignature;
		this.projectName = String(options.name || this.model.metadata.title || "Untitled");
		this.projectTitle = String(options.title ?? this.model.metadata.title ?? "Untitled");
		this.projectArtist = String(options.artist ?? this.model.metadata.artist ?? "");
		this.projectMusic = String(options.music ?? this.model.music ?? "");
		this.projectImage = String(options.image ?? this.model.image ?? "");
		this.syncProjectSharedFields();
		this.syncProjectHistorySharedFields();
		this.projectDirty = options.saved === false;
		this.difficultyUiSignature = "";
		this.updateDirty();
	}

	markSaved() {
		this.savedSignature = this.modelSignature();
		this.syncActiveDifficultyState();
		this.updateDirty();
	}

	updateDirty() {
		this.syncActiveDifficultyState();
		this.dirty = this.projectDirty || this.difficulties.some(entry => this.modelSignature(entry.model) !== entry.savedSignature);
		return this.dirty;
	}

	preview(label, mutation) {
		if (this.audio.playing) return;
		if (!this.previewBase) {
			this.previewBase = this.model.snapshot();
			this.previewLabel = label;
		}
		this.model.restore(this.previewBase);
		mutation(this.model);
		this.refresh();
	}

	cancelPreview() {
		if (!this.previewBase) return;
		this.model.restore(this.previewBase);
		this.previewBase = null;
		this.refresh();
	}

	refresh() {
		if (this.renderQueued) return;
		this.renderQueued = true;
		requestAnimationFrame(() => {
			this.renderQueued = false;
			this.refreshNow();
		});
	}

	refreshPlaybackFrame() {
		const view = this.viewState();
		this.timeline.setState(view);
		this.stage.setState(view);
		this._updateStatus();
		this.playbackFrameCount = (this.playbackFrameCount || 0) + 1;
	}

	_refreshDifficultyUi() {
		const select = document.getElementById("difficulty-select");
		const swatch = document.getElementById("difficulty-color");
		const addButton = document.getElementById("difficulty-add");
		const deleteButton = document.getElementById("difficulty-delete");
		if (!select || !swatch || !addButton || !deleteButton) return;
		const signature = JSON.stringify({
			language: i18n.language,
			active: this.activeDifficultyId,
			charts: this.difficulties.map(entry => ({
				id: entry.id,
				name: entry.model.metadata.difficultyName,
				difficulty: entry.model.metadata.difficulty,
				sup: entry.model.metadata.difficultySup,
				dirty: this.modelSignature(entry.model) !== entry.savedSignature,
			})),
		});
		if (signature !== this.difficultyUiSignature) {
			select.replaceChildren(...this.difficulties.map(entry => {
				const option = document.createElement("option");
				const metadata = entry.model.metadata;
				const level = `${metadata.difficulty || ""}${metadata.difficultySup || ""}`.trim();
				const dirty = this.modelSignature(entry.model) !== entry.savedSignature ? "* " : "";
				option.value = entry.id;
				option.textContent = `${dirty}${metadata.difficultyName}${level ? ` ${level}` : ""}`;
				return option;
			}));
			select.value = this.activeDifficultyId;
			this.difficultyUiSignature = signature;
		}
		const active = this.activeDifficultyState();
		swatch.style.background = String(active?.model.metadata.difficultyColor || "#7f7f7f");
		select.title = i18n.t("difficulty.select");
		select.setAttribute("aria-label", i18n.t("difficulty.select"));
		addButton.title = i18n.t("difficulty.add");
		addButton.setAttribute("aria-label", i18n.t("difficulty.add"));
		deleteButton.title = i18n.t("difficulty.delete");
		deleteButton.setAttribute("aria-label", i18n.t("difficulty.delete"));
		const blocked = this.audio.playing || Boolean(this.freeTransform);
		select.disabled = blocked;
		addButton.disabled = blocked;
		deleteButton.disabled = blocked || this.difficulties.length <= 1;
	}

	refreshNow() {
		const view = this.viewState();
		const timelineHeight = 88 + Math.min(3, Math.max(1, this.model.channels.length)) * 48;
		document.querySelector(".workspace")?.style.setProperty("--timeline-height", `${timelineHeight}px`);
		this.timeline.setState(view);
		this.stage.setState(view);
		this._updateStatus();
		this.inspectorPanel.render(this.model, { transform: this.freeTransform?.matrix || null });
		this.snappeesPanel.render(this.model);
		this.historyPanel.render(this.history);
		this._refreshDifficultyUi();
		for (const element of [
			document.getElementById("inspector-panel"),
			document.getElementById("snappees-panel"),
			document.querySelector(".history-panel"),
		]) {
			if (!element) continue;
			element.inert = this.audio.playing;
			element.classList.toggle("is-playback-locked", this.audio.playing);
		}
		this.registry.notifyAll();
		this._syncCheckedCommands();
		document.title = `${this.dirty ? "* " : ""}${this.model.metadata.title} ${this.model.metadata.difficultyName} - sviber`;
	}

	_updateStatus() {
		const seconds = this.currentSeconds();
		const subdivision = this.model.editor.subdivision;
		const beat = this.model.editor.timeSnapped === false
			? this.timing().secondsToBeat(seconds)
			: Rational.from(this.model.editor.currentTime);
		document.getElementById("status-time").textContent = formatTime(seconds);
		document.getElementById("status-beat").textContent = formatBeat(beat, subdivision);
		document.getElementById("status-speed").textContent = Number(this.model.editor.speed).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
		const operation = document.getElementById("operation-status");
		if (this.creationMode && this.stage.creationPreview) {
			const preview = this.stage.creationPreview;
			operation.textContent = `${eventTypeLabel(this.creationMode)}\nx ${preview.x.toFixed(2)}  y ${preview.y.toFixed(2)}${preview.snappee ? `\n${preview.snappee.name}` : ""}`;
		} else if (this.curveDraft) {
			operation.textContent = `${i18n.t(`snappee.${this.curveDraft.type}`)}\n${this.curveDraft.points.length}`;
		} else if (this.freeTransform) {
			operation.textContent = this.freeTransform.matrix.map(value => Number(value).toFixed(3)).join("  ");
		} else operation.textContent = "";
	}

	_syncCheckedCommands() {
		for (const type of ["tap", "hold", "drag", "flick", "bgNote"]) {
			this.registry.setChecked(`events.${type}`, this.creationMode === type);
		}
		for (const [id, mode] of [["snappee.bezierCurve", "bezierCurve"], ["snappee.circularArc", "circularArcCurve"], ["snappee.pen", "penCurve"]]) {
			this.registry.setChecked(id, this.curveDraft?.type === mode);
		}
		this.registry.setChecked("transform.free", Boolean(this.freeTransform));
		this.registry.setChecked("music.playPause", this.audio.playing);
		for (const value of [1, 2, 3, 4, 6, 8]) this.registry.setChecked(`music.subdivision${value}`, this.model.editor.subdivision === value);
		for (const [id, value] of [["music.speed025", 0.25], ["music.speed05", 0.5], ["music.speed1", 1]]) {
			this.registry.setChecked(id, Math.abs(this.model.editor.speed - value) < 1e-8);
		}
	}

	_bindTabs() {
		const inspectorTab = document.getElementById("inspector-tab");
		const snappeesTab = document.getElementById("snappees-tab");
		const inspector = document.getElementById("inspector-panel");
		const snappees = document.getElementById("snappees-panel");
		const setTab = useInspector => {
			inspectorTab.classList.toggle("is-active", useInspector);
			snappeesTab.classList.toggle("is-active", !useInspector);
			inspectorTab.setAttribute("aria-selected", String(useInspector));
			snappeesTab.setAttribute("aria-selected", String(!useInspector));
			inspector.hidden = !useInspector;
			snappees.hidden = useInspector;
		};
		inspectorTab.addEventListener("click", () => setTab(true));
		snappeesTab.addEventListener("click", () => setTab(false));
	}

	_bindInputs() {
		document.getElementById("open-file-input").addEventListener("change", event => void this.openFile(event.target.files[0]).finally(() => { event.target.value = ""; }));
		document.getElementById("chart-file-input").addEventListener("change", event => void this.openFile(event.target.files[0]).finally(() => { event.target.value = ""; }));
		document.getElementById("music-file-input").addEventListener("change", event => void this.loadMusic(event.target.files[0]).finally(() => { event.target.value = ""; }));
		document.getElementById("background-file-input").addEventListener("change", event => void this.loadBackground(event.target.files[0]).finally(() => { event.target.value = ""; }));
		document.getElementById("difficulty-select")?.addEventListener("change", event => void this.switchDifficulty(event.target.value));
		document.getElementById("difficulty-add")?.addEventListener("click", () => void this.newDifficulty());
		document.getElementById("difficulty-delete")?.addEventListener("click", () => void this.deleteDifficulty());
	}

	_bindAudio() {
		this.audio.addEventListener("timeupdate", event => {
			if (!this.audio.playing) return;
			const time = event.detail;
			this.model.editor.timeSnapped = false;
			this.model.editor.currentTime = time;
			if (this.playFollowOffset != null) {
				const span = this.model.editor.visibleRangeEnd - this.model.editor.visibleRangeBeginning;
				const bounds = this.timeBounds();
				let beginning = time - this.playFollowOffset;
				beginning = Math.max(bounds[0], Math.min(bounds[1] - span, beginning));
				this.model.editor.visibleRangeBeginning = beginning;
				this.model.editor.visibleRangeEnd = beginning + span;
			}
			this._scheduleHits(time);
			this.refreshPlaybackFrame();
		});
		this.audio.addEventListener("play", () => {
			const time = this.currentSeconds();
			const editor = this.model.editor;
			this.playFollowOffset = time >= editor.visibleRangeBeginning && time <= editor.visibleRangeEnd
				? time - editor.visibleRangeBeginning : null;
			this.scheduledHitIds.clear();
			this.scheduledHoldReleaseIds.clear();
			this._scheduleHits(time);
			this.refresh();
		});
		const finish = () => {
			this.stage.cancelScheduledHits();
			const snapped = this.timing().secondsToSnappedBeat(this.audio.currentTime, this.model.editor.subdivision);
			this.model.editor.timeSnapped = true;
			this.model.editor.currentTime = snapped.toJSON();
			this.playFollowOffset = null;
			this.scheduledHitIds.clear();
			this.scheduledHoldReleaseIds.clear();
			this.refresh();
		};
		this.audio.addEventListener("pause", finish);
		this.audio.addEventListener("ended", finish);
		this.audio.addEventListener("seek", () => {
			this.stage.cancelScheduledHits();
			this.scheduledHitIds.clear();
			this.scheduledHoldReleaseIds.clear();
		});
		this.audio.addEventListener("ratechange", () => {
			this.stage.cancelScheduledHits();
			this.scheduledHitIds.clear();
			this.scheduledHoldReleaseIds.clear();
		});
	}

	_scheduleHits(current) {
		const schedule = collectHitSchedule(
			this.model.events,
			this.timing(),
			current,
			this.audio.rate,
			this.scheduledHitIds,
		);
		for (const { event, delay } of schedule) {
			this.scheduledHitIds.add(event.id);
			void this.audio.playHit(event.type, delay);
			this.stage.triggerHit(event, delay);
		}
		const releases = collectHoldReleaseSchedule(
			this.model.events,
			this.timing(),
			current,
			this.audio.rate,
			this.scheduledHoldReleaseIds,
		);
		for (const { event, delay } of releases) {
			this.scheduledHoldReleaseIds.add(event.id);
			this.stage.triggerHit(event, delay);
		}
	}

	_bindGlobalInteraction() {
		document.addEventListener("keydown", event => {
			if (event.key === "Escape" && !this.dialogs.active) {
				if (this.freeTransform) event.preventDefault();
				this.exitModes();
				for (const snappee of this.model.snappees) snappee.selected = false;
				this.refresh();
			} else if (event.key === "Enter" && this.freeTransform && !this.dialogs.active) {
				event.preventDefault();
				this.finishFreeTransform();
			} else if (event.key === "Enter" && this.curveDraft && !this.dialogs.active) {
				event.preventDefault();
				this.finishCurveDraft();
			}
		});
		document.addEventListener("wheel", event => {
			if (this.dialogs.active || event.defaultPrevented
				|| event.target.closest(".property-panel,.history-list,.menu-popup,.dialog-body,.tool-bar")) return;
			event.preventDefault();
			this.navigateWheel(event.deltaY, event.ctrlKey);
		}, { passive: false });
		window.addEventListener("beforeunload", event => {
			if (!this.dirty) return;
			event.preventDefault();
			event.returnValue = "";
		});
		i18n.subscribe(() => this.refresh());
	}

	async _offerAutosave() {
		const recoveries = this.autosave.recoverable();
		if (!recoveries.length) return;
		const values = await this.dialogs.form({
			titleKey: "dialog.autosave",
			messageKey: "dialog.autosaveMessage",
			values: { recovery: String(recoveries[0].timestamp) },
			fields: [{
				id: "recovery", type: "select", labelKey: "field.autosave",
				options: recoveries.map(entry => ({
					value: String(entry.timestamp),
					label: `${new Date(entry.timestamp).toLocaleString()} - ${entry.model.metadata.title || i18n.t("field.untitled")}`,
				})),
			}],
			buttons: [
				{ id: "load", labelKey: "dialog.load", primary: true, submit: true },
				{ id: "discard", labelKey: "dialog.discard", cancel: true, value: null, validate: false },
			],
		});
		if (values) {
			const recovery = recoveries.find(entry => String(entry.timestamp) === String(values.recovery)) || recoveries[0];
			recovery.model.editor.allowOutOfBounds = this.preferences.allowOutOfBounds;
			this.installProject([{
				id: "difficulty-0",
				file: uniqueChartFilename(recovery.model.metadata.difficultyName),
				model: recovery.model,
			}], { activeChart: "difficulty-0", name: recovery.model.metadata.title, saved: false });
		} else this.autosave.markManualSave();
	}

	exitModes() {
		this.creationMode = null;
		this.curveDraft = null;
		this.cancelFreeTransform();
		this.cancelPreview();
	}

	destroy() {
		this.detachKeyboard?.();
		this.autosave.stop();
		this.timeline.destroy();
		this.stage.destroy();
		this.audio.destroy();
		this.menu.destroy();
		this.toolbar.destroy();
		this.tooltip.destroy();
		this.unsubscribeCommandModes?.();
	}

}
