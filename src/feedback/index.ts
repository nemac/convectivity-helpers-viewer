// Feedback mode: everything App needs, from one import. App places the
// switch and the inbox pill in the title bar, the strip under it, the inbox
// beside the map and the layer once anywhere; MapView calls setFeedbackMap.
// The comments at the top of FeedbackMode.tsx and FeedbackInbox.tsx say why
// each piece sits where it does. "Something look wrong?" (ReportLink) and
// the report sources come from report.ts, for the drawn hazards and the
// alternate routes.
export { FeedbackLayer, FeedbackStrip, FeedbackSwitch } from "./FeedbackMode";
export type { FeedbackLayerProps } from "./FeedbackMode";
export { FeedbackInbox, FeedbackInboxPill } from "./FeedbackInbox";
export { default as ReviewList } from "./ReviewList";
export { setFeedbackMap } from "./mapHandle";
export { useFeedbackView } from "./store";
export { feedbackEnabled } from "./feedbackApi";
export { ReportLink } from "./ReportLink";
export {
  compareDrawn, compareRoutes, drawnHazardReport, routesReport, useReportSource, RUN_ID_FORM,
} from "./report";
export type { DrawnHazardContext, Report, ReportContext, RoutesContext } from "./report";
export type { RebuildState } from "./store";
import { useFeedback } from "./store";
import { feedbackEnabled } from "./feedbackApi";

// Whether this visitor opened a feedback link (or is on the dev server), so
// the switch shows; and whether the mode is on. #feedback was taken out of
// the address when this module loaded; the code is asked for when the mode
// is turned on, never read from the link.
export function useFeedbackLink(): { enabled: boolean; on: boolean } {
  const { on } = useFeedback();
  return { enabled: feedbackEnabled(), on };
}
