import { coalescedChartPoints } from "../app/pencil-stroke.js";

// Pencil gestures stay out of stage-pointer.js so that file can stay within its line limit.
export class PencilPointer {
	_pencilSamples(event, mapping) {
		return coalescedChartPoints(event, item => this.surface.toLocal(item), point => mapping.toChart(point));
	}

	_movePencil(context) {
		this.callbacks.onPencilSamples?.(this._pencilSamples(context.event, context.mapping));
	}

	_commitPencil(context) {
		if (context.event?.type === "pointercancel") {
			return;
		}
		this._movePencil(context);
		this.callbacks.onPencilFinish?.();
	}
}
