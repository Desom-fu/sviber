import EN_MESSAGES from "../json/i18n.en-US.json" with { type: "json" };
import ZH_MESSAGES from "../json/i18n.zh-CN.json" with { type: "json" };

export const SUPPORTED_LANGUAGES = Object.freeze(["en-US", "zh-CN"]);
export const MESSAGES = Object.freeze({
	"en-US": Object.freeze(EN_MESSAGES),
	"zh-CN": Object.freeze(ZH_MESSAGES),
});

export function normalizeLanguage(language) {
	return String(language || "")
		.toLowerCase()
		.startsWith("zh")? "zh-CN": "en-US";
}

function interpolate(message, params) {
	return String(message).replace(/\{([\w.-]+)\}/g, (match, key) =>
		Object.hasOwn(params, key) ? String(params[key]) : match,
	);
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchTemplate(template, message) {
	const keys = [];
	let pattern = "^";
	let position = 0;
	for (const match of String(template).matchAll(/\{([\w.-]+)\}/g)) {
		pattern += `${escapeRegExp(String(template).slice(position, match.index))}(.*?)`;
		keys.push(match[1]);
		position = match.index + match[0].length;
	}
	pattern += `${escapeRegExp(String(template).slice(position))}$`;
	const values = new RegExp(pattern).exec(String(message));
	return values ? Object.fromEntries(keys.map((key, index) => [key, values[index + 1]])) : null;
}

function translatedNodes(root, selector) {
	const result = [];
	if (root?.matches?.(selector)) {
		result.push(root);
	}
	if (root?.querySelectorAll) {
		result.push(...root.querySelectorAll(selector));
	}
	return result;
}

export class I18n {
	constructor(language = globalThis.navigator?.language) {
		this.language = normalizeLanguage(language);
		this.listeners = new Set();
		this.ready = Promise.resolve();
	}

	t(key, params = {}) {
		const sheet = MESSAGES[this.language] || MESSAGES["en-US"];
		return interpolate(sheet[key] ?? MESSAGES["en-US"][key] ?? key, params);
	}

	localize(message) {
		for (const sheet of Object.values(MESSAGES)) {
			for (const [key, template] of Object.entries(sheet)) {
				const params = matchTemplate(template, message);
				if (!params) {
					continue;
				}
				for (const [name, value] of Object.entries(params)) {
					const localizedKey = Object.entries(sheet).find(
						([candidate, text]) => candidate.startsWith("event.") && text === value,
					)?.[0];
					if (localizedKey) {
						params[name] = this.t(localizedKey);
					}
				}
				return this.t(key, params);
			}
		}
		return String(message ?? "");
	}

	shortcut(shortcut) {
		if (!shortcut) {
			return "";
		}
		const tokenKeys = {
			Ctrl: "shortcut.ctrl",
			Shift: "shortcut.shift",
			Alt: "shortcut.alt",
			Meta: "shortcut.meta",
			Space: "shortcut.space",
			Delete: "shortcut.delete",
			Del: "shortcut.delete",
			Insert: "shortcut.insert",
			Home: "shortcut.home",
			ArrowUp: "shortcut.arrowup",
			Up: "shortcut.arrowup",
			ArrowDown: "shortcut.arrowdown",
			Down: "shortcut.arrowdown",
			ArrowLeft: "shortcut.arrowleft",
			Left: "shortcut.arrowleft",
			ArrowRight: "shortcut.arrowright",
			Right: "shortcut.arrowright",
		};
		return shortcut
			.split("+")
			.map(token => {
				const trimmed = token.trim();
				return tokenKeys[trimmed] ? this.t(tokenKeys[trimmed]) : trimmed;
			})
			.join("+");
	}

	setLanguage(language, root = globalThis.document) {
		const normalized = normalizeLanguage(language);
		const changed = normalized !== this.language;
		this.language = normalized;
		this.apply(root);
		if (changed) {
			for (const listener of this.listeners) {
				listener(this.language);
			}
		}
		return changed;
	}

	subscribe(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	apply(root = globalThis.document) {
		if (!root) {
			return;
		}
		const documentElement = root.documentElement || root.ownerDocument?.documentElement;
		if (documentElement) {
			documentElement.lang = this.language;
		}
		for (const element of translatedNodes(root, "[data-i18n]")) {
			element.textContent = this.t(element.dataset.i18n);
		}
		for (const element of translatedNodes(root, "[data-i18n-placeholder]")) {
			element.placeholder = this.t(element.dataset.i18nPlaceholder);
		}
		for (const element of translatedNodes(root, "[data-i18n-title]")) {
			element.title = this.t(element.dataset.i18nTitle);
		}
		for (const element of translatedNodes(root, "[data-i18n-aria-label]")) {
			element.setAttribute("aria-label", this.t(element.dataset.i18nAriaLabel));
		}
	}
}

export const i18n = new I18n();
