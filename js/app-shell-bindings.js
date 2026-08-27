// Chrome of the editor shell: the side-panel tab strip and the collapse toggles for the
// scroll view, side panel and timeline. Split out of app-core.js because none of it touches
// chart state — it only shows and hides parts of the layout.

import { i18n } from "./i18n.js";
import { bindEdgeToggleReveal } from "./ui-layout.js";

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

		_bindLayoutToggles() {
			const row = document.querySelector(".editor-row");
			const workspace = document.querySelector(".workspace");
			const scrollButton = document.getElementById("scroll-view-toggle");
			const sideButton = document.getElementById("side-panel-toggle");
			const timelineButton = document.getElementById("timeline-toggle");
			bindEdgeToggleReveal(document.getElementById("stage-surface"));
			const update = () => {
				describeToggle(scrollButton, row?.classList.contains("is-scroll-hidden"), SCROLL_TOGGLE);
				describeToggle(sideButton, row?.classList.contains("is-side-hidden"), SIDE_TOGGLE);
				describeToggle(timelineButton, workspace?.classList.contains("is-timeline-hidden"), TIMELINE_TOGGLE);
			};
			scrollButton?.addEventListener("click", () => {
				row?.classList.toggle("is-scroll-hidden");
				update();
			});
			sideButton?.addEventListener("click", () => {
				row?.classList.toggle("is-side-hidden");
				update();
			});
			timelineButton?.addEventListener("click", () => {
				workspace?.classList.toggle("is-timeline-hidden");
				update();
			});
			update();
		}
	};
