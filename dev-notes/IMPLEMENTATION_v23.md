# v23 Implementation Record

Compared sources: `dev-notes/PROMPT-v22.md` and `dev-notes/PROMPT-v23.md`.
The complete original patch is preserved at `dev-notes/PROMPT-v22-v23.diff`.

Validation: `npm test` passed 516 tests with 0 failures (517 total, including 1 NW.js headless skip because the local NW.js launch environment is unavailable). `npm run lint` and `git diff --check` are also release gates.

## v0.14.1 Patch

The editor Preferences language selector and the manual language selector now translate all four language names using the currently active interface language. English shows English labels, Simplified Chinese shows simplified Chinese labels, Traditional Chinese shows traditional Chinese labels, and Japanese shows Japanese labels. The four i18n dictionaries and four manual UI dictionaries share the same mapping, while the legacy English manual metadata remains synchronized. The compatibility `option.language.english` and `option.language.chinese` keys are aligned with the corresponding formal language values. The preference selector continues to derive labels from `SUPPORTED_LANGUAGES`, and the manual applies `activeUi.languages` whenever the selected article changes.

Focused coverage is in `tests/language-selection-v0141.test.mjs`; the existing v23 and i18n tests were updated for the new contract. Release metadata is `0.14.1` with Service Worker cache `sviber-v01410`. Validation: `npm test` passed 519 tests with 0 failures (518 passed and 1 NW.js headless environment skip), and `npm run build` completed successfully.

## Difference Checklist

1. **Hidden-channel separator states**
   - Change: Separators for collapsed hidden channels are bright gray and thick, bright yellow when the current channel is hidden, and are also drawn at the top and bottom edges when hidden channels are just outside the visible channel window.
   - Files: `js/render/timeline-drawing.js`, `js/render/timeline.js`, `js/render/timeline-helpers.js`, `tests/channels-v22.test.mjs`, `tests/timeline-status-scroll.test.mjs`.
   - Implementation: Timeline drawing resolves original channel order, computes hidden channels between shown lanes and at viewport edges, and renders state-specific separator colors and widths.
   - Verification: Hidden-channel rendering and channel-offset tests pass.

2. **Timeline event icon color distinction**
   - Change: Remove the required external bigText SVG icon and keep event icons visually distinct from selected red and locked-selected magenta events.
   - Files: `js/render/timeline-helpers.js`, `js/render/timeline-drawing.js`, `tests/timeline-status-scroll.test.mjs`.
   - Implementation: bigText uses a local text glyph; all event colors are local constants and selected state overrides them with red or magenta.
   - Verification: Timeline icon and selection-color tests pass.

3. **Selected hidden-event separator marks**
   - Change: Selected events in visible hidden-channel separators are marked with short red or magenta time segments.
   - Files: `js/render/timeline-drawing.js`, `tests/channels-v22.test.mjs`.
   - Implementation: Separator drawing filters indexed selected records by hidden channel and maps event start time to the separator x coordinate.
   - Verification: Source wiring and timeline regression tests pass.

4. **Scrollbar note-density heatmap**
   - Change: Overview scrollbar background represents notes-per-second density for tap, drag, hold, and flick, from `#1f1f1f` to `#7f1f1f` relative to the chart.
   - Files: `js/render/timeline-helpers.js`, `js/render/timeline-drawing.js`, `tests/timeline-scrollbar-heatmap.test.mjs`.
   - Implementation: Events are binned into scrollbar pixels, converted to density, normalized against chart minimum/maximum, and painted before loop/playhead overlays.
   - Verification: Heatmap mapping test passes.

5. **Channel panel inline actions**
   - Change: Replace the popup menu with a second inline action row that is hidden until expansion; only activation and expansion controls remain on the primary row.
   - Files: `js/ui/panel-lists.js`, `css/app.css`, `js/app/app-channel-commands.js`, `js/app/app-core.js`.
   - Implementation: Inline action rows use icon-only buttons, right alignment, ARIA labels, tooltips, and an expansion callback persisted in chart state.
   - Verification: `tests/panel-inline-expansion.test.mjs` and channel panel tests pass.

6. **Snappee panel inline actions**
   - Change: Apply the same expandable inline second row to snappee items.
   - Files: `js/ui/panel-lists.js`, `css/app.css`, `js/app/app-curve-draft.js`, `js/app/app-core.js`.
   - Implementation: Snappee actions use the shared panel layout and `setSnappeeExpanded` lightweight view commit.
   - Verification: Panel expansion round-trip and panel source tests pass.

7. **Clip panel inline actions**
   - Change: Keep paste on the primary row and move other clip actions into an expandable inline row.
   - Files: `js/ui/panel-clips.js`, `css/app.css`, `js/app/app-clipboard.js`, `js/app/app-core.js`.
   - Implementation: Clip `expanded` state is normalized, rendered, toggled, and serialized; action buttons stop event propagation.
   - Verification: Clip thumbnail/action and panel expansion tests pass.

8. **Project manifest rename and migration**
   - Change: Use `project.sviber` as the primary manifest, accept legacy `sviber-project.json`, prefer the new file when both exist, and migrate/delete the legacy file on save.
   - Files: `js/core/project.js`, `js/platform/platform.js`, `js/app/app-project-files.js`, `js/cli/cli-node-io.js`, `js/cli/cli-operations.js`, manuals, `tests/project-files.test.mjs`, `tests/project-manifest-v23.test.mjs`.
   - Implementation: Ordered manifest filename constants drive desktop and CLI reads; successful saves write the new name and remove the legacy name.
   - Verification: Legacy open, priority, save migration, project round-trip, and CLI tests pass.

