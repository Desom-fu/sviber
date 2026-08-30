import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function readSource(path) {
	return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

export async function readJson(path) {
	return JSON.parse(await readSource(path));
}

export function assertMatches(text, pattern, message) {
	assert.match(text, pattern, message);
}

export async function assertSourceContracts(entries) {
	for (const [path, patterns] of entries) {
		const text = await readSource(path);
		for (const pattern of patterns) {
			assert.match(text, pattern, `${path} is missing ${pattern}`);
		}
	}
}
