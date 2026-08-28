import { Rational } from "../core/rational.js";
import { resolveAttachedPosition } from "../core/geometry.js";
import { descendants, flattenEvents } from "../core/grouping.js";
import { buildTipPointGuides, drawTipPointTrail, tipPointSpawnPosition, tipPointVisualState } from "./stage.js";
import {
	TIMELINE_COMMENT_TEXT_COLOR,
	TIMELINE_DURATION_TYPES as DURATION_TYPES,
	TIMELINE_EVENT_COLORS as NOTE_COLORS,
	drawTimelineEventIcon,
	eventDrawLayer,
	isBackgroundEvent,
	relativeBeatColor,
	timelineTipSegments,
	tipSpawnDirectionSegment,
	timelineTipCheckpointSignature,
} from "./timeline-helpers.js";
import { abLoopMarks } from "./timeline-gestures.js";

// Painting of the timeline: the waveform strip, the beat and bar lines, the channel lanes
// with their events, the tip point connectors, the BPM markers, the playhead and the two
// scrollbars. Everything here reads the chart and the layout and draws; the layout itself and
// the pointer handling live in their own modules.

export class TimelineDrawingTrait {

	_drawWaveform(context, rectangle, editor) {
		context.fillStyle = "#101216";
		context.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
		const waveform = this.callbacks.getWaveform?.();
		if (!waveform) {
			context.strokeStyle = "#5e646b";
			context.lineWidth = 1;
			context.beginPath();
			context.moveTo(0, rectangle.height / 2);
			context.lineTo(rectangle.width, rectangle.height / 2);
			context.stroke();
			return;
		}
		const columns = waveform.getColumns(editor.visibleRangeBeginning, editor.visibleRangeEnd, rectangle.width);
		const middle = rectangle.y + rectangle.height / 2;
		const amplitude = rectangle.height * 0.43;
		context.strokeStyle = "#8c9298";
		context.globalAlpha = 0.9;
		context.lineWidth = 1;
		context.beginPath();
		for (let x = 0; x < columns.length; x += 1) {
			const peak = columns[x];
			context.moveTo(x + 0.5, middle - peak.max * amplitude);
			context.lineTo(x + 0.5, middle - peak.min * amplitude);
		}
		context.stroke();
		context.globalAlpha = 1;
	}

	_loopSeconds(editor) {
		return (Array.isArray(editor.abLoopMarks) ? editor.abLoopMarks : [])
			.slice(0, 2)
			.map(mark => this.timing.beatToSeconds(mark))
			.sort((left, right) => left - right);
	}

	_drawLoopWaveformRange(context, rectangle, editor) {
		const marks = this._loopSeconds(editor);
		if (marks.length !== 2) {
			return;
		}
		const left = this._timeToX(marks[0], rectangle.width);
		const right = this._timeToX(marks[1], rectangle.width);
		context.fillStyle = "rgba(47,143,255,0.24)";
		context.fillRect(left, rectangle.y, right - left, rectangle.height);
	}

	_drawLoopBeatLines(context, layout, editor) {
		const marks = this._loopSeconds(editor);
		if (!marks.length) {
			return;
		}
		context.save();
		context.strokeStyle = "#2f8fff";
		context.lineWidth = 2;
		for (const mark of marks) {
			const x = Math.round(this._timeToX(mark, layout.waveform.width)) + 0.5;
			context.beginPath();
			context.moveTo(x, 0);
			context.lineTo(x, layout.scroll.y);
			context.stroke();
		}
		context.restore();
	}

