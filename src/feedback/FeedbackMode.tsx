// Feedback mode, the tester's side: the switch in the title bar, the green
// strip under it, and the layer over the whole page that turns clicks on
// words (and Alt+clicks on anything, the map included) into suggestions and
// comments while every control and the map work as usual, outlines what a
// click would pick, puts numbered pins on what this tester sent, and saves a
// picture of the screen with each item.
//
// App puts <FeedbackSwitch/> in the title bar, <FeedbackStrip/> right under
// it and <FeedbackLayer/> once anywhere; MapView hands over its map with
// setFeedbackMap(m), and the methodology reader marks its paper with
// data-doc=<file>. Nothing here changes how the app behaves while the mode
// is off.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import maplibregl from "maplibre-gl";
import { Box } from "@mui/material";
import {
  FeedbackKind, MineItem, NewFeedback, PostError, cap, currentHash, feedbackCode, feedbackEnabled, feedbackEnd,
  feedbackTarget, postFeedback, setFeedbackCode, testerId,
} from "./feedbackApi";
import { TARGET_SWITCHABLE, useApiTarget } from "../ondemandApi";
import { sameText } from "./diff";
import { feedbackDrawing, getFeedbackMap, useFeedbackMap } from "./mapHandle";
import { ReportContext, reportAt } from "./report";
import { captureView } from "./screenshot";
import { AppHooks, registerAppHooks } from "./show";
import {
  addMine, askName, closeNameDialog, feedbackEndedNow, refreshFeedbackEnd, resetMine, selectItem, setName, setOn,
  setShow, takeReport, useFeedback, ShowTarget,
} from "./store";
import {
  SKIP_ATTR, UI_ATTR, collapse, commentTargetAt, controlAt, controlBox, controlText, findTarget, inFeedbackUi, isBackdrop,
  isMapCanvas, mapPlace, onScrollbar, placeOf, selectorFor, textBlockAt,
} from "./target";
import { Btn, FB, NoteBox, PinBody, WordDiff, Z, keepPinName, pinElement, useFocusTrap } from "./ui";
import ReviewList from "./ReviewList";

