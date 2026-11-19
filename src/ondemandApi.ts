// The two on-demand tools: drawing an area on Functional isolation and
// asking for alternate routes on Pinch points. Each talks to its own API
// (a Lambda behind its own subdomain). What the APIs take and return is
// written up in the analysis repo; this file holds the browser's side: where
// they are, the access code, the saved areas, and the measurements the
// drawing makes before anything is sent.
import { useSyncExternalStore } from "react";
import type { Bounds, Hazard } from "./config";

// ------------------------------------------------------------ where they are --

// A published build always uses the addresses it was built with (AWS unless
// VITE_*_API_BASE says otherwise). The dev server on localhost or 127.0.0.1
// can also switch between the copy on this computer (the Docker emulators
// that `npm run dev:local` starts, on localhost:8787) and AWS, with the
// "This computer / AWS (live)" toggle (TargetSwitch in OnDemand.tsx). The
// choice is one setting for both tools, kept in localStorage. Calls read the
// address through fiApi() and routesApi() at the moment they are made, so a
// switch takes effect from the next request.
const trimBase = (s: string) => s.replace(/\/+$/, "");
const ENV_FI = import.meta.env.VITE_FI_API_BASE;
const ENV_ROUTES = import.meta.env.VITE_ROUTES_API_BASE;
const isLocalUrl = (u?: string) => !!u && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u);
const BUILT = {
  fi: trimBase(ENV_FI ?? "https://functionalisolationapi.nemac.org"),
  routes: trimBase(ENV_ROUTES ?? "https://altroutesapi.nemac.org"),
};
const AWS_BASES = {
  fi: trimBase(ENV_FI && !isLocalUrl(ENV_FI) ? ENV_FI : "https://functionalisolationapi.nemac.org"),
  routes: trimBase(ENV_ROUTES && !isLocalUrl(ENV_ROUTES) ? ENV_ROUTES : "https://altroutesapi.nemac.org"),
};
// Only the dev server knows the local addresses; a production build drops
// them with the rest of the DEV branch.
const LOCAL_BASES = import.meta.env.DEV ? {
  fi: trimBase(isLocalUrl(ENV_FI) ? ENV_FI! : "http://localhost:8787/fi"),
  routes: trimBase(isLocalUrl(ENV_ROUTES) ? ENV_ROUTES! : "http://localhost:8787/routes"),
} : BUILT;

export type ApiTarget = "local" | "aws";
export const TARGET_SWITCHABLE: boolean = import.meta.env.DEV && typeof window !== "undefined"
  && ["localhost", "127.0.0.1"].includes(window.location.hostname);

const TARGET_KEY = "ondemandTarget";
let targetPref: ApiTarget | null = null;
if (TARGET_SWITCHABLE) {
  try {
    const v = window.localStorage.getItem(TARGET_KEY);
    if (v === "local" || v === "aws") targetPref = v;
  } catch { /* no stored choice */ }
}
// Whether the copy on this computer answered the last check (null: not
// checked yet).
let localUp: boolean | null = null;

// The target in use: never the local copy while it is not answering; else
// the reader's choice; else the local copy when it answers; else, before the
// first check, whatever the dev server was started with.
function currentTarget(): ApiTarget {
  if (!TARGET_SWITCHABLE) return isLocalUrl(BUILT.fi) ? "local" : "aws";
  if (localUp === false) return "aws";
  if (targetPref) return targetPref;
  if (localUp === true) return "local";
  return isLocalUrl(ENV_FI) ? "local" : "aws";
}
export function fiApi(): string {
  return TARGET_SWITCHABLE ? (currentTarget() === "local" ? LOCAL_BASES.fi : AWS_BASES.fi) : BUILT.fi;
}
export function routesApi(): string {
  return TARGET_SWITCHABLE ? (currentTarget() === "local" ? LOCAL_BASES.routes : AWS_BASES.routes) : BUILT.routes;
}

interface TargetSnap { target: ApiTarget; localUp: boolean | null }
let snap: TargetSnap = { target: currentTarget(), localUp };
const listeners = new Set<() => void>();
function emit() {
  const target = currentTarget();
  if (target === snap.target && localUp === snap.localUp) return;
  snap = { target, localUp };
  listeners.forEach((l) => l());
}
export function setApiTarget(t: ApiTarget) {
  targetPref = t;
  try { window.localStorage.setItem(TARGET_KEY, t); } catch { /* kept for this visit only */ }
  emit();
}

