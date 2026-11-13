// What the viewer offers: the two tabs, the counties on the detour tab, the
// scores each tab can draw, and the basemaps behind them.
//
// Symbology is not here. The colours and widths come from styles.json, which
// scripts/qml_to_styles.mjs generates from the .qml files in output/, so QGIS
// and the browser draw the same thing from the same source.
import styles from "./styles.json";

export type TabId = "pinch" | "detour";

export interface ClassStyle {
  value: number;
  label: string;
  color: string;
  widthMm: number;
}
export interface FieldStyle {
  source: string;      // the .qml it came from
  classes: ClassStyle[];
}
export const STYLES = styles as Record<string, FieldStyle>;

// How a classification turns a raw score into the 1..10 class column.
// `short` is the plain-words line shown under each choice; `help` is the fuller
// note on hover for anyone who wants it.
export const METHODS = [
  {
    id: "geometric",
    label: "Geometric",
    short: "Middle-heavy; very lowest and very highest both get few roads",
    help: "Breaks grow by a constant ratio, so classes get wider toward the top. Most roads gather in the middle colours, and both ends stay sparse: only a handful of roads score low enough for the first class or high enough for the last.",
  },
  {
    id: "log10",
    label: "Log base 10",
    short: "Only extremes reach the top colors",
    help: "Equal breaks on the log of the score. The most selective of the three: use it when a handful of segments dwarf everything else and you want only those to stand out.",
  },
  {
    id: "quantile",
    label: "Quantile",
    short: "Same number of roads per color",
    help: "Equal counts per class, fitted on the scoring segments only. Shows rank rather than magnitude, so the top class is as common as every other.",
  },
] as const;
export type MethodId = (typeof METHODS)[number]["id"];

// A score the map can draw: the class column is "<base>_<method>_class".
export interface Score {
  base: string;             // column stem, e.g. combined_extra_sec
  label: string;
  help: string;
  raw: string;              // the underlying continuous column, for the popup
  unit?: string;
  // How this score reads in a comparison sentence, so the value can say what
  // is being compared instead of a bare "higher than 95%".
  compare?: { more: string; most: string };
}

export const PINCH_SCORES: Score[] = [
  {
    base: "pinch",
    label: "Pinch score",
    help: "Combines how much traffic a road carries with how far drivers would be sent around if it closed. A road scores high only when it is both busy and hard to replace: a quiet back road with no alternative scores low, and so does a busy street with another street one block over.",
    raw: "pinch_score",
  },
];

export const DETOUR_SCORES: Score[] = [
  {
    base: "combined_extra_sec",
    compare: { more: "Adds more driving", most: "Adds the most driving" },
    label: "Extra travel time",
    help: "Extra driving time added up over every trip that has to go around when this road closes.",
    raw: "combined_extra_sec",
    unit: "s",
  },
  {
    base: "combined_band",
    compare: { more: "Scores a bigger weighted delay", most: "Scores the biggest weighted delay" },
    label: "Detour band score",
    help: "Like extra travel time, but a delay counts for more when the trip was a quick one. Pushing a 5 minute trip out of reach matters more than adding the same minutes to an hour-long one.",
    raw: "combined_band_score",
  },
  {
    base: "max_service",
    compare: { more: "Hits one service harder", most: "Hits one service hardest" },
    label: "Worst single service",
    help: "The hardest hit of the four services. Finds roads that matter enormously for one of them even when the other three are barely affected.",
    raw: "max_service_norm",
  },
  {
    base: "mean_service",
    compare: { more: "Hits services harder overall", most: "Hits services hardest overall" },
    label: "Average across services",
    help: "The average hit across all four services. Finds roads that matter broadly rather than for one service alone.",
    raw: "mean_service_norm",
  },
];

export interface County {
  id: string;
  label: string;
  tiles: string;            // file in public/data
  center: [number, number];
  zoom: number;
}

