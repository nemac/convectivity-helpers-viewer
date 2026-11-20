// The dev inbox (localhost only): every tester's feedback, pulled from the
// API with the inbox code, in a list beside the map. Filters, a picture of
// the screen for each item, Show to go back to where it was left, a Done box
// that is saved on the server, and the button that makes the review list.
//
// App puts <FeedbackInboxPill/> in the title bar and <FeedbackInbox/> in the
// row beside the map. Both render nothing in a production build, and the
// list is read from the server only while the inbox or the review list is
// open, never on a plain page load.
//
// On This computer only, each item can be deleted and the whole folder
// cleared, to get rid of test feedback. Never for AWS (live): the server
// refuses it there too, so real testers' feedback is never deleted here.
//
// Every field of an item was typed by someone holding the testers' code, so
// all of it is shown as React text only: never as HTML, never through the
// markdown reader, never as a link.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import maplibregl from "maplibre-gl";
import { Box } from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { FeedbackItem, FeedbackSource, fetchScreenshot, hashParams, setInboxSource, useInboxSource } from "./feedbackApi";
import { changeSpan } from "./diff";
import { useFeedbackMap } from "./mapHandle";
import { asContext, contextSummary } from "./report";
import { rebuildItem, showItem } from "./show";
import {
  clearLocalItems, deleteItem, markItem, previousView, reloadItems, selectItem, setView, useFeedback, useFeedbackItems,
  useFeedbackView,
} from "./store";
import { focusLater } from "../focus";
import { TARGET_SWITCHABLE } from "../ondemandApi";
import { UI_ATTR } from "./target";
import { Arrow, Btn, Chip, FB, NoteBox, Z, keepPinName, pinElement, shortDate, useFocusTrap } from "./ui";

const UI = { [UI_ATTR]: "" };
// Where focus goes back to when the inbox or the review list closes: the
// control that opened it, since the one that closed it is gone with it.
const PILL_ID = "fb-inbox-pill";
const REVIEW_BUTTON_ID = "fb-make-review";
// Where focus goes once an item it was on has been deleted: the list itself.
const LIST_ID = "fb-inbox-list";

// A Show that had to reload the page (to change tab) leaves the item's id in
// the hash as fbshow. It is read and taken out once, when this module loads
// with the page, rather than in a component, which StrictMode renders twice.
let showOnLoad: string | null = (() => {
  if (typeof window === "undefined" || !import.meta.env.DEV) return null;
  const p = hashParams(window.location.hash);
  const id = p.get("fbshow");
  if (id == null) return null;
  p.delete("fbshow");
  window.history.replaceState(null, "", `#${p.toString()}`);
  return id || null;
})();

// Items are numbered by when they came in, so a number stays with its item
// whatever the filters show.
export function numbered(items: FeedbackItem[]): Map<string, number> {
  return new Map(items.map((x, i) => [x.id, i + 1]));
}

// The title bar pill, "Feedback inbox · 23 open" once the inbox has been
// opened. Opens and closes the inbox.
export function FeedbackInboxPill() {
  const view = useFeedbackView();
  const { items, loaded } = useFeedbackItems();
  if (!import.meta.env.DEV) return null;
  const open = items.filter((x) => x.status !== "done").length;
  const on = view === "inbox";
  return (
    <Box component="button" type="button" id={PILL_ID} {...UI} aria-pressed={on}
      onClick={() => setView(on ? "map" : "inbox")}
      sx={{
        flexShrink: 0, cursor: "pointer", borderRadius: 999, px: 1.5, py: 0.6, fontFamily: "inherit",
        fontWeight: 700, fontSize: 14, lineHeight: "18px",
        border: "1.5px solid #fff", bgcolor: on ? "#fff" : "rgba(255,255,255,0.1)", color: on ? "#003865" : "#fff",
        "&:hover": { bgcolor: on ? "#fff" : "rgba(255,255,255,0.2)" },
        "&:focus-visible": { outline: "2px solid #fff", outlineOffset: 2 },
      }}>
      Feedback inbox{loaded ? ` · ${open} open` : ""}
    </Box>
  );
}

type StatusFilter = "open" | "done" | "all";
type KindFilter = "all" | "words" | "comment";

export function FeedbackInbox({ width = 340 }: { width?: number }) {
  const view = useFeedbackView();
  if (!import.meta.env.DEV || view !== "inbox") return null;
  return <InboxPanel width={width} />;
}

