const languageSelect = document.getElementById("language");
const contents = document.getElementById("contents");
const supported = new Set(["en", "zh-CN"]);
const languageLabels = Object.freeze({
	en: { en: "English", "zh-CN": "Simplified Chinese" },
	"zh-CN": { en: "英文", "zh-CN": "简体中文" },
});

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
}

function setLanguage(language) {
	const selected = supported.has(language) ? language : "en";
	document.documentElement.lang = selected;
	languageSelect.value = selected;
	languageSelect.setAttribute("aria-label", selected === "zh-CN" ? "语言" : "Language");
	for (const option of languageSelect.options) option.textContent = languageLabels[selected][option.value];
	localStorage.setItem("sviber.documentationLanguage", selected);
	let visible = null;
	for (const article of document.querySelectorAll("article[data-language]")) {
		article.hidden = article.dataset.language !== selected;
		if (!article.hidden) visible = article;
	}
	if (visible) buildContents(visible);
}

languageSelect.addEventListener("change", () => setLanguage(languageSelect.value));
setLanguage(requestedLanguage());