// Ask the local copy for its limits, with a short timeout. Used every 30
// seconds while anything is listening, and when the toggle is shown.
let checking: Promise<void> | null = null;
export function checkLocal(): Promise<void> {
  if (!TARGET_SWITCHABLE) return Promise.resolve();
  if (checking) return checking;
  checking = (async () => {
    const ctl = new AbortController();
    const t = window.setTimeout(() => ctl.abort(), 2500);
    let up = false;
    try {
      const res = await fetch(`${LOCAL_BASES.fi}/limits`, { cache: "no-store", signal: ctl.signal });
      up = res.ok;
    } catch { up = false; }
    window.clearTimeout(t);
    localUp = up;
    checking = null;
    emit();
  })();
  return checking;
}
let checkTimer: number | undefined;
function subscribe(l: () => void) {
  listeners.add(l);
  if (TARGET_SWITCHABLE && checkTimer === undefined) {
    checkLocal();
    checkTimer = window.setInterval(checkLocal, 30_000);
  }
  return () => {
    listeners.delete(l);
    if (!listeners.size && checkTimer !== undefined) { window.clearInterval(checkTimer); checkTimer = undefined; }
  };
}
// The target in use and whether the local copy answers, re-rendering the
// caller when either changes.
export function useApiTarget(): TargetSnap {
  return useSyncExternalStore(subscribe, () => snap);
}

// The localhost code comes from .env.development.local, which only the dev
// server reads. A production build replaces import.meta.env.DEV with false and
// drops this branch, so the code never reaches dist/.
// Each tool has its own pair of codes (one for the published site, one for
// localhost:5190), so the routes tool reads its own localhost code too.
const LOCAL_CODES = {
  fi: import.meta.env.DEV ? (import.meta.env.VITE_ONDEMAND_LOCAL_CODE ?? "") : "",
  routes: import.meta.env.DEV ? (import.meta.env.VITE_ROUTES_LOCAL_CODE ?? "") : "",
};
export type Tool = keyof typeof LOCAL_CODES;

// Whether the two tools show at all. The APIs are not on AWS yet, so a
// production build leaves them out unless it is made with VITE_ONDEMAND_LIVE=1.
// The dev server always shows them.
export const ONDEMAND_LIVE: boolean = import.meta.env.DEV || import.meta.env.VITE_ONDEMAND_LIVE === "1";

// The code, once the server has accepted it, is remembered for the visit only
// (sessionStorage), never across visits. Each tool remembers its own.
const CODE_KEYS: Record<Tool, string> = { fi: "ondemandCode", routes: "ondemandRoutesCode" };
export function rememberedCode(tool: Tool = "fi"): string {
  const local = LOCAL_CODES[tool];
  try { return window.sessionStorage.getItem(CODE_KEYS[tool]) ?? local; } catch { return local; }
}
export function hasRememberedCode(tool: Tool = "fi"): boolean {
  return rememberedCode(tool) !== "";
}
export function rememberCode(code: string, tool: Tool = "fi") {
  try { window.sessionStorage.setItem(CODE_KEYS[tool], code); } catch { /* not remembered */ }
}
export function forgetCode(tool: Tool = "fi") {
  try { window.sessionStorage.removeItem(CODE_KEYS[tool]); } catch { /* nothing stored */ }
}

// ------------------------------------------------------------ the requests --

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Plain sentences for when the server cannot be reached or says nothing.
const FALLBACK: Record<number, string> = {
  0: "The tool could not be reached. Check the connection and try again.",
  400: "The tool could not use that request.",
  401: "That access code is not right.",
  403: "This page is not allowed to use the tool.",
  404: "This area has expired or was never saved.",
  429: "No more are left today. More are available tomorrow.",
  503: "The tool is turned off for the rest of the month.",
};

// The body's SHA-256 in hex. On AWS, CloudFront signs every request to the
// APIs' Function URLs, and Lambda will not take a signed POST without this
// hash in the x-amz-content-sha256 header. It is sent only to an https API
// (the local proxy neither needs nor allows it), and left off where the
// browser offers no crypto.subtle.
async function sha256Hex(text: string): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}

