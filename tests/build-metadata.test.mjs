import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("build/package metadata is shared through JSON and Nix", async () => {
	const [fonts, build, defaultNix, flake] = await Promise.all([
		readFile(new URL("../json/font-assets.json", import.meta.url), "utf8"),
		readFile(new URL("../scripts/build-nw.mjs", import.meta.url), "utf8"),
		readFile(new URL("../default.nix", import.meta.url), "utf8"),
		readFile(new URL("../flake.nix", import.meta.url), "utf8"),
	]);
	assert.ok(JSON.parse(fonts).length >= 5);
	assert.match(build, /font-assets\.json/);
	assert.match(defaultNix, /builtins\.fromJSON \(builtins\.readFile \.\/json\/font-assets\.json\)/);
	assert.match(defaultNix, /importNpmLock\.npmConfigHook/);
	assert.match(defaultNix, /SVIBER_NW_PACKAGE_ONLY=1/);
	assert.match(defaultNix, /makeWrapper/);
	assert.match(flake, /nixos-unstable/);
});
