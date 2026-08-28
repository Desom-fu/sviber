import assert from "node:assert/strict";
import test from "node:test";
import { STAGE_INTERACTION_MODULES, readSources } from "./module-source.mjs";

test("shift-dragging the stage never retargets another event", async () => {
	const interactions = await readSources(STAGE_INTERACTION_MODULES);
	// v17: the governing event is the selected event closest to the pointer, and Shift
	// suppresses every other mouse interaction in the main field.
	assert.match(interactions, /_shiftDragTargets\(event, context\)[\s\S]*?_closestSelectedMovable\(/);
	assert.match(interactions, /event\.shiftKey && !freeTransform \? null : hit/);
	assert.match(interactions, /_closestSelectedMovable\(project, mapping, point, activeChannels\) \{/);
});
