import { composeTraits } from "../core/mixin.js";
import { StageHudTrait } from "./stage-hud.js";
import { StagePointerTrait } from "./stage-pointer.js";
import { StageTransformDragTrait } from "./stage-transform-drag.js";

// Everything the main field does in response to input, assembled from three traits: the
// head-up display and selection box (stage-hud.js), the pointer state machine
// (stage-pointer.js) and the free transform drag maths (stage-transform-drag.js).
class StageInteractionsTrait {
	destroy() {
		document.removeEventListener("pointermove", this.boundMove);
		document.removeEventListener("pointerup", this.boundUp);
		document.removeEventListener("pointercancel", this.boundUp);
		document.removeEventListener("keydown", this.ctrlAltListener, true);
		document.removeEventListener("keyup", this.ctrlAltListener, true);
		cancelAnimationFrame(this.particleAnimationFrame);
		cancelAnimationFrame(this.renderAnimationFrame);
		cancelAnimationFrame(this.pointerMoveAnimationFrame);
		this.particleAnimationFrame = 0;
		this.renderAnimationFrame = 0;
		this.pointerMoveAnimationFrame = 0;
		this.surface.destroy();
	}
}

export const withStageInteractions = composeTraits(
	"StageInteractionsLayer",
	StageInteractionsTrait,
	StageHudTrait,
	StagePointerTrait,
	StageTransformDragTrait,
);
