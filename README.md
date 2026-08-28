# sviber

[简体中文](README.zh-CN.md)

sviber is a browser and NW.js chart editor for [Sunniesnow](https://sunniesnow.github.io/game-unstable).

The [help manual](docs/index.html) is the authoritative user guide, including the current JavaScript and Ruby macro APIs and keyboard shortcuts. This README is limited to installation, development, contribution, and license information.

## Install a release

Download the appropriate archive from [GitHub Releases](https://github.com/Desom-fu/sviber/releases), extract the complete archive, and run the included sviber executable. Keep the executable and all neighboring runtime files together.

Release builds are architecture-specific: Windows provides x86, x86_64, and aarch64 ZIP archives; macOS provides x86_64 and aarch64 DMG images; Linux provides x86_64 and aarch64 `tar.gz` archives. A runtime-free `.nw` package is also available for an existing NW.js installation.

## Run from source in a browser

Requirements: a current Node.js release with npm and a modern browser. The web build edits one standalone chart at a time; project folders are supported only by the NW.js desktop app.

```powershell
git clone https://github.com/Desom-fu/sviber.git
cd sviber
npm ci
npm start
```

Open <http://127.0.0.1:4173/sviber/>. Do not open `index.html` directly because JavaScript modules, dependency loading, and the service worker require an HTTP origin. The first visit needs network access to cache dependencies and fonts; later visits can run offline.

## Build the desktop app

```powershell
cd sviber
npm ci
npm run build
```

The first build needs network access to obtain NW.js and the pinned font assets. On Windows, launch `build/nw/sviber.exe`. Distribute the complete `build/nw` directory; do not remove `build/nw/package.nw/sviber/node_modules` or any runtime file next to the executable. Generated build output and icons are ignored by Git.

## Install with Nix

On x86_64 or aarch64 Linux with flakes enabled:

```sh
nix build
./result/bin/sviber
```

The flake uses `nixos-unstable`; `default.nix` is also usable through `callPackage`.

## Development checks

```powershell
npm test
npm run verify:browser
npm run build
```

`npm run verify:browser` starts its own local server and runs the end-to-end browser suite. The build includes the application license and the licenses for bundled fonts.

## Contributing

Run `npm ci` and `npm test` before opening a pull request. Include focused regression tests and update the help manual for user-facing changes. Please use the [issue tracker](https://github.com/Desom-fu/sviber/issues) for design discussion before a large change.

## License

sviber is licensed under [AGPL-3.0-or-later](LICENSE). Bundled fonts and third-party dependencies retain their respective licenses; desktop builds include the relevant font license files.
