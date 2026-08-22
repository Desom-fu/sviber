import { i18n } from "./i18n.js"; import { CommandRegistry, isEditableTarget } from "./commands.js"; import { DialogManager, MenuBar, ToastManager, Toolbar, TooltipManager } from "./ui.js"; import { ChartModel } from "./core/chart-model.js";
import { uniqueChartFilename } from "./core/project.js"; import { History } from "./core/history.js"; import { Rational } from "./core/rational.js"; import { TimingMap } from "./core/timing.js";
import { AudioPlayer } from "./audio/player.js";
import { collectHitSchedule, collectHoldReleaseSchedule, collectIndexedHitSchedule, collectIndexedHoldReleaseSchedule, collectReverseHitSchedule, collectIndexedReverseHitSchedule, collectMetronomeSchedule } from "./audio/scheduler.js";
import { TimelineView } from "./render/timeline.js";
import { StageView } from "./render/stage.js";
import { ScrollView } from "./render/scroll-view.js";
import { ChartRenderIndex } from "./render/chart-index.js";
import { HelpController } from "./help.js";
import { AutosaveManager, FileManager } from "./platform.js";
import { ChannelsPanel, ClipsPanel, HistoryPanel, InspectorPanel, SnappeesPanel } from "./panels.js";
import { loadPreferences, resolvePreferenceLanguage, applyThemePreference, deepClone, selected, formatTime, formatBeat, eventTypeLabel } from "./app-helpers.js";
import { handleMacroMessage } from "./app-macro-bridge.js";
import { bindEdgeToggleReveal } from "./ui-layout.js";
import { LiveHosting } from "./live-hosting.js";
export class SviberAppCore {
	constructor() {
		this.preferences = loadPreferences();
		applyThemePreference(this.preferences.theme); i18n.setLanguage(resolvePreferenceLanguage(this.preferences.language));
		this.model = ChartModel.createDefault();
		this.model.snappees[0].name = i18n.t("snappee.preset.playfieldGrid");
		this.history = new History(this.model.snapshot(), { initialLabel: i18n.t("history.initial"), limit: 1000 });
		this.dirty = false;
		this.creationMode = null;
		this.curveDraft = null;
		this.freeTransform = null;
		this.previewBase = null;
		this.previewLabel = "";
		this.previewScheduleDirty = false;
		this.selectionPreview = null;
		this.groupSelectionScope = null;
		this.lastHoldDuration = [1, 0, 1];
		this.lastBgNoteDuration = [1, 0, 1];
		this.lastFlickAngle = Math.PI / 2;
		this.internalClipboard = null;
		this.backgroundUrl = null;
		this.scheduledHitIds = new Set();
		this.scheduledHoldReleaseIds = new Set();
		this.scheduledMetronomeBeats = new Set();
		this.playbackScheduleInvalidated = false;
		this.playFollowOffset = null;
		this.playbackOrigin = null;
		this.lastPlaybackTime = null;
		this.resumePlaybackAfterSeek = false;
		this.stageMoveAttachmentException = null;
		this.renderQueued = false;
		this.statusUpdateFrame = 0;
		this.renderIndex = null;
		this.mediaSync = Promise.resolve();
		this.audio = new AudioPlayer();
		this.audio.setSeVolume(this.preferences.seVolume);
		this.audio.setMusicVolume(this.preferences.musicVolume);
		this.autosave = new AutosaveManager();
		this.macroWindow = null;
		this.macroMessageHandler = event => void handleMacroMessage(this, event);
		this.fullscreen = false;
		this.liveHosting = new LiveHosting({ address: this.preferences.liveHostingAddress, reloadPort: this.preferences.liveReloadPort,
			getLevel: () => this.hostedLevel(), onMessage: data => {
				if (data.type === "connect") console.info(`Sunniesnow connected to sviber (${data.userAgent || "unknown client"}).`);
			},
			onError: error => this.toast?.error("toast.liveHostingFailed", { message: String(error?.message || error) }),
			onStop: () => { this.toast?.show("toast.liveHostingStopped"); this.refresh?.(); },
		});
		this.boundFullscreenChange = () => this._syncFullscreenState();
		this.tooltip = new TooltipManager({ i18n });
		this.toast = new ToastManager({ i18n });
		this.dialogs = new DialogManager({ i18n, tooltip: this.tooltip });
		this.files = new FileManager({ dialogs: this.dialogs, toast: this.toast, i18n });
		this.help = new HelpController({ dialogs: this.dialogs, i18n, tooltip: this.tooltip });
		this.registry = new CommandRegistry(undefined, {
			blocked: () => Boolean(this.freeTransform),
			playbackBlocked: () => this.audio.playing,
			hardBlocked: () => Boolean(this.dialogs.active),
		});
		this.dialogs.onStateChange = () => this.registry.notifyAll();
		this.menu = new MenuBar({ registry: this.registry, i18n, tooltip: this.tooltip, contextProvider: () => this });
		this.toolbar = new Toolbar({ registry: this.registry, i18n, tooltip: this.tooltip, contextProvider: () => this });
		this.unsubscribeCommandModes = this.registry.subscribe(change => {
			if (change.type !== "execute" || change.phase !== "before") return;
			const creationTools = new Set(["events.tap", "events.hold", "events.drag", "events.flick", "events.bgNote"]);
			if (change.id.startsWith("music.") || creationTools.has(change.id)
				|| change.id === "edit.undo" || change.id === "edit.redo") return;
			this.exitCreationModes();
		});
		this.timeline = new TimelineView(document.getElementById("timeline-surface"), this._timelineCallbacks());
		this.stage = new StageView(document.getElementById("stage-surface"), this._stageCallbacks());
		this.scrollView = new ScrollView(document.getElementById("scroll-surface"), {
			onSelectEvents: (ids, mode) => this.selectEvents(ids, mode),
			onScrollPan: (seconds, final, drag) => this.panScrollView?.(seconds, final, drag),
			getTimelineWidth: () => this.timeline.surface.width,
		});
		this.inspectorPanel = new InspectorPanel({
			i18n, tooltip: this.tooltip,
			onChange: (property, value) => this.editSelectedProperty(property, value),
			onTransformChange: (index, value) => {
				if (!this.freeTransform) return;
				const matrix = [...this.freeTransform.matrix];
				matrix[index] = value;
				this.previewFreeTransform(matrix);
				return this.freeTransform?.matrix?.[index];
			},
		});
		this.snappeesPanel = new SnappeesPanel({
			i18n, tooltip: this.tooltip,
			onSelect: id => this.selectSnappee(id),
			onToggle: id => this.toggleSnappee(id),
			onDuplicate: id => this.duplicateSnappee(id),
			onDelete: id => void this.deleteSnappee(id),
			onEdit: id => void this.editSnappee(id),
			onMove: (id, direction) => this.moveSnappeeInList(id, direction),
		});
		this.channelsPanel = new ChannelsPanel({
			i18n, tooltip: this.tooltip,
			onSelect: id => this.selectChannel(id),
			onToggle: id => this.toggleChannel(id),
			onDuplicate: id => this.duplicateChannel(id),
			onDelete: id => void this.deleteChannel(id),
			onEdit: id => void this.editChannel(id),
			onMove: (id, direction) => this.moveChannel(id, direction),
		});
		this.historyPanel = new HistoryPanel({ i18n, tooltip: this.tooltip, onGoTo: index => this.goToHistory(index) });
		this.clipsPanel = new ClipsPanel({ i18n, tooltip: this.tooltip,
			onPaste: index => void this.pasteClip(index),
			onMove: (index, direction) => this.moveClip(index, direction),
			onEdit: index => void this.editClip(index),
			onDelete: index => void this.deleteClip(index),
		});
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
		await i18n.ready;
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
		this._bindLayoutToggles();
		window.addEventListener("message", this.macroMessageHandler);
		await Promise.all([
			this.timeline.surface.ready,
			this.stage.surface.ready,
			this.scrollView.surface.ready,
		]);
		this.refreshNow();
		document.getElementById("app").setAttribute("aria-busy", "false");
		document.getElementById("loading-screen").hidden = true;
		const autosaveOffered = await this._offerAutosave();
		if (!autosaveOffered) await this.reopenLastDocument?.();
		this.refreshNow();
		this.startAutosave();
		if ("serviceWorker" in navigator && location.protocol.startsWith("http") && !globalThis.nw) {
			navigator.serviceWorker.register("service-worker.js").catch(error => console.warn("Service worker registration failed", error));
		}
	}
	readOnlyCommandAllowed(id) {
		if (id !== "edit.delete" && id !== "edit.cut") return false;
		const events = selected(this.model);
		return events.length > 0 && events.every(event => event.type === "comment");
	}
	setReadOnly(value) {
		const next = Boolean(value);
		if (Boolean(this.model.editor.readOnly) === next) return next;
		if (next) this.exitModes();
		this.model.editor.readOnly = next;
		try { this.macroWindow?.postMessage({ type: "sviber-macro-read-only", readOnly: next }, "*"); }
		catch { /* The macro popup may have closed. */ }
		this.refresh();
		return next;
	}
	_isFullscreen() {
		if (document.fullscreenElement) return true;
		try { return Boolean(globalThis.nw && globalThis.nw.Window.get().isFullscreen); }
		catch { return false; }
	}
	_syncFullscreenState() {
		const next = this._isFullscreen();
		const changed = next !== this.fullscreen;
		this.fullscreen = next;
		const control = document.getElementById("fullscreen");
		if (control) control.checked = this.fullscreen;
		if (changed) this.requestStatusUpdate();
	}
	async setFullscreen(value) {
		const requested = Boolean(value);
		try {
			if (globalThis.nw?.Window?.get) {
				const windowObject = globalThis.nw.Window.get();
				if (requested) windowObject.enterFullscreen?.();
				else windowObject.leaveFullscreen?.();
			} else if (requested) {
				await document.documentElement.requestFullscreen?.();
			} else if (document.fullscreenElement) {
				await document.exitFullscreen?.();
			}
		} catch (error) {
			this.toast.error("error.fullscreen", { message: String(error?.message || error) });
		}
		this._syncFullscreenState();
		const live = document.getElementById("live-hosting");
		if (live) live.checked = Boolean(this.liveHosting.server);
		return this.fullscreen;
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
			clips: this.model.clips,
			selectionScope: this.groupSelectionScope,
			preferences: this.preferences,
			renderIndex: this.renderIndex,
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
		this.audio.syntheticStart = minimum;
		if (this.audio.buffer) {
			this.audio.syntheticEnd = this.audio.buffer.duration;
			return [minimum, this.audio.buffer.duration];
		}
		if (this.renderIndex) {
			this.audio.syntheticEnd = Math.max(this.renderIndex.maximumTime, minimum + 10);
			return [minimum, this.audio.syntheticEnd];
		}
		let maximum = Math.max(10, minimum + 10);
		for (const event of this.model.allEvents({ includeGroups: false })) {
			let beat = Rational.from(event.time);
			if (DURATION_TYPES.has(event.type)) beat = beat.add(event.duration || 0);
			maximum = Math.max(maximum, this.timing().beatToSeconds(beat) + 10);
		}
		this.audio.syntheticEnd = maximum;
		return [minimum, maximum];
	}
	commit(label, mutation, options = {}) {
		if (this.model.editor.readOnly && !options.allowReadOnly) return null;
		this.cancelSelectionPreview?.();
		if (this.freeTransform) this.finishFreeTransform();
		let previewScheduleDirty = false;
		if (this.previewBase) {
			previewScheduleDirty = this.previewScheduleDirty;
			this.model.restore(this.previewBase);
			this.previewBase = null;
			this.previewScheduleDirty = false;
		}
		return this._finishCommit(label, mutation, options, previewScheduleDirty);
	}
	_invalidatePlaybackSchedule() {
		if (!this.audio.playing) return;
		this.audio.cancelScheduledHitSounds();
		this.stage.cancelScheduledHits();
		this.scheduledHitIds.clear();
		this.scheduledHoldReleaseIds.clear();
		this.playbackScheduleInvalidated = true;
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
		this._normalizeGroupSelectionScope();
		this._invalidatePlaybackSchedule();
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
		this.groupSelectionScope = null;
		this.nextDifficultyId = 1;
		const knownFiles = charts.map(item => item.file).filter(Boolean);
		this.difficulties = charts.map(chart => {
			const model = chart.model instanceof ChartModel ? chart.model : ChartModel.import(chart.document);
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
	preview(label, mutation, options = {}) {
		if (this.model.editor.readOnly && !options.allowReadOnly) return;
		if (!this.previewBase) {
			this.previewBase = this.model.snapshot();
			this.previewLabel = label;
			this.previewScheduleDirty = false;
		}
		this.previewScheduleDirty ||= Boolean(options.scheduleDirty); if (!options.incremental) this.model.restore(this.previewBase);
		mutation(this.model);
		if (options.scheduleDirty) this._invalidatePlaybackSchedule();
		if (options.lightweight) this.refreshInteractionPreview({ rebuildIndex: options.rebuildIndex !== false });
		else this.refresh();
	}
	cancelPreview() {
		if (!this.previewBase) return;
		const scheduleDirty = this.previewScheduleDirty;
		this.model.restore(this.previewBase);
		this.previewBase = null;
		this.previewScheduleDirty = false;
		if (scheduleDirty) this._invalidatePlaybackSchedule();
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
		this.scrollView.setState(view);
		this._updateStatus();
		this.playbackFrameCount = (this.playbackFrameCount || 0) + 1;
	}
	_rebuildRenderIndex() {
		this.renderIndex = new ChartRenderIndex(this.model, this.timing(), {
			noteSpeed: this.preferences.noteSpeed,
			selectionScope: this.groupSelectionScope,
		});
		return this.renderIndex;
	}
	_normalizeGroupSelectionScope() {
		if (this.groupSelectionScope == null) return;
		const group = this.model.findEvent(this.groupSelectionScope);
		if (group?.type !== "group" || !this.model.groupDescendants(group.id).some(event => event.selected)) {
			this.groupSelectionScope = null;
		}
	}
	_syncAudioLoop() {
		const marks = Array.isArray(this.model.editor.abLoopMarks) ? this.model.editor.abLoopMarks : [];
		const seconds = marks.length === 2
			? marks.map(mark => this.timing().beatToSeconds(mark)).sort((left, right) => left - right)
			: null;
		this.audio.setLoopRange(seconds);
	}
	_refreshDifficultyUi() {
		const select = document.getElementById("difficulty-select");
		if (!select) return;
		const signature = JSON.stringify({
			language: i18n.language,
			active: this.activeDifficultyId,
			charts: this.difficulties.map(entry => ({
				id: entry.id,
				name: entry.model.metadata.difficultyName,
				difficulty: entry.model.metadata.difficulty,
				sup: entry.model.metadata.difficultySup,
			})),
		});
		if (signature !== this.difficultyUiSignature) {
			select.replaceChildren(...this.difficulties.map(entry => {
				const option = document.createElement("option");
				const metadata = entry.model.metadata;
				const level = `${metadata.difficulty || ""}${metadata.difficultySup || ""}`.trim();
				option.value = entry.id;
				option.textContent = `${metadata.difficultyName}${level ? ` ${level}` : ""}`;
				option.style.color = String(metadata.difficultyColor || "#7f7f7f");
				return option;
			}));
			select.value = this.activeDifficultyId;
			this.difficultyUiSignature = signature;
		}
		const active = this.activeDifficultyState();
		select.style.color = String(active?.model.metadata.difficultyColor || "#7f7f7f");
		const labelLength = select.selectedOptions[0]?.textContent?.length || 12;
		select.style.width = `${Math.min(30, Math.max(12, labelLength + 3))}ch`;
		select.title = i18n.t("difficulty.select");
		select.setAttribute("aria-label", i18n.t("difficulty.select"));
		const blocked = this.audio.playing || Boolean(this.freeTransform);
		select.disabled = blocked;
	}
	refreshNow() {
		const reschedulePlayback = this.playbackScheduleInvalidated;
		this.playbackScheduleInvalidated = false;
		this._rebuildRenderIndex();
		this._syncAudioLoop();
		const view = this.viewState();
		const timelineHeight = 88 + Math.min(3, Math.max(1, this.model.channels.length)) * 48;
		document.querySelector(".workspace")?.style.setProperty("--timeline-height", `${timelineHeight}px`);
		this.timeline.setState(view);
		this.stage.setState(view);
		this.scrollView.setState(view);
		if (reschedulePlayback && this.audio.playing) this._scheduleHits(this.audio.currentTime, 0);
		this._updateStatus();
		this.inspectorPanel.render(this.model, { transform: this.freeTransform?.matrix || null });
		this.snappeesPanel.render(this.model, { readOnly: this.model.editor.readOnly });
		this.channelsPanel.render(this.model, { readOnly: this.model.editor.readOnly });
		this.clipsPanel.render(this.model, { readOnly: this.model.editor.readOnly });
		this.historyPanel.render(this.history, { readOnly: this.model.editor.readOnly });
		this._refreshDifficultyUi();
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
		for (const [id, property] of [["lock-visible-range", "lockVisibleRange"], ["play-se", "playSe"],
			["seek-back-after-playing", "seekBackAfterPlaying"], ["metronome", "metronome"],
			["show-grouping-in-timeline", "showGroupingInTimeline"], ["show-grouping-in-main-field", "showGroupingInMainField"],
			["show-tip-points", "showTipPoints"], ["show-bg-events-in-timeline", "showBgEventsInTimeline"],
			["show-bg-events-in-main-field", "showBgEventsInMainField"], ["allow-out-of-bound", "allowOutOfBound"], ["read-only", "readOnly"]]) {
			const control = document.getElementById(id);
			if (control) control.checked = Boolean(this.model.editor[property]);
		}
		this._syncFullscreenState();
		const resetView = document.getElementById("reset-main-field-view");
		if (resetView) resetView.hidden = Math.abs(Number(this.model.editor.mainFieldPanX) || 0) < 1e-9
			&& Math.abs(Number(this.model.editor.mainFieldPanY) || 0) < 1e-9
			&& Math.abs((Number(this.model.editor.mainFieldZoom) || 1) - 1) < 1e-9;
		const comments = this.renderIndex?.activeComments(seconds) || this.model.allEvents().filter(event => {
			if (event.type !== "comment") return false;
			const start = this.timing().beatToSeconds(event.time);
			const end = this.timing().beatToSeconds(Rational.from(event.time).add(event.duration || 0));
			return start <= seconds && end > seconds;
		});
		const commentsElement = document.getElementById("status-comments");
		const commentsSignature = JSON.stringify(comments.map(event => [event.id, event.text, Boolean(event.selected)]));
		if (commentsElement && commentsElement.dataset.signature !== commentsSignature) {
			commentsElement.dataset.signature = commentsSignature;
			commentsElement.replaceChildren(...comments.map(event => {
				const item = document.createElement("div");
				item.className = `status-comment${event.selected ? " is-selected" : ""}`;
				item.textContent = String(event.text || "");
				return item;
			}));
		}
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
	requestStatusUpdate() {
		if (this.statusUpdateFrame) return;
		this.statusUpdateFrame = requestAnimationFrame(() => {
			this.statusUpdateFrame = 0;
			this._updateStatus();
		});
	}
	_syncCheckedCommands() {
		for (const type of ["tap", "hold", "drag", "flick", "bgNote"]) {
			this.registry.setChecked(`events.${type}`, this.creationMode === type);
		}
		for (const [id, mode] of [["snappee.bezierCurve", "bezierCurve"], ["snappee.circularArc", "circularArcCurve"], ["snappee.pen", "penCurve"]]) {
			this.registry.setChecked(id, this.curveDraft?.type === mode);
		}
		this.registry.setChecked("transform.free", Boolean(this.freeTransform));
		this.registry.setChecked("music.playPause", this.audio.playing && this.audio.direction > 0);
		this.registry.setChecked("music.playReverse", this.audio.playing && this.audio.direction < 0);
		for (const value of [1, 2, 3, 4, 6, 8]) this.registry.setChecked(`music.subdivision${value}`, this.model.editor.subdivision === value);
		for (const [id, value] of [["music.speed025", 0.25], ["music.speed05", 0.5], ["music.speed1", 1]]) {
			this.registry.setChecked(id, Math.abs(this.model.editor.speed - value) < 1e-8);
		}
	}
	_bindTabs() {
		const tabs = ["inspector", "channels", "snappees", "clips"].map(id => ({
			id,
			tab: document.getElementById(`${id}-tab`),
			panel: document.getElementById(`${id}-panel`),
		}));
		const setTab = activeId => {
			for (const item of tabs) {
				const active = item.id === activeId;
				item.tab.classList.toggle("is-active", active);
				item.tab.setAttribute("aria-selected", String(active));
				item.panel.hidden = !active;
			}
		};
		for (const item of tabs) item.tab.addEventListener("click", () => setTab(item.id));
	}
	_bindInputs() {
		document.getElementById("open-file-input").addEventListener("change", event => void this.openFile(event.target.files[0]).finally(() => { event.target.value = ""; }));
		document.getElementById("chart-file-input").addEventListener("change", event => void this.openFile(event.target.files[0]).finally(() => { event.target.value = ""; }));
		document.getElementById("music-file-input").addEventListener("change", event => void this.loadMusic(event.target.files[0]).finally(() => { event.target.value = ""; }));
		document.getElementById("background-file-input").addEventListener("change", event => void this.loadBackground(event.target.files[0]).finally(() => { event.target.value = ""; }));
		document.getElementById("difficulty-select")?.addEventListener("change", event => void this.switchDifficulty(event.target.value));
		document.getElementById("difficulty-add")?.addEventListener("click", () => void this.newDifficulty());
		document.getElementById("difficulty-delete")?.addEventListener("click", () => void this.deleteDifficulty());
		for (const id of ["lock-visible-range", "play-se", "seek-back-after-playing", "metronome", "show-grouping-in-timeline", "show-grouping-in-main-field", "show-tip-points", "show-bg-events-in-timeline", "show-bg-events-in-main-field", "allow-out-of-bound"]) {
			document.getElementById(id)?.addEventListener("change", event => {
				if (id === "allow-out-of-bound") {
					const checked = Boolean(event.target.checked);
					this.commit(i18n.t("history.allowOutOfBounds"), model => {
						model.editor.allowOutOfBound = checked;
					});
					return;
				}
				this.model.editor[id === "lock-visible-range" ? "lockVisibleRange"
					: id === "play-se" ? "playSe"
					: id === "seek-back-after-playing" ? "seekBackAfterPlaying"
					: id === "show-grouping-in-timeline" ? "showGroupingInTimeline"
					: id === "show-grouping-in-main-field" ? "showGroupingInMainField"
					: id === "show-tip-points" ? "showTipPoints"
					: id === "show-bg-events-in-timeline" ? "showBgEventsInTimeline"
					: id === "show-bg-events-in-main-field" ? "showBgEventsInMainField"
					: "metronome"] = Boolean(event.target.checked);
				this.refresh();
			});
		}
		document.getElementById("read-only")?.addEventListener("change", event => this.setReadOnly(event.target.checked));
		document.getElementById("fullscreen")?.addEventListener("change", event => void this.setFullscreen(event.target.checked));
		document.getElementById("live-hosting")?.addEventListener("change", event => void this.setLiveHosting(event.target.checked));
		document.getElementById("reset-main-field-view")?.addEventListener("click", () => this.resetMainFieldView?.());
	}
	_bindAudio() {
		this.audio.addEventListener("timeupdate", event => {
			if (!this.audio.playing) return;
			const time = event.detail;
			this.model.editor.timeSnapped = false;
			this.model.editor.currentTime = time;
			const editor = this.model.editor;
			const span = editor.visibleRangeEnd - editor.visibleRangeBeginning;
			const center = editor.visibleRangeBeginning + span / 2;
			if (!editor.lockVisibleRange) {
				if (this.playFollowOffset === null) {
					if (this.audio.direction > 0 && time >= center && time <= editor.visibleRangeEnd) {
						this.playFollowOffset = { direction: 1, value: time - editor.visibleRangeBeginning };
					} else if (this.audio.direction < 0 && time <= center && time >= editor.visibleRangeBeginning) {
						this.playFollowOffset = { direction: -1, value: editor.visibleRangeEnd - time };
					}
				}
				if (this.playFollowOffset && typeof this.playFollowOffset === "object") {
					const bounds = this.timeBounds();
					const requested = this.playFollowOffset.direction > 0
						? time - this.playFollowOffset.value : time + this.playFollowOffset.value - span;
					const beginning = Math.max(bounds[0], Math.min(bounds[1] - span, requested));
					editor.visibleRangeBeginning = beginning;
					editor.visibleRangeEnd = beginning + span;
					if (Math.abs(beginning - requested) > 1e-8) this.playFollowOffset = false;
				}
			}
			this._scheduleHits(time);
			this.lastPlaybackTime = time;
			this.refreshPlaybackFrame();
		});
		this.audio.addEventListener("play", () => {
			this.playbackScheduleInvalidated = false;
			this._rebuildRenderIndex();
			this._syncAudioLoop();
			const time = this.currentSeconds();
			const editor = this.model.editor;
			const center = (editor.visibleRangeBeginning + editor.visibleRangeEnd) / 2;
			this.playFollowOffset = editor.lockVisibleRange ? false
				: this.audio.direction > 0
					? time > editor.visibleRangeEnd ? false : time >= center && time >= editor.visibleRangeBeginning
						? { direction: 1, value: time - editor.visibleRangeBeginning } : null
					: time < editor.visibleRangeBeginning ? false : time <= center && time <= editor.visibleRangeEnd
						? { direction: -1, value: editor.visibleRangeEnd - time } : null;
			this.lastPlaybackTime = time;
			this.playbackOrigin ||= {
				time,
				editorTime: deepClone(editor.currentTime),
				timeSnapped: editor.timeSnapped,
				visibleRangeBeginning: editor.visibleRangeBeginning,
				visibleRangeEnd: editor.visibleRangeEnd,
			};
			this.scheduledHitIds.clear();
			this.scheduledHoldReleaseIds.clear();
			this.scheduledMetronomeBeats.clear();
			this._scheduleHits(time);
			this._syncCheckedCommands(); this._refreshDifficultyUi(); this.refreshPlaybackFrame();
		});
		this.audio.addEventListener("directionchange", () => {
			this.stage.cancelScheduledHits();
			this.playFollowOffset = null;
			this.scheduledHitIds.clear();
			this.scheduledHoldReleaseIds.clear();
			this.scheduledMetronomeBeats.clear();
			this._scheduleHits(this.audio.currentTime, 0);
			this.refresh();
		});
		this.audio.addEventListener("loop", event => {
			this.audio.cancelScheduledHitSounds();
			this.stage.cancelScheduledHits();
			this.scheduledHitIds.clear();
			this.scheduledHoldReleaseIds.clear();
			this.scheduledMetronomeBeats.clear();
			const time = Number(event.detail?.time);
			if (!this.model.editor.lockVisibleRange && Number.isFinite(time)
				&& Number.isFinite(this.lastPlaybackTime)
				&& this.lastPlaybackTime >= this.model.editor.visibleRangeBeginning
				&& this.lastPlaybackTime <= this.model.editor.visibleRangeEnd
				&& (time < this.model.editor.visibleRangeBeginning || time > this.model.editor.visibleRangeEnd)) {
				const span = this.model.editor.visibleRangeEnd - this.model.editor.visibleRangeBeginning;
				this.setVisibleRange(time - (time < this.model.editor.visibleRangeBeginning ? 0 : span),
					time < this.model.editor.visibleRangeBeginning ? time + span : time);
			}
		});
		const finish = () => {
			this.playbackScheduleInvalidated = false;
			this.stage.cancelScheduledHits();
			if (this.resumePlaybackAfterSeek) {
				this.model.editor.timeSnapped = false;
				this.model.editor.currentTime = this.audio.currentTime;
			} else if (this.model.editor.seekBackAfterPlaying && this.playbackOrigin) {
				this.model.editor.timeSnapped = this.playbackOrigin.timeSnapped;
				this.model.editor.currentTime = deepClone(this.playbackOrigin.editorTime);
				if (!this.model.editor.lockVisibleRange) {
					this.model.editor.visibleRangeBeginning = this.playbackOrigin.visibleRangeBeginning;
					this.model.editor.visibleRangeEnd = this.playbackOrigin.visibleRangeEnd;
				}
			} else {
				const snapped = this.timing().secondsToSnappedBeat(this.audio.currentTime, this.model.editor.subdivision);
				this.model.editor.timeSnapped = true;
				this.model.editor.currentTime = snapped.toJSON();
			}
			this.playFollowOffset = null;
			this.lastPlaybackTime = null;
			if (!this.resumePlaybackAfterSeek) this.playbackOrigin = null;
			this.scheduledHitIds.clear();
			this.scheduledHoldReleaseIds.clear();
			this.scheduledMetronomeBeats.clear();
			this.refresh();
		};
		this.audio.addEventListener("pause", finish);
		this.audio.addEventListener("ended", finish);
		this.audio.addEventListener("seek", () => {
			this.stage.cancelScheduledHits();
			this.scheduledHitIds.clear();
			this.scheduledHoldReleaseIds.clear();
			this.scheduledMetronomeBeats.clear();
		});
		this.audio.addEventListener("ratechange", () => {
			this.stage.cancelScheduledHits();
			this.scheduledHitIds.clear();
			this.scheduledHoldReleaseIds.clear();
			this.scheduledMetronomeBeats.clear();
		});
	}
	_scheduleHits(current, lateTolerance = 0.02) {
		if (this.playbackScheduleInvalidated && lateTolerance !== 0) return;
		const reverse = this.audio.direction < 0;
		const playbackEditor = this.model?.editor || {};
		const loopRange = this.audio.loopRange;
		const loopBoundary = loopRange ? loopRange[reverse ? 0 : 1] : reverse ? -Infinity : Infinity;
		const schedule = reverse
			? this.renderIndex
				? collectIndexedReverseHitSchedule(this.renderIndex.hitRecords, current, this.audio.rate,
					this.scheduledHitIds, undefined, lateTolerance, loopBoundary)
				: collectReverseHitSchedule(this.model.allEvents({ includeGroups: false }), this.timing(), current, this.audio.rate,
					this.scheduledHitIds, undefined, lateTolerance, loopBoundary)
			: this.renderIndex
				? collectIndexedHitSchedule(this.renderIndex.hitRecords, current, this.audio.rate,
					this.scheduledHitIds, undefined, lateTolerance, loopBoundary)
				: collectHitSchedule(this.model.allEvents({ includeGroups: false }), this.timing(), current, this.audio.rate,
					this.scheduledHitIds, undefined, lateTolerance, loopBoundary);
		for (const { event, delay } of schedule) {
			this.scheduledHitIds.add(event.id);
			if (playbackEditor.playSe !== false) void this.audio.playHit(event.type, delay);
			if (!reverse) this.stage.triggerHit(event, delay);
		}
		const releases = reverse ? [] : this.renderIndex
			? collectIndexedHoldReleaseSchedule(this.renderIndex.holdReleaseRecords,
				current, this.audio.rate, this.scheduledHoldReleaseIds, undefined, lateTolerance, loopBoundary)
			: collectHoldReleaseSchedule(this.model.allEvents({ includeGroups: false }), this.timing(), current,
				this.audio.rate, this.scheduledHoldReleaseIds, undefined, lateTolerance, loopBoundary);
		for (const { event, delay } of releases) {
			this.scheduledHoldReleaseIds.add(event.id);
			this.stage.triggerHit(event, delay);
		}
		if (playbackEditor.metronome && this.scheduledMetronomeBeats) {
			const metronomes = collectMetronomeSchedule(this.timing(), current, this.audio.rate,
				this.audio.direction, this.scheduledMetronomeBeats, undefined, loopRange);
			for (const item of metronomes) {
				this.scheduledMetronomeBeats.add(item.beat);
				void this.audio.playMetronome(item.delay);
			}
		}
	}
	_bindLayoutToggles() {
		const row = document.querySelector(".editor-row");
		const workspace = document.querySelector(".workspace");
		const scrollButton = document.getElementById("scroll-view-toggle");
		const sideButton = document.getElementById("side-panel-toggle");
		const timelineButton = document.getElementById("timeline-toggle");
		bindEdgeToggleReveal(document.getElementById("stage-surface"));
		const update = () => {
			const scrollHidden = row?.classList.contains("is-scroll-hidden");
			const sideHidden = row?.classList.contains("is-side-hidden");
			const timelineHidden = workspace?.classList.contains("is-timeline-hidden");
			if (scrollButton) {
				scrollButton.textContent = scrollHidden ? "›" : "‹";
				scrollButton.title = i18n.t(scrollHidden ? "layout.showScrollView" : "layout.hideScrollView");
				scrollButton.setAttribute("aria-label", scrollButton.title);
			}
			if (sideButton) {
				sideButton.textContent = sideHidden ? "‹" : "›";
				sideButton.title = i18n.t(sideHidden ? "layout.showSidePanel" : "layout.hideSidePanel");
				sideButton.setAttribute("aria-label", sideButton.title);
			}
			if (timelineButton) {
				timelineButton.textContent = timelineHidden ? "▼" : "▲";
				timelineButton.title = i18n.t(timelineHidden ? "layout.showTimeline" : "layout.hideTimeline");
				timelineButton.setAttribute("aria-label", timelineButton.title);
			}
		};
		scrollButton?.addEventListener("click", () => { row?.classList.toggle("is-scroll-hidden"); update(); });
		sideButton?.addEventListener("click", () => { row?.classList.toggle("is-side-hidden"); update(); });
		timelineButton?.addEventListener("click", () => { workspace?.classList.toggle("is-timeline-hidden"); update(); });
		update();
	}
	_bindGlobalInteraction() {
		const licenseLink = document.querySelector(".javascript-license-link");
		licenseLink?.addEventListener("click", event => {
			event.preventDefault();
			this.help.openLicenseInformation();
		});
		document.addEventListener("keydown", event => {
			if (event.key === "F11") {
				event.preventDefault();
				void this.setFullscreen(!this._isFullscreen());
			} else if (event.key === "Escape") {
				if (globalThis.nw && this._isFullscreen()) event.preventDefault();
				if (!this.dialogs.active) {
					if (this.freeTransform) event.preventDefault();
					this.exitModes();
					for (const snappee of this.model.snappees) snappee.selected = false;
					this.refresh();
				}
			} else if (event.key === "Enter" && this.freeTransform && !this.dialogs.active) {
				if (isEditableTarget(event.target)) return;
				event.preventDefault();
				this.finishFreeTransform();
			} else if (event.key === "Enter" && this.curveDraft && !this.dialogs.active) {
				event.preventDefault();
				this.finishCurveDraft();
			}
		});
		document.addEventListener("fullscreenchange", this.boundFullscreenChange);
		try {
			const windowObject = globalThis.nw?.Window?.get?.();
			windowObject?.on?.("enter-fullscreen", this.boundFullscreenChange);
			windowObject?.on?.("leave-fullscreen", this.boundFullscreenChange);
		} catch { /* NW.js is optional in the browser. */ }
		this._syncFullscreenState();
		this.boundSpaceKeyUp = event => {
			if (event.key !== " " && event.code !== "Space") return;
			if (this.spacePlaybackStartedAt == null) return;
			const held = performance.now() - this.spacePlaybackStartedAt;
			const command = this.spacePlaybackCommand;
			this.spacePlaybackStartedAt = null;
			this.spacePlaybackCommand = null;
			if (held < 300 || !this.audio.playing || this.dialogs.active) return;
			event.preventDefault();
			void this.registry.execute(command || "music.playPause", this, event);
		};
		document.addEventListener("keyup", this.boundSpaceKeyUp, true);
		document.addEventListener("wheel", event => {
			if (event.defaultPrevented) return;
			if (event.ctrlKey && event.shiftKey) { event.preventDefault(); this.setMainFieldZoom?.(event.deltaY < 0 ? 1.12 : 1 / 1.12); return; }
			if (this.dialogs.active
				|| event.target.closest(".property-panel,.history-list,.status-panel,.menu-popup,.dialog-body,.tool-bar,select,textarea")) return;
			event.preventDefault();
			this.navigateWheel(event.deltaY, event.ctrlKey, event.ctrlKey);
		}, { passive: false });
		window.addEventListener("beforeunload", event => {
			if (!this.dirty) return;
			event.preventDefault();
			event.returnValue = "";
		});
		i18n.subscribe(() => this.refresh());
	}
	openMacros() {
		const urlObject = new URL("macros.html", location.href);
		urlObject.searchParams.set("lang", i18n.language);
		const url = urlObject.href;
		if (this.macroWindow && !this.macroWindow.closed) {
			this.macroWindow.focus();
			return;
		}
		this.macroWindow = window.open(url, "sviber-macros", "popup,width=1180,height=820");
		if (!this.macroWindow && globalThis.nw?.Window?.open) {
			globalThis.nw.Window.open(url, {
				title: "sviber Macros", width: 1180, height: 820, min_width: 760, min_height: 520,
			}, popup => { this.macroWindow = popup?.window || null; });
		}
	}
	async _offerAutosave() {
		const recoveries = this.autosave.recoverable();
		if (!recoveries.length) return false;
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
			const recovery = recoveries.find(entry => String(entry.timestamp) === String(values.recovery)) || recoveries[0]; await this.clearRuntimeMedia(); this.files.restoreLocalSourceContext(recovery.source);
			this.installProject([{
				id: "difficulty-0",
				file: recovery.source?.chartFilename || uniqueChartFilename(recovery.model.metadata.difficultyName),
				model: recovery.model,
			}], { activeChart: "difficulty-0", name: recovery.source?.projectName || recovery.model.metadata.title, saved: false });
			if (this.files.supportsLocalPaths) await this.syncMediaFromModel();
			return true;
		} else { this.autosave.markManualSave(); return false; }
	}
	exitModes() {
		this.creationMode = null;
		this.curveDraft = null;
		this.cancelSelectionPreview?.();
		this.cancelFreeTransform();
		this.cancelPreview();
	}
	destroy() {
		this.detachKeyboard?.();
		this.autosave.stop();
		this.timeline.destroy();
		this.stage.destroy();
		this.scrollView.destroy();
		this.audio.destroy();
		this.menu.destroy();
		this.toolbar.destroy();
		this.tooltip.destroy();
		this.unsubscribeCommandModes?.();
		document.removeEventListener("keyup", this.boundSpaceKeyUp, true);
		document.removeEventListener("fullscreenchange", this.boundFullscreenChange);
		window.removeEventListener("message", this.macroMessageHandler);
		cancelAnimationFrame(this.statusUpdateFrame);
	}
}
