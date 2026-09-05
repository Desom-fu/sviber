// Each manual body is a language-specific HTML fragment. The manual chrome remains in the
// shared i18n dictionaries so the page shell never contains translated prose.
const languageSelect = document.getElementById("language");
const contents = document.getElementById("contents");
const supported = new Set(["en-US", "zh-CN", "zh-TW", "ja-JP"]);
const searchInput = document.getElementById("manual-search-input");
const searchClear = document.getElementById("manual-search-clear");
const searchStatus = document.getElementById("manual-search-status");
const loadedManuals = new Map();
let activeArticle = null;
let activeLanguage = "";
let activeUi = null;
let searchMatches = [];
let searchMatchIndex = -1;

function normalizeLanguage(value) {
	const language = String(value || "").toLowerCase();
	if (language.startsWith("zh-tw") || language.startsWith("zh-hk") || language.startsWith("zh-mo")) {
		return "zh-TW";
	}
	if (language.startsWith("zh")) {
		return "zh-CN";
	}
	if (language.startsWith("ja")) {
		return "ja-JP";
	}
	if (language.startsWith("en")) {
		return "en-US";
	}
	return null;
}

function requestedLanguage() {
	const query = new URLSearchParams(location.search).get("lang");
	const queryLanguage = normalizeLanguage(query);
	if (queryLanguage) {
		return queryLanguage;
	}
	return normalizeLanguage(navigator.language) || "en-US";
}

function formatMessage(template, values) {
	return String(template || "").replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
}

async function loadManual(language) {
	if (loadedManuals.has(language)) {
		return loadedManuals.get(language);
	}
	const [articleResponse, messagesResponse] = await Promise.all([
		fetch(`manual.${language}.html`, { cache: "no-cache" }),
		fetch(`../json/i18n.${language}.json`, { cache: "no-cache" }),
	]);
	if (!articleResponse.ok) {
		throw new Error(`HTTP ${articleResponse.status} while loading the manual`);
	}
	if (!messagesResponse.ok) {
		throw new Error(`HTTP ${messagesResponse.status} while loading translations`);
	}
	const messages = await messagesResponse.json();
	const ui = {
		languageLabel: messages["manual.languageLabel"],
		contentsLabel: messages["manual.contentsLabel"],
		languages: Object.fromEntries(
			[...supported].map(value => [value, messages[`manual.language.${value}`]]),
		),
		search: {
			label: messages["manual.search.label"],
			placeholder: messages["manual.search.placeholder"],
			clear: messages["manual.search.clear"],
			matches: messages["manual.search.matches"],
			none: messages["manual.search.none"],
		},
	};
	const articleSource = await articleResponse.text();
	const article = articleSource.replace(/<!---->\r?\n/g, "").replace(/\r?\n$/, "");
	const manual = { article, ui };
	loadedManuals.set(language, manual);
	return manual;
}

function buildContents(article) {
	contents.replaceChildren();
	let group = null;
	for (const heading of article.querySelectorAll("h2, h3")) {
		const link = document.createElement("a");
		link.href = `#${heading.id}`;
		link.textContent = heading.textContent;
		if (heading.tagName === "H2") {
			group = document.createElement("section");
			group.className = "contents-group";
			group.append(link);
			contents.append(group);
		} else {
			link.className = "contents-child";
			(group || contents).append(link);
		}
	}
	syncContents();
}

function syncContents() {
	for (const link of contents.querySelectorAll("a")) {
		link.hidden = false;
	}
	for (const group of contents.querySelectorAll(".contents-group")) {
		group.hidden = false;
	}
}

function focusSearchMatch(index, behavior = "smooth") {
	if (!searchMatches.length) {
		return;
	}
	searchMatchIndex = (index + searchMatches.length) % searchMatches.length;
	const target = searchMatches[searchMatchIndex];
	for (const node of searchMatches) {
		node.classList.toggle("search-match-current", node === target);
	}
	target.scrollIntoView({ behavior, block: "center" });
	searchStatus.textContent = formatMessage(activeUi.search.matches, {
		index: searchMatchIndex + 1,
		count: searchMatches.length,
	});
}

