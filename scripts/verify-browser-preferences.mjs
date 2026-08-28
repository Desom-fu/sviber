import assert from "node:assert/strict";
import path from "node:path";

async function waitForEditor(page) {
	await page.waitForFunction(
		() => document.querySelector("#loading-screen")?.hidden === true && globalThis.sviber?.model,
	);
}

async function openPreferences(page) {
	await page.evaluate(() => void globalThis.sviber.registry.execute("file.preferences", globalThis.sviber));
	await page.waitForSelector(".dialog", { state: "visible" });
	assert.equal(await page.locator(".dialog select").count(), 2);
}

async function checkManualThemeAndLanguage(page, outputDirectory) {
	await openPreferences(page);
	await page.locator(".dialog select").nth(0).selectOption("dark");
	await page.locator(".dialog select").nth(1).selectOption("en-US");
	await page.locator('.dialog-button[data-dialog-action="ok"]').click();
	await page.waitForFunction(
		() => document.documentElement.dataset.theme === "dark" && document.documentElement.lang === "en-US",
	);
	assert.equal(await page.locator('.menu-root[data-menu-id="file"] .menu-root-button').textContent(), "File");
	assert.deepEqual(
		await page.evaluate(() => {
			const value = JSON.parse(localStorage.getItem("sviber.preferences"));
			return { theme: value.theme, language: value.language };
		}),
		{ theme: "dark", language: "en-US" },
	);
	await page.locator("#channels-tab").click();
	const darkIconFilters = await page.evaluate(() =>
		[
			document.querySelector(".tool-button img"),
			document.querySelector(".menu-command-icon img"),
			document.querySelector(".snappee-action img"),
		].map(icon => getComputedStyle(icon).filter),
	);
	assert.ok(
		darkIconFilters.every(filter => filter !== "none"),
		`manual dark theme left unreadable icons: ${darkIconFilters.join(", ")}`,
	);
	await page.screenshot({ path: path.join(outputDirectory, "preferences-dark-en-US.png"), fullPage: true });
}

async function checkPreferencesSurviveReload(page) {
	await page.reload({ waitUntil: "networkidle" });
	await waitForEditor(page);
	assert.deepEqual(
		await page.evaluate(() => ({
			theme: document.documentElement.dataset.theme,
			language: document.documentElement.lang,
		})),
		{ theme: "dark", language: "en-US" },
	);
}

async function checkDocumentationChrome(docsPage) {
	assert.deepEqual(
		await docsPage.evaluate(() => ({
			theme: document.documentElement.dataset.theme,
			page: getComputedStyle(document.documentElement).getPropertyValue("--page").trim(),
		})),
		{ theme: "dark", page: "#151719" },
	);
	const docsChrome = await docsPage.evaluate(() => {
		const header = document.querySelector(".doc-header");
		const nav = document.querySelector(".contents");
		const manual = document.querySelector(".manual");
		const before = {
			headerTop: header.getBoundingClientRect().top,
			navTop: nav.getBoundingClientRect().top,
			navLeft: nav.getBoundingClientRect().left,
		};
		manual.scrollTop = Math.min(1400, Math.max(0, manual.scrollHeight - manual.clientHeight));
		return {
			before,
			after: {
				headerTop: header.getBoundingClientRect().top,
				navTop: nav.getBoundingClientRect().top,
				navLeft: nav.getBoundingClientRect().left,
			},
			manualScroll: manual.scrollTop,
			pageScroll: window.scrollY,
			pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
		};
	});
	assert.equal(docsChrome.after.headerTop, docsChrome.before.headerTop);
	assert.equal(docsChrome.after.navTop, docsChrome.before.navTop);
	assert.equal(docsChrome.after.navLeft, docsChrome.before.navLeft);
	assert.ok(docsChrome.manualScroll > 100, `manual did not scroll: ${docsChrome.manualScroll}`);
	assert.equal(docsChrome.pageScroll, 0);
	assert.equal(docsChrome.pageOverflowX, false);
}

