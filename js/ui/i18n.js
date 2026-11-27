import EN_MESSAGES from "../../json/i18n.en-US.json" with { type: "json" };
import ZH_MESSAGES from "../../json/i18n.zh-CN.json" with { type: "json" };
import ZH_TW_MESSAGES from "../../json/i18n.zh-TW.json" with { type: "json" };
import JA_MESSAGES from "../../json/i18n.ja-JP.json" with { type: "json" };

export const SUPPORTED_LANGUAGES = Object.freeze(["en-US", "zh-CN", "zh-TW", "ja-JP"]);
export const MESSAGES = Object.freeze({
	"en-US": Object.freeze(EN_MESSAGES),
	"zh-CN": Object.freeze(ZH_MESSAGES),
	"zh-TW": Object.freeze(ZH_TW_MESSAGES),
	"ja-JP": Object.freeze(JA_MESSAGES),
});

export function normalizeLanguage(language) {
	const value = String(language || "").toLowerCase();
	if (value.startsWith("zh-tw") || value.startsWith("zh-hk") || value.startsWith("zh-mo")) {
		return "zh-TW";
	}
	if (value.startsWith("zh")) {
		return "zh-CN";
	}
	if (value.startsWith("ja")) {
		return "ja-JP";
	}
	return "en-US";
}

// v22: on Mac keyboards Ctrl is the Command key and Alt is Option. The command registry
// already fires Ctrl shortcuts on Command (metaAsCtrl), so this only changes how the
// shortcuts are spelled for the user: in the menus, the toolbar, the shortcuts dialog.
function isMacPlatform() {
	return /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || "");
}

function interpolate(message, params) {
	return String(message).replace(/\{([\w.-]+)\}/g, (match, key) =>
		Object.hasOwn(params, key) ? String(params[key]) : match,
	);
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildLocalizationIndex() {
	const literals = new Map();
	const patterns = [];
	for (const sheet of Object.values(MESSAGES)) {
		const entries = Object.entries(sheet);
		const eventKeys = new Map();
		for (const [key, template] of entries) {
			if (key.startsWith("event.") && !eventKeys.has(template)) {
				eventKeys.set(template, key);
			}
			const keys = [];
			let pattern = "^";
			let position = 0;
			for (const match of template.matchAll(/\{([\w.-]+)\}/g)) {
				pattern += `${escapeRegExp(template.slice(position, match.index))}(.*?)`;
				keys.push(match[1]);
				position = match.index + match[0].length;
			}
			if (keys.length) {
				const regexp = new RegExp(`${pattern}${escapeRegExp(template.slice(position))}$`);
				patterns.push({ key, keys, regexp, eventKeys });
			} else if (!literals.has(template)) {
				// Preserve the original first match, including templates before this literal.
				literals.set(template, { key, earlierPatterns: patterns.length });
			}
		}
	}
	return { literals, patterns };
}

let localizationIndex;

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
		localizationIndex ??= buildLocalizationIndex();
		const { literals, patterns } = localizationIndex;
		const text = String(message ?? "");
		const literal = literals.get(text);
		const limit = literal?.earlierPatterns ?? patterns.length;
		for (let index = 0; index < limit; index += 1) {
			const { key, keys, regexp, eventKeys } = patterns[index];
			const values = regexp.exec(text);
			if (!values) {
				continue;
			}
			const params = Object.fromEntries(keys.map((name, index) => [name, values[index + 1]]));
			for (const [name, value] of Object.entries(params)) {
				const eventKey = eventKeys.get(value);
				if (eventKey) {
					params[name] = this.t(eventKey);
				}
			}
			return this.t(key, params);
		}
		return literal ? this.t(literal.key) : text;
	}

	shortcut(shortcut) {
		if (!shortcut) {
			return "";
		}
		const mac = isMacPlatform();
		const tokenKeys = {
			Ctrl: mac ? "shortcut.command" : "shortcut.ctrl",
			Shift: "shortcut.shift",
			Alt: mac ? "shortcut.option" : "shortcut.alt",
			Meta: "shortcut.meta",
			Space: "shortcut.space",
			Delete: "shortcut.delete",
			Del: "shortcut.delete",
			Insert: "shortcut.insert",
			Home: "shortcut.home",
			End: "shortcut.end",
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
