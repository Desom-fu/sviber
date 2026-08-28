// The editor shell: construction of the model, services, views and panels, the
// commit/preview/refresh cycle, and the read-only and macro-window plumbing.
//
// Concerns that used to live here were split into mixins that this module composes into
// `SviberAppCore`, so every existing importer of `SviberAppCore` is unaffected:
//
//   app-difficulty-state.js    difficulty entries and the difficulty switcher
//   app-project-state.js       project metadata and media shared across difficulties
//   app-dirty-tracking.js      saved signatures and the dirty flags
//   app-playback-transport.js  audio clock/lifecycle listeners and hit scheduling
//   app-status-view.js         status bar rendering and checked-command syncing
//   app-fullscreen.js          fullscreen state across the DOM and NW.js APIs
//   app-status-bindings.js     status toggle and file input listeners
//   app-shell-bindings.js      panel tabs and layout collapse toggles
//   app-global-shortcuts.js    document-level keys, wheel navigation, unload guard

import { i18n } from "../ui/i18n.js";
import { CommandRegistry } from "./commands.js";
import { DialogManager, MenuBar, ToastManager, Toolbar, TooltipManager } from "../ui/ui.js";
import { ChartModel } from "../core/chart-model.js";
import { uniqueChartFilename } from "../core/project.js";
import { History } from "../core/history.js";
import { Rational } from "../core/rational.js";
import { TimingMap } from "../core/timing.js";
import { AudioPlayer } from "../audio/player.js";
import { TimelineView } from "../render/timeline.js";
import { StageView } from "../render/stage.js";
import { ScrollView } from "../render/scroll-view.js";
import { ChartRenderIndex } from "../render/chart-index.js";
import { HelpController } from "../ui/help.js";
import { AutosaveManager, FileManager } from "../platform/platform.js";
import { ChannelsPanel, ClipsPanel, HistoryPanel, InspectorPanel, SnappeesPanel } from "../ui/panels.js";
import { ChecksPanel } from "../ui/checks-panel.js";
import { loadPreferences, resolvePreferenceLanguage, applyThemePreference, selected } from "./app-helpers.js";
import { handleMacroMessage } from "./app-macro-bridge.js";
import { LiveHosting } from "../platform/live-hosting.js";
import { withDifficultyState } from "./app-difficulty-state.js";
import { withProjectState } from "./app-project-state.js";
import { withDirtyTracking } from "./app-dirty-tracking.js";
import { withPlaybackTransport } from "./app-playback-transport.js";
import { withStatusView } from "./app-status-view.js";
import { withFullscreen } from "./app-fullscreen.js";
import { withStatusBindings } from "./app-status-bindings.js";
import { withShellBindings } from "./app-shell-bindings.js";
import { withGlobalShortcuts } from "./app-global-shortcuts.js";

// Commands that are allowed to run without cancelling an active creation tool: transport,
// channel switching, undo/redo and the creation tools themselves.
const CREATION_MODE_SAFE_COMMANDS = Object.freeze(
	new Set(["events.tap", "events.hold", "events.drag", "events.flick", "events.bgNote"]),
);

function keepsCreationMode(id) {
	return (
		id.startsWith("music.") ||
		id.startsWith("channel.select") ||
		CREATION_MODE_SAFE_COMMANDS.has(id) ||
		id === "edit.undo" ||
		id === "edit.redo"
	);
}

const CoreState = withDirtyTracking(withProjectState(withDifficultyState(class {})));
const CoreShell = withGlobalShortcuts(
	withShellBindings(withStatusBindings(withFullscreen(withStatusView(withPlaybackTransport(CoreState))))),
);

export class SviberAppCore extends CoreShell {
	constructor() {
		super();
		this._initPreferences();
		this._initDocumentState();
		this._initPlaybackState();
		this._initServices();
		this._initUiServices();
		this._initViews();
		this._initPanels();
		this._initProjectState();
	}

	_initPreferences() {
		this.preferences = loadPreferences();
		applyThemePreference(this.preferences.theme);
		i18n.setLanguage(resolvePreferenceLanguage(this.preferences.language));
	}

	_initDocumentState() {
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
	}

	_initPlaybackState() {
		this.scheduledHitIds = new Set();
		this.scheduledBgNoteIds = new Set();
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
	}

