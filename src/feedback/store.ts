// The state feedback mode shares between its pieces (the switch in the title
// bar, the strip, the layer over the page, the inbox and the review list),
// kept outside React so that each piece can be dropped into App with no
// props threaded between them.
import { useSyncExternalStore } from "react";
import {
  ADMIN_READY, AdminError, FeedbackItem, FeedbackSource, FeedbackStatus, MineItem, checkFeedbackEnd,
  clearLocalFeedback, deleteLocalFeedback, feedbackCode, feedbackEnabled, feedbackEnd, forgetMine, inboxSource,
  listFeedback, loadMine, loadName, hashParams, MINE_KEY, saveMine, saveName, setFeedbackCode, setFeedbackStatus,
  takeFeedbackLink,
} from "./feedbackApi";
import type { Report } from "./report";

export type FeedbackView = "map" | "inbox" | "review";

// Something to outline and fly to: an item picked with Show in the inbox.
export interface ShowTarget {
  key: number;                 // changes on every Show, so the same item can be shown twice
  label: string;               // "Item 4, where it was left"
  n?: number;                  // the number on its pin
  area: string;
  selector?: string;
  original?: string;
  doc?: string;
  lnglat?: [number, number];
  zoom?: number;
}

// A "Something look wrong?" waiting for the mode to turn on (the name and
// code dialog may come first), and what to outline while it is answered.
export interface PendingReport { report: Report; el: HTMLElement | null }

// A Rebuild from the inbox: under way, or how it came out.
export interface RebuildState { state: "working" | "done" | "failed"; note: string; differs?: boolean }

interface State {
  on: boolean;                 // feedback mode
  askName: boolean;            // the name dialog is open
  name: string;
  mine: MineItem[];
  view: FeedbackView;          // dev only: the map, the inbox beside it, or the review list
  show: ShowTarget | null;
  report: PendingReport | null;
  // dev only: the item a pin was clicked for, picked out in the inbox; the
  // key changes with every click, so the same pin can be clicked twice
  selected: { id: string; key: number } | null;
  rebuilds: Record<string, RebuildState>;   // dev only, by item id
}

const ON_KEY = "feedbackOn";
function initialView(): FeedbackView {
  if (!import.meta.env.DEV || typeof window === "undefined") return "map";
  const p = hashParams(window.location.hash);
  return p.has("review") ? "review" : p.has("inbox") ? "inbox" : "map";
}

let state: State = {
  // On again after a reload in the same tab, but not on a new visit: the
  // code is kept for the visit only, so a new visit starts off and turning
  // it on asks for the code.
  on: (() => {
    try {
      return feedbackEnabled() && !!loadName() && !!feedbackCode() && window.localStorage.getItem(ON_KEY) === "1";
    } catch { return false; }
  })(),
  askName: false,
  name: typeof window === "undefined" ? "" : loadName(),
  mine: typeof window === "undefined" ? [] : loadMine(),
  view: initialView(),
  show: null,
  report: null,
  selected: null,
  rebuilds: {},
};
const listeners = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

// Another tab sent an item, deleted one or reset the pins: this tab reads
// the list again, or its next item would be saved with its old copy and
// bring back pins the other tab had reset. (The browser tells only the
// other tabs, never the one that made the change.) A null key is the whole
// of storage cleared.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === MINE_KEY || e.key === null) set({ mine: loadMine() });
  });
}

// A feedback link pasted into a tab that already shows the viewer: #feedback
// is taken from the hash as on a fresh load, and the switch shows at once.
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => { if (takeFeedbackLink()) { set({}); refreshFeedbackEnd(); } });
}

// Whether feedback has ended, asked of the function once a visit (see
// checkFeedbackEnd). On the published site an ended run hides the switch,
// and turns the mode off for a tester whose page was still on. The dev
// server keeps the switch and says so in the strip; it asks again when the
// switch between this computer and AWS moves (FeedbackStrip).
export function refreshFeedbackEnd() {
  checkFeedbackEnd().then((changed) => {
    if (!changed) return;
    if (feedbackEnd().ended && !import.meta.env.DEV && state.on) {
      try { window.localStorage.setItem(ON_KEY, "0"); } catch { /* off for this visit */ }
      set({ on: false, askName: false });
    } else {
      set({});
    }
  });
}
// The published site asks as soon as it loads (only someone who opened a
// feedback link: checkFeedbackEnd says so), so an ended run never shows the
// switch at all. The dev server asks only while the mode is on (the strip
// does), so a plain page load calls no server that may not be running.
if (typeof window !== "undefined" && !import.meta.env.DEV) refreshFeedbackEnd();
// A POST answered 410 (postFeedback has noted it): everything that shows the
// mode looks again.
export function feedbackEndedNow() { set({}); }

