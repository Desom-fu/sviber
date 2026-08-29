import assert from "node:assert/strict";
import test from "node:test";

import { History, captureHistoryView } from "../js/core/history.js";
import { ChartModel } from "../js/core/chart-model.js";
import { TimingMap } from "../js/core/timing.js";
import { withHistoryCommands } from "../js/app/app-history-commands.js";
import { withFreeTransform } from "../js/app/app-free-transform.js";
import { withChartTools } from "../js/app/app-chart-tools.js";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { ChartRenderIndex } from "../js/render/chart-index.js";

test("History view restores the snapped beat mode and visible time range between patches", () => {
	const base = {
		events: [],
		snappees: [],
		channels: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
		editor: {
			timeSnapped: true,
			currentTime: [1, 0, 1],
			visibleRangeBeginning: 0,
			visibleRangeEnd: 10,
			currentChannel: 0,
			timelineChannelOffset: 0,
		},
	};
	const history = new History(base);
	const first = { id: 1, type: "tap", time: [20, 0, 1], selected: true };
	const firstView = {
		...base,
		events: [first],
		editor: {
			timeSnapped: false,
			currentTime: 12.75,
			visibleRangeBeginning: 10,
			visibleRangeEnd: 20,
			currentChannel: 0,
			timelineChannelOffset: 2,
		},
	};
	history.recordPatch(
		{
			kind: "appendRootEvent",
			event: first,
			nextEventId: 2,
			view: captureHistoryView(firstView, { selectedEventIds: [first.id] }),
		},
		"Create first tap",
	);
	const second = { id: 2, type: "tap", time: [30, 0, 1], selected: true };
	const secondView = {
		...firstView,
		events: [first, second],
		editor: {
			timeSnapped: true,
			currentTime: [30, 0, 1],
			visibleRangeBeginning: 25,
			visibleRangeEnd: 35,
			currentChannel: 5,
			timelineChannelOffset: 3,
		},
	};
	history.recordPatch(
		{
			kind: "appendRootEvent",
			event: second,
			nextEventId: 3,
			view: captureHistoryView(secondView, { selectedEventIds: [second.id] }),
		},
		"Create second tap",
	);
	const restored = history.undo();
	assert.equal(restored.editor.timeSnapped, false);
	assert.equal(restored.editor.currentTime, 12.75);
	assert.equal(restored.editor.visibleRangeBeginning, 10);
	assert.equal(restored.editor.visibleRangeEnd, 20);
	assert.equal(restored.editor.timelineChannelOffset, 2);
	assert.deepEqual(
		restored.events.map(event => event.id),
		[1],
	);
});

test("channel deactivation is a distinct history view so activate is recorded", () => {
	const base = {
		events: [],
		snappees: [],
		channels: [
			{ id: 0, name: "A" },
			{ id: 1, name: "B" },
		],
		editor: { currentChannel: 1, timeSnapped: true, currentTime: [0, 0, 1] },
	};
	const history = new History(base);
	const deactivated = {
		...base,
		channels: [
			{ id: 0, name: "A", active: false },
			{ id: 1, name: "B" },
		],
	};
	assert.equal(history.recordView(captureHistoryView(deactivated), "Deactivate"), true);
	assert.equal(history.current.channels[0].active, false);
	const reactivated = {
		...deactivated,
		channels: [
			{ id: 0, name: "A", active: true },
			{ id: 1, name: "B" },
		],
	};
	assert.equal(history.recordView(captureHistoryView(reactivated), "Activate"), true);
	assert.equal(history.current.channels[0].active, true);
	assert.equal(history.undo().channels[0].active, false);
	assert.equal(history.redo().channels[0].active, true);
});

test("toggleChannel can deactivate then activate the same channel", () => {
	const App = withHistoryCommands(
		withFreeTransform(
			class {
				commit(label, mutation, options = {}) {
					return this._finishCommit(label, mutation, options, false);
				}

				_invalidatePlaybackSchedule() {}

				_normalizeGroupSelectionScope() {}

				refresh() {}

				refreshInteractionPreview() {}

				requestStatusUpdate() {}

				syncActiveDifficultyState() {}

				broadcastLiveChartUpdate() {}
			},
		),
	);
	App.prototype._refreshAfterCommit = function () {};
	const app = new App();
	app.model = ChartModel.createDefault({
		channels: [
			{ id: 0, name: "A" },
			{ id: 1, name: "B" },
		],
		editor: { currentChannel: 1 },
	});
	app.history = new History(app.model.snapshot());
	app.toggleChannel(0);
	assert.equal(app.model.channels[0].active, false);
	app.toggleChannel(0);
	assert.equal(app.model.channels[0].active, true);
});