	_drawBeatLines(context, layout, editor) {
		const subdivision = Math.max(1, Math.floor(editor.subdivision || 2));
		const beginningBeat = this.timing.secondsToBeatNumber(editor.visibleRangeBeginning);
		const endingBeat = this.timing.secondsToBeatNumber(editor.visibleRangeEnd);
		const lines = this.timing.beatLinesBetween(
			Rational.fromNumber(Math.min(beginningBeat, endingBeat) - 1 / subdivision),
			Rational.fromNumber(Math.max(beginningBeat, endingBeat) + 1 / subdivision),
			subdivision,
		);
		context.save();
		context.font = "10px 'Cascadia Mono', Consolas, monospace";
		context.textBaseline = "top";
		for (const line of lines) {
			const x = this._timeToX(this.timing.beatToSeconds(line.beat), layout.waveform.width);
			if (x < -1 || x > layout.waveform.width + 1) {
				continue;
			}
			context.strokeStyle = relativeBeatColor(line.relative);
			context.globalAlpha = line.integerFromBar ? 0.72 : 0.34;
			context.lineWidth = line.barLine ? 2.5 : line.integerFromBar ? 1.35 : 1;
			context.beginPath();
			context.moveTo(Math.round(x) + 0.5, 0);
			context.lineTo(Math.round(x) + 0.5, layout.scroll.y);
			context.stroke();
			if (line.integerFromBar) {
				context.globalAlpha = 0.9;
				context.fillStyle = relativeBeatColor(line.relative);
				context.fillText(line.beat.toString(), x + 3, 3);
			}
		}
		context.restore();
	}

	_drawChannels(context, layout, project) {
		const channels = this._visibleChannels(project);
		context.fillStyle = "#090a0c";
		context.fillRect(0, layout.channels.y, layout.channels.width, layout.channels.height);
		context.font = "10px 'Cascadia Mono', Consolas, monospace";
		context.textBaseline = "top";
		channels.forEach((channel, index) => {
			const y = layout.channels.y + index * layout.channelHeight;
			if (index) {
				context.strokeStyle = "#34383d";
				context.lineWidth = 1;
				context.beginPath();
				context.moveTo(0, Math.round(y) + 0.5);
				context.lineTo(layout.channels.width, Math.round(y) + 0.5);
				context.stroke();
			}
			context.fillStyle = channel.id === project.editor.currentChannel ? "#ffe331" : "#c4c9ce";
			context.globalAlpha = channel.active === false ? 0.34 : 0.9;
			const name = String(channel.name || `Channel ${index + this.channelOffset + 1}`);
			context.fillText(name, 4, y + 4, Math.max(20, layout.channels.width - 18));
			context.globalAlpha = 1;
		});
	}

	// Events of every channel lane, painted in the layer order of the timeline so that the
	// background events end up behind the notes.
	_drawEvents(context, layout, project) {
		const offsets =
			this.renderIndex?.eventLaneOffsets ||
			this._eventLaneOffsets(flattenEvents(project.events || [], false));
		const activeChannelIds =
			this.renderIndex?.activeChannelIds ||
			new Set(project.channels.filter(channel => channel.active !== false).map(channel => channel.id));
		const records = this._timelineEventRecords(project);
		this._drawSelectedGroupBounds(context, layout, project, offsets);
		for (const record of records) {
			const { event } = record;
			if (project.editor?.showBgEventsInTimeline === false && isBackgroundEvent(event)) {
				continue;
			}
			const position = this._eventPosition(event, layout, project, offsets, record);
			if (!position) {
				continue;
			}
			const endX = this._timeToX(this._eventEndSeconds(record, position), layout.channels.width);
			if (Math.max(position.x, endX) < -20 || Math.min(position.x, endX) > layout.channels.width + 20) {
				continue;
			}
			this._drawTimelineEvent(context, { event, position, endX, layout, project, activeChannelIds });
		}
	}

	// Visible records, sorted the way they have to be painted: by layer, then by time, then by
	// the order they appear in the chart.
	_timelineEventRecords(project) {
		const beginning = project.editor.visibleRangeBeginning;
		const ending = project.editor.visibleRangeEnd;
		const records =
			this.renderIndex?.timelineRecords(beginning, ending) ||
			flattenEvents(project.events || [], false).map(event => ({ event }));
		const seconds = record => record.start ?? this.timing.beatToSeconds(record.event.time);
		records.sort(
			(left, right) =>
				eventDrawLayer(left.event) - eventDrawLayer(right.event) ||
				seconds(left) - seconds(right) ||
				(left.sequence ?? 0) - (right.sequence ?? 0),
		);
		return records;
	}

	_eventEndSeconds(record, position) {
		if (record.end != null) {
			return record.end;
		}
		if (!DURATION_TYPES.has(record.event.type)) {
			return position.time;
		}
		const finish = Rational.from(record.event.time).add(record.event.duration || [0, 1, 1]);
		return this.timing.beatToSeconds(finish);
	}