	_initServices() {
		this.audio = new AudioPlayer();
		this.audio.setSeVolume(this.preferences.seVolume);
		this.audio.setMusicVolume(this.preferences.musicVolume);
		this.autosave = new AutosaveManager();
		this.macroWindow = null;
		this.macroMessageHandler = event => void handleMacroMessage(this, event);
		this.fullscreen = false;
		this.liveHosting = new LiveHosting({
			address: this.preferences.liveHostingAddress,
			reloadPort: this.preferences.liveReloadPort,
			getLevel: () => this.hostedLevel(),
			onMessage: (data, client) => {
				if (data.type === "connect") {
					client.sscharter = true;
					this.toast?.show("toast.liveHostingClientConnected", { address: client.address || "unknown" });
				}
			},
			onClientClose: client => {
				if (client.sscharter) {
					this.toast?.show("toast.liveHostingClientDisconnected", { address: client.address || "unknown" });
				}
			},
			onError: error =>
				this.toast?.error("toast.liveHostingFailed", { message: String(error?.message || error) }),
			onStop: () => {
				this.toast?.show("toast.liveHostingStopped");
				this.refresh?.();
			},
		});
		this.boundFullscreenChange = () => this._syncFullscreenState();
	}

	_initUiServices() {
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
		this.toolbar = new Toolbar({
			registry: this.registry,
			i18n,
			tooltip: this.tooltip,
			contextProvider: () => this,
		});
		this.unsubscribeCommandModes = this.registry.subscribe(change => {
			if (change.type !== "execute" || change.phase !== "before") {
				return;
			}
			if (keepsCreationMode(change.id)) {
				return;
			}
			this.exitCreationModes();
		});
	}

	_initViews() {
		this.timeline = new TimelineView(document.getElementById("timeline-surface"), this._timelineCallbacks());
		this.stage = new StageView(document.getElementById("stage-surface"), this._stageCallbacks());
		this.scrollView = new ScrollView(document.getElementById("scroll-surface"), {
			onSelectEvents: (ids, mode) => this.selectEvents(ids, mode),
			onPreviewBoxSelect: (ids, mode) => this.previewSelection(ids, mode),
			onBoxSelect: (ids, mode) => this.finishSelectionPreview(ids, mode),
			onEndPreview: () => this.endInteractionPreview(),
			onScrollPan: (seconds, final, drag) => this.panScrollView?.(seconds, final, drag),
			getTimelineWidth: () => this.timeline.surface.width,
		});
	}

	_initPanels() {
		this.inspectorPanel = new InspectorPanel({
			i18n,
			tooltip: this.tooltip,
			onChange: (property, value) => this.editSelectedProperty(property, value),
			onTransformChange: (index, value) => this._editTransformElement(index, value),
		});
		this.snappeesPanel = new SnappeesPanel({
			i18n,
			tooltip: this.tooltip,
			onSelect: id => this.selectSnappee(id),
			onToggle: id => this.toggleSnappee(id),
			onDuplicate: id => this.duplicateSnappee(id),
			onDelete: id => void this.deleteSnappee(id),
			onEdit: id => void this.editSnappee(id),
			onMove: (id, direction) => this.moveSnappeeInList(id, direction),
		});
		this.channelsPanel = new ChannelsPanel({
			i18n,
			tooltip: this.tooltip,
			onSelect: id => this.selectChannel(id),
			onToggle: id => this.toggleChannel(id),
			onDuplicate: id => this.duplicateChannel(id),
			onDelete: id => void this.deleteChannel(id),
			onEdit: id => void this.editChannel(id),
			onMove: (id, direction) => this.moveChannel(id, direction),
		});
		this.historyPanel = new HistoryPanel({ i18n, tooltip: this.tooltip, onGoTo: index => this.goToHistory(index) });
		this.checksPanel = new ChecksPanel({
			i18n,
			tooltip: this.tooltip,
			onActivate: violation => void this.activateCheckViolation(violation),
			onConfigure: violation => void this.configureCheckViolation(violation),
		});
		this.checkViolations = [];
		this.checksSignature = null;
		this.offsetAdjustment = false;
		this.timeDragging = false;
		this.scrollViewDragging = false;
		this.clipsPanel = new ClipsPanel({
			i18n,
			tooltip: this.tooltip,
			onPaste: index => void this.pasteClip(index),
			onMove: (index, direction) => this.moveClip(index, direction),
			onEdit: index => void this.editClip(index),
			onDelete: index => void this.deleteClip(index),
		});
	}

