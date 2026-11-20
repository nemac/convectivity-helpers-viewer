// "Something look wrong?": a comment on a drawn hazard's results or on a set
// of alternate routes, sent with a copy of what the tester saw (item.context).
// Both results are removed from the server after 7 days, so the copy holds
// what it takes to work them out again: the drawn outline and its name, or
// the road and the spot clicked, plus the numbers the tester saw so a rebuild
// can say whether it came out the same.
//
// The app tells this module what is on screen through report sources: App
// registers the drawn hazard while its results show, and RoutesBox registers
// its routes while they show. Each source names the map layers it covers, so
// a click on those layers in feedback mode opens the same comment, and builds
// its context only when asked.
//
// The server checks the context's type and size and stores it as it comes.
// Anything read back in the inbox was sent by someone holding the testers'
// code, so asContext() checks every field before the inbox shows or uses it.
import { useEffect, useRef } from "react";
import type { Map as MlMap } from "maplibre-gl";
import type { ApiTarget, RouteResult, RunStats } from "../ondemandApi";

// ------------------------------------------------------------ the shapes --

export interface DrawnSummary {
  buildings_cut_off: number;
  buildings_in_hazard: number;
  roads_cut_off: number;
  roads_closed: number;
  road_cut_off_m: number;
  road_closed_m: number;
  roads_losing?: number;          // roads losing anything within the drive time
  roads_counted?: number;         // roads in the results
  // as the server gave them, when it did, except that a rank no road falls
  // in is [] rather than null (see wire())
  class_ranges?: unknown;
}
export interface DrawnHazardContext {
  type: "drawn_hazard";
  run_id: string;
  name: string;
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
  drive_time: number;
  target: ApiTarget;
  drawn_at: string;
  expires_at: string;
  summary: DrawnSummary;
  simplified?: 1;                 // 1 when the outline was thinned to fit
}
export interface CompactRoute {
  rank: number;
  minutes: number;
  extra_minutes: number;
  miles: number;
  extra_miles: number;
  truck_label: string;
  geometry: { type: "LineString"; coordinates: [number, number][] };
}
export interface RoutesContext {
  type: "routes";
  route_id?: string;
  overture_id: string;
  road_name: string;
  lnglat: [number, number];
  target: ApiTarget;
  fetched_at: string;
  expires_at?: string;
  status?: string;                // the tool's own status, when it found none
  message?: string;
  routes: CompactRoute[];
  fewer_routes?: string;
  simplified?: 1;                 // 1 when the route lines were thinned to fit
}
export type ReportContext = DrawnHazardContext | RoutesContext;

// What the comment popover needs: a plain name for it and the copy.
export interface Report { area: string; context: ReportContext }

// ------------------------------------------------------------ building one --

const round = (v: number, places: number) => { const f = 10 ** places; return Math.round(v * f) / f; };
const roundPt = (p: number[], places: number): [number, number] => [round(p[0], places), round(p[1], places)];
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");

// The feedback server takes only strings and numbers inside a context (no
// true, false or null), so the copy is made of those: true and false become
// 1 and 0, a null or a number that is not finite is left out of an object,
// and inside a list becomes an empty list, which keeps the places of the
// others (a rank no road falls in, in class_ranges).
function wire(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => (x == null || (typeof x === "number" && !Number.isFinite(x)) ? [] : wire(x)));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (x == null || (typeof x === "number" && !Number.isFinite(x))) continue;
      out[k] = wire(x);
    }
    return out;
  }
  return typeof v === "boolean" ? (v ? 1 : 0) : v;
}

// The server keeps at most this much context per item; the browser keeps
// under it so an item is never refused for it. It aims 2 KB lower because the
// server measures with Python's JSON writer, which writes a number below
// 0.000001 one byte longer than JSON.stringify (1.5e-07, not 1.5e-7). Lines
// are rounded, so only a handful of unrounded shares could ever be that small.
export const CONTEXT_MAX = 300_000;
const CONTEXT_AIM = CONTEXT_MAX - 2048;
const size = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