export async function api<T>(base: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    let init: RequestInit = { cache: "no-store" };
    if (body !== undefined) {
      const text = JSON.stringify(body);
      const hash = base.startsWith("https://") ? await sha256Hex(text) : null;
      init = {
        method: "POST", cache: "no-store", body: text,
        headers: { "Content-Type": "application/json", ...(hash ? { "x-amz-content-sha256": hash } : {}) },
      };
    }
    try {
      res = await fetch(`${base}${path}`, init);
    } catch (first) {
      // One quiet retry when the connection fails. On AWS the first request
      // in a county can take half a minute while that county's data loads,
      // and a dropped answer then looked like "could not be reached" though
      // the routes were found. Only for reads and route requests: a drawn
      // area is never sent twice.
      if (body !== undefined && path !== "/routes") throw first;
      await new Promise((r) => setTimeout(r, 1500));
      res = await fetch(`${base}${path}`, init);
    }
  } catch {
    throw new ApiError(0, FALLBACK[0]);
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    throw new ApiError(res.status, typeof data?.error === "string" && data.error
      ? data.error : FALLBACK[res.status] ?? "Something went wrong. Please try again.");
  }
  if (data == null) throw new ApiError(0, "The tool's answer could not be read. Please try again.");
  return data as T;
}

export interface FiLimits {
  runs_left: number; runs_limit: number; big_left: number; big_limit: number;
  resets_at: string; first_week: boolean;
  turned_off?: boolean;      // switched off, or the month's cost cap is reached
}
export interface RouteLimits {
  routes_left: number; routes_limit: number; resets_at: string; first_week: boolean; turned_off?: boolean;
}

export interface RunPosted {
  run_id: string; status: "running"; name: string; area: string; county: string; big: boolean;
  created_at: string; expires_at: string; runs_left: number; big_left: number;
}
export type ClassRanges = Record<"log10" | "geometric" | "quantile", ([number, number] | null)[]>;
export interface RunStats {
  losing: number; isolated_segments: number; isolated_buildings: number; hazard_buildings: number;
  closed_roads: number; closed_road_m: number; isolated_road_m: number; segments_out: number;
  class_ranges: ClassRanges; few_losing: boolean; run_s: number;
  release?: string;
}
export interface RunStatus {
  run_id: string; name: string; status: "running" | "done" | "failed"; progress: string;
  created_at: string; expires_at: string; area: string; county: string; big?: boolean;
  error?: string;
  stats?: RunStats;
  files?: { roads: string; hazard: string; study_area: string; hazard_buildings: string };
}

// ------------------------------------------------------------ saved areas --

// The areas drawn in this browser, kept until their results expire. Only what
// the list needs, plus the outline so a run still going can be shown.
export interface SavedArea {
  run_id: string; name: string; created_at: string; expires_at: string; county: string;
  status: "running" | "done" | "failed";
  geometry?: [number, number][];
  // where it was run, set only on the dev server's toggle (TARGET_SWITCHABLE)
  target?: ApiTarget;
}
const AREAS_KEY = "ondemandAreas";
export function loadAreas(): SavedArea[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(AREAS_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((a) => a && typeof a.run_id === "string") : [];
  } catch { return []; }
}
export function saveAreas(list: SavedArea[]) {
  try { window.localStorage.setItem(AREAS_KEY, JSON.stringify(list)); } catch { /* not saved */ }
}
export const unexpired = (list: SavedArea[], now = Date.now()) =>
  list.filter((a) => Date.parse(a.expires_at) > now);

// "6 days 23 hours left", "3 hours left", "under an hour left".
export function timeLeft(expiresAt: string, now = Date.now()): string {
  const ms = Date.parse(expiresAt) - now;
  if (!(ms > 0)) return "expired";
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "under an hour left";
  const d = Math.floor(hours / 24), h = hours % 24;
  const days = d === 1 ? "1 day" : `${d} days`;
  const hrs = h === 1 ? "1 hour" : `${h} hours`;
  if (d === 0) return `${hrs} left`;
  return h === 0 ? `${days} left` : `${days} ${hrs} left`;
}

