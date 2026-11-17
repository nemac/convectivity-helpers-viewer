// What the viewer offers: the three tabs, the counties and hazards they cover,
// the scores each tab can draw, and the basemaps behind them.
//
// Symbology is not here. The colours and widths come from styles.json, which
// scripts/qml_to_styles.mjs generates from the .qml files in output/, so QGIS
// and the browser draw the same thing from the same source.
import styles from "./styles.json";
import hazardData from "./hazards.json";

export type TabId = "isolation" | "detour" | "pinch";

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
    // Plain words, because the guide reads these out as well as the panel.
    short: "A good place to start. Most roads land in the middle colours, and only a few at either end.",
    help: "Breaks grow by a constant ratio, so classes get wider toward the top. Most roads gather in the middle colours, and both ends stay sparse: only a handful of roads score low enough for the first class or high enough for the last.",
  },
  {
    id: "log10",
    label: "Log base 10",
    short: "Only the most extreme roads reach the top colours.",
    help: "Equal breaks on the log of the score. The most selective of the three: use it when a handful of segments dwarf everything else and you want only those to stand out.",
  },
  {
    id: "quantile",
    label: "Quantile",
    short: "The same number of roads in every colour. It shows order rather than size.",
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
  minutes?: number;         // the drive time, on the functional isolation tab
}

