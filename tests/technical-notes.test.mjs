import assert from "node:assert/strict";
import test from "node:test";
import { assertSourceContracts, readJson, readSource } from "./audit-contract-helpers.mjs";

test("source layout and offline dependencies follow technical notes", async () => {
	const [packageJson, gitignore, loader, serviceWorker, buildScript] = await Promise.all([
		readJson("package.json"),
		readSource(".gitignore"),
		readSource("js/boot/vendor-loader.js"),
		readSource("service-worker.js"),
		readSource("scripts/build-nw.mjs"),
	]);
	assert.equal(packageJson.type, "module");
	assert.equal(packageJson.main, "index.html");
	assert.match(loader, /pixi/i);
	assert.match(loader, /jsdelivr|node_modules/i);
	assert.match(serviceWorker, /caches\.open|CACHE_VERSION/);
	assert.match(buildScript, /font-assets|download/i);
	assert.match(gitignore, /node_modules/);
	assert.match(gitignore, /build\//);
});

test("audio context keep-alive remains active after silence", async () => {
	const player = await readSource("js/audio/player.js");
	assert.match(player, /createConstantSource/);
	assert.match(player, /createMediaStreamDestination/);
	assert.match(player, /keepAlive/);
});

test("document-level drag listeners survive leaving the canvas", async () => {
	await assertSourceContracts([
		["js/render/timeline.js", [/boundMove|boundUp|_queuePointerMove/]],
		["js/render/timeline-pointer.js", [/document\.addEventListener\("pointer(move|up|cancel)"/]],
		["js/render/stage-pointer.js", [/document\.addEventListener\("pointer(move|up|cancel)"/]],
	]);
});
