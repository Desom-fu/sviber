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

const MOVABLE_TYPES = new Set(["tap", "hold", "drag", "flick", "bgNote"]);
const DURATION_TYPES = new Set(["hold", "bgNote", "bigText", "grid", "hexagon", "checkerboard", "diamondGrid", "pentagon", "turntable", "hexagram"]);
const PATTERN_TYPES = new Set(["bigText", "grid", "hexagon", "checkerboard", "diamondGrid", "pentagon", "turntable", "hexagram"]);
const SNAPPEE_COLORS = ["#00e0ad", "#3086ff", "#ff9d3d", "#d567ff", "#ff2e59", "#50a226"];

function deepClone(value) {
	return structuredClone(value);
}

function formatTime(seconds) {
	const sign = seconds < 0 ? "-" : "";
	const absolute = Math.abs(seconds);
	const minutes = Math.floor(absolute / 60);
	return `${sign}${minutes}:${(absolute % 60).toFixed(3).padStart(6, "0")}`;
}

function formatBeat(value, subdivision) {
	const [whole, numerator, denominator] = Rational.from(value).snap(subdivision).toJSON();
	const expandedNumerator = numerator * (subdivision / denominator);
	return `${whole}${expandedNumerator < 0 ? "" : "+"}${expandedNumerator}/${subdivision}`;
}

function evaluateExpression(value, fallback = 0) {
	if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
	try {
		const result = globalThis.math?.evaluate?.(String(value));
		return Number.isFinite(Number(result)) ? Number(result) : fallback;
	} catch {
		const result = Number(value);
		return Number.isFinite(result) ? result : fallback;
	}
}

function selected(model) {
	return model.events.filter(event => event.selected);
}

function allowsOutOfBounds(model) {
	return Boolean(model.editor?.allowOutOfBounds);
}

function pointAllowed(model, point) {
	return allowsOutOfBounds(model) || isPointWithinChartBounds(point);
}

function attachedMoveAllowed(model, snappee, events, snapPoints) {
	if (allowsOutOfBounds(model)) return true;
	return events.every((event, index) => {
		const position = resolveAttachedPosition({ ...event, snappee: snappee.id, snapPoint: snapPoints[index] }, model.snappees);
		return position && isPointWithinChartBounds(position);
	});
}

function attachedNotesStayWithinBounds(model, snappeeId) {
	if (allowsOutOfBounds(model)) return true;
	return model.events.every(event => {
		if (!MOVABLE_TYPES.has(event.type) || !event.attached || event.snappee !== snappeeId) return true;
		try {
			const position = resolveAttachedPosition(event, model.snappees);
			return position && isPointWithinChartBounds(position);
		} catch {
			return false;
		}
	});
}

function mutateSnappeeWithinBounds(model, id, mutation) {
	const index = model.snappees.findIndex(item => item.id === id);
	if (index < 0) return false;
	const previous = deepClone(model.snappees[index]);
	const result = mutation(model.snappees[index]);
	if (result === false || !attachedNotesStayWithinBounds(model, id)) {
		model.snappees[index] = previous;
		return false;
	}
	return true;
}

function constrainPastedEvent(model, event) {
	if (!MOVABLE_TYPES.has(event.type)) return;
	let position = event;
	if (event.attached) {
		try { position = resolveAttachedPosition(event, model.snappees); } catch { position = null; }
		if (position && (allowsOutOfBounds(model) || isPointWithinChartBounds(position))) return;
	} else if (allowsOutOfBounds(model)) {
		return;
	}
	const bounded = clampPointToChartBounds(position || event);
	event.attached = false;
	event.x = bounded.x;
	event.y = bounded.y;
	delete event.snappee;
	delete event.snapPoint;
}

function difficultyColor(name, current) {
	return DIFFICULTY_COLORS[String(name).toLowerCase()] || current || DIFFICULTY_COLORS.normal;
}

function eventTypeLabel(type) {
	return i18n.t(`event.${type}`);
}

function localizedErrorMessage(error) {
	const message = String(error?.message || error || "");
	if (/Web Audio is not supported/i.test(message)) return i18n.t("error.webAudioUnsupported");
	if (/Unable to decode the selected audio file/i.test(message)) return i18n.t("error.audioDecode");
	if (/Unable to decode the selected image/i.test(message)) return i18n.t("error.imageDecode");
	if (/JSZip is unavailable/i.test(message)) return i18n.t("error.zipUnavailable");
	if (/does not contain a JSON chart/i.test(message)) return i18n.t("error.levelMissingChart");
	if (/selected chart was not found/i.test(message)) return i18n.t("error.levelChartMissing");
	if (/Project folders are unavailable/i.test(message)) return i18n.t("error.projectFoldersUnavailable");
	if (/sviber-project\.json|ENOENT|NotFoundError/i.test(message)) return i18n.t("error.projectManifestMissing");
	if (/must contain a music file/i.test(message)) return i18n.t("error.levelMusicRequired");
	if (/Sunniesnow field|Sunniesnow chart|Event \d+|exported chart|big text must/i.test(message)) {
		return i18n.t("error.strictChart", { message });
	}
	if (/Clipboard access is unavailable/i.test(message)) return i18n.t("error.clipboardUnavailable");
	if (error instanceof SyntaxError) return i18n.t("error.invalidJson");
	return i18n.t("error.unknown");
}

function localizedImportWarning(warning) {
	const message = String(warning);
	let match;
	if (message === "Chart filters are not editable in sviber and were omitted") return i18n.t("warning.filtersOmitted");
	if ((match = message.match(/^Ignored malformed event at index (\d+)$/))) return i18n.t("warning.malformedEvent", { index: match[1] });
	if ((match = message.match(/^Ignored unsupported event type (.+) at index (\d+)$/))) return i18n.t("warning.unsupportedEvent", { type: match[1], index: match[2] });
	if ((match = message.match(/^Only the first flick angle was imported at index (\d+)$/))) return i18n.t("warning.flickAngle", { index: match[1] });
	if ((match = message.match(/^The bgNote tip point was omitted at index (\d+)$/))) return i18n.t("warning.bgNoteTipPoint", { index: match[1] });
	if ((match = message.match(/^Visual-only data was omitted from event at index (\d+)$/))) return i18n.t("warning.visualData", { index: match[1] });
	if ((match = message.match(/^Tip point (.+) has no placeholder; default spawn settings were used$/))) return i18n.t("warning.missingPlaceholder", { id: match[1] });
	return i18n.t("warning.generic");
}

function metadataFields() {
	return [
		{ id: "title", type: "text", labelKey: "field.title", required: true },
		{ id: "artist", type: "text", labelKey: "field.artist", required: true },
		{ id: "charter", type: "text", labelKey: "field.charter", required: true },
		{ id: "difficultyName", type: "text", labelKey: "field.difficultyName", required: true },
		{ id: "difficultyColor", type: "color", labelKey: "field.difficultyColor", required: true },
		{ id: "difficulty", type: "text", labelKey: "field.difficulty", required: true },
		{ id: "difficultySup", type: "text", labelKey: "field.difficultySup" },
		{ id: "offset", type: "number", labelKey: "field.offset", step: "any" },
		{ id: "initialBpm", type: "number", labelKey: "field.initialBpm", min: 0.001, positive: true, step: "any" },
	];
}

function applyPresetDifficultyColor(values, dialogState) {
	const nameEntry = dialogState.entries.find(item => item.field.id === "difficultyName");
	if (!nameEntry?.control?.element?.contains?.(dialogState.event?.target)
		&& nameEntry?.control?.element !== dialogState.event?.target) return;
	const preset = DIFFICULTY_COLORS[String(values.difficultyName || "").toLowerCase()];
	if (!preset) return;
	const entry = dialogState.entries.find(item => item.field.id === "difficultyColor");
	const input = entry?.control?.element?.matches?.('input[type="color"]')
		? entry.control.element
		: entry?.control?.element?.querySelector?.('input[type="color"]');
	if (input && input.value !== preset) {
		input.value = preset;
		dialogState.refresh();
	}
}

