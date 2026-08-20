# sviber 0.2.2 Bugfix Notes

## Scope

This patch release keeps the v11 feature set and fixes the follow-up issues found after `v0.2.1`.

## Fixes

- Moved the seven supplied status icons into the formal `svg/icons/` asset directory and removed the duplicate `new-icons-4/` folder. NW.js staging and source checks no longer carry a special-case reference to that temporary folder.
- Localized language choices by the active interface language. English shows `English`, `Simplified Chinese`, and `Follow system`; Chinese shows `英文`, `简体中文`, and `跟随系统`. The manual applies the same labels when switching between its English and Chinese articles.
- Fixed the left editor edge toggle. Hiding Scroll View now preserves the three-column grid slot, so only the left column collapses; the Stage remains visible and expands while the right Inspector/Channels/Snappees panel stays at the right edge. The right toggle still hides only the right panel group.
- Added regression coverage for localized language values, the grid-slot-preserving CSS, and the cleaned NW.js staging configuration.

## Verification

- `npm test`: 131 tests passed.
- `npm run verify:browser`: passed, including canvas and performance checks.
- `npm run build`: passed; formal icons are present in `build/nw/package.nw/sviber/svg/icons/`, and `new-icons-4/` is absent.

## Release

Version files are `0.2.2`. The release commit and annotated tag are:

```text
fix: release sviber 0.2.2 bugfixes
v0.2.2
```