// The expiry date and the countdown together, for the lists of saved areas
// and routes: "Expires Nov 26 · 6 days 23 hours left".
export function expiryWords(expiresAt: string, now = Date.now()): string {
  const day = new Date(expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `Expires ${day} · ${timeLeft(expiresAt, now)}`;
}

// ------------------------------------------------------------ the drawing --

export const MAX_SQ_MI = 5;
export const MAX_ACROSS_MI = 4.5;
const R_MI = 3958.7613;      // the earth's mean radius, in miles
const rad = (d: number) => (d * Math.PI) / 180;

// Area on the sphere, in square miles (the formula for a polygon's spherical
// excess, as used by d3 and Turf).
export function areaSqMi(ring: [number, number][]): number {
  if (ring.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    total += rad(x2 - x1) * (2 + Math.sin(rad(y1)) + Math.sin(rad(y2)));
  }
  return Math.abs((total * R_MI * R_MI) / 2);
}

function haversineMi([x1, y1]: [number, number], [x2, y2]: [number, number]): number {
  const a = Math.sin(rad(y2 - y1) / 2) ** 2 + Math.cos(rad(y1)) * Math.cos(rad(y2)) * Math.sin(rad(x2 - x1) / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(a)));
}

// The widest distance across: the farthest two corners. The farthest pair of
// points of a shape is always a pair of its convex hull's corners, and a
// drawn area has few corners, so every pair is simply tried.
export function acrossMi(ring: [number, number][]): number {
  let best = 0;
  for (let i = 0; i < ring.length; i++) {
    for (let j = i + 1; j < ring.length; j++) best = Math.max(best, haversineMi(ring[i], ring[j]));
  }
  return best;
}

// Whether two edges of the closed ring cross. Neighbouring edges share a
// corner and are not counted.
export function selfCrosses(ring: [number, number][]): boolean {
  const n = ring.length;
  if (n < 4) return false;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const hit = (p1: number[], p2: number[], p3: number[], p4: number[]) => {
    const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (hit(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return true;
    }
  }
  return false;
}

export interface DrawCheck {
  sqMi: number; acrossMi: number; tooBig: boolean; crosses: boolean; tooFew: boolean;
  problem: string | null;       // why it cannot be finished, in a sentence
}
export function checkShape(ring: [number, number][]): DrawCheck {
  const sqMi = areaSqMi(ring), across = acrossMi(ring);
  const tooBig = sqMi > MAX_SQ_MI || across > MAX_ACROSS_MI;
  const crosses = selfCrosses(ring);
  const tooFew = ring.length < 3;
  const problem = tooFew ? "Click at least three corners."
    : crosses ? "The edges cross. Press Backspace to undo a corner."
    : tooBig ? `Too big. Keep it within ${MAX_SQ_MI} square miles and ${MAX_ACROSS_MI} miles across.`
    : null;
  return { sqMi, acrossMi: across, tooBig, crosses, tooFew, problem };
}

export function ringBounds(rings: [number, number][][]): Bounds {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
  }
  return [w, s, e, n];
}

// Every outer ring in a GeoJSON collection of polygons.
export function outerRings(fc: GeoJSON.FeatureCollection | null | undefined): [number, number][][] {
  const out: [number, number][][] = [];
  for (const f of fc?.features ?? []) {
    const g = f.geometry;
    if (g?.type === "Polygon") out.push(g.coordinates[0] as [number, number][]);
    else if (g?.type === "MultiPolygon") g.coordinates.forEach((p) => out.push(p[0] as [number, number][]));
  }
  return out;
}

// A finished run, shaped like one of the published hazards so the map, the
// legend, the popups and the stats strip can show it the same way. The drive
// time is always 10 minutes, and the run covers 12 miles around the area.
export const RUN_CUTOFF = 10;
export const RUN_MILES = 12;
export function runHazard(st: RunStatus, hazardFc: GeoJSON.FeatureCollection,
                          studyFc: GeoJSON.FeatureCollection): Hazard {
  const s = st.stats!;
  const hz = outerRings(hazardFc), study = outerRings(studyFc);
  const hb = ringBounds(hz);
  const studyRing = study.length ? study.reduce((a, r) => (r.length > a.length ? r : a)) : [];
  const classRanges: Hazard["classRanges"] = {};
  for (const m of ["log10", "geometric", "quantile"] as const) {
    const r = s.class_ranges?.[m];
    if (r) classRanges[`${RUN_CUTOFF}_${m}`] = r;
  }
  return {
    id: `run:${st.run_id}`, county: st.area, hazard: st.run_id, tiles: "",
    bounds: study.length ? ringBounds(study) : hb, hazardBounds: hb,
    hazardPoint: [(hb[0] + hb[2]) / 2, (hb[1] + hb[3]) / 2],
    studyArea: studyRing, bufferMiles: RUN_MILES, overtureRelease: s.release ?? "",
    roads: s.segments_out, buildings: 0,
    isolatedRoads: s.isolated_segments, isolatedBuildings: s.isolated_buildings,
    hazardBuildings: s.hazard_buildings, closedRoads: s.closed_roads,
    closedRoadM: s.closed_road_m, isolatedRoadM: s.isolated_road_m,
    losing: { [String(RUN_CUTOFF)]: s.losing }, maxLoss: {}, classRanges,
    label: st.name, kind: "drawn",
    about: [`This is an area drawn on this map, in ${st.county}.`],
  };
}

