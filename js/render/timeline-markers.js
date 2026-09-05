import { Rational } from "../core/rational.js";
import { flattenEvents } from "../core/grouping.js";
import { switchedChannelsAt } from "../core/tip-point-track.js";
import {
	dedupeCornerMarkers,
	selectedEventMarker,
	trianglePath,
} from "../core/selected-event-markers.js";
import { eventIconRadius, projectState, visibleTimelineChannels } from "./timeline-helpers.js";

const TEAL = "#2ad4c7";

export class TimelineMarkersTrait {
	_visibleChannelLimit(project) {
		return Math.max(1, Number(project.preferences?.visibleChannels) || 3);
	}

	_eventIconRadius(project) {
		return eventIconRadius(project.preferences);
	}

	_drawTipPointSwitches(context, layout, project) {
		const channels = this._visibleChannels(project);
		const radius = this._eventIconRadius(project);
		for (const channel of project.channels || []) {
			for (const item of channel.tipPointSwitches || []) {
				const lane = channels.findIndex(visible => visible.id === channel.id);
				if (lane < 0) {
					continue;
				}
				const x = this._timeToX(this.timing.beatToSeconds(item.time), layout.channels.width);
				const top = layout.channels.y + lane * layout.channelHeight;
				context.strokeStyle = TEAL;
				context.lineWidth = Math.max(2, radius / 4);
				context.beginPath();
				context.moveTo(x, top);
				context.lineTo(x, top + layout.channelHeight);
				context.stroke();
				this.hitRegions.push({
					type: "tip-switch",
					time: item.time,
					x: x - 4,
					y: top,
					width: 8,
					height: layout.channelHeight,
				});
			}
		}
		return switchedChannelsAt;
	}

	_drawSelectedEventMarkers(context, layout, project) {
		const visible = this._visibleChannels(project);
		const allVisible = visibleTimelineChannels(project);
		const ordered = project.channels || [];
		const beginning = Number(project.editor.visibleRangeBeginning);
		const ending = Number(project.editor.visibleRangeEnd);
		const markers = [];
		for (const event of flattenEvents(project.events || [], false)) {
			if (!event.selected) {
				continue;
			}
			const time = this.timing.beatToSeconds(event.time);
			const originalIndex = ordered.findIndex(channel => channel.id === event.channel);
			const visibleIndex = allVisible.findIndex(channel => channel.id === event.channel);
			const channelIndex = visibleIndex - this.channelOffset;
			const hidden = ordered[originalIndex]?.hidden === true;
			const hiddenSeparatorVisible = hidden && this._hiddenSeparatorVisible(project, originalIndex, visible);
			markers.push(
				selectedEventMarker(
					{
						event,
						time,
						channelIndex,
						visibleChannelCount: visible.length,
						rangeStart: beginning,
						rangeEnd: ending,
						hiddenSeparatorVisible,
					},
					{},
				),
			);
		}
		const unique = dedupeCornerMarkers(markers);
		const size = Math.max(7, this._eventIconRadius(project) * 0.9);
		context.fillStyle = "#ff3158";
		for (const marker of unique) {
			const origin = this._markerOrigin(marker, layout, visible, beginning, ending);
			if (!origin) {
				continue;
			}
			context.beginPath();
			trianglePath(marker.kind, size).forEach((point, index) => {
				const x = origin.x + point[0];
				const y = origin.y + point[1];
				if (index) {
					context.lineTo(x, y);
				} else {
					context.moveTo(x, y);
				}
			});
			context.closePath();
			context.fill();
		}
	}

	_hiddenSeparatorVisible(project, originalIndex, visible) {
		if (!visible.length) {
			return false;
		}
		const ordered = project.channels || [];
		const first = ordered.findIndex(channel => channel.id === visible[0].id);
		const last = ordered.findIndex(channel => channel.id === visible.at(-1).id);
		return originalIndex > first && originalIndex < last;
	}

	_markerOrigin(marker, layout, visible, beginning, ending) {
		const left = 8;
		const right = layout.channels.width - 8;
		const top = layout.channels.y + 8;
		const bottom = layout.channels.y + layout.channels.height - 8;
		const xForTime = time => this._timeToX(time, layout.channels.width);
		const yForLane = index => layout.channels.y + (index + 0.5) * layout.channelHeight;
		switch (marker.kind) {
			case "left":
				return { x: left, y: yForLane(marker.channelIndex) };
			case "right":
				return { x: right, y: yForLane(marker.channelIndex) };
			case "up":
				return { x: xForTime(marker.time), y: top };
			case "down":
				return { x: xForTime(marker.time), y: bottom };
			case "up-left":
				return { x: left, y: top };
			case "up-right":
				return { x: right, y: top };
			case "down-left":
				return { x: left, y: bottom };
			case "down-right":
				return { x: right, y: bottom };
			default:
				return null;
		}
	}

	_channelDrawY(project, layout, channelId, visible) {
		const index = visible.findIndex(channel => channel.id === channelId);
		if (index >= 0) {
			return layout.channels.y + (index + 0.5) * layout.channelHeight;
		}
		const ordered = project.channels || [];
		const original = ordered.findIndex(channel => channel.id === channelId);
		if (original < 0 || !visible.length) {
			return null;
		}
		const first = ordered.findIndex(channel => channel.id === visible[0].id);
		const last = ordered.findIndex(channel => channel.id === visible.at(-1).id);
		if (original < first) {
			return layout.channels.y;
		}
		if (original > last) {
			return layout.channels.y + layout.channels.height;
		}
		for (let lane = 0; lane < visible.length - 1; lane += 1) {
			const left = ordered.findIndex(channel => channel.id === visible[lane].id);
			const right = ordered.findIndex(channel => channel.id === visible[lane + 1].id);
			if (original > left && original < right) {
				return layout.channels.y + (lane + 1) * layout.channelHeight;
			}
		}
		return null;
	}

	_drawSnappeeScrollbarMarks(context, rectangle, project, bounds) {
		const snappee = (project.snappees || []).find(item => item.selected);
		if (!snappee) {
			return;
		}
		const span = Math.max(1e-9, bounds[1] - bounds[0]);
		context.strokeStyle = snappee.color || "#00e0ad";
		context.globalAlpha = 0.35;
		context.lineWidth = 2;
		for (const event of flattenEvents(project.events || [], false)) {
			if (!event.attached || event.snappee !== snappee.id) {
				continue;
			}
			const time = this.timing.beatToSeconds(event.time);
			const x = rectangle.x + ((time - bounds[0]) / span) * rectangle.width;
			context.beginPath();
			context.moveTo(x, rectangle.y);
			context.lineTo(x, rectangle.y + rectangle.height);
			context.stroke();
		}
		context.globalAlpha = 1;
	}
}

export { TEAL, projectState, Rational };
