// Working out, from a click, what the tester meant: a piece of text to
// suggest new words for, something to comment on, or a spot on the map; and
// a plain name for where it was ("Legend", "What the map shows",
// "Methodology: ..., section ...") plus a selector to find it again later.
// All best effort: the app was not built with feedback in mind, so these
// lean on its structure (data-guide names, card titles, MapLibre's classes)
// and on data-feedback-area labels where the app adds them.
import { COUNTIES, HAZARDS } from "../config";

// Anything inside an element with this attribute belongs to feedback mode
// itself, and is left to work as usual.
export const UI_ATTR = "data-feedback-ui";
// Left out of the screenshot (the hover outline, the popover, the pins).
export const SKIP_ATTR = "data-feedback-skip";

export const inFeedbackUi = (el: Element | null) => !!el?.closest(`[${UI_ATTR}]`);
export const isMapCanvas = (el: Element | null) => !!el && el.classList.contains("maplibregl-canvas");

export const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

// The app works as usual in feedback mode (the user asked for that on
// 2026-11-20, so testers can draw a hazard and get alternate routes with the
// mode on): a plain click on any control does what it always does, and
// Alt+click (Option on a Mac) gives feedback on it. A control is anything a
// click works: links (an <a href>, MUI's Link), buttons, tabs, switches,
// checkboxes, radios, sliders, pulldowns and their options, menu items,
// text boxes, MapLibre's own buttons and markers, and anything marked
// data-feedback-pass for a control none of those catch. A label is not one:
// its words are text to suggest on, though a click on them would tick its
// box; the box itself is the control.
export const PASS_ATTR = "data-feedback-pass";
const CONTROL_SEL = [
  "a[href]", ".MuiLink-root", "button", "summary", "input", "select", "textarea", "[contenteditable=true]",
  "[role=button]", "[role=link]", "[role=tab]", "[role=switch]", "[role=checkbox]", "[role=radio]",
  "[role=slider]", "[role=combobox]", "[role=option]", "[role=menuitem]", "[role=menuitemradio]",
  "[role=menuitemcheckbox]", "[role=textbox]", "[role=spinbutton]", ".MuiSlider-root", ".MuiSelect-select",
  `[${PASS_ATTR}]`, ".maplibregl-ctrl button", ".maplibregl-popup-close-button", ".maplibregl-marker",
].join(",");
export function controlAt(el: Element | null): HTMLElement | null {
  if (!el) return null;
  const c = el.closest(CONTROL_SEL);
  if (!(c instanceof HTMLElement) || inFeedbackUi(c)) return null;
  // A slider's thumb and its hidden input are parts of the one slider.
  return c.closest<HTMLElement>(".MuiSlider-root") ?? c;
}

// What a comment on a control is about: a checkbox or switch together with
// its label (the legend rows, the services), else the control itself.
const TICKS = "input[type=checkbox], input[type=radio], [role=checkbox], [role=switch], [role=radio]";
export function controlBox(c: HTMLElement): HTMLElement {
  if (!c.matches(TICKS)) return c;
  const label = c.closest<HTMLElement>("label, .MuiFormControlLabel-root");
  return label && !inFeedbackUi(label) ? label : c;
}

// The see-through layer behind an open menu, drawer or dialog. A click on it
// closes what is open, so it always works as usual, Alt or not: there is
// nothing on it to give feedback about. A MUI dialog is closed by a click on
// its container around the box (the container itself, not what is in it).
export const isBackdrop = (el: Element | null) => !!el && !inFeedbackUi(el)
  && (el.matches(".MuiDialog-container") || !!el.closest(".MuiBackdrop-root, .MuiModal-backdrop"));

// A control's own words, for a suggestion about them (a link inside a
// paragraph gives the link, not the paragraph), or null when it has none to
// change: the logo, a text box, or a close X whose only text is the "×"
// glyph. A checkbox or switch gives the words of its label.
export function controlText(c: HTMLElement): HTMLElement | null {
  const box = controlBox(c);
  if (box !== c) {
    // the first words in the label, as a click on them would pick
    const walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!/[\p{L}\p{N}]/u.test(n.textContent ?? "") || !n.parentElement) continue;
      const t = textBlockAt(n.parentElement);
      if (t) return t;
    }
    return null;
  }
  const text = collapse(c.innerText ?? "");
  if (!/[\p{L}\p{N}]/u.test(text) || text.length > 4000 || c.querySelector("input, textarea, select")) return null;
  return c;
}

function ownText(el: Element): string {
  let s = "";
  el.childNodes.forEach((n) => { if (n.nodeType === Node.TEXT_NODE) s += n.textContent ?? ""; });
  return s.trim();
}

