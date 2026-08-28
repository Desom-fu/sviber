// Chart checks integration: the live checks panel, navigation from a violation to
// the place where it can be fixed, and the "Checks..." popup form.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { CHECK_DEFINITIONS, normalizeChecks, runChecks } from "../core/checks.js";
import { Rational } from "../core/rational.js";

function checksSignature(model) {
	return JSON.stringify([
		model.metadata,
		model.checks,
		model.timing.toJSON(),
		model.channels.map(channel => [channel.id, channel.active !== false]),
		model.snappees,
		model.events,
	]);
}

class ChecksTrait {
	musicBoundsForChecks() {
		if (!this.audio?.buffer) {
			return null;
		}
		return { start: 0, duration: this.audio.buffer.duration };
	}

	// Called from every refresh so that the panel is always live.
	refreshChecks(options = {}) {
		if (!this.checksPanel) {
			return this.checkViolations || [];
		}
		const signature = `${checksSignature(this.model)}|${this.audio?.buffer?.duration ?? ""}`;
		if (!options.force && signature === this.checksSignature) {
			this.checksPanel.render(this.checkViolations || []);
			return this.checkViolations || [];
		}
		this.checksSignature = signature;
		this.checkViolations = runChecks(this.model, { music: this.musicBoundsForChecks() });
		this.checksPanel.render(this.checkViolations);
		return this.checkViolations;
	}

	_bindChecksTabs() {
		const tabs = [
			{
				id: "scroll-view",
				tab: document.getElementById("scroll-view-tab"),
				panel: document.getElementById("scroll-surface"),
			},
			{
				id: "checks",
				tab: document.getElementById("checks-tab"),
				panel: document.getElementById("checks-panel"),
			},
		];
		const setTab = activeId => {
			for (const item of tabs) {
				if (!item.tab || !item.panel) {
					continue;
				}
				const active = item.id === activeId;
				item.tab.classList.toggle("is-active", active);
				item.tab.setAttribute("aria-selected", String(active));
				item.panel.inert = !active;
				item.panel.setAttribute("aria-hidden", String(!active));
				// v18 fix: both panels share one grid cell, so the inactive one has to leave
				// the layout instead of merely turning invisible, or the two are painted on
				// top of each other. The scroll view keeps `is-inactive` rather than `hidden`
				// because its canvas must stay measurable for the renderer.
				if (item.id === "scroll-view") {
					item.panel.classList.toggle("is-inactive", !active);
				} else {
					item.panel.hidden = !active;
				}
			}
			if (activeId === "scroll-view") {
				this.scrollView?.surface?.resize?.();
				this.refresh();
			}
		};
		for (const item of tabs) {
			item.tab?.addEventListener("click", () => setTab(item.id));
		}
		// The markup ships with the scroll view selected; applying it here keeps the DOM
		// state and the tab buttons in step even if the markup changes.
		setTab(tabs.find(item => item.tab?.classList.contains("is-active"))?.id || "scroll-view");
	}

	_revealSeconds(seconds) {
		const editor = this.model.editor;
		const beginning = Number(editor.visibleRangeBeginning);
		const end = Number(editor.visibleRangeEnd);
		if (!Number.isFinite(seconds) || (seconds >= beginning && seconds <= end)) {
			return;
		}
		const span = Math.max(0.001, end - beginning);
		this.setVisibleRange(seconds - span / 2, seconds + span / 2, true);
	}

	async activateCheckViolation(violation) {
		if (!violation) {
			return;
		}
		const definition = CHECK_DEFINITIONS.find(entry => entry.id === violation.check);
		if (definition?.target === "chartProperties") {
			await this.showChartProperties(false);
			return;
		}
		const ids = (violation.eventIds || []).filter(id => this.model.findEvent(id));
		if (!ids.length) {
			return;
		}
		this.selectEvents(ids, "replace");
		const event = this.model.findEvent(ids[0]);
		if (event) {
			this.seekBeat(Rational.from(event.time), event.channel ?? null);
			this._revealSeconds(this.timing().beatToSeconds(event.time));
		}
	}

	async configureCheckViolation(violation) {
		await this.showChecksDialog(violation?.check);
	}

	_checkFields() {
		const fields = [];
		for (const definition of CHECK_DEFINITIONS) {
			fields.push({
				id: `${definition.id}.enabled`,
				type: "checkbox",
				labelKey: `check.${definition.id}`,
				tooltipKey: `check.${definition.id}.hint`,
				choiceLabelKey: "field.checkEnabled",
			});
			for (const parameter of definition.parameters) {
				fields.push({
					id: `${definition.id}.${parameter.id}`,
					type: parameter.type,
					labelKey: `check.${definition.id}.${parameter.id}`,
					tooltipKey: `check.${definition.id}.${parameter.id}.hint`,
					min: parameter.min,
					step: parameter.type === "integer" ? 1 : "any",
					disabled: values => !values[`${definition.id}.enabled`],
				});
			}
		}
		return fields;
	}

	async showChecksDialog(focusCheck = null) {
		const current = normalizeChecks(this.model.checks);
		const values = {};
		for (const definition of CHECK_DEFINITIONS) {
			values[`${definition.id}.enabled`] = current[definition.id].enabled;
			for (const parameter of definition.parameters) {
				values[`${definition.id}.${parameter.id}`] = current[definition.id][parameter.id];
			}
		}
		const result = await this.dialogs.form({
			titleKey: "command.edit.checks",
			messageKey: "dialog.checksMessage",
			dialogClass: "is-wide",
			focusField: focusCheck ? `${focusCheck}.enabled` : undefined,
			values,
			fields: this._checkFields(),
		});
		if (!result) {
			return null;
		}
		const next = {};
		for (const definition of CHECK_DEFINITIONS) {
			next[definition.id] = { enabled: Boolean(result[`${definition.id}.enabled`]) };
			for (const parameter of definition.parameters) {
				next[definition.id][parameter.id] = Number(result[`${definition.id}.${parameter.id}`]);
			}
		}
		this.commit(i18n.t("history.editChecks"), model => {
			model.checks = normalizeChecks(next);
		});
		this.refreshChecks({ force: true });
		return this.model.checks;
	}
}

export const withChecks = composeTraits("ChecksLayer", ChecksTrait);
