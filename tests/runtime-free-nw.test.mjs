import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	FFMPEG_NAME_PATTERN,
	NATIVE_BINARY_PATTERN,
	nativeRebuildSpec,
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

test("runtime natives rebuild against NW.js Node; dev natives stay on host Node", () => {
	const runtime = nativeRebuildSpec({ kind: "runtime", nwVersion: "0.114.2", hostNodeVersion: "22.13.0" });
	assert.equal(runtime.runtime, "node-webkit");
	assert.equal(runtime.target, "0.114.2");
	assert.deepEqual(runtime.packages, ["gl", "canvas"]);
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
	assert.match(workflow, /npm_config_runtime=node-webkit/);
	assert.match(nix, /SVIBER_NW_PACKAGE_ONLY/);
	assert.match(nix, /Host-Node native rebuilds/);
});
