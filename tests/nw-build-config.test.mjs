import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { builderApplicationOptions, PACKAGED_WINDOW_ICON } from "../scripts/nw-build-config.mjs";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("source and packaged NW.js windows use a PNG runtime icon", async () => {
	assert.equal(packageJson.window.icon, "svg/icon.png");
	assert.equal(PACKAGED_WINDOW_ICON, "sviber/icon.png");
	const png = await readFile(new URL("../svg/icon.png", import.meta.url));
	assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("NW.js builder selects native icon formats for each desktop platform", () => {
	assert.equal(builderApplicationOptions("win32", packageJson).icon, "sviber/icon.ico");
	assert.equal(builderApplicationOptions("linux", packageJson).icon, "sviber/icon.png");
	assert.equal(builderApplicationOptions("darwin", packageJson).icon, "sviber/icon.icns");
});

test("macOS NW.js builder metadata satisfies every required string field", () => {
	const application = builderApplicationOptions("darwin", packageJson);
	for (const field of [
		"name", "icon", "LSApplicationCategoryType", "CFBundleIdentifier", "CFBundleName",
		"CFBundleDisplayName", "CFBundleSpokenName", "CFBundleVersion",
		"CFBundleShortVersionString", "NSHumanReadableCopyright",
	]) assert.equal(typeof application[field], "string", `${field} must be a string`);
	assert.equal(application.CFBundleVersion, packageJson.version);
	assert.match(application.CFBundleIdentifier, /^[a-z0-9]+(?:\.[a-z0-9]+)+$/);
});

test("NW.js build creates a real macOS ICNS with iconutil", async () => {
	const source = await readFile(new URL("../scripts/build-nw.mjs", import.meta.url), "utf8");
	assert.match(source, /generateMacosIcon/);
	assert.match(source, /spawn\("iconutil"/);
	assert.match(source, /builderApplicationOptions\(process\.platform, sourcePackage\)/);
});
