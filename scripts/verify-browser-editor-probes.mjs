// Probes shared by the browser checks against a loaded editor page: waiting for the editor
// shell, measuring the rendered note scale, and mapping chart coordinates to viewport points.
export async function waitForEditor(page) {
	await page.waitForFunction(() => document.querySelector("#loading-screen")?.hidden === true, null, {
		timeout: 30_000,
	});
	await page.waitForFunction(
		() => globalThis.sviber?.model && document.querySelectorAll(".render-surface canvas").length === 3,
	);
}

export async function measureTapRadius(page) {
	return page.evaluate(() => {
		const app = globalThis.sviber;
		const snapshot = app.model.snapshot();
		app.model.events = [];
		app.model.editor.currentTime = [0, 0, 1];
		app.model.editor.timeSnapped = true;
		app.model.addEvent("tap", { time: [0, 0, 1], channel: app.model.channels[0].id, x: 0, y: 0 });
		app.refreshNow();
		app.stage.render();
		const surface = app.stage.surface;
		const region = app.stage.hitRegions.find(
			candidate => candidate.type === "event" && candidate.event.type === "tap",
		);
		const result = {
			width: surface.width,
			height: surface.height,
			scale: Math.min(surface.width / 250, surface.height / 150),
			radius: region?.radius,
		};
		app.model.restore(snapshot);
		app.refreshNow();
		return result;
	});
}

export async function stageChartPoint(page, x, y) {
	return page.evaluate(
		({ chartX, chartY }) => {
			const surface = globalThis.sviber.stage.surface;
			const rectangle = surface.canvas.getBoundingClientRect();
			const scale = Math.min(surface.width / 250, surface.height / 150);
			return {
				x: rectangle.left + ((surface.width / 2 + chartX * scale) * rectangle.width) / surface.width,
				y: rectangle.top + ((surface.height / 2 - chartY * scale) * rectangle.height) / surface.height,
			};
		},
		{ chartX: x, chartY: y },
	);
}
