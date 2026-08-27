// Browser checks for the v8 feature set. The fixture chart used by every check lives in
// verify-browser-v8-fixture.mjs so that this module only holds the checks themselves.
import assert from "node:assert/strict";

import { V8_FIXTURE } from "./verify-browser-v8-fixture.mjs";

function rationalNumber([integer = 0, numerator = 0, denominator = 1] = []) {
	return Number(integer) + Number(numerator) / Math.max(1, Number(denominator));
}

async function settleFrames(page) {
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function installFixture(page) {
	const original = await page.evaluate(fixture => {
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
		state.timing = fixture.timing;
		state.channels = fixture.channels;
		state.events = fixture.events;
		state.snappees = fixture.snappees;
		state.nextIds = fixture.nextIds;
		state.editor = { ...state.editor, ...fixture.editor };
		app.cancelPreview();
		app.model.restore(state);
		app.history.reset(app.model.snapshot(), "v8 browser fixture");
		app.refreshNow();
		return saved;
	}, V8_FIXTURE);
	await settleFrames(page);
	return original;
}

async function restoreFixture(page, original) {
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

async function checkInactiveChannelPresentation(page) {
	const initial = await page.evaluate(() => ({
		channelNames: [...document.querySelectorAll("#channels-panel .snappee-name")].map(item => item.textContent),
		inactiveItems: document.querySelectorAll("#channels-panel .channel-item.is-inactive").length,
		inactiveSnappeePreviewAlpha: (() => {
			const canvas = document.querySelector("#snappees-panel .snappee-item.is-inactive canvas");
			if (!canvas) {
				return 0;
			}
			const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
			let alpha = 0;
			for (let index = 3; index < pixels.length; index += 4) {
				alpha += pixels[index];
			}
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
}

async function checkHorizontalFlipMirrorsCursor(page) {
	const mirroredCursor = await page.evaluate(async () => {
		const app = globalThis.sviber;
		const placeholder = () =>
			app.model.generateSunniesnowEvents().find(event => event.type === "placeholder").properties;
		const before = placeholder();
		await app.registry.execute("transform.flipHorizontal", app);
		const after = placeholder();
		const angle = app.model.events.find(event => event.id === 101).tipPointSpawnAngle;
		await app.registry.execute("transform.flipHorizontal", app);
		return { before, after, angle };
	});
	assert.ok(Math.abs(mirroredCursor.before.x + mirroredCursor.after.x) < 1e-8);
	assert.ok(Math.abs(mirroredCursor.before.y - mirroredCursor.after.y) < 1e-8);
	assert.ok(Math.abs(mirroredCursor.angle - (Math.PI * 2) / 3) < 1e-8);
}

async function checkSharedDurationHandleDrag(page) {
	const durationHandle = await page.evaluate(() => {
		const app = globalThis.sviber;
		const hit = app.timeline.hitRegions.find(region => region.type === "duration" && region.event.id === 101);
		const rectangle = app.timeline.surface.canvas.getBoundingClientRect();
		return {
			x: rectangle.left + ((hit.x + hit.width / 2) * rectangle.width) / app.timeline.surface.width,
			y: rectangle.top + ((hit.y + hit.height / 2) * rectangle.height) / app.timeline.surface.height,
		};
	});
	const selectedEnds = () =>
		page.evaluate(() =>
			globalThis.sviber.model.events.filter(event => event.selected).map(event => [event.time, event.duration]),
		);
	const endsBefore = await selectedEnds();
	await page.mouse.move(durationHandle.x, durationHandle.y);
	await page.mouse.down();
	await page.mouse.move(durationHandle.x + 90, durationHandle.y, { steps: 3 });
	await page.mouse.up();
	const endsAfter = await selectedEnds();
	const beforeValues = endsBefore.map(([time, duration]) => rationalNumber(time) + rationalNumber(duration));
	const afterValues = endsAfter.map(([time, duration]) => rationalNumber(time) + rationalNumber(duration));
	const durationDelta = afterValues[0] - beforeValues[0];
	assert.ok(durationDelta > 0, "dragging a duration handle did not increase the end time");
	assert.ok(
		afterValues.every((value, index) => Math.abs(value - beforeValues[index] - durationDelta) < 1e-8),
		"unaligned selected end times did not move by one shared subdivision delta",
	);
}

async function checkChannelPanelActions(page) {
	await settleFrames(page);
	await page.locator("#channels-tab").click();
	assert.equal(await page.locator('.menu-command[data-command="channel.rename"]').count(), 0);
	const leadItem = page.locator("#channels-panel .channel-item").filter({ hasText: "Lead" }).first();
	await leadItem.locator(".snappee-action").nth(0).click();
	await page.waitForFunction(
		() => globalThis.sviber.model.channels.find(channel => channel.id === 10)?.active === false,
	);
	await settleFrames(page);
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
	const duplicateItem = page.locator("#channels-panel .channel-item").filter({ hasText: "Lead 2" });
	await duplicateItem.waitFor({ state: "visible" });
	assert.equal(await duplicateItem.locator(".snappee-action").count(), 6);
	assert.equal(await leadItem.locator(".snappee-action").nth(2).isDisabled(), true);
	await duplicateItem.locator(".snappee-action").nth(3).click();
	await page.waitForFunction(() => globalThis.sviber.model.channels[2]?.name === "Lead 2");
	await duplicateItem.locator(".snappee-action").nth(2).click();
	await page.waitForFunction(() => globalThis.sviber.model.channels[1]?.name === "Lead 2");

	const fxItem = page.locator("#channels-panel .channel-item").filter({ hasText: "FX" });
	assert.equal(await fxItem.locator(".snappee-action").count(), 6);
	await fxItem.locator(".snappee-action").nth(4).click();
	await page.locator(".dialog input[type=text]").fill("Effects");
	await page.locator('.dialog-button[data-dialog-action="ok"]').click();
	await page.waitForFunction(() => globalThis.sviber.model.channels.some(channel => channel.name === "Effects"));

	await duplicateItem.locator(".snappee-action").nth(5).click();
	await page.locator('.dialog-button[data-dialog-action="confirm"]').click();
	await page.waitForFunction(() => !globalThis.sviber.model.channels.some(channel => channel.name === "Lead 2"));
}

async function checkChannelKeyboardNavigation(page) {
	await page.evaluate(() => document.activeElement?.blur());
	await page.keyboard.press("Alt+ArrowDown");
	assert.deepEqual(
		await page.evaluate(() => ({
			current: globalThis.sviber.model.editor.currentChannel,
			offset: globalThis.sviber.timeline.channelOffset,
		})),
		{ current: 40, offset: 1 },
	);
	await page.keyboard.press("Alt+ArrowUp");
	assert.equal(await page.evaluate(() => globalThis.sviber.model.editor.currentChannel), 30);
}

async function checkVisibleRangePaging(page) {
	await page.evaluate(() => {
		const app = globalThis.sviber;
		app.model.editor.currentTime = [1, 0, 1];
		app.model.editor.timeSnapped = true;
		app.model.editor.visibleRangeBeginning = 0;
		app.model.editor.visibleRangeEnd = 2;
		app.audio.seek(1);
		app.refreshNow();
	});
	const range = () =>
		page.evaluate(() => ({
			beginning: globalThis.sviber.model.editor.visibleRangeBeginning,
			ending: globalThis.sviber.model.editor.visibleRangeEnd,
			beat: globalThis.sviber.model.editor.currentTime,
		}));
	await page.evaluate(() => document.activeElement?.blur());
	await page.keyboard.press("PageUp");
	assert.deepEqual(await range(), { beginning: 0, ending: 2, beat: [1, 0, 1] });
	await page.keyboard.press("PageDown");
	assert.deepEqual(await range(), { beginning: 2, ending: 4, beat: [3, 0, 1] });
	await page.evaluate(() => {
		const app = globalThis.sviber;
		app.model.editor.visibleRangeBeginning = 0;
		app.model.editor.visibleRangeEnd = 2;
		app.model.editor.currentTime = [1, 0, 1];
		app.model.editor.timeSnapped = true;
		app.audio.seek(1);
		app.refreshNow();
	});
}

async function checkPlaybackCommandAvailability(page) {
	await page.locator('.tool-button[data-command="music.playPause"]').click();
	await page.waitForFunction(() => globalThis.sviber.audio.playing === true);
	await page.evaluate(() => {
		// Keep hit coordinates stable while exercising editing during playback.
		globalThis.sviber.playFollowOffset = false;
		globalThis.sviber.refreshPlaybackFrame();
	});
	assert.deepEqual(
		await page.evaluate(() => {
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
		}),
		{
			inspectorInert: false,
			save: true,
			undo: true,
			selectAll: true,
			createChannel: true,
			createEvent: false,
			about: false,
		},
	);
}

async function checkSnappeeSelectionDuringPlayback(page) {
	await page.evaluate(() => {
		const app = globalThis.sviber;
		app.toggleSnappee(70);
	});
	await page.waitForFunction(
		() => globalThis.sviber.model.snappees.find(snappee => snappee.id === 70)?.active === true,
	);
	await page.evaluate(() => globalThis.sviber.selectSnappee(70));
	assert.deepEqual(
		await page.evaluate(() => ({
			playing: globalThis.sviber.audio.playing,
			selected: globalThis.sviber.model.snappees.find(snappee => snappee.id === 70)?.selected,
		})),
		{ playing: true, selected: true },
	);
}

async function checkStageSelectionDuringPlayback(page) {
	const stageEvent = await page.evaluate(() => {
		const app = globalThis.sviber;
		const hit = app.stage.hitRegions.find(region => region.type === "event" && region.event.id === 106);
		if (!hit) {
			return null;
		}
		const rectangle = app.stage.surface.canvas.getBoundingClientRect();
		return {
			x: rectangle.left + ((hit.x + hit.width / 2) * rectangle.width) / app.stage.surface.width,
			y: rectangle.top + ((hit.y + hit.height / 2) * rectangle.height) / app.stage.surface.height,
		};
	});
	assert.ok(stageEvent, "active events must remain interactive in the main field during playback");
	await page.mouse.click(stageEvent.x, stageEvent.y);
	await page.waitForFunction(() => globalThis.sviber.model.events.find(event => event.id === 106)?.selected === true);
}

async function installPlaybackProbe(page) {
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
}

async function readPlaybackProbe(page) {
	return page.evaluate(
		() =>
			new Promise(resolve =>
				requestAnimationFrame(() =>
					requestAnimationFrame(() => {
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
					}),
				),
			),
	);
}

async function checkTimelineDragDuringPlayback(page) {
	await installPlaybackProbe(page);
	const timelineEvent = await page.evaluate(() => {
		const app = globalThis.sviber;
		const hit = app.timeline.hitRegions.find(region => region.type === "event" && region.event.id === 107);
		if (!hit) {
			return null;
		}
		const rectangle = app.timeline.surface.canvas.getBoundingClientRect();
		return {
			x: rectangle.left + ((hit.x + hit.width / 2) * rectangle.width) / app.timeline.surface.width,
			y: rectangle.top + ((hit.y + hit.height / 2) * rectangle.height) / app.timeline.surface.height,
		};
	});
	assert.ok(timelineEvent, "active timeline events must remain interactive during playback");
	const eventTimeBeforePlaybackDrag = await page.evaluate(
		() => globalThis.sviber.model.events.find(event => event.id === 107).time,
	);
	await page.mouse.move(timelineEvent.x, timelineEvent.y);
	await page.mouse.down();
	await page.mouse.move(timelineEvent.x + 320, timelineEvent.y, { steps: 4 });
	await page.mouse.up();
	await page.waitForFunction(
		before =>
			JSON.stringify(globalThis.sviber.model.events.find(event => event.id === 107)?.time) !==
			JSON.stringify(before),
		eventTimeBeforePlaybackDrag,
	);
	const playbackEditResult = await readPlaybackProbe(page);
	assert.equal(playbackEditResult.playing, true);
	assert.ok(playbackEditResult.cancellations > 0, "playback edits did not cancel obsolete future sounds");
	assert.equal(playbackEditResult.zeroTolerance, true);
	assert.equal(playbackEditResult.invalidated, false);
}

async function checkEditingDuringPlayback(page) {
	await checkPlaybackCommandAvailability(page);
	await checkSnappeeSelectionDuringPlayback(page);
	await checkStageSelectionDuringPlayback(page);
	await checkTimelineDragDuringPlayback(page);
	await page.locator('.tool-button[data-command="music.playPause"]').click();
	await page.waitForFunction(() => globalThis.sviber.audio.playing === false);

	await page.keyboard.down("Space");
	await page.waitForFunction(() => globalThis.sviber.audio.playing === true);
	await page.waitForTimeout(350);
	await page.keyboard.up("Space");
	await page.waitForFunction(() => globalThis.sviber.audio.playing === false);
}

async function checkReadOnlyCommandAvailability(page) {
	const readOnlyState = await page.evaluate(() => {
		const app = globalThis.sviber;
		const historyCursor = app.history.cursor;
		const historyResult = app.goToHistory(0);
		return {
			music: app.registry.isEnabled("music.playPause", app),
			select: app.registry.isEnabled("edit.selectAll", app),
			comment: app.registry.isEnabled("events.comment", app),
			macros: app.registry.isEnabled("macros.open", app),
			save: app.registry.isEnabled("file.save", app),
			undo: app.registry.isEnabled("edit.undo", app),
			create: app.registry.isEnabled("events.tap", app),
			difficultyDisabled: document.getElementById("difficulty-select").disabled,
			inspectorDisabled: document.querySelector("#inspector-panel fieldset")?.disabled,
			channelActionsDisabled: [...document.querySelectorAll("#channels-panel .snappee-action")].every(
				button => button.disabled,
			),
			historyDisabled: [...document.querySelectorAll("#history-list button")].every(button => button.disabled),
			historyResult,
			historyCursorUnchanged: app.history.cursor === historyCursor,
		};
	});
	assert.deepEqual(readOnlyState, {
		music: true,
		select: true,
		comment: true,
		macros: true,
		save: false,
		undo: false,
		create: false,
		difficultyDisabled: false,
		inspectorDisabled: true,
		channelActionsDisabled: false,
		historyDisabled: true,
		historyResult: false,
		historyCursorUnchanged: true,
	});
}

async function checkReadOnlyMode(page) {
	await page.evaluate(() => {
		const app = globalThis.sviber;
		app.model.events.find(event => event.id === 104).channel = 30;
		app.selectEvents([107], "replace");
		app.refreshNow();
	});
	await page.locator(".status-option:has(#read-only) img").click();
	await page.waitForFunction(() => globalThis.sviber.model.editor.readOnly === true);
	await settleFrames(page);
	await checkReadOnlyCommandAvailability(page);
	const readOnlyComment = await page.evaluate(() => {
		const app = globalThis.sviber;
		app.selectEvents([104], "replace");
		app.editSelectedProperty("text", "read-only comment");
		app.editSelectedProperty("type", "tap");
		app.refreshNow();
		const group = document.querySelector("#inspector-panel fieldset");
		return {
			type: app.model.events.find(event => event.id === 104)?.type,
			text: app.model.events.find(event => event.id === 104)?.text,
			groupDisabled: group?.disabled,
			typeDisabled: group?.querySelector("select")?.disabled,
			textDisabled: group?.querySelector('input[type="text"]')?.disabled,
		};
	});
	assert.deepEqual(readOnlyComment, {
		type: "comment",
		text: "read-only comment",
		groupDisabled: false,
		typeDisabled: true,
		textDisabled: false,
	});
	await page.locator(".status-option:has(#read-only) img").click();
	await page.waitForFunction(() => globalThis.sviber.model.editor.readOnly === false);
}

async function checkAboutAndDocumentation(page) {
	await page.evaluate(() => {
		void globalThis.sviber.registry.execute("help.about", globalThis.sviber);
	});
	await page.locator(".about-information").waitFor();
	assert.ok((await page.locator(".about-information dt").count()) >= 5);
	assert.equal(await page.locator('.dialog-button[data-dialog-action="copy"]').count(), 1);
	await page.locator('.dialog-button[data-dialog-action="ok"]').click();

	const documentationPromise = page.waitForEvent("popup");
	await page.evaluate(() => globalThis.sviber.help.openDocumentation());
	const documentation = await documentationPromise;
	await documentation.waitForLoadState("domcontentloaded");
	assert.equal(await documentation.locator('article[data-language="zh-CN"]').isVisible(), true);
	assert.ok((await documentation.locator("#contents a").count()) >= 10);
	await documentation.close();
}

export async function runV8BrowserChecks(page) {
	const original = await installFixture(page);
	await checkInactiveChannelPresentation(page);
	await checkHorizontalFlipMirrorsCursor(page);
	await checkSharedDurationHandleDrag(page);
	await checkChannelPanelActions(page);
	await checkChannelKeyboardNavigation(page);
	await checkVisibleRangePaging(page);
	await checkEditingDuringPlayback(page);
	await checkReadOnlyMode(page);
	await checkAboutAndDocumentation(page);
	await restoreFixture(page, original);
}
