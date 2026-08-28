// The SVG path row of the pen curve popup form: it shows the path data of the curve
// that the command list describes, copies it to the clipboard, and imports path data
// from the clipboard back into the command list.

import { i18n } from "./i18n.js";
import { penCommandsToSvgPath, svgPathToPenCommands } from "../core/geometry.js";

function numberOf(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

// The form stores every command with all six coordinates, so a straight conversion to
// the drawing commands is needed before serializing.
export function commandsToSvgPath(commands, closed) {
	const drawing = (commands || []).map(command => {
		const type = String(command?.type || "L").toUpperCase();
		if (type === "C" || type === "Q") {
			return {
				type: "C",
				x1: numberOf(command.x1),
				y1: numberOf(command.y1),
				x2: numberOf(command.x2),
				y2: numberOf(command.y2),
				x: numberOf(command.x),
				y: numberOf(command.y),
			};
		}
		return { type: type === "M" ? "M" : "L", x: numberOf(command.x), y: numberOf(command.y) };
	});
	return penCommandsToSvgPath(drawing, Boolean(closed));
}

export function svgPathToFormCommands(pathData) {
	const parsed = svgPathToPenCommands(pathData);
	const commands = parsed.commands.map(command => ({
		type: command.type,
		x: command.x,
		y: command.y,
		x1: command.x1 ?? command.x,
		y1: command.y1 ?? command.y,
		x2: command.x2 ?? command.x,
		y2: command.y2 ?? command.y,
	}));
	return { commands, closed: parsed.closed };
}

export function penPathFieldDefinition(options = {}) {
	return {
		id: "svgPath",
		type: "custom",
		labelKey: "field.svgPath",
		tooltipKey: "field.svgPath.hint",
		stacked: true,
		render: environment => renderPenPathField(environment, options),
	};
}

function renderPenPathField(environment, options) {
	const documentRef = environment.document || globalThis.document;
	const root = documentRef.createElement("div");
	root.className = "svg-path-field";
	const output = documentRef.createElement("textarea");
	output.rows = 2;
	output.readOnly = true;
	output.className = "svg-path-output";
	const actions = documentRef.createElement("div");
	actions.className = "svg-path-actions";
	const copyButton = documentRef.createElement("button");
	copyButton.type = "button";
	copyButton.className = "panel-button";
	copyButton.textContent = i18n.t("dialog.copySvgPath");
	const importButton = documentRef.createElement("button");
	importButton.type = "button";
	importButton.className = "panel-button";
	importButton.textContent = i18n.t("dialog.importSvgPath");
	actions.append(copyButton, importButton);
	root.append(output, actions);
	const refresh = () => {
		const values = options.readValues?.() || {};
		output.value = commandsToSvgPath(values.commands, values.closed);
	};
	copyButton.addEventListener("click", () => {
		refresh();
		void navigator.clipboard?.writeText(output.value);
		options.onCopy?.(output.value);
	});
	importButton.addEventListener("click", () => {
		void (async () => {
			try {
				const text = await navigator.clipboard.readText();
				const parsed = svgPathToFormCommands(text);
				if (parsed.commands.length < 2) {
					options.onError?.(new Error(i18n.t("validation.svgPath")));
					return;
				}
				options.onImport?.(parsed);
			} catch (error) {
				options.onError?.(error);
			}
		})();
	});
	refresh();
	return {
		element: root,
		read: () => output.value,
		refresh,
		setDisabled: disabled => {
			copyButton.disabled = disabled;
			importButton.disabled = disabled;
		},
	};
}
