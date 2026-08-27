// Entry point for the interaction checks. The checks themselves live in one module per subject
// area; this file installs the shared fixture and runs them in the order the editor state
// requires (pointer drags first, then move constraints, layout, chrome, inspector, transforms
// and finally playback).
import { installInteractionFixture, restoreInteractionFixture } from "./verify-browser-interaction-fixtures.mjs";
import { runDragInteractionChecks } from "./verify-browser-drag-interactions.mjs";
import { runMoveConstraintChecks } from "./verify-browser-move-constraints.mjs";
import { runLayoutAndGroupChecks } from "./verify-browser-layout-groups.mjs";
import { runChromeAndDialogChecks } from "./verify-browser-chrome-dialogs.mjs";
import { runCommandBoundaryChecks } from "./verify-browser-command-boundaries.mjs";
import { runInspectorEditingChecks } from "./verify-browser-inspector-editing.mjs";
import { runTransformAndCurveChecks } from "./verify-browser-transform-curves.mjs";
import { runPlaybackInteractionChecks } from "./verify-browser-playback-interactions.mjs";

export async function runInteractionChecks(page, outputDirectory) {
	const interactionFixture = await installInteractionFixture(page);
	await runDragInteractionChecks(page);
	await restoreInteractionFixture(page, interactionFixture);
	await runMoveConstraintChecks(page, interactionFixture);
	await runLayoutAndGroupChecks(page, outputDirectory);
	await runChromeAndDialogChecks(page);
	await runCommandBoundaryChecks(page, interactionFixture);
	await runInspectorEditingChecks(page);
	await runTransformAndCurveChecks(page, outputDirectory);
	await runPlaybackInteractionChecks(page);
}
