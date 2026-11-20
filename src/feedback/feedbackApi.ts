// Feedback mode's side of the feedback Lambda function (feedback_api/ in this
// repo): whether a feedback link was opened, whether feedback has ended, the
// tester's code for this visit, who the tester is, what they have sent, and
// every call to the server. All the calls are in this one file so that the
// paths, the header and the body's shape can be changed in one place.
//
//   POST  {feedbackApi()}/feedback        {code, item, screenshot?} -> {id}
//   GET   {feedbackApi()}/health          {ends_at, ended, ...}, once a visit
//   GET   {INBOX}/feedback?source=&after= x-feedback-admin -> {items: [...], next}   (dev only)
//   GET   {INBOX}/feedback/<id>.jpg?source=                -> the screenshot
//   PATCH {INBOX}/feedback/<id>?source=   {status, note?}
//   DELETE {INBOX}/feedback/<id>?source=local                 test feedback only
//   POST  {INBOX}/feedback/clear?source=local {confirm: "clear"}  every local item
//
// Where feedback goes: the published site always sends to the function on
// AWS. The dev server follows the "This computer / AWS (live)" switch the two
// on-demand tools use: This computer is feedback_api/local_server.py on
// 127.0.0.1:8788, which `npm run dev:local` starts. VITE_FEEDBACK_API_BASE
// overrides either. The inbox only ever talks to that local server, since
// nothing on AWS reads feedback back; its own "Read from" setting picks which
// store it reads there (source=local, the folder on this computer, or
// source=aws, the real bucket through your own AWS login).
import { useSyncExternalStore } from "react";
import { api, ApiError, chosenTarget, TARGET_SWITCHABLE, type ApiTarget } from "../ondemandApi";

const trimBase = (s: string) => s.replace(/\/+$/, "");
const isLocalUrl = (u?: string) => !!u && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u);
const ENV_BASE: string | undefined = import.meta.env.VITE_FEEDBACK_API_BASE;
const AWS_FEEDBACK = trimBase(ENV_BASE && !isLocalUrl(ENV_BASE) ? ENV_BASE : "https://feedbackconnectivityviewer.nemac.org");
// Only the dev server knows the local address; a production build drops it
// with the rest of the DEV branch.
const LOCAL_FEEDBACK = import.meta.env.DEV
  ? trimBase(isLocalUrl(ENV_BASE) ? ENV_BASE! : "http://127.0.0.1:8788")
  : AWS_FEEDBACK;
const BUILT_FEEDBACK = trimBase(ENV_BASE ?? AWS_FEEDBACK);

// Where Feedback mode sends items and reads the end date: "local" or "aws".
export function feedbackTarget(): ApiTarget {
  if (!TARGET_SWITCHABLE) return isLocalUrl(BUILT_FEEDBACK) ? "local" : "aws";
  return chosenTarget();
}
// Read at call time, so the switch takes effect from the next item.
export function feedbackApi(): string {
  if (!TARGET_SWITCHABLE) return BUILT_FEEDBACK;
  return feedbackTarget() === "local" ? LOCAL_FEEDBACK : AWS_FEEDBACK;
}

// ------------------------------------------------------------ the items --

export type FeedbackKind = "words" | "comment";
export type FeedbackStatus = "open" | "done";

export interface FeedbackTarget {
  area: string;                    // a plain label: "Legend", "What the map shows", ...
  selector?: string;               // best effort, to find the element again
  doc?: string;                    // the methodology file, when in the note reader
  lnglat?: [number, number];       // a comment on a spot on the map
  zoom?: number;
}

