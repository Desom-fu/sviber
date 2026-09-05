// Panel resize handles, lock-layout, and the View menu. Layout fractions live in editor
// preferences, not in the chart file.

import { composeTraits } from "../core/mixin.js";
import {
	DEFAULT_PREFERENCES,
	inspectorHistoryFractions,
	storePreferences,
	timelineRowHeight,
} from "./app-helpers.js";

function workspaceElements() {
	return {
		workspace: document.querySelector(".workspace"),
		timelineRow: document.querySelector(".timeline-row"),
		editorRow: document.querySelector(".editor-row"),
		sidePanel: document.querySelector(".side-panel"),
	};
}

function clamp(value, minimum, maximum) {
	return Math.min(maximum, Math.max(minimum, value));
}

class LayoutTrait {
	applyLayoutPreferences() {
		const prefs = this.preferences;
		const { workspace, timelineRow, editorRow, sidePanel } = workspaceElements();
		if (!workspace || !editorRow || !timelineRow) {
			return;
		}
		const shown = this.model.channels.filter(channel => channel.hidden !== true).length;
		workspace.style.setProperty("--timeline-height", `${timelineRowHeight(prefs, shown)}px`);
		workspace.style.setProperty("--left-panel-width", `${prefs.leftPanelWidthFraction * 100}vw`);
		workspace.style.setProperty("--right-panel-width", `${prefs.rightPanelWidthFraction * 100}vw`);
		workspace.style.setProperty("--status-panel-width", `${prefs.statusPanelWidthFraction * 100}vw`);
		const { inspectorFr, historyFr } = inspectorHistoryFractions(prefs.inspectorHeightFraction);
		workspace.style.setProperty("--inspector-fraction", `${inspectorFr}fr`);
		workspace.style.setProperty("--history-fraction", `${historyFr}fr`);
		workspace.classList.toggle("is-timeline-hidden", prefs.topPanelsHidden);
		editorRow.classList.toggle("is-scroll-hidden", prefs.leftPanelsHidden);
		editorRow.classList.toggle("is-side-hidden", prefs.rightPanelsHidden);
		workspace.classList.toggle("is-layout-locked", prefs.lockLayout);
		if (sidePanel) {
			sidePanel.style.setProperty("--inspector-fraction", `${inspectorFr}fr`);
			sidePanel.style.setProperty("--history-fraction", `${historyFr}fr`);
		}
		this._syncLayoutToggleButtons();
	}

	_syncLayoutToggleButtons() {
		const row = document.querySelector(".editor-row");
		const workspace = document.querySelector(".workspace");
		const scrollButton = document.getElementById("scroll-view-toggle");
		const sideButton = document.getElementById("side-panel-toggle");
		const timelineButton = document.getElementById("timeline-toggle");
		const locked = this.preferences.lockLayout;
		for (const button of [scrollButton, sideButton, timelineButton]) {
			if (button) {
				button.hidden = locked;
			}
		}
		if (typeof this._describeLayoutToggles === "function") {
			this._describeLayoutToggles(
				row?.classList.contains("is-scroll-hidden"),
				row?.classList.contains("is-side-hidden"),
				workspace?.classList.contains("is-timeline-hidden"),
			);
		}
	}

	persistLayoutPreferences(patch) {
		this.preferences = storePreferences({ ...this.preferences, ...patch });
		this.applyLayoutPreferences();
		this.refreshNow?.();
	}

	toggleTopPanels() {
		this.persistLayoutPreferences({ topPanelsHidden: !this.preferences.topPanelsHidden });
	}

	toggleLeftPanels() {
		this.persistLayoutPreferences({ leftPanelsHidden: !this.preferences.leftPanelsHidden });
	}

	toggleRightPanels() {
		this.persistLayoutPreferences({ rightPanelsHidden: !this.preferences.rightPanelsHidden });
	}

	resetLayoutDimensions() {
		this.persistLayoutPreferences({
			leftPanelWidthFraction: DEFAULT_PREFERENCES.leftPanelWidthFraction,
			rightPanelWidthFraction: DEFAULT_PREFERENCES.rightPanelWidthFraction,
			statusPanelWidthFraction: DEFAULT_PREFERENCES.statusPanelWidthFraction,
			inspectorHeightFraction: DEFAULT_PREFERENCES.inspectorHeightFraction,
			timelineChannelHeight: DEFAULT_PREFERENCES.timelineChannelHeight,
			topPanelsHidden: false,
			leftPanelsHidden: false,
			rightPanelsHidden: false,
		});
	}

	setLockLayout(locked) {
		this.persistLayoutPreferences({ lockLayout: Boolean(locked) });
	}

	_bindLayoutResize() {
		this.applyLayoutPreferences();
		this._bindResizeHandle("layout-resize-left", "leftPanelWidthFraction", "x");
		this._bindResizeHandle("layout-resize-right", "rightPanelWidthFraction", "x");
		this._bindResizeHandle("layout-resize-status", "statusPanelWidthFraction", "x");
		this._bindResizeHandle("layout-resize-top", "timelineChannelHeight", "y");
		this._bindResizeHandle("layout-resize-inspector", "inspectorHeightFraction", "y");
	}

	_bindResizeHandle(id, key, axis) {
		const handle = document.getElementById(id);
		if (!handle) {
			return;
		}
		handle.addEventListener("pointerdown", event => {
			if (this.preferences.lockLayout || event.button !== 0) {
				return;
			}
			event.preventDefault();
			const start = axis === "x" ? event.clientX : event.clientY;
			const origin = this.preferences[key];
			const page = axis === "x" ? window.innerWidth : window.innerHeight;
			const move = pointer => {
				const delta = axis === "x" ? pointer.clientX - start : pointer.clientY - start;
				if (key === "timelineChannelHeight") {
					const shown = this.model.channels.filter(channel => channel.hidden !== true).length;
					const visible = Math.max(1, Math.min(this.preferences.visibleChannels, Math.max(1, shown)));
					const next = origin + delta / (visible + 1);
					this.preferences = { ...this.preferences, timelineChannelHeight: clamp(next, 24, 160) };
				} else if (key === "inspectorHeightFraction") {
					const side = document.querySelector(".side-panel");
					const height = side?.getBoundingClientRect().height || page;
					this.preferences = {
						...this.preferences,
						inspectorHeightFraction: clamp(origin + delta / Math.max(1, height), 0.2, 0.85),
					};
				} else {
					const sign = key === "leftPanelWidthFraction" ? 1 : -1;
					this.preferences = {
						...this.preferences,
						[key]: clamp(origin + (sign * delta) / Math.max(1, page), 0.06, 0.45),
					};
				}
				this.applyLayoutPreferences();
			};
			const up = () => {
				document.removeEventListener("pointermove", move);
				document.removeEventListener("pointerup", up);
				this.preferences = storePreferences(this.preferences);
			};
			document.addEventListener("pointermove", move);
			document.addEventListener("pointerup", up, { once: true });
		});
	}
}

export const withLayout = composeTraits("LayoutLayer", LayoutTrait);