export function useFeedback(): State {
  return useSyncExternalStore(subscribe, () => state);
}
export const feedbackState = () => state;

// ------------------------------------------------------------ actions --

// Turning it on asks for whatever is missing first: the name (once ever) and
// the feedback code (once a visit), in the one dialog.
export function setOn(on: boolean) {
  // once feedback has ended the published site takes no more; the dev
  // server still may, to try things on this computer
  if (on && !import.meta.env.DEV && feedbackEnd().ended) { set({ report: null }); return; }
  if (on && (!state.name || !feedbackCode())) { set({ askName: true }); return; }
  try { window.localStorage.setItem(ON_KEY, on ? "1" : "0"); } catch { /* kept for this visit */ }
  set({ on, askName: false, ...(on ? {} : { report: null }) });
}
export function askName() { set({ askName: true }); }
// Closed without turning the mode on: a report that was waiting for it is
// dropped, so it does not open some time later.
export function closeNameDialog() { set({ askName: false, ...(state.on ? {} : { report: null }) }); }

// "Something look wrong?": the comment popover opens on this result once the
// mode is on, turning it on first (which asks for the name and code when
// they are not known yet).
export function reportProblem(report: Report, el: HTMLElement | null) {
  set({ report: { report, el } });
  if (!state.on) setOn(true);
}
export function takeReport(): PendingReport | null {
  const r = state.report;
  if (r) set({ report: null });
  return r;
}

// Dev only: a pin was clicked, so the inbox opens with its item picked out.
let selectKey = 0;
export function selectItem(id: string) {
  if (!import.meta.env.DEV) return;
  set({ selected: { id, key: ++selectKey } });
  if (state.view !== "inbox") setView("inbox");
}

export function setRebuild(id: string, r: RebuildState | null) {
  const rebuilds = { ...state.rebuilds };
  if (r) rebuilds[id] = r; else delete rebuilds[id];
  set({ rebuilds });
}
// Saving the dialog also turns the mode on, since that is what opened it the
// first time. `code` is given only when the dialog asked for it.
export function setName(name: string, code?: string) {
  if (code !== undefined) setFeedbackCode(code);
  saveName(name);
  set({ name: name.trim() });
  // Already on: a change of name only. Turning it on again would reopen the
  // dialog when a wrong code has cleared the code.
  if (state.on) { set({ askName: false }); return; }
  setOn(true);
}
export function addMine(item: Omit<MineItem, "n">) {
  const n = state.mine.reduce((m, x) => Math.max(m, x.n), 0) + 1;
  const mine = [...state.mine, { ...item, n }];
  saveMine(mine);
  set({ mine });
}
// Dev only: "Reset my sent count" in the strip. This browser's pins and
// count start again from none, wherever the items went; nothing on any
// server is touched.
export function resetMine() {
  if (!import.meta.env.DEV) return;
  forgetMine();
  set({ mine: [] });
}

// The view is kept in the hash (#inbox, #review) so a reload stays on it.
// The rest of the hash is left as App wrote it.
let lastView: FeedbackView = state.view;
// The view before the one now open, so the inbox can hand focus back to the
// button that opened the review list once that list closes.
export const previousView = () => lastView;
export function setView(view: FeedbackView) {
  if (!import.meta.env.DEV) return;
  lastView = state.view;
  const p = hashParams(window.location.hash);
  p.delete("inbox"); p.delete("review");
  if (view !== "map") p.set(view, "");
  window.history.replaceState(null, "", `#${p.toString()}`);
  // A pin's pick lasts while the inbox stays open. Leaving it drops the pick,
  // or the next opening would clear the filters, scroll and take focus for an
  // old pin all over again.
  set(view === "inbox" ? { view } : { view, selected: null });
}
export function useFeedbackView(): FeedbackView {
  return useSyncExternalStore(subscribe, () => state.view);
}

let showKey = 0;
export function setShow(t: Omit<ShowTarget, "key"> | null) {
  set({ show: t ? { ...t, key: ++showKey } : null });
}

// ------------------------------------------------------------ the inbox's list (dev only) --