export class SviberApp {
	constructor() {
		this.model = ChartModel.createDefault();
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

		this.timeline = new TimelineView(document.getElementById("timeline-surface"), this.#timelineCallbacks());
		this.stage = new StageView(document.getElementById("stage-surface"), this.#stageCallbacks());
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
		this.tooltip.bind(document);
		this.#bindTabs();
		this.#registerCommands();
		this.detachKeyboard = this.registry.attachKeyboard(document, () => this);
		this.#bindInputs();
		this.#bindAudio();
		this.#bindGlobalInteraction();
		await Promise.all([this.timeline.surface.ready, this.stage.surface.ready]);
		this.refreshNow();
		document.getElementById("app").setAttribute("aria-busy", "false");
		document.getElementById("loading-screen").hidden = true;
		await this.#offerAutosave();
		this.refreshNow();
		this.autosave.start(() => {
			if (this.modelSignature() === this.savedSignature) return;
			try {
				this.autosave.save(this.model);
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
		this.#reconcileStageMoveAttachmentException(selectionBefore);
		this.history.record(this.model.snapshot(), label);
		if (options.dirty !== false) this.updateDirty();
		this.refresh();
		return result;
	}

	modelSignature(model = this.model) {
		const snapshot = model.snapshot();
		const allowOutOfBounds = Boolean(snapshot.editor?.allowOutOfBounds);
		delete snapshot.editor;
		snapshot.editor = { allowOutOfBounds };
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

	#refreshDifficultyUi() {
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
		this.#updateStatus();
		this.inspectorPanel.render(this.model, { transform: this.freeTransform?.matrix || null });
		this.snappeesPanel.render(this.model);
		this.historyPanel.render(this.history);
		this.#refreshDifficultyUi();
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
		this.#syncCheckedCommands();
		document.title = `${this.dirty ? "* " : ""}${this.model.metadata.title} ${this.model.metadata.difficultyName} - sviber`;
	}

	#updateStatus() {
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

	#syncCheckedCommands() {
		for (const type of ["tap", "hold", "drag", "flick", "bgNote"]) {
			this.registry.setChecked(`events.${type}`, this.creationMode === type);
		}
		for (const [id, mode] of [["snappee.bezierCurve", "bezierCurve"], ["snappee.circularArc", "circularArcCurve"], ["snappee.pen", "penCurve"]]) {
			this.registry.setChecked(id, this.curveDraft?.type === mode);
		}
		this.registry.setChecked("transform.free", Boolean(this.freeTransform));
		this.registry.setChecked("transform.allowOutOfBounds", allowsOutOfBounds(this.model));
		this.registry.setChecked("music.playPause", this.audio.playing);
		for (const value of [1, 2, 3, 4, 6, 8]) this.registry.setChecked(`music.subdivision${value}`, this.model.editor.subdivision === value);
		for (const [id, value] of [["music.speed025", 0.25], ["music.speed05", 0.5], ["music.speed1", 1]]) {
			this.registry.setChecked(id, Math.abs(this.model.editor.speed - value) < 1e-8);
		}
	}

	#bindTabs() {
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

	#bindInputs() {
		document.getElementById("open-file-input").addEventListener("change", event => void this.openFile(event.target.files[0]).finally(() => { event.target.value = ""; }));
		document.getElementById("music-file-input").addEventListener("change", event => void this.loadMusic(event.target.files[0]).finally(() => { event.target.value = ""; }));
		document.getElementById("background-file-input").addEventListener("change", event => void this.loadBackground(event.target.files[0]).finally(() => { event.target.value = ""; }));
		document.getElementById("difficulty-select")?.addEventListener("change", event => this.switchDifficulty(event.target.value));
		document.getElementById("difficulty-add")?.addEventListener("click", () => void this.newDifficulty());
		document.getElementById("difficulty-delete")?.addEventListener("click", () => void this.deleteDifficulty());
	}

	#bindAudio() {
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
			this.#scheduleHits(time);
			this.refresh();
		});
		this.audio.addEventListener("play", () => {
			const time = this.currentSeconds();
			const editor = this.model.editor;
			this.playFollowOffset = time >= editor.visibleRangeBeginning && time <= editor.visibleRangeEnd
				? time - editor.visibleRangeBeginning : null;
			this.scheduledHitIds.clear();
			this.scheduledHoldReleaseIds.clear();
			this.#scheduleHits(time);
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

	#scheduleHits(current) {
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

	#bindGlobalInteraction() {
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

	async #offerAutosave() {
		const recovery = this.autosave.latestRecoverable();
		if (!recovery) return;
		const load = await this.dialogs.confirm({
			titleKey: "dialog.autosave",
			messageKey: "dialog.autosaveMessage",
			confirmLabelKey: "dialog.load",
			cancelLabelKey: "dialog.discard",
		});
		if (load) {
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

	exitCreationModes() {
		if (!this.creationMode && !this.curveDraft) return false;
		this.creationMode = null;
		this.curveDraft = null;
		this.cancelPreview();
		this.refresh();
		return true;
	}

	// Interaction callback factories are kept compact so renderers stay model-agnostic.
	#timelineCallbacks() {
		return {
			getWaveform: () => this.audio.waveform,
			getTimeBounds: () => this.timeBounds(true),
			isPlaying: () => this.audio.playing,
			onSeekStart: () => {
				this.resumePlaybackAfterSeek = this.audio.playing;
				if (this.audio.playing) this.audio.pause();
			},
			onSeekEnd: () => {
				const resume = this.resumePlaybackAfterSeek;
				this.resumePlaybackAfterSeek = false;
				if (resume) void this.audio.play();
			},
			onSelectEvents: (ids, mode) => this.selectEvents(ids, mode),
			onRangeSelect: (beat, channel, mode) => this.rangeSelect(beat, channel, mode),
			onSeekBeat: (beat, channel, clearSelection) => this.seekBeat(beat, channel, clearSelection),
			onPreviewMoveEvents: (delta, channelDelta, copy) => this.previewMoveEvents(delta, channelDelta, copy),
			onMoveEvents: (delta, channelDelta, copy) => this.moveEvents(delta, channelDelta, copy),
			onPreviewDuration: (id, duration) => this.preview("Resize event", model => { const event = model.events.find(item => item.id === id); if (event) event.duration = duration; }),
			onResizeEvent: (id, duration) => {
				this.commit(i18n.t("history.editEvent", { type: "" }), model => {
					const event = model.events.find(item => item.id === id);
					if (event) event.duration = duration;
				});
				this.rememberCreationDefaults(this.model.events.filter(event => event.id === id));
			},
			onPreviewBoxSelect: (ids, mode) => this.previewSelection(ids, mode),
			onBoxSelect: (ids, mode) => this.selectEvents(ids, mode),
			onEndPreview: () => this.cancelPreview(),
			onVisibleRange: (beginning, end) => this.setVisibleRange(beginning, end),
			onEditBpm: index => void this.showBpmDialog(index),
			onWheel: event => this.navigateWheel(event.deltaY, event.ctrlKey),
		};
	}

	#stageCallbacks() {
		return {
			getCreationMode: () => this.creationMode,
			isPlaying: () => this.audio.playing,
			getDefaultFlickAngle: () => this.lastFlickAngle,
			getCurveDraft: () => this.curveDraft,
			getFreeTransform: () => this.freeTransform,
			getTimeBounds: () => this.timeBounds(true),
			onCreationPreview: () => this.#updateStatus(),
			onCreateEvent: (type, preview) => this.createPositionedEvent(type, preview),
			onCurvePoint: (point, finish) => this.addCurvePoint(point, finish),
			onPenNodeStart: point => this.startPenNode(point),
			onPreviewPenNode: (index, point) => this.setPenNodeDrag(index, point, false),
			onPenNode: (index, point, dragged) => dragged ? this.setPenNodeDrag(index, point, true) : this.recordPenNode(index),
			onPreviewPenHandle: (index, kind, point) => this.setPenNodeHandle(index, kind, point, false),
			onPenHandle: (index, kind, point) => this.setPenNodeHandle(index, kind, point, true),
			onCurvePointActivate: index => this.activateCurveDraftPoint(index),
			onCurveDoubleClick: () => this.finishCurveDraftFromDoubleClick(),
			onPreviewCurvePoint: (index, point) => this.moveCurveDraftPoint(index, point, false),
			onCurvePointMove: (index, point) => this.moveCurveDraftPoint(index, point, true),
			onSelectEvents: (ids, mode) => this.selectEvents(ids, mode),
			onPreviewPosition: (id, point) => this.previewPosition(id, point),
			onMovePosition: (id, point) => this.movePosition(id, point),
			onPreviewFlickAngle: (id, angle) => this.preview("Change flick direction", model => { const event = model.events.find(item => item.id === id); if (event) event.angle = angle; }),
			onFlickAngle: (id, angle) => {
				this.lastFlickAngle = Number(angle);
				this.commit(i18n.t("history.editEvent", { type: eventTypeLabel("flick") }), model => {
					const event = model.events.find(item => item.id === id);
					if (event) event.angle = angle;
				});
			},
			onPreviewTipSpawn: (id, point) => this.previewTipSpawn(id, point),
			onTipSpawn: (id, point) => this.setTipSpawn(id, point),
			onPreviewSnappeeHandle: (id, index, point) => this.previewSnappeeHandle(id, index, point),
			onSnappeeHandle: (id, index, point) => this.setSnappeeHandle(id, index, point),
			onPreviewBoxSelect: (ids, mode) => this.previewSelection(ids, mode),
			onBoxSelect: (ids, mode) => this.selectEvents(ids, mode),
			onEndPreview: () => this.cancelPreview(),
			onSelectAttachedEvents: (id, mode) => this.selectEvents(this.model.events.filter(event => event.attached && event.snappee === id).map(event => event.id), mode),
			onPreviewFreeTransform: matrix => this.previewFreeTransform(matrix),
		};
	}

	selectEvents(ids, mode = "replace") {
		const targets = new Set(ids);
		this.commit(i18n.t("history.selection"), model => {
			for (const event of model.events) {
				if (mode === "replace") event.selected = targets.has(event.id);
				else if (mode === "add" && targets.has(event.id)) event.selected = true;
				else if (mode === "remove" && targets.has(event.id)) event.selected = false;
			}
		}, { dirty: false });
	}

	#reconcileStageMoveAttachmentException(selectionBefore) {
		const exception = this.stageMoveAttachmentException;
		if (!exception) return;
		const sameSet = (left, right) => left.size === right.size && [...left].every(id => right.has(id));
		if (!sameSet(selectionBefore, exception.selectionIds)) {
			this.stageMoveAttachmentException = null;
			return;
		}
		const selectionAfter = new Set(this.model.events.filter(event => event.selected).map(event => event.id));
		if (sameSet(selectionBefore, selectionAfter)) return;
		const onlyAdded = [...selectionBefore].every(id => selectionAfter.has(id));
		const addedAreUnattached = [...selectionAfter]
			.filter(id => !selectionBefore.has(id))
			.every(id => !this.model.events.find(event => event.id === id)?.attached);
		if (onlyAdded && addedAreUnattached) exception.selectionIds = selectionAfter;
		else this.stageMoveAttachmentException = null;
	}

	#canUseStageMoveAttachmentException(model) {
		const exception = this.stageMoveAttachmentException;
		if (!exception) return false;
		const selectedIds = new Set(model.events.filter(event => event.selected).map(event => event.id));
		if (selectedIds.size !== exception.selectionIds.size
			|| [...selectedIds].some(id => !exception.selectionIds.has(id))) return false;
		const movable = model.events.filter(event => event.selected && MOVABLE_TYPES.has(event.type));
		const attached = movable.filter(event => event.attached);
		return attached.length === 1 && attached[0].id === exception.attachedEventId;
	}

