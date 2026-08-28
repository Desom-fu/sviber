// The checks panel: a live list of all chart-check violations, sharing the left
// column with the scroll view.

import { formatTime } from "../app/app-helpers.js";

export class ChecksPanel {
	constructor(options = {}) {
		this.element = options.element || document.getElementById("checks-panel");
		this.i18n = options.i18n;
		this.tooltip = options.tooltip;
		this.onActivate = options.onActivate || (() => {});
		this.onConfigure = options.onConfigure || (() => {});
		this.cleanup = [];
		this.signature = null;
	}

	#label(violation) {
		const base = this.i18n.t(`check.${violation.check}`);
		if (violation.check === "emptyMetadata" && violation.params.field) {
			return `${base}: ${this.i18n.t(`field.${violation.params.field}`)}`;
		}
		if (violation.check === "irregularDifficulty" && violation.params.reason) {
			return `${base}: ${this.i18n.t(`check.irregularDifficulty.${violation.params.reason}`)}`;
		}
		return base;
	}

	#makeItem(violation, index) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "check-item";
		button.dataset.checkIndex = String(index);
		const label = document.createElement("span");
		label.className = "check-label";
		label.textContent = this.#label(violation);
		const time = document.createElement("span");
		time.className = "check-time";
		time.textContent = violation.time == null ? "" : formatTime(violation.time);
		button.append(label, time);
		button.addEventListener("click", event => {
			if (event.detail > 1) {
				return;
			}
			this.onActivate(violation);
		});
		button.addEventListener("dblclick", () => this.onConfigure(violation));
		button._disposeTooltip = this.tooltip?.register(button, `check.${violation.check}.hint`);
		return button;
	}

	render(violations = []) {
		if (!this.element) {
			return;
		}
		const signature = JSON.stringify([
			this.i18n.language,
			violations.map(item => [item.check, item.time, item.eventIds, item.params]),
		]);
		if (signature === this.signature) {
			return;
		}
		this.signature = signature;
		this.destroy();
		if (!violations.length) {
			const empty = document.createElement("div");
			empty.className = "checks-empty";
			empty.textContent = this.i18n.t("panel.checks.none");
			this.element.replaceChildren(empty);
			return;
		}
		const items = violations.map((violation, index) => this.#makeItem(violation, index));
		this.element.replaceChildren(...items);
		this.cleanup = items.map(item => item._disposeTooltip).filter(Boolean);
	}

	destroy() {
		for (const dispose of this.cleanup) {
			dispose();
		}
		this.cleanup = [];
	}
}