async function revertToSystemTheme(page, outputDirectory) {
	await openPreferences(page);
	await page.screenshot({
		path: path.join(outputDirectory, "preferences-dialog-dark-en-US.png"),
		fullPage: true,
	});
	await page.locator(".dialog select").nth(0).selectOption("system");
	await page.locator(".dialog select").nth(1).selectOption("system");
	await page.locator('.dialog-button[data-dialog-action="ok"]').click();
	await page.waitForFunction(
		() => !document.documentElement.hasAttribute("data-theme") && document.documentElement.lang === "zh-CN",
	);
	assert.equal(
		await page
			.locator(".tool-button img")
			.first()
			.evaluate(icon => getComputedStyle(icon).filter),
		"none",
	);
}

async function checkStandalonePageTheming(context, page, baseUrl, outputDirectory) {
	const docsPage = await context.newPage();
	await docsPage.goto(new URL("docs/index.html", baseUrl).href, { waitUntil: "domcontentloaded" });
	const macroPage = await context.newPage();
	await macroPage.goto(new URL("macros.html", baseUrl).href, { waitUntil: "domcontentloaded" });
	await checkDocumentationChrome(docsPage);
	assert.deepEqual(
		await macroPage.evaluate(() => ({
			theme: document.documentElement.dataset.theme,
			surface: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim(),
		})),
		{ theme: "dark", surface: "#17191c" },
	);

	await revertToSystemTheme(page, outputDirectory);
	for (const standalonePage of [docsPage, macroPage]) {
		await standalonePage.waitForFunction(() => !document.documentElement.hasAttribute("data-theme"));
	}
	assert.equal(
		await docsPage.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--page").trim()),
		"#f5f6f7",
	);
	assert.equal(
		await macroPage.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--surface").trim()),
		"#f4f5f6",
	);
	await docsPage.close();
	await macroPage.close();
}

async function checkLicensePages(context, page, outputDirectory) {
	const licenseWindowPromise = context.waitForEvent("page");
	await page.locator(".javascript-license-link").click();
	const licensePage = await licenseWindowPromise;
	await licensePage.waitForLoadState("domcontentloaded");
	assert.match(licensePage.url(), /javascript\.html$/);
	assert.match(page.url(), /\/sviber\/$/);
	assert.equal(await licensePage.locator("[data-return-editor]").textContent(), "返回编辑器");
	await licensePage.screenshot({ path: path.join(outputDirectory, "license-list.png"), fullPage: true });

	await licensePage.locator('[data-view-source="js/app/app.js"]').click();
	await licensePage.waitForURL(/source-viewer\.html\?file=js%2Fapp\.js$/);
	await licensePage.waitForFunction(() =>
		document.querySelector("#source-code")?.textContent.includes('from "./i18n.js"'),
	);
	assert.equal(await licensePage.locator('.license-back[href="javascript.html"]').textContent(), "返回许可证列表");
	assert.equal(await licensePage.locator("[data-return-editor]").textContent(), "返回编辑器");
	await licensePage.screenshot({ path: path.join(outputDirectory, "license-source-viewer.png"), fullPage: true });

	await licensePage.locator('.license-back[href="javascript.html"]').click();
	await licensePage.waitForURL(/javascript\.html$/);
	assert.equal(await licensePage.locator("#jslicense-labels1").count(), 1);
	const licenseClosePromise = licensePage.waitForEvent("close");
	await licensePage.locator("[data-return-editor]").click();
	await licenseClosePromise;
	assert.equal(page.isClosed(), false);
}

export async function runPreferenceAndLicenseChecks(browser, baseUrl, outputDirectory) {
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		locale: "zh-CN",
		colorScheme: "light",
		serviceWorkers: "block",
	});
	try {
		const page = await context.newPage();
		await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60_000 });
		await waitForEditor(page);

		await checkManualThemeAndLanguage(page, outputDirectory);
		await checkPreferencesSurviveReload(page);
		await checkStandalonePageTheming(context, page, baseUrl, outputDirectory);
		await checkLicensePages(context, page, outputDirectory);
	} finally {
		await context.close();
	}
}