	#captureStageMoveAttachmentException(primaryId) {
		const movable = this.model.events.filter(event => event.selected && MOVABLE_TYPES.has(event.type));
		const attached = movable.filter(event => event.attached);
		this.stageMoveAttachmentException = attached.length === 1 && attached[0].id === primaryId
			? {
				attachedEventId: primaryId,
				selectionIds: new Set(this.model.events.filter(event => event.selected).map(event => event.id)),
			}
			: null;
	}

	previewSelection(ids, mode) {
		const targets = new Set(ids);
		this.preview(i18n.t("history.selection"), model => {
			for (const event of model.events) {
				if (mode === "replace") event.selected = targets.has(event.id);
				else if (mode === "add" && targets.has(event.id)) event.selected = true;
				else if (mode === "remove" && targets.has(event.id)) event.selected = false;
			}
		});
	}

	rangeSelect(targetBeat, targetChannel, mode) {
		const beginningBeat = this.currentBeat();
		const endingBeat = Rational.from(targetBeat);
		const beginningChannel = this.model.channels.findIndex(channel => channel.id === this.model.editor.currentChannel);
		const endingChannel = this.model.channels.findIndex(channel => channel.id === targetChannel);
		const minimumBeat = beginningBeat.compare(endingBeat) <= 0 ? beginningBeat : endingBeat;
		const maximumBeat = beginningBeat.compare(endingBeat) <= 0 ? endingBeat : beginningBeat;
		const channelIds = new Set(this.model.channels
			.slice(Math.min(beginningChannel, endingChannel), Math.max(beginningChannel, endingChannel) + 1)
			.map(channel => channel.id));
		const ids = this.model.events.filter(event => channelIds.has(event.channel)
			&& Rational.from(event.time).compare(minimumBeat) >= 0
			&& Rational.from(event.time).compare(maximumBeat) < 0).map(event => event.id);
		this.commit(i18n.t("history.selection"), model => {
			model.editor.currentTime = endingBeat.toJSON();
			model.editor.currentChannel = targetChannel;
			const targets = new Set(ids);
			for (const event of model.events) {
				if (mode === "replace") event.selected = targets.has(event.id);
				else if (mode === "add" && targets.has(event.id)) event.selected = true;
				else if (mode === "remove" && targets.has(event.id)) event.selected = false;
			}
		}, { dirty: false });
	}

	seekBeat(beat, channel = null, clearSelection = false) {
		if (this.audio.playing) this.audio.pause();
		this.model.editor.timeSnapped = true;
		this.model.editor.currentTime = Rational.from(beat).toJSON();
		if (channel != null) this.model.editor.currentChannel = channel;
		if (clearSelection) {
			for (const event of this.model.events) event.selected = false;
			this.stageMoveAttachmentException = null;
		}
		this.audio.seek(this.currentSeconds());
		this.refresh();
	}

	setVisibleRange(beginning, end, includeCurrent = false) {
		const bounds = this.timeBounds(includeCurrent);
		const span = Math.max(0.05, end - beginning);
		let start = Math.max(bounds[0], Math.min(bounds[1] - span, beginning));
		if (bounds[1] - bounds[0] < span) start = bounds[0];
		this.model.editor.visibleRangeBeginning = start;
		this.model.editor.visibleRangeEnd = Math.min(bounds[1], start + span);
		this.refresh();
	}

	navigateWheel(deltaY, zoom = false) {
		if (zoom) {
			const editor = this.model.editor;
			const center = (editor.visibleRangeBeginning + editor.visibleRangeEnd) / 2;
			const factor = deltaY < 0 ? 1.22 : 0.82;
			const span = Math.max(0.02, (editor.visibleRangeEnd - editor.visibleRangeBeginning) * factor);
			this.setVisibleRange(center - span / 2, center + span / 2);
			return;
		}
		const direction = Math.sign(deltaY);
		const nextBeat = this.currentBeat().add(new Rational(direction, this.model.editor.subdivision));
		const oldSeconds = this.currentSeconds();
		const nextSeconds = this.timing().beatToSeconds(nextBeat);
		const bounds = this.timeBounds();
		if (nextSeconds < bounds[0] - 1e-8 || nextSeconds > bounds[1] + 1e-8) return;
		const delta = nextSeconds - oldSeconds;
		this.model.editor.currentTime = nextBeat.toJSON();
		this.model.editor.timeSnapped = true;
		this.model.editor.visibleRangeBeginning += delta;
		this.model.editor.visibleRangeEnd += delta;
		const span = this.model.editor.visibleRangeEnd - this.model.editor.visibleRangeBeginning;
		if (this.model.editor.visibleRangeBeginning < bounds[0]) this.setVisibleRange(bounds[0], bounds[0] + span);
		else if (this.model.editor.visibleRangeEnd > bounds[1]) this.setVisibleRange(bounds[1] - span, bounds[1]);
		else this.refresh();
		this.audio.seek(nextSeconds);
	}

	previewMoveEvents(deltaBeat, channelDelta, copy) {
		this.preview(i18n.t("history.moveEvents"), model => this.#applyEventMove(model, deltaBeat, channelDelta, copy));
	}

	moveEvents(deltaBeat, channelDelta, copy) {
		this.commit(i18n.t("history.moveEvents"), model => this.#applyEventMove(model, deltaBeat, channelDelta, copy));
	}

	#applyEventMove(model, deltaBeat, channelDelta, copy) {
		let events = model.events.filter(event => event.selected);
		if (!events.length) return;
		const channelIndices = events
			.map(event => model.channels.findIndex(channel => channel.id === event.channel))
			.filter(index => index >= 0);
		if (!channelIndices.length) return;
		const requestedChannelDelta = Math.round(Number(channelDelta) || 0);
		const boundedChannelDelta = Math.max(
			-Math.min(...channelIndices),
			Math.min(model.channels.length - 1 - Math.max(...channelIndices), requestedChannelDelta),
		);
		if (copy) {
			for (const event of events) event.selected = false;
			events = events.map(event => model.addEvent({ ...deepClone(event), id: null, selected: true }));
		}
		const delta = Rational.from(deltaBeat);
		for (const event of events) {
			event.time = Rational.from(event.time).add(delta).toJSON();
			const index = model.channels.findIndex(channel => channel.id === event.channel);
			if (index >= 0) event.channel = model.channels[index + boundedChannelDelta].id;
		}
	}

	previewPosition(primaryId, point) {
		this.preview(i18n.t("history.moveEvents"), model => this.#applyPositionMove(model, primaryId, point));
	}

	movePosition(primaryId, point) {
		const base = this.previewBase || this.model.snapshot();
		const before = JSON.stringify(base);
		const primaryWasAttached = Boolean(base.events.find(event => event.id === primaryId)?.attached);
		this.commit(i18n.t("history.moveEvents"), model => this.#applyPositionMove(model, primaryId, point));
		if (JSON.stringify(this.model.snapshot()) !== before) {
			const primaryIsAttached = Boolean(this.model.events.find(event => event.id === primaryId)?.attached);
			if (!primaryWasAttached && primaryIsAttached) this.#captureStageMoveAttachmentException(primaryId);
			else if (!this.#canUseStageMoveAttachmentException(this.model)) this.stageMoveAttachmentException = null;
		}
	}

	#applyPositionMove(model, primaryId, point) {
		const primary = model.events.find(event => event.id === primaryId);
		if (!primary) return;
		const movable = model.events.filter(event => event.selected && MOVABLE_TYPES.has(event.type));
		const attached = movable.filter(event => event.attached);
		const sharedSnappeeId = attached.length === movable.length && new Set(attached.map(event => event.snappee)).size === 1
			? attached[0]?.snappee : null;
		const sharedSnappee = model.snappees.find(snappee => snappee.id === sharedSnappeeId);
		if (sharedSnappee && primary.attached && primary.snappee === sharedSnappee.id) {
			let points;
			try { points = sampleSnappee(sharedSnappee); } catch { return; }
			if (!allowsOutOfBounds(model)) points = points.filter(isPointWithinChartBounds);
			if (!points.length) return;
			const nearest = points.reduce((best, candidate) => {
				const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
				return !best || distance < best.distance ? { candidate, distance } : best;
			}, null)?.candidate;
			if (!nearest) return;
			if (sharedSnappee.type === "rectangularMesh") {
				const [fromI, fromJ] = primary.snapPoint;
				const [toI, toJ] = nearest.snapPoint;
				const maximumI = Math.max(1, Number(sharedSnappee.horizontalTiles) || 1);
				const maximumJ = Math.max(1, Number(sharedSnappee.verticalTiles) || 1);
				const indices = movable.map(event => event.snapPoint);
				const requestedI = toI - fromI;
				const requestedJ = toJ - fromJ;
				const deltaI = Math.max(-Math.min(...indices.map(([i]) => i)),
					Math.min(maximumI - Math.max(...indices.map(([i]) => i)), requestedI));
				const deltaJ = Math.max(-Math.min(...indices.map(([, j]) => j)),
					Math.min(maximumJ - Math.max(...indices.map(([, j]) => j)), requestedJ));
				const snapPoints = movable.map(event => [event.snapPoint[0] + deltaI, event.snapPoint[1] + deltaJ]);
				if (!attachedMoveAllowed(model, sharedSnappee, movable, snapPoints)) return;
				movable.forEach((event, index) => { event.snapPoint = snapPoints[index]; });
				return;
			}
			if (sharedSnappee.type === "radialMesh") {
				const count = Math.max(1, Number(sharedSnappee.azimuthalTiles) || 1);
				let localPoint;
				try { localPoint = applyTransform(point, invertTransform(sharedSnappee.transformation)); } catch { return; }
				const angle = Math.atan2(localPoint.y - sharedSnappee.centerY, localPoint.x - sharedSnappee.centerX);
				const targetIndex = Math.round((angle - Number(sharedSnappee.startingAngle || 0)) * count / (Math.PI * 2));
				const delta = targetIndex - Number(primary.snapPoint[0] || 0);
				const snapPoints = movable.map(event => [
					((event.snapPoint[0] + delta) % count + count) % count,
					event.snapPoint[1],
				]);
				if (!attachedMoveAllowed(model, sharedSnappee, movable, snapPoints)) return;
				movable.forEach((event, index) => { event.snapPoint = snapPoints[index]; });
				return;
			}
			if (sharedSnappee.type.endsWith("Curve")) {
				const key = value => JSON.stringify(value);
				const indices = new Map(points.map((candidate, index) => [key(candidate.snapPoint), index]));
				const fromIndex = indices.get(key(primary.snapPoint));
				const toIndex = indices.get(key(nearest.snapPoint));
				if (fromIndex == null || toIndex == null) return;
				const delta = toIndex - fromIndex;
				const closed = Boolean(sharedSnappee.closed);
				const selectedIndices = movable.map(event => indices.get(key(event.snapPoint))).filter(Number.isInteger);
				const constrainedDelta = closed ? delta : Math.max(-Math.min(...selectedIndices),
					Math.min(points.length - 1 - Math.max(...selectedIndices), delta));
				const snapPoints = movable.map(event => {
					const index = indices.get(key(event.snapPoint));
					if (index == null) return event.snapPoint;
					const moved = closed
						? ((index + constrainedDelta) % points.length + points.length) % points.length
						: index + constrainedDelta;
					return deepClone(points[moved].snapPoint);
				});
				if (!attachedMoveAllowed(model, sharedSnappee, movable, snapPoints)) return;
				movable.forEach((event, index) => { event.snapPoint = snapPoints[index]; });
				return;
			}
			return;
		}
		if (attached.length && attached.length === movable.length) return;
		if (attached.length && !this.#canUseStageMoveAttachmentException(model)) return;
		const original = resolveAttachedPosition(primary, model.snappees) || primary;
		const target = { x: Number(point.x), y: Number(point.y) };
		const positions = movable.map(event => resolveAttachedPosition(event, model.snappees) || event);
		const requestedX = target.x - original.x;
		const requestedY = target.y - original.y;
		const deltaX = allowsOutOfBounds(model) ? requestedX : Math.max(CHART_BOUNDS.minX - Math.min(...positions.map(position => Number(position.x))),
			Math.min(CHART_BOUNDS.maxX - Math.max(...positions.map(position => Number(position.x))), requestedX));
		const deltaY = allowsOutOfBounds(model) ? requestedY : Math.max(CHART_BOUNDS.minY - Math.min(...positions.map(position => Number(position.y))),
			Math.min(CHART_BOUNDS.maxY - Math.max(...positions.map(position => Number(position.y))), requestedY));
		for (const event of movable) {
			const position = resolveAttachedPosition(event, model.snappees) || event;
			event.attached = false;
			event.x = position.x + deltaX;
			event.y = position.y + deltaY;
			delete event.snappee;
			delete event.snapPoint;
		}
		if (point.snappeeId != null && pointAllowed(model, point)) {
			primary.attached = true;
			primary.snappee = point.snappeeId;
			primary.snapPoint = deepClone(point.snapPoint);
			delete primary.x;
			delete primary.y;
		}
	}

	previewTipSpawn(id, point) {
		this.preview(i18n.t("history.editEvent", { type: "" }), model => this.#applyTipSpawn(model, id, point));
	}

	setTipSpawn(id, point) {
		this.commit(i18n.t("history.editEvent", { type: "" }), model => this.#applyTipSpawn(model, id, point));
	}

	#applyTipSpawn(model, id, point) {
		const event = model.events.find(item => item.id === id);
		if (!event) return;
		const position = resolveAttachedPosition(event, model.snappees) || event;
		if (event.tipPointSpawnAbsolutePosition) {
			const snap = findNearestSnapPoint(point, model.snappees, { activeOnly: true, maxDistance: 8 });
			if (snap) {
				event.tipPointSpawnAttached = true;
				event.tipPointSpawnSnappee = snap.snappeeId;
				event.tipPointSpawnSnapPoint = deepClone(snap.snapPoint);
				delete event.tipPointSpawnX;
				delete event.tipPointSpawnY;
			} else {
				event.tipPointSpawnAttached = false;
				event.tipPointSpawnX = point.x;
				event.tipPointSpawnY = point.y;
				delete event.tipPointSpawnSnappee;
				delete event.tipPointSpawnSnapPoint;
			}
		} else {
			const dx = point.x - position.x;
			const dy = point.y - position.y;
			event.tipPointSpawnDistance = Math.round(Math.hypot(dx, dy) / 12.5) * 12.5;
			event.tipPointSpawnAngle = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * Math.PI / 12;
		}
	}

	previewSnappeeHandle(id, index, point) {
		this.preview(i18n.t("history.editSnappee"), model => this.#applySnappeeHandle(model, id, index, point));
	}

	setSnappeeHandle(id, index, point) {
		this.commit(i18n.t("history.editSnappee"), model => this.#applySnappeeHandle(model, id, index, point));
	}

	#applySnappeeHandle(model, id, index, point) {
		return mutateSnappeeWithinBounds(model, id, snappee => {
			let localPoint;
			try { localPoint = applyTransform(point, invertTransform(snappee.transformation)); } catch { return false; }
			if (snappee.type === "rectangularMesh") {
				if (index === 0) { snappee.topLeftX = localPoint.x; snappee.topLeftY = localPoint.y; }
				else { snappee.bottomRightX = localPoint.x; snappee.bottomRightY = localPoint.y; }
			} else if (snappee.type === "radialMesh") {
				if (index === 0) { snappee.centerX = localPoint.x; snappee.centerY = localPoint.y; }
				else {
					snappee.radius = Math.hypot(localPoint.x - snappee.centerX, localPoint.y - snappee.centerY);
					snappee.startingAngle = Math.atan2(localPoint.y - snappee.centerY, localPoint.x - snappee.centerX);
				}
			} else if (snappee.type === "bezierCurve" && Number.isInteger(index)) {
				snappee.controlPoints[index] = { x: localPoint.x, y: localPoint.y };
			} else if (snappee.type === "circularArcCurve") {
				if (index === "center" || index === 0) { snappee.centerX = localPoint.x; snappee.centerY = localPoint.y; }
				else {
					const angle = Math.atan2(localPoint.y - snappee.centerY, localPoint.x - snappee.centerX);
					if (index === 1) snappee.beginningAngle = angle; else snappee.endAngle = angle;
				}
			} else if (snappee.type === "regularPolygonCurve") {
				if (index === 0) { snappee.centerX = localPoint.x; snappee.centerY = localPoint.y; }
				else {
					snappee.radius = Math.hypot(localPoint.x - snappee.centerX, localPoint.y - snappee.centerY);
					snappee.angle = Math.atan2(localPoint.y - snappee.centerY, localPoint.x - snappee.centerX);
				}
			} else if (snappee.type === "penCurve" && index && typeof index === "object") {
				const command = snappee.commands?.[index.command];
				if (!command) return false;
				command[index.x] = localPoint.x;
				command[index.y] = localPoint.y;
			}
			return true;
		});
	}

	attachedSnappeeIds(model = this.model) {
		const available = new Set(model.snappees.map(snappee => snappee.id));
		return new Set(model.events
			.filter(event => event.selected && event.attached && available.has(event.snappee))
			.map(event => event.snappee));
	}

	transformationTargets(model = this.model) {
		const attachedIds = this.attachedSnappeeIds(model);
		const directEvents = model.events.filter(event => event.selected && MOVABLE_TYPES.has(event.type) && !event.attached);
		const affectedEvents = model.events.filter(event => directEvents.includes(event)
			|| (event.attached && attachedIds.has(event.snappee) && MOVABLE_TYPES.has(event.type)));
		return { attachedIds, directEvents, affectedEvents };
	}

	transformSelectionBounds(model = this.model) {
		const { attachedIds, directEvents } = this.transformationTargets(model);
		const points = directEvents.map(event => resolveAttachedPosition(event, model.snappees)).filter(Boolean);
		for (const snappee of model.snappees) {
			if (!attachedIds.has(snappee.id)) continue;
			try { points.push(...sampleSnappee(snappee)); } catch { /* Invalid snappees cannot contribute a transform box. */ }
		}
		if (!points.length) return null;
		const xs = points.map(point => point.x);
		const ys = points.map(point => point.y);
		const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
		if (bounds.maxX - bounds.minX <= 1e-6 || bounds.maxY - bounds.minY <= 1e-6) return null;
		return bounds;
	}

	#applyTransformMutation(model, matrix) {
		const { attachedIds, directEvents, affectedEvents } = this.transformationTargets(model);
		if (!directEvents.length && !attachedIds.size) return false;
		for (const event of affectedEvents) {
			const position = resolveAttachedPosition(event, model.snappees);
			if (!position) return false;
			const transformed = applyTransform(position, matrix);
			if (!pointAllowed(model, transformed)) return false;
		}
		for (const snappee of model.snappees) {
			if (attachedIds.has(snappee.id)) snappee.transformation = multiplyTransforms(matrix, snappee.transformation);
		}
		for (const event of directEvents) {
			const transformed = applyTransform(event, matrix);
			event.x = transformed.x;
			event.y = transformed.y;
		}
		for (const event of affectedEvents) {
			if (event.type === "flick") event.angle = transformAngle(event.angle, matrix);
		}
		return true;
	}

	startFreeTransform() {
		if (this.freeTransform) {
			this.finishFreeTransform();
			return true;
		}
		this.exitModes();
		const bounds = this.transformSelectionBounds();
		if (!bounds) return false;
		this.freeTransform = {
			base: this.model.snapshot(),
			bounds,
			matrix: [1, 0, 0, 1, 0, 0],
		};
		this.refresh();
		return true;
	}

	previewFreeTransform(transform) {
		if (!this.freeTransform || !Array.isArray(transform) || transform.length !== 6) return false;
		const matrix = transform.map(Number);
		if (matrix.some(value => !Number.isFinite(value))) return false;
		const previous = this.model.snapshot();
		this.model.restore(this.freeTransform.base);
		if (!this.#applyTransformMutation(this.model, matrix)) {
			this.model.restore(previous);
			return false;
		}
		this.freeTransform.matrix = matrix;
		this.refresh();
		return true;
	}

	finishFreeTransform() {
		if (!this.freeTransform) return false;
		const changed = JSON.stringify(this.freeTransform.base) !== JSON.stringify(this.model.snapshot());
		this.freeTransform = null;
		if (changed) {
			this.history.record(this.model.snapshot(), i18n.t("history.transform"));
			this.updateDirty();
		}
		this.refresh();
		return changed;
	}

	cancelFreeTransform() {
		if (!this.freeTransform) return false;
		this.model.restore(this.freeTransform.base);
		this.freeTransform = null;
		this.refresh();
		return true;
	}

	setAttachedSnappeesActive(active) {
		const ids = this.attachedSnappeeIds();
		if (!ids.size) return;
		const commandKey = active ? "command.snappee.activate" : "command.snappee.deactivate";
		this.commit(i18n.t(commandKey), model => {
			for (const snappee of model.snappees) {
				if (!ids.has(snappee.id)) continue;
				snappee.active = Boolean(active);
				if (!active) snappee.selected = false;
			}
		});
	}

	attachSelected() {
		if (!this.model.snappees.some(snappee => snappee.active !== false)) return;
		this.commit(i18n.t("command.snappee.attach"), model => {
			for (const event of model.events) {
				if (!event.selected || !MOVABLE_TYPES.has(event.type)) continue;
				const position = resolveAttachedPosition(event, model.snappees);
				if (!position) continue;
				const nearest = findNearestSnapPoint(position, model.snappees, {
					activeOnly: true,
					bounds: allowsOutOfBounds(model) ? undefined : CHART_BOUNDS,
				});
				if (!nearest) continue;
				event.attached = true;
				event.snappee = nearest.snappeeId;
				event.snapPoint = deepClone(nearest.snapPoint);
				delete event.x;
				delete event.y;
			}
		});
	}

	detachSelected() {
		this.commit(i18n.t("command.snappee.detach"), model => {
			for (const event of model.events) {
				if (!event.selected || !event.attached || !MOVABLE_TYPES.has(event.type)) continue;
				const position = resolveAttachedPosition(event, model.snappees);
				if (!position) continue;
				event.attached = false;
				event.x = position.x;
				event.y = position.y;
				delete event.snappee;
				delete event.snapPoint;
			}
		});
	}

	translateSelected(deltaX, deltaY) {
		return this.applyTransformToSelection([1, 0, 0, 1, Number(deltaX), Number(deltaY)]);
	}

	applyTransformToSelection(transform) {
		if (!Array.isArray(transform) || transform.length !== 6) return false;
		const matrix = transform.map(Number);
		if (matrix.some(value => !Number.isFinite(value))) return false;

		if (this.freeTransform) return this.previewFreeTransform(multiplyTransforms(matrix, this.freeTransform.matrix));
		let applied = false;
		this.commit(i18n.t("history.transform"), model => { applied = this.#applyTransformMutation(model, matrix); });
		return applied;
	}

	moveSelectedInTime(direction) {
		const step = Math.sign(Number(direction));
		if (!step) return;
		const delta = new Rational(step, this.model.editor.subdivision);
		this.commit(i18n.t("history.moveEvents"), model => {
			for (const event of model.events) {
				if (event.selected) event.time = Rational.from(event.time).add(delta).toJSON();
			}
		});
	}

	async showTransformDialog() {
		this.exitModes();
		const values = await this.dialogs.form({
			titleKey: "dialog.transformMatrix",
			values: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
			fields: [
				{ id: "a", type: "number", labelKey: "field.matrixA", required: true, step: "any" },
				{ id: "b", type: "number", labelKey: "field.matrixB", required: true, step: "any" },
				{ id: "c", type: "number", labelKey: "field.matrixC", required: true, step: "any" },
				{ id: "d", type: "number", labelKey: "field.matrixD", required: true, step: "any" },
				{ id: "tx", type: "number", labelKey: "field.matrixTx", required: true, step: "any" },
				{ id: "ty", type: "number", labelKey: "field.matrixTy", required: true, step: "any" },
			],
		});
		if (!values) return;
		this.applyTransformToSelection([values.a, values.b, values.c, values.d, values.tx, values.ty]);
	}

	editSelectedProperty(property, value) {
		const historyLabel = i18n.t("history.editEvent", { type: "" });
		if (property === "tipPointSpawnType" && value === "chain"
			&& this.model.events.filter(event => event.selected).length > 1) {
			const result = this.commit(historyLabel, model => connectSelectedTipPointChain(model.events));
			if (!result?.ok) this.toast.error("toast.tipPointChainSelection");
			return result;
		}
		const result = this.commit(historyLabel, model => {
			const chosen = model.events.filter(event => event.selected);
			if (property === "type") {
				for (const event of chosen) {
					const overrides = { ...event, id: event.id, selected: true };
					if (value === "hold" && event.duration == null) overrides.duration = this.lastHoldDuration;
					if (value === "bgNote" && event.duration == null) overrides.duration = this.lastBgNoteDuration;
					if (value === "flick" && event.angle == null) overrides.angle = this.lastFlickAngle;
					const replacement = createEvent(value, overrides);
					model.events[model.events.indexOf(event)] = replacement;
				}
				return;
			}
			for (const event of chosen) {
				if ((property === "x" || property === "y") && event.attached) continue;
				let nextValue = value;
				if ((property === "x" || property === "y") && !allowsOutOfBounds(model)) {
					const point = clampPointToChartBounds({ x: property === "x" ? nextValue : event.x, y: property === "y" ? nextValue : event.y });
					nextValue = point[property];
				}
				if (property === "duration" || property.startsWith("tipPoint")) {
					const replacement = createEvent(event.type, { ...event, [property]: deepClone(nextValue), id: event.id, selected: true });
					model.events[model.events.indexOf(event)] = replacement;
				} else {
					event[property] = deepClone(nextValue);
				}
			}
		});
		if (property === "duration" || property === "angle" || property === "type") {
			this.rememberCreationDefaults(selected(this.model));
		}
		return result;
	}

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

	#registerCommands() {
		const command = (id, action, enabled = true) => this.registry.register(id, { action, enabled });
		command("file.new", () => void this.newChart());
		command("file.open", () => void this.openProject());
		command("file.importFile", () => { this.exitModes(); document.getElementById("open-file-input").click(); });
		command("file.setMusic", () => { this.exitModes(); document.getElementById("music-file-input").click(); });
		command("file.setBackground", () => { this.exitModes(); document.getElementById("background-file-input").click(); });
		command("file.save", () => void this.saveChart());
		command("file.saveLevel", () => void this.saveLevel());
		command("file.importClipboard", () => void this.importClipboard());
		command("file.exportClipboard", () => void this.exportClipboard());
		command("file.chartProperties", () => void this.showChartProperties(false));

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
		command("transform.allowOutOfBounds", () => this.commit(i18n.t("history.allowOutOfBounds"), model => {
			model.editor.allowOutOfBounds = !model.editor.allowOutOfBounds;
		}));
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
		command("music.zoomIn", () => this.navigateWheel(1, true));
		command("music.zoomOut", () => this.navigateWheel(-1, true));
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

	async confirmUnsaved() {
		if (!this.dirty) return true;
		const result = await this.dialogs.open({
			titleKey: "dialog.unsaved",
			messageKey: "dialog.unsavedMessage",
			buttons: [
				{ id: "save", labelKey: "dialog.save", primary: true, value: "save", validate: false },
				{ id: "discard", labelKey: "dialog.dontSave", value: "discard", validate: false },
				{ id: "cancel", labelKey: "dialog.cancel", cancel: true, value: "cancel", validate: false },
			],
		});
		if (result?.value === "save") return Boolean(await this.saveChart());
		return result?.value === "discard";
	}

	switchDifficulty(id) {
		if (id === this.activeDifficultyId) return true;
		const target = this.difficulties.find(entry => entry.id === id);
		if (!target) return false;
		if (this.audio.playing) this.audio.pause();
		this.exitModes();
		this.syncActiveDifficultyState();
		this.activeDifficultyId = target.id;
		this.model = target.model;
		this.history = target.history;
		this.savedSignature = target.savedSignature;
		this.difficultyUiSignature = "";
		this.updateDirty();
		this.refresh();
		return true;
	}

	async newDifficulty() {
		this.exitModes();
		const source = this.model;
		const values = await this.dialogs.form({
			titleKey: "dialog.newDifficulty",
			values: {
				...source.metadata,
				difficultyName: i18n.t("difficulty.untitled"),
				difficulty: source.metadata.difficulty || "1",
				offset: source.timing.offset,
				initialBpm: source.timing.initialBpm,
			},
			fields: metadataFields(),
			onChange: applyPresetDifficultyColor,
		});
		if (!values) return null;
		values.difficultyColor = difficultyColor(values.difficultyName, values.difficultyColor);
		this.projectName = values.title;
		this.projectTitle = values.title;
		this.projectArtist = values.artist;
		this.syncProjectSharedFields();
		this.syncProjectHistorySharedFields({ media: false });
		const model = ChartModel.createDefault({
			metadata: values,
			timing: {
				offset: values.offset,
				initialBpm: values.initialBpm,
				bpmChanges: source.timing.toJSON().bpmChanges,
			},
			music: this.projectMusic,
			image: this.projectImage,
		});
		const id = `difficulty-${this.nextDifficultyId++}`;
		const history = new History(model.snapshot(), { initialLabel: i18n.t("history.initial"), limit: 1000 });
		this.difficulties.push({
			id,
			file: uniqueChartFilename(model.metadata.difficultyName, this.difficulties.map(entry => entry.file)),
			model,
			history,
			savedSignature: null,
		});
		this.projectDirty = true;
		this.switchDifficulty(id);
		return id;
	}

	async deleteDifficulty() {
		if (this.difficulties.length <= 1) return false;
		const activeIndex = this.difficulties.findIndex(entry => entry.id === this.activeDifficultyId);
		const confirmed = await this.dialogs.confirm({
			titleKey: "dialog.deleteDifficulty",
			messageKey: "dialog.deleteDifficultyMessage",
		});
		if (!confirmed) return false;
		const next = this.difficulties[activeIndex + 1] || this.difficulties[activeIndex - 1];
		this.difficulties.splice(activeIndex, 1);
		this.projectDirty = true;
		this.activeDifficultyId = next.id;
		this.model = next.model;
		this.history = next.history;
		this.savedSignature = next.savedSignature;
		this.difficultyUiSignature = "";
		this.updateDirty();
		this.refresh();
		return true;
	}

	async newChart() {
		this.exitModes();
		if (!await this.confirmUnsaved()) return;
		const defaults = ChartModel.createDefault();
		const values = await this.dialogs.form({
			titleKey: "dialog.newChart",
			values: { ...defaults.metadata, offset: 0, initialBpm: 120, artist: "", charter: "", difficulty: "1" },
			fields: metadataFields(),
			onChange: applyPresetDifficultyColor,
		});
		if (!values) return;
		values.difficultyColor = difficultyColor(values.difficultyName, values.difficultyColor);
		const model = ChartModel.createDefault({
			metadata: values,
			timing: { offset: values.offset, initialBpm: values.initialBpm, bpmChanges: [] },
		});
		this.installProject([{ model, id: "difficulty-0", file: uniqueChartFilename(model.metadata.difficultyName) }], {
			activeChart: "difficulty-0",
			name: model.metadata.title,
			saved: false,
		});
		this.files.clearProjectTarget();
		await this.clearRuntimeMedia();
		this.updateDirty();
		this.refresh();
	}

	async showChartProperties(newChart = false) {
		const values = await this.dialogs.form({
			titleKey: newChart ? "dialog.newChart" : "dialog.chartProperties",
			values: {
				...this.model.metadata,
				offset: this.model.timing.offset,
				initialBpm: this.model.timing.initialBpm,
			},
			fields: metadataFields(),
			onChange: applyPresetDifficultyColor,
		});
		if (!values) return null;
		this.commit(i18n.t("dialog.chartProperties"), model => {
			model.metadata = {
				title: values.title,
				artist: values.artist,
				charter: values.charter,
				difficultyName: values.difficultyName,
				difficultyColor: difficultyColor(values.difficultyName, values.difficultyColor),
				difficulty: String(values.difficulty),
				difficultySup: values.difficultySup,
			};
			model.timing.setOffset(values.offset);
			model.timing.setInitialBpm(values.initialBpm);
		});
		this.projectName = values.title;
		this.projectTitle = values.title;
		this.projectArtist = values.artist;
		this.syncProjectSharedFields();
		this.syncProjectHistorySharedFields({ excludeDifficultyId: this.activeDifficultyId, media: false });
		this.updateDirty();
		this.refresh();
		return values;
	}

	async requestImportOptions(document) {
		if (document?.sviber) return {};
		const values = await this.dialogs.form({
			titleKey: "dialog.importTiming",
			values: { offset: 0, initialBpm: 120, largestDenominator: 192, bpmChanges: [] },
			fields: [
				{ id: "offset", type: "number", labelKey: "field.offset", step: "any" },
				{ id: "initialBpm", type: "number", labelKey: "field.initialBpm", positive: true, min: 0.001, step: "any" },
				{ id: "largestDenominator", type: "integer", labelKey: "field.largestDenominator", positive: true, min: 1 },
				{
					id: "bpmChanges", type: "array", labelKey: "field.bpmChanges", stacked: true,
					newItem: { time: [0, 0, 1], bpm: 120 },
					fields: [
						{ id: "time", type: "rational", labelKey: "field.beat" },
						{ id: "bpm", type: "number", labelKey: "field.bpm", positive: true, min: 0.001, step: "any" },
					],
				},
			],
		});
		if (!values) return null;
		return {
			offset: values.offset,
			initialBpm: values.initialBpm,
			bpmChanges: values.bpmChanges.map(change => ({ time: Rational.from(change.time).toJSON(), bpm: Number(change.bpm) })),
			largestDenominator: values.largestDenominator,
		};
	}

	async clearRuntimeMedia() {
		await this.audio.unload();
		this.files.clearCurrentAssets();
		if (this.backgroundUrl) URL.revokeObjectURL(this.backgroundUrl);
		this.backgroundUrl = null;
		this.stage.setBackground(null);
	}

	async decodeBackground(file) {
		if (this.backgroundUrl) URL.revokeObjectURL(this.backgroundUrl);
		this.backgroundUrl = URL.createObjectURL(file);
		const image = new Image();
		await new Promise((resolve, reject) => {
			image.onload = resolve;
			image.onerror = () => reject(new Error("Unable to decode the selected image."));
			image.src = this.backgroundUrl;
		});
		this.stage.setBackground(image);
		return image;
	}

	async syncMediaFromModel() {
		this.syncProjectSharedFields();
		const musicReference = this.projectMusic;
		if (musicReference !== this.files.musicReference) {
			await this.audio.unload();
			this.files.musicFile = null;
			this.files.musicReference = "";
			if (musicReference) {
				try {
					const file = await this.files.fileForAsset(musicReference, "music");
					if (file) {
						await this.audio.load(file);
						this.files.rememberAsset(musicReference, file, "music");
					}
				} catch (error) {
					console.warn("Unable to restore music", error);
					this.toast.error("toast.musicRestoreFailed", { message: localizedErrorMessage(error) });
				}
			}
		}

		const imageReference = this.projectImage;
		if (imageReference !== this.files.imageReference) {
			if (this.backgroundUrl) URL.revokeObjectURL(this.backgroundUrl);
			this.backgroundUrl = null;
			this.stage.setBackground(null);
			this.files.imageFile = null;
			this.files.imageReference = "";
			if (imageReference) {
				try {
					const file = await this.files.fileForAsset(imageReference, "image");
					if (file) {
						await this.decodeBackground(file);
						this.files.rememberAsset(imageReference, file, "image");
					}
				} catch (error) {
					console.warn("Unable to restore background", error);
					this.toast.error("toast.backgroundRestoreFailed", { message: localizedErrorMessage(error) });
				}
			}
		}
		this.refresh();
	}

	queueMediaSync() {
		this.mediaSync = this.mediaSync.catch(() => {}).then(() => this.syncMediaFromModel());
		return this.mediaSync;
	}

	async openProject() {
		this.exitModes();
		if (!await this.confirmUnsaved()) return null;
		try {
			const parsed = await this.files.openProject();
			if (!parsed) return null;
			const charts = parsed.charts.map(entry => ({
				...entry,
				model: ChartModel.import(entry.document),
			}));
			await this.clearRuntimeMedia();
			this.installProject(charts, {
				activeChart: parsed.manifest.activeChart,
				name: parsed.manifest.name,
				music: parsed.manifest.music,
				image: parsed.manifest.image,
				saved: true,
			});
			if (parsed.musicFile) await this.loadMusic(parsed.musicFile, false, { reference: parsed.manifest.music });
			if (parsed.imageFile) await this.loadBackground(parsed.imageFile, false, { reference: parsed.manifest.image });
			this.markProjectSaved();
			this.toast.show("toast.projectOpened");
			const warnings = this.difficulties.flatMap(entry => entry.model.importWarnings || []);
			if (warnings.length) this.toast.show(warnings.map(localizedImportWarning).join("\n"), {}, { raw: true, duration: 6500 });
			this.refresh();
			return parsed;
		} catch (error) {
			console.error(error);
			this.toast.error("toast.projectOpenFailed", { message: localizedErrorMessage(error) });
			return null;
		}
	}

	async openFile(file) {
		if (!file || !await this.confirmUnsaved()) return;
		try {
			const parsed = await this.files.parseFile(file);
			if (!parsed) return;
			const options = await this.requestImportOptions(parsed.document);
			if (options == null) return;
			const model = ChartModel.import(parsed.document, options);
			this.installProject([{
				id: "difficulty-0",
				file: uniqueChartFilename(model.metadata.difficultyName),
				model,
			}], { activeChart: "difficulty-0", name: model.metadata.title, saved: true });
			this.files.clearProjectTarget();
			this.files.adoptChartSource(parsed);
			await this.clearRuntimeMedia();
			if (parsed.fromLevel) {
				this.projectMusic = "";
				this.projectImage = "";
				this.syncProjectSharedFields();
				this.syncProjectHistorySharedFields({ metadata: false });
				if (parsed.musicFile) await this.loadMusic(parsed.musicFile, false);
				if (parsed.imageFile) await this.loadBackground(parsed.imageFile, false);
			} else if (this.files.supportsLocalPaths) {
				await this.syncMediaFromModel();
			}
			this.markProjectSaved();
			this.toast.show("toast.opened");
			if (this.model.importWarnings.length) {
				this.toast.show(this.model.importWarnings.map(localizedImportWarning).join("\n"), {}, { raw: true, duration: 6500 });
			}
			this.refresh();
		} catch (error) {
			console.error(error);
			this.toast.error("toast.openFailed", { message: localizedErrorMessage(error) });
		}
	}

	async loadMusic(file, record = true, options = {}) {
		if (!file) return;
		try {
			await this.audio.load(file);
			const reference = String(options.reference || this.files.assetReference(file));
			this.files.rememberAsset(reference, file, "music");
			this.projectMusic = reference;
			this.syncProjectSharedFields();
			this.syncProjectHistorySharedFields({ metadata: false });
			this.model.editor.visibleRangeBeginning = Math.min(0, this.model.timing.offset);
			this.model.editor.visibleRangeEnd = Math.min(this.audio.duration, this.model.editor.visibleRangeBeginning + 10);
			if (record) {
				this.projectDirty = true;
				this.updateDirty();
			}
			this.toast.show("toast.musicLoaded");
			this.refresh();
		} catch (error) {
			console.error(error);
			this.toast.error("toast.musicLoadFailed", { message: localizedErrorMessage(error) });
		}
	}

	async loadBackground(file, record = true, options = {}) {
		if (!file) return;
		try {
			await this.decodeBackground(file);
			const reference = String(options.reference || this.files.assetReference(file));
			this.files.rememberAsset(reference, file, "image");
			this.projectImage = reference;
			this.syncProjectSharedFields();
			this.syncProjectHistorySharedFields({ metadata: false });
			if (record) {
				this.projectDirty = true;
				this.updateDirty();
			}
			this.toast.show("toast.backgroundLoaded");
			this.refresh();
		} catch (error) {
			console.error(error);
			this.toast.error("toast.backgroundLoadFailed", { message: localizedErrorMessage(error) });
		}
	}

	async saveChart() {
		try {
			if (this.freeTransform) this.finishFreeTransform();
			const result = await this.files.saveProject(this.projectSnapshot());
			if (!result) return null;
			this.projectName = result.manifest.name;
			this.projectMusic = result.manifest.music;
			this.projectImage = result.manifest.image;
			this.syncProjectSharedFields();
			this.syncProjectHistorySharedFields({ metadata: false });
			this.markProjectSaved();
			this.autosave.markManualSave();
			this.toast.show("toast.projectSaved");
			this.refresh();
			return result.location;
		} catch (error) {
			this.toast.error("toast.projectSaveFailed", { message: localizedErrorMessage(error) });
			return null;
		}
	}

	async saveLevel() {
		try {
			if (this.freeTransform) this.finishFreeTransform();
			const filename = await this.files.saveLevel(this.projectSnapshot());
			if (filename) this.toast.show("toast.levelExported");
			return filename;
		} catch (error) {
			this.toast.error("toast.levelExportFailed", { message: localizedErrorMessage(error) });
			return null;
		}
	}

	async importClipboard() {
		try {
			const text = await navigator.clipboard.readText();
			const document = JSON.parse(text);
			if (!await this.confirmUnsaved()) return;
			const options = await this.requestImportOptions(document);
			if (options == null) return;
			const model = ChartModel.import(document, options);
			this.installProject([{
				id: "difficulty-0",
				file: uniqueChartFilename(model.metadata.difficultyName),
				model,
			}], { activeChart: "difficulty-0", name: model.metadata.title, saved: false });
			this.files.clearProjectTarget();
			await this.clearRuntimeMedia();
			if (this.files.supportsLocalPaths) await this.syncMediaFromModel();
			this.updateDirty();
			this.toast.show("toast.pasted");
			this.refresh();
		} catch (error) {
			this.toast.error("toast.clipboardFailed", { message: localizedErrorMessage(error) });
		}
	}

	async exportClipboard() {
		try {
			await this.files.exportClipboard(this.model);
			this.toast.show("toast.copied");
		} catch (error) {
			this.toast.error("toast.clipboardFailed", { message: localizedErrorMessage(error) });
		}
	}

	async copyEvents() {
		const chosen = selected(this.model);
		if (!chosen.length) return;
		const minimumBeat = chosen.map(event => Rational.from(event.time)).reduce((left, right) => left.compare(right) <= 0 ? left : right);
		const channelIndices = chosen.map(event => this.model.channels.findIndex(channel => channel.id === event.channel));
		const minimumChannel = Math.min(...channelIndices);
		const snappeeIds = new Set(chosen.flatMap(event => [event.snappee, event.tipPointSpawnSnappee]).filter(value => value != null));
		const events = chosen.map(event => {
			const copy = deepClone(event);
			copy.beat = Rational.from(event.time).sub(minimumBeat).toJSON();
			copy.channel = this.model.channels.findIndex(channel => channel.id === event.channel) - minimumChannel;
			delete copy.time;
			return copy;
		});
		this.internalClipboard = {
			version: 1,
			events,
			snappees: this.model.snappees.filter(snappee => snappeeIds.has(snappee.id)).map(deepClone),
		};
		try { await navigator.clipboard.writeText(JSON.stringify(events)); } catch { /* Internal clipboard remains available. */ }
	}

	async cutEvents() {
		await this.copyEvents();
		this.deleteSelected();
	}

	async pasteEvents(duplicateSnappees) {
		const internalData = this.internalClipboard;
		let data = internalData;
		try {
			const parsed = JSON.parse(await navigator.clipboard.readText());
			if (Array.isArray(parsed)) {
				const matchesInternal = internalData?.version === 1 && Array.isArray(internalData.events)
					&& JSON.stringify(parsed) === JSON.stringify(internalData.events);
				data = matchesInternal ? internalData : { version: 1, events: parsed, snappees: [] };
			}
			else if (parsed?.version === 1 && Array.isArray(parsed.events)) data = parsed;
		} catch { /* Use internal clipboard. */ }
		if (!data?.events?.length) return;
		this.commit(i18n.t("toast.pasted"), model => {
			const snappeeMap = new Map();
			if (duplicateSnappees) {
				const names = new Set(model.snappees.map(snappee => snappee.name));
				const referencedSnappees = new Set(data.events
					.flatMap(event => [event.snappee, event.tipPointSpawnSnappee])
					.filter(value => value != null));
				const sourceSnappees = data.snappees?.length
					? data.snappees
					: model.snappees.filter(snappee => referencedSnappees.has(snappee.id));
				const duplicateName = base => {
					let suffix = 2;
					let name = `${base} ${suffix}`;
					while (names.has(name)) name = `${base} ${++suffix}`;
					names.add(name);
					return name;
				};
				for (const snappee of sourceSnappees) {
					const copy = model.addSnappee({ ...deepClone(snappee), id: null, selected: false, name: duplicateName(snappee.name) });
					snappeeMap.set(snappee.id, copy.id);
				}
			}
			for (const event of model.events) event.selected = false;
			const currentChannel = model.channels.findIndex(channel => channel.id === model.editor.currentChannel);
			const channelOffset = event => Math.max(0, Math.round(Number(event.channelOffset ?? event.channel) || 0));
			const maximumOffset = Math.max(...data.events.map(channelOffset));
			while (currentChannel + maximumOffset >= model.channels.length) model.addChannel(model.channels.length);
			model.editor.currentChannel = model.channels[currentChannel].id;
			for (const source of data.events) {
				const copy = deepClone(source);
				copy.id = null;
				copy.time = this.currentBeat().add(copy.beat ?? copy.time ?? 0).toJSON();
				copy.channel = model.channels[currentChannel + channelOffset(copy)].id;
				copy.selected = true;
				delete copy.beat;
				delete copy.channelOffset;
				if (duplicateSnappees && snappeeMap.has(copy.snappee)) copy.snappee = snappeeMap.get(copy.snappee);
				if (duplicateSnappees && snappeeMap.has(copy.tipPointSpawnSnappee)) copy.tipPointSpawnSnappee = snappeeMap.get(copy.tipPointSpawnSnappee);
				const pasted = model.addEvent(copy);
				constrainPastedEvent(model, pasted);
			}
		});
	}

	async showSelectionFilter() {
		const values = await this.dialogs.form({
			titleKey: "dialog.selectFilter",
			values: {
				enableTypes: true, enableText: false, text: "", enableTime: false,
				timeStart: [0, 0, 1], timeEnd: [9999, 0, 1], enableDuration: false,
				durationStart: [0, 0, 1], durationEnd: [9999, 0, 1], enableSimultaneous: false,
			},
			fields: [
				{ id: "enableTypes", type: "checkbox", labelKey: "field.types" },
				...EVENT_TYPES.map(type => ({ id: `type_${type}`, type: "checkbox", labelKey: `event.${type}`, default: true,
					disabled: values => !values.enableTypes })),
				{ id: "enableTime", type: "checkbox", labelKey: "field.timeRange" },
				{ id: "timeStart", type: "rational", labelKey: "field.time", disabled: values => !values.enableTime },
				{ id: "timeEnd", type: "rational", labelKey: "field.duration", disabled: values => !values.enableTime },
				{ id: "enableText", type: "checkbox", labelKey: "field.text" },
				{ id: "text", type: "text", labelKey: "field.text", disabled: values => !values.enableText },
				{ id: "enableDuration", type: "checkbox", labelKey: "field.durationRange" },
				{ id: "durationStart", type: "rational", labelKey: "field.time", disabled: values => !values.enableDuration },
				{ id: "durationEnd", type: "rational", labelKey: "field.duration", disabled: values => !values.enableDuration },
				{ id: "enableSimultaneous", type: "checkbox", labelKey: "field.hasSimultaneous" },
				...EVENT_TYPES.map(type => ({ id: `simultaneous_${type}`, type: "checkbox", labelKey: `event.${type}`, default: true,
					disabled: values => !values.enableSimultaneous })),
			],
		});
		if (!values) return;
		const ids = this.model.events.filter(event => {
			if (values.enableTypes && !values[`type_${event.type}`]) return false;
			if (values.enableTime) {
				const beat = Rational.from(event.time);
				if (beat.compare(values.timeStart) < 0 || beat.compare(values.timeEnd) > 0) return false;
			}
			if (values.enableText && !String(event.text || "").toLocaleLowerCase().includes(String(values.text).toLocaleLowerCase())) return false;
			if (values.enableDuration) {
				if (!event.duration) return false;
				const duration = Rational.from(event.duration);
				if (duration.compare(values.durationStart) < 0 || duration.compare(values.durationEnd) > 0) return false;
			}
			if (values.enableSimultaneous) {
				const hasMatch = this.model.events.some(other => other.id !== event.id
					&& values[`simultaneous_${other.type}`]
					&& Rational.compare(other.time, event.time) === 0);
				if (!hasMatch) return false;
			}
			return true;
		}).map(event => event.id);
		this.selectEvents(ids, "replace");
	}

	async showSubdivisionDialog() {
		const values = await this.dialogs.form({
			titleKey: "dialog.subdivision",
			values: { subdivision: this.model.editor.subdivision },
			fields: [{ id: "subdivision", type: "integer", labelKey: "dialog.subdivision", positive: true, min: 1 }],
		});
		if (values) this.setSubdivision(values.subdivision);
	}

	async showBackgroundPatternDialog() {
		this.exitModes();
		const patternOptions = ["bigText", "grid", "hexagon", "checkerboard", "diamondGrid", "pentagon", "turntable", "hexagram"];
		const values = await this.dialogs.form({
			titleKey: "dialog.backgroundPattern",
			values: { type: "grid", duration: [1, 0, 1], text: "" },
			fields: [
				{ id: "type", type: "radio", labelKey: "field.type", options: patternOptions.map(value => ({ value, labelKey: `event.${value}` })) },
				{ id: "duration", type: "rational", labelKey: "field.duration", positive: true },
				{ id: "text", type: "text", labelKey: "field.text", disabled: form => form.type !== "bigText", required: true },
			],
		});
		if (!values) return;
		this.commit(i18n.t("history.createEvent", { type: eventTypeLabel(values.type) }), model => {
			for (const event of model.events) event.selected = false;
			model.addEvent(values.type, {
				time: this.currentBeat().toJSON(),
				channel: model.editor.currentChannel,
				duration: values.duration,
				text: values.type === "bigText" ? values.text : undefined,
				selected: true,
			});
		});
	}

	async showBpmDialog(index = null) {
		this.exitModes();
		const beat = this.currentBeat();
		if (index == null) index = this.model.timing.bpmChanges.findIndex(change => Rational.from(change.time).equals(beat));
		const current = index >= 0 ? this.model.timing.bpmChanges[index] : null;
		const eventBeat = current ? Rational.from(current.time) : beat;
		const values = await this.dialogs.form({
			titleKey: "dialog.bpmChange",
			values: { bpm: current?.bpm || this.model.timing.bpmAtBeat(beat) },
			fields: [
				{ id: "bpm", type: "number", labelKey: "field.bpm", positive: true, min: 0.001, step: "any" },
			],
		});
		if (!values) return;
		this.commit(i18n.t("dialog.bpmChange"), model => {
			const changes = model.timing.toJSON().bpmChanges;
			if (index >= 0) changes.splice(index, 1);
			changes.push({ time: eventBeat.toJSON(), bpm: values.bpm });
			model.timing.setBpmChanges(changes);
		});
	}

	uniqueSnappeeName(base) {
		const names = new Set(this.model.snappees.map(snappee => snappee.name));
		if (!names.has(base)) return base;
		let suffix = 2;
		while (names.has(`${base} ${suffix}`)) suffix += 1;
		return `${base} ${suffix}`;
	}

	defaultSnappeeName(type) {
		const base = i18n.t(`snappee.${type}`);
		let index = 1;
		const names = new Set(this.model.snappees.map(snappee => snappee.name));
		while (names.has(`${base} ${index}`)) index += 1;
		return `${base} ${index}`;
	}

	snappeeFields(type, editing = false) {
		const fields = [
			{ id: "name", type: "text", labelKey: "field.name", required: true },
			{ id: "color", type: "color", labelKey: "field.color", required: true },
		];
		if (type === "rectangularMesh") fields.push(
			{ id: "topLeft", type: "pair", labelKey: "field.topLeft", expression: true, required: true },
			{ id: "bottomRight", type: "pair", labelKey: "field.bottomRight", expression: true, required: true },
			{ id: "tiles", type: "pair", labelKey: "field.tiles", numeric: true, integer: true },
		);
		else if (type === "radialMesh") fields.push(
			{ id: "center", type: "pair", labelKey: "field.center", expression: true, required: true },
			{ id: "radius", type: "expression", labelKey: "field.radius", required: true },
			{ id: "tiles", type: "pair", labelKey: "field.tiles", numeric: true, integer: true },
			{ id: "startingAngle", type: "angle", labelKey: "field.direction" },
		);
		else if (type === "parametricMesh") fields.push(
			{ id: "iRange", type: "range", labelKey: "field.iRange" },
			{ id: "jRange", type: "range", labelKey: "field.jRange" },
			{ id: "xExpression", type: "text", labelKey: "field.xExpression", required: true },
			{ id: "yExpression", type: "text", labelKey: "field.yExpression", required: true },
		);
		else if (type === "regularPolygonCurve") fields.push(
			{ id: "center", type: "pair", labelKey: "field.center", expression: true, required: true },
			{ id: "radius", type: "expression", labelKey: "field.radius", required: true },
			{ id: "sides", type: "integer", labelKey: "field.sides", positive: true, min: 3 },
			{ id: "angle", type: "angle", labelKey: "field.direction" },
			{ id: "segmentsPerSide", type: "integer", labelKey: "field.segmentsPerSide", positive: true, min: 1 },
		);
		else if (type === "parametricCurve") fields.push(
			{ id: "iRange", type: "range", labelKey: "field.iRange" },
			{ id: "xExpression", type: "text", labelKey: "field.xExpression", required: true },
			{ id: "yExpression", type: "text", labelKey: "field.yExpression", required: true },
			{ id: "closed", type: "checkbox", labelKey: "field.closed" },
		);
		else if (type === "bezierCurve") fields.push(
			{ id: "controlPoints", type: "array", itemType: "pair", item: { expression: true, required: true },
				labelKey: "field.controlPoints", stacked: true, minItems: 2, newItem: [0, 0] },
			{ id: "segments", type: "integer", labelKey: "field.segments", positive: true, min: 1 },
			{ id: "closed", type: "checkbox", labelKey: "field.closed" },
		);
		else if (type === "circularArcCurve") fields.push(
			{ id: "center", type: "pair", labelKey: "field.center", expression: true, required: true },
			{ id: "radius", type: "expression", labelKey: "field.radius", required: true },
			{ id: "closed", type: "checkbox", labelKey: "field.closed" },
			{ id: "beginningAngle", type: "angle", labelKey: "field.beginningAngle", required: true },
			{ id: "endAngle", type: "angle", labelKey: "field.endAngle", required: true, disabled: values => values.closed },
			{ id: "clockwise", type: "checkbox", labelKey: "field.clockwise", disabled: values => values.closed },
			{ id: "segments", type: "integer", labelKey: "field.segments", positive: true, min: 1 },
		);
		else if (type === "penCurve") fields.push(
			{
				id: "commands", type: "array", labelKey: "field.commands", stacked: true, minItems: 2,
				newItem: { type: "L", x: 0, y: 0, x1: 0, y1: 0, x2: 0, y2: 0 },
				fields: [
					{ id: "type", type: "select", labelKey: "field.command", options: ["M", "L", "Q", "C"] },
					{ id: "x", type: "expression", labelKey: "field.endX", required: true },
					{ id: "y", type: "expression", labelKey: "field.endY", required: true },
					{ id: "x1", type: "expression", labelKey: "field.control1X", required: true },
					{ id: "y1", type: "expression", labelKey: "field.control1Y", required: true },
					{ id: "x2", type: "expression", labelKey: "field.control2X", required: true },
					{ id: "y2", type: "expression", labelKey: "field.control2Y", required: true },
				],
			},
			{ id: "segments", type: "integer", labelKey: "field.segments", positive: true, min: 1 },
			{ id: "closed", type: "checkbox", labelKey: "field.closed" },
		);
		if (!editing) fields.push({ id: "transformation", type: "matrix", labelKey: "field.transform", numeric: true });
		return fields;
	}

	snappeeFormValues(type, snappee = null) {
		const source = snappee || {};
		const values = {
			...deepClone(source),
			name: source.name || this.defaultSnappeeName(type),
			color: source.color || SNAPPEE_COLORS[this.model.snappees.length % SNAPPEE_COLORS.length],
			transformation: source.transformation || [1, 0, 0, 1, 0, 0],
		};
		if (type === "rectangularMesh") Object.assign(values, {
			topLeft: [source.topLeftX ?? -100, source.topLeftY ?? 50],
			bottomRight: [source.bottomRightX ?? 100, source.bottomRightY ?? -50],
			tiles: [source.horizontalTiles ?? 8, source.verticalTiles ?? 4],
		});
		if (type === "radialMesh") Object.assign(values, {
			center: [source.centerX ?? 0, source.centerY ?? 0], radius: source.radius ?? "50",
			tiles: [source.azimuthalTiles ?? 8, source.radialTiles ?? 4],
			startingAngle: { value: (source.startingAngle ?? 0) * 180 / Math.PI, radians: false },
		});
		if (type === "parametricMesh") Object.assign(values, {
			iRange: { min: source.iRange?.[0] ?? -4, max: source.iRange?.[1] ?? 5, exclusive: source.iRangeExclusive ?? true },
			jRange: { min: source.jRange?.[0] ?? -2, max: source.jRange?.[1] ?? 3, exclusive: source.jRangeExclusive ?? true },
			xExpression: source.xExpression || "i * 25", yExpression: source.yExpression || "j * 25",
		});
		if (type === "regularPolygonCurve") Object.assign(values, {
			center: [source.centerX ?? 0, source.centerY ?? 0], radius: source.radius ?? "50", sides: source.sides ?? 5,
			angle: { value: (source.angle ?? Math.PI / 2) * 180 / Math.PI, radians: false }, segmentsPerSide: source.segmentsPerSide ?? 4,
		});
		if (type === "parametricCurve") Object.assign(values, {
			iRange: { min: source.iRange?.[0] ?? 0, max: source.iRange?.[1] ?? 16, exclusive: source.iRangeExclusive ?? true },
			xExpression: source.xExpression || "50 * cos(2 * pi * i / 16)",
			yExpression: source.yExpression || "50 * sin(2 * pi * i / 16)", closed: source.closed ?? true,
		});
		if (type === "bezierCurve") Object.assign(values, {
			controlPoints: (source.controlPoints || [{ x: -50, y: 0 }, { x: 50, y: 0 }]).map(point => [point.x, point.y]),
			segments: source.segments ?? 16,
			closed: source.closed ?? false,
		});
		if (type === "circularArcCurve") Object.assign(values, {
			center: [source.centerX ?? 0, source.centerY ?? 0],
			radius: source.radius ?? "50",
			closed: source.closed ?? false,
			beginningAngle: { value: (source.beginningAngle ?? 0) * 180 / Math.PI, radians: false },
			endAngle: { value: (source.endAngle ?? Math.PI) * 180 / Math.PI, radians: false },
			clockwise: source.clockwise ?? false,
			segments: source.segments ?? 16,
		});
		if (type === "penCurve") Object.assign(values, {
			commands: (source.commands || [{ type: "M", x: -50, y: 0 }, { type: "L", x: 50, y: 0 }]).map(command => ({
				type: String(command.type || "L").toUpperCase(),
				x: command.x ?? 0, y: command.y ?? 0,
				x1: command.x1 ?? command.x ?? 0, y1: command.y1 ?? command.y ?? 0,
				x2: command.x2 ?? command.x ?? 0, y2: command.y2 ?? command.y ?? 0,
			})),
			segments: source.segments ?? 16,
			closed: source.closed ?? false,
		});
		return values;
	}

	angleValue(value) {
		const number = evaluateExpression(value?.value, 0);
		return value?.radians ? number : number * Math.PI / 180;
	}

	formToSnappee(type, values) {
		const result = { name: values.name, color: values.color, transformation: (values.transformation || [1, 0, 0, 1, 0, 0]).map(value => evaluateExpression(value)) };
		if (type === "rectangularMesh") Object.assign(result, {
			topLeftX: evaluateExpression(values.topLeft[0]), topLeftY: evaluateExpression(values.topLeft[1]),
			bottomRightX: evaluateExpression(values.bottomRight[0]), bottomRightY: evaluateExpression(values.bottomRight[1]),
			horizontalTiles: Math.max(1, Math.floor(values.tiles[0])), verticalTiles: Math.max(1, Math.floor(values.tiles[1])),
		});
		else if (type === "radialMesh") Object.assign(result, {
			centerX: evaluateExpression(values.center[0]), centerY: evaluateExpression(values.center[1]), radius: Math.abs(evaluateExpression(values.radius, 50)),
			azimuthalTiles: Math.max(1, Math.floor(values.tiles[0])), radialTiles: Math.max(1, Math.floor(values.tiles[1])),
			startingAngle: this.angleValue(values.startingAngle),
		});
		else if (type === "parametricMesh") Object.assign(result, {
			iRange: [values.iRange.min, values.iRange.max], iRangeExclusive: values.iRange.exclusive,
			jRange: [values.jRange.min, values.jRange.max], jRangeExclusive: values.jRange.exclusive,
			xExpression: values.xExpression, yExpression: values.yExpression,
		});
		else if (type === "regularPolygonCurve") Object.assign(result, {
			centerX: evaluateExpression(values.center[0]), centerY: evaluateExpression(values.center[1]), radius: Math.abs(evaluateExpression(values.radius, 50)),
			sides: Math.max(3, Math.floor(values.sides)), angle: this.angleValue(values.angle),
			segmentsPerSide: Math.max(1, Math.floor(values.segmentsPerSide)), closed: true,
		});
		else if (type === "parametricCurve") Object.assign(result, {
			iRange: [values.iRange.min, values.iRange.max], iRangeExclusive: values.iRange.exclusive,
			xExpression: values.xExpression, yExpression: values.yExpression, closed: values.closed,
		});
		else if (type === "bezierCurve") Object.assign(result, {
			degree: Math.max(1, values.controlPoints.length - 1),
			controlPoints: values.controlPoints.map(point => ({ x: evaluateExpression(point[0]), y: evaluateExpression(point[1]) })),
			segments: Math.max(1, Math.floor(values.segments)), closed: Boolean(values.closed),
		});
		else if (type === "circularArcCurve") Object.assign(result, {
			centerX: evaluateExpression(values.center[0]), centerY: evaluateExpression(values.center[1]),
			radius: Math.abs(evaluateExpression(values.radius, 50)), closed: Boolean(values.closed),
			beginningAngle: this.angleValue(values.beginningAngle),
			endAngle: this.angleValue(values.endAngle), clockwise: Boolean(values.clockwise),
			segments: Math.max(1, Math.floor(values.segments)),
		});
		else if (type === "penCurve") Object.assign(result, {
			commands: values.commands.map((command, index) => {
				const type = index === 0 ? "M" : ["L", "Q", "C"].includes(String(command.type).toUpperCase()) ? String(command.type).toUpperCase() : "L";
				const item = { type, x: evaluateExpression(command.x), y: evaluateExpression(command.y) };
				if (type === "Q" || type === "C") Object.assign(item, { x1: evaluateExpression(command.x1), y1: evaluateExpression(command.y1) });
				if (type === "C") Object.assign(item, { x2: evaluateExpression(command.x2), y2: evaluateExpression(command.y2) });
				return item;
			}),
			segments: Math.max(1, Math.floor(values.segments)), closed: Boolean(values.closed),
		});
		return result;
	}

	async showSnappeeDialog(type, id = null) {
		this.exitModes();
		const source = id == null ? null : this.model.snappees.find(snappee => snappee.id === id);
		const values = await this.dialogs.form({
			titleKey: "dialog.editSnappee",
			values: this.snappeeFormValues(type, source),
			fields: this.snappeeFields(type, Boolean(source)),
		});
		if (!values) return;
		const data = this.formToSnappee(type, values);
		this.commit(source ? i18n.t("history.editSnappee") : i18n.t("history.createSnappee"), model => {
			if (source) mutateSnappeeWithinBounds(model, id, snappee => { Object.assign(snappee, data); });
			else model.addSnappee(type, data);
		});
	}

	selectSnappee(id) {
		if (this.audio.playing) return;
		for (const snappee of this.model.snappees) snappee.selected = snappee.id === id && snappee.active;
		this.refresh();
	}

	toggleSnappee(id) {
		this.commit(i18n.t("history.editSnappee"), model => {
			const snappee = model.snappees.find(item => item.id === id);
			if (snappee) { snappee.active = !snappee.active; if (!snappee.active) snappee.selected = false; }
		});
	}

	duplicateSnappee(id) {
		this.commit(i18n.t("history.createSnappee"), model => {
			const source = model.snappees.find(item => item.id === id);
			if (!source) return;
			model.addSnappee({ ...deepClone(source), id: null, selected: false, name: this.uniqueSnappeeName(source.name) });
		});
	}

	async deleteSnappee(id) {
		if (!await this.dialogs.confirm({ titleKey: "dialog.deleteSnappee", messageKey: "dialog.deleteSnappeeMessage" })) return;
		this.commit(i18n.t("history.editSnappee"), model => model.removeSnappee(id));
	}

	async editSnappee(id) {
		if (this.audio.playing) return;
		const snappee = this.model.snappees.find(item => item.id === id);
		if (snappee) await this.showSnappeeDialog(snappee.type, id);
	}

	startCurveDraft(type) {
		this.exitModes();
		this.curveDraft = {
			type,
			points: [],
			...(type === "penCurve" ? { penNodes: [] } : {}),
			name: this.defaultSnappeeName(type),
			color: SNAPPEE_COLORS[this.model.snappees.length % SNAPPEE_COLORS.length],
		};
		this.history.record(this.model.snapshot(), i18n.t("history.editSnappee"),
			{ curveDraft: deepClone(this.curveDraft) }, { force: true });
		this.refresh();
	}

	startPenNode(point) {
		if (this.curveDraft?.type !== "penCurve") return null;
		const first = this.curveDraft.penNodes[0];
		if (first && this.curveDraft.penNodes.length >= 2
			&& Math.hypot(first.x - point.x, first.y - point.y) < 3) {
			this.curveDraft.closed = true;
			this.recordCurveDraftAction();
			this.finishCurveDraft();
			return null;
		}
		const node = { x: Number(point.x), y: Number(point.y), incoming: null, outgoing: null };
		this.curveDraft.penNodes.push(node);
		this.curveDraft.points.push({ x: node.x, y: node.y });
		this.refresh();
		return this.curveDraft.penNodes.length - 1;
	}

	setPenNodeDrag(index, point, record = false) {
		const draft = this.curveDraft;
		const node = draft?.type === "penCurve" ? draft.penNodes?.[index] : null;
		if (!node) return;
		const outgoing = { x: Number(point.x), y: Number(point.y) };
		if (Math.hypot(outgoing.x - node.x, outgoing.y - node.y) < 0.25) {
			node.incoming = null;
			node.outgoing = null;
		} else {
			node.outgoing = outgoing;
			node.incoming = { x: node.x * 2 - outgoing.x, y: node.y * 2 - outgoing.y };
		}
		if (record) this.recordCurveDraftAction();
		this.refresh();
	}

	setPenNodeHandle(index, kind, point, record = false) {
		const draft = this.curveDraft;
		const node = draft?.type === "penCurve" ? draft.penNodes?.[index] : null;
		if (!node || !["incoming", "outgoing"].includes(kind)) return;
		node[kind] = { x: Number(point.x), y: Number(point.y) };
		if (record) this.recordCurveDraftAction();
		this.refresh();
	}

	recordPenNode() {
		if (this.curveDraft?.type !== "penCurve") return;
		this.recordCurveDraftAction();
		this.refresh();
	}

	addCurvePoint(point, finish = false) {
		if (!this.curveDraft) return;
		const snap = findNearestSnapPoint(point, this.model.snappees, { activeOnly: true, maxDistance: 5 });
		const finalPoint = snap ? { x: snap.x, y: snap.y } : { x: point.x, y: point.y };
		const first = this.curveDraft.points[0];
		const last = this.curveDraft.points.at(-1);
		const closesArc = this.curveDraft.type === "circularArcCurve" && this.curveDraft.points.length >= 2
			&& Math.hypot(this.curveDraft.points[1].x - finalPoint.x, this.curveDraft.points[1].y - finalPoint.y) < 3;
		if (closesArc || (this.curveDraft.type !== "circularArcCurve" && first
			&& Math.hypot(first.x - finalPoint.x, first.y - finalPoint.y) < 3 && this.curveDraft.points.length >= 2)) {
			this.curveDraft.closed = true;
			finish = true;
		} else if (!(finish && last && Math.hypot(last.x - finalPoint.x, last.y - finalPoint.y) < 3)) {
			this.curveDraft.points.push(finalPoint);
		}
		if (this.curveDraft.type === "circularArcCurve" && this.curveDraft.points.length >= 3) finish = true;
		this.recordCurveDraftAction();
		if (finish) this.finishCurveDraft(); else this.refresh();
	}

	activateCurveDraftPoint(index) {
		const draft = this.curveDraft;
		if (!draft || draft.points.length < 2) return false;
		const closes = draft.type === "circularArcCurve" ? index === 1 : index === 0;
		if (!closes) return false;
		draft.closed = true;
		this.recordCurveDraftAction();
		this.finishCurveDraft();
		return true;
	}

	recordCurveDraftAction() {
		if (!this.curveDraft) return;
		this.history.record(this.model.snapshot(), i18n.t("history.editSnappee"),
			{ curveDraft: deepClone(this.curveDraft) }, { force: true });
	}

	finishCurveDraftFromDoubleClick() {
		if (!this.curveDraft) return;
		const points = this.curveDraft.points;
		if (points.length > 2 && Math.hypot(points.at(-1).x - points.at(-2).x, points.at(-1).y - points.at(-2).y) < 3) {
			points.pop();
			if (this.curveDraft.type === "penCurve") this.curveDraft.penNodes?.pop();
			this.recordCurveDraftAction();
		}
		this.finishCurveDraft();
	}

	moveCurveDraftPoint(index, point, record = false) {
		if (!this.curveDraft?.points[index]) return;
		if (this.curveDraft.type === "penCurve" && this.curveDraft.penNodes?.[index]) {
			const node = this.curveDraft.penNodes[index];
			const dx = Number(point.x) - node.x;
			const dy = Number(point.y) - node.y;
			node.x += dx;
			node.y += dy;
			if (node.incoming) { node.incoming.x += dx; node.incoming.y += dy; }
			if (node.outgoing) { node.outgoing.x += dx; node.outgoing.y += dy; }
		}
		this.curveDraft.points[index] = { x: Number(point.x), y: Number(point.y) };
		if (record) this.recordCurveDraftAction();
		this.refresh();
	}

	finishCurveDraft() {
		const draft = this.curveDraft;
		if (!draft || draft.points.length < 2) { this.curveDraft = null; this.refresh(); return; }
		let data;
		if (draft.type === "bezierCurve") {
			data = { name: draft.name, color: draft.color, degree: draft.points.length - 1,
				controlPoints: draft.points, segments: Math.max(8, draft.points.length * 6), closed: Boolean(draft.closed) };
		} else if (draft.type === "circularArcCurve") {
			const [center, beginning, ending = beginning] = draft.points;
			data = { name: draft.name, color: draft.color, centerX: center.x, centerY: center.y,
				radius: Math.hypot(beginning.x - center.x, beginning.y - center.y),
				beginningAngle: Math.atan2(beginning.y - center.y, beginning.x - center.x),
				endAngle: Math.atan2(ending.y - center.y, ending.x - center.x), clockwise: false,
				closed: Boolean(draft.closed), segments: 24 };
		} else {
			data = { name: draft.name, color: draft.color,
				commands: penCommandsFromNodes(draft.penNodes || draft.points, Boolean(draft.closed)),
				segments: Math.max(8, draft.points.length * 4), closed: Boolean(draft.closed) };
		}
		this.curveDraft = null;
		this.commit(i18n.t("history.createSnappee"), model => model.addSnappee(draft.type, data));
	}

	fillSelectedCurve() {
		const snappee = this.model.snappees.find(item => item.selected && !item.type.endsWith("Mesh"));
		if (!snappee) return;
		this.commit(i18n.t("history.createEvent", { type: eventTypeLabel("drag") }), model => {
			const points = sampleSnappee(snappee).filter(point => pointAllowed(model, point));
			if (!points.length) return;
			for (const event of model.events) event.selected = false;
			points.forEach((point, index) => model.addEvent("drag", {
				time: this.currentBeat().add(new Rational(index, model.editor.subdivision)).toJSON(),
				channel: model.editor.currentChannel,
				attached: true, snappee: snappee.id, snapPoint: deepClone(point.snapPoint), selected: true,
			}));
		});
	}
}

const app = new SviberApp();
globalThis.sviber = app;
app.initialize().catch(error => {
	console.error(error);
	const loading = document.getElementById("loading-screen");
	loading.querySelector("span:last-child").textContent = i18n.t("error.startup", { message: localizedErrorMessage(error) });
});
