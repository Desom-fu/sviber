import assert from "node:assert/strict";
import test from "node:test";

test("Channel.tipPointSwitch writes a permutation at a beat", async () => {
	await import("../js/macro/macro-api.js");
	const runtime = globalThis.createSviberMacroApi({
		channels: [
			{ id: 0, name: "A" },
			{ id: 1, name: "B" },
		],
		events: [],
		snappees: [],
		editor: { currentChannel: 0, currentTime: [0, 0, 1] },
	});
	const [first, second] = runtime.globals.Channel.list;
	const map = new Map([
		[first, second],
		[second, first],
	]);
	runtime.globals.Channel.tipPointSwitch([1, 0, 1], map);
	assert.equal(runtime.state.channels[0].tipPointSwitches[0].target, 1);
	assert.equal(runtime.state.channels[1].tipPointSwitches[0].target, 0);
});
