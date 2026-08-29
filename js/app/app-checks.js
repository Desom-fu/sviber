// Chart checks integration: the live checks panel, navigation from a violation to
// the place where it can be fixed, and the "Checks..." popup form.

import { composeTraits } from "../core/mixin.js";
import { i18n } from "../ui/i18n.js";
import { CHECK_DEFINITIONS, createChecksSteps, normalizeChecks, runChecks, sortViolations } from "../core/checks.js";
import { Rational } from "../core/rational.js";

function scheduleSlice(callback) {
	if (typeof requestIdleCallback === "function") {
		requestIdleCallback(callback, { timeout: 200 });
	} else {
		setTimeout(() => callback(null), 16);
	}
}

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
			this._updateChecksTabCount((this.checkViolations || []).length);
			return this.checkViolations || [];
		}
		this.checksSignature = signature;
		this.checkViolations = runChecks(this.model, { music: this.musicBoundsForChecks() });
		this.checksPanel.render(this.checkViolations);
		this._updateChecksTabCount(this.checkViolations.length);
		return this.checkViolations;
	}

	// The clickable checks tab carries a live red count of the violations while there
	// is at least one.
	_updateChecksTabCount(count) {
		const badge = document.getElementById("checks-tab-count");
		if (!badge) {
			return;
		}
		badge.hidden = !count;
		badge.textContent = count ? String(count) : "";
	}

	// v19: checks re-scan the whole chart, so running them whole on the critical path of
	// every edit stuttered note placement, and running them as one idle task stuttered the
	// frame right after an edit. Edits therefore pump the scan step by step: each idle
	// slice runs a few millimetres worth of rules, so no single task is user-visible.
	// Bursts coalesce: a pending flag plus a token let an in-flight run detect that a
	// newer edit superseded it and restart from fresh steps.
	_scheduleChecksRefresh() {
		this.checksRefreshPending = true;
		this.checksRefreshToken = (this.checksRefreshToken || 0) + 1;
		if (!this.checksRunActive) {
			this._pumpChecksRefresh();
		}
	}

	_pumpChecksRefresh() {
		if (!this.checksPanel) {
			this.checksRefreshPending = false;
			return;
		}
		this.checksRefreshPending = false;
		this.checksRunActive = true;
		const token = this.checksRefreshToken;
		const model = this.model;
		const { violations, steps } = createChecksSteps(model, { music: this.musicBoundsForChecks() });
		let index = 0;
		const slice = deadline => {
			if (token !== this.checksRefreshToken) {
				this.checksRunActive = false;
				if (this.checksRefreshPending) {
					this._pumpChecksRefresh();
				}
				return;
			}
			const started = performance.now();
			while (
				index < steps.length &&
				(deadline ? deadline.timeRemaining() > 2 : performance.now() - started < 5)
			) {
				steps[index]();
				index += 1;
			}
			if (index < steps.length) {
				scheduleSlice(slice);
				return;
			}
			this.checksRunActive = false;
			const sorted = sortViolations(violations);
			this.checkViolations = sorted;
			this.checksPanel.render(sorted);
			this._updateChecksTabCount(sorted.length);
			if (this.checksRefreshPending) {
				this._pumpChecksRefresh();
			}
		};
		scheduleSlice(slice);
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
		return CHECK_DEFINITIONS.map(definition => ({
			id: definition.id,
			type: "group",
			hideLabel: true,
			fields: [
				{
					id: "enabled",
					type: "checkbox",
					labelKey: `check.${definition.id}`,
					tooltipKey: `check.${definition.id}.hint`,
					choiceLabelKey: "field.checkEnabled",
				},
				...definition.parameters.map(parameter => ({
					id: parameter.id,
					type: parameter.type,
					labelKey: `check.${definition.id}.${parameter.id}`,
					tooltipKey: `check.${definition.id}.${parameter.id}.hint`,
					min: parameter.min,
					step: parameter.type === "integer" ? 1 : "any",
					disabled: values => !values.enabled,
				})),
			],
		}));
	}

	async showChecksDialog(focusCheck = null) {
		const current = normalizeChecks(this.model.checks);
		const values = {};
		for (const definition of CHECK_DEFINITIONS) {
			values[definition.id] = { enabled: current[definition.id].enabled };
			for (const parameter of definition.parameters) {
				values[definition.id][parameter.id] = current[definition.id][parameter.id];
			}
		}
		const result = await this.dialogs.form({
			titleKey: "command.edit.checks",
			messageKey: "dialog.checksMessage",
			dialogClass: "is-wide",
			focusField: focusCheck || undefined,
			values,
			fields: this._checkFields(),
		});
		if (!result) {
			return null;
		}
		const next = {};
		for (const definition of CHECK_DEFINITIONS) {
			const group = result[definition.id] || {};
			next[definition.id] = { enabled: Boolean(group.enabled) };
			for (const parameter of definition.parameters) {
				next[definition.id][parameter.id] = Number(group[parameter.id]);
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
