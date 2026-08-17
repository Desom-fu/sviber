function browserVersions() {
	const userAgent = String(navigator.userAgent || "");
	const chromium = userAgent.match(/(?:Chrome|Chromium)\/([\d.]+)/)?.[1];
	const firefox = userAgent.match(/Firefox\/([\d.]+)/)?.[1];
	const safari = !chromium && userAgent.match(/Version\/([\d.]+).*Safari/)?.[1];
	return {
		browser: chromium ? `Chromium ${chromium}` : firefox ? `Firefox ${firefox}` : safari ? `Safari ${safari}` : userAgent,
		engine: chromium ? `Chromium ${chromium}` : "",
	};
}

async function optionalJson(url) {
	try {
		const response = await fetch(url, { cache: "no-store" });
		return response.ok ? await response.json() : {};
	} catch {
		return {};
	}
}

function nwRuntimeInformation() {
	if (!globalThis.nw || !globalThis.process) return null;
	let osVersion = "";
	try {
		const os = typeof globalThis.nw.require === "function" ? globalThis.nw.require("os") : null;
		osVersion = os ? `${os.platform()} ${os.release()}` : String(process.platform || "");
	} catch {
		osVersion = String(process.platform || "");
	}
	return {
		nw: process.versions?.nw || "",
		engine: process.versions?.chromium ? `Chromium ${process.versions.chromium}` : "",
		node: process.versions?.node || "",
		v8: process.versions?.v8 || "",
		os: osVersion,
	};
}

function repositoryUrl(value) {
	if (typeof value === "string") return value;
	return String(value?.url || "").replace(/^git\+/, "").replace(/\.git$/, "");
}

function bugsUrl(value) {
	return typeof value === "string" ? value : String(value?.url || "");
}

async function copyText(text) {
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return;
		} catch { /* NW.js can deny Clipboard API access for extension URLs. */ }
	}
	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.className = "visually-hidden";
	document.body.append(textarea);
	textarea.select();
	try {
		if (!document.execCommand("copy")) throw new Error("Clipboard access is unavailable.");
	} finally {
		textarea.remove();
	}
}

export class HelpController {
	constructor(options = {}) {
		this.dialogs = options.dialogs;
		this.i18n = options.i18n;
		this.packageInformation = null;
	}

	async packageInfo() {
		this.packageInformation ||= optionalJson("package.json");
		return this.packageInformation;
	}

	openDocumentation() {
		const url = new URL(`docs/index.html?lang=${encodeURIComponent(this.i18n.language)}`, location.href).href;
		if (globalThis.nw?.Window?.open) {
			globalThis.nw.Window.open(url, { title: "sviber Documentation", width: 1080, height: 760, min_width: 720, min_height: 500 });
		} else {
			window.open(url, "_blank", "noopener");
		}
	}

	async reportIssues() {
		const information = await this.packageInfo();
		const url = bugsUrl(information.bugs);
		if (!url) return;
		if (globalThis.nw?.Shell?.openExternal) globalThis.nw.Shell.openExternal(url);
		else window.open(url, "_blank", "noopener");
	}

	async aboutEntries() {
		const packagedNw = Boolean(globalThis.nw && globalThis.nw.App?.manifest?.["sviber-source"] !== true);
		const [information, build] = await Promise.all([
			this.packageInfo(),
			packagedNw ? optionalJson("build-info.json") : {},
		]);
		const runtime = nwRuntimeInformation();
		const browser = runtime ? null : browserVersions();
		return [
			["about.repository", repositoryUrl(information.repository), "url"],
			["about.license", information.license],
			["about.version", information.version],
			["about.commit", build.commit],
			["about.commitDate", build.commitDate],
			["about.nwVersion", runtime?.nw],
			["about.browserVersion", browser?.browser],
			["about.engineVersion", runtime?.engine || browser?.engine],
			["about.nodeVersion", runtime?.node],
			["about.v8Version", runtime?.v8],
			["about.operatingSystem", runtime?.os || navigator.userAgentData?.platform || navigator.platform],
		].filter(([, value]) => value != null && String(value).trim());
	}

	async showAbout() {
		const entries = await this.aboutEntries();
		const content = document.createElement("dl");
		content.className = "about-information";
		for (const [key, value, type] of entries) {
			const term = document.createElement("dt");
			term.textContent = this.i18n.t(key);
			const description = document.createElement("dd");
			if (type === "url") {
				const link = document.createElement("a");
				link.href = String(value);
				link.textContent = String(value);
				link.target = "_blank";
				link.rel = "noopener";
				description.append(link);
			} else description.textContent = String(value);
			content.append(term, description);
		}
		const text = entries.map(([key, value]) => `${this.i18n.t(key)}: ${value}`).join("\n");
		await this.dialogs.open({
			titleKey: "dialog.about",
			content,
			buttons: [
				{ id: "ok", labelKey: "dialog.ok", primary: true, value: true, validate: false },
				{ id: "copy", labelKey: "dialog.copy", validate: false, onClick: async () => {
					await copyText(text);
					return false;
				} },
			],
		});
	}
}
