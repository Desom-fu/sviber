import assert from "node:assert/strict";
import test from "node:test";
import { withClipboard } from "../js/app/app-clipboard.js";
import { withFileWorkflows } from "../js/app/app-file-workflows.js";
import { ChartModel } from "../js/core/chart-model.js";
import { Rational } from "../js/core/rational.js";

test("system event clipboard preserves nested channel and snappee references", async () => {
	const clipboard = { value: "" };
	const previousNavigator = globalThis.navigator;
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: {
			clipboard: {
				async writeText(value) {
					clipboard.value = value;
				},
				async readText() {
					return clipboard.value;
				},
			},
		},
	});
	try {
		const model = ChartModel.createDefault({
			events: [
				{
					id: 10,
					type: "group",
					channel: 0,
					x: 0,
					y: 0,
					selected: true,
					events: [
						{
							id: 11,
							type: "tap",
							channel: 0,
							time: [1, 0, 1],
							attached: true,
							snappee: 0,
							snapPoint: [0, 0],
						},
					],
				},
			],
		});
		const WorkflowApp = withClipboard(withFileWorkflows(class {}));
		const app = new WorkflowApp();
		app.model = model;
		app.currentBeat = () => Rational.from(4);
		app.uniqueChannelName = name => `${name} copy`;
		app.commit = (_label, mutation) => mutation(model);
		await app.copyEvents();
		const data = JSON.parse(clipboard.value);
		assert.equal(data.version, 1);
		assert.equal(data.channels.length, 1);
		assert.equal(data.snappees.length, 1);
		assert.equal(data.events[0].events[0].snappee, data.snappees[0].id);
		await app.pasteEvents(false, { duplicateChannels: true, duplicateSnappees: true });
		const pasted = model.events.at(-1);
		assert.notEqual(pasted.channel, 0);
		assert.notEqual(pasted.events[0].snappee, 0);
		assert.equal(model.snappees.length, 2);
	} finally {
		if (previousNavigator === undefined) {
			delete globalThis.navigator;
		} else {
			Object.defineProperty(globalThis, "navigator", { configurable: true, value: previousNavigator });
		}
	}
});
