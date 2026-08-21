import assert from "node:assert/strict";

export async function runMacroChecks(browser, baseUrl) {
	const context = await browser.newContext({
		viewport: { width: 1180, height: 820 },
		locale: "zh-CN",
		serviceWorkers: "allow",
	});
	await context.addInitScript(() => {
		try {
			if (location.pathname.endsWith("/sviber/")) {
				localStorage.setItem("sviber.macros", JSON.stringify({
					smoke: "state.metadata.title = 'Macro smoke'; globalThis.console.log('macro smoke ok');",
					rubySmoke: { language: "ruby", content: "puts \\\"hello world\\\"" },
				}));
			}
		} catch { /* Sandboxed macro frames have no storage origin. */ }
	});
	const page = await context.newPage();
	const pageErrors = [];
	page.on("pageerror", error => pageErrors.push(`main: ${error.message}`));
	let popup;
	try {
		await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60_000 });
		await page.waitForFunction(() => Boolean(globalThis.sviber)
			&& document.querySelector("#app")?.getAttribute("aria-busy") === "false");
		const popupPromise = page.waitForEvent("popup");
		await page.evaluate(() => globalThis.sviber.openMacros());
		popup = await popupPromise;
		popup.on("pageerror", error => pageErrors.push(`popup: ${error.message}`));
		await popup.waitForSelector("#macro-list");
		assert.equal(await popup.locator("html").getAttribute("lang"), "zh-CN");
		assert.equal((await popup.locator('[data-menu="file"]').textContent()).trim(), "文件");

		await popup.locator('[data-menu="file"]').click();
		await popup.locator('[data-action="new"]').click();
		assert.equal(await popup.locator("#macro-form-dialog").evaluate(element => element.open), true);
		assert.equal((await popup.locator("#macro-form-title").textContent()).trim(), "新建宏");
		await popup.locator("[data-macro-cancel]").click();
		assert.equal(await popup.locator("#macro-form-dialog").evaluate(element => element.open), false);

		await popup.locator('[data-menu="file"]').click();
		await popup.locator('[data-action="new"]').click();
		await popup.locator("#macro-form-name").fill("SMOKE");
		await popup.locator("#macro-form").evaluate(form => form.requestSubmit());
		assert.equal(await popup.locator("#macro-form-dialog").evaluate(element => element.open), true);
		assert.equal(await popup.locator("#macro-form-error").isVisible(), true);
		await popup.locator("[data-macro-cancel]").click();

		await popup.getByRole("button", { name: "smoke", exact: true }).click();
		const historyBefore = await page.evaluate(() => globalThis.sviber.history.length);
		await popup.keyboard.press("F8");
		await page.waitForFunction(() => globalThis.sviber.model.metadata.title === "Macro smoke");
		assert.equal(await page.evaluate(() => globalThis.sviber.history.length), historyBefore + 1);
		await popup.waitForFunction(() => document.querySelector("#macro-console-output")
			?.textContent.includes("macro smoke ok"));
		await popup.getByRole("button", { name: "rubySmoke", exact: true }).click();
		await popup.keyboard.press("F8");
		await popup.waitForFunction(() => document.querySelector("#macro-console-output")
			?.textContent.includes("hello world"), null, { timeout: 30_000 });
		assert.deepEqual(pageErrors, []);
		return { locale: "zh-CN", dialog: true, applied: true, historyDelta: 2, consoleForwarded: true, ruby: true };
	} finally {
		await popup?.close().catch(() => {});
		await context.close();
	}
}