	// A single matrix element edited in the inspector previews immediately; the returned
	// value lets the field snap back to whatever the clamped transform accepted.
	_editTransformElement(index, value) {
		if (!this.freeTransform) {
			return undefined;
		}
		const matrix = [...this.freeTransform.matrix];
		matrix[index] = value;
		this.previewFreeTransform(matrix);
		return this.freeTransform?.matrix?.[index];
	}

	_initProjectState() {
		this.savedSignature = this.modelSignature();
		this.nextDifficultyId = 1;
		this.activeDifficultyId = "difficulty-0";
		this.projectName = this.model.metadata.title;
		this.editingProject = false;
		this.projectTitle = this.model.metadata.title;
		this.projectArtist = this.model.metadata.artist;
		this.projectMusic = String(this.model.music || "");
		this.projectImage = String(this.model.image || "");
		this.projectDirty = false;
		this.difficulties = [
			{
				id: this.activeDifficultyId,
				file: uniqueChartFilename(this.model.metadata.difficultyName),
				model: this.model,
				history: this.history,
				savedSignature: this.savedSignature,
			},
		];
		this.difficultyUiSignature = "";
	}

	async initialize() {
		await i18n.ready;
		i18n.apply(document);
		const difficultySwitcher = document.querySelector(".difficulty-switcher");
		if (difficultySwitcher) {
			difficultySwitcher.hidden = true;
		}
		this.tooltip.bind(document);
		this._bindTabs();
		this._bindChecksTabs?.();
		this._registerCommands();
		this.detachKeyboard = this.registry.attachKeyboard(document, () => this);
		this._bindInputs();
		this._bindAudio();
		this._bindGlobalInteraction();
		this._bindLayoutToggles();
		window.addEventListener("message", this.macroMessageHandler);
		await Promise.all([this.timeline.surface.ready, this.stage.surface.ready, this.scrollView.surface.ready]);
		this.refreshNow();
		document.getElementById("app").setAttribute("aria-busy", "false");
		document.getElementById("loading-screen").hidden = true;
		const autosaveOffered = await this._offerAutosave();
		if (!autosaveOffered && !(await this.openArgvPath?.())) {
			await this.reopenLastDocument?.();
		}
		this.refreshNow();
		this.startAutosave();
		if ("serviceWorker" in navigator && location.protocol.startsWith("http") && !globalThis.nw) {
			navigator.serviceWorker
				.register("service-worker.js")
				.catch(error => console.warn("Service worker registration failed", error));
		}
	}

	readOnlyCommandAllowed(id) {
		if (id !== "edit.delete" && id !== "edit.cut") {
			return false;
		}
		const events = selected(this.model);
		return events.length > 0 && events.every(event => event.type === "comment");
	}

	setReadOnly(value) {
		const next = Boolean(value);
		if (Boolean(this.model.editor.readOnly) === next) {
			return next;
		}
		if (next) {
			this.exitModes();
		}
		this.model.editor.readOnly = next;
		try {
			this.macroWindow?.postMessage({ type: "sviber-macro-read-only", readOnly: next }, "*");
		} catch {
			/* The macro popup may have closed. */
		}
		this.refreshReadOnlyUi?.(next);
		this.requestStatusUpdate();
		return next;
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
		const editor = this.model.editor;
		if (editor.timeSnapped === false) {
			return this.timing().secondsToBeat(editor.currentTime);
		}
		return Rational.from(editor.currentTime);
	}

