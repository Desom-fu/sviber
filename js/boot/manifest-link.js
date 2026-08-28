"use strict";

// The web app manifest describes `id`, `start_url` and `scope` relatively, which is what
// lets the same file work from the site root and from a subdirectory. NW.js loads the page
// from a `file:`-like base that Chromium's manifest parser cannot resolve those relative
// URLs against, and it aborts the whole process with
// "Check failed: base_url_value->IsString()." before the app ever starts.
//
// A packaged desktop app has no use for a web app manifest, so the link is added from here
// instead of living in the markup: browsers still get the PWA manifest, NW.js never asks
// for it. Keep this a classic script in `<head>` so the link exists before the document
// finishes parsing and installability is unaffected.
(() => {
	if (globalThis.nw) {
		return;
	}
	const link = document.createElement("link");
	link.rel = "manifest";
	link.href = "manifest.webmanifest";
	document.head.append(link);
})();