interface ItemsState {
  items: FeedbackItem[];
  loading: boolean;
  error: string | null;
  loaded: boolean;
  // The server refused the inbox code (401) or has locked this address out
  // (429). Every wrong code counts toward the feedback server's lockout,
  // which also stops sending feedback from here, so nothing reloads by
  // itself until Refresh.
  blocked: boolean;
  // the store the list was read from (this computer's folder or the bucket)
  source: FeedbackSource | null;
}
let items: ItemsState = { items: [], loading: false, error: null, loaded: false, blocked: false, source: null };
const itemListeners = new Set<() => void>();
function setItems(patch: Partial<ItemsState>) {
  items = { ...items, ...patch };
  itemListeners.forEach((l) => l());
}
const subscribeItems = (l: () => void) => { itemListeners.add(l); return () => { itemListeners.delete(l); }; };

export function useFeedbackItems(): ItemsState {
  return useSyncExternalStore(subscribeItems, () => items);
}

const refused = (e: unknown) => e instanceof AdminError && (e.status === 401 || e.status === 429);

// Loads the list only when the inbox or the review list is open: `auto` is
// the inbox's own timer and the views opening, which stop after a refusal;
// Refresh is a person asking, which tries again.
let loading: { source: FeedbackSource; p: Promise<void> } | null = null;
export function reloadItems({ auto = false }: { auto?: boolean } = {}): Promise<void> {
  if (!ADMIN_READY) {
    setItems({ loaded: true, error: "Add VITE_FEEDBACK_ADMIN_CODE to .env.development.local to read the feedback." });
    return Promise.resolve();
  }
  if (auto && items.blocked) return Promise.resolve();
  const source = inboxSource();
  if (loading?.source === source) return loading.p;
  // Another store: its list replaces this one outright, never mixed in.
  if (items.source !== source) setItems({ items: [], loaded: false, error: null, source });
  setItems({ loading: true });
  const p: Promise<void> = listFeedback(source)
    .then((list) => {
      if (inboxSource() !== source) return;   // the switch moved while this loaded
      list.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
      setItems({ items: list, error: null, loaded: true, blocked: false, source });
    })
    .catch((e) => {
      if (inboxSource() !== source) return;
      setItems({ error: e instanceof Error ? e.message : String(e), loaded: true, blocked: refused(e) });
    })
    .finally(() => {
      if (loading?.p === p) { loading = null; setItems({ loading: false }); }
    });
  loading = { source, p };
  return p;
}

// Marked Done (or open again) at once on screen, and put back if the server
// refuses. Sent to the store the item was read from.
export async function markItem(id: string, status: FeedbackStatus): Promise<void> {
  const before = items.items;
  const item = before.find((x) => x.id === id);
  if (!item) return;
  setItems({
    items: before.map((x) => (x.id === id ? { ...x, status, done_at: status === "done" ? new Date().toISOString() : null } : x)),
  });
  try {
    await setFeedbackStatus(item, status);
  } catch (e) {
    setItems({ items: before, error: e instanceof Error ? e.message : String(e), ...(refused(e) ? { blocked: true } : {}) });
  }
}

// Dev only, test feedback on this computer only (the server refuses the
// bucket). Gone from the list once the server says so, not before, since a
// delete cannot be put back. This browser's own pin for it goes too, so it
// does not point at an item that is no longer there; the other pins keep
// their numbers.
export async function deleteItem(id: string): Promise<void> {
  await deleteLocalFeedback(id);
  if (items.source === "local") setItems({ items: items.items.filter((x) => x.id !== id) });
  if (state.mine.some((x) => x.id === id)) {
    const mine = state.mine.filter((x) => x.id !== id);
    saveMine(mine);
    set({ mine });
  }
  if (state.selected?.id === id) set({ selected: null });
  if (state.rebuilds[id]) setRebuild(id, null);
}

// Dev only: every item on this computer, and this browser's pins for them,
// since those pointed at the items just deleted. Pins for items sent to AWS
// (live) stay, with their numbers, as those items are still there; the "N
// sent" count, the length of the list, drops by the ones taken out.
export async function clearLocalItems(): Promise<number> {
  const n = await clearLocalFeedback();
  if (items.source === "local") setItems({ items: [] });
  const mine = state.mine.filter((x) => x.to === "aws");
  if (mine.length) saveMine(mine); else forgetMine();
  set({ mine });
  set({ selected: null, rebuilds: {}, show: null });
  return n;
}