	_drawTimelineEvent(context, entry) {
		const { event, position, endX, activeChannelIds, project } = entry;
		const interactive = activeChannelIds.has(event.channel);
		const selected = this.renderIndex?.isEventSelected(event) ?? Boolean(event.selected);
		const color = selected ? "#ff3158" : NOTE_COLORS[event.type] || "#d5dade";
		context.save();
		if (project.editor?.showGroupingInTimeline !== false) {
			this._drawEventGroupRings(context, event, position, interactive);
		}
		if (!interactive) {
			context.globalAlpha = 0.28;
		}
		if (DURATION_TYPES.has(event.type)) {
			this._drawEventDurationBar(context, { event, position, endX, color, selected, interactive });
		}
		drawTimelineEventIcon(context, event, position.x, position.y, color);
		if (interactive) {
			this._registerEventHitRegion(event, position);
		}
		if ((event.type === "bigText" || event.type === "comment") && event.text) {
			this._drawEventLabel(context, event, position, endX, color);
		}
		if (interactive && selected && DURATION_TYPES.has(event.type)) {
			this._drawDiamond(context, endX, position.y, 7);
			const region = { x: endX - 7, y: position.y - 7, width: 14, height: 14 };
			this.hitRegions.push({ type: "duration", event, ...region });
		}
		context.restore();
	}

	// Grouped events wear one ring per enclosing group, widening outwards.
	_drawEventGroupRings(context, event, position, interactive) {
		const ancestors = this.renderIndex?.ancestorsById.get(event.id) || [];
		ancestors
			.slice()
			.reverse()
			.forEach((group, index) => {
				context.strokeStyle = group.color || "#ff9d3d";
				context.globalAlpha = interactive ? 0.86 : 0.24;
				context.lineWidth = 1.4;
				context.beginPath();
				context.arc(position.x, position.y, 12 + index * 5, 0, Math.PI * 2);
				context.stroke();
			});
	}

	_drawEventDurationBar(context, { event, position, endX, color, selected, interactive }) {
		context.strokeStyle = color;
		context.globalAlpha *= selected ? 0.92 : 0.58;
		context.lineWidth = event.type === "hold" ? 8 : 6;
		context.beginPath();
		context.moveTo(position.x, position.y);
		context.lineTo(endX, position.y);
		context.stroke();
		context.globalAlpha = interactive ? 1 : 0.28;
		if (!interactive) {
			return;
		}
		this.hitRegions.push({
			type: "event",
			event,
			x: Math.min(position.x, endX) - 5,
			y: position.y - 8,
			width: Math.abs(endX - position.x) + 10,
			height: 16,
		});
	}

	_registerEventHitRegion(event, position) {
		const selectionEvent = this.renderIndex?.selectionTarget(event) || event;
		this.eventCenters.push({ event: selectionEvent, x: position.x, y: position.y });
		const region = { x: position.x - 12, y: position.y - 12, width: 24, height: 24 };
		this.hitRegions.push({ type: "event", event, ...region });
	}

	// Big text and comments show the beginning of their text next to their icon.
	_drawEventLabel(context, event, position, endX, color) {
		context.save();
		context.fillStyle = event.type === "comment" ? TIMELINE_COMMENT_TEXT_COLOR : color;
		context.font = "11px sans-serif";
		context.textBaseline = "bottom";
		context.fillText(
			String(event.text).slice(0, 40),
			Math.min(position.x, endX) + 3,
			position.y - 8,
			Math.max(30, Math.abs(endX - position.x) - 6),
		);
		context.restore();
	}