const NO_TEXT = new Set(["INPUT", "TEXTAREA", "SELECT", "OPTION", "CANVAS", "IMG", "VIDEO", "IFRAME"]);
const MAX_TEXT = 4000;

// The block of text a click landed in, or null when it landed on something
// that is not text (padding, an icon, a control, the map). A click on a bold
// word or a link inside a paragraph gives the whole paragraph, since the
// suggestion is about the sentence it sits in.
export function textBlockAt(start: Element): HTMLElement | null {
  if (!(start instanceof HTMLElement) || NO_TEXT.has(start.tagName) || start.isContentEditable) return null;
  if (!ownText(start)) return null;
  let el: HTMLElement = start;
  while (el.parentElement && el.parentElement !== document.body && getComputedStyle(el).display === "inline") {
    el = el.parentElement;
  }
  const text = collapse(el.innerText ?? "");
  if (!text || text.length > MAX_TEXT) return null;
  // a block that holds a control as well (a label around a checkbox) is
  // fine; one that holds a text box is not text to rewrite
  if (el.querySelector("input:not([type=checkbox]):not([type=radio]), textarea, select")) return null;
  return el;
}

// The thing to comment on: the nearest card, control, popup or region
// around the click, or the element itself.
const COMMENT_SEL = [
  "[data-feedback-area]", ".maplibregl-popup", ".maplibregl-marker", ".maplibregl-ctrl",
  "button", "a[href]", "[role=button]", "[role=tab]", "[role=switch]", "[role=checkbox]", "[role=slider]",
  ".MuiSlider-root", ".MuiInputBase-root", ".MuiFormControlLabel-root", "label",
  "input", "select", "textarea", "[data-guide]", "[role=dialog]", "[role=region]", "header",
].join(",");
export function commentTargetAt(start: Element): HTMLElement {
  const el = start.closest(COMMENT_SEL);
  if (el instanceof HTMLElement) return el;
  let h: Element | null = start;
  while (h && !(h instanceof HTMLElement)) h = h.parentElement;   // out of an SVG
  return (h as HTMLElement | null) ?? document.body;
}

// ------------------------------------------------------------ names for places --

