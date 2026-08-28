import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { encodeWebSocketFrame, parseAddress } from "../js/platform/live-hosting.js";

test("live reload uses the sscharter WebSocket handshake contract", async () => {
	assert.deepEqual(parseAddress("127.0.0.1:31108"), { host: "127.0.0.1", port: 31108 });
	const frame = encodeWebSocketFrame('{"type":"update"}', Buffer);
	assert.equal(frame[0], 0x81);
	assert.equal(frame[1], 17);
	assert.equal(frame.subarray(2).toString(), '{"type":"update"}');
	const source = await readFile(new URL("../js/platform/live-hosting.js", import.meta.url), "utf8");
	assert.match(source, /Sec-WebSocket-Accept/);
	assert.match(source, /eventInfoTip/);
});