	_drawSelectedGroupBounds(context, layout, project, offsets) {
		if (project.editor?.showGroupingInTimeline === false) {
			return;
		}
		let groups = this.renderIndex?.selectedRootGroups;
		if (!groups) {
			groups = flattenEvents(project.events || [], true).filter(
				event => event.type === "group" && event.selected,
			);
		}
		for (const group of groups) {
			const points = descendants(group)
				.filter(event => event.type !== "group")
				.map(event => {
					const record = this.renderIndex?.recordFor(event);
					return this._eventPosition(event, layout, project, offsets, record);
				})
				.filter(Boolean);
			if (!points.length) {
				continue;
			}
			const xs = points.map(point => point.x);
			const ys = points.map(point => point.y);
			context.save();
			context.strokeStyle = group.color || "#ff9d3d";
			context.setLineDash([5, 3]);
			context.strokeRect(
				Math.min(...xs) - 14,
				Math.min(...ys) - 12,
				Math.max(...xs) - Math.min(...xs) + 28,
				Math.max(...ys) - Math.min(...ys) + 24,
			);
			context.restore();
		}
	}

	_drawDiamond(context, x, y, size = 10) {
		context.save();
		context.translate(x, y);
		context.rotate(Math.PI / 4);
		context.fillStyle = "#f6f7f8";
		context.strokeStyle = "#111417";
		context.lineWidth = 1;
		context.fillRect(-size / 2, -size / 2, size, size);
		context.strokeRect(-size / 2, -size / 2, size, size);
		context.restore();
	}

	_drawTipPointMarker(context, point, scale) {
		if (!point || scale <= 0) {
			return;
		}
		context.save();
		context.translate(point.x, point.y);
		context.rotate(point.angle || 0);
		context.scale(scale, scale);
		context.fillStyle = "#101215";
		context.strokeStyle = "#ffe331";
		context.lineWidth = 1.2;
		context.beginPath();
		context.arc(0, 0, 4.5, 0, Math.PI * 2);
		context.fill();
		context.stroke();
		context.beginPath();
		context.moveTo(2.5, -3.2);
		context.lineTo(7, 0);
		context.lineTo(2.5, 3.2);
		context.closePath();
		context.fill();
		context.stroke();
		context.restore();
	}

	_drawTipPointLines(context, layout, project, now) {
		const offsets =
			this.renderIndex?.eventLaneOffsets ||
			this._eventLaneOffsets(flattenEvents(project.events || [], false));
		const beginning = project.editor.visibleRangeBeginning;
		const ending = project.editor.visibleRangeEnd;
		if (project.editor?.showTipPoints === false) {
			return;
		}
		const guides =
			this.renderIndex?.timelineTipGuides(beginning, ending) || buildTipPointGuides(project, this.timing);
		const activeChannelIds =
			this.renderIndex?.activeChannelIds ||
			new Set(project.channels.filter(channel => channel.active !== false).map(channel => channel.id));
		const checkpointSignature = timelineTipCheckpointSignature(
			layout,
			this.channelOffset,
			project.channels,
			this.renderIndex?.timelineTipRevision,
		);
		for (const guide of guides) {
			const checkpoints = this._tipPointCheckpoints(guide, layout, project, offsets, checkpointSignature);
			if (!checkpoints) {
				continue;
			}
			const firstPosition =
				this.renderIndex?.positionFor(guide.events[0]) ||
				resolveAttachedPosition(guide.events[0], project.snappees) ||
				guide.events[0];
			const resolvedSpawn = this.renderIndex?.tipSpawnPositionFor(guide.spawnSettings);
			const spawnPosition = tipPointSpawnPosition(
				guide.spawnSettings,
				firstPosition,
				project.snappees,
				resolvedSpawn,
			);
			const shortConnector = tipSpawnDirectionSegment(firstPosition, spawnPosition, checkpoints[1]);
			const segments = timelineTipSegments(checkpoints.eventCheckpoints, beginning, ending);
			context.save();
			if (!activeChannelIds.has(guide.events[0]?.channel)) {
				context.globalAlpha = 0.28;
			}
			if (shortConnector.length > 1) {
				context.strokeStyle = "#a98500";
				context.lineWidth = 1.5;
				context.beginPath();
				context.moveTo(shortConnector[0].x, shortConnector[0].y);
				context.lineTo(shortConnector[1].x, shortConnector[1].y);
				context.stroke();
			}
			context.strokeStyle = "rgba(255,255,255,0.24)";
			context.lineWidth = 5;
			context.lineCap = "round";
			context.lineJoin = "round";
			context.beginPath();
			for (const [from, to] of segments) {
				context.moveTo(from.x, from.y);
				context.lineTo(to.x, to.y);
			}
			if (segments.length) {
				context.stroke();
			}
			const visual = tipPointVisualState(checkpoints, now);
			if (!visual) {
				context.restore();
				continue;
			}
			drawTipPointTrail(context, visual.trail, 5, visual.scale, visual.alpha, 0.64);
			this._drawTipPointMarker(context, visual.head, visual.scale);
			context.restore();
		}
	}