function InboxPanel({ width }: { width: number }) {
  const { items, loading, error, loaded } = useFeedbackItems();
  const { show, selected } = useFeedback();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [kind, setKind] = useState<KindFilter>("all");
  const [tester, setTester] = useState("all");
  const [big, setBig] = useState<string | null>(null);
  const nums = useMemo(() => numbered(items), [items]);

  // Back from the review list: focus returns to the button that opened it.
  useEffect(() => {
    if (previousView() === "review") focusLater(() => document.getElementById(REVIEW_BUTTON_ID));
  }, []);

  // Read again whenever "Read from" changes, since that picks the store the
  // list comes from.
  const source = useInboxSource();
  useEffect(() => {
    reloadItems({ auto: true });
    const t = window.setInterval(() => reloadItems({ auto: true }), 60_000);
    return () => window.clearInterval(t);
  }, [source]);

  // After a Show that had to reload the page, the item to show (read from
  // the hash when the page loaded, below). Read without taking it, since
  // StrictMode runs this twice and keeps the second answer; it is taken
  // only once it has been shown.
  const [pending, setPending] = useState<string | null>(() => showOnLoad);
  useEffect(() => {
    if (!pending || !loaded) return;
    // the effect's second run in StrictMode finds it already taken
    if (showOnLoad !== pending) return;
    showOnLoad = null;
    const item = items.find((x) => x.id === pending);
    // give the map and panels a moment to settle after the reload
    if (item) window.setTimeout(() => showItem(item, nums.get(item.id) ?? 0, false), 600);
    setPending(null);
  }, [pending, loaded, items, nums]);

  // A pin clicked on the page (dev server): its item, picked out, scrolled
  // into view and given focus. The filters are cleared first when they hide
  // it. An item not in this list was most likely read from the other store.
  const [notHere, setNotHere] = useState(false);
  useEffect(() => {
    if (!selected || !loaded) return;
    const item = items.find((x) => x.id === selected.id);
    setNotHere(!item);
    if (!item) return;
    const hidden = (status !== "all" && (status === "done") !== (item.status === "done"))
      || (kind !== "all" && item.kind !== kind) || (tester !== "all" && (item.name || "No name") !== tester);
    if (hidden) { setStatus("all"); setKind("all"); setTester("all"); }
    // two frames: one for the list to draw the item the filters showed
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.getElementById(`fb-item-${item.id}`);
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      el.focus({ preventScroll: true });
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.key, loaded]);

  const testers = useMemo(() => Array.from(new Set(items.map((x) => x.name || "No name"))).sort(), [items]);
  const counts = {
    open: items.filter((x) => x.status !== "done").length,
    done: items.filter((x) => x.status === "done").length,
  };
  const bigItem = big ? items.find((x) => x.id === big) ?? null : null;
  // What a delete or a clear did, read out by screen readers: the item it was
  // on is gone, so it cannot say so itself.
  const [said, setSaid] = useState("");
  useEffect(() => { setSaid(""); }, [source]);
  const local = source === "local";
  const shown = items.filter((x) =>
    (status === "all" || (status === "done") === (x.status === "done"))
    && (kind === "all" || x.kind === kind)
    && (tester === "all" || (x.name || "No name") === tester));

  return (
    <Box {...UI} component="aside" aria-label="Feedback inbox" sx={{
      width, flexShrink: 0, borderLeft: `1px solid ${FB.line}`, bgcolor: "#fafbfc", color: FB.ink,
      display: "flex", flexDirection: "column", minHeight: 0, fontSize: 13.5,
    }}>
      <Box sx={{ px: 1.5, pt: 1.25, pb: 1, borderBottom: `1px solid ${FB.line}`, display: "flex", flexDirection: "column", gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box component="h2" sx={{ m: 0, fontSize: 16, color: "#003865", mr: "auto" }}>Feedback inbox</Box>
          <Btn onClick={() => reloadItems()} disabled={loading} sx={{ fontSize: 12, py: 0.25 }}>
            {loading ? "Loading..." : "Refresh"}
          </Btn>
          <Btn onClick={() => { setView("map"); focusLater(() => document.getElementById(PILL_ID)); }}
            aria-label="Close the inbox" sx={{ fontSize: 12, py: 0.25 }}>Close</Btn>
        </Box>
        <SourcePicker />
        {local && loaded && items.length > 0 && (
          <ClearAll count={items.length} onCleared={(n) => {
            setSaid(`Deleted ${n} item${n === 1 ? "" : "s"} on this computer, and your pins for them.`);
            focusLater(() => document.getElementById(LIST_ID));
          }} />
        )}
        <Box role="group" aria-label="Filters" sx={{ display: "flex", flexWrap: "wrap", gap: 0.6 }}>
          <Filter on={status === "open"} onClick={() => setStatus(status === "open" ? "all" : "open")}>Open {counts.open}</Filter>
          <Filter on={status === "done"} onClick={() => setStatus(status === "done" ? "all" : "done")}>Done {counts.done}</Filter>
          <Filter on={kind === "words"} onClick={() => setKind(kind === "words" ? "all" : "words")}>Words</Filter>
          <Filter on={kind === "comment"} onClick={() => setKind(kind === "comment" ? "all" : "comment")}>Comments</Filter>
          <Box component="select" aria-label="Tester" value={tester}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTester(e.target.value)}
            sx={{
              border: `1px solid ${tester === "all" ? FB.line : "#003865"}`, borderRadius: 999, px: 1, py: "1px",
              fontSize: 12.5, fontWeight: 700, fontFamily: "inherit", bgcolor: tester === "all" ? "#fff" : "#003865",
              color: tester === "all" ? FB.ink : "#fff",
            }}>
            <option value="all">All testers</option>
            {testers.map((t) => <option key={t} value={t}>{t}</option>)}
          </Box>
        </Box>
      </Box>

      <Box id={LIST_ID} tabIndex={-1} role="region" aria-label="Feedback items" sx={{
        flex: 1, overflowY: "auto", p: 1.25, display: "flex", flexDirection: "column", gap: 0.9,
        "&:focus": { outline: "none" },
      }}>
        {/* kept in the page when empty, only out of sight, so the words
            are read out when they arrive */}
        <Box role="status" sx={{
          color: FB.done, fontWeight: 700, fontSize: 12.5,
          // "1px", not 1: MUI reads 1 as 100%, a window-sized box that let
          // the whole page scroll when a pin's item was scrolled into view
          "&:empty": { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clipPath: "inset(50%)" },
        }}>
          {said}
        </Box>
        {error && <NoteBox>{error}</NoteBox>}
        {notHere && (
          <NoteBox role="status">
            That pin's item is not in this list. It may have been sent to the other place: try the other Read from.
          </NoteBox>
        )}
        {loaded && !error && !shown.length && (
          <Box sx={{ color: FB.gray, p: 1 }}>{items.length ? "Nothing matches these filters." : "No feedback yet."}</Box>
        )}
        {shown.map((x) => (
          <InboxItem key={x.id} item={x} n={nums.get(x.id) ?? 0}
            picked={show?.n === nums.get(x.id) || selected?.id === x.id} onBig={setBig}
            canDelete={local && x.source === "local"}
            onDeleted={(n) => { setSaid(`Item ${n} deleted.`); focusLater(() => document.getElementById(LIST_ID)); }} />
        ))}
      </Box>

      <Box sx={{ p: 1.25, borderTop: `1px solid ${FB.line}` }}>
        <Btn kind="primary" id={REVIEW_BUTTON_ID} onClick={() => setView("review")} sx={{ width: "100%", py: 0.75 }}>
          Make the review list
        </Btn>
      </Box>

      <InboxMapPins items={shown} nums={nums} />
      {bigItem && <BigPicture item={bigItem} onClose={() => setBig(null)} />}
    </Box>
  );
}

// Where the list is read from: its own setting (see inboxSource), so reading
// the real testers' feedback does not move the drawing and routes tools, or
// new feedback, to AWS. Both are read through the feedback server on this
// computer: AWS has no inbox of its own.
function SourcePicker() {
  const chosen = useInboxSource();
  if (!TARGET_SWITCHABLE) return null;
  const opt = (t: FeedbackSource, label: string) => (
    <Filter on={chosen === t} onClick={() => { if (chosen !== t) setInboxSource(t); }}>{label}</Filter>
  );
  return (
    <Box role="group" aria-label="Read the feedback from"
      sx={{ display: "flex", flexWrap: "wrap", gap: 0.6, alignItems: "center", fontSize: 12.5 }}>
      <Box component="span" sx={{ color: FB.gray, fontWeight: 700 }}>Read from</Box>
      {opt("local", "This computer")}
      {opt("aws", "AWS (live)")}
    </Box>
  );
}

function Filter({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Box component="button" type="button" aria-pressed={on} onClick={onClick} sx={{
      border: `1px solid ${on ? "#003865" : FB.line}`, borderRadius: 999, px: 1, py: "1px", fontSize: 12.5,
      fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
      bgcolor: on ? "#003865" : "#fff", color: on ? "#fff" : FB.ink,
      "&:focus-visible": { outline: "2px solid #003DA5", outlineOffset: 2 },
    }}>{children}</Box>
  );
}

function InboxItem({ item, n, picked, onBig, canDelete, onDeleted }: {
  item: FeedbackItem; n: number; picked: boolean; onBig: (id: string) => void;
  canDelete: boolean; onDeleted: (n: number) => void;
}) {
  const done = item.status === "done";
  const span = item.kind === "words" ? changeSpan(item.original ?? "", item.suggested ?? "") : null;
  const ctx = useMemo(() => asContext(item.context), [item.context]);
  return (
    // tabIndex -1: a pin clicked on the page moves focus here
    <Box id={`fb-item-${item.id}`} tabIndex={-1} aria-label={`Item ${n}`} sx={{
      bgcolor: "#fff", border: `1px solid ${picked ? FB.violet : FB.line}`, borderRadius: "8px", p: 1,
      boxShadow: picked ? `0 0 0 2px ${FB.violetRing}` : "none", opacity: done ? 0.75 : 1,
      display: "flex", gap: 1,
      "&:focus": { outline: "2px solid #003DA5", outlineOffset: 2 },
    }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ lineHeight: 1.45, overflowWrap: "anywhere" }}>
          <Box component="span" sx={{ fontWeight: 800, color: FB.gray, mr: 0.5 }}>{n}.</Box>
          <Chip kind={item.kind} />{" "}
          {span ? <>"{span.old}" <Arrow /> "{span.new}"</> : item.text}
          {item.kind === "words" && item.why && (
            <Box sx={{ color: FB.gray, fontSize: 12.5, mt: 0.25 }}>Why: {item.why}</Box>
          )}
        </Box>
        {ctx && <ContextLine item={item} summary={contextSummary(ctx)} simplified={!!ctx.simplified} />}
        <Box sx={{ color: FB.gray, fontSize: 12, mt: 0.5, display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
          <span>{item.name || "No name"} · {shortDate(item.created_at)}</span>
          <span>{item.target?.area}</span>
          <Box component="button" type="button" onClick={() => showItem(item, n)} sx={{
            border: "none", bgcolor: "transparent", p: 0, font: "inherit", fontWeight: 700, color: "#003DA5",
            cursor: "pointer", "&:hover": { textDecoration: "underline" },
            "&:focus-visible": { outline: "2px solid #003DA5", outlineOffset: 2 },
          }}>Show</Box>
          <Box component="label" sx={{ display: "inline-flex", alignItems: "center", gap: 0.4, cursor: "pointer",
            color: done ? FB.done : FB.gray, fontWeight: done ? 800 : 500 }}>
            <input type="checkbox" checked={done} onChange={(e) => markItem(item.id, e.target.checked ? "done" : "open")} />
            Done
          </Box>
          {canDelete && <DeleteOne id={item.id} n={n} onDeleted={onDeleted} />}
        </Box>
      </Box>
      <Thumb item={item} onOpen={() => onBig(item.id)} />
    </Box>
  );
}

// A small Delete icon at the end of an item's last line, which asks
// "Delete? Yes / No" in its place rather than in a browser dialog. Focus goes
// to No, so a second Enter does not delete by mistake; No and Escape put it
// back on the icon.
function DeleteOne({ id, n, onDeleted }: { id: string; n: number; onDeleted: (n: number) => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const iconRef = useRef<HTMLButtonElement>(null);
  const noRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (asking) noRef.current?.focus(); }, [asking]);
  const cancel = () => { setAsking(false); focusLater(() => iconRef.current); };
  const yes = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteItem(id);
      onDeleted(n);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  if (!asking) {
    return (
      <Box component="button" type="button" ref={iconRef} onClick={() => setAsking(true)}
        aria-label="Delete this item" title="Delete this item" sx={{
          ml: "auto", width: 28, height: 28, p: 0, border: "none", borderRadius: "6px", bgcolor: "transparent",
          color: FB.gray, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
          "&:hover": { bgcolor: "#eef1f5", color: FB.ink },
          "&:focus-visible": { outline: "2px solid #003DA5", outlineOffset: 1 },
        }}>
        <DeleteOutlineIcon aria-hidden="true" sx={{ fontSize: 18 }} />
      </Box>
    );
  }
  return (
    <Confirm label="Delete?" busy={busy} err={err} onYes={yes} onNo={cancel} noRef={noRef}
      yesLabel={`Yes, delete item ${n}`} noLabel={`No, keep item ${n}`} sx={{ ml: "auto" }} />
  );
}

// "Clear all test feedback on this computer", in the inbox header, with the
// same inline Yes / No. Clearing also resets this browser's pins and sent
// count, since they pointed at the items it deletes.
function ClearAll({ count, onCleared }: { count: number; onCleared: (n: number) => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const noRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (asking) noRef.current?.focus(); }, [asking]);
  const cancel = () => { setAsking(false); setErr(null); focusLater(() => openRef.current); };
  const yes = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const n = await clearLocalItems();
      setAsking(false);
      setBusy(false);
      onCleared(n);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  if (!asking) {
    return (
      <Box component="button" type="button" ref={openRef} onClick={() => setAsking(true)} sx={{
        alignSelf: "flex-start", border: "none", bgcolor: "transparent", p: 0, font: "inherit", fontSize: 12.5,
        fontWeight: 700, color: "#003DA5", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2,
        "&:focus-visible": { outline: "2px solid #003DA5", outlineOffset: 2 },
      }}>Clear all test feedback on this computer</Box>
    );
  }
  return (
    <Confirm label={`Delete all ${count} item${count === 1 ? "" : "s"} on this computer, and your pins for them?`}
      busy={busy} err={err} onYes={yes} onNo={cancel} noRef={noRef}
      yesLabel="Yes, clear all test feedback on this computer" noLabel="No, keep it" />
  );
}

