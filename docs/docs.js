// The manual body and its interface labels live in `json/manual.<lang>.json` (v21: no
// translatable text is hardcoded in the page or in this script); this loader injects the
// article for the selected language and then wires the contents list and search on top
// of the resulting DOM.
const languageSelect = document.getElementById("language");
const contents = document.getElementById("contents");
const supported = new Set(["en", "zh-CN"]);
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
	if (language.startsWith("zh")) {
		return "zh-CN";
	}
	if (language.startsWith("en")) {
		return "en";
	}
	return null;
}

function requestedLanguage() {
	const query = new URLSearchParams(location.search).get("lang");
	const queryLanguage = normalizeLanguage(query);
	if (queryLanguage) {
		return queryLanguage;
	}
	const stored = localStorage.getItem("sviber.documentationLanguage");
	if (supported.has(stored)) {
		return stored;
	}
	return normalizeLanguage(navigator.language) || "en";
}

function formatMessage(template, values) {
	return String(template || "").replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
}

async function loadManual(language) {
	if (loadedManuals.has(language)) {
		return loadedManuals.get(language);
	}
	const response = await fetch(`../json/manual.${language}.json`, { cache: "no-cache" });
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}
	const manual = await response.json();
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
	for (const option of languageSelect.options) {
		option.textContent = activeUi.languages[option.value];
	}
	document.getElementById("manual-search-label").textContent = activeUi.search.label;
	searchInput.placeholder = activeUi.search.placeholder;
	searchInput.setAttribute("aria-label", activeUi.search.label);
	searchClear.setAttribute("aria-label", activeUi.search.clear);
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
	const selected = supported.has(language) ? language : "en";
	localStorage.setItem("sviber.documentationLanguage", selected);
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
