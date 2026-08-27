// Browser-side harness shared by the out-of-bound behaviour checks. Installing it publishes
// `globalThis.__sviberBoundsHarness` on the page: a factory that rebuilds a one-channel chart
// with the chart boundary either enforced or lifted, plus the event, snappee and clipboard
// fixtures every check reuses. Releasing it restores the chart the editor had before.

export async function installBoundsHarness(page, fixture) {
	await page.evaluate(saved => {
		const app = globalThis.sviber;
		const harness = { fixture: saved, originalClipboard: structuredClone(app.internalClipboard) };
		harness.baseState = () => {
			const state = structuredClone(saved.snapshot);
			state.channels = [{ id: 0 }];
			state.editor = { ...state.editor, currentChannel: 0, currentTime: [0, 0, 1], timeSnapped: true };
			state.events = [];
			state.snappees = [];
			state.nextIds = { channel: 1, event: 10, snappee: 10 };
			return state;
		};
		harness.install = ({ allow, events = [], snappees = [] }) => {
			app.freeTransform = null;
			app.previewBase = null;
			const state = harness.baseState();
			state.editor.allowOutOfBound = allow;
			state.events = events;
			state.snappees = snappees;
			app.model.restore(state);
			app.history.reset(state, saved.historyLabel);
			app.refreshNow();
		};
		harness.tap = (id, x, y, selected = true) => ({
			id,
			type: "tap",
			time: [0, 0, 1],
			channel: 0,
			selected,
			attached: false,
			x,
			y,
		});
		harness.mesh = selected => ({
			id: 0,
			type: "rectangularMesh",
			name: "boundary mesh",
			color: "#00e0ad",
			transformation: [1, 0, 0, 1, 0, 0],
			active: true,
			selected,
			topLeftX: 0,
			topLeftY: 0,
			bottomRightX: 130,
			bottomRightY: 0,
			horizontalTiles: 1,
			verticalTiles: 1,
		});
		harness.attachedPair = () => [
			{ ...harness.tap(0, 0, 0), attached: true, snappee: 0, snapPoint: [0, 0], x: undefined, y: undefined },
			{ ...harness.tap(1, 0, 0), attached: true, snappee: 0, snapPoint: [0, 0], x: undefined, y: undefined },
		];
		harness.attachedEvent = {
			...harness.tap(0, 0, 0),
			attached: true,
			snappee: 0,
			snapPoint: [0, 0],
			x: undefined,
			y: undefined,
		};
		harness.pasteData = async (allow, data, duplicateSnappees) => {
			harness.install({ allow });
			app.internalClipboard = structuredClone(data);
			await navigator.clipboard.writeText(JSON.stringify(data.events));
			await app.pasteEvents(duplicateSnappees);
			const event = app.model.events[0];
			const generated = app.model.generateSunniesnowEvents().find(item => item.type === "tap");
			return {
				attached: event.attached,
				x: event.x,
				y: event.y,
				generatedX: generated?.properties.x,
				generatedY: generated?.properties.y,
			};
		};
		harness.editSnappeeThroughDialog = async allow => {
			harness.install({ allow, events: [harness.attachedEvent], snappees: [harness.mesh(false)] });
			const originalForm = app.dialogs.form;
			app.dialogs.form = async () => ({
				...app.snappeeFormValues("rectangularMesh", app.model.snappees[0]),
				topLeft: [150, 70],
			});
			try {
				await app.showSnappeeDialog("rectangularMesh", 0);
			} finally {
				app.dialogs.form = originalForm;
			}
			return {
				x: app.model.snappees[0].topLeftX,
				y: app.model.snappees[0].topLeftY,
				generatedX: app.model.generateSunniesnowEvents().find(item => item.type === "tap")?.properties.x,
				generatedY: app.model.generateSunniesnowEvents().find(item => item.type === "tap")?.properties.y,
			};
		};
		globalThis.__sviberBoundsHarness = harness;
	}, fixture);
}

export async function releaseBoundsHarness(page) {
	await page.evaluate(() => {
		const app = globalThis.sviber;
		const harness = globalThis.__sviberBoundsHarness;
		app.model.restore(harness.fixture.snapshot);
		app.history.reset(harness.fixture.snapshot, harness.fixture.historyLabel);
		app.savedSignature = harness.fixture.savedSignature;
		app.internalClipboard = harness.originalClipboard;
		app.updateDirty();
		app.refreshNow();
		delete globalThis.__sviberBoundsHarness;
	});
}