// Every other point dropped, the ends kept (a closed ring stays closed and
// keeps at least three corners). Returns the same array when it cannot thin.
function thin(pts: [number, number][], ring: boolean): [number, number][] {
  if (ring) {
    const open = pts.slice(0, -1);
    if (open.length <= 4) return pts;
    const kept = open.filter((_, i) => i % 2 === 0);
    return [...kept, kept[0]];
  }
  if (pts.length <= 3) return pts;
  const kept = pts.filter((_, i) => i % 2 === 0);
  if (kept[kept.length - 1] !== pts[pts.length - 1]) kept.push(pts[pts.length - 1]);
  return kept;
}

// Keeps the copy under CONTEXT_AIM by thinning its lines until it fits, and
// says so in `simplified`, since a thinned outline is no longer the one drawn.
// Also puts it in the form the server takes (wire()).
export function fitContext<T extends ReportContext>(ctx: T): T {
  let c = wire(ctx) as T;
  for (let i = 0; i < 24 && size(c) > CONTEXT_AIM; i++) {
    let changed = false;
    if (c.type === "drawn_hazard") {
      const rings = c.geometry.coordinates.map((r) => { const t = thin(r, true); if (t !== r) changed = true; return t; });
      c = { ...c, geometry: { ...c.geometry, coordinates: rings }, simplified: 1 };
    } else {
      const routes = c.routes.map((r) => {
        const t = thin(r.geometry.coordinates, false);
        if (t !== r.geometry.coordinates) changed = true;
        return { ...r, geometry: { ...r.geometry, coordinates: t } };
      });
      c = { ...c, routes, simplified: 1 } as T;
    }
    if (!changed) break;
  }
  return c;
}

// A drawn hazard's copy. `ring` is the outline as drawn, open or closed.
export function drawnHazardReport(a: {
  run_id: string; name: string; ring: [number, number][]; drive_time: number; target: ApiTarget;
  drawn_at: string; expires_at: string; stats: Partial<RunStats> | null;
}): Report {
  const open = a.ring.length > 1 && a.ring[0][0] === a.ring[a.ring.length - 1][0]
    && a.ring[0][1] === a.ring[a.ring.length - 1][1] ? a.ring.slice(0, -1) : a.ring;
  const pts = open.map((p) => roundPt(p, 6));
  const s = a.stats ?? {};
  const summary: DrawnSummary = {
    buildings_cut_off: num(s.isolated_buildings),
    buildings_in_hazard: num(s.hazard_buildings),
    roads_cut_off: num(s.isolated_segments),
    roads_closed: num(s.closed_roads),
    road_cut_off_m: Math.round(num(s.isolated_road_m)),
    road_closed_m: Math.round(num(s.closed_road_m)),
    roads_losing: num(s.losing),
    roads_counted: num(s.segments_out),
    ...(s.class_ranges ? { class_ranges: s.class_ranges } : {}),
  };
  const context = fitContext<DrawnHazardContext>({
    type: "drawn_hazard", run_id: a.run_id, name: a.name,
    geometry: { type: "Polygon", coordinates: [pts.length ? [...pts, pts[0]] : []] },
    drive_time: a.drive_time, target: a.target, drawn_at: a.drawn_at, expires_at: a.expires_at, summary,
  });
  return { area: contextSummary(context), context };
}

// A set of alternate routes' copy: enough to ask for the same road again,
// and a compact copy of each route to compare with.
export function routesReport(a: {
  route_id?: string; overture_id: string; road_name: string; lnglat: [number, number]; target: ApiTarget;
  fetched_at: string; expires_at?: string; result: RouteResult;
}): Report {
  const ok = a.result.status === "ok" && a.result.routes.length > 0;
  const context = fitContext<RoutesContext>({
    type: "routes",
    ...(a.route_id ? { route_id: a.route_id } : {}),
    overture_id: a.overture_id, road_name: a.road_name, lnglat: roundPt(a.lnglat, 6),
    target: a.target, fetched_at: a.fetched_at, ...(a.expires_at ? { expires_at: a.expires_at } : {}),
    ...(ok ? {} : { status: str(a.result.status), message: str(a.result.message) }),
    routes: (a.result.routes ?? []).map((r) => ({
      rank: num(r.rank), minutes: round(num(r.minutes), 2), extra_minutes: round(num(r.extra_minutes), 2),
      miles: round(num(r.miles), 2), extra_miles: round(num(r.extra_miles), 2), truck_label: str(r.truck_label),
      geometry: { type: "LineString" as const, coordinates: (r.geometry?.coordinates ?? []).map((p) => roundPt(p as number[], 5)) },
    })),
    ...(a.result.fewer_routes ? { fewer_routes: a.result.fewer_routes } : {}),
  });
  return { area: contextSummary(context), context };
}