const UI = { [UI_ATTR]: "" };
const SKIP = { [SKIP_ATTR]: "" };
const hashTab = () => new URLSearchParams(window.location.hash.replace(/^#/, "")).get("tab") ?? "isolation";

// ------------------------------------------------------------ the switch --

// The green pill in the title bar. Shown only to someone who opened a
// feedback link, and always on the dev server.
export function FeedbackSwitch() {
  const { on } = useFeedback();
  // Kept while the mode is on even once feedback has ended, so a tester
  // whose page was on can still turn it off; after that it is gone.
  if (!feedbackEnabled() && !on) return null;
  return (
    // Named by its own words ("Feedback on"), so the name holds the visible
    // label for anyone who speaks or reads it; aria-checked says the state.
    <Box component="button" type="button" role="switch" aria-checked={on} {...UI}
      onClick={() => setOn(!on)}
      title="Suggest new words or comment on anything. The app works as usual: click any words to suggest a change, and Alt+click (Option+click on a Mac) anything, or a spot on the map, to comment."
      sx={{
        display: "flex", alignItems: "center", gap: 0.75, flexShrink: 0, cursor: "pointer",
        bgcolor: FB.green, color: "#fff", borderRadius: 999, border: "2px solid #fff",
        pl: 0.75, pr: 1.4, py: 0.5, fontFamily: "inherit", fontWeight: 800, fontSize: 13, lineHeight: "18px",
        "&:hover": { bgcolor: "#16702f" },
        "&:focus-visible": { outline: "2px solid #fff", outlineOffset: 2 },
      }}>
      <Box aria-hidden="true" sx={{
        width: 28, height: 16, borderRadius: 99, position: "relative", flexShrink: 0,
        bgcolor: on ? "#fff" : "rgba(255,255,255,.35)", transition: "background-color 140ms",
        "&::after": {
          content: '""', position: "absolute", top: 2, left: on ? 14 : 2, width: 12, height: 12, borderRadius: "50%",
          bgcolor: on ? FB.green : "#fff", transition: "left 140ms",
        },
      }} />
      {on ? "Feedback on" : "Feedback off"}
    </Box>
  );
}

// ------------------------------------------------------------ the strip --

// Under the title bar while the mode is on. It takes room from the page
// rather than covering it, so App places it in the column after the header.
export function FeedbackStrip() {
  const { on, name, mine } = useFeedback();
  const { chosen } = useApiTarget();
  // the dev server asks again when the switch points somewhere else
  useEffect(() => { if (on && import.meta.env.DEV) refreshFeedbackEnd(); }, [on, chosen]);
  if (!on) return null;
  const end = feedbackEnd();
  const devNote = import.meta.env.DEV && TARGET_SWITCHABLE;
  return (
    <Box {...UI} role="status" sx={{
      bgcolor: FB.greenBg, color: FB.done, fontWeight: 700, fontSize: 14, px: 2, py: 0.75, flexShrink: 0,
      borderBottom: `1px solid ${FB.greenLine}`, display: "flex", gap: 1.25, alignItems: "center", flexWrap: "wrap",
    }}>
      {end.ended && !import.meta.env.DEV ? (
        <span>Feedback has ended. Thank you for your help.</span>
      ) : (
        <>
          {/* Every control and the map work as usual; plain words take a
              suggestion, and Alt+click gives feedback on anything. */}
          <span>The app works as usual. Click any words to suggest a change. Alt+click anything, or a spot on the map, to comment.</span>
          <Box component="span" sx={{ fontWeight: 500, color: FB.gray, fontSize: 13 }}>
            Alt is Option on a Mac.
          </Box>
        </>
      )}
      {devNote && (
        // Only on the dev server: where items go, and the end date, since
        // the switch shows here even after testers can no longer see it.
        <Box component="span" sx={{ fontWeight: 500, color: FB.ink, fontSize: 13 }}>
          Sending to {feedbackTarget() === "local" ? "this computer" : "AWS (live)"}.
          {end.endsAt && (end.ended
            ? ` Feedback ended after ${lastDay(end.endsAt)}: testers no longer see the switch, and new items are refused. It shows here because this is the dev server.`
            : ` Feedback ends after ${lastDay(end.endsAt)}.`)}
        </Box>
      )}
      <Box component="span" sx={{ ml: "auto", fontWeight: 600, color: FB.ink }}>
        Giving feedback as{" "}
        <Box component="button" type="button" onClick={askName} title="Change your name"
          sx={{
            border: "none", bgcolor: "transparent", p: 0, font: "inherit", fontWeight: 800, color: FB.ink,
            cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 3,
            "&:focus-visible": { outline: "2px solid #003DA5", outlineOffset: 2 },
          }}>{name}</Box>
        {" "}· {mine.length} sent
        {import.meta.env.DEV && (
          // Dev server only, for trying things: this browser's pins and count
          // start again. The items themselves stay wherever they were sent.
          // Always shown there, so focus is not lost when the count drops to 0.
          <>
            {" "}
            <Box component="button" type="button" onClick={resetMine}
              title="Forget the pins and count of what this browser sent. The feedback itself is kept."
              sx={{
                border: "none", bgcolor: "transparent", p: 0, font: "inherit", fontSize: 12, fontWeight: 600,
                color: FB.ink, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2,
                "&:focus-visible": { outline: "2px solid #003DA5", outlineOffset: 2 },
              }}>Reset my sent count</Box>
          </>
        )}
      </Box>
    </Box>
  );
}

// The last day feedback is taken, in the server's own time zone: ends_at is
// midnight US Eastern after it, so a second earlier is that day.
const lastDay = (endsAt: Date) => new Date(endsAt.getTime() - 1000).toLocaleDateString("en-US", {
  month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York",
});

// ------------------------------------------------------------ the name dialog --

// Asks for what turning Feedback on still needs: the tester's name (once,
// kept in this browser) and the feedback code (once a visit, kept only until
// the tab closes), like the access-code boxes of the drawing and routes
// tools. Also opened from the strip to change the name.
function NameDialog() {
  const { askName: open, name, on } = useFeedback();
  const [value, setValue] = useState(name);
  const [code, setCode] = useState("");
  // While the mode is on, the only way here is the strip's "Change your
  // name", so it asks for the name alone, even after a wrong code cleared
  // the code: the popover asks for the code again when the tester sends.
  const needCode = !on && !feedbackCode();
  // A tester whose name is known and who only needs the code this visit is
  // asked for the code alone.
  const askingName = !name || !needCode;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) { setValue(name); setCode(""); } }, [open, name]);
  useFocusTrap(ref, open);
  if (!open) return null;
  const ok = value.trim() !== "" && (!needCode || code.trim() !== "");
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!ok) return;
    setName(value, needCode ? code : undefined);
  };
  const title = !name ? "Before you start" : needCode ? "Turn on feedback" : "Change your name";
  const intro = !name
    ? "Your name goes with each suggestion and comment, so we know who to ask about it."
    : needCode ? `Giving feedback as ${name}.` : "Your name goes with each suggestion and comment.";
  return createPortal(
    <Box {...UI} {...SKIP} sx={{
      position: "fixed", inset: 0, zIndex: Z.dialog, bgcolor: "rgba(0,20,45,.35)",
      display: "grid", placeItems: "center", p: 2, fontFamily: "Figtree, sans-serif",
    }} onMouseDown={(e) => { if (e.target === e.currentTarget) closeNameDialog(); }}>
      <Box ref={ref} role="dialog" aria-modal="true" aria-labelledby="fb-name-title" component="form" onSubmit={submit}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); closeNameDialog(); } }}
        sx={{
          bgcolor: "#fff", color: FB.ink, borderRadius: "12px", boxShadow: "0 8px 30px rgba(0,0,0,.3)",
          p: 2.5, width: 380, maxWidth: "100%", boxSizing: "border-box", fontSize: 14,
        }}>
        <Box component="h2" id="fb-name-title" sx={{ m: 0, mb: 0.75, fontSize: 18, color: "#003865" }}>
          {title}
        </Box>
        <Box component="p" sx={{ m: 0, mb: 1.5, color: FB.gray, lineHeight: 1.45 }}>
          {intro}
        </Box>
        {askingName && <Field label="Your name" value={value} onChange={setValue} autoComplete="name" />}
        {needCode && (
          <>
            <Field label="Feedback code" value={code} onChange={setCode} autoComplete="off" type="password" />
            <Box component="p" sx={{ m: 0, mt: -0.25, color: FB.gray, fontSize: 12.5, lineHeight: 1.4 }}>
              The code you were given with the link. It is kept until you close this tab.
            </Box>
          </>
        )}
        <Box sx={{ display: "flex", gap: 0.75, justifyContent: "flex-end", mt: 1.5 }}>
          <Btn onClick={closeNameDialog}>Cancel</Btn>
          <Btn kind="green" type="submit" disabled={!ok}>
            {name && !needCode ? "Save" : "Start giving feedback"}
          </Btn>
        </Box>
      </Box>
    </Box>,
    document.body,
  );
}

function Field({ label, value, onChange, autoComplete, type = "text", disabled, inputRef }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete?: string; type?: string;
  disabled?: boolean; inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <Box component="label" sx={{ display: "block", mb: 1, fontWeight: 700, fontSize: 13 }}>
      {label}
      <Box component="input" type={type} value={value} autoComplete={autoComplete} maxLength={120}
        disabled={disabled} ref={inputRef}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        sx={{
          display: "block", width: "100%", boxSizing: "border-box", mt: 0.5, px: 1, py: 0.75, fontSize: 14,
          fontFamily: "inherit", border: `1.5px solid ${FB.line}`, borderRadius: "6px", color: FB.ink,
          // the same ring as every other field in the app, not just a
          // darker border, so keyboard users can see where they are
          "&:focus": { outline: "2px solid #003DA5", outlineOffset: 1, borderColor: "#003DA5" },
          "&:disabled": { bgcolor: "#f6f8fa" },
        }} />
    </Box>
  );
}

// ------------------------------------------------------------ the layer --

interface Rect { left: number; top: number; width: number; height: number }
const rectOf = (el: Element): Rect => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };

