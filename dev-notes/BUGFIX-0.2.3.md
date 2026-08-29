# sviber 0.2.3 Bugfix Notes

## Scope

This patch release keeps the v11 feature set and fixes whole-snappee alignment when moving copied Pen curves and other snappees.

## Fixes

- Whole-snappee dragging now checks every snap point on the moved snappee and aligns the closest one to a nearby point on another active snappee.
- The moved snappee is excluded from its own alignment targets, inactive snappees remain ignored, and the existing 9-pixel Stage snap threshold is preserved.
- Preview movement and committed movement use the same alignment calculation, while existing chart-bound clamping, event snapping, and individual control-point snapping remain unchanged.
- Clarified in both manual languages that an open Pen or Bezier curve's segment count describes intervals: an open three-segment curve has four snap-point vertices, while a closed three-segment curve has three.
- Added regression coverage for open-curve vertex counts, whole-snappee alignment to a rectangular mesh, and movement outside the snap threshold.

## Verification

- `npm test`: 132 tests passed.
- `npm run verify:browser`: passed, including 100,000-event performance, macro, and canvas-pixel checks.
- `npm run build`: passed; generated `build/sviber-0.2.3.nw` and the local Windows x64 NW.js application.
- `git diff --check`: passed.

## Release

Version files are `0.2.3`. The release commit and annotated tag are:

```text
fix: release sviber 0.2.3 bugfixes
v0.2.3
```
