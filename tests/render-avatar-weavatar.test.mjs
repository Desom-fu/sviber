import assert from "node:assert/strict";
import test from "node:test";

import { buildRenderRecordOptions, formFields } from "../js/app/app-render.js";
import { RENDER_AVATAR_KINDS } from "../js/core/render-defaults.js";
import { readManual } from "./module-source.mjs";

function avatarFields(kind) {
	return formFields({ files: {}, model: { metadata: {} } }, kind, null, "chart.mkv");
}

test("video and cover dialogs offer WeAvatar and hide the other avatar fields", async () => {
	assert.deepEqual(RENDER_AVATAR_KINDS, ["online", "upload", "gravatar", "weavatar"]);
	for (const kind of ["video", "cover"]) {
		const fields = avatarFields(kind);
		const avatar = fields.find(field => field.id === "avatar");
		assert.deepEqual(
			avatar.options.map(option => option.value),
			["online", "upload", "gravatar", "weavatar"],
		);
		const weavatar = fields.find(field => field.id === "avatarWeavatar");
		assert.equal(weavatar.hidden({ avatar: "gravatar" }), true);
		assert.equal(weavatar.hidden({ avatar: "weavatar" }), false);
		assert.equal(fields.filter(field => field.id.startsWith("avatar") && field.hidden).length, 4);
	}

	const video = buildRenderRecordOptions(
		"video",
		"out.mkv",
		{
			avatar: "weavatar",
			avatarWeavatar: "fox@example.com",
			avatarGravatar: "other@example.com",
			width: 100,
			height: 80,
		},
		null,
		null,
		null,
	);
	assert.equal(video.avatar, "weavatar");
	assert.equal(video.avatarWeavatar, "fox@example.com");
	assert.equal(video.avatarGravatar, undefined);
	const cover = buildRenderRecordOptions(
		"cover",
		"out.png",
		{ avatar: "weavatar", avatarWeavatar: "fox@example.com", width: 100, height: 80 },
		null,
		null,
		null,
	);
	assert.equal(cover.avatarWeavatar, "fox@example.com");

	const manual = await readManual();
	assert.match(manual, /WeAvatar/);
	assert.match(manual, /上次使用的值/);
	assert.match(manual, /前回の値/);
});