interface Draft {
  mode: FeedbackKind;
  textEl: HTMLElement | null;     // the text a suggestion would change, if any
  el: HTMLElement | null;         // what a comment is on (null: a spot on the map)
  area: string;
  doc?: string;
  original?: string;
  lnglat?: [number, number];
  zoom?: number;
  anchor: Rect;
  shot: Promise<string | null>;
  touched: boolean;
  // "Something look wrong?" on a drawn hazard or a set of routes: the copy
  // of the result that goes with the comment
  context?: ReportContext;
}

// The picture is taken two frames after the target's outline is drawn, so
// the outline is in it and the popover (left out by SKIP_ATTR) is not.
const shootSoon = () => new Promise<string | null>((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => { captureView().then(resolve); }));
});
const upTo = <T,>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p, new Promise<T>((r) => window.setTimeout(() => r(fallback), ms))]);

export interface FeedbackLayerProps extends AppHooks {}

// Mounted once, anywhere in App. Everything it draws goes into document.body.
export function FeedbackLayer({ onRestore, onOpenDoc, onRebuild }: FeedbackLayerProps) {
  const { on, askName: naming, view, show, report } = useFeedback();
  useEffect(() => { registerAppHooks({ onRestore, onOpenDoc, onRebuild }); }, [onRestore, onOpenDoc, onRebuild]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // what a click would pick; spot: a ring at the pointer on the map
  const [hover, setHover] = useState<{ rect: Rect; kind: FeedbackKind; alt?: boolean; spot?: boolean } | null>(null);
  const [sent, setSent] = useState(false);
  // One timer for the thank-you note: a second item sent while the first
  // note shows starts it again, rather than the first timer hiding the
  // second note early.
  const sentTimer = useRef(0);
  const thank = useCallback(() => {
    setSent(true);
    window.clearTimeout(sentTimer.current);
    sentTimer.current = window.setTimeout(() => setSent(false), 2600);
  }, []);
  useEffect(() => () => window.clearTimeout(sentTimer.current), []);

  useEffect(() => { if (!on) { setDraft(null); setHover(null); } }, [on]);

  const pick = useCallback((e: MouseEvent) => {
    const cur = draftRef.current;
    // An open popover with words in it is not thrown away by a stray click.
    // One whose box has left the page (the menu or reader it sat in was
    // closed some other way) is dropped instead, or every later click would
    // land here and the mode would be stuck until the switch went off.
    if (cur?.touched) {
      const box = document.querySelector<HTMLElement>("#fb-pop textarea");
      if (box) { box.focus(); return; }
    }
    const t = e.target as Element;
    let d: Omit<Draft, "shot" | "touched">;
    const ctrl = controlAt(t);
    if (isMapCanvas(t)) {
      const map = getFeedbackMap();
      if (!map) return;
      const r = map.getCanvas().getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const ll = map.unproject([x, y]);
      const zoom = Math.round(map.getZoom() * 100) / 100;
      // A drawn hazard's roads or outline, or a route line: a comment on
      // that result, with its copy, as "Something look wrong?" gives.
      const rep = reportAt(map, x, y);
      d = {
        mode: "comment", textEl: null, el: null, area: rep ? rep.area : mapPlace(zoom),
        lnglat: [Math.round(ll.lng * 1e6) / 1e6, Math.round(ll.lat * 1e6) / 1e6], zoom,
        anchor: { left: e.clientX - 8, top: e.clientY - 8, width: 16, height: 16 },
        ...(rep ? { context: rep.context } : {}),
      };
    } else if (ctrl) {
      // Alt+click on a control: its own words (a checkbox's label), or a
      // comment on it
      const textEl = controlText(ctrl);
      const box = controlBox(ctrl);
      const words = !!textEl && !e.shiftKey;
      const place = placeOf(box);
      d = {
        mode: words ? "words" : "comment", textEl, el: box, area: place.area, doc: place.doc,
        original: textEl ? collapse(textEl.innerText) : undefined, anchor: rectOf(words ? textEl! : box),
      };
    } else {
      const textEl = textBlockAt(t);
      const words = !!textEl && !e.shiftKey;
      const el = textEl ?? commentTargetAt(t);
      const place = placeOf(el);
      d = {
        mode: words ? "words" : "comment", textEl, el, area: place.area, doc: place.doc,
        original: textEl ? collapse(textEl.innerText) : undefined, anchor: rectOf(el),
      };
    }
    setHover(null);
    setDraft({ ...d, shot: shootSoon(), touched: false });
  }, []);

  // ---- the clicks: caught before the app sees them ----
  // ---- "Something look wrong?": opened once the mode is on ----
  useEffect(() => {
    if (!on || naming || !report) return;
    // words already typed into an open popover are not thrown away (unless
    // its box has left the page, as in pick)
    const box = draftRef.current?.touched ? document.querySelector<HTMLElement>("#fb-pop textarea") : null;
    if (box) {
      takeReport();
      box.focus();
      return;
    }
    const r = takeReport();
    if (!r) return;
    const el = r.el && r.el.isConnected ? r.el : null;
    const w = window.innerWidth, h = window.innerHeight;
    setHover(null);
    setDraft({
      mode: "comment", textEl: null, el, area: r.report.area, context: r.report.context,
      anchor: el ? rectOf(el) : { left: w / 2 - 8, top: h / 3, width: 16, height: 16 },
      shot: shootSoon(), touched: false,
    });
  }, [on, naming, report]);

  useEffect(() => {
    if (!on || naming) return;
    let down: { x: number; y: number; map: boolean } | null = null;
    // What the app gets as usual (the user asked for that on 2026-11-20, so
    // testers can open road popups, draw a hazard and get alternate routes
    // with the mode on): feedback's own boxes; the backdrop behind an open
    // menu or drawer; a plain click on the map or on any control; and every
    // click on the map while the drawing tool is on. Feedback's: a plain
    // click on words or on a card around them, and Alt+click on anything.
    const passes = (e: Event) => {
      const t = e.target;
      if (!(t instanceof Element) || inFeedbackUi(t)) return true;
      // Except while words typed into the popover are waiting to be sent: a
      // click on a control, the map or a backdrop could close what the
      // popover sits in or beside, and the words with it. So every click
      // outside the popover is held back, and pick() puts the caret back in
      // the box, as it does for any stray click. The map still pans.
      if (draftRef.current?.touched && document.getElementById("fb-pop")) return false;
      if (isBackdrop(t)) return true;
      if (isMapCanvas(t) && feedbackDrawing()) return true;
      if ((e as MouseEvent).altKey) return false;
      return isMapCanvas(t) || !!controlAt(t);
    };
    const block = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    // Whether the last press went to the app (null: no press, as for a
    // click made with the keyboard). Its click goes the same way wherever it
    // lands: a pulldown opens on the press, and its release then lands on
    // the menu's backdrop, which made the click land on the page around it.
    let pressPassed: boolean | null = null;
    const onDown = (e: PointerEvent | MouseEvent) => {
      const ok = passes(e);
      if (e.type === "pointerdown") pressPassed = ok;
      if (ok) {
        // An open popover with nothing typed in it gives way to the app: a
        // click on a control or the map closes it and does its usual thing.
        const t = e.target;
        if (draftRef.current && !draftRef.current.touched && t instanceof Element && !inFeedbackUi(t)) setDraft(null);
        return;
      }
      if (isMapCanvas(e.target as Element)) {
        // the map still pans and zooms; only a click becomes a comment
        if (e.type === "pointerdown") down = { x: e.clientX, y: e.clientY, map: true };
        return;
      }
      if (onScrollbar(e)) return;
      if (e.type === "pointerdown") down = { x: e.clientX, y: e.clientY, map: false };
      block(e);
    };
    const onTouch = (e: TouchEvent) => {
      // not prevented, or the browser would not follow with a click
      if (!passes(e) && !isMapCanvas(e.target as Element)) e.stopPropagation();
    };
    // Only the release of a press that was held back is held back too: the
    // map listens for the release of a drag that ends over the panel.
    const onUp = (e: MouseEvent) => {
      if (down && !down.map && !passes(e)) block(e);
    };
    const onClick = (e: MouseEvent) => {
      const pressed = pressPassed;
      pressPassed = null;
      if (pressed === true || (pressed === null && passes(e))) return;
      const onMap = isMapCanvas(e.target as Element);
      const moved = !!down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5;
      const wasMap = !!down?.map;
      down = null;
      // a drag on the map, or one that ended off it, is left alone
      if (wasMap && (!onMap || moved)) return;
      // the press was on a scroll bar and was let through; so is its click
      if (!onMap && onScrollbar(e)) return;
      block(e);
      // a press dragged off one thing and let go over another is not a click
      if (moved) return;
      pick(e);
    };
    // A double click on the map still zooms; anywhere else it does nothing,
    // so it cannot set off the app's own double-click actions.
    const onDbl = (e: MouseEvent) => { if (!passes(e) && !isMapCanvas(e.target as Element)) block(e); };
    const opts = { capture: true, passive: false } as const;
    window.addEventListener("pointerdown", onDown, opts);
    window.addEventListener("mousedown", onDown, opts);
    window.addEventListener("touchstart", onTouch, opts);
    window.addEventListener("pointerup", onUp, opts);
    window.addEventListener("mouseup", onUp, opts);
    window.addEventListener("click", onClick, opts);
    window.addEventListener("dblclick", onDbl, opts);
    return () => {
      window.removeEventListener("pointerdown", onDown, opts);
      window.removeEventListener("mousedown", onDown, opts);
      window.removeEventListener("touchstart", onTouch, opts);
      window.removeEventListener("pointerup", onUp, opts);
      window.removeEventListener("mouseup", onUp, opts);
      window.removeEventListener("click", onClick, opts);
      window.removeEventListener("dblclick", onDbl, opts);
    };
  }, [on, naming, pick]);

  // ---- the hover outline: dashed green on text, solid violet on the rest ----
  // It outlines exactly what a click would pick: the same element, in violet
  // while Shift is held (a comment on it). Controls and the map have none,
  // since a click works them as usual; with Alt held, what Alt+click would
  // pick is outlined in violet. Pressing or letting go of Shift or Alt
  // redraws it without the mouse having to move.
  useEffect(() => {
    if (!on || naming || draft) { setHover(null); return; }
    let frame = 0;
    let last: PointerEvent | null = null;
    let shift = false, alt = false;
    const update = () => {
      frame = 0;
      const e = last;
      if (!e) return;
      const t = e.target;
      if (!(t instanceof Element) || inFeedbackUi(t)) { setHover(null); return; }
      // The backdrop of an open menu or drawer: a click closes it, as usual
      if (isBackdrop(t)) { setHover(null); return; }
      // The map works as usual: no outline, except a ring at the pointer
      // while Alt is held, where Alt+click would leave a map comment. While
      // drawing, the map is the drawing's.
      if (isMapCanvas(t)) {
        if (!alt || feedbackDrawing()) { setHover(null); return; }
        setHover({ rect: { left: e.clientX - 8, top: e.clientY - 8, width: 16, height: 16 }, kind: "comment", alt, spot: true });
        return;
      }
      // A control works as usual too: no outline, until Alt is held.
      const ctrl = controlAt(t);
      if (ctrl) {
        if (!alt) { setHover(null); return; }
        const textEl = controlText(ctrl);
        const words = !!textEl && !shift;
        setHover({ rect: rectOf(words ? textEl! : controlBox(ctrl)), kind: words ? "words" : "comment", alt });
        return;
      }
      const textEl = textBlockAt(t);
      const el = textEl ?? commentTargetAt(t);
      setHover({ rect: rectOf(el), kind: textEl && !shift ? "words" : "comment", alt });
    };
    const soon = () => { if (!frame) frame = requestAnimationFrame(update); };
    const onMove = (e: PointerEvent) => { last = e; shift = e.shiftKey; alt = e.altKey; soon(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Shift" && e.key !== "Alt") return;
      shift = e.shiftKey; alt = e.altKey; soon();
    };
    const clear = () => setHover(null);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("pointermove", onMove, { capture: true, passive: true });
    window.addEventListener("scroll", clear, { capture: true, passive: true });
    document.documentElement.addEventListener("mouseleave", clear);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("pointermove", onMove, { capture: true });
      window.removeEventListener("scroll", clear, { capture: true });
      document.documentElement.removeEventListener("mouseleave", clear);
    };
  }, [on, naming, draft]);

  // the class that sets the cursor below, only while something is outlined:
  // the app's own cursors (a road's pointer, the drawing's crosshair) show
  // everywhere else
  const picking = on && !!hover;
  useEffect(() => {
    document.documentElement.classList.toggle("fb-pick", picking);
    return () => document.documentElement.classList.remove("fb-pick");
  }, [picking]);

  return (
    <>
      {on && <style>{CURSOR_CSS}</style>}
      <NameDialog />
      {on && hover && <HoverBox rect={hover.rect} kind={hover.kind} alt={hover.alt} spot={hover.spot} />}
      {draft && <TargetRing draft={draft} />}
      {draft && (
        <Popover key={`${draft.anchor.left},${draft.anchor.top}`} draft={draft}
          onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
          onClose={() => setDraft(null)}
          onSent={() => { setDraft(null); thank(); }} />
      )}
      {on && <ElementPins />}
      {on && <MapPins />}
      {sent && createPortal(
        <Box {...UI} {...SKIP} role="status" sx={{
          position: "fixed", left: "50%", bottom: 28, transform: "translateX(-50%)", zIndex: Z.pop,
          bgcolor: FB.green, color: "#fff", fontWeight: 800, fontSize: 14, borderRadius: 999, px: 2, py: 0.75,
          border: "2px solid #fff", boxShadow: "0 2px 10px rgba(0,0,0,.3)", fontFamily: "Figtree, sans-serif",
        }}>Sent. Thank you.</Box>,
        document.body,
      )}
      {show && <ShowRing key={show.key} show={show} />}
      {import.meta.env.DEV && view === "review" && <ReviewList />}
    </>
  );
}

// A pointer over what is outlined (a crosshair for a spot on the map), and
// the usual cursors inside feedback mode's own boxes.
const CURSOR_CSS = `
html.fb-pick *:not([${UI_ATTR}], [${UI_ATTR}] *) { cursor: pointer !important; }
html.fb-pick .maplibregl-canvas { cursor: crosshair !important; }
`;

// Dashed green around words a plain click suggests on; solid violet around
// what a click comments on, and around whatever Alt+click would pick.
function HoverBox({ rect, kind, alt = false, spot = false }: { rect: Rect; kind: FeedbackKind; alt?: boolean; spot?: boolean }) {
  const words = kind === "words";
  const green = words && !alt;
  const tipAbove = rect.top > 34;
  return createPortal(
    <Box {...SKIP} aria-hidden="true" sx={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: Z.hover }}>
      <Box sx={{
        position: "fixed", left: rect.left - 2, top: rect.top - 2, width: rect.width + 4, height: rect.height + 4,
        outline: `2px ${green ? "dashed" : "solid"} ${green ? FB.green : FB.violet}`, outlineOffset: 0,
        borderRadius: spot ? "50%" : "3px", ...(spot ? { boxShadow: `0 0 0 3px ${FB.violetRing}` } : {}),
      }} />
      <Box sx={{
        position: "fixed", left: Math.max(4, Math.min(rect.left, window.innerWidth - 230)),
        top: tipAbove ? rect.top - 32 : rect.top + rect.height + 6,
        bgcolor: FB.ink, color: "#fff", border: "2px solid #fff", borderRadius: "8px", px: 1, py: 0.25,
        fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", boxShadow: "0 2px 8px rgba(0,0,0,.3)",
        fontFamily: "Figtree, sans-serif",
      }}>
        {spot ? "Alt+click to comment on this spot"
          : `${alt ? "Alt+click" : "Click"} to ${words ? "suggest words" : "comment"}`}
      </Box>
    </Box>,
    document.body,
  );
}

