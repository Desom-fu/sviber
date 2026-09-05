// Chrome of the editor shell: the side-panel tab strip and the collapse toggles for the
// scroll view, side panel and timeline. Split out of app-core.js because none of it touches
// chart state — it only shows and hides parts of the layout.

import { i18n } from "../ui/i18n.js";
import { bindEdgeToggleReveal } from "../ui/ui-layout.js";

const PANEL_TABS = Object.freeze(["inspector", "channels", "snappees", "clips"]);

// `glyphs` and `keys` are ordered [collapsed, expanded]: each toggle button doubles as its
// own state indicator, pointing the way the next click would move the panel.
const SCROLL_TOGGLE = Object.freeze({
	glyphs: ["›", "‹"],
	keys: ["layout.showScrollView", "layout.hideScrollView"],
});

const SIDE_TOGGLE = Object.freeze({
	glyphs: ["‹", "›"],
	keys: ["layout.showSidePanel", "layout.hideSidePanel"],
});

const TIMELINE_TOGGLE = Object.freeze({
	glyphs: ["▼", "▲"],
	keys: ["layout.showTimeline", "layout.hideTimeline"],
});

function describeToggle(button, hidden, { glyphs, keys }) {
	if (!button) {
		return;
	}
	button.textContent = hidden ? glyphs[0] : glyphs[1];
	button.title = i18n.t(hidden ? keys[0] : keys[1]);
	button.setAttribute("aria-label", button.title);
}

export const withShellBindings = Base =>
	class extends Base {
		// v19: the boot loading screen doubles as the busy overlay for slow document opens.
		// The depth counter keeps nested opens (a chart that pulls in its containing
		// project) from hiding the screen while the outer open is still running.
		showLoadingOverlay(textKey) {
			const screen =
				typeof document === "undefined" ? null : document.getElementById("loading-screen");
			if (!screen) {
				return;
			}
			this.loadingOverlayDepth = (this.loadingOverlayDepth || 0) + 1;
			const text = screen.querySelector("span[data-i18n='loading']");
			if (text && textKey) {
				text.textContent = i18n.t(textKey);
			}
			screen.hidden = false;
		}

		hideLoadingOverlay() {
			this.loadingOverlayDepth = Math.max(0, (this.loadingOverlayDepth || 0) - 1);
			if (this.loadingOverlayDepth) {
				return;
			}
			const screen =
				typeof document === "undefined" ? null : document.getElementById("loading-screen");
			if (screen) {
				screen.hidden = true;
			}
		}

		// The overlay has to paint before the work starts: chart import blocks the main
		// thread, so without one yielded frame it would only appear once the slow part was
		// already over.
		async withLoadingOverlay(work, textKey) {
			this.showLoadingOverlay(textKey);
			await new Promise(resolve => {
				if (typeof requestAnimationFrame !== "function") {
					resolve();
					return;
				}
				requestAnimationFrame(() => requestAnimationFrame(resolve));
			});
			try {
				return await work();
			} finally {
				this.hideLoadingOverlay();
			}
		}

		_bindTabs() {
			const tabs = PANEL_TABS.map(id => ({
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
			for (const item of tabs) {
				item.tab.addEventListener("click", () => setTab(item.id));
			}
		}

		_describeLayoutToggles(scrollHidden, sideHidden, timelineHidden) {
			describeToggle(document.getElementById("scroll-view-toggle"), scrollHidden, SCROLL_TOGGLE);
			describeToggle(document.getElementById("side-panel-toggle"), sideHidden, SIDE_TOGGLE);
			describeToggle(document.getElementById("timeline-toggle"), timelineHidden, TIMELINE_TOGGLE);
		}

		_bindLayoutToggles() {
			const scrollButton = document.getElementById("scroll-view-toggle");
			const sideButton = document.getElementById("side-panel-toggle");
			const timelineButton = document.getElementById("timeline-toggle");
			bindEdgeToggleReveal(document.getElementById("stage-surface"));
			scrollButton?.addEventListener("click", () => this.toggleLeftPanels?.());
			sideButton?.addEventListener("click", () => this.toggleRightPanels?.());
			timelineButton?.addEventListener("click", () => this.toggleTopPanels?.());
			this._describeLayoutToggles(
				this.preferences?.leftPanelsHidden,
				this.preferences?.rightPanelsHidden,
				this.preferences?.topPanelsHidden,
			);
		}
	};