	currentSeconds() {
		const editor = this.model.editor;
		if (editor.timeSnapped === false) {
			return Number(editor.currentTime);
		}
		return this.timing().beatToSeconds(editor.currentTime);
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
			if (DURATION_TYPES.has(event.type)) {
				beat = beat.add(event.duration || 0);
			}
			maximum = Math.max(maximum, this.timing().beatToSeconds(beat) + 10);
		}
		this.audio.syntheticEnd = maximum;
		return [minimum, maximum];
	}

	commit(label, mutation, options = {}) {
		if (this.model.editor.readOnly && !options.allowReadOnly) {
			return null;
		}
		this.cancelSelectionPreview?.();
		if (this.freeTransform) {
			this.finishFreeTransform();
		}
		let previewScheduleDirty = false;
		if (this.previewBase) {
			previewScheduleDirty = this.previewScheduleDirty;
			this.model.restore(this.previewBase);
			this.previewBase = null;
			this.previewScheduleDirty = false;
		}
		return this._finishCommit(label, mutation, options, previewScheduleDirty);
	}

	preview(label, mutation, options = {}) {
		if (this.model.editor.readOnly && !options.allowReadOnly) {
			return;
		}
		if (!this.previewBase) {
			this.previewBase = this.model.snapshot();
			this.previewLabel = label;
			this.previewScheduleDirty = false;
		}
		this.previewScheduleDirty ||= Boolean(options.scheduleDirty);
		if (!options.incremental) {
			this.model.restore(this.previewBase);
		}
		mutation(this.model);
		if (options.scheduleDirty) {
			this._invalidatePlaybackSchedule();
		}
		if (options.lightweight) {
			this.refreshInteractionPreview({
				rebuildIndex: options.positionOnly ? false : options.rebuildIndex !== false,
				positions: options.positionOnly,
				positionEvents:
					options.positionEvents || (options.positionOnly ? this.renderIndex?.selectedEvents : null),
				snappees: options.snappees,
				snappeeId: options.snappeeId,
				stageOnly: options.stageOnly,
			});
		} else {
			this.refresh();
		}
	}

	cancelPreview() {
		if (!this.previewBase) {
			return;
		}
		const scheduleDirty = this.previewScheduleDirty;
		this.model.restore(this.previewBase);
		this.previewBase = null;
		this.previewScheduleDirty = false;
		if (scheduleDirty) {
			this._invalidatePlaybackSchedule();
		}
		this.refresh();
	}

	refresh() {
		if (this.renderQueued) {
			return;
		}
		this.renderQueued = true;
		requestAnimationFrame(() => {
			this.renderQueued = false;
			this.refreshNow();
		});
	}

	_rebuildRenderIndex() {
		this.renderIndex = new ChartRenderIndex(this.model, this.timing(), {
			noteSpeed: this.preferences.noteSpeed,
			selectionScope: this.groupSelectionScope,
		});
		return this.renderIndex;
	}

	_normalizeGroupSelectionScope() {
		if (this.groupSelectionScope == null) {
			return;
		}
		const group = this.model.findEvent(this.groupSelectionScope);
		if (group?.type !== "group" || !this.model.groupDescendants(group.id).some(event => event.selected)) {
			this.groupSelectionScope = null;
		}
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
		if (reschedulePlayback && this.audio.playing) {
			this._scheduleHits(this.audio.currentTime, 0);
		}
		this._updateStatus();
		const readOnly = this.model.editor.readOnly;
		this.inspectorPanel.render(this.model, { transform: this.freeTransform?.matrix || null });
		this.snappeesPanel.render(this.model, { readOnly });
		this.channelsPanel.render(this.model, { readOnly });
		this.clipsPanel.render(this.model, { readOnly });
		this.historyPanel.render(this.history, { readOnly });
		this.refreshChecks?.();
		this._refreshDifficultyUi();
		this.registry.notifyAll();
		this._syncCheckedCommands();
		const metadata = this.model.metadata;
		document.title = `${this.dirty ? "* " : ""}${metadata.title} ${metadata.difficultyName} - sviber`;
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
			globalThis.nw.Window.open(
				url,
				{
					title: "sviber Macros",
					width: 1180,
					height: 820,
					min_width: 760,
					min_height: 520,
				},
				popup => {
					this.macroWindow = popup?.window || null;
				},
			);
		}
	}

	async _offerAutosave() {
		const recoveries = this.autosave.recoverable();
		if (!recoveries.length) {
			return false;
		}
		const values = await this.dialogs.form({
			titleKey: "dialog.autosave",
			messageKey: "dialog.autosaveMessage",
			values: { recovery: String(recoveries[0].timestamp) },
			fields: [
				{
					id: "recovery",
					type: "select",
					labelKey: "field.autosave",
					options: recoveries.map(entry => ({
						value: String(entry.timestamp),
						label: autosaveEntryLabel(entry),
					})),
				},
			],
			buttons: [
				{ id: "load", labelKey: "dialog.load", primary: true, submit: true },
				{ id: "discard", labelKey: "dialog.discard", cancel: true, value: null, validate: false },
			],
		});
		if (!values) {
			// Treat a deliberate rejection as handled so the same recovery is not offered
			// again on the next startup; the snapshot itself remains available in history.
			this.autosave.markManualSave();
			return false;
		}
		const recovery = recoveries.find(entry => String(entry.timestamp) === String(values.recovery)) || recoveries[0];
		await this.applyAutosaveRecovery(recovery);
		return true;
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

function autosaveEntryLabel(entry) {
	const title = entry.model.metadata.title || i18n.t("field.untitled");
	return `${new Date(entry.timestamp).toLocaleString()} - ${title}`;
}
