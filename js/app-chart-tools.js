// Chart tools composition root. Dialogs, snappee forms and curve drafting each
// live in their own module; this factory keeps the original `withChartTools` name.

import { withChartDialogs } from "./app-chart-dialogs.js";
import { withSnappeeForms } from "./app-snappee-forms.js";
import { withCurveDraft } from "./app-curve-draft.js";

export const withChartTools = Base => withCurveDraft(withSnappeeForms(withChartDialogs(Base)));
