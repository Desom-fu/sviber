// Bridge for loading sunniesnow-record through Node's ESM loader.
//
// The package is ESM with top-level await and imports Node builtins (fs, os,
// child_process, ...) plus bare specifiers (mime). The page context's import() uses
// the browser module loader, which cannot resolve any of those (the renderer therefore
// needs the gl/canvas native modules rebuilt for the Node context, matching
// IMPLEMENTATION_v25 #28). Code loaded via require() runs in the NW.js Node context,
// where this dynamic import() uses Node's loader and node_modules resolution.
"use strict";

module.exports = {
	load: () => import("sunniesnow-record"),
};
