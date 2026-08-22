# PROMPT v13 implementation

This release implements the additions in `PROMPT-v13.md` and the follow-up interaction/performance fixes released as `0.4.1`.

## Follow-up regressions and long-session fixes

- Selected Flick handles are now rendered for every individually selected Flick. Dragging one handle records the whole selected Flick set and applies a quantized common angle delta, preserving all relative angle differences; a single Flick keeps absolute `pi/4` snapping. The pure calculation lives in `js/render/flick-angle.js` and is covered by `tests/v12-features.test.mjs`.
- Tip-point inspector controls now hide their complete property rows when the selected spawn mode, absolute/relative position mode, or seconds/beats unit makes them inapplicable. The row-level `hidden` behavior is retained in `js/panels.js` and checked by v13 tests and browser assertions.
- Long-session playback startup is protected by a generation token. A delayed `AudioContext.resume()` cannot resurrect a stale play request after pause or replay, concurrent resumes share one Promise, and stale hit/metronome effects are ignored. `tests/audio-platform.test.mjs` covers the rapid play/pause/replay race.
- Selection, subdivision changes, Flick previews, and Pen control-point previews use the existing render index and targeted canvas redraws instead of rebuilding all indexes and panels on every pointer move. Selection caches are synchronized incrementally through `ChartRenderIndex.syncSelection()`.
- Snappees panel rerenders preserve both scroll offsets, so toggling, reordering, editing, or other actions no longer jump the panel to its top.

## v0.4.1 regression fixes

- Ruby macros now pass wasm bytes to the sandbox and compile them inside the iframe realm. This avoids cross-realm `WebAssembly.Module` initialization hangs, so a minimal `puts "hello world"` macro completes and applies normally. The runtime loader and wasm fallback URLs use the matching `@ruby/3.4-wasm-wasi@2.7.2` package in both local and hosted builds.
- Added a toolbar separator immediately before `events.bpmChange` so the timing action is visually separated from background-event tools.
- Increased the reset-main-field button's border, text weight, background contrast, hover state, and keyboard focus outline.
- Timeline `Ctrl+Shift+wheel` now calls the main-field zoom callback and leaves the timeline visible range unchanged; ordinary `Ctrl+wheel` retains timeline range zooming.
- Added unit/static assertions and browser checks for all four regressions, including a real Ruby macro execution and UI state checks.

## Packaging and release infrastructure

- Added `default.nix` and `flake.nix` for a `nixos-unstable` Nix package built through `callPackage`.
- Added `json/font-assets.json`; `scripts/build-nw.mjs` reads the shared font URL/hash manifest for offline NW.js packaging.
- Kept generated NW.js output, icons, and downloaded assets ignored. The existing test, package, and release workflows remain separate and publish Windows, Linux, macOS, and runtime-free artifacts on version tags.

## Timeline, timing, and navigation

- `js/core/timing.js` now normalizes, serializes, inserts, removes, and searches bar lines. Beat-line generation and snapping are relative to the latest bar line, with rational labels and bar-line emphasis.
- `js/render/timeline.js` and `js/render/timeline-helpers.js` choose labeled/color-coded lines relative to the latest bar line while displaying the absolute beat `t`, as required by the prompt. `js/audio/scheduler.js` schedules the metronome on bar-relative integer beats.
- `timing.barLine` (`R`) and `transform.timeDilation` were added to `js/commands.js`, with UI dialogs and undoable model changes in the app command modules.
- Timeline and scroll-view Ctrl+Space panning, main-field Ctrl+Space panning, Ctrl+Shift zooming, reset-view control, and progress-bar seeking are wired through `js/render/*`, `js/app-view-controls.js`, and `js/app-core.js`.

## Visibility, groups, and editing

- Added persisted `showBgEventsInTimeline`, `showBgEventsInMainField`, `mainFieldPanX`, `mainFieldPanY`, and `mainFieldZoom` editor fields in `ChartModel`.
- Added background-event icon assets and localized status controls. Group position editing translates descendants, group rings are larger than event icons, and inactive tip-point inputs are hidden instead of disabled.
- Clipboard copying unwraps events temporarily entered from groups and keeps relative timing/channel information.

## File workflows and feedback

