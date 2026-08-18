import assert from "node:assert/strict";
import path from "node:path";

async function waitForEditor(page) {
	await page.waitForFunction(() => document.querySelector("#loading-screen")?.hidden === true && globalThis.sviber?.model);
}

async function openPreferences(page) {
	await page.evaluate(() => void globalThis.sviber.registry.execute("file.preferences", globalThis.sviber));
	await page.waitForSelector(".dialog", { state: "visible" });
	assert.equal(await page.locator(".dialog select").count(), 2);
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

		await openPreferences(page);
		await page.locator(".dialog select").nth(0).selectOption("dark");
		await page.locator(".dialog select").nth(1).selectOption("en-US");
		await page.locator('.dialog-button[data-dialog-action="ok"]').click();
		await page.waitForFunction(() => document.documentElement.dataset.theme === "dark"
			&& document.documentElement.lang === "en-US");
		assert.equal(await page.locator('.menu-root[data-menu-id="file"] .menu-root-button').textContent(), "File");
		assert.deepEqual(await page.evaluate(() => {
			const value = JSON.parse(localStorage.getItem("sviber.preferences"));
			return { theme: value.theme, language: value.language };
		}), { theme: "dark", language: "en-US" });
		await page.locator("#channels-tab").click();
		const darkIconFilters = await page.evaluate(() => [
			document.querySelector(".tool-button img"),
			document.querySelector(".menu-command-icon img"),
			document.querySelector(".snappee-action img"),
		].map(icon => getComputedStyle(icon).filter));
		assert.ok(darkIconFilters.every(filter => filter !== "none"),
			`manual dark theme left unreadable icons: ${darkIconFilters.join(", ")}`);
		await page.screenshot({ path: path.join(outputDirectory, "preferences-dark-en-US.png"), fullPage: true });

		await page.reload({ waitUntil: "networkidle" });
		await waitForEditor(page);
		assert.deepEqual(await page.evaluate(() => ({
			theme: document.documentElement.dataset.theme,
			language: document.documentElement.lang,
		})), { theme: "dark", language: "en-US" });

		await openPreferences(page);
		await page.screenshot({ path: path.join(outputDirectory, "preferences-dialog-dark-en-US.png"), fullPage: true });
		await page.locator(".dialog select").nth(0).selectOption("system");
		await page.locator(".dialog select").nth(1).selectOption("system");
		await page.locator('.dialog-button[data-dialog-action="ok"]').click();
		await page.waitForFunction(() => !document.documentElement.hasAttribute("data-theme")
			&& document.documentElement.lang === "zh-CN");
		assert.equal(await page.locator(".tool-button img").first().evaluate(icon => getComputedStyle(icon).filter), "none");

		const licenseWindowPromise = context.waitForEvent("page");
		await page.locator(".javascript-license-link").click();
		const licensePage = await licenseWindowPromise;
		await licensePage.waitForLoadState("domcontentloaded");
		assert.match(licensePage.url(), /javascript\.html$/);
		assert.match(page.url(), /\/sviber\/$/);
		assert.equal(await licensePage.locator("[data-return-editor]").textContent(), "返回编辑器");
		await licensePage.screenshot({ path: path.join(outputDirectory, "license-list.png"), fullPage: true });

		await licensePage.locator('[data-view-source="js/app.js"]').click();
		await licensePage.waitForURL(/source-viewer\.html\?file=js%2Fapp\.js$/);
		await licensePage.waitForFunction(() => document.querySelector("#source-code")?.textContent.includes("from \"./i18n.js\""));
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
	} finally {
		await context.close();
	}
}