test("moveSelectedChannel captures view and restores previous currentTime on undo", () => {
	const App = withHistoryCommands(
		withFreeTransform(
			class {
				commit(label, mutation, options = {}) {
					return this._finishCommit(label, mutation, options, false);
				}

				_invalidatePlaybackSchedule() {}

				_normalizeGroupSelectionScope() {}

				refresh() {}

				refreshInteractionPreview() {}

				requestStatusUpdate() {}

				syncActiveDifficultyState() {}

				broadcastLiveChartUpdate() {}
			},
		),
	);
	App.prototype._refreshAfterCommit = function () {};
	const app = new App();
	app.registry = { notify() {} };
	app.model = ChartModel.createDefault({
		channels: [
			{ id: 0, name: "A" },
			{ id: 1, name: "B" },
		],
		events: [{ id: 1, type: "tap", time: [5, 0, 1], channel: 0, selected: true }],
		editor: {
			currentChannel: 0,
			timeSnapped: true,
			currentTime: [5, 0, 1],
			visibleRangeBeginning: 0,
			visibleRangeEnd: 10,
		},
	});
	app.history = new History(app.model.snapshot());
	app.model.editor.currentTime = [8, 0, 1];
	app.timeline = {
		revealed: null,
		revealChannel(id) {
			this.revealed = id;
		},
	};
	app.moveSelectedChannel(1);
	assert.equal(app.model.events[0].channel, 1);
	assert.equal(app.timeline.revealed, 1);
	assert.deepEqual(app.history.current.editor.currentTime, [8, 0, 1]);
	const undone = app.history.undo();
	assert.equal(undone.events[0].channel, 0);
	assert.deepEqual(undone.editor.currentTime, [5, 0, 1]);
});

test("restoreHistorySnapshot seeks audio to the restored current seconds", async () => {
	const seekTimes = [];
	const snapshot = {
		metadata: { title: "Song", artist: "Artist" },
		timing: { offset: 0, initialBpm: 120, bpmChanges: [], barLines: [] },
		events: [],
		snappees: [],
		channels: [{ id: 0 }],
		editor: {
			currentTime: [4, 0, 1],
			timeSnapped: true,
			subdivision: 4,
			visibleRangeBeginning: 0,
			visibleRangeEnd: 10,
		},
	};
	const app = {
		projectTitle: "Song",
		projectArtist: "Artist",
		model: ChartModel.createDefault(),
		timing() {
			return new TimingMap(this.model.timing);
		},
		currentSeconds() {
			return this.timing().beatToSeconds(this.model.editor.currentTime);
		},
		_normalizeGroupSelectionScope() {},
		_invalidatePlaybackSchedule() {},
		syncProjectSharedFields() {},
		syncProjectHistorySharedFields() {},
		audio: {
			playing: false,
			seek(time) {
				seekTimes.push(time);
			},
		},
	};
	const { SviberAppCore } = await import("../js/app/app-core.js");
	SviberAppCore.prototype.restoreHistorySnapshot.call(app, snapshot);
	assert.deepEqual(app.model.editor.currentTime, [4, 0, 1]);
	assert.deepEqual(seekTimes, [2]);
});

