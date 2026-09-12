import assert from "node:assert/strict";
import test from "node:test";

test("Chart.metadata is an immutable snapshot of chart attributes", async () => {
	await import("../js/macro/macro-api.js");
	const runtime = globalThis.createSviberMacroApi({
		metadata: {
			title: "Song",
			artist: "Artist",
			charter: "Charter",
			difficultyName: "Hard",
			difficulty: "10",
			difficultyColor: "#e75e74",
			difficultySup: "+",
		},
		music: "song.ogg",
		image: "cover.png",
		channels: [{ id: 0, name: "Main" }],
		events: [],
		snappees: [],
	});
	const metadata = runtime.globals.Chart.metadata;
	assert.equal(metadata.title, "Song");
	assert.equal(metadata.difficulty_name, "Hard");
	assert.equal(metadata.music, "song.ogg");
	assert.equal(metadata.image, "cover.png");
	assert.ok(Object.isFrozen(metadata));
	assert.throws(() => {
		metadata.title = "nope";
	});
});