// The outline around what the popover is about. Left in the screenshot, so
// whoever reads the item sees what was picked.
function TargetRing({ draft }: { draft: Draft }) {
  const [rect, setRect] = useState<Rect>(draft.anchor);
  useEffect(() => {
    const el = draft.mode === "words" ? draft.textEl : draft.el;
    if (!el) { setRect(draft.anchor); return; }
    let frame = 0;
    const tick = () => { setRect(rectOf(el)); frame = requestAnimationFrame(tick); };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [draft.mode, draft.textEl, draft.el, draft.anchor]);
  const words = draft.mode === "words";
  const spot = !draft.el;
  return createPortal(
    <Box aria-hidden="true" sx={{
      position: "fixed", pointerEvents: "none", zIndex: Z.ring,
      left: rect.left - 3, top: rect.top - 3, width: rect.width + 6, height: rect.height + 6,
      border: `2px ${words ? "dashed" : "solid"} ${words ? FB.green : FB.violet}`,
      borderRadius: spot ? "50%" : "4px", boxShadow: spot ? `0 0 0 3px ${FB.violetRing}` : "none",
    }} />,
    document.body,
  );
}

// ------------------------------------------------------------ the popover --

const POP_W = 330;

function place(a: Rect, w: number, h: number): { left: number; top: number } {
  const vw = window.innerWidth, vh = window.innerHeight, gap = 10, m = 8;
  const clampY = (y: number) => Math.max(m, Math.min(y, vh - h - m));
  const clampX = (x: number) => Math.max(m, Math.min(x, vw - w - m));
  if (a.left + a.width + gap + w <= vw - m) return { left: a.left + a.width + gap, top: clampY(a.top) };
  if (a.left - gap - w >= m) return { left: a.left - gap - w, top: clampY(a.top) };
  if (a.top + a.height + gap + h <= vh - m) return { left: clampX(a.left), top: a.top + a.height + gap };
  if (a.top - gap - h >= m) return { left: clampX(a.left), top: a.top - gap - h };
  return { left: clampX((vw - w) / 2), top: clampY((vh - h) / 2) };
}

function Popover({ draft, onChange, onClose, onSent }: {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  onClose: () => void;
  onSent: () => void;
}) {
  const { name } = useFeedback();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [words, setWords] = useState(draft.original ?? "");
  const [why, setWhy] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The code box shows here when the server did not take the code (401,
  // which also cleared it) or none is held, so the tester types it again
  // without losing what they wrote.
  const [askCode, setAskCode] = useState(() => !feedbackCode());
  const [code, setCode] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const sending = useRef(false);
  const isWords = draft.mode === "words";
  // not before it is placed: a hidden box cannot take focus
  useFocusTrap(ref, pos != null, draft.mode);

  // Placed when it opens, and again whenever it changes size: the preview of
  // the change, an error and the code box all make it taller after it is
  // open, which used to push Save and the code box below the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const put = () => {
      const p = place(draft.anchor, el.offsetWidth, el.offsetHeight);
      setPos((old) => (old && old.left === p.left && old.top === p.top ? old : p));
    };
    put();
    const ro = new ResizeObserver(put);
    ro.observe(el);
    window.addEventListener("resize", put);
    return () => { ro.disconnect(); window.removeEventListener("resize", put); };
  }, [draft.anchor, draft.mode]);

  const changed = isWords && !sameText(words, draft.original ?? "");
  const canSend = !busy && (isWords ? changed : text.trim() !== "") && (!askCode || code.trim() !== "");
  const touch = () => { if (!draft.touched) onChange({ touched: true }); };

  const refocus = useRef<"code" | "field" | null>(null);
  useEffect(() => {
    if (busy || !refocus.current) return;
    const to = refocus.current === "code" ? codeRef.current : fieldRef.current;
    refocus.current = null;
    to?.focus();
  }, [busy, askCode]);

  const send = async () => {
    if (!canSend || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    if (askCode) setFeedbackCode(code);
    const tab = hashTab();
    const el = isWords ? draft.textEl : draft.el;
    const target = {
      area: draft.area,
      ...(el ? { selector: selectorFor(el) } : {}),
      ...(draft.doc ? { doc: draft.doc } : {}),
      ...(draft.lnglat ? { lnglat: draft.lnglat, zoom: draft.zoom } : {}),
    };
    const item: NewFeedback = {
      kind: draft.mode, name, tester_id: testerId(), tab, url_hash: currentHash(), target,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      ...(!isWords && draft.context ? { context: draft.context } : {}),
      ...(isWords
        ? { original: cap(draft.original ?? ""), suggested: cap(collapse(words)), ...(why.trim() ? { why: cap(why.trim()) } : {}) }
        : { text: cap(text.trim()), ...(draft.textEl && draft.original ? { original: cap(draft.original) } : {}) }),
    };
    try {
      const shot = await upTo(draft.shot, 8000, null);
      // noted as postFeedback reads it, so clearing this computer's test
      // feedback later keeps the pins for items sent to AWS
      const to = feedbackTarget();
      const { id } = await postFeedback(item, shot);
      const mine: Omit<MineItem, "n"> = {
        id, to, kind: draft.mode, tab, area: draft.area, selector: target.selector, lnglat: draft.lnglat, zoom: draft.zoom,
        original: item.original, suggested: item.suggested, text: item.text, created_at: new Date().toISOString(),
      };
      addMine(mine);
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      sending.current = false;
      if (e instanceof PostError && e.status === 401) {
        setAskCode(true);
        setCode("");
      }
      // Sending disabled the fields, which dropped focus to <body>, where
      // Escape (handled on the popover) no longer reaches it. Focus goes
      // back once the fields are enabled again: to the code box after a
      // wrong code, else to the words.
      refocus.current = e instanceof PostError && e.status === 401 ? "code" : "field";
      // ended: the strip says so at once, and the switch goes once it is off
      if (e instanceof PostError && e.status === 410) feedbackEndedNow();
    }
  };

  const fieldSx = {
    display: "block", width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: 13.5,
    lineHeight: 1.45, color: FB.ink, borderRadius: "6px", px: 1, py: 0.75, resize: "vertical" as const,
    border: `1.5px solid #003DA5`, "&:focus": { outline: "2px solid #003DA5", outlineOffset: 1 },
    "&:disabled": { bgcolor: "#f6f8fa" },
  };
  const link = {
    border: "none", bgcolor: "transparent", p: 0, mr: "auto", font: "inherit", fontSize: 12.5, fontWeight: 700,
    color: "#003DA5", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2,
    "&:focus-visible": { outline: "2px solid #003DA5", outlineOffset: 2 },
  };
  const rows = (s: string) => Math.max(3, Math.min(10, Math.ceil(s.length / 42) + 1));
  // Inside an open MUI modal (the methodology reader is one), the popover is
  // put inside the box the modal keeps focus in (its child with tabindex -1,
  // the drawer's paper): MUI pulls focus back into that box from anywhere
  // outside it, which would leave the tester unable to type.
  const modal = (draft.el ?? draft.textEl)?.closest(".MuiModal-root");
  const host = modal?.querySelector(":scope > [tabindex='-1']") ?? modal ?? document.body;

  return createPortal(
    <Box ref={ref} id="fb-pop" {...UI} {...SKIP} role="dialog" aria-modal="true" aria-labelledby="fb-pop-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); if (!busy) onClose(); }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
      }}
      sx={{
        position: "fixed", zIndex: Z.pop, left: pos?.left ?? -9999, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden",
        width: POP_W, maxWidth: "calc(100vw - 16px)", maxHeight: "calc(100vh - 16px)", overflowY: "auto",
        boxSizing: "border-box", bgcolor: "#fff", color: FB.ink, borderRadius: "10px", border: `1px solid ${FB.line}`,
        boxShadow: "0 6px 22px rgba(0,0,0,.28)", p: 1.5, fontSize: 13.5, fontFamily: "Figtree, sans-serif",
      }}>
      <Box component="h2" id="fb-pop-title" sx={{ m: 0, mb: 0.75, fontSize: 14, color: "#003865", lineHeight: 1.3 }}>
        {isWords ? "Suggest a change" : `Comment on: ${draft.area}`}
      </Box>

      {isWords ? (
        <>
          <Box component="textarea" ref={fieldRef} aria-label="The words as you would have them" value={words} disabled={busy}
            rows={rows(words)} spellCheck
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { setWords(e.target.value); touch(); }}
            sx={fieldSx} />
          <Box sx={{ color: FB.gray, fontSize: 12, mt: 0.5 }}>
            Type over the words. Plain text only, no bold or links.
          </Box>
          {changed && (
            <Box aria-live="polite" sx={{
              mt: 1, p: 1, borderRadius: "6px", bgcolor: "#f6f8fa", border: `1px solid ${FB.line}`, lineHeight: 1.5,
              maxHeight: 160, overflowY: "auto",
            }}>
              <Box sx={{ fontSize: 11.5, fontWeight: 800, color: FB.gray, mb: 0.25 }}>Your change</Box>
              <WordDiff a={draft.original ?? ""} b={words} />
            </Box>
          )}
          <Box component="label" sx={{ display: "block", mt: 1, fontSize: 12.5, fontWeight: 700, color: FB.gray }}>
            Why? (optional)
            <Box component="input" value={why} disabled={busy} maxLength={4000}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setWhy(e.target.value); touch(); }}
              sx={{ ...fieldSx, mt: 0.5, borderColor: FB.line, resize: "none" }} />
          </Box>
        </>
      ) : (
        <>
          {draft.context && (
            // said before the box, so it is read before the tester types
            <Box id="fb-pop-context" sx={{ color: FB.gray, fontSize: 12.5, mb: 0.75, lineHeight: 1.4 }}>
              A copy of this result goes with your comment, so it can be looked into after it expires.
            </Box>
          )}
          <Box component="textarea" ref={fieldRef} aria-label="Your comment" value={text} disabled={busy} rows={rows(text)}
            aria-describedby={draft.context ? "fb-pop-context" : undefined}
            placeholder={draft.context ? "What looks wrong?" : "What should change, or what was unclear?"}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => { setText(e.target.value); touch(); }}
            sx={fieldSx} />
          {draft.lnglat && (
            <Box sx={{ color: FB.gray, fontSize: 12, mt: 0.5 }}>The pin keeps this spot and zoom.</Box>
          )}
        </>
      )}

      {error && <NoteBox sx={{ mt: 1 }}>{error}</NoteBox>}

      {askCode && (
        <Box sx={{ mt: 1 }}>
          <Field label="Feedback code" value={code} onChange={(v) => { setCode(v); touch(); }} autoComplete="off"
            type="password" disabled={busy} inputRef={codeRef} />
        </Box>
      )}

      <Box sx={{ display: "flex", gap: 0.75, alignItems: "center", justifyContent: "flex-end", mt: 1.25, flexWrap: "wrap" }}>
        {isWords ? (
          <Box component="button" type="button" sx={link} disabled={busy}
            onClick={() => onChange({ mode: "comment", el: draft.textEl ?? draft.el })}>Comment instead</Box>
        ) : draft.textEl ? (
          <Box component="button" type="button" sx={link} disabled={busy}
            onClick={() => onChange({ mode: "words" })}>Suggest words instead</Box>
        ) : null}
        <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn kind={isWords ? "green" : "primary"} onClick={send} disabled={!canSend}>
          {busy ? "Sending..." : isWords ? "Save suggestion" : "Post comment"}
        </Btn>
      </Box>
    </Box>,
    host,
  );
}

