import assert from "node:assert/strict";
import test from "node:test";
import { withAttachment } from "../js/app/app-attachment.js";
import { withCurveDraft } from "../js/app/app-curve-draft.js";
import { withEventEditing } from "../js/app/app-event-editing.js";
import { withSnappeeAttach } from "../js/app/app-snappee-attach.js";
import { withSnappeeForms } from "../js/app/app-snappee-forms.js";
import { ChartModel } from "../js/core/chart-model.js";

// The snappees panel operations: duplicating adds a numbered copy, reordering changes the
// list without touching snappee IDs, deleting detaches events but keeps their positions,
// and activation follows the selection (attached events first, else the selected snappee).
function makeApp(model, confirm = true) {
	const App = withSnappeeAttach(withAttachment(withSnappeeForms(withCurveDraft(withEventEditing(class {})))));
	const app = new App();
	app.model = model;
	app.commit = (label, mutation) => mutation(model);
	app.dialogs = { confirm: async () => confirm };
	return app;
}

function modelWithSnappees() {
	return new ChartModel({
		channels: [{ id: 0, name: "Main", active: true }],
		snappees: [
			{
				id: 5,
				type: "rectangularMesh",
				name: "Grid",
				color: "#ff0000",
				active: true,
				transformation: [1, 0, 0, 1, 0, 0],
				topLeftX: -50,
				topLeftY: 25,
				bottomRightX: 50,
				bottomRightY: -25,
				horizontalTiles: 2,
				verticalTiles: 2,
			},
			{
				id: 8,
				type: "rectangularMesh",
				name: "Grid",
				color: "#00ff00",
				active: true,
				transformation: [1, 0, 0, 1, 0, 0],
				topLeftX: -20,
				topLeftY: 10,
				bottomRightX: 20,
				bottomRightY: -10,
				horizontalTiles: 1,
				verticalTiles: 1,
			},
		],
		events: [
			{
				id: 1,
				type: "tap",
				channel: 0,
				time: [0, 0, 1],
				attached: true,
				snappee: 5,
				snapPoint: [1, 1],
			},
		],
	});
}

test("duplicating a snappee appends a numbered copy that keeps the geometry", () => {
	const model = modelWithSnappees();
	const app = makeApp(model);
	app.duplicateSnappee(5);
	assert.equal(model.snappees.length, 3);
	const copy = model.snappees[2];
	assert.equal(copy.name, "Grid 2");
	assert.notEqual(copy.id, 5);
	assert.equal(copy.topLeftX, -50);
	assert.equal(copy.horizontalTiles, 2);
	assert.equal(copy.selected, false);
});

test("reordering snappees changes only the list order, not their IDs", () => {
	const model = modelWithSnappees();
	const app = makeApp(model);
	app.moveSnappeeInList(8, -1);
	assert.deepEqual(
		model.snappees.map(snappee => snappee.id),
		[8, 5],
	);
	app.moveSnappeeInList(8, 1);
	assert.deepEqual(
		model.snappees.map(snappee => snappee.id),
		[5, 8],
	);
});

test("deleting a snappee detaches events but leaves their positions", async () => {
	const model = modelWithSnappees();
	const app = makeApp(model);
	await app.deleteSnappee(5);
	assert.equal(model.snappees.length, 1);
	const event = model.events[0];
	assert.equal(event.attached, false);
	// Snap point [1, 1] of the 2x2 grid sits at (0, 0).
	assert.deepEqual([event.x, event.y], [0, 0]);
});

test("deleting a snappee is cancelled when the confirmation is refused", async () => {
	const model = modelWithSnappees();
	const app = makeApp(model, false);
	await app.deleteSnappee(5);
	assert.equal(model.snappees.length, 2);
	assert.equal(model.events[0].attached, true);
});

test("activate and deactivate follow the selection of attached events", () => {
	const model = modelWithSnappees();
	model.events[0].selected = true;
	const app = makeApp(model);
	app.setSnappeesActive(false);
	assert.equal(model.snappees[0].active, false);
	app.setSnappeesActive(true);
	assert.equal(model.snappees[0].active, true);
});

test("deactivate all turns off and deselects every snappee", () => {
	const model = modelWithSnappees();
	model.snappees[0].selected = true;
	const app = makeApp(model);
	assert.ok(app.deactivateAllSnappees());
	assert.ok(model.snappees.every(snappee => snappee.active === false && snappee.selected === false));
	// A second run has nothing left to do.
	assert.equal(app.deactivateAllSnappees(), false);
});
