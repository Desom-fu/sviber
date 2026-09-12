import assert from "node:assert/strict";
import test from "node:test";

import { ChartModel } from "../js/core/chart-model.js";
import { bookmarkAtTime, deleteBookmark, upsertBookmark } from "../js/core/bookmarks.js";
import { COMMAND_DEFINITIONS, MENU_DEFINITION } from "../js/app/commands.js";

test("bookmarks allow empty names, upsert by time, and delete", () => {
	let bookmarks = upsertBookmark([], [1, 0, 1], "");
	assert.equal(bookmarks[0].name, "");
	bookmarks = upsertBookmark(bookmarks, [1, 0, 1], "verse");
	assert.equal(bookmarkAtTime(bookmarks, [1, 0, 1]).name, "verse");
	assert.equal(deleteBookmark(bookmarks, [1, 0, 1]).length, 0);
});

test("bookmarks round-trip on the chart JSON", () => {
	const model = ChartModel.createDefault({
		editor: { bookmarks: [{ time: [2, 1, 2], name: "drop" }] },
	});
	const restored = ChartModel.import({ metadata: model.metadata, sviber: model.serializeSviber() });
	assert.deepEqual(restored.editor.bookmarks, [{ time: [2, 1, 2], name: "drop" }]);
});

test("Bookmark... is Shift+B on the Music menu", () => {
	assert.equal(COMMAND_DEFINITIONS["music.bookmark"].shortcut, "Shift+B");
	const music = MENU_DEFINITION.find(menu => menu.id === "music");
	assert.ok(music.items.some(item => item.command === "music.bookmark"));
});