- Save, save-as, project save, level export, clipboard, media loading, autosave, and live-hosting paths now report completion and failures through the stacked Toast manager. Live-hosting startup reports host, HTTP port, and reload port.
- Autosave recovery offers all newer records and falls back to the last opened project/chart when recovery is declined. Autosaves omit generated Sunniesnow top-level events; normal saves retain them.
- Timing serialization now includes `barLines`; editor serialization includes the new view fields.

## Macro API

- `js/macro-api.js` and `js/macro-api.rb` were aligned directly to the API overview in `PROMPT-v13.md`. Macro code receives the prompt-defined top-level classes and helpers only; the former `api`, `state`, raw `chart`, `$sviber`, CRUD, and selection-helper interfaces are neither injected nor documented. Internal factory state is kept outside the macro argument list.
- Both languages expose the static `Chart` facade; `Vector2D`; six-accessor `AffineMatrix2D`; `Location`; `TipPoint`; `BpmChange`; `BarLine`; `Channel`; `Snappee` and the seven named subclasses listed by the prompt; typed `Event` wrappers; `Clip`; and every prompt helper from `b`/`b!` through `copy` and `transform`. JavaScript uses the documented camelCase mapping, including `bBang`, while Ruby uses the prompt's snake_case and predicate conventions.
- Beat inputs follow the prompt rather than the former permissive API: Ruby public beat arguments accept only `Integer` or `Rational`; JavaScript accepts a finite number, a two-integer rational tuple, or a three-integer file-format tuple and quantizes numbers with a fixed maximum denominator. Missing arguments, `null`, arbitrary beat objects, and Ruby arrays are rejected instead of treated as compatibility forms.
- JavaScript event types accept the prompt's camelCase names only, and `AffineMatrix2D` uses six scalar constructor arguments rather than the former single-array convenience form. Ruby keeps its prompt-defined snake_case symbol conversion independently.
- Direction names now use chart coordinates exactly: right is `0`, up is `pi/2`, left is `pi`, and down is `-pi/2`; long diagonal names in either word order and their two-letter aliases map consistently in JavaScript and Ruby. Hex integers and CSS color strings are normalized by the same public color-taking entry points.
- Direction-name normalization also covers the angle arguments of `RadialMesh` and `RegularPolygonCurve`. Ruby evaluates parametric mesh/curve expressions through a restricted math-expression parser, while JavaScript uses the loaded math.js evaluator; `pos` and nearest-point enumeration honor inclusive/exclusive parameter ranges and closed curves.
- `Location` strictly implements `(x,y)`, `(curve,i)`, and `(mesh,i,j)`. Assigning a snappee attaches to that snappee's nearest point, assigning `nil`/`null` detaches, coordinate setters detach, and `attach` searches only active snappees. Channel lookup is 1-based, snappee lookup is 0-based, and negative collection indexes return no object instead of using Ruby's negative-index semantics. The former mesh-array constructor form is not retained.
- `TipPoint.chain`/`drop` use the prompt keyword/options structure and enforce absolute-vs-relative and seconds-vs-beats exclusivity. The positional `(distance,angle,time)` and `(location,time)` forms exist only on `tpc`/`tpd`, as specified.
- Event construction and type conversion enforce the prompt's type-dependent fields and wrapper subclasses. Channel collections exclude group descendants, direct `Group` construction removes its children from the top-level event list, group location/time setters translate all descendants, group anchors move independently, and deleting a wrapper invalidates later operations through the same underlying record.
- `Clip.new` now stores the same versioned, relative time/channel data shape as the event clipboard, including referenced channels and snappees. `Clip#paste` and `copy(events)` return newly typed event wrappers and map channels by panel order rather than assuming contiguous IDs.
- `transform` accepts only an `AffineMatrix2D` or the prompt callback/block form and only event arrays or snappee arrays. It transforms event/group locations, snappee matrices, flick directions, and both absolute and relative chain/drop spawn geometry without applying chart-boundary checks.
- `docs/index.html` has complete parallel English and Chinese API sections with exact class members, constructor/helper signatures, JS/Ruby name mappings, direction values, exclusivity rules, deletion behavior, and full examples. Regression assertions reject descriptions of the former container/CRUD API.
- Ruby browser execution keeps `json` and `base64` loaded in the sandbox API. Wasm bytes are compiled inside the iframe realm, and the browser regression now fails immediately on macro-console errors; this covers both the original cross-realm timeout and the later missing-`Base64` failure found during release verification.
- The saved/editor runtime now uses only the prompt field `allowOutOfBound`; the old `allowOutOfBounds` import/runtime mirror was removed instead of being retained as a compatibility path.