const btnSx = { fontSize: 12, py: 0, px: 1, minHeight: 24, "&[aria-disabled='true']": { opacity: 0.5, cursor: "default" } };

// The inline question both use: its words, Yes and No. Escape is No.
function Confirm({ label, busy, err, onYes, onNo, noRef, yesLabel, noLabel, sx }: {
  label: string; busy: boolean; err: string | null; onYes: () => void; onNo: () => void;
  noRef: React.RefObject<HTMLButtonElement>; yesLabel: string; noLabel: string; sx?: object;
}) {
  return (
    <Box role="group" aria-label={label}
      onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Escape" && !busy) { e.stopPropagation(); onNo(); } }}
      sx={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 0.6, fontSize: 12.5, ...sx }}>
      <Box component="span" sx={{ fontWeight: 700, color: FB.ink }}>{busy ? "Deleting..." : label}</Box>
      {/* aria-disabled, not disabled, while it works: a disabled button
          drops focus to the page the moment it is pressed */}
      <Btn onClick={onYes} aria-disabled={busy} aria-label={yesLabel} sx={btnSx}>Yes</Btn>
      <Btn onClick={() => { if (!busy) onNo(); }} aria-disabled={busy} aria-label={noLabel} ref={noRef} sx={btnSx}>No</Btn>
      {err && <NoteBox role="alert" sx={{ mt: 0.5, fontSize: 12.5, flexBasis: "100%" }}>{err}</NoteBox>}
    </Box>
  );
}

