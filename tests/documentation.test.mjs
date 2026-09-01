import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { STAGE_NOTE_MODULES, readSources, readManual } from "./module-source.mjs";
import { AFFINE_MATRIX_GRID } from "../js/core/geometry.js";

test("documentation and release metadata describe the current v10 behavior", async () => {
	const [manual, readme, readmeZh, rubyApi, sandbox, sandboxHtml, sandboxBundle] = await Promise.all([
		readManual(),
		readFile(new URL("../README.md", import.meta.url), "utf8"),
		readFile(new URL("../README.zh-CN.md", import.meta.url), "utf8"),
		readFile(new URL("../js/macro/macro-api.rb", import.meta.url), "utf8"),
		readFile(new URL("../js/macro/macro-sandbox.js", import.meta.url), "utf8"),
		readFile(new URL("../macro-sandbox.html", import.meta.url), "utf8"),
		readFile(new URL("../js/macro/macro-sandbox.bundle.js", import.meta.url), "utf8"),
	]);
	assert.match(manual, /same sound and level; there is no strong-beat\/weak-beat accent/);
	assert.match(manual, /相对最近小节线为整数拍的位置/);
	assert.match(manual, /default autosave interval is 120 seconds/);
	assert.match(manual, /默认 120 秒/);
	assert.match(readme, /help manual.*authoritative user guide/i);
	assert.match(readmeZh, /帮助手册.*唯一权威来源/);
	assert.match(rubyApi, /\$stdout = SviberMacroInternals::Output/);
	assert.match(rubyApi, /def puts\(\*values\)/);
	assert.match(sandbox, /SviberMacroInternals\.load_json/);
	assert.match(sandbox, /consolePrint: false/);
	assert.match(sandboxHtml, /macro-sandbox\.bundle\.js/);
	assert.doesNotMatch(sandboxHtml, /type="module"[^>]+macro-sandbox\.js/);
	assert.match(sandboxBundle, /parent\.postMessage/);
});

