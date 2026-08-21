const languageSelect = document.getElementById("language");
const contents = document.getElementById("contents");
const supported = new Set(["en", "zh-CN"]);
const languageLabels = Object.freeze({
	en: { en: "English", "zh-CN": "Simplified Chinese" },
	"zh-CN": { en: "英文", "zh-CN": "简体中文" },
});
const searchLabels = Object.freeze({
	en: { label: "Search", placeholder: "Search manual", clear: "Clear search", matches: (index, count) => `${index}/${count} matches`, none: "No matches" },
	"zh-CN": { label: "搜索", placeholder: "搜索手册", clear: "清除搜索", matches: (index, count) => `${index}/${count} 项匹配`, none: "没有匹配内容" },
});
const searchInput = document.getElementById("manual-search-input");
const searchClear = document.getElementById("manual-search-clear");
const searchStatus = document.getElementById("manual-search-status");
let activeArticle = null;
let activeLanguage = "en";
let searchMatches = [];
let searchMatchIndex = -1;

function normalizeLanguage(value) {
	const language = String(value || "").toLowerCase();
	if (language.startsWith("zh")) return "zh-CN";
	if (language.startsWith("en")) return "en";
	return null;
}

function requestedLanguage() {
	const query = new URLSearchParams(location.search).get("lang");
	const queryLanguage = normalizeLanguage(query);
	if (queryLanguage) return queryLanguage;
	const stored = localStorage.getItem("sviber.documentationLanguage");
	if (supported.has(stored)) return stored;
	return normalizeLanguage(navigator.language) || "en";
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
		const heading = document.getElementById(link.hash.slice(1));
		link.hidden = Boolean(searchInput?.value.trim() && heading?.hidden);
	}
	for (const group of contents.querySelectorAll(".contents-group")) {
		group.hidden = !group.querySelector("a:not([hidden])");
	}
}

function focusSearchMatch(index, behavior = "smooth") {
	if (!searchMatches.length) return;
	searchMatchIndex = (index + searchMatches.length) % searchMatches.length;
	const target = searchMatches[searchMatchIndex];
	for (const node of searchMatches) node.classList.toggle("search-match-current", node === target);
	target.scrollIntoView({ behavior, block: "center" });
	searchStatus.textContent = searchLabels[activeLanguage].matches(searchMatchIndex + 1, searchMatches.length);
}

function applySearch(value = "") {
	if (!activeArticle) return;
	const query = String(value).trim().toLocaleLowerCase();
	const tokens = query ? query.split(/\s+/).filter(Boolean) : [];
	searchMatches = [];
	searchMatchIndex = -1;
	const searchable = [...activeArticle.querySelectorAll("h2, h3, p, li, tr")];
	for (const node of searchable) node.hidden = false;
	for (const node of searchable) node.classList.remove("search-match-current");
	for (const node of activeArticle.querySelectorAll("table, ul, ol")) node.hidden = false;
	if (!tokens.length) {
		searchClear.hidden = true;
		searchStatus.textContent = "";
		syncContents();
		return;
	}

	let currentH2 = null;
	let currentH3 = null;
	let matches = 0;
	const matchedNodes = [];
	for (const node of searchable) {
		if (node.matches("h2")) { currentH2 = node; currentH3 = null; }
		if (node.matches("h3")) currentH3 = node;
		const text = node.textContent.toLocaleLowerCase();
		const matched = tokens.every(token => text.includes(token));
		node.hidden = !matched;
		if (!matched) continue;
		matches += 1;
		matchedNodes.push(node);
		if (currentH2) currentH2.hidden = false;
		if (currentH3) currentH3.hidden = false;
	}
	for (const table of activeArticle.querySelectorAll("table")) {
		table.hidden = !table.querySelector("tr:not([hidden])");
	}
	for (const list of activeArticle.querySelectorAll("ul, ol")) {
		list.hidden = !list.querySelector("li:not([hidden])");
	}
	searchClear.hidden = false;
	searchMatches = matchedNodes;
	if (searchMatches.length) focusSearchMatch(0, "auto");
	else searchStatus.textContent = matches ? searchLabels[activeLanguage].matches(0, matches) : searchLabels[activeLanguage].none;
	syncContents();
}

function setLanguage(language) {
	const selected = supported.has(language) ? language : "en";
	activeLanguage = selected;
	document.documentElement.lang = selected;
	languageSelect.value = selected;
	languageSelect.setAttribute("aria-label", selected === "zh-CN" ? "语言" : "Language");
	for (const option of languageSelect.options) option.textContent = languageLabels[selected][option.value];
	document.getElementById("manual-search-label").textContent = searchLabels[selected].label;
	searchInput.placeholder = searchLabels[selected].placeholder;
	searchInput.setAttribute("aria-label", searchLabels[selected].label);
	searchClear.setAttribute("aria-label", searchLabels[selected].clear);
	localStorage.setItem("sviber.documentationLanguage", selected);
	let visible = null;
	for (const article of document.querySelectorAll("article[data-language]")) {
		article.hidden = article.dataset.language !== selected;
		if (!article.hidden) visible = article;
	}
	activeArticle = visible;
	if (visible) {
		buildContents(visible);
		applySearch(searchInput.value);
	}
}

languageSelect.addEventListener("change", () => setLanguage(languageSelect.value));
document.getElementById("manual-search").addEventListener("submit", event => event.preventDefault());
searchInput.addEventListener("input", () => applySearch(searchInput.value));
searchInput.addEventListener("keydown", event => {
	if (event.key !== "Enter" || !searchMatches.length) return;
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
setLanguage(requestedLanguage());