// A drawn hazard or a set of routes the item reports on: what it is, a
// Rebuild button, and how the last Rebuild went (a plain note in the pale
// yellow box when the result differs from what the tester saw).
function ContextLine({ item, summary, simplified }: { item: FeedbackItem; summary: string; simplified: boolean }) {
  const { rebuilds } = useFeedback();
  const r = rebuilds[item.id];
  return (
    <Box sx={{ mt: 0.5, fontSize: 12.5 }}>
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
        <Box component="span" sx={{ fontWeight: 700, color: FB.ink }}>{summary}</Box>
        {/* aria-disabled, not disabled: a disabled button loses focus to the
            page the moment it is pressed. rebuildItem ignores repeat presses. */}
        <Btn onClick={() => rebuildItem(item)} aria-disabled={r?.state === "working"}
          aria-label={`Rebuild: ${summary}`}
          sx={{ fontSize: 12, py: 0, px: 1, "&[aria-disabled='true']": { opacity: 0.5, cursor: "default" } }}>
          Rebuild
        </Btn>
      </Box>
      {simplified && (
        <Box sx={{ color: FB.gray, mt: 0.25 }}>The copy was thinned to fit, so its lines are simplified.</Box>
      )}
      {r && (r.state === "failed" || r.differs ? (
        <NoteBox role="status" sx={{ mt: 0.5, fontSize: 12.5 }}>{r.note}</NoteBox>
      ) : (
        <Box role="status" sx={{ mt: 0.5, color: r.state === "done" ? FB.done : FB.gray, fontWeight: 700 }}>{r.note}</Box>
      ))}
    </Box>
  );
}