// ------------------------------------------------------------ reading one back --

// The one-line name the inbox, the review list and the popover use.
export function contextSummary(c: ReportContext): string {
  return c.type === "drawn_hazard"
    ? `Drawn hazard "${c.name}", ${c.drive_time}-minute drive`
    : `Alternate routes for ${c.road_name}`;
}

const isStr = (v: unknown, max = 200): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
// Points somewhere in or near North Carolina, which is all either tool covers.
const isPt = (p: unknown): p is [number, number] => Array.isArray(p) && p.length >= 2
  && isNum(p[0]) && isNum(p[1]) && p[0] > -90 && p[0] < -70 && p[1] > 30 && p[1] < 40;
// Ids go into request paths, so only the plain forms the servers make.
export const RUN_ID_FORM = /^[A-Za-z0-9_-]{6,64}$/;
const OVERTURE_ID_FORM = /^[A-Za-z0-9:_-]{1,80}$/;
const ROUTE_ID_FORM = /^[0-9a-f]{32}$/;
const target = (v: unknown): ApiTarget => (v === "local" ? "local" : "aws");

// An item's context as sent, checked field by field: the drawn hazard or the
// routes, or null when it is neither or is not usable.
export function asContext(v: unknown): ReportContext | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, any>;
  if (c.type === "drawn_hazard") {
    const ring = c.geometry?.type === "Polygon" && Array.isArray(c.geometry.coordinates?.[0])
      ? (c.geometry.coordinates[0] as unknown[]) : null;
    // 20,000 corners: more than 300 KB of context can hold
    if (!isStr(c.run_id, 64) || !RUN_ID_FORM.test(c.run_id) || !ring || ring.length < 4 || ring.length > 20_000
      || !ring.every(isPt)) return null;
    const s = c.summary && typeof c.summary === "object" ? c.summary : {};
    return {
      type: "drawn_hazard", run_id: c.run_id, name: isStr(c.name, 120) ? c.name : "Drawn hazard",
      geometry: { type: "Polygon", coordinates: [(ring as [number, number][]).map((p) => [p[0], p[1]])] },
      drive_time: isNum(c.drive_time) ? c.drive_time : 10, target: target(c.target),
      drawn_at: isStr(c.drawn_at, 40) ? c.drawn_at : "", expires_at: isStr(c.expires_at, 40) ? c.expires_at : "",
      summary: {
        buildings_cut_off: num(s.buildings_cut_off), buildings_in_hazard: num(s.buildings_in_hazard),
        roads_cut_off: num(s.roads_cut_off), roads_closed: num(s.roads_closed),
        road_cut_off_m: num(s.road_cut_off_m), road_closed_m: num(s.road_closed_m),
      },
      ...(c.simplified === 1 || c.simplified === true ? { simplified: 1 as const } : {}),
    };
  }
  if (c.type === "routes") {
    if (!isStr(c.overture_id, 80) || !OVERTURE_ID_FORM.test(c.overture_id) || !isPt(c.lnglat)) return null;
    const routes = Array.isArray(c.routes) ? c.routes.slice(0, 10).filter((r: any) => r && typeof r === "object") : [];
    return {
      type: "routes",
      ...(isStr(c.route_id, 32) && ROUTE_ID_FORM.test(c.route_id) ? { route_id: c.route_id } : {}),
      overture_id: c.overture_id, road_name: isStr(c.road_name, 120) ? c.road_name : "this road",
      lnglat: [c.lnglat[0], c.lnglat[1]], target: target(c.target),
      fetched_at: isStr(c.fetched_at, 40) ? c.fetched_at : "",
      ...(isStr(c.expires_at, 40) ? { expires_at: c.expires_at } : {}),
      ...(isStr(c.status, 40) ? { status: c.status } : {}),
      ...(isStr(c.message, 500) ? { message: c.message } : {}),
      routes: routes.map((r: any, i: number) => ({
        rank: isNum(r.rank) ? r.rank : i + 1, minutes: num(r.minutes), extra_minutes: num(r.extra_minutes),
        miles: num(r.miles), extra_miles: num(r.extra_miles), truck_label: isStr(r.truck_label, 60) ? r.truck_label : "",
        geometry: { type: "LineString", coordinates: [] },    // not needed to compare, and not shown
      })),
      ...(isStr(c.fewer_routes, 500) ? { fewer_routes: c.fewer_routes } : {}),
      ...(c.simplified === 1 || c.simplified === true ? { simplified: 1 as const } : {}),
    };
  }
  return null;
}