const text1 = (el: Element | null | undefined) => collapse((el as HTMLElement | null)?.innerText ?? el?.textContent ?? "");
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 3).trimEnd()}...` : s);

// The title of the card an element sits in: the first title-like child of
// the nearest ancestor that has one, stopping at `stop`.
function cardTitle(el: Element, stop: Element | null): string {
  for (let a: Element | null = el; a && a !== stop && a !== document.body; a = a.parentElement) {
    const h = a.querySelector(":scope > .MuiTypography-subtitle2, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6");
    if (h) return text1(h);
  }
  return "";
}

const GUIDE_NAMES: Record<string, string> = { legend: "Legend", services: "Services" };

export interface Place { area: string; doc?: string }

export function placeOf(el: Element): Place {
  // The methodology and notes reader: which note, and which section of it.
  const notes = el.closest('[aria-labelledby="notes-title"]');
  if (notes) {
    const title = text1(notes.querySelector("#notes-title")) || "Methodology";
    const doc = notes.getAttribute("data-doc") ?? undefined;
    let section = "";
    notes.querySelectorAll("h2, h3").forEach((h) => {
      if (h === el || h.contains(el) || (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) section = text1(h);
    });
    return { area: `Methodology: ${title}${section ? `, section ${short(section, 80)}` : ""}`, doc };
  }
  const tagged = el.closest("[data-feedback-area]");
  if (tagged) return { area: tagged.getAttribute("data-feedback-area") || "Page" };
  const popup = el.closest(".maplibregl-popup");
  if (popup) {
    if (popup.classList.contains("hazard-pop")) return { area: "Hazard popup" };
    // its first line, usually the road's name. MapLibre's close button sits
    // inside the content, so its text is skipped, or the label would start
    // with the close glyph and run the popup's lines together.
    const content = popup.querySelector<HTMLElement>(".maplibregl-popup-content");
    const closeText = new Set(Array.from(popup.querySelectorAll<HTMLElement>(".maplibregl-popup-close-button"))
      .map((b) => collapse(b.innerText || b.textContent || "")).filter(Boolean));
    const line = (content?.innerText ?? content?.textContent ?? "").split("\n").map(collapse)
      .find((l) => l && !closeText.has(l) && l !== "×") ?? "";
    const cut = line.search(/[.!?:]\s/);
    const first = cut > 0 ? line.slice(0, cut) : line;
    // "Main Street popup", not "Popup: Main Street": the popover's title
    // already reads "Comment on: ..."
    return { area: first ? `${short(first, 50)} popup` : "Popup" };
  }
  const guide = el.closest("[data-guide]");
  if (guide) {
    const g = guide.getAttribute("data-guide") ?? "";
    return { area: GUIDE_NAMES[g] ?? (cardTitle(el, guide.parentElement) || g.replace(/[-_]/g, " ")) };
  }
  const tab = el.closest("[role=tab]");
  if (tab) return { area: text1(tab) ? `${text1(tab)} tab` : "Tabs" };
  if (el.closest("header")) return { area: "Title bar" };
  if (el.closest(".maplibregl-ctrl")) return { area: "Map buttons" };
  const dialog = el.closest("[role=dialog]");
  if (dialog) {
    const by = dialog.getAttribute("aria-labelledby");
    const name = dialog.getAttribute("aria-label") || (by ? text1(document.getElementById(by)) : "");
    return { area: name ? `${short(name)} dialog` : "Dialog" };
  }
  const drawer = el.closest(".MuiDrawer-paper");
  if (drawer) return { area: cardTitle(el, drawer) || "Panel" };
  if (el.closest(".maplibregl-map")) return { area: cardTitle(el, el.closest(".maplibregl-map")) || "Map" };
  return { area: cardTitle(el, null) || "Page" };
}

// A spot on the map: the hazard or county from the hash, and the zoom.
export function mapPlace(zoom: number): string {
  const p = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const tab = p.get("tab");
  const hz = HAZARDS.find((h) => h.id === p.get("hazard"));
  const county = COUNTIES.find((c) => c.id === p.get("county"));
  const where = tab === "pinch" ? "" : tab !== "detour" && p.has("run") ? "drawn hazard"
    : tab !== "detour" && hz ? hz.label : county?.label ?? "";
  return `Map${where ? `, ${where}` : ""}, zoom ${Math.round(zoom)}`;
}

// ------------------------------------------------------------ finding it again --

const STABLE_ANCHORS = ["data-feedback-area", "data-guide", "aria-labelledby"];
const cssEsc = (s: string) => (window.CSS?.escape ? window.CSS.escape(s) : s.replace(/["\\]/g, "\\$&"));

// A path from the nearest stable anchor (a labeled region, a guide name, a
// popup, an id that is not one MUI makes up) down to the element.
export function selectorFor(el: Element): string {
  const parts: string[] = [];
  for (let e: Element | null = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    if (e.id && !/[:]|^mui-|^:r/.test(e.id)) { parts.unshift(`#${cssEsc(e.id)}`); return parts.join(" > "); }
    const attr = STABLE_ANCHORS.find((a) => e!.hasAttribute(a));
    if (attr) { parts.unshift(`[${attr}="${cssEsc(e.getAttribute(attr) ?? "")}"]`); return parts.join(" > "); }
    if (e.classList.contains("maplibregl-popup")) { parts.unshift(".maplibregl-popup"); return parts.join(" > "); }
    const tag = e.tagName.toLowerCase();
    const parent: Element | null = e.parentElement;
    if (!parent) { parts.unshift(tag); break; }
    const same = Array.from(parent.children).filter((c) => c.tagName === e!.tagName);
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(e) + 1})` : tag);
  }
  return `body > ${parts.join(" > ")}`;
}

// The element again: by its selector when that still points at the same
// words, else by its words alone.
export function findTarget(selector?: string, original?: string): HTMLElement | null {
  let el: Element | null = null;
  if (selector) { try { el = document.querySelector(selector); } catch { el = null; } }
  const want = original ? collapse(original) : "";
  if (el instanceof HTMLElement && (!want || collapse(el.innerText ?? "") === want)) return el;
  if (want) {
    let best: HTMLElement | null = null;
    const all = document.body.querySelectorAll<HTMLElement>("p, li, h1, h2, h3, h4, h5, h6, span, div, label, button, td, th, a");
    for (const c of Array.from(all)) {
      if (c.closest(`[${UI_ATTR}]`)) continue;
      if (collapse(c.innerText ?? "") === want) best = c;      // the last match is the innermost
    }
    if (best) return best;
  }
  return el instanceof HTMLElement ? el : null;
}

// Whether a mouse press landed on an element's scroll bar rather than in it,
// so dragging a scroll bar still works in feedback mode.
export function onScrollbar(e: MouseEvent): boolean {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  return (el.scrollHeight > el.clientHeight && e.clientX > r.left + el.clientLeft + el.clientWidth)
    || (el.scrollWidth > el.clientWidth && e.clientY > r.top + el.clientTop + el.clientHeight);
}