	_tipPointCheckpoints(guide, layout, project, offsets, signature) {
		if (
			this.tipPointCheckpointCache?.index !== this.renderIndex ||
			this.tipPointCheckpointCache.signature !== signature
		) {
			this.tipPointCheckpointCache = { index: this.renderIndex, signature, guides: new WeakMap() };
		}
		const cached = this.tipPointCheckpointCache.guides.get(guide);
		if (cached !== undefined) {
			return cached;
		}
		if (!guide?.events?.[0]) {
			this.tipPointCheckpointCache.guides.set(guide, null);
			return null;
		}
		const channels = this._visibleChannels(project);
		const channelIndex = channels.findIndex(channel => channel.id === guide.events[0].channel);
		if (channelIndex < 0) {
			this.tipPointCheckpointCache.guides.set(guide, null);
			return null;
		}
		const makePoint = (time, y) => {
			const point = { time, y };
			Object.defineProperty(point, "x", {
				enumerable: true,
				get: () => this._timeToX(time, layout.channels.width),
			});
			return point;
		};
		const baseY = layout.channels.y + (channelIndex + 0.5) * layout.channelHeight;
		const firstY = baseY + (offsets.get(guide.events[0].id) || 0);
		const checkpoints = [makePoint(guide.spawnTime, firstY)];
		for (let index = 0; index < guide.events.length; index += 1) {
			const event = guide.events[index];
			checkpoints.push(makePoint(guide.eventTimes[index], baseY + (offsets.get(event.id) || 0)));
		}
		Object.defineProperty(checkpoints, "eventCheckpoints", { value: checkpoints.slice(1) });
		this.tipPointCheckpointCache.guides.set(guide, checkpoints);
		return checkpoints;
	}

	_drawBpmChanges(context, rectangle, project) {
		context.save();
		context.font = "bold 11px 'Cascadia Mono', Consolas, monospace";
		context.textBaseline = "bottom";
		for (let index = 0; index < project.timing.bpmChanges.length; index += 1) {
			const change = project.timing.bpmChanges[index];
			const x = this._timeToX(this.timing.beatToSeconds(change.time), rectangle.width);
			if (x < -40 || x > rectangle.width + 4) {
				continue;
			}
			const text = Number(change.bpm).toFixed(Number.isInteger(change.bpm) ? 0 : 2);
			const metrics = context.measureText(text);
			context.fillStyle = "#d567ff";
			context.fillText(text, x + 3, rectangle.height - 3);
			this.hitRegions.push({
				type: "bpm",
				index,
				x,
				y: rectangle.height - 18,
				width: metrics.width + 7,
				height: 18,
			});
		}
		context.restore();
	}

	_drawCurrentLines(context, layout, project, current) {
		const x = this._timeToX(current, layout.waveform.width);
		context.strokeStyle = "#ffe331";
		context.lineWidth = 2;
		context.beginPath();
		context.moveTo(x, 0);
		context.lineTo(x, layout.waveform.height);
		context.stroke();
		const channels = this._visibleChannels(project);
		const index = channels.findIndex(channel => channel.id === project.editor.currentChannel);
		if (index >= 0) {
			const top = layout.channels.y + index * layout.channelHeight;
			context.beginPath();
			context.moveTo(x, top);
			context.lineTo(x, top + layout.channelHeight);
			context.stroke();
		}
	}

