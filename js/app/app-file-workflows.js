// File workflows composition root. Disk lifecycle, preferences/media and
// open/save each live in their own module; this factory keeps the original
// `withFileWorkflows` name so existing importers stay unchanged.

import { withDocumentLifecycle } from "./app-document-lifecycle.js";
import { withPreferencesMedia } from "./app-preferences-media.js";
import { withOpenSave } from "./app-open-save.js";

export const withFileWorkflows = Base => withOpenSave(withPreferencesMedia(withDocumentLifecycle(Base)));