## Documentation and localization

- Reduced both READMEs to installation, build/development, contribution, and license material, with the help manual as the sole user/API guide. Updated parallel English/Chinese help text, command tables, terminology (`bgNote` as `墨点`, tip points as `游标`), release metadata, and version assertions.

## Verification

- `npm test`: 170 tests passed.
- `node scripts/check-source-size.mjs`: passed.
- `npm run build`: generated `build/sviber-0.4.1.nw` and the NW.js desktop directory.
- `node --check js/macro-api.js` and `ruby -c js/macro-api.rb`: passed.
- `ruby tests/ruby-macro-smoke.rb`: passed (including direction-bearing snappees, parametric expressions, rational timing, grouping, `b`/`b!`, and TipPoint checks).
- `npm run verify:browser`: passed, including real JS/Ruby macro application, Ruby `hello world` console forwarding, 100k-event playback/editing benchmarks, interaction checks, and nonblank canvas summaries.
- Final v11/v12 and v12/v13 audits were rerun with `git diff --no-index --unified=0`: all low-level hunks were reviewed line by line, including the previously omitted multi-selected Flick rotation and hidden tip-point inspector rows. Each changed requirement was mapped to implementation and regression/browser evidence before release tagging.

## Final diff audit checklist

The final `git diff --no-index --unified=0 PROMPT-v12.md PROMPT-v13.md` review found 41 low-level hunks (grouped into the logical areas below). Each added or modified line was checked against the implementation and a regression or browser verification path:

| Diff area | Implemented in | Verification |
| --- | --- | --- |
| Nix package, flake, shared font hashes | `default.nix`, `flake.nix`, `json/font-assets.json`, `scripts/build-nw.mjs` | v13 package test and `npm run build` |
| Bar-relative waveform label selection with absolute beat text | `js/core/timing.js`, `js/render/timeline.js` | bar-line timing test and browser assertions |
| Group ring sizing | `js/render/timeline.js`, `js/render/scroll-view.js`, stage renderers | browser canvas checks |
| Bar-relative line colors, thick bar lines, snapping | `TimingMap`, timeline/scroll renderers | timing test and browser verification |
| Timeline Ctrl+Space pan | timeline interaction handlers | browser drag benchmark |
| Background-event status toggles/icons | model, `index.html`, `css/app.css`, i18n, renderers | round-trip test and browser verification |
| Main-field pan/zoom/reset | `js/app-view-controls.js`, stage interaction/render code | browser interaction and canvas checks |
| Progress-bar seek and range-follow policy | stage interaction and view controls | browser interaction checks |
| Scroll-view red labels and Ctrl+Space pan | `js/render/scroll-view.js` | browser interaction checks |
| Toast behavior | `ToastManager` call sites in file/media/autosave/live-hosting workflows | full test suite and browser run |
| Rational import wording/behavior | `ChartModel` Sunniesnow import and `TimingMap` | core import tests |
| Async file-operation messages | `js/app-file-workflows.js` | full test suite |
| Clipboard handling for temporary group entry | event clipboard normalization | clipboard regression tests |
| Bar line menu/shortcut and format | `js/commands.js`, timing model, i18n | v13 command/timing tests |
| Time dilation dialog and formulas | `js/app-view-controls.js` | command registration and full tests |
| Group position inspector translation | `js/panels.js`, `js/app-event-editing.js` | group transform tests |
| Hidden inactive tip-point controls | `setControlHidden` in `js/panels.js` | browser interaction assertions |
| Live-hosting lifecycle Toasts | `setLiveHosting` and localization | browser macro/live checks |
| Complete JS/Ruby macro API and external sandbox files | `js/macro-api.js`, `js/macro-api.rb`, `macro-sandbox.html`, `tests/ruby-macro-smoke.rb` | syntax checks, macro wrapper/geometry tests, Ruby smoke test, browser macro execution |
| New editor/timing JSON fields | `ChartModel` and `TimingMap` serialization | round-trip tests |
| Chinese terminology | i18n dictionaries and manual | localization tests |
| Autosave rejection fallback | `App._offerAutosave`, `AutosaveManager` | browser startup recovery check |
| Version/release rules and README guidance | `package.json`, README files, workflows | package/version tests and release metadata checks |

No changed hunk remained without an implementation, documentation entry, or verification reference.
