export * from "./stage-helpers.js";
import { StageViewCore } from "./stage-core.js";
import { withStageNotes } from "./stage-notes.js";
import { withStageInteractions } from "./stage-interactions.js";

const ComposedStageView = withStageInteractions(withStageNotes(StageViewCore));
export class StageView extends ComposedStageView {}
