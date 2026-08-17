function summarize(eventCount, samples, cpuTasks) {
	samples.sort((left, right) => left - right);
	cpuTasks.sort((left, right) => left - right);
	return {
		events: eventCount,
		frames: samples.length,
		medianMilliseconds: samples[Math.floor(samples.length * 0.5)],
		percentile95Milliseconds: samples[Math.floor(samples.length * 0.95)],
		maximumMilliseconds: samples.at(-1),
		droppedFrames: samples.filter(delta => delta > 25).length,
		cpuTaskAverageMilliseconds: cpuTasks.reduce((sum, value) => sum + value, 0) / cpuTasks.length,
		cpuTaskPercentile95Milliseconds: cpuTasks[Math.floor(cpuTasks.length * 0.95)],
		cpuTaskMaximumMilliseconds: cpuTasks.at(-1),
	};
}

async function installLargeChart(page) {
	return page.evaluate(() => {
		const app = globalThis.sviber;
		const snapshot = app.model.snapshot();
		const channelCount = 4;
		const eventCount = 100_000;
		app.model.channels = Array.from({ length: channelCount }, (_, id) => ({ id }));
		app.model.snappees = [];
		app.model.events = Array.from({ length: eventCount }, (_, id) => ({
			id,
			type: id % 11 === 0 ? "hold" : "tap",
			channel: id % channelCount,
			time: [Math.floor(id / 16), id % 16, 16],
			duration: [1, 0, 1],
			x: id % 200 - 100,
			y: id % 100 - 50,
			text: "",
			tipPointSpawnType: id < channelCount ? "chain" : "inherit",
			tipPointSpawnTime: 1,
		}));
		app.model.editor.currentChannel = 0;
		app.model.editor.timeSnapped = false;
		app.model.editor.currentTime = 100;
		app.model.editor.visibleRangeBeginning = 95;
		app.model.editor.visibleRangeEnd = 105;
		app.refreshNow();
		return { snapshot, eventCount };
	});
}

export async function measureLargeChartPlayback(page) {
	const fixture = await installLargeChart(page);
	try {
		const measurements = await page.evaluate(async () => {
			const app = globalThis.sviber;
			const warmupFrames = 30;
			const measuredFrames = 180;
			return new Promise(resolve => {
				const samples = [];
				const cpuTasks = [];
				let frame = 0;
				let previous = null;
				const draw = timestamp => {
					if (previous !== null && frame > warmupFrames) samples.push(timestamp - previous);
					previous = timestamp;
					const current = 100 + frame / 60;
					app.model.editor.currentTime = current;
					app.model.editor.visibleRangeBeginning = current - 5;
					app.model.editor.visibleRangeEnd = current + 5;
					const cpuStarted = performance.now();
					app.refreshPlaybackFrame();
					if (frame >= warmupFrames) cpuTasks.push(performance.now() - cpuStarted);
					frame += 1;
					if (frame <= warmupFrames + measuredFrames) requestAnimationFrame(draw);
					else resolve({ samples, cpuTasks });
				};
				requestAnimationFrame(draw);
			});
		});
		return summarize(fixture.eventCount, measurements.samples, measurements.cpuTasks);
	} finally {
		await page.evaluate(snapshot => {
			globalThis.sviber.model.restore(snapshot);
			globalThis.sviber.refreshNow();
		}, fixture.snapshot);
	}
}

export async function measureLargeChartEditing(page) {
	const fixture = await installLargeChart(page);
	try {
		const measurements = await page.evaluate(async () => {
			const app = globalThis.sviber;
			app.creationMode = "tap";
			const eventCount = app.model.events.length;
			const canvas = app.stage.surface.canvas;
			const rectangle = canvas.getBoundingClientRect();
			const warmupFrames = 30;
			const measuredFrames = 180;
			return new Promise(resolve => {
				const samples = [];
				const cpuTasks = [];
				let frame = 0;
				let previous = null;
				const draw = timestamp => {
					if (previous !== null && frame > warmupFrames) samples.push(timestamp - previous);
					previous = timestamp;
					const cpuStarted = performance.now();
					for (let sample = 0; sample < 12; sample += 1) {
						const progress = (frame * 12 + sample) / ((warmupFrames + measuredFrames) * 12);
						canvas.dispatchEvent(new PointerEvent("pointermove", {
							clientX: rectangle.left + rectangle.width * (0.15 + progress * 0.7),
							clientY: rectangle.top + rectangle.height * (0.35 + Math.sin(progress * 20) * 0.2),
						}));
					}
					const firstId = frame * 251 % eventCount;
					const selectedIds = Array.from({ length: 256 }, (_, offset) => (firstId + offset) % eventCount);
					app.previewSelection(selectedIds, "replace");
					app.seekBeat([190 + Math.floor(frame / 9), frame % 9, 9], null, false, { lightweight: true });
					if (frame >= warmupFrames) cpuTasks.push(performance.now() - cpuStarted);
					frame += 1;
					if (frame <= warmupFrames + measuredFrames) requestAnimationFrame(draw);
					else resolve({ samples, cpuTasks });
				};
				requestAnimationFrame(draw);
			});
		});
		return summarize(fixture.eventCount, measurements.samples, measurements.cpuTasks);
	} finally {
		await page.evaluate(snapshot => {
			const app = globalThis.sviber;
			app.creationMode = null;
			app.cancelSelectionPreview();
			app.model.restore(snapshot);
			app.refreshNow();
		}, fixture.snapshot);
	}
}
