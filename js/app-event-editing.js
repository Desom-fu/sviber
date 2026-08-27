import { composeTraits } from "./mixin.js";
export { unifyTipPointModes } from "./app-tip-point-modes.js";
import { withFreeTransform } from "./app-free-transform.js";
import { withViewControls } from "./app-view-controls.js";
import { EventMoveTrait } from "./app-event-move.js";
import { GroupAnchorMoveTrait } from "./app-group-anchor-move.js";
import { PositionMoveTrait } from "./app-position-move.js";
import { PropertyEditingTrait } from "./app-property-editing.js";
import { SelectionPreviewTrait } from "./app-selection-preview.js";
import { SelectionTrait } from "./app-selection.js";
import { SelectionTransformTrait } from "./app-selection-transform.js";
import { SnappeeDragTrait } from "./app-snappee-drag.js";
import { StageMoveExceptionTrait } from "./app-stage-move-exception.js";
import { TimelineNavigationTrait } from "./app-timeline-navigation.js";
import { TipSpawnMoveTrait } from "./app-tip-spawn-move.js";
import { TransformTargetsTrait } from "./app-transform-targets.js";
import { ViewCallbacksTrait } from "./app-view-callbacks.js";

// Composition root of the event-editing layer. The single oversized mixin was split by
// concern into the trait modules imported above; this module keeps the pieces that belong
// to none of them (leaving a creation mode, unifying tip point modes) and assembles the
// layer. `withEventEditing` keeps its name and module path so every importer stays
// unchanged.

class EventEditingTrait {
	exitCreationModes() {
		if (!this.creationMode && !this.curveDraft) {
			return false;
		}
		this.creationMode = null;
		this.curveDraft = null;
		this.cancelPreview();
		this._refreshLightweight?.({ rebuildIndex: false, skipInspector: true, skipHistory: true });
		return true;
	}
}

const withEventEditingBase = composeTraits(
	"EventEditingLayer",
	EventEditingTrait,
	ViewCallbacksTrait,
	SelectionTrait,
	SelectionPreviewTrait,
	StageMoveExceptionTrait,
	TimelineNavigationTrait,
	EventMoveTrait,
	PositionMoveTrait,
	GroupAnchorMoveTrait,
	TipSpawnMoveTrait,
	SnappeeDragTrait,
	TransformTargetsTrait,
	SelectionTransformTrait,
	PropertyEditingTrait,
);
export const withEventEditing = Base => withViewControls(withFreeTransform(withEventEditingBase(Base)));
