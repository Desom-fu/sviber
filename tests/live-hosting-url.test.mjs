import assert from "node:assert/strict";
import test from "node:test";
import { hostedLevelUrl } from "../js/platform/live-hosting.js";

test("live hosting URL keeps the listening host even when it is 0.0.0.0", () => {
	assert.equal(hostedLevelUrl({ address: "0.0.0.0", port: 8011 }), "http://0.0.0.0:8011/sviber.ssc");
	assert.equal(hostedLevelUrl({ address: "127.0.0.1", port: 8011 }), "http://127.0.0.1:8011/sviber.ssc");
});