// The three counties with a combined detour run. Centres are the county seats,
// which is close enough for an opening view before the layer loads.
export const COUNTIES: County[] = [
  { id: "haywood", label: "Haywood", tiles: "haywood_detour.pmtiles", center: [-82.98, 35.49], zoom: 10 },
  { id: "mecklenburg", label: "Mecklenburg", tiles: "mecklenburg_detour.pmtiles", center: [-80.84, 35.23], zoom: 10 },
  { id: "new_hanover", label: "New Hanover", tiles: "new_hanover_detour.pmtiles", center: [-77.89, 34.21], zoom: 10.5 },
];

// What the viewer opens on: the Haywood detour run.
export const DEFAULT_TAB: TabId = "detour";
export const DEFAULT_COUNTY = "haywood";

export const PINCH_TILES = "north_carolina_pinch.pmtiles";

// Where the .pmtiles files are read from.
//
// The published site serves them from data/ beside the page. The dev server
// reads those same published files, so a fresh clone draws roads without
// building any tiles. The site only lets its own pages and localhost:5190
// load them in a browser, which is why the dev port must stay 5190.
//
// To preview tiles built on this machine instead, run `npm run dev:local`,
// which sets VITE_TILES_BASE to the local data/ folder.
const PUBLISHED_TILES = "https://road-network-connectivity.nemac.org/data/";
export const TILES_BASE = new URL(
  import.meta.env.VITE_TILES_BASE ?? (import.meta.env.DEV ? PUBLISHED_TILES : "data/"),
  document.baseURI,
).href;
export const NC_CENTER: [number, number] = [-79.4, 35.5];
export const NC_ZOOM = 6.3;

// The four services the detour runs cover, named for the panel text.
export const SERVICES = [
  "fire stations",
  "medical facilities",
  "schools",
  "grocery and convenience stores",
];

// The methodology notes, served from the repo's docs/ folder and rendered in
// the browser. A tab lists only the note that describes its own numbers, so
// nothing on offer is unrelated to what is on screen.
//
// The functional isolation note is deliberately absent: it is not finished, so
// neither tab points at it.
export const METHODOLOGY: Record<TabId, { file: string; label: string }[]> = {
  pinch: [
    { file: "run-pinch-technical.md", label: "Pinch point analysis" },
  ],
  detour: [
    { file: "run-detour-technical.md", label: "Detour analysis" },
  ],
};

// Light gray is first because it is the default: the road classes are a
// red-to-blue ramp, and a near-neutral background is what lets the low blue
// classes stay legible.
export const BASEMAPS = {
  lightgray: {
    label: "Esri light gray",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"],
    attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community",
    maxzoom: 16,
  },
  darkgray: {
    label: "Esri dark gray",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"],
    attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community",
    maxzoom: 16,
  },
  streets: {
    label: "Esri streets",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"],
    attribution: "Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China (Hong Kong), © OpenStreetMap contributors, and the GIS User Community",
    maxzoom: 19,
  },
  imagery: {
    label: "Esri imagery",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    attribution: "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxzoom: 19,
  },
} as const;
export type BasemapKey = keyof typeof BASEMAPS;
export const DEFAULT_BASEMAP: BasemapKey = "lightgray";

// Name of the 1..10 class column for a score and a classification method.
export function classField(base: string, method: MethodId): string {
  return `${base}_${method}_class`;
}