export interface FeedbackItem {
  id: string;
  kind: FeedbackKind;
  name: string;
  tester_id: string;
  created_at: string;              // set by the server
  tab: string;
  url_hash: string;                // the viewer's hash when it was sent
  target: FeedbackTarget;
  original?: string;               // words: the text as it was
  suggested?: string;              // words: the text as the tester would have it
  why?: string;                    // words: optional reason
  text?: string;                   // comment
  viewport: { w: number; h: number };
  status: FeedbackStatus;
  done_at?: string | null;
  note?: string;
  screenshot?: string;             // a URL, if the server lists one
  source?: "local" | "aws";        // the inbox: the store it was read from
  // A copy of a drawn hazard's results or a set of alternate routes, sent
  // with "Something look wrong?" (see report.ts). At most 300 KB of JSON;
  // the server checks its type and size and keeps it as sent. Read back, it
  // is untrusted, and asContext() checks it before use.
  context?: unknown;
}

// What the browser sends; the server adds the id, the time and the status.
export type NewFeedback = Omit<FeedbackItem, "id" | "created_at" | "status" | "done_at" | "note" | "screenshot" | "source">;

// The server caps text too; cutting here keeps a long paste from being refused.
export const TEXT_CAP = 4000;
export const cap = (s: string) => s.slice(0, TEXT_CAP);

// ------------------------------------------------------------ the link --

// The tester link is <site>/#feedback. It holds no code: it only makes the
// switch show, which is remembered in localStorage so it still shows on the
// next visit. The code is typed into the dialog that turning Feedback on
// opens, like the access codes of the drawing and routes tools, so it is never
// in an address that gets copied, shared or kept in the browser's history.
// The link is read when this module is first imported, which is before App
// reads the hash, so a link that holds only #feedback counts as a plain
// address.
const LINK_KEY = "feedbackLink";
const CODE_KEY = "feedbackCode";
const NAME_KEY = "feedbackName";
const TESTER_KEY = "feedbackTesterId";
// exported for store.ts, which reloads the list when another tab changes it
export const MINE_KEY = "feedbackMine";

function readStore(k: string): string | null {
  try { return window.localStorage.getItem(k); } catch { return null; }
}
function writeStore(k: string, v: string) {
  try { window.localStorage.setItem(k, v); } catch { /* kept for this visit only */ }
}

