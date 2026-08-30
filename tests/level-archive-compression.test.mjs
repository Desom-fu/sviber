import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { createLevelArchive } from "../js/platform/platform-level-archive.js";
import { ChartModel } from "../js/core/chart-model.js";

async function archiveWith(compression) {
	const previousZip = globalThis.JSZip;
	const previousReady = globalThis.sviberDependenciesReady;
	globalThis.JSZip = JSZip;
	globalThis.sviberDependenciesReady = Promise.resolve();
	try {
		const model = ChartModel.createDefault({ metadata: { title: "Archive" } });
		const files = {
			resolveAssetPath() {
				return null;
			},
			async fileForAsset() {
				return null;
			},
			currentProjectDirectory() {
				return null;
			},
		};
		const blob = await createLevelArchive(files, { charts: [{ file: "chart.json", model }] }, { compression });
		return JSZip.loadAsync(await blob.arrayBuffer());
	} finally {
		if (previousZip === undefined) {
			delete globalThis.JSZip;
		} else {
			globalThis.JSZip = previousZip;
		}
		if (previousReady === undefined) {
			delete globalThis.sviberDependenciesReady;
		} else {
			globalThis.sviberDependenciesReady = previousReady;
		}
	}
}

function compressionName(entry) {
	return entry?._data?.compression?.magic === "\x00\x00" ? "STORE" : "DEFLATE";
}

test("hosted level archives use level-zero STORE compression", async () => {
	const archive = await archiveWith("STORE");
	assert.equal(compressionName(archive.file("chart.json")), "STORE");
});

test("ordinary level exports retain DEFLATE compression", async () => {
	const archive = await archiveWith(undefined);
	assert.equal(compressionName(archive.file("chart.json")), "DEFLATE");
});