// ------------------------------------------------------------ the routes --

// One route from the alternate routes tool, as route_click returns it.
export interface AltRoute {
  rank: number; kind: string; minutes: number; miles: number;
  extra_minutes: number; extra_miles: number; delay: string; rejoins_mi?: number;
  truck_label: "Truck safe" | "Possibly truck safe" | "Not truck safe" | string;
  truck_reason: string | null; note: string | null; steps: string[];
  geometry: GeoJSON.LineString;
}
export interface RouteResult {
  status: string; message: string;
  segment?: { overture_id: string; name?: string | null; ref?: string | null; direction_note?: string };
  open_road?: { minutes: number; miles: number };
  routes: AltRoute[];
  truck_summary?: string; fewer_routes?: string;
  routes_left?: number; county?: string;
  // The server keeps every result for 7 days under route_id, so a link can
  // show it again without routing (GET /routes/saved/{route_id}). Missing
  // when it could not be kept, and in sets saved before 2026-11-19.
  route_id?: string; expires_at?: string; created_at?: string;
}
// What GET /routes/saved/{route_id} answers: the stored result and the road.
export interface SharedRoutes extends RouteResult {
  route_id: string; created_at: string; expires_at: string;
  road: { overture_id: string; lon: number; lat: number; name: string | null };
}

// The three route colors on the map and beside each route in the popup:
// sky blue, green and violet, none of them orange or red, each light enough
// to read on the dark gray basemap and drawn over a white casing so they read
// on the light one. The number on each marker is in the matching dark ink.
export const ROUTE_COLORS = ["#4cc3ff", "#3fd17a", "#d58cff"];
export const ROUTE_INKS = ["#00253d", "#00321a", "#3b0042"];