let linkSeen = false;
// Takes #feedback (or an old #feedback=<anything>, which is no longer read
// as a code) out of the address. True when it did. Also run on hashchange
// (see store.ts): a link pasted into a tab that already has the viewer open
// changes only the hash and does not reload.
export function takeFeedbackLink(): boolean {
  if (typeof window === "undefined") return false;
  const p = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (!p.has("feedback")) return false;
  linkSeen = true;
  writeStore(LINK_KEY, "1");
  p.delete("feedback");
  const rest = p.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${rest ? `#${rest}` : ""}`);
  return true;
}

// The code lives in sessionStorage only, so it is gone when the tab closes
// and has to be typed again on the next visit. A wrong code (401) clears it.
let codeNow = "";
function readCode(): string {
  try { return window.sessionStorage.getItem(CODE_KEY) ?? ""; } catch { return ""; }
}
if (typeof window !== "undefined") {
  // An earlier version kept a code from the link in localStorage. It is
  // dropped so no code outlives the visit; that tester still saw a link.
  if (readStore(CODE_KEY) !== null) {
    writeStore(LINK_KEY, "1");
    try { window.localStorage.removeItem(CODE_KEY); } catch { /* nothing to drop */ }
  }
  linkSeen = readStore(LINK_KEY) === "1";
  codeNow = readCode();
  takeFeedbackLink();
}

export function feedbackCode(): string { return codeNow; }
export function setFeedbackCode(code: string) {
  codeNow = code.trim();
  try { window.sessionStorage.setItem(CODE_KEY, codeNow); } catch { /* kept in memory for this page */ }
}
export function clearFeedbackCode() {
  codeNow = "";
  try { window.sessionStorage.removeItem(CODE_KEY); } catch { /* nothing stored */ }
}

// The switch shows only for people who opened a feedback link, until
// feedback has ended, and always on the dev server (which says it has ended,
// in the strip, rather than hiding it).
export function feedbackEnabled(): boolean {
  return import.meta.env.DEV || (linkSeen && !endedNow());
}

// ------------------------------------------------------------ the end date --

// Feedback is temporary: the function on AWS stops taking it after an end
// date and says when in GET /health (ends_at). The page asks once a visit,
// only for someone who opened a feedback link (and on the dev server), and
// keeps the answer in sessionStorage, so testers who are done never see a
// switch that would only be refused, and other visitors never call the
// function at all. A 410 from a POST counts as the same answer.
const HEALTH_KEY = "feedbackEndsAt";
interface EndInfo { endsAt: number | null; ended: boolean }
let endInfo: EndInfo | null = null;
// The dev server asks again on every load and whenever the switch points
// somewhere else, since the copy on this computer and AWS can differ.
if (typeof window !== "undefined" && !import.meta.env.DEV) {
  try {
    const raw = window.sessionStorage.getItem(HEALTH_KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (v && typeof v === "object") endInfo = { endsAt: typeof v.endsAt === "number" ? v.endsAt : null, ended: !!v.ended };
  } catch { /* asked again */ }
}
function keepEndInfo(e: EndInfo) {
  endInfo = e;
  try { window.sessionStorage.setItem(HEALTH_KEY, JSON.stringify(e)); } catch { /* kept for this page */ }
}
function endedNow(): boolean {
  if (!endInfo) return false;
  return endInfo.ended || (endInfo.endsAt != null && Date.now() >= endInfo.endsAt);
}
// Whether feedback has ended, and when it ends or ended (null: no end date,
// or not known yet).
export function feedbackEnd(): { ended: boolean; endsAt: Date | null } {
  return { ended: endedNow(), endsAt: endInfo?.endsAt != null ? new Date(endInfo.endsAt) : null };
}

// Resolves true when this call learned something new (so the switch and the
// strip should look again). Never throws: if the function cannot be reached,
// the switch stays, and a POST will say what is wrong.
let healthAsked: { base: string; p: Promise<boolean> } | null = null;
export function checkFeedbackEnd(): Promise<boolean> {
  if (typeof window === "undefined" || !(linkSeen || import.meta.env.DEV)) return Promise.resolve(false);
  if (endInfo && !import.meta.env.DEV) return Promise.resolve(false);
  const base = feedbackApi();
  if (healthAsked?.base === base) return healthAsked.p;
  // what the other place said no longer applies
  if (import.meta.env.DEV) endInfo = null;
  const p = (async () => {
    const ctl = new AbortController();
    const t = window.setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(`${base}/health`, { cache: "no-store", signal: ctl.signal });
      if (!res.ok) return false;
      const d = await res.json();
      const at = typeof d?.ends_at === "string" ? Date.parse(d.ends_at) : NaN;
      if (healthAsked?.base !== base) return false;   // the switch moved on meanwhile
      keepEndInfo({ endsAt: Number.isFinite(at) ? at : null, ended: d?.ended === true });
      return true;
    } catch {
      return false;
    } finally {
      window.clearTimeout(t);
    }
  })();
  healthAsked = { base, p };
  return p;
}
// A POST was refused with 410: feedback has ended.
function markEnded() {
  keepEndInfo({ endsAt: endInfo?.endsAt ?? null, ended: true });
}

export function loadName(): string { return readStore(NAME_KEY) ?? ""; }
export function saveName(name: string) { writeStore(NAME_KEY, name.trim()); }

// A random id this browser keeps, so one tester's items can be told apart
// even if two people give the same name.
export function testerId(): string {
  let id = readStore(TESTER_KEY);
  if (!id) {
    const b = new Uint8Array(8);
    try { crypto.getRandomValues(b); } catch { for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256); }
    id = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    writeStore(TESTER_KEY, id);
  }
  return id;
}

// ------------------------------------------------------------ what I sent --

// Testers see only their own feedback, and only from this browser: what was
// sent is kept here, numbered in the order sent, for the pins.
export interface MineItem {
  id: string;
  n: number;
  // where it was sent; missing on items sent before this was kept, which
  // are taken as sent to this computer
  to?: ApiTarget;
  kind: FeedbackKind;
  tab: string;
  area: string;
  selector?: string;
  lnglat?: [number, number];
  zoom?: number;
  original?: string;
  suggested?: string;
  text?: string;
  created_at: string;
}
export function loadMine(): MineItem[] {
  try {
    const v = JSON.parse(readStore(MINE_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === "string") : [];
  } catch { return []; }
}
export function saveMine(list: MineItem[]) { writeStore(MINE_KEY, JSON.stringify(list)); }
// Forgets what this browser sent: its pins and its "N sent" count, which is
// the length of this list. Only for test feedback, from the dev server.
export function forgetMine() {
  try { window.localStorage.removeItem(MINE_KEY); } catch { /* nothing stored */ }
}

// The viewer's hash without the keys that belong to feedback itself, which is
// what an item records as the place it was left: "#tab=...&...", or "" when
// there is nothing else. The server wants the leading "#" and drops any
// feedback= part itself too, so a tester code can never be stored.
export const OWN_KEYS = ["feedback", "inbox", "review", "fbshow"];
export function currentHash(): string {
  const p = hashParams(window.location.hash);
  OWN_KEYS.forEach((k) => p.delete(k));
  const s = p.toString();
  return s ? `#${s}` : "";
}
// A saved or current hash as parameters, with or without its "#".
export const hashParams = (h: string | null | undefined) => new URLSearchParams((h ?? "").replace(/^#/, ""));

// ------------------------------------------------------------ sending --

// Plain sentences for the tester. The server's own message is used for
// anything not listed here.
const POST_WORDS: Record<number, string> = {
  0: "Your feedback could not be sent. Check the connection and try again.",
  401: "That feedback code was not accepted. Type it again, then send.",
  403: "Feedback cannot be sent from this page.",
  404: "Feedback cannot be sent right now.",
  410: "Feedback has ended. Thank you for your help.",
  413: "The picture of the screen was too big. Try again with a smaller window.",
  429: "Too much feedback has come from here for now. Please try again later.",
  503: "Feedback is turned off for now.",
};

// A refusal that is about the picture alone: too big (413), or not read as
// a JPEG (400 naming the screenshot). The item is then sent again without
// it, since a picture that cannot be taken or sent must never stop the words.
const pictureRefused = (e: unknown) => e instanceof ApiError
  && (e.status === 413 || (e.status === 400 && /screenshot|picture|jpe?g/i.test(e.message)));

// A refused post, with the server's status, so the popover can tell a wrong
// code (401: ask for it again) from anything else.
export class PostError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function postFeedback(item: NewFeedback, screenshot: string | null): Promise<{ id: string; picture: boolean }> {
  const send = async (shot: string | null) => {
    // api() adds x-amz-content-sha256 for an https base, which CloudFront's
    // signed requests to the function need on a POST
    const out = await api<{ id: string }>(feedbackApi(), "/feedback", {
      code: feedbackCode(), item, ...(shot ? { screenshot: shot } : {}),
    });
    if (!out || typeof out.id !== "string") throw new ApiError(0, POST_WORDS[0]);
    return out.id;
  };
  try {
    try {
      return { id: await send(screenshot), picture: !!screenshot };
    } catch (e) {
      if (!screenshot || !pictureRefused(e)) throw e;
      return { id: await send(null), picture: false };
    }
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 0;
    // a wrong code is not kept, so the next try asks for it again
    if (status === 401) clearFeedbackCode();
    if (status === 410) markEnded();
    // a 429 from the server says which limit was reached and when it resets
    // (today's posts from here, everyone's for the day, or wrong codes);
    // the plain sentence is only for a 429 with no words, such as a rate rule
    const own = status === 429 && e instanceof ApiError && e.server ? e.message : null;
    throw new PostError(status, own ?? POST_WORDS[status] ?? (e instanceof Error ? e.message : POST_WORDS[0]));
  }
}

// ------------------------------------------------------------ the inbox (dev only) --

// The inbox code comes from .env.development.local, which only the dev
// server reads. A production build replaces import.meta.env.DEV with false and
// drops the branch, so the code never reaches dist/.
const ADMIN_CODE: string = import.meta.env.DEV ? (import.meta.env.VITE_FEEDBACK_ADMIN_CODE ?? "") : "";
export const ADMIN_READY: boolean = import.meta.env.DEV && ADMIN_CODE !== "";

const ADMIN_WORDS: Record<number, string> = {
  0: "The feedback could not be read. Check that the feedback server on this computer is running "
    + "(npm run dev:local starts it, or python3 feedback_api/local_server.py) and try again.",
  401: "The inbox code was not accepted. Check VITE_FEEDBACK_ADMIN_CODE in .env.development.local.",
  403: "The inbox works only from localhost:5190.",
  404: "The feedback server on this computer has no inbox. Start feedback_api/local_server.py.",
  429: "Too many wrong codes from here lately. Wait 10 minutes and try again.",
};

// An inbox call the server refused. `status` 401 or 429 means the code is
// wrong or this address is locked out: the inbox then stops calling until
// asked again by hand, since every wrong code counts toward the lockout.
export class AdminError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Which store the inbox reads on the local server: the folder on this
// computer, or the real bucket through your own AWS login. Its own setting,
// apart from the "This computer / AWS (live)" switch of the drawing and
// routes tools: reading the real testers' feedback must not send the tools'
// work, or new feedback, to AWS. Until it is first picked it starts where
// feedback is sent at page load, and it is remembered once picked.
export type FeedbackSource = "local" | "aws";
const INBOX_SOURCE_KEY = "feedbackInboxSource";
let inboxPref: FeedbackSource | null = null;
if (typeof window !== "undefined" && import.meta.env.DEV) {
  const v = readStore(INBOX_SOURCE_KEY);
  inboxPref = v === "local" || v === "aws" ? v : null;
}
let inboxStart: FeedbackSource | null = null;
export function inboxSource(): FeedbackSource {
  if (inboxPref) return inboxPref;
  if (!inboxStart) inboxStart = feedbackTarget();
  return inboxStart;
}
const sourceListeners = new Set<() => void>();
export function setInboxSource(s: FeedbackSource) {
  inboxPref = s;
  writeStore(INBOX_SOURCE_KEY, s);
  sourceListeners.forEach((l) => l());
}
export function useInboxSource(): FeedbackSource {
  return useSyncExternalStore(
    (l) => { sourceListeners.add(l); return () => { sourceListeners.delete(l); }; },
    inboxSource,
  );
}

const withSource = (path: string, source: FeedbackSource) =>
  `${path}${path.includes("?") ? "&" : "?"}source=${source}`;

async function adminFetch(path: string, source: FeedbackSource,
  init: { method?: string; body?: unknown } = {}): Promise<Response> {
  if (!ADMIN_READY) throw new AdminError(0, "Add VITE_FEEDBACK_ADMIN_CODE to .env.development.local to read the feedback.");
  // Always the server on this computer: it is the only one with an inbox. A
  // plain http address, so no body hash is needed.
  const headers: Record<string, string> = { "x-feedback-admin": ADMIN_CODE };
  let body: string | undefined;
  if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(`${LOCAL_FEEDBACK}${withSource(path, source)}`,
      { method: init.method ?? "GET", cache: "no-store", headers, body });
  } catch {
    throw new AdminError(0, ADMIN_WORDS[0]);
  }
  if (!res.ok) {
    let msg = "";
    try { const d = await res.clone().json(); if (typeof d?.error === "string") msg = d.error; } catch { /* no body */ }
    // the server's own sentence for a 403, which says whether the inbox is
    // off on that server or the origin is wrong
    throw new AdminError(res.status, (res.status === 403 && msg) || ADMIN_WORDS[res.status] || msg
      || `The API answered ${res.status}.`);
  }
  return res;
}

// Ids become paths and object keys, so only the server's own form is kept.
const ID = /^[0-9a-f]{32}$/;
// Pages of 100; the cap only stops a runaway loop.
const MAX_PAGES = 100;

export async function listFeedback(source: FeedbackSource = inboxSource()): Promise<FeedbackItem[]> {
  const all: FeedbackItem[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await adminFetch(`/feedback${after ? `?after=${encodeURIComponent(after)}` : ""}`, source);
    let data: any = null;
    try { data = await res.json(); } catch { /* unreadable */ }
    if (!data || !Array.isArray(data.items)) throw new AdminError(0, "The feedback list could not be read.");
    all.push(...(data.items as FeedbackItem[]));
    after = typeof data.next === "string" && ID.test(data.next) ? data.next : null;
    if (!after) break;
  }
  // each item keeps the store it came from, so its picture and its Done mark
  // go back there even if the switch has moved since
  return all.filter((x) => x && typeof x.id === "string" && ID.test(x.id))
    .map((x) => ({
      ...x, status: x.status === "done" ? "done" : "open", target: x.target ?? { area: "" },
      source: x.source === "aws" || x.source === "local" ? x.source : source,
    }));
}

// The screenshot as an object URL for an <img>, or null when there is none.
// An <img> cannot send the inbox header, so it is fetched here and kept, by
// store and id.
const shots = new Map<string, Promise<string | null>>();
export function fetchScreenshot(item: Pick<FeedbackItem, "id" | "source">): Promise<string | null> {
  const { id } = item;
  const source = item.source ?? inboxSource();
  if (!ID.test(id)) return Promise.resolve(null);
  const key = `${source}:${id}`;
  let p = shots.get(key);
  if (!p) {
    p = adminFetch(`/feedback/${encodeURIComponent(id)}.jpg`, source)
      .then((r) => r.blob())
      .then((b) => (b.size ? URL.createObjectURL(b) : null))
      .catch(() => null);
    shots.set(key, p);
  }
  return p;
}

export async function setFeedbackStatus(item: Pick<FeedbackItem, "id" | "source">, status: FeedbackStatus,
  note?: string): Promise<void> {
  await adminFetch(`/feedback/${encodeURIComponent(item.id)}`, item.source ?? inboxSource(), {
    method: "PATCH", body: { status, ...(note !== undefined ? { note } : {}) },
  });
}

// Deleting is only for test feedback in the folder on this computer: the
// server refuses source=aws, and these never send it, so real feedback in the
// bucket can never be deleted from the inbox.
export async function deleteLocalFeedback(id: string): Promise<void> {
  if (!ID.test(id)) throw new AdminError(0, "That item could not be deleted.");
  await adminFetch(`/feedback/${encodeURIComponent(id)}`, "local", { method: "DELETE" });
  dropScreenshot(`local:${id}`);
}

// Every item in the folder on this computer. The number deleted.
export async function clearLocalFeedback(): Promise<number> {
  const res = await adminFetch("/feedback/clear", "local", { method: "POST", body: { confirm: "clear" } });
  for (const key of Array.from(shots.keys())) if (key.startsWith("local:")) dropScreenshot(key);
  try { const d = await res.json(); return typeof d?.deleted === "number" ? d.deleted : 0; } catch { return 0; }
}

// A deleted item's picture: its object URL is let go rather than kept for
// the rest of the visit.
function dropScreenshot(key: string) {
  const p = shots.get(key);
  shots.delete(key);
  p?.then((u) => { if (u) URL.revokeObjectURL(u); });
}