export const PINCH_SCORES: Score[] = [
  {
    base: "pinch",
    label: "Pinch score",
    help: "Every road in the state, scored by how much traffic it carries and how far drivers would be sent around if it closed. A road scores high only when it is both busy and hard to replace: a quiet back road with no alternative scores low, and so does a busy street with another street one block over.",
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

// The functional isolation tab: one choice per drive time. Each is the share of
// the buildings a road could reach within that drive that it can no longer
// reach once the hazard closes the roads it covers. A loss is already a share
// of something the reader can picture, so unlike the detour scores it needs no
// percentile table to be read.
export const ISOLATION_CUTOFFS = [5, 10, 15, 30] as const;
export const ISOLATION_SCORES: Score[] = ISOLATION_CUTOFFS.map((c) => ({
  base: `loss_${c}m`,
  // Named for what a person loses, not for what the analysis counts: the
  // user found "Buildings lost within 15 minutes" unclear about what they
  // were lost from.
  label: `Places out of reach within a ${c} minute drive`,
  help: `For someone on a road near the hazard: of the homes, shops, schools and other `
    + `buildings they could drive to within ${c} minutes, the share they can no longer `
    + "get to once the hazard closes the roads it covers.",
  raw: `loss_${c}m`,
  minutes: c,
}));
export const DEFAULT_CUTOFF = 15;

export interface County {
  id: string;
  label: string;
  tiles: string;            // file in public/data
  center: [number, number];
  zoom: number;
  bounds: Bounds;           // everything the run covers, for "show it all"
}

// West, south, east, north in degrees.
export type Bounds = [number, number, number, number];

// The three counties with a combined detour run. Centres are the county seats,
// and the zoom is close enough that single roads can be told apart on arrival.
// Bounds are the extent of each run's GeoPackage, which reaches a little past
// the county line because the runs include roads just outside it.
export const COUNTIES: County[] = [
  { id: "haywood", label: "Haywood", tiles: "haywood_detour.pmtiles", center: [-82.98, 35.49], zoom: 11,
    bounds: [-83.439, 35.137, -82.563, 35.941] },
  { id: "mecklenburg", label: "Mecklenburg", tiles: "mecklenburg_detour.pmtiles", center: [-80.84, 35.23], zoom: 11,
    bounds: [-81.236, 34.855, -80.37, 35.66] },
  { id: "new_hanover", label: "New Hanover", tiles: "new_hanover_detour.pmtiles", center: [-77.89, 34.21], zoom: 11.5,
    bounds: [-78.212, 33.839, -77.573, 34.543] },
];

// The words a hazard is described in, so a sentence can name it the way a
// reader would: "with the flooded roads closed", "under the landslide".
export type HazardKind = "flood" | "landslide" | "debris flow";
export const HAZARD_WORDS: Record<HazardKind, {
  event: string;            // "before the flood"
  area: string;             // "1.2 miles from the flooded area"
  inside: string;           // "this stretch is inside the flooded area"
  closed: string;           // "with the flooded roads closed"
}> = {
  flood: {
    event: "the flood", area: "the flooded area",
    inside: "inside the flooded area", closed: "the flooded roads",
  },
  landslide: {
    event: "the landslide", area: "the landslide",
    inside: "under the landslide", closed: "the roads under the landslide",
  },
  "debris flow": {
    event: "the debris flow", area: "the debris flow",
    inside: "under the debris flow", closed: "the roads under the debris flow",
  },
};

// What scripts/make_hazards.py reads out of each run's GeoPackage.
interface HazardRun {
  county: string;
  hazard: string;
  tiles: string;
  bounds: Bounds;            // the study area (bufferMiles around the hazard)
  hazardBounds: Bounds;
  hazardPoint: [number, number];    // a point inside the hazard, for its note's leader line
  studyArea: [number, number][];
  bufferMiles: number;
  overtureRelease: string;
  roads: number;
  buildings: number;
  isolatedRoads: number;
  isolatedBuildings: number;
  hazardBuildings: number;           // buildings in the hazard or on its closed roads
  losing: Record<string, number>;     // roads losing any reach, per cutoff
  maxLoss: Record<string, number>;
  // Per "<cutoff>_<method>", the lowest and highest share lost within each
  // rank 1 to 10 (null for a rank no road falls in), so a rank can be said
  // as a share of places rather than as a bare number.
  classRanges: Record<string, ([number, number] | null)[]>;
}
const RUNS = hazardData as unknown as Record<string, HazardRun>;

export interface Hazard extends HazardRun {
  id: string;               // the hazard file's name, e.g. flood_canton1
  label: string;            // as the dropdown shows it
  kind: HazardKind;
  // One or two sentences on where the hazard comes from and what is special
  // about it, for the hazard's own popup and the guide.
  about: string[];
}

// The nine hazard runs, in the order each county's dropdown lists them. The
// first in each county is the one picking that county opens on. The first
// line of `about` is the user's own description of each, as a sentence.
const NUISANCE = "in an area known for nuisance flooding";
const FEMA = "flooded partly by storm surge and partly by rain";
const HAZARD_LIST: Omit<Hazard, keyof HazardRun>[] = [
  { id: "flood_canton1", label: "Flooding in Canton", kind: "flood",
    about: ["This is flooding along the Pigeon River through Canton."] },
  { id: "df_cruso_276_big", label: "Debris flow onto US 276 in Cruso", kind: "debris flow",
    about: ["This is a debris flow onto US 276 at Cruso, south of Canton."] },
  { id: "df_i40_gorge_poly", label: "Landslide on I-40 in the Pigeon River gorge", kind: "landslide",
    about: [
      "This is a landslide closing I-40 in the Pigeon River gorge.",
      // A quiet map here is not a sign that the closure is minor. The gorge is
      // remote, and closing I-40 matters for long trips, which a measure of
      // what is within 15 minutes cannot see.
      "The gorge is remote, so few buildings are within a short drive of it, and the map "
        + "stays quiet. Closing I-40 matters most for long trips, which a measure of what "
        + "is within 15 minutes does not see.",
    ] },
  { id: "little_sugar_creek1", label: "Flooding along Little Sugar Creek", kind: "flood",
    about: [
      `This is inland flooding along Little Sugar Creek, ${NUISANCE}.`,
      // The polygon closes one 41 m piece of Archdale Drive, which is why the
      // effect is wide but shallow.
      "It closes only one short piece of Archdale Drive, so the loss is spread thinly over "
        + "a wide area: no road loses more than about a fifth of what it could reach "
        + "within 15 minutes.",
    ] },
  { id: "mallard_doby_creek1", label: "Flooding along Mallard and Doby Creek", kind: "flood",
    about: [`This is inland flooding along Mallard Creek and Doby Creek, ${NUISANCE}.`] },
  { id: "mcmullen_creek1", label: "Flooding along McMullen Creek", kind: "flood",
    about: [`This is inland flooding along McMullen Creek, ${NUISANCE}.`] },
  { id: "burntmillcreek1", label: "Flooding along Burnt Mill Creek", kind: "flood",
    about: [`This is the FEMA floodplain along Burnt Mill Creek, ${FEMA}, ${NUISANCE}.`] },
  { id: "northchase1", label: "Flooding at Northchase", kind: "flood",
    about: [`This is the FEMA floodplain at Northchase, ${FEMA}, ${NUISANCE}.`] },
  { id: "pagescreek1", label: "Flooding along Pages Creek", kind: "flood",
    about: [`This is the FEMA floodplain along Pages Creek, ${FEMA}, ${NUISANCE}.`] },
];

// Only hazards with a run in hazards.json are offered. A hazard listed above
// whose run has not been made yet is simply left out.
export const HAZARDS: Hazard[] = HAZARD_LIST.flatMap((h) => {
  const run = Object.values(RUNS).find((r) => r.hazard === h.id);
  return run ? [{ ...run, ...h }] : [];
});
export const hazardsIn = (county: string) => HAZARDS.filter((h) => h.county === county);
export const defaultHazard = (county: string) => hazardsIn(county)[0]?.id ?? HAZARDS[0]?.id;

// Fewer roads than this losing anything at a cutoff is too few for ten ranks
// to mean anything: the I-40 landslide has one within 5 minutes, and its map
// at that cutoff is all rank 1.
export const MIN_RANKED = 10;

// Where to look when a hazard is picked: on the hazard, close enough to see
// the roads around it. The hazards run from a few hundred metres to a few
// miles across, so the zoom is set by the hazard's size, about a quarter of
// the map's width, and kept between the county view and street level.
export function hazardView(h: Hazard): { center: [number, number]; zoom: number } {
  const [w, s, e, n] = h.hazardBounds;
  const span = Math.max(e - w, (n - s) * 1.25, 1e-4);
  const zoom = Math.log2((900 * 360) / (256 * span * 4));
  return { center: [(w + e) / 2, (s + n) / 2], zoom: Math.max(11, Math.min(13, zoom)) };
}

// The buildings a hazard run writes out: cut off (on roads with no way out)
// in the cut-off red, and in the hazard (inside it, or on its closed roads)
// in teal, a colour none of the road ranks use. A lighter red was tried for
// the second and was hard to tell apart; both now carry a white halo and a
// dark edge (see MapView), and are drawn over everything else the run draws.
export type HazardBuildingStatus = "cut_off" | "in_hazard";
export const HAZARD_BUILDING_COLORS: Record<HazardBuildingStatus, string> = {
  cut_off: "#a50f15",
  in_hazard: "#12a6b8",
};

// The class the functional isolation runs give a road cut off completely. It
// is not a rank: it is drawn on top in a deep red, never hidden by the
// slider, and has its own row in the legend.
export const CUT_OFF_CLASS = 11;

// What the viewer opens on: the Canton flood, on the functional isolation tab.
export const DEFAULT_TAB: TabId = "isolation";
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
export const NC_BOUNDS: Bounds = [-84.33, 33.75, -75.4, 36.6];

// The four services the detour runs cover, named for the panel text.
export const SERVICES = [
  "fire stations",
  "medical facilities",
  "schools",
  "grocery and convenience stores",
];

// The same four as points on the Detours map, each a filled Material icon in
// a white circle, all on to begin with. The user picked the icons from a
// review sheet: Local Fire Department, Health And Safety, School and Local
// Grocery Store. The path data below is copied from @mui/icons-material so the
// map can draw them on a canvas; the panel uses the icon components
// themselves. One colour for all four, Night Sky, so they do not compete with
// the road colours.
//
// The points come from public/data/services.geojson, which
// scripts/make_services.py cuts from the files the detour runs were given.
export type ServiceKind = "fire" | "medical" | "school" | "grocery";
export const SERVICE_KINDS: { id: ServiceKind; label: string; one: string; paths: string[] }[] = [
  { id: "fire", label: "Fire stations", one: "Fire station", paths: [
    "m12 12.9-2.13 2.09c-.56.56-.87 1.29-.87 2.07C9 18.68 10.35 20 12 20s3-1.32 3-2.94c0-.78-.31-1.52-.87-2.07z",
    "m16 6-.44.55C14.38 8.02 12 7.19 12 5.3V2S4 6 4 13c0 2.92 1.56 5.47 3.89 6.86-.56-.79-.89-1.76-.89-2.8 0-1.32.52-2.56 1.47-3.5L12 10.1l3.53 3.47c.95.93 1.47 2.17 1.47 3.5 0 1.02-.31 1.96-.85 2.75 1.89-1.15 3.29-3.06 3.71-5.3.66-3.55-1.07-6.9-3.86-8.52",
  ] },
  { id: "medical", label: "Medical facilities", one: "Medical facility", paths: [
    "M10.5 13H8v-3h2.5V7.5h3V10H16v3h-2.5v2.5h-3zM12 2 4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5z",
  ] },
  { id: "school", label: "Schools", one: "School", paths: [
    "M5 13.18v4L12 21l7-3.82v-4L12 17zM12 3 1 9l11 6 9-4.91V17h2V9z",
  ] },
  { id: "grocery", label: "Grocery and convenience stores", one: "Grocery or convenience store", paths: [
    "M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2M1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2",
  ] },
];
export const SERVICE_INK = "#003865";   // Night Sky, as in brand.ts
export const SERVICES_URL = "data/services.geojson";

// The methodology notes, served from the repo's docs/ folder and rendered in
// the browser. A tab lists only the note that describes its own numbers, so
// nothing on offer is unrelated to what is on screen.
export const METHODOLOGY: Record<TabId, { file: string; label: string }[]> = {
  isolation: [
    { file: "run-functional-isolation-technical.md", label: "Functional isolation analysis" },
  ],
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

// Overture's buildings, for context on every tab, off until the reader ticks
// the box. Read straight from Overture's own public PMTiles in the browser,
// as the landslide viewer does, and drawn in the same colours: a pale yellow
// fill with a brown edge. Nothing is counted or matched against the roads;
// it is a picture of where the buildings are.
//
// The newest release is read from the bucket listing, so no date needs
// changing when Overture publishes again. If the listing cannot be read, the
// release the analysis runs used is the fallback.
export const OVERTURE_BUCKET = "https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com";
export const OVERTURE_FALLBACK_RELEASE = "2026-10-21.0";
export const overtureBuildingsUrl = (release: string) =>
  `${OVERTURE_BUCKET}/tiles/${release}/buildings.pmtiles`;
export const BUILDING_COLOR = "#fff7bc";
export const BUILDING_OUTLINE = "#8c6d1f";
// Overture's own page on its buildings data, linked from the legend.
export const OVERTURE_BUILDINGS_URL = "https://docs.overturemaps.org/guides/buildings/";

export async function latestOvertureRelease(): Promise<string> {
  try {
    const xml = await (await fetch(`${OVERTURE_BUCKET}/?list-type=2&prefix=tiles/&delimiter=/`)).text();
    const rel = Array.from(xml.matchAll(/<Prefix>tiles\/([^<\/]+)\/<\/Prefix>/g)).map((m) => m[1]).sort();
    return rel.length ? rel[rel.length - 1] : OVERTURE_FALLBACK_RELEASE;
  } catch {
    return OVERTURE_FALLBACK_RELEASE;
  }
}

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
  // Index 100 is reached by everything above the 99th breakpoint, which is
  // one road in a hundred, not one road. Only the road that actually holds
  // the maximum may be called "the most"; the rest of that top slice beat 99%.
  if (p >= 100) {
    const top = PERCENTILES[key][PERCENTILES[key].length - 1];
    return value >= top * (1 - 1e-9)
      ? `${words.most} of any road ${words.scope}`
      : `${words.more} than 99% of roads ${words.scope}`;
  }
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

// A share of places out of reach, for the legend and the guide: "0.3%",
// "14%". Small shares keep a decimal so a low rank does not read as 0%.
export function sharePct(fraction: number): string {
  const p = fraction * 100;
  if (!(p > 0)) return "0%";
  if (p < 0.1) return "under 0.1%";
  if (p < 1) return `${p.toFixed(1)}%`;
  return `${Math.round(p)}%`;
}
export function shareRange(r: [number, number] | null | undefined): string {
  if (!r) return "no roads";
  const [lo, hi] = r.map(sharePct);
  return lo === hi ? lo : `${lo.replace("%", "")} to ${hi}`.replace("under 0.1 to", "0 to");
}

export function humanMiles(metres: number): string {
  const mi = metres / 1609.34;
  if (mi < 0.1) return `${Math.round(metres * 3.28084)} ft`;
  return `${mi.toFixed(mi < 10 ? 1 : 0)} mi`;
}

// The same distance spelled out, for the middle of a sentence:
// "about 1.2 miles from the flooded area".
export function milesInWords(metres: number): string {
  const mi = metres / 1609.34;
  if (mi < 0.1) return `${Math.round(metres * 3.28084 / 10) * 10} feet`;
  const shown = mi.toFixed(mi < 10 ? 1 : 0);
  return Number(shown) === 1 ? "1 mile" : `${shown} miles`;
}

// Large counts with thousands separators, small reals to 3 places.
export function humanNumber(v: unknown): string {
  const n = Number(v);
  if (!isFinite(n)) return String(v ?? "");
  if (Number.isInteger(n)) return n.toLocaleString();
  return Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toPrecision(3);
}
