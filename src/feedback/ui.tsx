// The small pieces feedback mode's views share: its colors (from the
// approved mockup), the word diff, the pins, the pale yellow message box the
// app already uses, and a focus trap for its dialogs.
import React, { useEffect } from "react";
import { Box } from "@mui/material";
import { diffRuns } from "./diff";

export const FB = {
  green: "#1a7f37",       // suggestions, the switch, the strip
  greenBg: "#dcf3e3",
  greenLine: "#b6e3c4",
  done: "#135c2b",        // Done badges
  violet: "#6f42c1",      // comments
  violetBg: "#efe6fb",
  violetRing: "#e4d6f8",
  // struck-through words: dark enough for 4.5:1 on the change box's #f6f8fa
  // (the mockup's #6e7781 was 4.27:1)
  del: "#57606a",
  ink: "#1f2328",
  gray: "#57606a",
  line: "#d5dae1",
  noteBg: "#fff1c7",      // messages, as elsewhere in the app
  noteInk: "#6b4b00",
  page: "#f3f5f8",
};
// Above MUI's drawers, dialogs and tooltips (1200 to 1500).
export const Z = { pins: 1550, ring: 1560, hover: 1570, pop: 1600, dialog: 1650, review: 1450 };

// Old words struck through in gray, new words underlined in green. The new
// words are in the darker Done green: the switch's green on the pale green
// was 4.34:1, under the 4.5:1 that text this size needs.
export function WordDiff({ a, b }: { a: string; b: string }) {
  const runs = diffRuns(a, b);
  return (
    <>
      {runs.map((r, i) => (
        <React.Fragment key={i}>
          {i > 0 && " "}
          {r.t === "same" ? r.w
            : r.t === "del" ? (
              <Box component="del" sx={{ color: FB.del, textDecorationThickness: "1.5px" }}>{r.w}</Box>
            ) : (
              <Box component="ins" sx={{
                color: FB.done, textDecoration: "none", borderBottom: `2px solid ${FB.green}`, bgcolor: FB.greenBg,
              }}>{r.w}</Box>
            )}
        </React.Fragment>
      ))}
    </>
  );
}

// A numbered pin, violet for a comment and green for a suggestion: a teardrop
// pointing down and to the left at the spot.
export function PinBody({ n, kind, title }: { n: number; kind: "words" | "comment"; title?: string }) {
  return (
    <Box title={title} sx={{
      width: 24, height: 24, borderRadius: "50% 50% 50% 0", transform: "rotate(-45deg)",
      bgcolor: kind === "words" ? FB.green : FB.violet, border: "2px solid #fff",
      boxShadow: "0 1px 4px rgba(0,0,0,.35)", display: "grid", placeItems: "center", boxSizing: "border-box",
    }}>
      <Box component="b" sx={{ transform: "rotate(45deg)", color: "#fff", fontSize: 11, lineHeight: 1, fontFamily: "Figtree, sans-serif" }}>
        {n}
      </Box>
    </Box>
  );
}

// A pin drawn as plain DOM, for MapLibre markers (which are not React).
// Its clicks always stop at the pin: markers sit inside the map's container,
// and feedback mode lets clicks on its own pins through, so without this the
// map under the pin would take the click and open a road's popup. With
// `onOpen` (the dev server: open the item in the inbox) it is also a button
// that the keyboard reaches.
export function pinElement(n: number, kind: "words" | "comment", title: string, onOpen?: () => void): HTMLElement {
  const outer = document.createElement("div");
  outer.setAttribute("data-feedback-ui", "");
  outer.setAttribute("data-feedback-skip", "");
  outer.title = title;
  outer.style.cssText = `width:24px;height:24px;cursor:${onOpen ? "pointer" : "default"};border-radius:50%`;
  const stop = (e: Event) => e.stopPropagation();
  outer.addEventListener("mousedown", stop);
  outer.addEventListener("pointerdown", stop);
  outer.addEventListener("touchstart", stop, { passive: true });
  outer.addEventListener("dblclick", stop);
  outer.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); onOpen?.(); });
  outer.setAttribute("data-fb-name", onOpen ? `Item ${n}, open it in the feedback inbox. ${title}` : `Item ${n}. ${title}`);
  outer.setAttribute("aria-label", outer.getAttribute("data-fb-name")!);
  if (!onOpen) outer.setAttribute("role", "img");
  if (onOpen) {
    outer.setAttribute("role", "button");
    outer.tabIndex = 0;
    outer.className = "fb-pin-button";
    outer.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onOpen(); }
    });
    // the same focus ring as the rest of the app, for the keyboard only
    outer.addEventListener("focus", () => {
      let kb = true;
      try { kb = outer.matches(":focus-visible"); } catch { /* an old browser: always shown */ }
      if (kb) { outer.style.outline = "2px solid #003DA5"; outer.style.outlineOffset = "2px"; }
    });
    outer.addEventListener("blur", () => { outer.style.outline = ""; });
  }
  const pin = document.createElement("div");
  pin.style.cssText = `width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);`
    + `background:${kind === "words" ? FB.green : FB.violet};border:2px solid #fff;box-sizing:border-box;`
    + "box-shadow:0 1px 4px rgba(0,0,0,.35);display:grid;place-items:center";
  const b = document.createElement("b");
  b.textContent = String(n);
  b.style.cssText = "transform:rotate(45deg);color:#fff;font:700 11px/1 Figtree,sans-serif";
  pin.appendChild(b);
  outer.appendChild(pin);
  return outer;
}

