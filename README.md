# sviber

[简体中文](README.zh-CN.md)

sviber is a browser and NW.js chart editor for [Sunniesnow](https://sunniesnow.github.io/game-unstable). It edits tap, hold, drag, flick, background-note, big-text, background-pattern, and nested group events, with beat-based timing, tip points, reusable snappees, clips, history, waveform navigation, live hosting, and Sunniesnow-compatible preview rendering.

## Run in a browser

Requirements: a current Node.js release with npm and a modern browser. The complete project-folder workflow requires a Chromium-based browser with the File System Access API; use the NW.js desktop app when that API is unavailable.

```powershell
cd sviber
npm ci
npm start
```

Open <http://127.0.0.1:4173/sviber/>. Do not open `index.html` directly: JavaScript modules, dependency loading, and the service worker require an HTTP origin.

The first web visit must be online so the service worker can cache sviber, its fonts, and CDN dependencies. After installation finishes, later visits can work offline. Clipboard import/export requires clipboard permission. Opening and saving a project requires permission to read and write its selected folder.

## Build the desktop app

```powershell
cd sviber
npm ci
npm run build
```

On Windows, launch `build/nw/sviber.exe`. The build also generates `icon.ico` and `icon.png` from `svg/icon.svg` in the source directory so `nw .` can use the window icon; both generated files are ignored by Git. The first build needs network access to obtain NW.js and pinned font assets. The completed application uses local npm dependencies and bundled fonts, so it runs offline. The package includes the repository and bundled-font license files. Distribute the complete `build/nw` directory; the development-only `sviber/node_modules` directory is not needed. Do not remove `build/nw/package.nw/sviber/node_modules`, and keep the executable and every neighboring runtime file together.

## Project workflow

1. Choose **File > New project...** and enter the first difficulty's metadata, beat-zero audio time (Offset), and initial BPM. The new project initially exists in memory; the first **File > Save project** asks you to select its project folder. Later saves write back to that folder.
2. Use **File > Set music...** and **Set background...** to load the music and optional cover/background shared by every difficulty. Saving copies those assets into the project-folder root.
3. Use the difficulty selector at the top to choose the difficulty being edited. Use **File > New chart...** to create another difficulty and **File > Delete chart...** to delete the current one. The selector itself is a drop-down with no extra action buttons. Each difficulty has its own undo/redo history, which is restored when you switch back to it; a project must retain at least one difficulty.
4. Navigate with the waveform, mouse wheel, and green/yellow timeline controls. Double-click a purple BPM label to edit it. Use the Scroll view at the left to inspect event time/x relationships without changing chart data; the side-edge buttons can hide either auxiliary view when more editor width is needed.
5. With no selected non-pattern event, select an event tool and click the stage to place notes. When events are selected, choosing an event tool converts their event type.
6. Create meshes or curves from **Snappee**, activate them, and use **Attach** to bind selected positioned events to their nearest valid points.
7. Edit shared or type-specific values in the Inspector. Use the timeline for beat/channel movement and the stage for spatial movement.
8. Notes use Sunniesnow's default visual sizes and automatically scale with the stage. Positioned events are kept inside `x = -100..100`, `y = -50..50` by default, including pasted notes and notes moved indirectly by editing a snappee. Enable the **Allow out-of-bound** status control to create, paste, drag, edit, transform, or attach notes beyond that boundary; the boundary remains visible as a reference.
9. Press Space to preview playback with Sunniesnow-style note sounds, hit effects, event visuals, tip points, and HUD. The optional metronome is a constant synthesized click on every beat, with no strong/weak beat accents; its level follows the Preferences SE volume.
10. Choose **File > Save project** to save the manifest, shared media, and every editable difficulty JSON. Choose **File > Export Sunniesnow level...** to package all difficulties into one `.ssc` file; project music is required for export.

To migrate an older file, choose **File > Import chart/level file...** and select a legacy Sviber JSON, plain Sunniesnow JSON, or `.ssc`. For an `.ssc`, choose one chart, music file, and image from the archive. The result is imported as one difficulty in the current project; use **Save project** afterward to place it in a project folder.

The timeline supports rectangular selection, a second ordinary click on a selected event to clear it, `Ctrl` to add or copy while dragging, `Alt` to remove, and `Shift` for time/channel range selection. The stage and Scroll view use the same click-toggle and selection modifiers. Repeating the active Tap/Hold/Drag/Flick/Bg note toolbar command exits that creation mode. Most creation and editing commands are intentionally locked during playback; Music commands remain available.

The visible timeline range is part of the editable chart state and is restored when a saved chart is opened. `Ctrl`+wheel zooms the range, `Shift`+wheel scrolls channel lanes, and `PageUp`/`PageDown` pages the range. With **Lock visible range** enabled, playback and ordinary seeking do not move it, while the scrollbar, `Ctrl`+wheel, and range keyboard commands remain available. Holding `Shift` while dragging an event keeps the last selected event as the move context and does not retarget another event under the pointer.

Stage and timeline pointer dragging are coalesced to animation frames. Drag previews update only the render surfaces and status, use incremental position/time deltas where possible, and defer panels, history, and other full-document work until the gesture ends. The browser regression covers real stage and timeline drags and checks 60 Hz frame pacing.

To connect multiple notes with one Sunniesnow tip point, select at least two consecutive notes in the same channel and choose **Chain** in the Inspector. Sviber marks the first note as the chain start, makes the remaining selected notes inherit that path, and stops the path before the next unselected note.

## v12 editing workflows

Groups are recursive editor-only containers. **Events > Group** detaches selected events and creates a colored group anchor at their geometric center; selecting a group selects its descendants for movement, transforms, deletion, channel movement, and Sunniesnow export. **Free transform** includes the group anchor, every direct or indirect child, and any snappee referenced by an attached child. An attached group remains movable when it is the only selected root. **Events > Ungroup** restores the selected group's children at the same level. Nested groups keep independent IDs and bounds. A normal click on a grouped event selects the nearest containing group, and a second click clears that group selection. Double-click enters one group level temporarily, so nested groups are entered from the outside in; the temporary scope ends when it has no selected descendants. Drag the crosshair anchor to move selected group anchors while keeping their children in place. Anchors can snap to direct children or active snappees.

The timeline, stage, and Scroll view draw grouping rings; root selected groups draw a colored bounding rectangle. A selected group's anchor appears only in the main editor field, never in the timeline or Scroll view. A group stores no `time` or `channel`; its displayed time is derived from its earliest descendant. The status panel can independently hide timeline rings, stage rings, and tip points. These display settings are stored in the editable chart and do not change generated Sunniesnow events, which flatten groups recursively.

Copying selected events stores relative beat/channel data, channel attributes, referenced snappees, and nested group trees. **Edit > Save to clips** stores the same data in the chart's Clips panel. A clip can be renamed, reordered, deleted, or pasted at the current beat and channel. **Edit > Paste with options...** can duplicate the referenced channels and/or snappees; nested group references are remapped recursively. Ordinary paste keeps existing channel and snappee references when possible.

The **Timing** menu edits the offset and initial BPM, and copies or pastes the complete timing map as JSON. Timing changes remain separate from event clipboard data. Event clipboard data includes relative events plus the channel and snappee records needed by **Paste with options**. The timeline channel scrollbar position is stored in `sviber.editor.timelineChannelOffset` and restored when the chart is loaded. When live hosting is enabled in NW.js, `http://host:port/sviber.ssc` serves an in-memory level archive and the optional sscharter WebSocket port sends `connect`, `update`, and `chartUpdate` messages. Live exports include `sscharter.version = "0.10.1"`; browser builds disable the server controls.

## Useful shortcuts

| Action | Shortcut |
| --- | --- |
| New project / Open project folder / Save project / Export level | `Ctrl+Shift+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Y` |
| Cut / Copy / Paste / Paste options | `Ctrl+X` / `Ctrl+C` / `Ctrl+V` / `Ctrl+Shift+V` |
| Save selected events to clips | — |
| Group / Ungroup | `Ctrl+G` / `Ctrl+Shift+G` |
| Timing menu | Offset/BPM, copy timing, paste timing |
| Select all / channel / none / by filter | `Ctrl+A` / `Ctrl+Shift+A` / `Ctrl+D` / `Ctrl+F` |
| Tap / Hold / Drag / Flick / Bg note / Bg pattern | `T` / `H` / `D` / `F` / `B` / `P` |
| Create channel above / below | `Insert` / `Shift+Insert` |
| Bézier curve / Pen | `Ctrl+B` / `Ctrl+P` |
| Attach / Detach | `S` / `Shift+S` |
| Free transform | `Ctrl+T`, then `Enter` to apply or `Esc` to cancel |
| Play or pause / Seek to start | `Space` / `Home` |
| Subdivision | `1`, `2`, `3`, `4`, `6`, or `8` |
| Move selected events | Arrow keys; hold `Shift` for 12.5 units |

Every menu mnemonic and command shortcut is also shown in the interface. Timing uses `Alt+T` and Transform uses `Alt+R`. The Keyboard shortcuts dialog groups commands by menu, places the key on the left of each row, uses two independent columns on wide windows, and switches to one vertically scrolling column on narrow windows. Hovering a row shows its full command description in the tooltip bar. `Esc` exits event, curve, snappee-handle, or transform modes as appropriate.

Free transform cannot start with zero-width or zero-height bounds for an ordinary event selection. A selected group uses a one-unit minimum fallback for a zero-width or zero-height axis, so a line-shaped group can still rotate, scale, and translate. Its crosshair anchor starts at the bounds center and can snap to transformed events, bounds corners or edge centers, the bounds center, active snappee points, or a free position. Content anchors follow transforms; free and snappee anchors stay fixed. Hold `Ctrl` while corner-scaling to preserve aspect ratio, `Shift` while scaling from a corner or edge to use the anchor as the fixed point, or `Ctrl` while rotating to snap to integer multiples of `pi/4`. Four edge handles complement the corner handles.

The **Snappee > Preset snappee...** command adds the Playfield grid, Radial grid, Outer/Middle/Smallest/Inner hexagons, or Pentagon with localized names. Snap-point matching uses a chart-coordinate distance of 6.25. A point outside the chart boundary is rejected; only a mathematically boundary point that misses by tiny floating-point round-off receives a minimal tolerance.

## Project folder and level format

A saved project is a folder with a flat root layout. Asset names and difficulty filenames may differ, but the structure is:

```text
My Project/
|-- sviber-project.json
|-- song.ogg
|-- cover.png
|-- easy.json
`-- master.json
```

- `sviber-project.json` is the project manifest. It identifies the shared music, optional cover/background, all difficulty JSON files, and the active difficulty. **File > Open project folder...** reads this manifest and automatically loads every listed difficulty plus the shared media.
- Song title, artist, music, and cover/background are project-wide fields. Difficulty name, color, rating, charter, timing, events, and undo/redo history remain independent per difficulty.
- Every difficulty JSON in the project root is an editable sviber document. It extends Sunniesnow Chart 1.0 with a top-level `sviber` object containing authoring data such as beat timing, channels, snappees, and editor settings. The top-level `events` array is regenerated for compatibility, but reopening the project uses the editable data inside `sviber`.
- Editable `sviber` data may contain recursive `group` events and a `clips` array. A group has position/attachment data, color, and recursive children, but no stored `time` or `channel`; its time is derived from its earliest descendant. Group children retain stable recursive IDs; generated Sunniesnow JSON recursively flattens them. Clips contain relative event trees plus the channel and snappee records needed by the paste-options workflow.
- The out-of-bounds setting is stored per difficulty as `sviber.editor.allowOutOfBound`. Toggling it is undoable and marks that difficulty as changed. The legacy `allowOutOfBounds` spelling is accepted when importing older charts.
- An exported `.ssc` is a ZIP archive for Sunniesnow, not a copy of the editable project. Its root contains the shared music, optional cover/background, and one pure Sunniesnow Chart 1.0 JSON file per difficulty. It contains neither `sviber-project.json` nor the top-level `sviber` extension. All exported entries are at archive root because the target Sunniesnow build discovers level music, images, and difficulty JSON there.
- Export writes the supported Sunniesnow Chart 1.0 fields without enforcing the external JSON Schema. Empty optional metadata such as artist or charter is preserved; unsupported editor-only data is not written to the formal chart JSON.

The editor automatically records the active dirty difficulty in `localStorage` every 120 seconds by default. **File > Preferences...** changes the interval; `0` disables autosave. If an autosave is newer than the last manual save, recovery is offered on the next launch, and older recovery records are retained until storage pressure requires eviction. In NW.js, recovery also restores the local chart/project source context and automatically reloads relative music and background references. Autosaves omit the generated top-level `events` list for speed and space; ordinary saves retain it. The interface follows the browser language: Chinese locales use `zh-CN`; all others use `en-US`. Existing history labels, including Group/Ungroup, are translated again when the language changes. The English interface labels the language choices **English** and **Simplified Chinese**; the Chinese interface labels them **英文** and **简体中文**. The editor, macro page, and manual share the saved explicit light/dark theme; System follows the operating-system preference.

The status panel uses icon-only controls for visible-range locking, note SE, seek-back, the constant-strength metronome, read-only mode, and fullscreen. Read-only mode keeps selection, seeking, range navigation, Music commands, comment editing, difficulty selection, and channel/snappee activation available while blocking other chart, snappee, channel, macro, and history mutations. `F11` toggles fullscreen even when a form is open; `Esc` does not exit it. The difficulty selector keeps global number and Space shortcuts active while focused. Tip-point lines are drawn only between adjacent events that are actually visible in the same guide, and the Scroll view uses the timeline's time scale. The web editor can be installed as a PWA and its service worker caches both JSON translation files.

## Macros and release packages

The separate **Macros** window supports JavaScript and Ruby global macros. In NW.js, project macros are `.js` or `.rb` files in the project folder. Both APIs expose metadata, editor state, timing, channels, events, snappees, selection, and find/update/remove helpers. JavaScript console output and Ruby `$stdout`/`$stderr` (including `puts`, `print`, and `warn`) are shown in the macro console; a successful run is applied as one undoable chart edit.

Release builds are architecture-specific: Windows provides x86, x86_64, and aarch64 ZIP archives; macOS provides x86_64 and aarch64 ZIP archives; Linux provides x86_64 and aarch64 `tar.gz` archives. A runtime-free `.nw` package is also produced.

## Sharing source or desktop builds

When sharing the development source, you may delete `sviber/node_modules`; the recipient restores the pinned dependencies from `package-lock.json` by running `npm ci` inside `sviber`. Do not remove `build/nw/package.nw/sviber/node_modules` from an already built desktop package. Distribute the complete `build/nw` directory, including `sviber.exe` and all neighboring runtime files.

## Development checks

```powershell
npm test
npm run verify:browser
npm run build
```

`verify:browser` uses `http://127.0.0.1:4173/sviber/` by default and starts a temporary local server when that URL is unavailable; set `SVIBER_BASE_URL` to override it. It checks Chinese and English UI, light and dark themes, the 960x620 minimum window, responsive Sunniesnow note sizing, bounded and out-of-bounds editing paths, real pointer interactions, nonblank canvases, and an offline reload.

The repository is covered by its root license. Third-party JavaScript packages and fonts retain their own licenses; the desktop build includes the downloaded font license files.
