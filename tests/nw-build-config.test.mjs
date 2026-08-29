import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { builderApplicationOptions, PACKAGED_WINDOW_ICON } from "../scripts/nw-build-config.mjs";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("source icons are generated from SVG for direct NW.js launches", async () => {
	assert.equal(packageJson.window.icon, "icon.png");
	assert.equal(PACKAGED_WINDOW_ICON, "sviber/icon.png");
	const svg = await readFile(new URL("../svg/icon.svg", import.meta.url), "utf8");
	const [build, gitignore] = await Promise.all([
		readFile(new URL("../scripts/build-nw.mjs", import.meta.url), "utf8"),
		readFile(new URL("../.gitignore", import.meta.url), "utf8"),
	]);
	assert.match(svg, /<svg\b/);
	assert.match(build, /generateSourceIcons/);
	assert.match(build, /path\.join\(sviberDirectory, "icon\.ico"\)/);
	assert.match(build, /path\.join\(sviberDirectory, "icon\.png"\)/);
	assert.match(gitignore, /^\/icon\.ico$/m);
	assert.match(gitignore, /^\/icon\.png$/m);
});

test("NW.js builder selects native icon formats for each desktop platform", () => {
	assert.equal(builderApplicationOptions("win", packageJson).icon, "sviber/icon.ico");
	assert.equal(builderApplicationOptions("linux", packageJson).icon, "sviber/icon.png");
	assert.equal(builderApplicationOptions("osx", packageJson).icon, "sviber/icon.icns");
});

test("macOS NW.js builder metadata satisfies every required string field", () => {
	const application = builderApplicationOptions("osx", packageJson);
	for (const field of [
		"name",
		"icon",
		"LSApplicationCategoryType",
		"CFBundleIdentifier",
		"CFBundleName",
		"CFBundleDisplayName",
		"CFBundleSpokenName",
		"CFBundleVersion",
		"CFBundleShortVersionString",
		"NSHumanReadableCopyright",
	]) {
		assert.equal(typeof application[field], "string", `${field} must be a string`);
	}
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
	assert.match(source, /SVIBER_BUILD_DIRECTORY/);
	assert.match(source, /effectiveBuildDirectory/);
	assert.match(source, /platform: TARGET_PLATFORM/);
	assert.match(source, /arch: TARGET_ARCH/);
	assert.match(source, /win: new Set\(\["ia32", "x64", "arm64"\]\)/);
	assert.match(source, /osx: new Set\(\["x64", "arm64"\]\)/);
	assert.match(source, /linux: new Set\(\["x64", "arm64"\]\)/);
	assert.match(source, /generatePackagedIcons\(applicationDirectory, TARGET_PLATFORM\)/);
});

test("release workflows archive each target with the required format", async () => {
	const workflow = await readFile(new URL("../.github/workflows/package.yml", import.meta.url), "utf8");
	// v21: every bundle is named sviber-${version}-${os}-${arch}.${ext}.
	const targets = [
		["windows", "x86", "ia32", "win", "zip"],
		["windows", "x86_64", "x64", "win", "zip"],
		["windows", "aarch64", "arm64", "win", "zip"],
		["linux", "x86_64", "x64", "linux", "tar.gz"],
		["linux", "aarch64", "arm64", "linux", "tar.gz"],
		["macos", "x86_64", "x64", "osx", "dmg"],
		["macos", "aarch64", "arm64", "osx", "dmg"],
	];
	for (const [osName, archName, arch, nwPlatform, archive] of targets) {
		const extension = archive.replace(".", "\\.");
		const pattern = [
			`osName: ${osName}[\\s\\S]*?`,
			`archName: ${archName}[\\s\\S]*?`,
			`nwPlatform: ${nwPlatform}[\\s\\S]*?`,
			`arch: ${arch}[\\s\\S]*?`,
			`archive: ${extension}`,
		].join("");
		assert.match(workflow, new RegExp(pattern));
	}
	assert.match(workflow, /SVIBER_NW_PLATFORM: \$\{\{ matrix\.nwPlatform \}\}/);
	assert.match(workflow, /SVIBER_NW_ARCH: \$\{\{ matrix\.arch \}\}/);
	assert.match(workflow, /startsWith\(matrix\.archName, 'x86'\)[\s\S]*?Compress-Archive/);
	assert.match(workflow, /startsWith\(matrix\.osName, 'macos'\)[\s\S]*?hdiutil create/);
	assert.doesNotMatch(workflow, /ditto -c -k/);
	assert.doesNotMatch(workflow, /--keepParent build\/nw/);
	assert.match(workflow, /if: startsWith\(matrix\.osName, 'linux'\)[\s\S]*?tar -czf/);
	assert.match(
		workflow,
		/path: sviber-\$\{\{ env\.version \}\}-\$\{\{ matrix\.osName \}\}-\$\{\{ matrix\.archName \}\}\.\$\{\{ matrix\.archive \}\}/,
	);
	assert.match(workflow, /node -p "require\('\.\/package\.json'\)\.version"/);
	const release = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
	assert.match(release, /release\/\*\.zip/);
	assert.match(release, /release\/\*\.dmg/);
	assert.match(release, /release\/\*\.tar\.gz/);
	assert.match(release, /release\/\*\.nw/);
});

test("NW.js staging includes the shipped icon directory", async () => {
	const source = await readFile(new URL("../scripts/build-nw.mjs", import.meta.url), "utf8");
	assert.doesNotMatch(source, /new-icons-4/);
});
