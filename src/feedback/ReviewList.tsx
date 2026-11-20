// The review list (localhost only, #review): every tester's feedback as one
// page, styled like the UX review page. Words first, each "old" becomes
// "new" with the tester's name; then comments, grouped by where they were
// left. Green Done badges mark what is fixed (set with the Done boxes in the
// inbox). Methodology items name their note, since those are fixed in the
// analysis repo's docs and copied back.
//
// Reports on a drawn hazard or a set of alternate routes ("Something look
// wrong?") have their own section, each with what it is about and a Rebuild
// link, since they are looked into by working the result out again.
//
// FeedbackLayer shows it over the whole page while the view is "review".
// Every field was typed by a tester, so it is shown as React text only.
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Box } from "@mui/material";
import { FeedbackItem } from "./feedbackApi";
import { changeSpan } from "./diff";
import { numbered } from "./FeedbackInbox";
import { ReportContext, asContext, contextSummary } from "./report";
import { rebuildItem, showItem } from "./show";
import { reloadItems, setView, useFeedbackItems } from "./store";
import { UI_ATTR } from "./target";
import { FB, NoteBox, Z, shortDate, useFocusTrap } from "./ui";

const UI = { [UI_ATTR]: "" };

// Comments are grouped by a short name for where they were left: every spot
// on the map under "Map", every road or hazard popup under "Popups", and each
// methodology note under its own name.
function groupOf(area: string): string {
  if (/^Map(,|$)/.test(area)) return "Map";
  // "Main Street popup", "Hazard popup", and "Popup: ..." from before
  if (/^Popup(:|$)/.test(area) || / popup$/.test(area)) return "Popups";
  if (area.startsWith("Methodology:")) return area.split(", section ")[0];
  return area || "Other";
}

