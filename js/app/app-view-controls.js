// Composition root for the view-control mixins. The single oversized `withViewControls`
// mixin was split into four concerns, each in its own module:
//
//   app-view-refresh.js     targeted re-render fan-out for views and docked panels
//   app-main-field-view.js  stage viewport pan/zoom
//   app-time-seeking.js     playhead seeking from timeline/waveform/scroll-view drags
//   app-timeline-marks.js   A-B loop marks and manual bar lines
//   app-time-dilation.js    the time-dilation chart edit
//
// `withViewControls` keeps its name and module path so every importer stays unchanged.

import { withViewRefresh } from "./app-view-refresh.js";
import { withMainFieldView } from "./app-main-field-view.js";
import { withTimeSeeking } from "./app-time-seeking.js";
import { withTimelineMarks } from "./app-timeline-marks.js";
import { withTimeDilation } from "./app-time-dilation.js";

export const withViewControls = Base =>
	withTimeDilation(withTimelineMarks(withTimeSeeking(withMainFieldView(withViewRefresh(Base)))));
