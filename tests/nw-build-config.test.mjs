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
	assert.equal(builderApplicationOptions("win", packageJson).icon, "sviber/icon.ico");
	assert.equal(builderApplicationOptions("linux", packageJson).icon, "sviber/icon.png");
	assert.equal(builderApplicationOptions("osx", packageJson).icon, "sviber/icon.icns");
});

test("macOS NW.js builder metadata satisfies every required string field", () => {
	const application = builderApplicationOptions("osx", packageJson);
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
	assert.match(source, /builderApplicationOptions\(TARGET_PLATFORM, sourcePackage\)/);
});

test("NW.js builds pass an explicit target platform and architecture", async () => {
	const source = await readFile(new URL("../scripts/build-nw.mjs", import.meta.url), "utf8");
	assert.match(source, /SVIBER_NW_PLATFORM/);
	assert.match(source, /SVIBER_NW_ARCH/);
	assert.match(source, /platform: TARGET_PLATFORM/);
	assert.match(source, /arch: TARGET_ARCH/);
	assert.match(source, /win: new Set\(\["ia32", "x64", "arm64"\]\)/);
	assert.match(source, /osx: new Set\(\["x64", "arm64"\]\)/);
	assert.match(source, /linux: new Set\(\["x64", "arm64"\]\)/);
	assert.match(source, /generatePackagedIcons\(applicationDirectory, TARGET_PLATFORM\)/);
});

test("release workflow archives Windows and macOS as ZIP and Linux as tar.gz", async () => {
	const workflow = await readFile(new URL("../.github/workflows/test.yml", import.meta.url), "utf8");
	for (const platform of ["windows-x64", "windows-x86", "windows-arm64", "macos-x64", "macos-arm64"]) {
		assert.match(workflow, new RegExp(`platform: ${platform}[\\s\\S]*?archive: zip`));
	}
	for (const platform of ["linux-x64", "linux-arm64"]) {
		assert.match(workflow, new RegExp(`platform: ${platform}[\\s\\S]*?archive: tar\\.gz`));
	}
	assert.match(workflow, /platform: windows-x86[\s\S]*?nwPlatform: win[\s\S]*?arch: ia32/);
	assert.match(workflow, /platform: windows-arm64[\s\S]*?nwPlatform: win[\s\S]*?arch: arm64/);
	assert.match(workflow, /platform: macos-arm64[\s\S]*?nwPlatform: osx[\s\S]*?arch: arm64/);
	assert.match(workflow, /platform: linux-arm64[\s\S]*?nwPlatform: linux[\s\S]*?arch: arm64/);
	assert.match(workflow, /SVIBER_NW_PLATFORM: \$\{\{ matrix\.nwPlatform \}\}/);
	assert.match(workflow, /SVIBER_NW_ARCH: \$\{\{ matrix\.arch \}\}/);
	assert.match(workflow, /if: matrix\.os == 'windows-latest'[\s\S]*?Compress-Archive/);
	assert.match(workflow, /if: matrix\.os == 'macos-15-intel'[\s\S]*?zip -qry/);
	assert.match(workflow, /NW\.js frameworks contain symlinks/);
	assert.match(workflow, /if: matrix\.archive == 'tar\.gz'[\s\S]*?tar -czf/);
	assert.match(workflow, /path: sviber-\$\{\{ matrix\.platform \}\}\.\$\{\{ matrix\.archive \}\}/);
	assert.match(workflow, /files: \|\s*release\/\*\.zip\s*release\/\*\.tar\.gz/);
});