// The screenshot, fetched once it scrolls into view.
function Thumb({ item, onOpen }: { item: FeedbackItem; onOpen: () => void }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [el, setEl] = useState<HTMLElement | null>(null);
  const { id, source } = item;
  useEffect(() => {
    if (!el) return;
    let live = true;
    const io = new IntersectionObserver((es) => {
      if (es.some((x) => x.isIntersecting)) {
        io.disconnect();
        fetchScreenshot({ id, source }).then((u) => { if (live) setUrl(u); });
      }
    });
    io.observe(el);
    return () => { live = false; io.disconnect(); };
  }, [el, id, source]);
  return (
    <Box ref={setEl} sx={{ width: 72, height: 48, flexShrink: 0, borderRadius: "4px", overflow: "hidden",
      border: `1px solid ${FB.line}`, bgcolor: "#eef1f5", display: "grid", placeItems: "center" }}>
      {url ? (
        <Box component="button" type="button" onClick={onOpen} aria-label="See the picture of the screen"
          sx={{ p: 0, border: "none", cursor: "zoom-in", width: "100%", height: "100%", bgcolor: "transparent" }}>
          <Box component="img" src={url} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </Box>
      ) : (
        <Box component="span" sx={{ fontSize: 10.5, color: FB.gray, textAlign: "center", px: 0.5 }}>
          {url === null ? "No picture" : ""}
        </Box>
      )}
    </Box>
  );
}

