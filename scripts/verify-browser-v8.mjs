import assert from "node:assert/strict";

function rationalNumber([integer = 0, numerator = 0, denominator = 1] = []) {
	return Number(integer) + Number(numerator) / Math.max(1, Number(denominator));
}

export async function runV8BrowserChecks(page) {
	const original = await page.evaluate(() => {
		const app = globalThis.sviber;
		const saved = {
			snapshot: app.model.snapshot(),
			historyLabel: app.history.currentEntry.label,
			savedSignature: app.savedSignature,
		};
		app.__v8BrowserAudio = {
			buffer: app.audio.buffer,
			waveform: app.audio.waveform,
			syntheticEnd: app.audio.syntheticEnd,
		};
		app.audio.buffer = null;
		app.audio.waveform = null;
		app.audio.syntheticEnd = 20;
		const state = structuredClone(saved.snapshot);
		state.timing = { offset: 0, initialBpm: 60, bpmChanges: [] };
		state.channels = [
			{ id: 10, name: "Lead", active: true },
			{ id: 20, name: "Muted", active: false },
			{ id: 30, name: "FX", active: true },
			{ id: 40, name: "Spare", active: true },
		];
		state.events = [
			{ id: 101, type: "hold", time: [0, 0, 1], duration: [2, 0, 1], channel: 10,
				selected: true, attached: false, x: -24, y: 0 },
			{ id: 102, type: "hold", time: [1, 0, 1], duration: [2, 0, 1], channel: 10,
				selected: true, attached: false, x: 24, y: 0 },
			{ id: 103, type: "tap", time: [1, 0, 1], channel: 20,
				selected: false, attached: false, x: 0, y: 20 },
			{ id: 104, type: "comment", time: [0, 0, 1], duration: [4, 0, 1], channel: 10,
				selected: false, text: "active comment" },
			{ id: 105, type: "comment", time: [0, 0, 1], duration: [4, 0, 1], channel: 20,
				selected: false, text: "inactive comment" },
			{ id: 106, type: "hold", time: [0, 0, 1], duration: [4, 0, 1], channel: 30,
				selected: false, attached: false, x: 0, y: 0 },
			{ id: 107, type: "tap", time: [1, 1, 2], channel: 30,
				selected: false, attached: false, x: 48, y: 0 },
		];
		state.snappees = [{
			id: 70, type: "rectangularMesh", name: "Inactive grid", color: "#50a226",
			active: false, selected: false, transformation: [1, 0, 0, 1, 0, 0],
			topLeftX: -100, topLeftY: 50, bottomRightX: 100, bottomRightY: -50,
			horizontalTiles: 16, verticalTiles: 8,
		}];
		state.nextIds = { channel: 50, event: 108, snappee: 71 };
		state.editor = {
			...state.editor,
			currentChannel: 10,
			currentTime: [1, 0, 1],
			timeSnapped: true,
			subdivision: 2,
			visibleRangeBeginning: 0,
			visibleRangeEnd: 4,
		};
		app.cancelPreview();
		app.model.restore(state);
		app.history.reset(app.model.snapshot(), "v8 browser fixture");
		app.refreshNow();
		return saved;
	});
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

	const initial = await page.evaluate(() => ({
		channelNames: [...document.querySelectorAll("#channels-panel .snappee-name")].map(item => item.textContent),
		inactiveItems: document.querySelectorAll("#channels-panel .channel-item.is-inactive").length,
		inactiveSnappeePreviewAlpha: (() => {
			const canvas = document.querySelector("#snappees-panel .snappee-item.is-inactive canvas");
			if (!canvas) return 0;
			const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
			let alpha = 0;
			for (let index = 3; index < pixels.length; index += 4) alpha += pixels[index];
			return alpha;
		})(),
		durationHandles: globalThis.sviber.timeline.hitRegions.filter(region => region.type === "duration").length,
		inactiveTimelineHit: globalThis.sviber.timeline.hitRegions.some(region => region.event?.id === 103),
		inactiveStageEvent: globalThis.sviber.stage.visibleEvents.some(record => record.event.id === 103),
		comments: [...document.querySelectorAll("#status-comments .status-comment")].map(item => item.textContent),
		commentsVisible: [...document.querySelectorAll("#status-comments .status-comment")].every(item => {
			const itemBounds = item.getBoundingClientRect();
			const panelBounds = document.querySelector("#status-panel").getBoundingClientRect();
			return itemBounds.top >= panelBounds.top && itemBounds.bottom <= panelBounds.bottom;
		}),
	}));
	assert.deepEqual(initial.channelNames, ["Lead", "Muted", "FX", "Spare"]);
	assert.equal(initial.inactiveItems, 1);
	assert.ok(initial.inactiveSnappeePreviewAlpha > 0, "inactive snappee previews must remain visible in the panel");
	assert.equal(initial.durationHandles, 2);
	assert.equal(initial.inactiveTimelineHit, false);
	assert.equal(initial.inactiveStageEvent, false);
	assert.deepEqual(initial.comments, ["active comment", "inactive comment"]);
	assert.equal(initial.commentsVisible, true, "active comments are clipped by the status panel");

	const durationHandle = await page.evaluate(() => {
		const app = globalThis.sviber;
		const hit = app.timeline.hitRegions.find(region => region.type === "duration" && region.event.id === 101);
		const rectangle = app.timeline.surface.canvas.getBoundingClientRect();
		return {
			x: rectangle.left + (hit.x + hit.width / 2) * rectangle.width / app.timeline.surface.width,
			y: rectangle.top + (hit.y + hit.height / 2) * rectangle.height / app.timeline.surface.height,
		};
	});
	const endsBefore = await page.evaluate(() => globalThis.sviber.model.events
		.filter(event => event.selected).map(event => [event.time, event.duration]));
	await page.mouse.move(durationHandle.x, durationHandle.y);
	await page.mouse.down();
	await page.mouse.move(durationHandle.x + 90, durationHandle.y, { steps: 3 });
	await page.mouse.up();
	const endsAfter = await page.evaluate(() => globalThis.sviber.model.events
		.filter(event => event.selected).map(event => [event.time, event.duration]));
	const beforeValues = endsBefore.map(([time, duration]) => rationalNumber(time) + rationalNumber(duration));
	const afterValues = endsAfter.map(([time, duration]) => rationalNumber(time) + rationalNumber(duration));
	const durationDelta = afterValues[0] - beforeValues[0];
	assert.ok(durationDelta > 0, "dragging a duration handle did not increase the end time");
	assert.ok(afterValues.every((value, index) => Math.abs(value - beforeValues[index] - durationDelta) < 1e-8),
		"unaligned selected end times did not move by one shared subdivision delta");

	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	await page.locator("#channels-tab").click();
	assert.equal(await page.locator('.menu-command[data-command="channel.rename"]').count(), 1);
	const leadItem = page.locator("#channels-panel .channel-item").filter({ hasText: "Lead" }).first();
	await leadItem.locator(".snappee-action").nth(0).click();
	await page.waitForFunction(() => globalThis.sviber.model.channels.find(channel => channel.id === 10)?.active === false);
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	const deactivated = await page.evaluate(() => ({
		currentChannel: globalThis.sviber.model.editor.currentChannel,
		selected: globalThis.sviber.model.events.filter(event => event.channel === 10).some(event => event.selected),
		hits: globalThis.sviber.timeline.hitRegions.filter(region => region.event?.channel === 10).length,
	}));
	assert.equal(deactivated.currentChannel, 30);
	assert.equal(deactivated.selected, false);
	assert.equal(deactivated.hits, 0);

	await leadItem.locator(".snappee-action").nth(1).click();
	await page.waitForFunction(() => globalThis.sviber.model.channels.some(channel => channel.name === "Lead 2"));
	const duplicate = await page.evaluate(() => {
		const app = globalThis.sviber;
		const channel = app.model.channels.find(candidate => candidate.name === "Lead 2");
		return {
			active: channel.active,
			eventCount: app.model.events.filter(event => event.channel === channel.id).length,
			currentChannel: app.model.editor.currentChannel,
		};
	});
	assert.deepEqual(duplicate, { active: false, eventCount: 3, currentChannel: 30 });

	const fxItem = page.locator("#channels-panel .channel-item").filter({ hasText: "FX" });
	assert.equal(await fxItem.locator(".snappee-action").count(), 4);
	await fxItem.locator(".snappee-action").nth(3).click();
	await page.locator(".dialog input[type=text]").fill("Effects");
	await page.locator('.dialog-button[data-dialog-action="ok"]').click();
	await page.waitForFunction(() => globalThis.sviber.model.channels.some(channel => channel.name === "Effects"));

	const duplicateItem = page.locator("#channels-panel .channel-item").filter({ hasText: "Lead 2" });
	await duplicateItem.locator(".snappee-action").nth(2).click();
	await page.locator('.dialog-button[data-dialog-action="confirm"]').click();
	await page.waitForFunction(() => !globalThis.sviber.model.channels.some(channel => channel.name === "Lead 2"));

	await page.evaluate(() => document.activeElement?.blur());
	await page.keyboard.press("Alt+ArrowDown");
	assert.deepEqual(await page.evaluate(() => ({
		current: globalThis.sviber.model.editor.currentChannel,
		offset: globalThis.sviber.timeline.channelOffset,
	})), { current: 40, offset: 1 });
	await page.keyboard.press("Alt+ArrowUp");
	assert.equal(await page.evaluate(() => globalThis.sviber.model.editor.currentChannel), 30);

	await page.evaluate(() => {
		const app = globalThis.sviber;
		app.model.editor.currentTime = [1, 0, 1];
		app.model.editor.timeSnapped = true;
		app.model.editor.visibleRangeBeginning = 0;
		app.model.editor.visibleRangeEnd = 2;
		app.audio.seek(1);
		app.refreshNow();
	});
	await page.keyboard.press("PageUp");
	assert.deepEqual(await page.evaluate(() => ({
		beginning: globalThis.sviber.model.editor.visibleRangeBeginning,
		ending: globalThis.sviber.model.editor.visibleRangeEnd,
		beat: globalThis.sviber.model.editor.currentTime,
	})), { beginning: 2, ending: 4, beat: [3, 0, 1] });
	await page.keyboard.press("PageDown");
	assert.deepEqual(await page.evaluate(() => ({
		beginning: globalThis.sviber.model.editor.visibleRangeBeginning,
		ending: globalThis.sviber.model.editor.visibleRangeEnd,
		beat: globalThis.sviber.model.editor.currentTime,
	})), { beginning: 0, ending: 2, beat: [1, 0, 1] });

	await page.locator('.tool-button[data-command="music.playPause"]').click();
	await page.waitForFunction(() => globalThis.sviber.audio.playing === true);
	await page.evaluate(() => {
		// Keep hit coordinates stable while exercising editing during playback.
		globalThis.sviber.playFollowOffset = false;
		globalThis.sviber.refreshPlaybackFrame();
	});
	assert.deepEqual(await page.evaluate(() => {
		const app = globalThis.sviber;
		return {
			inspectorInert: document.getElementById("inspector-panel").inert,
			save: app.registry.isEnabled("file.save", app),
			undo: app.registry.isEnabled("edit.undo", app),
			selectAll: app.registry.isEnabled("edit.selectAll", app),
			createChannel: app.registry.isEnabled("channel.createAbove", app),
			createEvent: app.registry.isEnabled("events.tap", app),
			about: app.registry.isEnabled("help.about", app),
		};
	}), {
		inspectorInert: false,
		save: true,
		undo: true,
		selectAll: true,
		createChannel: true,
		createEvent: false,
		about: false,
	});

	await page.evaluate(() => {
		const app = globalThis.sviber;
		app.toggleSnappee(70);
	});
	await page.waitForFunction(() => globalThis.sviber.model.snappees.find(snappee => snappee.id === 70)?.active === true);
	await page.evaluate(() => globalThis.sviber.selectSnappee(70));
	assert.deepEqual(await page.evaluate(() => ({
		playing: globalThis.sviber.audio.playing,
		selected: globalThis.sviber.model.snappees.find(snappee => snappee.id === 70)?.selected,
	})), { playing: true, selected: true });

	const stageEvent = await page.evaluate(() => {
		const app = globalThis.sviber;
		const hit = app.stage.hitRegions.find(region => region.type === "event" && region.event.id === 106);
		const rectangle = app.stage.surface.canvas.getBoundingClientRect();
		return hit ? {
			x: rectangle.left + (hit.x + hit.width / 2) * rectangle.width / app.stage.surface.width,
			y: rectangle.top + (hit.y + hit.height / 2) * rectangle.height / app.stage.surface.height,
		} : null;
	});
	assert.ok(stageEvent, "active events must remain interactive in the main field during playback");
	await page.mouse.click(stageEvent.x, stageEvent.y);
	await page.waitForFunction(() => globalThis.sviber.model.events.find(event => event.id === 106)?.selected === true);

	await page.evaluate(() => {
		const app = globalThis.sviber;
		const probe = { cancellations: 0, tolerances: [] };
		probe.originalCancel = app.audio.cancelScheduledHitSounds;
		probe.originalSchedule = app._scheduleHits;
		app.audio.cancelScheduledHitSounds = function (...args) {
			probe.cancellations += 1;
			return probe.originalCancel.apply(this, args);
		};
		app._scheduleHits = function (...args) {
			probe.tolerances.push(args[1]);
			return probe.originalSchedule.apply(this, args);
		};
		app.__v8PlaybackProbe = probe;
	});
	const timelineEvent = await page.evaluate(() => {
		const app = globalThis.sviber;
		const hit = app.timeline.hitRegions.find(region => region.type === "event" && region.event.id === 107);
		const rectangle = app.timeline.surface.canvas.getBoundingClientRect();
		return hit ? {
			x: rectangle.left + (hit.x + hit.width / 2) * rectangle.width / app.timeline.surface.width,
			y: rectangle.top + (hit.y + hit.height / 2) * rectangle.height / app.timeline.surface.height,
		} : null;
	});
	assert.ok(timelineEvent, "active timeline events must remain interactive during playback");
	const eventTimeBeforePlaybackDrag = await page.evaluate(() => globalThis.sviber.model.events.find(event => event.id === 107).time);
	await page.mouse.move(timelineEvent.x, timelineEvent.y);
	await page.mouse.down();
	await page.mouse.move(timelineEvent.x + 320, timelineEvent.y, { steps: 4 });
	await page.mouse.up();
	await page.waitForFunction(before => JSON.stringify(globalThis.sviber.model.events.find(event => event.id === 107)?.time) !== JSON.stringify(before), eventTimeBeforePlaybackDrag);
	const playbackEditResult = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
		const app = globalThis.sviber;
		const probe = app.__v8PlaybackProbe;
		app.audio.cancelScheduledHitSounds = probe.originalCancel;
		app._scheduleHits = probe.originalSchedule;
		delete app.__v8PlaybackProbe;
		resolve({
			playing: app.audio.playing,
			cancellations: probe.cancellations,
			zeroTolerance: probe.tolerances.includes(0),
			invalidated: app.playbackScheduleInvalidated,
		});
	}))));
	assert.equal(playbackEditResult.playing, true);
	assert.ok(playbackEditResult.cancellations > 0, "playback edits did not cancel obsolete future sounds");
	assert.equal(playbackEditResult.zeroTolerance, true);
	assert.equal(playbackEditResult.invalidated, false);
	await page.locator('.tool-button[data-command="music.playPause"]').click();
	await page.waitForFunction(() => globalThis.sviber.audio.playing === false);

	await page.keyboard.down("Space");
	await page.waitForFunction(() => globalThis.sviber.audio.playing === true);
	await page.waitForTimeout(350);
	await page.keyboard.up("Space");
	await page.waitForFunction(() => globalThis.sviber.audio.playing === false);

	await page.evaluate(() => { void globalThis.sviber.registry.execute("help.about", globalThis.sviber); });
	await page.locator(".about-information").waitFor();
	assert.ok(await page.locator(".about-information dt").count() >= 5);
	assert.equal(await page.locator('.dialog-button[data-dialog-action="copy"]').count(), 1);
	await page.locator('.dialog-button[data-dialog-action="ok"]').click();

	const documentationPromise = page.waitForEvent("popup");
	await page.evaluate(() => globalThis.sviber.help.openDocumentation());
	const documentation = await documentationPromise;
	await documentation.waitForLoadState("domcontentloaded");
	assert.equal(await documentation.locator('article[data-language="zh-CN"]').isVisible(), true);
	assert.ok(await documentation.locator("#contents a").count() >= 10);
	await documentation.close();

	await page.evaluate(saved => {
		const app = globalThis.sviber;
		app.model.restore(saved.snapshot);
		app.history.reset(saved.snapshot, saved.historyLabel);
		app.savedSignature = saved.savedSignature;
		const audio = app.__v8BrowserAudio;
		app.audio.buffer = audio.buffer;
		app.audio.waveform = audio.waveform;
		app.audio.syntheticEnd = audio.syntheticEnd;
		delete app.__v8BrowserAudio;
		app.audio.seek(app.currentSeconds());
		app.updateDirty();
		app.refreshNow();
	}, original);
}
