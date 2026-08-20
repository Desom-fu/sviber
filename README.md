# sviber

[简体中文](README.zh-CN.md)

sviber is a browser and NW.js chart editor for [Sunniesnow](https://sunniesnow.github.io/game-unstable). It edits tap, hold, drag, flick, background-note, big-text, and background-pattern events, with beat-based timing, tip points, reusable snappees, history, waveform navigation, and Sunniesnow-compatible preview rendering.

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

On Windows, launch `build/nw/sviber.exe`. The first build needs network access to obtain NW.js and pinned font assets. The completed application uses local npm dependencies and bundled fonts, so it runs offline. The package includes the repository and bundled-font license files. Distribute the complete `build/nw` directory; the development-only `sviber/node_modules` directory is not needed. Do not remove `build/nw/package.nw/sviber/node_modules`, and keep the executable and every neighboring runtime file together.

## Project workflow

1. Choose **File > New project...** and enter the first difficulty's metadata, beat-zero audio time (Offset), and initial BPM. The new project initially exists in memory; the first **File > Save project** asks you to select its project folder. Later saves write back to that folder.
2. Use **File > Set music...** and **Set background...** to load the music and optional cover/background shared by every difficulty. Saving copies those assets into the project-folder root.
3. Use the difficulty selector at the top to choose the difficulty being edited. Use **File > New chart...** to create another difficulty and **File > Delete chart...** to delete the current one. The selector itself is a drop-down with no extra action buttons. Each difficulty has its own undo/redo history, which is restored when you switch back to it; a project must retain at least one difficulty.
4. Navigate with the waveform, mouse wheel, and green/yellow timeline controls. Double-click a purple BPM label to edit it. Use the Scroll view at the left to inspect event time/x relationships without changing chart data; the side-edge buttons can hide either auxiliary view when more editor width is needed.
5. With no selected non-pattern event, select an event tool and click the stage to place notes. When events are selected, choosing an event tool converts their event type.
6. Create meshes or curves from **Snappee**, activate them, and use **Attach** to bind selected positioned events to their nearest valid points.
7. Edit shared or type-specific values in the Inspector. Use the timeline for beat/channel movement and the stage for spatial movement.
8. Notes use Sunniesnow's default visual sizes and automatically scale with the stage. Positioned events are kept inside `x = -100..100`, `y = -50..50` by default, including pasted notes and notes moved indirectly by editing a snappee. Enable **Transform > Allow out-of-bounds notes** to create, paste, drag, edit, transform, or attach notes beyond that boundary; the boundary remains visible as a reference.
9. Press Space to preview playback with Sunniesnow-style note sounds, hit effects, event visuals, tip points, and HUD. The optional metronome is a constant synthesized click on every beat, with no strong/weak beat accents; its level follows the Preferences SE volume.
10. Choose **File > Save project** to save the manifest, shared media, and every editable difficulty JSON. Choose **File > Export Sunniesnow level...** to package all difficulties into one `.ssc` file; project music is required for export.

To migrate an older file, choose **File > Import chart/level file...** and select a legacy Sviber JSON, plain Sunniesnow JSON, or `.ssc`. For an `.ssc`, choose one chart, music file, and image from the archive. The result is imported as one difficulty in the current project; use **Save project** afterward to place it in a project folder.

The timeline supports rectangular selection, `Ctrl` to add or copy while dragging, `Alt` to remove, and `Shift` for time/channel range selection. The stage uses the same selection modifiers. Most creation and editing commands are intentionally locked during playback; Music commands remain available.

The visible timeline range is part of the editable chart state and is restored when a saved chart is opened. `Ctrl`+wheel zooms the range, `Shift`+wheel scrolls channel lanes, and `PageUp`/`PageDown` pages the range. With **Lock visible range** enabled, playback and ordinary seeking do not move it, while the scrollbar, `Ctrl`+wheel, and range keyboard commands remain available. Holding `Shift` while dragging an event keeps the last selected event as the move context and does not retarget another event under the pointer.

To connect multiple notes with one Sunniesnow tip point, select at least two consecutive notes in the same channel and choose **Chain** in the Inspector. Sviber marks the first note as the chain start, makes the remaining selected notes inherit that path, and stops the path before the next unselected note.

## Useful shortcuts

| Action | Shortcut |
| --- | --- |
| New project / Open project folder / Save project / Export level | `Ctrl+Shift+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Y` |
| Cut / Copy / Paste / Paste with duplicated snappees | `Ctrl+X` / `Ctrl+C` / `Ctrl+V` / `Ctrl+Shift+V` |
| Select all / channel / none / by filter | `Ctrl+A` / `Ctrl+Shift+A` / `Ctrl+D` / `Ctrl+F` |
| Tap / Hold / Drag / Flick / Bg note / Bg pattern | `T` / `H` / `D` / `F` / `B` / `P` |
| Create channel above / below | `Insert` / `Shift+Insert` |
| Bezier curve / Pen | `Ctrl+B` / `Ctrl+P` |
| Attach / Detach | `S` / `Shift+S` |
| Free transform | `Ctrl+T`, then `Enter` to apply or `Esc` to cancel |
| Play or pause / Seek to start | `Space` / `Home` |
| Subdivision | `1`, `2`, `3`, `4`, `6`, or `8` |
| Move selected events | Arrow keys; hold `Shift` for 12.5 units |

Every menu mnemonic and command shortcut is also shown in the interface. `Esc` exits event, curve, snappee-handle, or transform modes as appropriate.

The **Snappee > Preset snappee...** command adds the playfield grid, turntable, four hexagons, or pentagon with localized names. Snap-point matching uses a chart-coordinate distance of 6.125. A point outside the chart boundary is rejected; only a mathematically boundary point that misses by tiny floating-point round-off receives a minimal tolerance.

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
- The out-of-bounds setting is stored per difficulty as `sviber.editor.allowOutOfBounds`. Toggling it is undoable and marks that difficulty as changed.
- An exported `.ssc` is a ZIP archive for Sunniesnow, not a copy of the editable project. Its root contains the shared music, optional cover/background, and one pure Sunniesnow Chart 1.0 JSON file per difficulty. It contains neither `sviber-project.json` nor the top-level `sviber` extension. All exported entries are at archive root because the target Sunniesnow build discovers level music, images, and difficulty JSON there.
- Export writes the supported Sunniesnow Chart 1.0 fields without enforcing the external JSON Schema. Empty optional metadata such as artist or charter is preserved; unsupported editor-only data is not written to the formal chart JSON.

The editor automatically records the active dirty difficulty in `localStorage` every 120 seconds by default. **File > Preferences...** changes the interval; `0` disables autosave. If an autosave is newer than the last manual save, recovery is offered on the next launch, and older recovery records are retained until storage pressure requires eviction. Autosaves omit the generated top-level `events` list for speed and space; ordinary saves retain it. The interface follows the browser language: Chinese locales use `zh-CN`; all others use `en-US`. The English interface labels the language choices **English** and **Simplified Chinese**; the Chinese interface labels them **英文** and **简体中文**. The editor, macro page, and manual share the saved explicit light/dark theme; System follows the operating-system preference.

The status panel uses icon-only controls for visible-range locking, note SE, seek-back, the constant-strength metronome, read-only mode, and fullscreen. Read-only mode keeps selection, seeking, range navigation, Music commands, and comment editing available while blocking chart, snappee, channel, macro, and history mutations. `F11` toggles fullscreen even when a form is open; `Esc` does not exit it. The difficulty selector keeps global number and Space shortcuts active while focused. Tip-point lines are drawn only between adjacent events that are actually visible in the same guide, and the Scroll view uses the timeline's time scale. The web editor can be installed as a PWA and its service worker caches both JSON translation files.

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