9. **Imported timing defaults**
   - Change: For ordinary Sunniesnow imports, default offset is the first tap/flick/hold/drag time and initial BPM is `60 / (nextTime - firstTime)`.
   - Files: `js/app/app-preferences-media.js`, `tests/import-timing-defaults-v23.test.mjs`.
   - Implementation: Numeric and rational file-format times are normalized, sorted, and used to calculate dialog defaults; fallback remains offset 0 and BPM 120 when insufficient data exists.
   - Verification: Numeric and rational timing-default tests pass.

10. **Simultaneous overlapping notes check**
    - Change: Add a check for same-position simultaneous tap/hold/flick notes, excluding drag, with `invisibleOnly` narrowing to documented invisible body overlaps.
    - Files: `js/core/checks.js`, `js/core/checks-config.js`, `tests/simultaneous-overlapping-notes.test.mjs`, `tests/checks.test.mjs`.
    - Implementation: Events are grouped by start time with floating-point tolerance, compared by position, ordered by channel and creation sequence, and reported once per pair.
    - Verification: Broad overlap, invisible-only, parameter normalization, and full checks-suite tests pass.

11. **Editor visibility fields**
    - Change: Persist `showHud`, `showBgEventsInMainField`, and `showBgEventsInTimeline` editor fields.
    - Files: `js/core/chart-vocabulary.js`, `js/core/chart-normalize.js`, `js/render/stage-core.js`, `js/render/stage-notes.js`, `js/render/stage-hud.js`, `js/render/timeline-drawing.js`, `js/render/timeline-pointer.js`, `js/app/app-status-bindings.js`, `js/app/app-status-view.js`, `tests/editor-state.test.mjs`.
    - Implementation: Defaults, normalization, UI controls, rendering filters, and HUD visibility all use the serialized fields.
    - Verification: Editor state round-trip and renderer behavior tests pass.

12. **Expanded state persistence**
    - Change: Add `expanded` to channel, snappee, and clip records.
    - Files: `js/core/chart-normalize.js`, `js/core/chart-model.js`, panel and app command files, `tests/panel-inline-expansion.test.mjs`.
    - Implementation: Normalizers default to false, constructors initialize false, and lightweight view commits serialize the toggled value.
    - Verification: Expansion state round-trip test passes.

13. **Check parameter declarations**
    - Change: Document and expose `dragScreening.seconds/distance` and `simultaneousOverlappingNotes.invisibleOnly` as check parameters.
    - Files: `js/core/checks-config.js`, `js/core/checks.js`, `json/i18n.en-US.json`, `json/i18n.zh-CN.json`, four-language dictionaries, `tests/checks.test.mjs`.
    - Implementation: Declarative definitions generate defaults and grouped dialog fields; checkbox normalization is type-aware.
    - Verification: Parameter shape and checks dialog tests pass.

14. **Four-language internationalization and manual loading**
   - Change: Support `en-US`, `zh-CN`, `zh-TW`, and `ja-JP`; use browser language with English fallback; translate language names using the active interface language; load manual article bodies dynamically.
    - Files: `js/ui/i18n.js`, `js/app/app-helpers.js`, `js/app/app-preferences-media.js`, `docs/index.html`, `docs/docs.js`, `json/i18n.*.json`, `json/manual.*.json`, `service-worker.js`, README files, i18n/manual tests.
    - Implementation: Language normalization handles Traditional Chinese and Japanese locale aliases, preference choices use all four dictionaries, and the manual loader fetches `manual.<language>.json`.
   - Verification: Four-language fallback, dictionary loading, active-language language names, localized project-manifest errors, manual, service-worker, and macro-window language tests pass. The macro window now accepts all four language values and selects the matching Monaco locale for Traditional Chinese and Japanese.

15. **NW.js file associations**
    - Change: Register `.sviber`, `.json`, and `.txt` for desktop opening; add Linux MIME/desktop metadata, macOS document metadata, and Windows Inno Setup registry entries.
    - Files: `scripts/nw-build-config.mjs`, `packaging/linux/sviber.xml`, `packaging/linux/sviber.desktop`, `packaging/macos/Info.plist`, `packaging/windows/sviber.iss`, `tests/nw-file-associations-v23.test.mjs`.
    - Implementation: Builder metadata exposes all extensions, platform packaging files define open commands and MIME/document types, and Windows uses separate ProgIDs with shell commands.
    - Verification: Association metadata test passes.

16. **ESLint line-limit clarification**
    - Change: File and function line limits exclude comments.
    - Files: `eslint.config.mjs`, `tests/eslint-comment-limits-v23.test.mjs`.
    - Implementation: `max-lines` and `max-lines-per-function` use `skipComments: true`; comments document the rule.
    - Verification: Named rule test and `npm run lint` pass.

17. **Multiple NW.js instances**
    - Change: Opening a supplied path while sviber is already running starts a new instance.
    - Files: `package.json`, `scripts/build-nw.mjs`, `tests/nw-file-associations-v23.test.mjs`, CLI/path workflow tests.
    - Implementation: Source and generated packages set `single-instance` to false while retaining `node-main` for path-aware startup.
    - Verification: Package metadata, node-main wiring, CLI, and NW.js source tests pass; live NW.js headless launch remains environment-skipped as noted above.

## Final Acceptance

- [x] Original diff preserved at `dev-notes/PROMPT-v22-v23.diff`.
- [x] All 17 diff blocks implemented and covered by focused tests.
- [x] Internal README and four manual variants updated for v23 behavior.
- [x] `npm test`: 517 total, 516 passed, 0 failed, 1 environment skip.
- [x] `npm run lint`: passed.
- [x] `git diff --check`: passed before release commit.