// ------------------------------------------------------------ comparing a rebuild --

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// How a rebuilt drawn hazard compares with what the tester saw. `same` is
// false when any of the four counts in the stats strip moved.
export function compareDrawn(then: DrawnSummary, now: Partial<RunStats> | null | undefined): { same: boolean; note: string } {
  if (!now) return { same: false, note: "The rebuilt hazard has no numbers to compare." };
  const rows: [string, number, number][] = [
    ["buildings cut off", then.buildings_cut_off, num(now.isolated_buildings)],
    ["buildings in the hazard", then.buildings_in_hazard, num(now.hazard_buildings)],
    ["roads cut off", then.roads_cut_off, num(now.isolated_segments)],
    ["roads closed", then.roads_closed, num(now.closed_roads)],
  ];
  const moved = rows.filter(([, a, b]) => a !== b);
  if (!moved.length) return { same: true, note: "The counts match what the tester saw." };
  return {
    same: false,
    note: `This differs from what the tester saw: ${moved.map(([k, a, b]) => `${k} ${a.toLocaleString()} then, ${b.toLocaleString()} now`).join("; ")}.`,
  };
}

// How rebuilt routes compare: the number of routes, then each route's extra
// time (a tenth of a minute or more apart counts as different).
export function compareRoutes(then: RoutesContext, now: RouteResult): { same: boolean; note: string } {
  const nowRoutes = now.status === "ok" ? now.routes ?? [] : [];
  if (!nowRoutes.length) {
    return { same: then.routes.length === 0,
      note: then.routes.length ? `No routes now${now.message ? `: ${now.message}` : "."} The tester saw ${plural(then.routes.length, "route", "routes")}.`
        : "No routes now, as the tester saw." };
  }
  const notes: string[] = [];
  if (nowRoutes.length !== then.routes.length) {
    notes.push(`now ${plural(nowRoutes.length, "route", "routes")}, the tester saw ${then.routes.length.toLocaleString()}`);
  }
  for (let i = 0; i < Math.min(nowRoutes.length, then.routes.length); i++) {
    const a = then.routes[i].extra_minutes, b = nowRoutes[i].extra_minutes;
    if (Math.abs(a - b) >= 0.1) notes.push(`route ${i + 1} added ${a.toFixed(1)} minutes then, ${b.toFixed(1)} now`);
  }
  if (!notes.length) {
    return { same: true, note: `The same ${plural(nowRoutes.length, "route", "routes")} as the tester saw, with the same extra time.` };
  }
  return { same: false, note: `This differs from what the tester saw: ${notes.join("; ")}.` };
}

// ------------------------------------------------------------ what is on screen --

interface Source { layers: string[]; build: () => Report | null }
const sources = new Map<string, Source>();

// Registers a source while `build` is given and drops it after. `build` is
// read through a ref, so a new function on every render does not re-register.
export function useReportSource(key: string, layers: string[], build: (() => Report | null) | null) {
  const ref = useRef(build);
  ref.current = build;
  const on = build != null;
  const layerKey = layers.join(",");
  useEffect(() => {
    if (!on) return;
    sources.set(key, { layers: layerKey.split(","), build: () => ref.current?.() ?? null });
    return () => { sources.delete(key); };
  }, [key, on, layerKey]);
}

// The report for a click on the map at (x, y) in the canvas's pixels, when
// it landed on one of a source's layers (a few pixels' slack, as thin lines
// are hard to hit), else null.
export function reportAt(map: MlMap, x: number, y: number): Report | null {
  for (const s of sources.values()) {
    const layers = s.layers.filter((l) => map.getLayer(l));
    if (!layers.length) continue;
    let hit = false;
    try { hit = map.queryRenderedFeatures([[x - 4, y - 4], [x + 4, y + 4]], { layers }).length > 0; } catch { hit = false; }
    if (hit) return s.build();
  }
  return null;
}
