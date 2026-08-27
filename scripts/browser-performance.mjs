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

async function installLargeChart(page, requestedEventCount = 100_000) {
	return page.evaluate(requestedCount => {
		const app = globalThis.sviber;
		const snapshot = app.model.snapshot();
		const channelCount = 4;
		const eventCount = Number(requestedCount) || 100_000;
		app.model.channels = Array.from({ length: channelCount }, (_, id) => ({ id }));
		app.model.snappees = [];
		app.model.events = Array.from({ length: eventCount }, (_, id) => ({
			id,
			type: id % 11 === 0 ? "hold" : "tap",
			channel: id % channelCount,
			time: [Math.floor(id / 16), id % 16, 16],
			duration: [1, 0, 1],
			x: (id % 200) - 100,
			y: (id % 100) - 50,
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
	}, requestedEventCount);
}

function summarizeDrag(samples) {
	samples.sort((left, right) => left - right);
	return {
		frames: samples.length,
		medianMilliseconds: samples[Math.floor(samples.length * 0.5)] || 0,
		percentile95Milliseconds: samples[Math.floor(samples.length * 0.95)] || 0,
		maximumMilliseconds: samples.at(-1) || 0,
		droppedFrames: samples.filter(delta => delta > 25).length,
	};
}

async function measurePointerDrag(page, viewName) {
	const point = await page.evaluate(view => {
		const app = globalThis.sviber;
		const target = app.model.events.find(event => event.type === "tap");
		if (!target) {
			return null;
		}
		target.selected = true;
		const seconds = app.timing().beatToSeconds(target.time);
		app.model.editor.timeSnapped = false;
		app.model.editor.currentTime = seconds;
		app.model.editor.visibleRangeBeginning = seconds - 5;
		app.model.editor.visibleRangeEnd = seconds + 5;
		app.refreshNow();
		const renderer = app[view];
		const records = view === "stage" ? renderer.visibleEvents : renderer.eventCenters;
		const record = records.find(item => item.event.id === target.id);
		if (!record) {
			return null;
		}
		const rectangle = renderer.surface.canvas.getBoundingClientRect();
		const x = view === "stage" ? record.screen.x : record.x;
		const y = view === "stage" ? record.screen.y : record.y;
		return {
			x: rectangle.left + (x * rectangle.width) / renderer.surface.width,
			y: rectangle.top + (y * rectangle.height) / renderer.surface.height,
		};
	}, viewName);
	if (!point) {
		return {
			frames: 0,
			medianMilliseconds: 0,
			percentile95Milliseconds: 0,
			maximumMilliseconds: 0,
			droppedFrames: 0,
		};
	}
	await page.evaluate(() => {
		const probe = { active: false, previous: null, samples: [] };
		const tick = timestamp => {
			if (probe.active && probe.previous != null) {
				probe.samples.push(timestamp - probe.previous);
			}
			if (probe.active) {
				probe.previous = timestamp;
			}
			requestAnimationFrame(tick);
		};
		globalThis.__sviberDragProbe = probe;
		requestAnimationFrame(tick);
	});
	await page.mouse.move(point.x, point.y);
	await page.mouse.down();
	await page.evaluate(() => {
		globalThis.__sviberDragProbe.active = true;
	});
	const rectangle = await page.evaluate(view => {
		const canvas = globalThis.sviber[view].surface.canvas;
		const value = canvas.getBoundingClientRect();
		return { left: value.left, top: value.top, width: value.width, height: value.height };
	}, viewName);
	for (let index = 1; index <= 60; index += 1) {
		const progress = index / 60;
		await page.mouse.move(
			point.x + rectangle.width * 0.12 * Math.sin(progress * Math.PI),
			point.y - rectangle.height * 0.08 * Math.sin(progress * Math.PI),
		);
		await page.waitForTimeout(5);
	}
	await page.mouse.up();
	await page.waitForTimeout(40);
	const samples = await page.evaluate(() => {
		const probe = globalThis.__sviberDragProbe;
		probe.active = false;
		return probe.samples;
	});
	return summarizeDrag(samples);
}

export async function measureRealDrag(page) {
	const results = {};
	for (const viewName of ["stage", "timeline"]) {
		const fixture = await installLargeChart(page, 5_000);
		try {
			results[viewName] = await measurePointerDrag(page, viewName);
		} finally {
			await page.evaluate(snapshot => {
				const app = globalThis.sviber;
				app.cancelPreview();
				app.model.restore(snapshot);
				app.refreshNow();
			}, fixture.snapshot);
		}
	}
	return results;
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
					if (previous !== null && frame > warmupFrames) {
						samples.push(timestamp - previous);
					}
					previous = timestamp;
					const current = 100 + frame / 60;
					app.model.editor.currentTime = current;
					app.model.editor.visibleRangeBeginning = current - 5;
					app.model.editor.visibleRangeEnd = current + 5;
					const cpuStarted = performance.now();
					app.refreshPlaybackFrame();
					if (frame >= warmupFrames) {
						cpuTasks.push(performance.now() - cpuStarted);
					}
					frame += 1;
					if (frame <= warmupFrames + measuredFrames) {
						requestAnimationFrame(draw);
					} else {
						resolve({ samples, cpuTasks });
					}
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
					if (previous !== null && frame > warmupFrames) {
						samples.push(timestamp - previous);
					}
					previous = timestamp;
					const cpuStarted = performance.now();
					for (let sample = 0; sample < 12; sample += 1) {
						const progress = (frame * 12 + sample) / ((warmupFrames + measuredFrames) * 12);
						canvas.dispatchEvent(
							new PointerEvent("pointermove", {
								clientX: rectangle.left + rectangle.width * (0.15 + progress * 0.7),
								clientY: rectangle.top + rectangle.height * (0.35 + Math.sin(progress * 20) * 0.2),
							}),
						);
					}
					const firstId = (frame * 251) % eventCount;
					const selectedIds = Array.from({ length: 256 }, (_, offset) => (firstId + offset) % eventCount);
					app.previewSelection(selectedIds, "replace");
					app.seekBeat([190 + Math.floor(frame / 9), frame % 9, 9], null, false, { lightweight: true });
					if (frame >= warmupFrames) {
						cpuTasks.push(performance.now() - cpuStarted);
					}
					frame += 1;
					if (frame <= warmupFrames + measuredFrames) {
						requestAnimationFrame(draw);
					} else {
						resolve({ samples, cpuTasks });
					}
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
