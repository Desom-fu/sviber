import assert from "node:assert/strict";
import test from "node:test";
import { assertSourceContracts, readJson, readSource } from "./audit-contract-helpers.mjs";

test("project internationalization autosave theme SEO license and README are implemented", async () => {
	const [project, lifecycle, auto, theme, html, license, readme, readmeZh, en, zh] = await Promise.all([
		readSource("js/core/project.js"),
		readSource("js/app/app-document-lifecycle.js"),
		readSource("js/platform/autosave.js"),
		readSource("js/boot/theme-bootstrap.js"),
		readSource("index.html"),
		readSource("javascript.html"),
		readSource("README.md"),
		readSource("README.zh-CN.md"),
		readJson("json/i18n.en-US.json"),
		readJson("json/i18n.zh-CN.json"),
	]);
	assert.match(project, /sviber-project\.json|activeChart|macros/);
	assert.match(lifecycle, /LAST_OPEN_KEY|RECENT_OPEN_KEY|autosave/);
	assert.match(auto, /120_000|evict|MANUAL_SAVE_KEY|includeGeneratedEvents/);
	assert.match(theme, /prefers-color-scheme|theme/);
	assert.match(html, /og:|twitter:|theme-color|icon\.svg/);
	assert.match(license, /AGPL|license|labels/);
	assert.match(readme, /Installation|Contributing|License|help manual/i);
	assert.match(readmeZh, /安装|贡献|许可|帮助手册/);
	assert.equal(en["field.artist"], "Artist");
	assert.equal(zh["field.artist"], "曲师");
});

test("CI build Nix CLI and lint rules are implemented", async () => {
	await assertSourceContracts([
		["default.nix", [/callPackage|mkDerivation/]],
		["flake.nix", [/nixos-unstable|default\.nix/]],
		["js/cli/cli.js", [/--help|--export|--import|isHeadlessInvocation/]],
		["scripts/nw-build-config.mjs", [/win|linux|mac|x86|aarch64|dmg|tar\.gz|zip/]],
		[".github/workflows/test.yml", [/push|pull_request|npm test/]],
		[".github/workflows/release.yml", [/tags|v\*\.\*\.\*|gh-release|upload-artifact/]],
		["eslint.config.mjs", [/max-lines|max-lines-per-function|max-len|curly|multiline-ternary/]],
	]);
});