	_drawScrollbar(context, rectangle, project, current) {
		const bounds = this._timeBounds(project);
		const beginningX = this._scrollX(project.editor.visibleRangeBeginning, rectangle, bounds);
		const endingX = this._scrollX(project.editor.visibleRangeEnd, rectangle, bounds);
		const currentX = this._scrollX(current, rectangle, bounds);
		context.fillStyle = "#15181b";
		context.fillRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
		const loopMarks = this._loopSeconds(project.editor);
		if (loopMarks.length === 2) {
			const loopBeginningX = this._scrollX(loopMarks[0], rectangle, bounds);
			const loopEndX = this._scrollX(loopMarks[1], rectangle, bounds);
			context.fillStyle = "rgba(47,143,255,0.24)";
			context.fillRect(loopBeginningX, rectangle.y, loopEndX - loopBeginningX, rectangle.height);
		}
		context.strokeStyle = "#2f8fff";
		context.lineWidth = 2;
		for (const mark of loopMarks) {
			const x = this._scrollX(mark, rectangle, bounds);
			context.beginPath();
			context.moveTo(x, rectangle.y + 1);
			context.lineTo(x, rectangle.y + rectangle.height - 1);
			context.stroke();
		}
		context.strokeStyle = "#56db79";
		context.lineWidth = 3;
		context.beginPath();
		context.moveTo(beginningX, rectangle.y + rectangle.height / 2);
		context.lineTo(endingX, rectangle.y + rectangle.height / 2);
		context.stroke();
		for (const x of [beginningX, endingX]) {
			context.lineWidth = 2;
			context.beginPath();
			context.moveTo(x, rectangle.y + 3);
			context.lineTo(x, rectangle.y + rectangle.height - 3);
			context.stroke();
		}
		context.strokeStyle = "#ffe331";
		context.lineWidth = 2;
		context.beginPath();
		context.moveTo(currentX, rectangle.y + 1);
		context.lineTo(currentX, rectangle.y + rectangle.height - 1);
		context.stroke();
		this.hitRegions.push({
			type: "scroll-current",
			x: currentX - 5,
			y: rectangle.y,
			width: 10,
			height: rectangle.height,
			bounds,
			rectangle,
		});
		this.hitRegions.push({
			type: "scroll-begin",
			x: beginningX - 5,
			y: rectangle.y,
			width: 10,
			height: rectangle.height,
			bounds,
			rectangle,
		});
		this.hitRegions.push({
			type: "scroll-end",
			x: endingX - 5,
			y: rectangle.y,
			width: 10,
			height: rectangle.height,
			bounds,
			rectangle,
		});
		this.hitRegions.push({
			type: "scroll-range",
			x: Math.min(beginningX, endingX),
			y: rectangle.y + 5,
			width: Math.abs(endingX - beginningX),
			height: rectangle.height - 10,
			bounds,
			rectangle,
		});
		this.hitRegions.push({
			type: "scroll-track",
			x: rectangle.x,
			y: rectangle.y,
			width: rectangle.width,
			height: rectangle.height,
			bounds,
			rectangle,
		});
	}

	_drawChannelScrollbar(context, layout, project) {
		if (project.channels.length <= 3) {
			return;
		}
		const width = 10;
		const x = layout.channels.width - width;
		context.fillStyle = "#20242a";
		context.fillRect(x, layout.channels.y, width, layout.channels.height);
		const thumbHeight = Math.max(22, (layout.channels.height * 3) / project.channels.length);
		const maxOffset = project.channels.length - 3;
		const thumbY = layout.channels.y + ((layout.channels.height - thumbHeight) * this.channelOffset) / maxOffset;
		context.fillStyle = "#68717a";
		context.fillRect(x + 2, thumbY, width - 4, thumbHeight);
		this.hitRegions.push({
			type: "channel-scroll",
			x,
			y: layout.channels.y,
			width,
			height: layout.channels.height,
			thumbY,
			thumbHeight,
			maxOffset,
		});
	}

	_drawSelectionBox(context, rectangle) {
		const x = Math.min(rectangle.x1, rectangle.x2);
		const y = Math.min(rectangle.y1, rectangle.y2);
		const width = Math.abs(rectangle.x2 - rectangle.x1);
		const height = Math.abs(rectangle.y2 - rectangle.y1);
		context.fillStyle = "rgba(48,134,255,0.18)";
		context.strokeStyle = "#72adff";
		context.lineWidth = 1;
		context.fillRect(x, y, width, height);
		context.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, width, height);
	}

}