function BigPicture({ item, onClose }: { item: FeedbackItem; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // focus moves into the picture while it is open, and back after
  useFocusTrap(ref, true);
  const { id, source } = item;
  useEffect(() => { fetchScreenshot({ id, source }).then(setUrl); }, [id, source]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <Box {...UI} ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Picture of the screen"
      onClick={onClose} sx={{
      position: "fixed", inset: 0, zIndex: Z.dialog, bgcolor: "rgba(0,20,45,.7)", display: "grid", placeItems: "center",
      p: 3, cursor: "zoom-out", "&:focus": { outline: "none" },
    }}>
      {url && <Box component="img" src={url} alt="The viewer as the tester saw it"
        sx={{ maxWidth: "100%", maxHeight: "100%", borderRadius: "6px", boxShadow: "0 8px 30px rgba(0,0,0,.4)" }} />}
    </Box>,
    document.body,
  );
}

// Pins for the map comments the filters show, numbered like the list, on
// the tab they were left on. App changes tabs with replaceState, which fires
// no event, so the tab is read again every second.
function InboxMapPins({ items, nums }: { items: FeedbackItem[]; nums: Map<string, number> }) {
  const map = useFeedbackMap();
  const tabNow = () => hashParams(window.location.hash).get("tab") ?? "isolation";
  const [tab, setTab] = useState(tabNow);
  useEffect(() => {
    const t = window.setInterval(() => setTab(tabNow()), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (!map) return;
    // a click on one picks its item out in the list
    const markers = items.filter((x) => x.target?.lnglat && (x.tab ?? "isolation") === tab).map((x) =>
      new maplibregl.Marker({
        element: pinElement(nums.get(x.id) ?? 0, x.kind, x.text ?? x.suggested ?? "", () => selectItem(x.id)),
        anchor: "bottom-left", offset: [-2, 2],
      }).setLngLat(x.target.lnglat!).addTo(map)).map(keepPinName);
    return () => markers.forEach((m) => m.remove());
  }, [map, items, nums, tab]);
  return null;
}