// Seconds as the nearest sensible unit, for popups.
export function humanSeconds(s: number): string {
  if (!isFinite(s) || s <= 0) return "0";
  if (s < 90) return `${s.toFixed(0)} s`;
  if (s < 5400) return `${(s / 60).toFixed(1)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

// Overture's road classes in words a reader will recognise. Anything not
// listed falls back to the raw value with underscores removed.
const ROAD_TYPES: Record<string, string> = {
  motorway: "Interstate or freeway",
  trunk: "Major highway",
  primary: "Primary road",
  secondary: "Secondary road",
  tertiary: "Connector road",
  residential: "Residential street",
  living_street: "Shared street",
  unclassified: "Minor road",
  service: "Service road or driveway",
  track: "Unpaved track",
  pedestrian: "Pedestrian way",
  footway: "Footpath",
  path: "Path",
  cycleway: "Bike path",
  steps: "Steps",
  unknown: "Unclassified road",
};

// Overture joins a road's names with a semicolon when a place has more than
// one, which on the Qualla Boundary means the English name and the Cherokee
// one: "Paint Town Road;Ꭰ..." . Splitting keeps both: the first is used as the
// heading, the rest are shown beneath it rather than being thrown away.
export function splitNames(raw: unknown): { primary: string; others: string[] } {
  const parts = String(raw ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { primary: "Unnamed road", others: [] };
  return { primary: parts[0], others: parts.slice(1) };
}

// Figtree carries no Cherokee syllabary, so a name set in it lands as a row of
// empty boxes. Naming fonts that do have the glyphs lets the browser pick one.
export const ALT_NAME_FONT =
  '"Plantagenet Cherokee", "Noto Sans Cherokee", "Galvji", "Gadugi", system-ui, sans-serif';

export function roadTypeLabel(cls: unknown): string {
  const key = String(cls ?? "").toLowerCase();
  if (ROAD_TYPES[key]) return ROAD_TYPES[key];
  if (!key) return "Road";
  return key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

// run-pinch.py searches for a way around out to MAX_DETOUR_CHECK and, when it
// finds none, writes MAX_DETOUR_CHECK * 2 as a sentinel. That number is a
// floor, not a measurement, so the popup has to say so rather than print it as
// though the detour really were 6.2 miles.
export const PINCH_MAX_DETOUR_M = 5000;
export const PINCH_NO_ALTERNATIVE_M = PINCH_MAX_DETOUR_M * 2;

import percentiles from "./percentiles.json";

const PERCENTILES = percentiles as Record<string, number[]>;

// Where a value sits against every other road, as a percentile.
//
// This replaces "share of the highest value", which is unreadable on these
// layers: one extreme road sets the maximum, so the median road measures
// 0.0000% of it and even the median road in the top class reaches only 4.4%.
// Returns null when there is no table for the column, so the caller can fall
// back rather than invent a number.
export function percentileOf(key: string, value: number): number | null {
  const breaks = PERCENTILES[key];
  if (!breaks || !isFinite(value)) return null;
  let lo = 0, hi = breaks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (breaks[mid] < value) lo = mid + 1; else hi = mid;
  }
  return lo;   // the table is 101 entries, so the index is already a percent
}

// A comparison written as a whole statement: "more added driving than 95% of
// roads in this county".
//
// The phrase has to carry the thing being compared. "Higher than 95% of roads"
// and "the highest of any road here" both leave the reader asking "highest
// what?", since the measure is named only in the row label beside it and the
// value is what gets read.
export function rankSentence(
  key: string,
  value: number,
  words: { more: string; most: string; scope: string },
): string | null {
  if (!isFinite(value) || value <= 0) return null;
  const p = percentileOf(key, value);
  if (p == null) return null;
  if (p >= 100) return `${words.most} of any road ${words.scope}`;
  if (p < 1) return `${words.more} than almost no other road ${words.scope}`;
  return `${words.more} than ${p}% of roads ${words.scope}`;
}

// A 0-1 share as a percentage, keeping enough precision to stay informative.
//
// These shares are measured against a statewide maximum that is a long way
// above everything else, so rounding to whole percent turns almost every road
// into "0%". A road the map has put in class 8 showing 0% reads as a bug, and
// the real figure, small but not nothing, is the useful part.
export function humanPercent(fraction: number): string {
  const pct = fraction * 100;
  if (!isFinite(pct) || pct <= 0) return "0%";
  if (pct >= 10) return `${Math.round(pct)}%`;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  if (pct >= 0.01) return `${pct.toFixed(2)}%`;
  return "under 0.01%";
}

export function humanMiles(metres: number): string {
  const mi = metres / 1609.34;
  if (mi < 0.1) return `${Math.round(metres * 3.28084)} ft`;
  return `${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
}

// Large counts with thousands separators, small reals to 3 places.
export function humanNumber(v: unknown): string {
  const n = Number(v);
  if (!isFinite(n)) return String(v ?? "");
  if (Number.isInteger(n)) return n.toLocaleString();
  return Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toPrecision(3);
}