function applySearch(value = "") {
	if (!activeArticle) {
		return;
	}
	const query = String(value).trim().toLocaleLowerCase();
	const tokens = query ? query.split(/\s+/).filter(Boolean) : [];
	searchMatches = [];
	searchMatchIndex = -1;
	const searchable = [...activeArticle.querySelectorAll("h2, h3, p, li, tr")];
	for (const node of searchable) {
		node.hidden = false;
	}
	for (const node of searchable) {
		node.classList.remove("search-match-current");
	}
	for (const node of activeArticle.querySelectorAll("table, ul, ol")) {
		node.hidden = false;
	}
	if (!tokens.length) {
		searchClear.hidden = true;
		searchStatus.textContent = "";
		syncContents();
		return;
	}

	const matchedNodes = [];
	for (const node of searchable) {
		const text = node.textContent.toLocaleLowerCase();
		const matched = tokens.every(token => text.includes(token));
		if (!matched) {
			continue;
		}
		matchedNodes.push(node);
	}
	searchClear.hidden = false;
	searchMatches = matchedNodes;
	if (searchMatches.length) {
		focusSearchMatch(0, "auto");
	} else {
		searchStatus.textContent = activeUi.search.none;
	}
	syncContents();
}

function applyChrome() {
	languageSelect.setAttribute("aria-label", activeUi.languageLabel);
	contents.setAttribute("aria-label", activeUi.contentsLabel);
	for (const option of languageSelect.options) {
		option.textContent = activeUi.languages[option.value];
	}
	document.getElementById("manual-search-label").textContent = activeUi.search.label;
	searchInput.placeholder = activeUi.search.placeholder;
	searchInput.setAttribute("aria-label", activeUi.search.label);
	searchClear.setAttribute("aria-label", activeUi.search.clear);
}

// v22: on Mac keyboards Ctrl is Command and Alt is Option, so every keyboard shortcut
// written in the manual is respelled inside its <kbd> elements when running there.
function isMacPlatform() {
	return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
}

function localizeShortcutKeys(article) {
	if (!isMacPlatform()) {
		return;
	}
	const substitutions = [["Ctrl", "Command"], ["Alt", "Option"]];
	for (const kbd of article.querySelectorAll("kbd")) {
		let text = kbd.textContent;
		for (const [from, to] of substitutions) {
			text = text.split(from).join(to);
		}
		kbd.textContent = text;
	}
}

function setArticle(language, manual) {
	activeLanguage = language;
	activeUi = manual.ui;
	document.documentElement.lang = language;
	languageSelect.value = language;
	applyChrome();
	let visible = null;
	for (const article of document.querySelectorAll("article[data-language]")) {
		const isTarget = article.dataset.language === language;
		article.hidden = !isTarget;
		if (isTarget && !article.dataset.filled) {
			article.innerHTML = manual.article;
			localizeShortcutKeys(article);
			article.dataset.filled = "true";
		}
		if (!article.hidden) {
			visible = article;
		}
	}
	activeArticle = visible;
	if (visible) {
		buildContents(visible);
		applySearch(searchInput.value);
	}
}

async function setLanguage(language) {
	const selected = supported.has(language) ? language : "en-US";
	try {
		const manual = await loadManual(selected);
		setArticle(selected, manual);
	} catch (error) {
		activeUi = null;
		searchStatus.textContent = `Unable to load the manual: ${error.message}`;
	}
}

languageSelect.addEventListener("change", () => setLanguage(languageSelect.value));
document.getElementById("manual-search").addEventListener("submit", event => event.preventDefault());
searchInput.addEventListener("input", () => applySearch(searchInput.value));
searchInput.addEventListener("keydown", event => {
	if (event.key !== "Enter" || !searchMatches.length) {
		return;
	}
	event.preventDefault();
	focusSearchMatch(searchMatchIndex + (event.shiftKey ? -1 : 1));
});
searchClear.addEventListener("click", () => {
	searchInput.value = "";
	searchMatches = [];
	searchMatchIndex = -1;
	applySearch();
	searchInput.focus();
});

function scrollToHash() {
	const id = decodeURIComponent(location.hash.replace(/^#/, ""));
	if (!id) {
		return;
	}
	const target = document.getElementById(id);
	if (target) {
		target.scrollIntoView({ behavior: "auto", block: "start" });
	}
}

document.addEventListener("click", event => {
	const link = event.target.closest("a[href^='#']");
	if (!link) {
		return;
	}
	const id = decodeURIComponent(link.hash.replace(/^#/, ""));
	const target = id && document.getElementById(id);
	if (!target) {
		return;
	}
	event.preventDefault();
	if (location.hash !== link.hash) {
		history.pushState(null, "", link.hash);
	}
	target.scrollIntoView({ behavior: "smooth", block: "start" });
});

setLanguage(requestedLanguage()).then(scrollToHash);