test("Scroll View, manual, and release notes describe the implemented behavior", async () => {
	const [scrollView, manual, manualPage, manualScript, manualStyles, readme, readmeZh] = await Promise.all([
		readFile(new URL("../js/render/scroll-view.js", import.meta.url), "utf8"),
		readManual(),
		readFile(new URL("../docs/index.html", import.meta.url), "utf8"),
		readFile(new URL("../docs/docs.js", import.meta.url), "utf8"),
		readFile(new URL("../docs/docs.css", import.meta.url), "utf8"),
		readFile(new URL("../README.md", import.meta.url), "utf8"),
		readFile(new URL("../README.zh-CN.md", import.meta.url), "utf8"),
	]);
	assert.match(scrollView, /timeScale = Math\.max\(0\.1, timelineWidth \/ visibleSpan\)/);
	assert.match(scrollView, /xScale = Math\.max/);
	assert.match(manual, /icon controls have no visible text labels/);
	assert.match(manual, /状态栏图标控件没有可见文字/);
	assert.match(manual, /same pixels-per-second scale/);
	assert.match(manual, /纵向每秒像素比例与时间轴/);
	assert.match(manualPage, /id="manual-search-input"/);
	assert.match(manualScript, /function applySearch/);
	assert.match(manualScript, /focusSearchMatch/);
	assert.match(manualScript, /event\.shiftKey \? -1 : 1/);
	assert.match(manualScript, /target\.scrollIntoView/);
	assert.doesNotMatch(manualScript, /node\.hidden = !matched/);
	assert.match(manualScript, /activeUi\.search/);
	assert.match(manualScript, /loadedManuals/);
	assert.match(manualStyles, /#manual-search-input/);
	assert.match(readme, /macOS provides x86_64 and aarch64 DMG images/);
	assert.match(readmeZh, /macOS 提供 x86_64 和 aarch64 DMG/);
});

test("manual documents only the prompt macro surface in both languages", async () => {
	const manual = await readManual();
	// The manual fragments contain the article HTML, so the section slices anchor on the
	// plain id fragments instead of quoted attribute values.
	const english = manual.slice(manual.indexOf("en-macro-api"), manual.indexOf("en-data"));
	const chinese = manual.slice(manual.indexOf("zh-macro-api"), manual.indexOf("zh-data"));
	const chineseArticle = manual;
	for (const section of [english, chinese]) {
		assert.match(section, /Chart/);
		assert.match(section, /AffineMatrix2D/);
		assert.match(section, /Location\(mesh,i,j\)/);
		assert.match(section, /TipPoint/);
		assert.match(section, /BpmChange/);
		assert.match(section, /BarLine/);
		assert.match(section, /Channel/);
		assert.match(section, /Snappee/);
		assert.match(section, /Event/);
		assert.match(section, /Clip/);
		assert.match(section, /copy\(events\)/);
		assert.match(section, /transform\(things/);
		assert.doesNotMatch(section, /<code>(?:api|state|chart)\./);
		assert.doesNotMatch(section, /findEvent|updateEvent|removeEvent|\$sviber/);
		assert.match(section, /bgNote\(location,duration=0,text=""\)/);
		assert.doesNotMatch(section, /bgNote\(location,angle/);
	}
	assert.doesNotMatch(chineseArticle, /背景音符|Tip point/);
	assert.match(chineseArticle, /墨点/);
	assert.match(chineseArticle, /游标/);
	assert.match(chineseArticle, /mainFieldPanX/);
	assert.match(chineseArticle, /mainFieldZoom/);
	assert.match(chineseArticle, /barLines/);
	assert.match(chineseArticle, /任意位置/);
});

test("help documents Lyrica, rulers, HUD pause, Channel move, and shortcut 0", async () => {
	const [en, zh, help, core, shortcuts, notes, macros] = await Promise.all([
		readFile(new URL("../json/i18n.en-US.json", import.meta.url), "utf8"),
		readFile(new URL("../json/i18n.zh-CN.json", import.meta.url), "utf8"),
		readManual(),
		readFile(new URL("../js/app/app-core.js", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-global-shortcuts.js", import.meta.url), "utf8"),
		readSources(STAGE_NOTE_MODULES),
		readFile(new URL("../js/macro/macros.js", import.meta.url), "utf8"),
	]);
	assert.match(en, /Export Lyrica chart/);
	assert.match(zh, /阳春白雪/);
	assert.match(help, /Export Lyrica/);
	assert.match(help, /more than four multi-event tip points/);
	assert.match(help, /阳春白雪/);
	assert.match(help, /超过四条多事件游标/);
	assert.match(help, /Rulers/);
	assert.match(help, /pause button/);
	assert.match(help, /<kbd>0<\/kbd>/);
	assert.match(help, /a c tx \/ b d ty/);
	assert.match(help, /type 2/);
	assert.deepEqual([...AFFINE_MATRIX_GRID], [0, 2, 4, 1, 3, 5]);
	assert.match(await readFile(new URL("../js/ui/ui-fields.js", import.meta.url), "utf8"), /AFFINE_MATRIX_GRID/);
	assert.match(await readFile(new URL("../js/ui/panels.js", import.meta.url), "utf8"), /AFFINE_MATRIX_GRID/);
	assert.match(core, /channel\.select/);
	assert.match(shortcuts, /scrollChannelsBy/);
	assert.match(notes, /_drawRulers/);
	assert.match(notes, /_drawSnappeeAttachRings/);
	assert.match(macros, /lastMacroLanguage/);
	assert.match(macros, /scope: activeList/);
});

test("help and inspector Enter apply the focused field", async () => {
	const [help, lists, zh] = await Promise.all([
		readManual(),
		readFile(new URL("../js/ui/panel-lists.js", import.meta.url), "utf8"),
		readFile(new URL("../json/i18n.zh-CN.json", import.meta.url), "utf8"),
	]);
	assert.match(help, /Show HUD/);
	assert.match(help, /Open recent/);
	assert.match(help, /Open auto-save/);
	assert.match(help, /Run macro/);
	assert.match(help, /显示 HUD/);
	assert.match(help, /打开最近文件/);
	assert.match(help, /运行宏/);
	assert.match(zh, /运行宏/);
	assert.match(lists, /event\.key === "Enter"/);
});

test("documentation and independent macro code are linked", async () => {
	const [manual, macroPage, macroCode, labels, workflows] = await Promise.all([
		readManual(),
		readFile(new URL("../macros.html", import.meta.url), "utf8"),
		readFile(new URL("../js/macro/macros.js", import.meta.url), "utf8"),
		readFile(new URL("../javascript.html", import.meta.url), "utf8"),
		readFile(new URL("../js/app/app-open-save.js", import.meta.url), "utf8"),
	]);
	assert.match(manual, /Play in reverse/);
	assert.match(manual, /宏|Macros interface/);
	// Monaco now comes up through js/macro-monaco-loader.js, which js/macros.js imports.
	const monacoLoader = await readFile(new URL("../js/macro/macro-monaco-loader.js", import.meta.url), "utf8");
	assert.match(macroCode + monacoLoader, /monaco-editor/);
	assert.match(macroPage, /F8/);
	assert.match(labels, /href="js\/macro\/macros\.js"/);
	assert.match(labels, /Monaco Editor/);
	assert.match(workflows, /if \(record\) \{\s*this\.model\.editor\.visibleRangeBeginning/);
});
