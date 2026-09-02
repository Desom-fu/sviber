import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("build/package metadata is shared through JSON and Nix", async () => {
	const [fonts, build, defaultNix, flake, flakeLock, gitignore] = await Promise.all([
		readFile(new URL("../json/font-assets.json", import.meta.url), "utf8"),
		readFile(new URL("../scripts/build-nw.mjs", import.meta.url), "utf8"),
		readFile(new URL("../default.nix", import.meta.url), "utf8"),
		readFile(new URL("../flake.nix", import.meta.url), "utf8"),
		readFile(new URL("../flake.lock", import.meta.url), "utf8"),
		readFile(new URL("../.gitignore", import.meta.url), "utf8"),
	]);
	assert.ok(JSON.parse(fonts).length >= 5);
	assert.match(build, /font-assets\.json/);
	assert.match(build, /SVIBER_BUILD_COMMIT/);
	assert.match(build, /SVIBER_BUILD_COMMIT_DATE/);
	assert.match(defaultNix, /builtins\.fromJSON \(builtins\.readFile \.\/json\/font-assets\.json\)/);
	assert.match(defaultNix, /importNpmLock\.npmConfigHook/);
	assert.match(defaultNix, /npmHooks\.npmBuildHook/);
	assert.match(defaultNix, /SVIBER_NW_PACKAGE_ONLY\s*=\s*"1"/);
	assert.match(defaultNix, /SVIBER_BUILD_COMMIT/);
	assert.match(defaultNix, /makeWrapper/);
	assert.match(defaultNix, /packaging\/linux\/sviber\.desktop/);
	assert.match(flake, /nixos-unstable/);
	assert.match(flake, /systems = \[ "x86_64-linux" \]/);
	assert.match(flake, /gitRev = self\.rev or null/);
	assert.equal(JSON.parse(flakeLock).nodes.nixpkgs.original.ref, "nixos-unstable");
	assert.match(gitignore, /^\/result$/m);
});
