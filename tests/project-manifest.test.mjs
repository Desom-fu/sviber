import assert from "node:assert/strict";
import test from "node:test";
import { LEGACY_PROJECT_FILENAME, PROJECT_FILENAME, PROJECT_FILENAMES } from "../js/core/project.js";

test("project manifests prioritize project.sviber and retain legacy migration names", () => {
	assert.deepEqual([...PROJECT_FILENAMES], [PROJECT_FILENAME, LEGACY_PROJECT_FILENAME]);
	assert.equal(PROJECT_FILENAME, "project.sviber");
	assert.equal(LEGACY_PROJECT_FILENAME, "sviber-project.json");
});
