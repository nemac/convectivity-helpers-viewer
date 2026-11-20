// "Show" in the inbox and the review list: put the viewer back the way it
// was when an item was left, then outline the element or fly to the spot.
//
// The viewer reads most of its state from the hash only when the page loads,
// so unless App offers a way to apply a hash in place (onRestore, passed to
// FeedbackLayer), Show writes the item's hash and reloads, and the inbox picks
// the item up again from `fbshow` in the hash after the reload.
//
// An item's url_hash, selector and doc were sent by a tester, so none is
// trusted: the hash is only ever read as parameters and written back as
// "#" plus those parameters on this page (never used as a link or an
// address of its own), the selector is only tried inside try/catch, and
// the doc must be one of the viewer's own notes.
import { IMPROVE_NOTES, METHODOLOGY } from "../config";
import { FeedbackItem, OWN_KEYS, currentHash, hashParams } from "./feedbackApi";
import { ReportContext, asContext } from "./report";
import { RebuildState, feedbackState, setRebuild, setShow, setView } from "./store";

export interface AppHooks {
  // Apply a saved hash (tab, county, hazard, drive time, ...) without a
  // reload. Return true when done; false or absent means reload.
  onRestore?: (params: URLSearchParams) => boolean;
  // Open a methodology or notes file in the reader, by file name.
  onOpenDoc?: (file: string) => void;
  // Dev only: work a reported drawn hazard or set of routes out again (or
  // open it, while the server still has it) and say how it came out through
  // `tell`, as often as there is news.
  onRebuild?: (ctx: ReportContext, tell: (r: RebuildState) => void) => void;
}
let hooks: AppHooks = {};
export function registerAppHooks(h: AppHooks) { hooks = h; }

// Keys that do not change what is on screen enough to be worth a reload:
// the map's position (Show flies there anyway) and the panel's width.
const LOOSE = new Set(["lon", "lat", "zoom", "left", ...OWN_KEYS]);

function sameState(want: URLSearchParams, now: URLSearchParams): boolean {
  for (const [k, v] of want) if (!LOOSE.has(k) && now.get(k) !== v) return false;
  return true;
}

// The notes the reader can open, by file name.
const KNOWN_DOCS = new Set(
  [...Object.values(METHODOLOGY).flat(), ...Object.values(IMPROVE_NOTES).flat()].map((d) => d.file),
);

function docOpen(doc: string): boolean {
  try {
    const esc = window.CSS?.escape ? window.CSS.escape(doc) : doc.replace(/[^\w.-]/g, "");
    return !!document.querySelector(`[data-doc="${esc}"]`);
  } catch {
    return false;
  }
}

export function showItem(item: FeedbackItem, n: number, allowReload = true) {
  const label = `Item ${n}, where it was left`;
  const want = hashParams(item.url_hash);
  OWN_KEYS.forEach((k) => want.delete(k));
  if (!sameState(want, hashParams(currentHash()))) {
    if (!hooks.onRestore?.(want) && allowReload) {
      const p = new URLSearchParams(want);
      p.set("inbox", "");
      p.set("fbshow", item.id);
      window.history.replaceState(null, "", `#${p.toString()}`);
      window.location.reload();
      return;
    }
  }
  setView("inbox");
  const doc = item.target?.doc && KNOWN_DOCS.has(item.target.doc) ? item.target.doc : undefined;
  if (doc && !docOpen(doc)) hooks.onOpenDoc?.(doc);
  setShow({
    label, n, area: item.target?.area ?? "", selector: item.target?.selector,
    original: item.kind === "words" ? item.original : undefined, doc,
    lnglat: item.target?.lnglat, zoom: item.target?.zoom,
  });
}

// Rebuild in the inbox and the review list: the item's context, checked, is
// handed to the app, which opens the result or works it out again. The
// inbox shows how it went beside the item.
export function rebuildItem(item: FeedbackItem) {
  // The button stays focusable while its Rebuild runs (aria-disabled, so
  // keyboard focus is not dropped to the page), so a repeat press lands here.
  if (feedbackState().rebuilds[item.id]?.state === "working") return;
  const ctx = asContext(item.context);
  if (!ctx) { setRebuild(item.id, { state: "failed", note: "This item has no result that can be rebuilt." }); return; }
  if (!hooks.onRebuild) { setRebuild(item.id, { state: "failed", note: "Rebuild is not available on this page." }); return; }
  setView("inbox");
  setRebuild(item.id, { state: "working", note: "Rebuilding..." });
  hooks.onRebuild(ctx, (r) => setRebuild(item.id, r));
}
