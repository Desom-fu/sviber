import assert from "node:assert/strict";
import test from "node:test";

import { withCurveDraft } from "../js/app/app-curve-draft.js";
import { COMMAND_DEFINITIONS, MENU_DEFINITION } from "../js/app/commands.js";
import { PENCIL_SNAP_DISTANCE, buildPencilStroke, coalescedChartPoints } from "../js/app/pencil-stroke.js";
import { ChartModel } from "../js/core/chart-model.js";
import { readManual } from "./module-source.mjs";

function stroke(count, map) {
	return Array.from({ length: count }, (_, index) => ({
		...map(index),
		timestamp: index * 16,
		pressure: 0.5,
	}));
}

test("pencil is a Snappee command on Ctrl+Shift+P and samples coalesced pointer events", async () => {
	assert.equal(COMMAND_DEFINITIONS["snappee.pencil"].shortcut, "Ctrl+Shift+P");
	assert.equal(COMMAND_DEFINITIONS["snappee.pencil"].checkable, true);
	const items = MENU_DEFINITION.find(menu => menu.id === "snappee").items.map(item => item.command);
	assert.ok(items.indexOf("snappee.pencil") === items.indexOf("snappee.pen") + 1);

	const event = {
		clientX: 1,
		clientY: 2,
		timeStamp: 10,
		pressure: 0.2,
		getCoalescedEvents() {
			return [
				{ clientX: 1, clientY: 2, timeStamp: 10, pressure: 0.2 },
				{ clientX: 4, clientY: 6, timeStamp: 18, pressure: 0.8 },
			];
		},
	};
	assert.deepEqual(
		coalescedChartPoints(
			event,
			item => ({ x: item.clientX, y: item.clientY }),
			point => point,
		),
		[
			{ x: 1, y: 2, pressure: 0.2, timestamp: 10 },
			{ x: 4, y: 6, pressure: 0.8, timestamp: 18 },
		],
	);

	const manual = await readManual();
	assert.match(manual, /Ctrl\+Shift\+P/);
	assert.match(manual, /@stroke-stabilizer\/core/);
	assert.match(manual, /getCoalescedEvents/);
});

test("a pencil stroke is a smoothed pen polyline with optional snapped ends", () => {
	const line = stroke(12, index => ({ x: index * 2, y: 0 }));
	const open = buildPencilStroke(line);
	assert.ok(open.points.length >= 2);
	assert.equal(open.commands[0].type, "M");
	assert.ok(open.commands.slice(1).every(command => command.type === "L"));
	assert.equal(open.closed, false);
	assert.equal(open.segments, open.points.length - 1);

	const snappedStart = buildPencilStroke(line, { startSnap: { x: -6, y: 1 } });
	assert.deepEqual(snappedStart.points[0], { x: -6, y: 1 });
	assert.equal(snappedStart.commands[0].type, "M");

	const end = { x: 30, y: 0 };
	const towardSnap = stroke(8, index => ({ x: index * 3, y: 0 }));
	towardSnap[towardSnap.length - 1] = { ...towardSnap.at(-1), x: end.x, y: end.y };
	const snappedEnd = buildPencilStroke(towardSnap, { endSnap: { x: end.x + 4, y: 1 } });
	assert.equal(snappedEnd.closed, false);
	assert.deepEqual(snappedEnd.points.at(-1), { x: end.x + 4, y: 1 });
	assert.ok(4 <= PENCIL_SNAP_DISTANCE);

	const loop = [
		{ x: 0, y: 0, timestamp: 0 },
		{ x: 20, y: 0, timestamp: 16 },
		{ x: 20, y: 12, timestamp: 32 },
		{ x: 1, y: 1, timestamp: 48 },
	];
	const closed = buildPencilStroke(loop);
	assert.equal(closed.closed, true);
	assert.deepEqual(closed.points.at(-1), closed.points[0]);
});

test("finishing a pencil stroke creates a pen curve and opens the pen form", () => {
	const model = ChartModel.createDefault({ channels: [{ id: 0 }], snappees: [] });
	const App = withCurveDraft(
		class {
			exitModes() {
				this.creationMode = null;
				this.curveDraft = null;
			}

			commit(_label, mutate) {
				mutate(this.model);
			}

			defaultSnappeeName() {
				return "Pen curve 1";
			}

			showSnappeeDialog(type, id, options) {
				this.dialog = { type, id, options };
			}

			refreshInteractionPreview() {}

			_syncCheckedCommands() {}
		},
	);
	const app = new App();
	app.model = model;
	app.startPencil();
	assert.equal(app.curveDraft.type, "pencil");
	app.appendPencilSamples(stroke(6, index => ({ x: index * 4, y: index })));
	assert.ok(app.curveDraft.points.length >= 2);
	app.finishPencilStroke();
	const created = model.snappees.find(snappee => snappee.type === "penCurve");
	assert.ok(created);
	assert.equal(created.selected, true);
	assert.equal(created.commands[0].type, "M");
	assert.ok(created.commands.every(command => command.type === "M" || command.type === "L"));
	assert.equal(app.curveDraft, null);
	assert.deepEqual(app.dialog, {
		type: "penCurve",
		id: created.id,
		options: { focusField: "segments" },
	});
});