// ------------------------------------------------------------ the pins --

// This tester's items on what they were about, on the tab they were left on.
// Re-measured every so often and on scroll, since panels open, close and
// scroll under them.
function ElementPins() {
  const { mine } = useFeedback();
  const [pins, setPins] = useState<{ item: MineItem; x: number; y: number }[]>([]);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const tab = hashTab();
      const out: { item: MineItem; x: number; y: number }[] = [];
      for (const item of mine) {
        if (item.lnglat || !item.selector || item.tab !== tab) continue;
        let el: Element | null = null;
        try { el = document.querySelector(item.selector); } catch { el = null; }
        if (!(el instanceof HTMLElement)) continue;
        // a suggestion's pin only while the words are still the old ones
        if (item.kind === "words" && item.original && collapse(el.innerText) !== collapse(item.original)) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        // Only the part of the page the element can be seen through: a
        // panel that scrolls hides what is scrolled out of it, and a pin
        // left at the window's edge floated over the title bar.
        const v = visibleBox(el);
        if (r.bottom < v.top + 4 || r.top > v.bottom - 4 || r.right < v.left || r.left > v.right) continue;
        // Nor while something else lies over the spot the pin points at
        // (the Methodology reader, a dialog, a drawer): the pins sit above
        // all of those, so a pin for the legend floated over the reader.
        // The point is inset by the corner's rounding: at 4 px in, a pill's
        // rounded corner (the Basemap, Legend and guide pills) is outside
        // the pill, over the map, so their pins never showed.
        const inset = Math.max(4, 0.3 * cornerRadius(el, r) + 2);
        if (!onTop(el, Math.min(r.right, v.right) - inset, Math.max(r.top, v.top) + inset)) continue;
        out.push({
          item,
          x: Math.max(v.left, Math.min(r.right - 6, v.right - 26)),
          y: Math.max(v.top + 2, r.top - 14),
        });
      }
      setPins(out);
    };
    const soon = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    const t = window.setInterval(soon, 800);
    window.addEventListener("scroll", soon, { capture: true, passive: true });
    window.addEventListener("resize", soon);
    return () => {
      window.clearInterval(t);
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", soon, { capture: true });
      window.removeEventListener("resize", soon);
    };
  }, [mine]);
  if (!pins.length) return null;
  return createPortal(
    <Box {...UI} {...SKIP}>
      {pins.map(({ item, x, y }) => (import.meta.env.DEV ? (
        // On the dev server a pin opens its item in the inbox.
        <Box key={item.id} component="button" type="button" onClick={() => selectItem(item.id)}
          aria-label={`Item ${item.n}, open it in the feedback inbox. ${pinTitle(item)}`}
          sx={{
            position: "fixed", left: x, top: y, zIndex: Z.pins, p: 0, border: "none", bgcolor: "transparent",
            cursor: "pointer", borderRadius: "50%",
            "&:focus-visible": { outline: "2px solid #003DA5", outlineOffset: 2 },
          }}>
          <PinBody n={item.n} kind={item.kind} title={pinTitle(item)} />
        </Box>
      ) : (
        <Box key={item.id} sx={{ position: "fixed", left: x, top: y, zIndex: Z.pins }}>
          <PinBody n={item.n} kind={item.kind} title={pinTitle(item)} />
        </Box>
      )))}
    </Box>,
    document.body,
  );
}

