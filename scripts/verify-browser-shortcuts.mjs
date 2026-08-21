import assert from "node:assert/strict";
import path from "node:path";

export async function runKeyboardShortcutLayoutChecks(page, outputDirectory) {
	await page.evaluate(() => void globalThis.sviber.registry.execute("help.keyboardShortcuts", globalThis.sviber));
	await page.locator(".keyboard-shortcuts-dialog").waitFor({ state: "visible" });
	const wide = await page.evaluate(() => {
		const dialog = document.querySelector(".keyboard-shortcuts-dialog");
		const body = dialog.querySelector(".dialog-body");
		const content = dialog.querySelector(".shortcut-columns");
		return {
			width: dialog.getBoundingClientRect().width,
			columns: getComputedStyle(content).gridTemplateColumns,
			columnCount: content.children.length,
			bodyWidth: body.clientWidth,
			bodyScrollWidth: body.scrollWidth,
			contentWidth: content.clientWidth,
			contentScrollWidth: content.scrollWidth,
			alignedGroups: [...content.querySelectorAll(".shortcut-group")].map(group => {
				const lefts = [...group.querySelectorAll(".shortcut-item > span")]
					.map(element => element.getBoundingClientRect().left);
				return lefts.length ? Math.max(...lefts) - Math.min(...lefts) : 0;
			}),
		};
	});
	assert.ok(wide.width >= 900, `shortcut dialog is not wide enough: ${JSON.stringify(wide)}`);
	assert.equal(wide.columnCount, 2);
	assert.equal(wide.columns.split(" ").length, 2, `wide shortcut dialog is not two columns: ${JSON.stringify(wide)}`);
	assert.ok(wide.bodyScrollWidth <= wide.bodyWidth + 1, `wide shortcut dialog scrolls horizontally: ${JSON.stringify(wide)}`);
	assert.ok(wide.contentScrollWidth <= wide.contentWidth + 1, `wide shortcut content overflows: ${JSON.stringify(wide)}`);
	assert.ok(wide.alignedGroups.every(delta => delta < 1), `Chinese shortcut descriptions are not aligned: ${JSON.stringify(wide)}`);
	await page.locator(".keyboard-shortcuts-dialog").screenshot({ path: path.join(outputDirectory, "sviber-shortcuts-wide.png") });
	await page.locator('.keyboard-shortcuts-dialog .dialog-button[data-dialog-action="ok"]').click();
	await page.locator(".keyboard-shortcuts-dialog").waitFor({ state: "detached" });

	await page.evaluate(() => globalThis.sviber.help.i18n.setLanguage("en-US"));
	await page.evaluate(() => void globalThis.sviber.registry.execute("help.keyboardShortcuts", globalThis.sviber));
	await page.locator(".keyboard-shortcuts-dialog").waitFor({ state: "visible" });
	const english = await page.evaluate(() => {
		const content = document.querySelector(".shortcut-columns");
		return [...content.querySelectorAll(".shortcut-group")].map(group => {
			const lefts = [...group.querySelectorAll(".shortcut-item > span")]
				.map(element => element.getBoundingClientRect().left);
			return lefts.length ? Math.max(...lefts) - Math.min(...lefts) : 0;
		});
	});
	assert.ok(english.every(delta => delta < 1), `English shortcut descriptions are not aligned: ${JSON.stringify(english)}`);
	await page.locator('.keyboard-shortcuts-dialog .dialog-button[data-dialog-action="ok"]').click();
	await page.locator(".keyboard-shortcuts-dialog").waitFor({ state: "detached" });
	await page.evaluate(() => globalThis.sviber.help.i18n.setLanguage("zh-CN"));
	await page.evaluate(() => void globalThis.sviber.registry.execute("help.keyboardShortcuts", globalThis.sviber));
	await page.locator(".keyboard-shortcuts-dialog").waitFor({ state: "visible" });

	await page.setViewportSize({ width: 700, height: 700 });
	await page.waitForTimeout(100);
	const narrow = await page.evaluate(() => {
		const dialog = document.querySelector(".keyboard-shortcuts-dialog");
		const body = dialog.querySelector(".dialog-body");
		const content = dialog.querySelector(".shortcut-columns");
		return {
			columns: getComputedStyle(content).gridTemplateColumns,
			bodyWidth: body.clientWidth,
			bodyScrollWidth: body.scrollWidth,
			contentWidth: content.clientWidth,
			contentScrollWidth: content.scrollWidth,
		};
	});
	assert.equal(narrow.columns.split(" ").length, 1, `narrow shortcut dialog is not one column: ${JSON.stringify(narrow)}`);
	assert.ok(narrow.bodyScrollWidth <= narrow.bodyWidth + 1, `narrow shortcut dialog scrolls horizontally: ${JSON.stringify(narrow)}`);
	assert.ok(narrow.contentScrollWidth <= narrow.contentWidth + 1, `narrow shortcut content overflows: ${JSON.stringify(narrow)}`);
	await page.locator(".keyboard-shortcuts-dialog").screenshot({ path: path.join(outputDirectory, "sviber-shortcuts-narrow.png") });
	await page.setViewportSize({ width: 1440, height: 900 });
	return { wide, english, narrow };
}
