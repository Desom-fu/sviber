(() => {
	const fontStyles = document.createElement("link");
	fontStyles.rel = "stylesheet";
	fontStyles.href = globalThis.nw ? "css/fonts-local.css" : "css/fonts-web.css";
	document.head.append(fontStyles);
})();