// MapLibre's Marker.addTo() sets every marker's aria-label to "Map marker",
// over the name pinElement gave it. Call this after addTo to put it back.
export function keepPinName<M extends { getElement(): HTMLElement }>(marker: M): M {
  const el = marker.getElement();
  const name = el.getAttribute("data-fb-name");
  if (name) el.setAttribute("aria-label", name);
  return marker;
}

export function NoteBox({ children, sx, role = "alert" }: { children: React.ReactNode; sx?: object; role?: string }) {
  return (
    <Box role={role} sx={{
      px: 1.25, py: 0.75, borderRadius: 1.5, bgcolor: FB.noteBg, color: FB.noteInk, fontWeight: 700,
      fontSize: 13, lineHeight: 1.4, ...sx,
    }}>
      {children}
    </Box>
  );
}

export function Chip({ kind }: { kind: "words" | "comment" | "done" }) {
  const c = kind === "comment" ? { bg: FB.violetBg, ink: FB.violet, t: "Comment" }
    : kind === "words" ? { bg: FB.greenBg, ink: FB.done, t: "Words" } : { bg: FB.greenBg, ink: FB.done, t: "Done" };
  return (
    <Box component="span" sx={{
      display: "inline-block", borderRadius: 999, px: "7px", fontSize: 11, fontWeight: 800,
      bgcolor: c.bg, color: c.ink, lineHeight: "18px", verticalAlign: "1px",
    }}>{c.t}</Box>
  );
}

// Buttons in the popovers and dialogs, as drawn in the mockup.
// Takes a ref, so a dialog or an inline question can put focus on one.
export const Btn = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: "plain" | "green" | "primary"; sx?: object;
}>(function Btn({ kind = "plain", sx, ...rest }, ref) {
  const colors = kind === "green" ? { bg: FB.green, ink: "#fff", line: FB.green }
    : kind === "primary" ? { bg: "#003DA5", ink: "#fff", line: "#003DA5" } : { bg: "#fff", ink: FB.ink, line: FB.line };
  return (
    <Box component="button" type="button" ref={ref} {...rest} sx={{
      borderRadius: "6px", px: 1.25, py: 0.5, fontWeight: 700, fontSize: 13, fontFamily: "inherit",
      border: `1.5px solid ${colors.line}`, bgcolor: colors.bg, color: colors.ink, cursor: "pointer",
      "&:disabled": { opacity: 0.5, cursor: "default" },
      "&:focus-visible": { outline: "2px solid #003DA5", outlineOffset: 2 },
      ...sx,
    }} />
  );
});

// Keeps Tab and Shift+Tab inside a dialog while it is open, puts focus on
// its first field (or on the dialog itself, given tabIndex -1, when it has
// none) when it opens, and gives focus back to whatever had it before once
// the dialog closes, so a keyboard user is not dropped at the top of the page.
export function useFocusTrap(ref: React.RefObject<HTMLElement>, active: boolean, dep?: unknown) {
  // Declared first so it runs before focus moves in: it notes what had focus.
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const before = document.activeElement;
    return () => {
      const now = document.activeElement;
      // only when focus is still in the dialog or was lost with it
      if (before instanceof HTMLElement && before !== document.body && before.isConnected
        && (!now || now === document.body || root.contains(now))) {
        before.focus({ preventScroll: true });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(
      "textarea, input, button, select, a[href], [tabindex]:not([tabindex='-1'])",
    )).filter((e) => !e.hasAttribute("disabled") && e.offsetParent !== null);
    const first = root.querySelector<HTMLElement>("textarea, input") ?? focusables()[0]
      ?? (root.hasAttribute("tabindex") ? root : undefined);
    first?.focus({ preventScroll: true });
    // the caret at the end of any words already there
    if (first instanceof HTMLTextAreaElement || first instanceof HTMLInputElement) {
      try { first.setSelectionRange(first.value.length, first.value.length); } catch { /* not a text field */ }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, dep]);
}

// A small arrow drawn as an SVG, since Figtree has no arrow glyphs.
export function Arrow() {
  return (
    <Box component="svg" viewBox="0 0 24 24" aria-label="becomes" role="img" sx={{
      width: 14, height: 14, verticalAlign: "-2px", mx: 0.25, fill: "none", stroke: "currentColor",
      strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round",
    }}>
      <path d="M4 12h15M13 6l6 6-6 6" />
    </Box>
  );
}

export const shortDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
