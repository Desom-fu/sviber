import assert from "node:assert/strict";
import test from "node:test";
import { withAttachment } from "../js/app/app-attachment.js";
import { withCurveDraft } from "../js/app/app-curve-draft.js";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { withHistoryCommands } from "../js/app/app-history-commands.js";
import { CommandRegistry } from "../js/app/commands.js";
import { ChartModel } from "../js/core/chart-model.js";
import { History } from "../js/core/history.js";
import { ChartRenderIndex } from "../js/render/chart-index.js";
import { MenuBar, Toolbar } from "../js/ui/ui-shell.js";

function createNode(tag) {
	const node = {
		tagName: tag,
		className: "",
		disabled: false,
		dataset: {},
		children: [],
		attributes: {},
		classes: new Set(),
		textContent: "",
		classList: {
			add(name) {
				node.classes.add(name);
			},
			remove(name) {
				node.classes.delete(name);
			},
			toggle(name, on) {
				if (on) {
					node.classes.add(name);
				} else {
					node.classes.delete(name);
				}
			},
			contains(name) {
				return node.classes.has(name);
			},
		},
		setAttribute(name, value) {
			node.attributes[name] = String(value);
		},
		appendChild(child) {
			node.children.push(child);
			return child;
		},
		append(...items) {
			node.children.push(...items);
		},
		replaceChildren(...items) {
			node.children.length = 0;
			node.children.push(...items);
		},
		querySelector(selector) {
			const wanted = selector.startsWith(".") ? selector.slice(1) : null;
			for (const child of node.children) {
				if (wanted && child.className.split(/\s+/).includes(wanted)) {
					return child;
				}
				const nested = child.querySelector?.(selector);
				if (nested) {
					return nested;
				}
			}
			return null;
		},
		getBoundingClientRect() {
			return { right: 0 };
		},
		addEventListener() {},
		removeEventListener() {},
	};
	return node;
}

function createFakeDocument(elements) {
	return {
		title: "",
		documentElement: { clientWidth: 1280 },
		createElement: tag => createNode(tag),
		createTextNode: text => ({ textContent: String(text) }),
		getElementById: id => elements[id] || null,
		querySelector: () => null,
		addEventListener() {},
		removeEventListener() {},
	};
}

function createHarnessApp() {
	const App = withAttachment(
		withCurveDraft(
			withHistoryCommands(
				withEventEditing(
					class {
						commit(label, mutation, options = {}) {
							return this._finishCommit(label, mutation, options, false);
						}

						_rebuildRenderIndex() {
							this.renderIndex = new ChartRenderIndex(this.model, this.model.timing, {});
							return this.renderIndex;
						}

						timing() {
							return this.model.timing;
						}

						currentBeat() {
							return this.model.timing.secondsToSnappedBeat(0, this.model.editor.subdivision);
						}

						currentSeconds() {
							return 0;
						}

						viewState() {
							return { renderIndex: this.renderIndex };
						}

						audio = { playing: false, buffer: null, pause() {}, seek() {} };

						autosave = { index: [] };

						files = {};

						timeline = { setState() {}, requestRender() {}, revealChannel() {} };

						stage = { setState() {}, requestRender() {} };

						scrollView = { setState() {}, requestRender() {} };

						preferences = { visibleChannels: 3, timelineChannelHeight: 48 };

						canReloadChartFromDisk() {
							return false;
						}

						canRenderVideo() {
							return false;
						}

						canRenderCover() {
							return false;
						}

						canBulkEditTextsSelection() {
							return false;
						}

						canBulkEditTextsByChannel() {
							return false;
						}

						canQuantizeSelection() {
							return false;
						}

						_invalidatePlaybackSchedule() {}

						_normalizeGroupSelectionScope() {}

						refresh() {}

						requestStatusUpdate() {}

						syncActiveDifficultyState() {}

						broadcastLiveChartUpdate() {}
					},
				),
			),
		),
	);
	return new App();
}

