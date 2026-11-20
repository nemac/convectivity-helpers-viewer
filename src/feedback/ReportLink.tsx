// "Something look wrong?": a small link on a drawn hazard's numbers and in
// the alternate routes popup, for testers to report a result that does not
// look right. It opens feedback mode's comment popover on that result,
// turning the mode on first when it is off (which asks for the name and code
// when they are not known yet), and the comment carries a copy of the result
// (see report.ts) so it can be looked into, and rebuilt, after it expires.
//
// Shown only where feedback is available: to someone who opened a feedback
// link, while feedback runs, and always on the dev server.
import { Box } from "@mui/material";
import { feedbackEnabled } from "./feedbackApi";
import { Report } from "./report";
import { reportProblem, useFeedback } from "./store";
import { UI_ATTR } from "./target";

const UI = { [UI_ATTR]: "" };

export function ReportLink({ build, region, sx }: {
  build: () => Report | null;
  // what the popover sits beside and outlines (the numbers, the routes box);
  // the link itself when not given
  region?: () => HTMLElement | null;
  sx?: object;
}) {
  // re-rendered when the mode or the link changes (useFeedback), so the
  // link shows as soon as a feedback link is taken from the address
  useFeedback();
  if (!feedbackEnabled()) return null;
  return (
    // Feedback mode's own control, so a click on it in feedback mode is its
    // own and not taken as a comment on it.
    <Box component="button" type="button" {...UI}
      title="Tell us about it. A copy of this result goes with what you write."
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        const r = build();
        if (r) reportProblem(r, region?.() ?? e.currentTarget);
      }}
      sx={{
        border: "none", bgcolor: "transparent", p: 0, font: "inherit", fontSize: 12.5, fontWeight: 700,
        color: "#003DA5", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2,
        textAlign: "left", "&:hover": { color: "#003865" },
        "&:focus-visible": { outline: "2px solid #003DA5", outlineOffset: 2, borderRadius: "2px" },
        ...sx,
      }}>
      Something look wrong?
    </Box>
  );
}
