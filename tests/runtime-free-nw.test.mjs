import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	ABI_REBUILD_PACKAGES,
	FFMPEG_NAME_PATTERN,
	NATIVE_BINARY_PATTERN,
	NWJS_HEADERS_DISTURL,
	nativeRebuildSpec,
	nwjsHeadersTarball,
	packagedNativeRebuildDirectory,
	shouldIncludePackagedFile,
} from "../scripts/nw-runtime-natives.mjs";

test("runtime-free .nw omits native modules and FFmpeg", () => {
	const native = { runtimeFree: true };
	const glPath = "node_modules/gl/build/Release/webgl.node";
	const canvasPath = "node_modules/canvas/build/Release/canvas.node";
	assert.equal(shouldIncludePackagedFile(glPath, native), false);
	assert.equal(shouldIncludePackagedFile(canvasPath, native), false);
	assert.equal(shouldIncludePackagedFile("bin/ffmpeg.exe", native), false);
	assert.equal(shouldIncludePackagedFile("js/app/app.js", { runtimeFree: true }), true);
	assert.match("foo.node", NATIVE_BINARY_PATTERN);
	assert.match("bin/ffmpeg", FFMPEG_NAME_PATTERN);
});

test("runtime natives stay on host Node for the bundled render worker", () => {
	const runtime = nativeRebuildSpec({ kind: "runtime", nwVersion: "0.114.2", hostNodeVersion: "22.13.0" });
	assert.equal(runtime.runtime, "node");
	assert.equal(runtime.target, "22.13.0");
	assert.equal(runtime.disturl, NWJS_HEADERS_DISTURL);
	assert.equal(runtime.tarball, nwjsHeadersTarball("0.114.2"));
	assert.equal(runtime.tarball, "https://dl.nwjs.io/v0.114.2/node-v0.114.2.tar.gz");
	assert.deepEqual(runtime.packages, ["gl", "canvas"]);
	assert.deepEqual(runtime.abiRebuildPackages, []);
	assert.deepEqual(ABI_REBUILD_PACKAGES, []);
	const host = nativeRebuildSpec({ kind: "development", nwVersion: "0.114.2", hostNodeVersion: "22.13.0" });
	assert.equal(host.runtime, "node");
	assert.equal(host.target, "22.13.0");
});

test("build script and Nix/CI encode the dual-Node split and runtime-free exclusions", async () => {
	const [build, workflow, nix] = await Promise.all([
		readFile(new URL("../scripts/build-nw.mjs", import.meta.url), "utf8"),
		readFile(new URL("../.github/workflows/package.yml", import.meta.url), "utf8"),
		readFile(new URL("../default.nix", import.meta.url), "utf8"),
	]);
	assert.match(build, /shouldIncludePackagedFile/);
	assert.match(build, /PACKAGE_ONLY/);
	assert.match(build, /writeMcpLauncher/);
	assert.match(workflow, /bundled host Node render worker/);
	assert.match(workflow, /clearing getter cache/);
	assert.doesNotMatch(workflow, /npm_config_runtime=node-webkit/);
	assert.doesNotMatch(workflow, /npm rebuild gl/);
	assert.doesNotMatch(workflow, /npmmirror\.com\/mirrors\/nwjs/);
	assert.match(nix, /SVIBER_NW_PACKAGE_ONLY/);
	assert.match(nix, /Host-Node native rebuilds/);
});

test("packaged native rebuild targets package.nw or the macOS app bundle", () => {
	const root = mkdtempSync(path.join(tmpdir(), "sviber-nw-"));
	try {
		const windows = path.join(root, "package.nw", "sviber", "node_modules", "gl");
		mkdirSync(windows, { recursive: true });
		writeFileSync(path.join(windows, ".keep"), "");
		assert.equal(packagedNativeRebuildDirectory(root), path.join(root, "package.nw", "sviber"));
		rmSync(path.join(root, "package.nw"), { recursive: true, force: true });
		const macos = path.join(root, "sviber.app", "Contents", "Resources", "app.nw", "sviber", "node_modules", "gl");
		mkdirSync(macos, { recursive: true });
		writeFileSync(path.join(macos, ".keep"), "");
		assert.equal(
			packagedNativeRebuildDirectory(root),
			path.join(root, "sviber.app", "Contents", "Resources", "app.nw", "sviber"),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