function createSyncHarness() {
	const toolbarEl = createNode("div");
	const menuEl = createNode("div");
	const doc = createFakeDocument({ "tool-bar": toolbarEl, "menu-bar": menuEl });
	const app = createHarnessApp();
	app.model = ChartModel.createDefault({
		channels: [
			{ id: 0, name: "Top", active: true },
			{ id: 1, name: "Mid", active: true },
			{ id: 2, name: "Bot", active: true },
		],
		events: [
			{ id: 1, type: "tap", channel: 0, time: [1, 0, 1], x: 0, y: 0 },
			{ id: 2, type: "tap", channel: 1, time: [2, 0, 1], x: 10, y: 0 },
			{ id: 3, type: "tap", channel: 2, time: [3, 0, 1], x: 20, y: 0 },
		],
		snappees: [{ id: 1, type: "rectangularMesh", name: "Grid", active: true, selected: false }],
		editor: { currentChannel: 1, currentTime: [0, 0, 1], subdivision: 4 },
	});
	app.history = new History(app.model.snapshot());
	app._rebuildRenderIndex();
	app.registry = new CommandRegistry();
	app._registerCommands();
	const toolbar = new Toolbar({
		element: toolbarEl,
		registry: app.registry,
		document: doc,
		contextProvider: () => app,
	});
	const menu = new MenuBar({
		element: menuEl,
		registry: app.registry,
		document: doc,
		contextProvider: () => app,
	});
	return { app, toolbar, menu, doc };
}

test("a single command notify refreshes every toolbar button against current context", () => {
	const previousDocument = globalThis.document;
	const element = createNode("div");
	globalThis.document = createFakeDocument({ "tool-bar": element });
	try {
		const registry = new CommandRegistry();
		let timeDragActive = false;
		const toolbar = new Toolbar({
			element,
			registry,
			document: globalThis.document,
			items: ["events.tap", "events.flick"],
			contextProvider: () => ({ timeDragActive: () => timeDragActive }),
		});
		assert.equal(toolbar.buttons.get("events.tap").disabled, false);
		assert.equal(toolbar.buttons.get("events.flick").disabled, false);
		timeDragActive = true;
		registry.notify("events.tap");
		assert.equal(toolbar.buttons.get("events.tap").disabled, true);
		assert.equal(toolbar.buttons.get("events.flick").disabled, true);
		timeDragActive = false;
		registry.notify("events.flick");
		assert.equal(toolbar.buttons.get("events.tap").disabled, false);
		assert.equal(toolbar.buttons.get("events.flick").disabled, false);
	} finally {
		globalThis.document = previousDocument;
	}
});

test("toolbar move-channel buttons stay in sync with lightweight edits and selections", () => {
	const previousDocument = globalThis.document;
	const { app, toolbar, menu, doc } = createSyncHarness();
	globalThis.document = doc;
	const aboveBtn = toolbar.buttons.get("events.moveChannelAbove");
	const belowBtn = toolbar.buttons.get("events.moveChannelBelow");
	const activateSnappeeBtn = toolbar.buttons.get("snappee.activate");
	const transformFreeBtn = toolbar.buttons.get("transform.free");
	try {
		// Initially nothing is selected.
		assert.equal(aboveBtn.disabled, true);
		assert.equal(belowBtn.disabled, true);

		// Selecting notes via pointer click updates toolbar immediately without opening a menu.
		app.selectEvents([1], "replace");
		assert.equal(aboveBtn.disabled, true);
		assert.equal(belowBtn.disabled, false);

		app.selectEvents([2], "replace");
		assert.equal(aboveBtn.disabled, false);
		assert.equal(belowBtn.disabled, false);

		// Clearing selection via timeline click disables both buttons immediately.
		app.seekBeat([0, 0, 1], null, true);
		assert.equal(aboveBtn.disabled, true);
		assert.equal(belowBtn.disabled, true);

		// Box selection updates toolbar immediately.
		app.finishSelectionPreview([3], "replace");
		assert.equal(aboveBtn.disabled, false);
		assert.equal(belowBtn.disabled, true);

		// Dragging the selected note upward onto channel 1 re-enables move-below.
		app.moveEvents([0, 0, 1], -1, false);
		assert.equal(aboveBtn.disabled, false);
		assert.equal(belowBtn.disabled, false);

		// Inspector channel edit moving the note to channel 0 disables move-above.
		app.editSelectedProperty("channel", 0);
		assert.equal(aboveBtn.disabled, true);
		assert.equal(belowBtn.disabled, false);

		// Reordering channel 0 below channel 1 in the Channels panel enables move-above.
		app.moveChannel(0, 1);
		assert.equal(aboveBtn.disabled, false);
		assert.equal(belowBtn.disabled, false);

		// After moving channel 0 down, channel order is [1, 0, 2] so currentChannel (1) is now on top.
		app.selectEvents([], "replace");
		assert.equal(aboveBtn.disabled, true);
		assert.equal(belowBtn.disabled, true);
		app.createPositionedEvent("tap", { x: 0, y: 0 });
		assert.equal(aboveBtn.disabled, true);
		assert.equal(belowBtn.disabled, false);

		// Switching currentChannel to the middle channel (0) and creating a note enables both buttons.
		app.selectChannel(0);
		app.createPositionedEvent("tap", { x: 10, y: 0 });
		assert.equal(aboveBtn.disabled, false);
		assert.equal(belowBtn.disabled, false);

		// Selecting a snappee in the Snappees panel updates snappee/transform toolbar buttons.
		app.selectEvents([], "replace");
		assert.equal(activateSnappeeBtn.disabled, true);
		assert.equal(transformFreeBtn.disabled, true);
		app.selectSnappee(1);
		assert.equal(activateSnappeeBtn.disabled, false);
		assert.equal(transformFreeBtn.disabled, false);
	} finally {
		menu.destroy();
		toolbar.destroy();
		globalThis.document = previousDocument;
	}
});

