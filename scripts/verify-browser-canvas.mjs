// Pixel-level assertions for the three render surfaces: every screenshot is stored under the
// verification output directory and checked for size, opacity and colour variety.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { PNG } from "pngjs";
function pixelSummary(buffer) {
	const image = PNG.sync.read(buffer);
	const colors = new Set();
	let opaque = 0;
	for (let offset = 0; offset < image.data.length; offset += 4) {
		if (image.data[offset + 3] > 0) {
			opaque += 1;
		}
		if ((offset / 4) % 7 === 0 && colors.size < 256) {
			colors.add(
				`${image.data[offset]},${image.data[offset + 1]},${image.data[offset + 2]},${image.data[offset + 3]}`,
			);
		}
	}
	return { width: image.width, height: image.height, opaque, colors: colors.size };
}

export async function assertCanvas(locator, name, outputDirectory) {
	const buffer = await locator.screenshot();
	const summary = pixelSummary(buffer);
	await writeFile(path.join(outputDirectory, `${name}.png`), buffer);
	assert.ok(summary.width > 100 && summary.height > 60, `${name} canvas is too small`);
	assert.ok(summary.opaque > summary.width * summary.height * 0.9, `${name} canvas is mostly transparent`);
	assert.ok(summary.colors > 4, `${name} canvas appears blank or single-colored`);
	return summary;
}