// The distance at the end of a step ("Turn left onto Main Street, 0.6 mi"),
// in miles, or null when the step gives none.
export function stepMiles(step: string): number | null {
  const m = /,\s*([\d.]+)\s*(mi|ft)\s*$/.exec(step);
  if (!m) return null;
  const v = Number(m[1]);
  return m[2] === "ft" ? Math.round((v / 5280) * 1000) / 1000 : v;
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// One row per step of every route.
export function routesCsv(road: string, overtureId: string, res: RouteResult): string {
  const head = ["road_name", "closed_overture_id", "route", "label", "reason", "extra_minutes", "extra_miles",
    "route_minutes", "route_miles", "step", "instruction", "step_miles"];
  const rows: unknown[][] = [];
  for (const r of res.routes) {
    r.steps.forEach((s, i) => rows.push([road, overtureId, r.rank, r.truck_label, r.truck_reason ?? "",
      r.extra_minutes, r.extra_miles, r.minutes, r.miles, i + 1, s, stepMiles(s) ?? ""]));
  }
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ------------------------------------------------------------ saved routes --

// A set of routes saved from a road's popup, kept in this browser only for
// 7 days. Opening one again draws it from here, so it uses no daily click.
export interface SavedRoute {
  id: string; name: string; saved_at: string; expires_at: string;
  overture_id: string; road: string; lon: number; lat: number;
  props: Record<string, any>;      // the road's tile properties, for its popup
  result: RouteResult;
  // the server's id for these routes, for a shared link; none in sets saved
  // before 2026-11-19, which then have no Share button
  route_id?: string;
  // opened from someone's shared link and not (yet) in this browser's list
  shared?: boolean;
}
export const ROUTE_KEEP_DAYS = 7;
const ROUTES_KEY = "ondemandRoutes";
export function loadRoutes(): SavedRoute[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(ROUTES_KEY) ?? "[]");
    return Array.isArray(raw)
      ? raw.filter((r) => r && typeof r.id === "string" && typeof r.expires_at === "string" && r.result)
      : [];
  } catch { return []; }
}
export function saveRoutes(list: SavedRoute[]) {
  try { window.localStorage.setItem(ROUTES_KEY, JSON.stringify(list)); } catch { /* not saved */ }
}
// A saved set's id on the server, for a shared link. Sets saved before the
// server kept routes have none: this asks for the same routes once more (one
// route request), stores the new id and expiry in this browser's list and
// tells the page (the "ondemand-routes-changed" event), then returns the id.
export const ROUTES_CHANGED = "ondemand-routes-changed";
export async function shareIdFor(r: SavedRoute): Promise<string> {
  if (r.route_id) return r.route_id;
  const code = rememberedCode("routes");
  if (!code) throw new Error("Open these routes once with the access code, then share them.");
  const res = await api<RouteResult & { route_id?: string; expires_at?: string }>(routesApi(), "/routes",
    { code, overture_id: r.overture_id, lon: r.lon, lat: r.lat });
  if (!res.route_id) throw new Error("A link could not be made. Try again.");
  const id = res.route_id, until = res.expires_at ?? r.expires_at;
  saveRoutes(loadRoutes().map((x) => (x.id === r.id ? { ...x, route_id: id, expires_at: until } : x)));
  try { window.dispatchEvent(new Event(ROUTES_CHANGED)); } catch { /* nothing listening */ }
  return id;
}

export const unexpiredRoutes = (list: SavedRoute[], now = Date.now()) =>
  list.filter((r) => Date.parse(r.expires_at) > now);
export function newSavedRoute(name: string, road: string, overtureId: string, lngLat: [number, number],
                              props: Record<string, any>, result: RouteResult): SavedRoute {
  const at = Date.now();
  // The server's own expiry when it kept the routes, so the saved entry and
  // a shared link to it end on the same date.
  const exp = result.expires_at && Date.parse(result.expires_at) > at ? result.expires_at
    : new Date(at + ROUTE_KEEP_DAYS * 86_400_000).toISOString();
  return {
    id: `${at.toString(36)}${Math.random().toString(36).slice(2, 8)}`, name,
    saved_at: new Date(at).toISOString(), expires_at: exp,
    overture_id: overtureId, road, lon: lngLat[0], lat: lngLat[1], props, result,
    ...(result.route_id ? { route_id: result.route_id } : {}),
  };
}
// A set opened from a shared link, shaped like a saved one so the popup can
// show it the same way. Its id is only for this page; saving it gives it a
// real one.
export function sharedRoute(s: SharedRoutes): SavedRoute {
  const { road, ...result } = s;
  const name = road.name || "this road";
  return {
    id: `shared:${s.route_id}`, name, saved_at: s.created_at, expires_at: s.expires_at,
    overture_id: road.overture_id, road: name, lon: road.lon, lat: road.lat,
    props: { overture_id: road.overture_id, road_name: road.name ?? "" }, result,
    route_id: s.route_id, shared: true,
  };
}
export const ROUTE_ID = /^[0-9a-f]{32}$/;

// ------------------------------------------------------------ sharing --

// A link to this page that opens on `params` (tab, run or route). With
// `withView`, the map's present centre and zoom too, read from the hash
// MapView keeps up to date.
export function shareLink(params: Record<string, string>, withView: boolean): string {
  const p = new URLSearchParams(params);
  if (withView) {
    const now = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    for (const k of ["lon", "lat", "zoom"]) { const v = now.get(k); if (v != null) p.set(k, v); }
  }
  return `${window.location.origin}${window.location.pathname}#${p.toString()}`;
}

// Put the link on the clipboard. False when the browser refuses (no
// permission, or not a secure page), so the caller can show it to copy by hand.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* refused: fall through */ }
  try {
    const t = document.createElement("textarea");
    t.value = text;
    t.setAttribute("readonly", "");
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand("copy");
    t.remove();
    return ok;
  } catch { return false; }
}

export const fileSlug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "road";