test("custom subdivision is preserved and restored across patch undos", () => {
	const base = {
		events: [],
		snappees: [],
		channels: [{ id: 0 }],
		editor: {
			timeSnapped: true,
			subdivision: 2,
			currentTime: [166, 0, 1],
			visibleRangeBeginning: 30,
			visibleRangeEnd: 40,
			currentChannel: 0,
			timelineChannelOffset: 0,
			speed: 1,
		},
	};
	const history = new History(base);
	const drag1 = { id: 1, type: "drag", time: [166, 1, 12], selected: true };
	const view1 = {
		...base,
		events: [drag1],
		editor: {
			...base.editor,
			subdivision: 12,
			currentTime: [166, 1, 12],
		},
	};
	history.recordPatch(
		{
			kind: "appendRootEvent",
			event: drag1,
			nextEventId: 2,
			view: captureHistoryView(view1, { selectedEventIds: [drag1.id] }),
		},
		"创建 Drag 1",
	);

	const drag2 = { id: 2, type: "drag", time: [166, 2, 12], selected: true };
	const view2 = {
		...view1,
		events: [drag1, drag2],
		editor: {
			...view1.editor,
			currentTime: [166, 2, 12],
		},
	};
	history.recordPatch(
		{
			kind: "appendRootEvent",
			event: drag2,
			nextEventId: 3,
			view: captureHistoryView(view2, { selectedEventIds: [drag2.id] }),
		},
		"创建 Drag 2",
	);

	const drag3 = { id: 3, type: "drag", time: [166, 3, 12], selected: true };
	const view3 = {
		...view2,
		events: [drag1, drag2, drag3],
		editor: {
			...view2.editor,
			currentTime: [166, 3, 12],
		},
	};
	history.recordPatch(
		{
			kind: "appendRootEvent",
			event: drag3,
			nextEventId: 4,
			view: captureHistoryView(view3, { selectedEventIds: [drag3.id] }),
		},
		"创建 Drag 3",
	);

	assert.equal(history.current.editor.subdivision, 12);
	assert.deepEqual(history.current.editor.currentTime, [166, 3, 12]);

	const undone1 = history.undo(); // Undo drag 3 -> back to drag 2
	assert.equal(undone1.editor.subdivision, 12);
	assert.deepEqual(undone1.editor.currentTime, [166, 2, 12]);

	const undone2 = history.undo(); // Undo drag 2 -> back to drag 1
	assert.equal(undone2.editor.subdivision, 12);
	assert.deepEqual(undone2.editor.currentTime, [166, 1, 12]);
});

test("closed bezier curve draft appends starting point to controlPoints to match preview loop", () => {
	class BaseApp {
		constructor() {
			this.model = ChartModel.createDefault();
			this.history = new History(this.model.snapshot());
			this.curveDraft = null;
		}

		commit(name, action) {
			action(this.model);
			this.history.recordView(captureHistoryView(this.model), name);
		}

		async showSnappeeDialog() {}

		exitModes() {}

		refreshInteractionPreview() {}

		_refreshLightweight() {}
	}
	const TestApp = withChartTools(BaseApp);
	const app = new TestApp();
	app.showSnappeeDialog = async () => {};

	app.curveDraft = {
		type: "bezierCurve",
		name: "Bézier 曲线 1",
		color: "#00e0ad",
		points: [
			{ x: 0, y: 0 },
			{ x: 50, y: 50 },
			{ x: -50, y: 50 },
			{ x: -50, y: -50 },
			{ x: 50, y: -50 },
		],
		closed: false,
	};

	// User clicks on first point (0, 0) to close the loop
	app.addCurvePoint({ x: 0, y: 0 });

	const created = app.model.snappees.at(-1);
	assert.equal(created.type, "bezierCurve");
	assert.equal(created.closed, true);
	assert.equal(created.controlPoints.length, 6);
	assert.deepEqual(created.controlPoints[0], { x: 0, y: 0 });
	assert.deepEqual(created.controlPoints.at(-1), { x: 0, y: 0 });
	assert.equal(created.degree, 5);
});

test("restoring a chart title leaves other difficulties unchanged", async () => {
	const { SviberAppCore } = await import("../js/app/app-core.js");
	const app = Object.create(SviberAppCore.prototype);
	const first = ChartModel.createDefault({
		metadata: { title: "Easy Song", artist: "Artist" },
	});
	const second = ChartModel.createDefault({
		metadata: { title: "Hard Mix", artist: "Artist" },
	});
	app.installProject(
		[
			{ id: "difficulty-1", file: "easy.json", model: first },
			{ id: "difficulty-2", file: "hard.json", model: second },
		],
		{ activeChart: "difficulty-1", name: "Folder", artist: "Artist", saved: true },
	);
	app._normalizeGroupSelectionScope = () => {};
	app._invalidatePlaybackSchedule = () => {};
	app.audio = { playing: false, seek() {} };
	app.currentSeconds = () => 0;
	const snapshot = app.model.snapshot();
	snapshot.metadata = { ...snapshot.metadata, title: "Easy Prime" };
	SviberAppCore.prototype.restoreHistorySnapshot.call(app, snapshot);
	assert.equal(app.model.metadata.title, "Easy Prime");
	assert.equal(app.difficulties[1].model.metadata.title, "Hard Mix");
});