// The box an element can be seen in: the window, cut down by every
// ancestor that clips what overflows it (the scrolling panel, the reader).
function visibleBox(el: Element): { left: number; top: number; right: number; bottom: number } {
  const v = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (s.overflowX === "visible" && s.overflowY === "visible") continue;
    const r = a.getBoundingClientRect();
    if (s.overflowX !== "visible") { v.left = Math.max(v.left, r.left); v.right = Math.min(v.right, r.right); }
    if (s.overflowY !== "visible") { v.top = Math.max(v.top, r.top); v.bottom = Math.min(v.bottom, r.bottom); }
  }
  return v;
}

// The rounding of an element's top right corner, in px (a % is of its size),
// no more than half its height or width.
function cornerRadius(el: Element, r: DOMRect): number {
  const s = getComputedStyle(el).borderTopRightRadius.split(" ")[0] ?? "0";
  const n = parseFloat(s) || 0;
  const px = s.endsWith("%") ? (n / 100) * Math.min(r.width, r.height) : n;
  return Math.min(px, r.width / 2, r.height / 2);
}

// Whether `el` is what shows at (x, y): the topmost thing there, leaving out
// feedback's own pins, outlines and popovers, is the element, inside it, or
// one of its ancestors (a gap between its lines, or an element that lets
// clicks through). Anything else is lying over it.
function onTop(el: Element, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
  for (const hit of document.elementsFromPoint(x, y)) {
    if (hit.closest(`[${UI_ATTR}],[${SKIP_ATTR}]`)) continue;
    return hit === el || el.contains(hit) || hit.contains(el);
  }
  return true;
}