export default function ReviewList() {
  const { items, loaded, error } = useFeedbackItems();
  const ref = useRef<HTMLDivElement>(null);
  // focus moves into the list when it opens and back when it closes
  useFocusTrap(ref, true);
  useEffect(() => { if (!loaded) reloadItems({ auto: true }); }, [loaded]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setView("inbox"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const nums = useMemo(() => numbered(items), [items]);

  const words = items.filter((x) => x.kind === "words");
  // the reports on a result, checked once: their own section
  const reports = useMemo(() => items.map((x) => ({ x, ctx: x.kind === "comment" ? asContext(x.context) : null }))
    .filter((r): r is { x: FeedbackItem; ctx: ReportContext } => r.ctx != null), [items]);
  const reported = new Set(reports.map((r) => r.x.id));
  const comments = items.filter((x) => x.kind === "comment" && !reported.has(x.id));
  const groups = useMemo(() => {
    const g = new Map<string, FeedbackItem[]>();
    for (const x of comments) {
      const k = groupOf(x.target?.area ?? "");
      g.set(k, [...(g.get(k) ?? []), x]);
    }
    return Array.from(g.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [comments]);
  const testers = new Set(items.map((x) => x.tester_id || x.name)).size;
  const done = items.filter((x) => x.status === "done").length;
  const dates = items.map((x) => x.created_at).filter(Boolean).sort();
  const range = dates.length
    ? (shortDate(dates[0]) === shortDate(dates[dates.length - 1]) ? shortDate(dates[0])
      : `${shortDate(dates[0])} to ${shortDate(dates[dates.length - 1])}`)
    : "";

  const show = (x: FeedbackItem) => showItem(x, nums.get(x.id) ?? 0);

  return createPortal(
    <Box {...UI} ref={ref} role="dialog" aria-modal="true" aria-labelledby="fb-review-title" sx={{
      position: "fixed", inset: 0, zIndex: Z.review, bgcolor: FB.page, overflowY: "auto",
      fontFamily: "Figtree, system-ui, sans-serif", color: FB.ink, fontSize: 16, lineHeight: 1.5,
    }}>
      {/* not a second "main": the viewer's own is still in the page */}
      <Box sx={{ maxWidth: 860, mx: "auto", px: 2, py: 3.5 }}>
        <Box component="button" type="button" onClick={() => setView("inbox")} sx={{
          border: "none", bgcolor: "transparent", p: 0, mb: 1.5, font: "inherit", fontSize: 14, fontWeight: 700,
          color: "#003DA5", cursor: "pointer", "&:hover": { textDecoration: "underline" },
          "&:focus-visible": { outline: "2px solid #003DA5", outlineOffset: 2 },
        }}>Back to the inbox</Box>

        <Box sx={{ bgcolor: "#fff", border: `1px solid ${FB.line}`, borderRadius: "12px", px: 2.5, py: 2 }}>
          <Box component="h1" id="fb-review-title" sx={{ m: 0, mb: 0.25, fontSize: 24, color: "#003865" }}>
            Tester feedback{range ? `, ${range}` : ""}
          </Box>
          <Box component="p" sx={{ m: 0, color: FB.gray, fontSize: 14 }}>
            {loaded
              ? `${items.length} ${items.length === 1 ? "item" : "items"} from ${testers} ${testers === 1 ? "tester" : "testers"}, ${done} done. Green Done marks what is fixed.`
              : "Loading the feedback..."}
          </Box>
          {error && <NoteBox sx={{ mt: 1.5 }}>{error}</NoteBox>}

          <Heading>Words</Heading>
          {words.length ? (
            <List>
              {words.map((x) => {
                const s = changeSpan(x.original ?? "", x.suggested ?? "");
                return (
                  <li key={x.id}>
                    "{s.old}" becomes "{s.new}". <From x={x} />
                    {x.why && <Box component="span" sx={{ color: FB.gray, fontSize: 14 }}> Why: {x.why}</Box>}
                    {x.target?.doc && <Note doc={x.target.doc} />}
                    {x.status === "done" && <Done />} <ShowLink onClick={() => show(x)} />
                  </li>
                );
              })}
            </List>
          ) : <Empty />}

          <Heading>Drawn hazards and alternate routes</Heading>
          {reports.length ? (
            <List>
              {reports.map(({ x, ctx }) => (
                <li key={x.id}>
                  <Box component="span" sx={{ fontWeight: 700 }}>{contextSummary(ctx)}:</Box> {x.text} <From x={x} />
                  {x.status === "done" && <Done />}{" "}
                  <TextButton onClick={() => rebuildItem(x)} label={`Rebuild: ${contextSummary(ctx)}`}>Rebuild</TextButton>
                  <ShowLink onClick={() => show(x)} />
                </li>
              ))}
            </List>
          ) : <Empty />}

          <Heading>Comments</Heading>
          {groups.length ? groups.map(([g, list]) => (
            <Box key={g} sx={{ mb: 1 }}>
              <Box component="h3" sx={{ m: 0, mt: 1, fontSize: 15, color: "#003865" }}>{g}</Box>
              <List>
                {list.map((x) => (
                  <li key={x.id}>
                    {x.text} <From x={x} />
                    {x.target?.area && x.target.area !== g && (
                      <Box component="span" sx={{ color: FB.gray, fontSize: 13 }}> ({x.target.area})</Box>
                    )}
                    {x.target?.doc && <Note doc={x.target.doc} />}
                    {x.status === "done" && <Done />} <ShowLink onClick={() => show(x)} />
                  </li>
                ))}
              </List>
            </Box>
          )) : <Empty />}
        </Box>
      </Box>
    </Box>,
    document.body,
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <Box component="h2" sx={{
      fontSize: 13, textTransform: "uppercase", letterSpacing: ".5px", color: FB.gray, m: 0, mt: 2, mb: 0.5,
    }}>{children}</Box>
  );
}
function List({ children }: { children: React.ReactNode }) {
  return <Box component="ul" sx={{ m: 0, pl: 2.5, "& li": { my: 0.5 } }}>{children}</Box>;
}
function From({ x }: { x: FeedbackItem }) {
  return <Box component="span" sx={{ color: FB.gray, fontSize: 14 }}>{x.name || "No name"}, {shortDate(x.created_at)}.</Box>;
}
function Note({ doc }: { doc: string }) {
  return (
    <Box component="span" sx={{ color: FB.gray, fontSize: 13 }}>
      {" "}In {doc}: fix it in the analysis repo's docs and copy it back.
    </Box>
  );
}
function Done() {
  return (
    <Box component="span" sx={{
      display: "inline-block", bgcolor: FB.greenBg, color: FB.done, fontSize: 12, fontWeight: 800,
      borderRadius: 999, px: 1, ml: 0.75, lineHeight: "20px",
    }}>Done</Box>
  );
}
function ShowLink({ onClick }: { onClick: () => void }) {
  return <TextButton onClick={onClick}>Show</TextButton>;
}
// A button drawn as a link. `label`, when given, starts with the visible
// word, so the name a screen reader gives holds what is on screen.
function TextButton({ onClick, label, children }: { onClick: () => void; label?: string; children: React.ReactNode }) {
  return (
    <Box component="button" type="button" onClick={onClick} aria-label={label} sx={{
      border: "none", bgcolor: "transparent", p: 0, ml: 0.5, font: "inherit", fontSize: 14, fontWeight: 700,
      color: "#003DA5", cursor: "pointer", "&:hover": { textDecoration: "underline" },
      "&:focus-visible": { outline: "2px solid #003DA5", outlineOffset: 2 },
    }}>{children}</Box>
  );
}
function Empty() {
  return <Box component="p" sx={{ m: 0, color: FB.gray, fontSize: 14 }}>None yet.</Box>;
}
