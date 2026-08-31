// Monaco awareness of the macro API (v17): the identifiers exposed to macros are
// registered as completion items for both JavaScript and Ruby, and the JavaScript
// language service gets an ambient declaration file so that members resolve.

export const MACRO_GLOBALS = Object.freeze([
	{ name: "Chart", detail: "chart-wide state, timing, events and snappees" },
	{ name: "Channel", detail: "channel list and the current channel" },
	{ name: "Event", detail: "event list, selection and creation" },
	{ name: "Snappee", detail: "snappee list and creation" },
	{ name: "Clip", detail: "saved clips" },
	{ name: "Tap", detail: "tap event class" },
	{ name: "Hold", detail: "hold event class" },
	{ name: "Drag", detail: "drag event class" },
	{ name: "Flick", detail: "flick event class" },
	{ name: "BgNote", detail: "bg note event class" },
	{ name: "BigText", detail: "big text event class" },
	{ name: "Grid", detail: "grid background pattern class" },
	{ name: "DiamondGrid", detail: "diamond grid background pattern class" },
	{ name: "Hexagon", detail: "hexagon background pattern class" },
	{ name: "Checkerboard", detail: "checkerboard background pattern class" },
	{ name: "Pentagon", detail: "pentagon background pattern class" },
	{ name: "Turntable", detail: "turntable background pattern class" },
	{ name: "Hexagram", detail: "hexagram background pattern class" },
	{ name: "Comment", detail: "comment event class" },
	{ name: "Group", detail: "group event class" },
	{ name: "RectangularMesh", detail: "rectangular mesh snappee class" },
	{ name: "RadialMesh", detail: "radial mesh snappee class" },
	{ name: "ParametricMesh", detail: "parametric mesh snappee class" },
	{ name: "RegularPolygonCurve", detail: "regular polygon curve snappee class" },
	{ name: "BezierCurve", detail: "Bezier curve snappee class" },
	{ name: "CircularArcCurve", detail: "circular arc curve snappee class" },
	{ name: "PenCurve", detail: "pen curve snappee class" },
	{ name: "ParametricCurve", detail: "parametric curve snappee class" },
]);

export const MACRO_CHART_MEMBERS = Object.freeze([
	"currentTime",
	"current_time",
	"currentChannel",
	"current_channel",
	"selectedSnappee",
	"selected_snappee",
	"clips",
	"events",
	"selectedEvents",
	"selected_events",
	"offset",
	"initialBpm",
	"initial_bpm",
	"bpmChanges",
	"bpm_changes",
	"barLines",
	"bar_lines",
	"title",
	"artist",
	"charter",
	"difficultyName",
	"difficulty_name",
	"difficulty",
	"music",
	"image",
	"snappees",
	"channels",
]);

export const MACRO_HELPERS = Object.freeze([
	{ name: "t", detail: "create a tap at the current time" },
	{ name: "h", detail: "create a hold at the current time" },
	{ name: "d", detail: "create a drag at the current time" },
	{ name: "f", detail: "create a flick at the current time" },
	{ name: "b", detail: "read or advance the current time in beats" },
	{ name: "bg_note", detail: "create a bg note at the current time" },
	{ name: "big_text", detail: "create a big text at the current time" },
	{ name: "log", detail: "print to the macro console" },
]);

export function macroTypeDeclarations() {
	const chartMembers = MACRO_CHART_MEMBERS.map(member => `\tconst ${member}: any;`).join("\n");
	const globals = MACRO_GLOBALS.map(entry => `declare const ${entry.name}: any;`).join("\n");
	const helpers = MACRO_HELPERS.map(entry => `declare const ${entry.name}: any;`).join("\n");
	return `${globals}\n${helpers}\ndeclare namespace SviberChart {\n${chartMembers}\n}\n`;
}

function completionItems(monaco, range) {
	const kind = monaco.languages.CompletionItemKind;
	const items = MACRO_GLOBALS.map(entry => ({
		label: entry.name,
		kind: kind.Class,
		detail: entry.detail,
		insertText: entry.name,
		range,
	}));
	for (const entry of MACRO_HELPERS) {
		items.push({ label: entry.name, kind: kind.Function, detail: entry.detail, insertText: entry.name, range });
	}
	for (const member of MACRO_CHART_MEMBERS) {
		items.push({ label: member, kind: kind.Property, detail: "Chart member", insertText: member, range });
	}
	return items;
}

export function registerMacroCompletions(monaco) {
	if (!monaco?.languages) {
		return () => {};
	}
	const provider = {
		provideCompletionItems(model, position) {
			const word = model.getWordUntilPosition(position);
			const range = {
				startLineNumber: position.lineNumber,
				endLineNumber: position.lineNumber,
				startColumn: word.startColumn,
				endColumn: word.endColumn,
			};
			return { suggestions: completionItems(monaco, range) };
		},
	};
	const disposables = ["javascript", "ruby"].map(language =>
		monaco.languages.registerCompletionItemProvider(language, provider),
	);
	try {
		monaco.languages.typescript?.javascriptDefaults?.addExtraLib(macroTypeDeclarations(), "sviber-macro-api.d.ts");
	} catch {
		/* The TypeScript worker is optional. */
	}
	return () => disposables.forEach(disposable => disposable?.dispose?.());
}

// Monaco ships its localizations as AMD bundles keyed by language tag.
export function monacoLocale(language) {
	const value = String(language || "").toLowerCase();
	if (value.startsWith("zh-tw") || value.startsWith("zh-hk") || value.startsWith("zh-mo")) {
		return "zh-tw";
	}
	if (value.startsWith("zh")) {
		return "zh-cn";
	}
	if (value.startsWith("ja")) {
		return "ja";
	}
	return "en";
}
