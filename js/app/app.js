import { i18n } from "../ui/i18n.js";
import { localizedErrorMessage } from "./app-helpers.js";
import { SviberAppCore } from "./app-core.js";
import { withEventEditing } from "./app-event-editing.js";
import { withHistoryCommands } from "./app-history-commands.js";
import { withFileWorkflows } from "./app-file-workflows.js";
import { withClipboard } from "./app-clipboard.js";
import { withChartTools } from "./app-chart-tools.js";
import { withAttachment } from "./app-attachment.js";
import { withAutoTiming } from "./app-auto-timing.js";
import { withChecks } from "./app-checks.js";
import { withProjectFiles } from "./app-project-files.js";
import { withTipPointSwitch } from "./app-tip-point-switch.js";
import { withBulkEditTexts } from "./app-bulk-edit.js";
import { withFileDrop } from "./app-file-drop.js";
import { withReadmeEditor } from "./app-readme-editor.js";

export { loadPreferences, storePreferences } from "./app-helpers.js";

const CoreWithEditing = withHistoryCommands(withEventEditing(SviberAppCore));
const CoreWithFiles = withClipboard(withFileWorkflows(CoreWithEditing));
const CoreWithTools = withChecks(withAutoTiming(withAttachment(withChartTools(CoreWithFiles))));
const CoreWithV24 = withReadmeEditor(
	withFileDrop(withBulkEditTexts(withTipPointSwitch(withProjectFiles(CoreWithTools)))),
);
const ComposedSviberApp = CoreWithV24;
export class SviberApp extends ComposedSviberApp {}

const app = new SviberApp();
globalThis.sviber = app;
app.initialize().catch(error => {
	console.error(error);
	const loading = document.getElementById("loading-screen");
	loading.querySelector("span:last-child").textContent = i18n.t("error.startup", {
		message: localizedErrorMessage(error),
	});
});