function makeDurationDragApp(trackRebuilds) {
	return withHistoryCommands(
		withEventEditing(
			class {
				commit(label, mutation, options = {}) {
					if (this.model.editor.readOnly && !options.allowReadOnly) {
						return null;
					}
					let previewScheduleDirty = false;
					let previewBaseState = null;
					if (this.previewBase) {
						previewScheduleDirty = this.previewScheduleDirty;
						if (options.skipPreviewRestore) {
							previewBaseState = this.previewBase;
						} else {
							this.model.restore(this.previewBase);
						}
						this.previewBase = null;
						this.previewScheduleDirty = false;
					}
					return this._finishCommit(label, mutation, options, previewScheduleDirty, previewBaseState);
				}

				_rebuildRenderIndex() {
					if (trackRebuilds) {
						trackRebuilds.count += 1;
					}
					this.renderIndex = new ChartRenderIndex(this.model, this.model.timing, {});
					return this.renderIndex;
				}

				viewState() {
					return { renderIndex: this.renderIndex };
				}

				timeline = { setState() {}, requestRender() {} };

				stage = { setState() {}, requestRender() {} };

				_invalidatePlaybackSchedule() {}

				_normalizeGroupSelectionScope() {}

				refresh() {}

				refreshInteractionPreview() {}

				cancelPreview() {}

				restoreHistorySnapshot(snapshot) {
					this.model.restore(snapshot);
					this._rebuildRenderIndex();
				}

				queueMediaSync() {}

				updateDirty() {}

				preview(label, mutation, options = {}) {
					if (!this.previewBase) {
						this.previewBase = this.model.snapshot();
					}
					this.previewScheduleDirty ||= Boolean(options.scheduleDirty);
					if (!options.incremental) {
						this.model.restore(this.previewBase);
					}
					mutation(this.model);
					if (options.lightweight) {
						this.refreshInteractionPreview({
							rebuildIndex: options.rebuildIndex !== false,
							stageOnly: options.stageOnly,
						});
					} else {
						this.refresh();
					}
				}

				requestStatusUpdate() {}

				syncActiveDifficultyState() {}

				broadcastLiveChartUpdate() {}
			},
		),
	);
}

test("a duration drag commits one undoable resize and keeps the render index usable", () => {
	globalThis.document = { title: "", getElementById: () => null };
	const trackRebuilds = { count: 0 };
	const EditingApp = makeDurationDragApp(trackRebuilds);
	const app = new EditingApp();
	app.model = ChartModel.createDefault();
	const hold = app.model.addEvent("hold", { time: [4, 0, 1], x: 0, y: 0, duration: [0, 2, 1] });
	app.history = new History(app.model.snapshot());
	app._rebuildRenderIndex();
	const callbacks = app._timelineCallbacks();
	const rebuildsBefore = trackRebuilds.count;
	// Two incremental preview moves, then the release commit.
	callbacks.onPreviewDurations([{ id: hold.id, duration: [0, 3, 1] }]);
	callbacks.onPreviewDurations([{ id: hold.id, duration: [0, 5, 1] }]);
	callbacks.onResizeEvents([{ id: hold.id, duration: [0, 6, 1] }]);
	assert.equal(app.model.findEvent(hold.id).duration[0], 6);
	// The whole drag runs without a single full index rebuild.
	assert.equal(trackRebuilds.count - rebuildsBefore, 0);
	// One undoable edit: undo restores the pre-drag duration and the index follows.
	app.undo();
	assert.equal(app.model.findEvent(hold.id).duration[0], 2);
	assert.equal(app.renderIndex.eventSource, app.model.events);
});