const pinTitle = (item: Pick<MineItem, "kind" | "original" | "suggested" | "text">) =>
  item.kind === "words" ? `You suggested: ${item.suggested ?? ""}` : `You said: ${item.text ?? ""}`;

// Map comments as MapLibre markers, so they stay on their spot as the map
// moves.
function MapPins() {
  const { mine } = useFeedback();
  const map = useFeedbackMap();
  const [tab, setTab] = useState(hashTab());
  useEffect(() => {
    const t = window.setInterval(() => setTab(hashTab()), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (!map) return;
    // on the dev server a pin opens its item in the inbox
    const markers = mine.filter((x) => x.lnglat && x.tab === tab).map((x) =>
      new maplibregl.Marker({
        element: pinElement(x.n, x.kind, pinTitle(x), import.meta.env.DEV ? () => selectItem(x.id) : undefined),
        anchor: "bottom-left", offset: [-2, 2],
      })
        .setLngLat(x.lnglat!).addTo(map)).map(keepPinName);
    return () => markers.forEach((m) => m.remove());
  }, [map, mine, tab]);
  return null;
}

// ------------------------------------------------------------ Show --

// The violet ring around an item picked with Show in the inbox, or a pin and
// a flight for a spot on the map. Gone after a while, or at once with Escape.
function ShowRing({ show }: { show: ShowTarget }) {
  const map = useFeedbackMap();
  const [rect, setRect] = useState<Rect | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const done = () => setShow(null);
    // Heard on the way down, before anything else: the methodology reader
    // (a MUI dialog) stops the Escape that closes it, so a listener on the
    // way up never heard it and the ring stayed after the reader closed.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") done(); };
    window.addEventListener("keydown", onKey, true);
    const t = window.setTimeout(done, 12000);
    return () => { window.removeEventListener("keydown", onKey, true); window.clearTimeout(t); };
  }, []);

  // a spot on the map
  useEffect(() => {
    if (!show.lnglat || !map) return;
    map.flyTo({ center: show.lnglat, zoom: show.zoom ?? map.getZoom(), essential: true });
    const m = keepPinName(new maplibregl.Marker({ element: pinElement(show.n ?? 0, "comment", show.label), anchor: "bottom-left", offset: [-2, 2] })
      .setLngLat(show.lnglat).addTo(map));
    return () => { m.remove(); };
  }, [show, map]);

  // an element: looked for for a few seconds, since a reader or panel may
  // still be opening
  useEffect(() => {
    if (show.lnglat || (!show.selector && !show.original)) return;
    let frame = 0, timer = 0, tries = 0;
    const look = () => {
      const el = findTarget(show.selector, show.original);
      if (el) {
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
        // Gone with whatever held it (the reader closed, the panel changed):
        // the ring goes too, rather than shrinking to the top left corner.
        const follow = () => {
          if (!el.isConnected) { setShow(null); return; }
          setRect(rectOf(el));
          frame = requestAnimationFrame(follow);
        };
        follow();
        return;
      }
      if (++tries > 24) { setMissing(true); return; }
      timer = window.setTimeout(look, 250);
    };
    look();
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [show]);

  if (missing) {
    return createPortal(
      <Box {...UI} {...SKIP} role="status" sx={{
        position: "fixed", top: 90, left: "50%", transform: "translateX(-50%)", zIndex: Z.pop, maxWidth: 420,
        fontFamily: "Figtree, sans-serif",
      }}>
        <NoteBox>That part is not open now. It was in: {show.area}.</NoteBox>
      </Box>,
      document.body,
    );
  }
  if (!rect) return null;
  return createPortal(
    <Box {...SKIP} aria-hidden="true" sx={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: Z.ring }}>
      <Box sx={{
        position: "fixed", left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8,
        border: `2px solid ${FB.violet}`, borderRadius: "6px", boxShadow: `0 0 0 4px ${FB.violetRing}`,
      }} />
      <Box sx={{
        position: "fixed", left: Math.max(4, Math.min(rect.left, window.innerWidth - 240)),
        top: rect.top > 36 ? rect.top - 34 : rect.top + rect.height + 8,
        bgcolor: FB.ink, color: "#fff", border: "2px solid #fff", borderRadius: "8px", px: 1, py: 0.25,
        fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", fontFamily: "Figtree, sans-serif",
      }}>{show.label}</Box>
    </Box>,
    document.body,
  );
}