test("closed menus skip registry refresh work while open menus stay live", () => {
	const previousDocument = globalThis.document;
	const { app, toolbar, menu, doc } = createSyncHarness();
	globalThis.document = doc;
	try {
		let menuEvaluations = 0;
		const original = app.canMoveSelectedWithinChannel.bind(app);
		app.canMoveSelectedWithinChannel = direction => {
			menuEvaluations += 1;
			return original(direction);
		};
		// Selection updates toolbar, but closed menu does not evaluate menu-only predicates.
		app.selectEvents([2], "replace");
		assert.equal(menuEvaluations, 0);

		// Opening the Channel menu evaluates its commands against live state.
		const channelMenuIndex = menu.definition.findIndex(item => item.id === "channel");
		menu.open(channelMenuIndex);
		assert.ok(menuEvaluations > 0);
		const menuAbove = [...menu.commandButtons.get("events.moveChannelAbove")][0];
		assert.equal(menuAbove.disabled, false);

		// While open, registry notifications update the open menu live.
		app.selectEvents([1], "replace");
		assert.equal(menuAbove.disabled, true);
	} finally {
		menu.destroy();
		toolbar.destroy();
		globalThis.document = previousDocument;
	}
});

test("fast transformationAvailable matches transformationTargets across selection edge cases", () => {
	const previousDocument = globalThis.document;
	const { app, toolbar, menu, doc } = createSyncHarness();
	globalThis.document = doc;
	const checkMatches = label => {
		const { attachedIds, directEvents } = app.transformationTargets(app.model);
		const expected = attachedIds.size > 0 || directEvents.length > 0;
		assert.equal(app.transformationAvailable(app.model), expected, `${label} (indexed)`);
		const savedIndex = app.renderIndex;
		app.renderIndex = null;
		assert.equal(app.transformationAvailable(app.model), expected, `${label} (unindexed)`);
		app.renderIndex = savedIndex;
	};
	try {
		checkMatches("nothing selected, no snappee selected");
		app.model.snappees[0].selected = true;
		checkMatches("nothing selected, active snappee selected");
		app.model.snappees[0].active = false;
		checkMatches("nothing selected, inactive snappee selected");
		app.model.snappees[0].active = true;

		// Locked event selected blocks fallback to selected snappee.
		app.model.events[0].locked = true;
		app.selectEvents([1], "replace");
		checkMatches("only locked tap selected with selected snappee");

		// Comment selected is not movable and blocks snappee fallback.
		const comment = app.model.addEvent("comment", { channel: 0, time: [4, 0, 1], text: "note" });
		app._rebuildRenderIndex();
		app.selectEvents([comment.id], "replace");
		checkMatches("comment selected");

		// Attached event with missing snappee vs valid snappee.
		const attached = app.model.addEvent("tap", {
			channel: 0,
			time: [5, 0, 1],
			attached: true,
			snappee: 999,
			snapPoint: [0, 0],
		});
		app._rebuildRenderIndex();
		app.selectEvents([attached.id], "replace");
		checkMatches("attached to missing snappee");
		attached.snappee = 1;
		checkMatches("attached to existing snappee");

		// Locked group containing unlocked child vs unlocked group.
		const child = app.model.addEvent("tap", { channel: 1, time: [6, 0, 1], x: 5, y: 5, selected: true });
		app.groupSelected();
		const group = app.model.events.find(event => event.type === "group");
		assert.ok(group && child);
		group.locked = true;
		app._rebuildRenderIndex();
		app.selectEvents([group.id], "replace");
		checkMatches("locked group selected");
		group.locked = false;
		checkMatches("unlocked group selected");
	} finally {
		menu.destroy();
		toolbar.destroy();
		globalThis.document = previousDocument;
	}
});
