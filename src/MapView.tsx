import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import maplibregl, { Map, MapMouseEvent } from "maplibre-gl";
import { Protocol } from "pmtiles";
import {
  BASEMAPS, BUILDING_COLOR, BUILDING_OUTLINE, BasemapKey, Bounds, CUT_OFF_CLASS,
  HAZARD_BUILDING_COLORS, HazardBuildingStatus, HAZARD_WORDS, Hazard, ISOLATION_CUTOFFS,
  MIN_RANKED, PINCH_MAX_DETOUR_M, PINCH_NO_ALTERNATIVE_M, SERVICES_URL, SERVICE_INK, SERVICE_KINDS,
  STYLES, Score, ServiceKind, humanMiles,
  humanNumber, humanPercent, humanSeconds, milesInWords, percentileOf, rankSentence,
  roadTypeLabel, splitNames,
} from "./config";

// QGIS line widths are in millimetres on a printed page; the map works in
// screen pixels. At 96 dpi one millimetre is about 3.78 px, which makes the
// 0.1 mm hairline classes a quarter-pixel and invisible. These two numbers
// scale the whole set so the thin / medium / thick relationship the QML sets
// up survives, but every class is actually drawable.
const MM_TO_PX = 3.7795;
const WIDTH_GAIN = 2.6;

// The view the page opened with, taken from the URL hash, or null when the
// hash does not carry one. Reading it once at module load means a reload or a
// shared link comes back to the same place rather than to the county centre.
// Not exported: a component file that also exports a plain function cannot be
// hot-reloaded by React Fast Refresh, so map changes would reload the page.
function viewFromUrl(): { lon: number; lat: number; zoom: number } | null {
  const p = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const lon = Number(p.get("lon")), lat = Number(p.get("lat")), zoom = Number(p.get("zoom"));
  const ok = p.get("lon") != null && p.get("lat") != null && p.get("zoom") != null
    && isFinite(lon) && isFinite(lat) && isFinite(zoom)
    && Math.abs(lon) <= 180 && Math.abs(lat) <= 90 && zoom >= 0 && zoom <= 24;
  return ok ? { lon, lat, zoom } : null;
}
const urlView = viewFromUrl();

// Lines are thinner when zoomed out and heavier when zoomed in, around the
// width the QML asks for. Without this a statewide view is a solid block of
// colour and a street-level view is a set of threads.
const ZOOM_SCALE: [number, number][] = [
  [6, 0.55],
  [10, 1.0],
  [14, 2.1],
  [17, 3.4],
];

function widthExpression(classField: string, classes: { value: number; widthMm: number }[]) {
  // match on the class column -> the QML width, then scale by zoom.
  const match: any[] = ["match", classOf(classField)];
  for (const c of classes) match.push(c.value, c.widthMm * MM_TO_PX * WIDTH_GAIN);
  match.push(0.4);   // anything outside 1..10: barely there, mirroring "no all other values"
  const interp: any[] = ["interpolate", ["linear"], ["zoom"]];
  for (const [z, f] of ZOOM_SCALE) interp.push(z, ["*", match, f]);
  return interp;
}

function colorExpression(classField: string, classes: { value: number; color: string }[]) {
  const match: any[] = ["match", classOf(classField)];
  for (const c of classes) match.push(c.value, c.color);
  match.push("rgba(0,0,0,0)");   // out of range draws nothing, as in the QML
  return match;
}

// An invisible, generously wide copy of the road layer, used only as the
// target for hover and click.
//
// The drawn lines are 0.1 mm at the low classes, which lands near a single
// screen pixel. Hunting for that with a cursor is not realistic, and widening
// the visible line to compensate would throw away the weighting the QML sets
// up. A transparent layer separates the two jobs: the visible line keeps its
// cartographic width, and this one gives the pointer something to hit.
// queryRenderedFeatures still returns features from a fully transparent layer,
// so nothing has to be drawn for this to work.
const HIT_WIDTH = 16;

// The hovered road is traced with a two-tone glow: a dark outer band and a
// white inner one, with the coloured road still drawn on top. One colour alone
// cannot do this job, because a white halo disappears on the light basemap and
// a dark one disappears on the dark basemap. A pair always leaves one of the
// two visible whichever background is behind it.
const HOVER_LAYERS: any[] = [
  {
    id: "roads-hover-outer",
    type: "line",
    source: "hover",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#0b1016", "line-opacity": 0.75, "line-width": 26, "line-blur": 1 },
  },
  {
    id: "roads-hover-inner",
    type: "line",
    source: "hover",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-opacity": 1, "line-width": 15 },
  },
];

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

// The class a road is drawn in. On the functional isolation tab the analysis
// keeps two separate flags: is_isolated for roads cut off completely (already
// class 11 in the class columns) and is_blocked for the pieces inside the
// hazard, which are closed and keep an ordinary rank measured from one of
// their ends, often rank 1. Left that way, the flooded roads look untouched.
// The viewer merges the two and draws a closed piece as cut off. On the other
// tabs there is no is_blocked, so this is just the class column.
const BLOCKED: any = ["any", ["==", ["get", "is_blocked"], true], ["==", ["get", "is_blocked"], 1]];
function classOf(classField: string): any {
  return ["case", BLOCKED, CUT_OFF_CLASS, ["coalesce", ["get", classField], 0]];
}
const classOfProps = (p: Record<string, any> | null | undefined, field: string) =>
  isTrue(p?.is_blocked) ? CUT_OFF_CLASS : Number(p?.[field] ?? 0);

// The slider hides the ranks below minClass. Roads cut off completely (class
// 11 on the functional isolation tab) are not a rank but a different
// condition, so they always stay.
function classFilter(classField: string, minClass: number): any {
  return minClass > 1
    ? ["any",
        [">=", classOf(classField), minClass],
        ["==", classOf(classField), CUT_OFF_CLASS]]
    : ["all"];
}

function hitLayer(sourceLayer: string, classField: string, minClass: number): any {
  return {
    id: "roads-hit",
    type: "line",
    source: "roads",
    "source-layer": sourceLayer,
    filter: classFilter(classField, minClass),
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#000", "line-opacity": 0, "line-width": HIT_WIDTH },
  };
}

// The coloured roads, plus on the functional isolation tab a white casing
// under the roads cut off completely or closed, and the hazard drawn over
// everything.
//
// The casing is there because a dark red loses contrast on the dark gray
// basemap. The first style, ColorBrewer's darkest red, measured 11.5 to 1 on
// light gray but only 1.43 to 1 on dark gray, and a white line 1.6 times as
// wide under it lifted that to 9.3. The current red (165,15,21, which the
// user asked for because the darkest one read as brown) works out at about
// 6.8 and 2.4 before the casing. It is drawn as its own layer, like the hover
// glow, rather than by changing the palette.
//
// The hazard sits on top of the roads in charcoal hatching with a white rim:
// nothing in the blue to orange ramp, and nothing near the red of class 11.
// The hatching lets the closed roads inside it still show through.
function roadLayers(sourceLayer: string, classField: string, minClass: number, opacity: number,
                    hazard: boolean): any[] {
  const classes = STYLES[classField]?.classes ?? [];
  const layers: any[] = [];
  if (hazard) {
    layers.push({
      // Shown only while the hazard is hovered (or its popup is pinned): a
      // yellow glow under every road it cuts off or closes.
      id: "hazard-hl-roads", type: "line", source: "roads", "source-layer": sourceLayer,
      filter: ["==", classOf(classField), CUT_OFF_CLASS],
      layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
      paint: {
        "line-color": HIGHLIGHT, "line-opacity": 0.95, "line-blur": 2,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 14, 14, 32, 17, 56],
      },
    });
    layers.push({
      id: "roads-casing", type: "line", source: "roads", "source-layer": sourceLayer,
      filter: ["==", classOf(classField), CUT_OFF_CLASS],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": casingWidth(classes), "line-opacity": opacity },
    });
  }
  layers.push({
    id: "roads-line", type: "line", source: "roads", "source-layer": sourceLayer,
    filter: classFilter(classField, minClass),
    layout: {
      "line-cap": "round",
      "line-join": "round",
      // The QML sets symbol levels so class 10 draws over class 1.
      // line-sort-key is the same idea: higher sorts later, so the top
      // classes end up on top instead of being buried.
      "line-sort-key": classOf(classField),
    },
    paint: {
      "line-color": colorExpression(classField, classes),
      "line-width": widthExpression(classField, classes),
      "line-opacity": opacity,
    },
  });
  if (hazard) {
    layers.push(
      // A light charcoal tint under the hatching, so the shape reads at a
      // glance as one area rather than as loose stripes.
      {
        id: "hazard-tint", type: "fill", source: "roads", "source-layer": "hazard",
        paint: { "fill-color": HAZARD_INK, "fill-opacity": 0.14 },
      },
      {
        id: "hazard-fill", type: "fill", source: "roads", "source-layer": "hazard",
        paint: { "fill-pattern": "hazard-hatch", "fill-opacity": 0.95 },
      },
      {
        id: "hazard-rim", type: "line", source: "roads", "source-layer": "hazard",
        layout: { "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.95 },
      },
      {
        id: "hazard-line", type: "line", source: "roads", "source-layer": "hazard",
        layout: { "line-join": "round" },
        paint: { "line-color": HAZARD_INK, "line-width": 3 },
      },
      // The buildings the hazard floods and cuts off, over everything else
      // the run draws, the cut-off ones on top (the user's order). Overture's
      // other buildings stay under the roads.
      // Each with a white halo and a dark edge, so a small footprint stands
      // out against the red roads and the hatching it often sits on.
      // The same yellow glow around every building it cuts off or floods.
      {
        id: "hazard-hl-bldg", type: "line", source: "roads", "source-layer": "hazard_buildings",
        layout: { "line-join": "round", visibility: "none" },
        paint: {
          "line-color": HIGHLIGHT, "line-blur": 1.5,
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 5, 16, 10],
        },
      },
      ...(["in_hazard", "cut_off"] as HazardBuildingStatus[]).flatMap((k) => [
        {
          id: `hazard-bldg-${k}-halo`, type: "line", source: "roads", "source-layer": "hazard_buildings",
          filter: ["==", ["get", "status"], k],
          layout: { "line-join": "round" },
          paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 16, 4] },
        },
        {
          id: `hazard-bldg-${k}`, type: "fill", source: "roads", "source-layer": "hazard_buildings",
          filter: ["==", ["get", "status"], k],
          paint: { "fill-color": HAZARD_BUILDING_COLORS[k], "fill-opacity": 1 },
        },
        {
          id: `hazard-bldg-${k}-edge`, type: "line", source: "roads", "source-layer": "hazard_buildings",
          filter: ["==", ["get", "status"], k],
          layout: { "line-join": "round" },
          paint: { "line-color": "#141414", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.6, 16, 1.6] },
        },
      ]),
    );
  }
  layers.push(hitLayer(sourceLayer, classField, minClass));
  return layers;
}
const HAZARD_BLDG_LAYERS = (k: HazardBuildingStatus) =>
  [`hazard-bldg-${k}-halo`, `hazard-bldg-${k}`, `hazard-bldg-${k}-edge`];
// The hover highlight for the hazard's roads and buildings: a yellow none of
// the road ranks, the cut-off red, the teal or the hatching use.
const HIGHLIGHT = "#ffe14d";
const HAZARD_HL_LAYERS = ["hazard-hl-roads", "hazard-hl-bldg"];
const ROAD_LAYER_IDS = [...HAZARD_HL_LAYERS, ...HAZARD_BLDG_LAYERS("in_hazard"), ...HAZARD_BLDG_LAYERS("cut_off"),
  "roads-casing", "roads-line", "hazard-tint", "hazard-fill", "hazard-rim", "hazard-line", "roads-hit"];

const HAZARD_INK = "#23272e";

function casingWidth(classes: { value: number; widthMm: number }[]): any {
  const mm = classes.find((c) => c.value === CUT_OFF_CLASS)?.widthMm ?? 1;
  const interp: any[] = ["interpolate", ["linear"], ["zoom"]];
  for (const [z, f] of ZOOM_SCALE) interp.push(z, mm * MM_TO_PX * WIDTH_GAIN * f * 1.6);
  return interp;
}

// Diagonal hatching for the hazard: a charcoal stripe with a thin white edge
// on each side, on transparent, so it reads on the light and dark basemaps
// alike. Made here as pixels rather than shipped as an image file.
function hatchImage(): { width: number; height: number; data: Uint8Array } {
  const size = 10;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = (x + y) % size;
      const i = (y * size + x) * 4;
      if (d <= 2) data.set([35, 39, 46, 245], i);
      else if (d === 3 || d === size - 1) data.set([255, 255, 255, 200], i);
    }
  }
  return { width: size, height: size, data };
}

// A service's map icon: the filled Material icon in Night Sky inside a white
// circle with a thin Night Sky ring, drawn at twice the size it shows so it
// stays sharp on high-density screens.
function serviceImage(paths: string[]): { width: number; height: number; data: Uint8Array } {
  const ratio = 2, size = 32 * ratio;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.scale(ratio, ratio);
  g.beginPath();
  g.arc(16, 16, 14.6, 0, Math.PI * 2);
  g.fillStyle = "#ffffff";
  g.fill();
  g.lineWidth = 1.6;
  g.strokeStyle = SERVICE_INK;
  g.stroke();
  g.translate(5.2, 5.2);
  g.scale(0.9, 0.9);
  g.fillStyle = SERVICE_INK;
  for (const d of paths) g.fill(new Path2D(d));
  return { width: size, height: size, data: new Uint8Array(g.getImageData(0, 0, size, size).data.buffer) };
}

// Shade everything outside the study area: a polygon covering the
// world with the study area cut out of it. A hole has to wind the opposite
// way to its outer ring for MapLibre to cut it, so the ring is turned round
// when it runs the same way.
function maskData(h: Hazard | null | undefined): GeoJSON.FeatureCollection {
  if (!h) return EMPTY_FC;
  const outer: [number, number][] = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  const area = (r: [number, number][]) =>
    r.reduce((s, [x1, y1], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x1 * y2 - x2 * y1; }, 0);
  const ring = area(h.studyArea) > 0 ? [...h.studyArea].reverse() : h.studyArea;
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [outer, ring] } }],
  };
}

// The hazard's middle, for a marker that finds it when zoomed out. Some
// hazards are a few hundred metres across and vanish at county scale.
function markerData(h: Hazard | null | undefined): GeoJSON.FeatureCollection {
  if (!h) return EMPTY_FC;
  const [w, s, e, n] = h.hazardBounds;
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [(w + e) / 2, (s + n) / 2] } }],
  };
}

// Darker on the dark basemap, where a light wash would read as a highlight.
const maskColor = (basemap: BasemapKey) =>
  basemap === "darkgray" ? "rgba(0, 0, 0, 0.42)" : "rgba(20, 30, 45, 0.24)";

interface Props {
  tilesUrl: string;             // pmtiles file to draw
  sourceLayer: string;          // layer name inside it
  classField: string;           // the 1..10 column
  score: Score;                 // for the popup
  basemap: BasemapKey;
  opacity: number;
  minClass: number;             // hide classes below this, to pick out the top end
  center: [number, number];
  zoom: number;
  flyKey: string;               // changes when the view should move
  countyKey: string;            // which percentile table the popup consults
  onEmptyChange?: (empty: boolean) => void;   // true when the view holds no roads
  fullBounds: Bounds;           // what the "show it all" button zooms out to
  fullLabel: string;            // that button's tooltip
  focus?: Focus | null;         // a road to go to and open, for the guided examples
  onFocusFeature?: (key: string, props: Record<string, any> | null) => void;
  onInteract?: () => void;      // the reader has hovered or clicked a road
  // The guide shown inside the popup on the focus road, in place of the
  // road's numbers. Null closes that popup.
  guide?: ReactNode | null;
  // A click on the map while the guide popup is open. Returning true means the
  // click was used by the guide, and the popup stays.
  onGuideAway?: () => boolean;
  // The map closed the guide popup itself, by a click it let through.
  onGuideClosed?: () => void;
  // On the functional isolation tab, the hazard being shown: drawn over the
  // roads, named in the popups, and its study area left clear of the shade.
  hazard?: Hazard | null;
  // Overture's buildings PMTiles, or null to hide them.
  buildingsUrl?: string | null;
  // The services to show as icons (Detours tab), or null for none.
  services?: ServiceKind[] | null;
  // Which of the hazard's buildings to draw.
  hazardBuildings?: HazardBuildingStatus[];
  // The guide is on its step about the hazard: light the hazard up as a hover
  // does.
  guideOnHazard?: boolean;
  // Which guide step is showing, so the guide can be moved off the hazard
  // again whenever the step (and so its height) changes. -1 for none.
  guideStep?: number;
  // During the guide's steps about the panel, its card on the map's left
  // edge, as [left, top, right, bottom] in map pixels. The map slides the
  // hazard out from under it.
  guideCard?: [number, number, number, number] | null;
}

// One road to travel to and open the guide popup on. `key` changes when the
// request does, so asking for the same road twice still moves the map.
export interface Focus {
  key: string;
  lngLat: [number, number];
  zoom: number;
  road: string;                 // road_name to prefer among the roads at that point
}

// Four arrows pointing outward: the usual mark for "show everything". Drawn as
// an SVG because Figtree has no glyph for it.
const FULL_EXTENT_ICON = `<svg viewBox="0 0 24 24" width="19" height="19" fill="none"
  stroke="#333" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6M3 3l6.5 6.5M21 3l-6.5 6.5M3 21l6.5-6.5M21 21l-6.5-6.5"/>
</svg>`;

export default function MapView({
  tilesUrl, sourceLayer, classField, score, basemap, opacity, minClass, center, zoom, flyKey,
  countyKey, onEmptyChange, fullBounds, fullLabel, focus, onFocusFeature, onInteract,
  guide, onGuideAway, onGuideClosed, hazard = null, buildingsUrl = null, services = null,
  hazardBuildings = ["cut_off", "in_hazard"], guideOnHazard = false, guideStep = -1,
  guideCard = null,
}: Props) {
  const div = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const ready = useRef(false);
  const hover = useRef<maplibregl.Popup | null>(null);    // follows the cursor
  const pinned = useRef<maplibregl.Popup | null>(null);   // left by a click
  const hazardHover = useRef<maplibregl.Popup | null>(null);  // the hazard's, beside it
  const hazardPinned = useRef(false);
  // the guide's hazard step holds the highlight on, like a pinned popup
  const guideHazard = useRef(false);
  // the current props, read by handlers that are registered once
  const latest = useRef({ tilesUrl, sourceLayer, classField, score, basemap, opacity, minClass, countyKey, hazard, hazardBuildings });
  latest.current = { tilesUrl, sourceLayer, classField, score, basemap, opacity, minClass, countyKey, hazard, hazardBuildings };
  const roadHtml = (p: Record<string, any>) => {
    const l = latest.current;
    return l.hazard
      ? describeIsolation(p, l.classField, l.score, l.hazard)
      : describe(p, l.classField, l.score, l.countyKey);
  };
  const emptyCb = useRef(onEmptyChange);
  emptyCb.current = onEmptyChange;
  const focusCb = useRef(onFocusFeature);
  focusCb.current = onFocusFeature;
  const interactCb = useRef(onInteract);
  interactCb.current = onInteract;
  const full = useRef({ fullBounds, fullLabel });
  full.current = { fullBounds, fullLabel };
  const fullButton = useRef<HTMLButtonElement | null>(null);
  const awayCb = useRef(onGuideAway);
  awayCb.current = onGuideAway;
  const guideClosedCb = useRef(onGuideClosed);
  guideClosedCb.current = onGuideClosed;
  const guideOn = useRef(false);
  guideOn.current = guide != null;

  // The popup holding the guide, and the element inside it that React draws
  // the guide into. MapLibre owns the popup; React only fills it.
  const guidePopup = useRef<maplibregl.Popup | null>(null);
  const guideFit = useRef<(() => void) | null>(null);
  const guideRoad = useRef<maplibregl.LngLat | null>(null);   // the road the guide is about
  const [guideHost, setGuideHost] = useState<HTMLElement | null>(null);

  // Mark one road with the glow and leave a closable popup on it. Shared by a
  // click and by the guided examples. It reads everything through refs, so the
  // handlers registered once at map creation can call it safely.
  //
  // With `asGuide`, the popup is the dark guide instead of the road's numbers.
  // It has no close button of its own (the guide draws one) and does not shut
  // on a map click, because the first click away is the guide's to answer.
  // `hit` may be null then, when the road could not be found, and the guide
  // still opens at the spot without the glow.
  //
  // The guide is anchored above the road, unless that covers the hazard on the
  // functional isolation tab (see the effect near the end). Left to choose, MapLibre
  // flips a popup below its point when it is taller than the room above, even
  // with less room below, and the guide's Back and Next row then jumps and is
  // cut off by the map's edge. Fixed to "bottom", its lower edge, where those
  // buttons are, stays put from step to step. The room above the road is
  // handed to the guide as --guide-room, so a step too tall for it scrolls
  // inside the popup instead.
  //
  // `html`, when given, is shown in place of the road's numbers, with no glow:
  // that is the hazard's own popup.
  const pin = (m: Map, lngLat: maplibregl.LngLatLike, hit: maplibregl.MapGeoJSONFeature | null,
               asGuide = false, html?: string, className?: string,
               anchor?: maplibregl.PositionAnchor) => {
    const glow = m.getSource("hover") as maplibregl.GeoJSONSource | undefined;
    hover.current?.remove();
    pinned.current?.remove();
    pinned.current = null;
    glow?.setData(hit
      ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: hit.geometry, properties: {} }] }
      : EMPTY_FC);
    const p = new maplibregl.Popup(asGuide
      ? { closeButton: false, closeOnClick: false, maxWidth: "400px", offset: 14,
          className: "guide-popup", anchor: "bottom" }
      : { closeButton: true, maxWidth: "540px", offset: anchor ? 18 : 12,
          ...(className ? { className } : {}), ...(anchor ? { anchor } : {}) })
      .setLngLat(lngLat);
    const host = asGuide ? document.createElement("div") : null;
    // offset 14, tip 10, a 10 px margin at the top, and the popup's own
    // padding of 14 above and 12 below
    // Beside the road it is centred on it, so the whole map's height is the room.
    const fit = () => {
      if (!host) return;
      const y = m.project(p.getLngLat()).y, h = m.getContainer().clientHeight;
      const a = p.options.anchor;
      const room = a === "bottom" ? y - 60 : a === "top" ? h - y - 60 : h - 40;
      host.style.setProperty("--guide-room", `${Math.max(180, room)}px`);
    };
    if (host) { guideFit.current = fit; guideRoad.current = p.getLngLat(); }
    if (host) {
      p.setDOMContent(host);
      fit();
      m.on("move", fit);
      m.on("resize", fit);
    } else {
      p.setHTML(html ?? roadHtml(hit?.properties ?? {}));
    }
    p.addTo(m);
    p.on("close", () => {
      if (pinned.current === p) pinned.current = null;
      (m.getSource("hover") as maplibregl.GeoJSONSource | undefined)?.setData(EMPTY_FC);
      if (guidePopup.current === p) {
        m.off("move", fit);
        m.off("resize", fit);
        guidePopup.current = null;
        setGuideHost(null);
        // Only news to the page when the map shut it. When the page shut it,
        // the guide is already gone from the props.
        if (guideOn.current) guideClosedCb.current?.();
      }
    });
    pinned.current = p;
    if (host) {
      guidePopup.current = p;
      setGuideHost(host);
    }
  };
  const wasEmpty = useRef<boolean | null>(null);

  // the flyKey the view currently reflects; see the fly effect below
  const lastFlyKey = useRef(flyKey);

  // build the map once
  useEffect(() => {
    if (!div.current || map.current) return;
    const protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    const baseSources: Record<string, any> = {};
    const baseLayers: any[] = [];
    for (const k of Object.keys(BASEMAPS) as BasemapKey[]) {
      baseSources[k] = {
        type: "raster", tiles: [...BASEMAPS[k].tiles], tileSize: 256,
        attribution: BASEMAPS[k].attribution, maxzoom: BASEMAPS[k].maxzoom,
      };
      // The chosen basemap starts visible rather than being switched on once
      // the map fires "load". Deferring it leaves the map blank white for as
      // long as the style takes to settle, which on a slow connection or a
      // large tile set is long enough to look broken.
      baseLayers.push({
        id: `base-${k}`, type: "raster", source: k,
        layout: { visibility: k === basemap ? "visible" : "none" },
      });
    }

    const m = new maplibregl.Map({
      container: div.current,
      style: {
        version: 8,
        sources: {
          ...baseSources,
          roads: { type: "vector", url: `pmtiles://${tilesUrl}` },
          hover: { type: "geojson", data: EMPTY_FC },
          mask: { type: "geojson", data: maskData(hazard) },
          "hazard-point": { type: "geojson", data: markerData(hazard) },
        },
        layers: [
          ...baseLayers,
          // the shade outside the study area, over the basemap and under
          // everything drawn from the data
          { id: "mask-fill", type: "fill", source: "mask", paint: { "fill-color": maskColor(basemap) } },
          // beneath the coloured road, so the road's own class colour still
          // shows through the middle of the glow
          ...HOVER_LAYERS,
          // Built into the style rather than set afterwards, for the same
          // reason as the basemap above: the first paint is already correct.
          ...roadLayers(sourceLayer, classField, minClass, opacity, hazard != null),
          {
            id: "hazard-marker", type: "circle", source: "hazard-point",
            paint: {
              "circle-radius": 7, "circle-color": HAZARD_INK,
              "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5,
              // gone by the time the hazard itself is big enough to see
              "circle-opacity": ["interpolate", ["linear"], ["zoom"], 11, 1, 12, 0],
              "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 11, 1, 12, 0],
            },
          },
        ],
      },
      // A guided example opens already on its road, so the first thing on
      // screen is the thing being explained rather than a flight to it.
      center: urlView ? [urlView.lon, urlView.lat] : focus ? focus.lngLat : center,
      zoom: urlView ? urlView.zoom : focus ? focus.zoom : zoom,
      maxZoom: 18,
      // Keeps the drawing buffer readable after each frame, so the canvas can
      // be captured. Without it a screenshot of the map comes back blank.
      preserveDrawingBuffer: true,
    });

    // The hazard's hatching is made in code, and added the first time a layer
    // asks for it.
    m.on("styleimagemissing", (e: { id: string }) => {
      if (e.id === "hazard-hatch" && !m.hasImage("hazard-hatch")) m.addImage("hazard-hatch", hatchImage());
      const svc = SERVICE_KINDS.find((k) => e.id === `svc-${k.id}`);
      if (svc && !m.hasImage(e.id)) m.addImage(e.id, serviceImage(svc.paths), { pixelRatio: 2 });
    });

    m.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "imperial" }));

    // "Show it all": the whole county on the detour tab, the whole state on
    // the pinch tab. It sits under the zoom buttons and borrows their styling.
    const fullEl = document.createElement("div");
    fullEl.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = full.current.fullLabel;
    btn.setAttribute("aria-label", full.current.fullLabel);
    btn.style.display = "flex";
    btn.style.alignItems = "center";
    btn.style.justifyContent = "center";
    btn.innerHTML = FULL_EXTENT_ICON;
    btn.addEventListener("click", () => {
      const [w, s, e, n] = full.current.fullBounds;
      m.fitBounds([[w, s], [e, n]], { padding: 30, duration: 900 });
    });
    fullEl.appendChild(btn);
    fullButton.current = btn;
    m.addControl({ onAdd: () => fullEl, onRemove: () => fullEl.remove() }, "top-right");

    // Keep the centre and zoom in the hash alongside the panel settings, so a
    // reload or a shared link reopens the same place at the same scale.
    m.on("moveend", () => {
      const c = m.getCenter();
      const p = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      p.set("lon", c.lng.toFixed(5));
      p.set("lat", c.lat.toFixed(5));
      p.set("zoom", m.getZoom().toFixed(2));
      window.history.replaceState(null, "", `#${p.toString()}`);
    });

    m.on("load", () => {
      ready.current = true;
      apply(m);
    });

    // "Is anything drawn here?" is only meaningful once the map has stopped
    // loading: mid-pan the answer is always no. idle fires when tiles and
    // rendering have both settled.
    m.on("idle", () => {
      if (!m.getLayer("roads-hit")) return;
      const empty = m.queryRenderedFeatures({ layers: ["roads-hit"] }).length === 0;
      if (wasEmpty.current !== empty) {
        wasEmpty.current = empty;
        emptyCb.current?.(empty);
      }
    });

    // Hover reads the road under the cursor, off the wide invisible layer
    // rather than the drawn one, with a few more pixels of slack on top.
    const PICK_RADIUS = 5;
    const pick = (e: MapMouseEvent) => {
      if (!m.getLayer("roads-hit")) return null;
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [
        [e.point.x - PICK_RADIUS, e.point.y - PICK_RADIUS],
        [e.point.x + PICK_RADIUS, e.point.y + PICK_RADIUS],
      ];
      const hits = m.queryRenderedFeatures(box, { layers: ["roads-hit"] });
      if (hits.length === 0) return null;
      // Several roads can fall inside the box at once. Prefer the one the map
      // is calling most important, which is also the one drawn on top.
      const field = latest.current.classField;
      return hits.reduce((best, f) =>
        classOfProps(f.properties, field) > classOfProps(best.properties, field) ? f : best);
    };

    // The hazard under the cursor: its area, or the marker that stands in for
    // it when zoomed out. The area answers only where no road does, since the
    // closed roads inside it have popups of their own. The marker is drawn
    // over the roads, so it answers first, but only while it can be seen: it
    // has faded out by zoom 12 and queryRenderedFeatures would still find it.
    const hazardBox = (e: MapMouseEvent, layer: string, r: number) => {
      if (!latest.current.hazard || !m.getLayer(layer)) return false;
      return m.queryRenderedFeatures(
        [[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: [layer] }).length > 0;
    };
    // A service icon under the cursor. Icons sit on top of everything, so
    // they answer before the roads.
    const pickService = (e: MapMouseEvent) => {
      if (!m.getLayer("services") || m.getLayoutProperty("services", "visibility") === "none") return null;
      const hits = m.queryRenderedFeatures(
        [[e.point.x - 2, e.point.y - 2], [e.point.x + 2, e.point.y + 2]], { layers: ["services"] });
      return hits[0] ?? null;
    };
    const pickMarker = (e: MapMouseEvent) =>
      m.getZoom() < 12 && hazardBox(e, "hazard-marker", 2) ? latest.current.hazard : null;
    const pickHazard = (e: MapMouseEvent) =>
      hazardBox(e, "hazard-fill", PICK_RADIUS) ? latest.current.hazard : null;

    // Whether the guide popup is pinned and can actually be seen. Once the
    // reader has dragged it off screen it no longer gets a say: hover and
    // clicks behave as they would with no guide, rather than a hidden popup
    // silently turning hover off and eating the first click.
    const guideInView = () => {
      const g = guidePopup.current;
      return !!g && g === pinned.current && m.getBounds().contains(g.getLngLat());
    };

    m.on("mousemove", (e: MapMouseEvent) => {
      const svc = pickService(e);
      const marker = svc ? null : pickMarker(e);
      const hit = svc || marker ? null : pick(e);
      const hz = marker ?? (hit || svc ? null : pickHazard(e));
      m.getCanvas().style.cursor = hit || hz || svc ? "pointer" : "";
      // A pinned popup from a click wins: the hover one would sit on top of it
      // and fight for the same space.
      const glow = m.getSource("hover") as maplibregl.GeoJSONSource | undefined;
      const overHazard = !!hz && !hit && !svc;
      if (!hazardPinned.current && !guideHazard.current) setHazardHighlight(m, overHazard);
      if (pinned.current && (pinned.current !== guidePopup.current || guideInView())) {
        hover.current?.remove();
        hazardHover.current?.remove();
        return;
      }
      if (!hit && !hz && !svc) {
        hover.current?.remove();
        hazardHover.current?.remove();
        glow?.setData(EMPTY_FC);
        return;
      }
      // The hazard's own popup sits beside the hazard, at its right-hand
      // edge, so it never covers the hazard or the roads it cuts off, which
      // light up while it shows.
      if (overHazard) {
        hover.current?.remove();
        glow?.setData(EMPTY_FC);
        const side = hazardSide(m, hz!);
        // a new popup when the side changes, since a popup's anchor is fixed
        if (!hazardHover.current || hazardHover.current.options.anchor !== side.anchor) {
          hazardHover.current?.remove();
          hazardHover.current = new maplibregl.Popup({
            closeButton: false, closeOnClick: false, maxWidth: "400px",
            offset: 18, anchor: side.anchor, className: "hazard-pop",
          });
        }
        hazardHover.current.setLngLat(side.at).setHTML(describeHazard(hz!)).addTo(m);
        return;
      }
      hazardHover.current?.remove();
      interactCb.current?.();
      glow?.setData(hit
        ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: hit.geometry, properties: {} }] }
        : EMPTY_FC);
      const html = svc ? describeService(svc.properties ?? {})
        : hit ? roadHtml(hit.properties ?? {}) : describeHazard(hz!);
      if (!hover.current) {
        hover.current = new maplibregl.Popup({
          closeButton: false, closeOnClick: false, maxWidth: "540px",
          offset: 12, className: "road-hover",
        });
      }
      hover.current.setLngLat(e.lngLat).setHTML(html).addTo(m);
      // The hazard's popup is charcoal, so it never reads as a road's. Set
      // after addTo: before its first addTo a popup has no element to take
      // the class, and the hazard's white text then sat on white.
      if (!hit && !svc) hover.current.addClassName("hazard-pop");
      else hover.current.removeClassName("hazard-pop");
    });

    // Leaving the canvas entirely, which mousemove never reports. That
    // includes moving onto a popup, so the glow stays when a popup is pinned:
    // it marks the road the popup is about, and the guide's words point at it.
    m.getCanvas().addEventListener("mouseout", () => {
      hover.current?.remove();
      hazardHover.current?.remove();
      if (!hazardPinned.current && !guideHazard.current) setHazardHighlight(m, false);
      if (!pinned.current) {
        (m.getSource("hover") as maplibregl.GeoJSONSource | undefined)?.setData(EMPTY_FC);
      }
      m.getCanvas().style.cursor = "";
    });

    // Click pins a popup so it can be read and its text selected without
    // having to hold the cursor still.
    m.on("click", (e: MapMouseEvent) => {
      // While the guide is open and in view, the page gets first say on a
      // click. If it uses the click, the guide stays; otherwise the click goes
      // on as usual and shuts the guide on the way. The second click of a
      // double-click (a zoom) is never a click away: without this, one
      // double-click would use the nudge and close the guide together.
      if (guideInView()) {
        if (e.originalEvent.detail > 1) return;
        if (awayCb.current?.()) return;
      }
      const svc = pickService(e);
      const marker = svc ? null : pickMarker(e);
      const hit = svc || marker ? null : pick(e);
      const hz = marker ?? (hit || svc ? null : pickHazard(e));
      if (svc) {
        interactCb.current?.();
        pin(m, e.lngLat, null, false, describeService(svc.properties ?? {}));
        return;
      }
      if (!hit && !hz) {
        hover.current?.remove();
        pinned.current?.remove();
        pinned.current = null;
        (m.getSource("hover") as maplibregl.GeoJSONSource | undefined)?.setData(EMPTY_FC);
        return;
      }
      interactCb.current?.();
      if (hit) pin(m, e.lngLat, hit);
      else {
        hazardHover.current?.remove();
        const side = hazardSide(m, hz!);
        pin(m, side.at, null, false, describeHazard(hz!), "hazard-pop", side.anchor);
        // the highlight stays while the pinned popup is open
        hazardPinned.current = true;
        setHazardHighlight(m, true);
        pinned.current?.on("close", () => { hazardPinned.current = false; setHazardHighlight(m, guideHazard.current); });
      }
    });

    map.current = m;
    if (import.meta.env.DEV) (window as any).__map = m;   // for checks in a browser
    return () => { m.remove(); map.current = null; ready.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swapping counties or hazards means a different tile file. MapLibre cannot
  // repoint a vector source's url, so the source and its layers are rebuilt,
  // each slotted back in under the hazard marker.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    for (const id of ROAD_LAYER_IDS) if (m.getLayer(id)) m.removeLayer(id);
    if (m.getSource("roads")) m.removeSource("roads");
    m.addSource("roads", { type: "vector", url: `pmtiles://${tilesUrl}` } as any);
    for (const layer of roadLayers(sourceLayer, classField, minClass, opacity, hazard != null)) {
      m.addLayer(layer, "hazard-marker");
    }
    wasEmpty.current = null;   // re-answered on the next idle
    apply(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tilesUrl, sourceLayer]);

  // Overture's buildings: added the first time they are asked for, then only
  // shown or hidden. They sit over the shade and under the hover glow and the
  // roads, so the analysis is always drawn on top of them.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const run = () => {
      if (buildingsUrl && !m.getSource("ov-buildings")) {
        m.addSource("ov-buildings", {
          type: "vector", url: `pmtiles://${buildingsUrl}`,
          attribution: "Buildings: Overture Maps Foundation",
        } as any);
        m.addLayer({
          id: "ov-buildings", type: "fill", source: "ov-buildings", "source-layer": "building",
          paint: { "fill-color": BUILDING_COLOR, "fill-opacity": 0.95, "fill-outline-color": BUILDING_OUTLINE },
        } as any, "roads-hover-outer");
      }
      if (m.getLayer("ov-buildings")) {
        m.setLayoutProperty("ov-buildings", "visibility", buildingsUrl ? "visible" : "none");
      }
    };
    if (ready.current) run();
    else m.on("load", run);
    return () => { m.off("load", run); };
  }, [buildingsUrl]);

  // The services on the Detours tab: loaded the first time they are shown,
  // then filtered to the kinds ticked in the panel. On top of everything, so
  // an icon is never hidden under a road.
  const serviceKey = services ? services.join(",") : "";
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const run = () => {
      const on = services != null && services.length > 0;
      if (on && !m.getSource("services")) {
        m.addSource("services", { type: "geojson", data: new URL(SERVICES_URL, document.baseURI).href });
        m.addLayer({
          id: "services", type: "symbol", source: "services",
          layout: {
            "icon-image": ["concat", "svc-", ["get", "kind"]],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.55, 12, 0.75, 15, 1],
            // Where icons crowd, as in a town centre zoomed out, some give way
            // and come back as the map zooms in.
            "icon-allow-overlap": false,
            "icon-padding": 1,
          },
        } as any);
      }
      if (m.getLayer("services")) {
        m.setFilter("services", ["in", ["get", "kind"], ["literal", services ?? []]] as any);
        m.setLayoutProperty("services", "visibility", on ? "visible" : "none");
        m.moveLayer("services");
      }
    };
    if (ready.current) run();
    else m.on("load", run);
    return () => { m.off("load", run); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceKey, services == null]);

  // The shade outside the study area and the marker on the hazard follow the
  // hazard being shown, and are emptied on the other tabs.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    (m.getSource("mask") as maplibregl.GeoJSONSource | undefined)?.setData(maskData(hazard));
    (m.getSource("hazard-point") as maplibregl.GeoJSONSource | undefined)?.setData(markerData(hazard));
  }, [hazard]);

  // Shut any popup when the thing it describes changes underneath it.
  //
  // A popup holds a snapshot: the road's name, the measure it was ranked on,
  // and that measure's numbers. Switching tabs, counties, scores or
  // classification leaves all of that stale, and a pinned popup would sit
  // there quoting the previous dataset as though it still applied. The glow
  // goes out with it, since it was marking the road being described.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    hover.current?.remove();
    pinned.current?.remove();
    pinned.current = null;
    (m.getSource("hover") as maplibregl.GeoJSONSource | undefined)?.setData(EMPTY_FC);
  }, [tilesUrl, sourceLayer, classField, score]);

  // restyle in place when the field, basemap, opacity or class filter changes
  const apply = (m: Map) => {
    const { classField, basemap, opacity, minClass } = latest.current;
    const classes = STYLES[classField]?.classes ?? [];
    if (m.getLayer("roads-line")) {
      m.setPaintProperty("roads-line", "line-color", colorExpression(classField, classes) as any);
      m.setPaintProperty("roads-line", "line-width", widthExpression(classField, classes) as any);
      m.setPaintProperty("roads-line", "line-opacity", opacity);
      m.setLayoutProperty("roads-line", "line-sort-key", classOf(classField));
      const filter = classFilter(classField, minClass);
      m.setFilter("roads-line", filter);
      // The hit layer tracks the same filter: a class hidden by the slider
      // must not still answer the cursor.
      if (m.getLayer("roads-hit")) m.setFilter("roads-hit", filter);
    }
    if (m.getLayer("hazard-hl-roads")) m.setFilter("hazard-hl-roads", ["==", classOf(classField), CUT_OFF_CLASS]);
    if (m.getLayer("roads-casing")) {
      m.setFilter("roads-casing", ["==", classOf(classField), CUT_OFF_CLASS]);
      m.setPaintProperty("roads-casing", "line-width", casingWidth(classes));
      m.setPaintProperty("roads-casing", "line-opacity", opacity);
    }
    if (m.getLayer("mask-fill")) m.setPaintProperty("mask-fill", "fill-color", maskColor(basemap));
    for (const k of ["in_hazard", "cut_off"] as HazardBuildingStatus[]) {
      for (const id of HAZARD_BLDG_LAYERS(k)) {
        if (m.getLayer(id)) {
          m.setLayoutProperty(id, "visibility", latest.current.hazardBuildings.includes(k) ? "visible" : "none");
        }
      }
    }
    for (const k of Object.keys(BASEMAPS) as BasemapKey[]) {
      m.setLayoutProperty(`base-${k}`, "visibility", k === basemap ? "visible" : "none");
    }
  };
  useEffect(() => {
    if (map.current && ready.current) apply(map.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classField, basemap, opacity, minClass, hazardBuildings.join(",")]);

  // Move the view when the tab or county actually changes.
  //
  // This compares the key rather than using a "have I run once" flag. Under
  // StrictMode React re-runs effects on the same component instance, so refs
  // survive the remount and a one-shot flag is already spent on the second
  // pass: the map would then fly to the county default and throw away a
  // centre restored from the URL. Comparing the key is idempotent, so a
  // repeated run with an unchanged key does nothing.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (lastFlyKey.current === flyKey) return;
    lastFlyKey.current = flyKey;
    m.flyTo({ center, zoom, duration: 800 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyKey]);

  // Keep the "show it all" tooltip in step with the tab it applies to.
  useEffect(() => {
    const b = fullButton.current;
    if (!b) return;
    b.title = fullLabel;
    b.setAttribute("aria-label", fullLabel);
  }, [fullLabel]);

  // Go to a guided example's road and open it.
  //
  // Declared after the fly effect on purpose: when an example changes the
  // county in the same update, both run, and the later flyTo is the one that
  // wins, so the map ends on the road rather than on the county centre.
  //
  // The road can only be read once its tiles are drawn, so this waits for
  // "idle" and looks again each time the map settles. No one-shot flag here,
  // for the StrictMode reason given above: the cleanup cancels a pending look
  // and a re-run simply starts a fresh one.
  useEffect(() => {
    const m = map.current;
    if (!m || !focus) return;
    const target = focus;
    const c = m.getCenter();
    const already = Math.abs(c.lng - target.lngLat[0]) < 1e-4
      && Math.abs(c.lat - target.lngLat[1]) < 1e-4
      && Math.abs(m.getZoom() - target.zoom) < 0.01;
    // The road is placed below the middle of the map, not on it. Its popup
    // opens upward and is tall, so a centred road pushes the popup's heading
    // and close button off the top edge.
    const move = { center: target.lngLat, zoom: target.zoom, offset: [0, 150] as [number, number] };
    if (already) m.easeTo({ ...move, duration: 0 });
    else m.flyTo({ ...move, duration: 1400 });

    let looks = 0;
    const look = () => {
      if (m.isMoving() || !m.getLayer("roads-hit")) return;
      const pt = m.project(target.lngLat);
      const R = 12;
      const hits = m.queryRenderedFeatures(
        [[pt.x - R, pt.y - R], [pt.x + R, pt.y + R]], { layers: ["roads-hit"] });
      const named = hits.filter((f) => String(f.properties?.road_name ?? "").includes(target.road));
      // On the functional isolation tab a road is split where it meets the
      // hazard, and the short pieces beside it can carry very different
      // numbers. The example is the piece at the point, so the nearest piece
      // outside the hazard is taken rather than the highest ranked one.
      const pool = latest.current.hazard ? named.filter((f) => !isTrue(f.properties?.is_blocked)) : named;
      if (pool.length) {
        const field = latest.current.classField;
        const best = latest.current.hazard
          ? pool.reduce((a, f) => (screenDistance(m, pt, f) < screenDistance(m, pt, a) ? f : a))
          : pool.reduce((a, f) =>
              classOfProps(f.properties, field) > classOfProps(a.properties, field) ? f : a);
        m.off("idle", look);
        pin(m, target.lngLat, best, true);
        focusCb.current?.(target.key, best.properties ?? {});
      } else if (++looks >= 6) {
        // The road is not where it was expected. Say so, and the guide carries
        // on with its wording that needs no numbers, still in its popup at the
        // spot, just without a road to glow.
        m.off("idle", look);
        pin(m, target.lngLat, null, true);
        focusCb.current?.(target.key, null);
      }
    };
    m.on("idle", look);
    m.triggerRepaint();
    return () => { m.off("idle", look); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key]);

  // The guide never covers the hazard on the functional isolation tab. On
  // the road steps the map puts the hazard (with the example road) at its
  // left side, centred from top to bottom, and the guide sits right beside
  // the hazard's right-hand edge, as the user asked. When the two do not fit
  // across the map, it zooms out until they do. The other tabs keep the guide
  // above its road.
  //
  // On the hazard step the hazard and what it cuts off also light up yellow,
  // as they do under the mouse.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const lit = guideOnHazard && hazard != null;
    guideHazard.current = lit;
    if (!hazardPinned.current) setHazardHighlight(m, lit);
    const p = guidePopup.current;
    if (!p || !hazard) return;
    const road = guideRoad.current ?? p.getLngLat();
    const place = () => {
      if (guidePopup.current !== p) return;
      // the hazard and the road together
      const [hw, hs, he, hn] = hazard.hazardBounds;
      const w = Math.min(hw, road.lng), s = Math.min(hs, road.lat);
      const e = Math.max(he, road.lng), n = Math.max(hn, road.lat);
      const mid = (s + n) / 2;
      // the guide beside the right-hand edge, half way down
      p.options.anchor = "left";
      p.options.offset = 20;
      p.setLngLat([e, mid]);
      guideFit.current?.();
      const box = p.getElement()?.querySelector<HTMLElement>(".maplibregl-popup-content");
      const W = box?.offsetWidth ?? 400;
      const width = m.getContainer().clientWidth;
      const LEFT = 40;
      // zoom out, never in, until the hazard and the guide fit side by side
      const west = m.project([w, mid]), east = m.project([e, mid]);
      const room = width - LEFT - 20 - W - 30;
      const k = Math.min(1, room / Math.max(1, east.x - west.x));
      // the hazard's left edge goes LEFT px from the map's, half way down
      const centre = m.unproject([west.x - (LEFT - width / 2) / k, west.y]);
      m.easeTo({ center: centre, zoom: m.getZoom() + Math.log2(k), duration: 500 });
    };
    if (m.isMoving() || !m.loaded()) m.once("idle", place);
    else requestAnimationFrame(place);
    return () => { m.off("idle", place); };
  }, [guideOnHazard, guideStep, guideHost, hazard]);

  // On the steps about the panel, the guide is a card on the map's left edge.
  // When it covers the hazard, the map fits the whole hazard into the part of
  // the map to the card's right: sliding it over, and zooming out when the
  // hazard is too wide for that part, but never zooming in.
  const cardKey = guideCard ? guideCard.map(Math.round).join(",") : "";
  useEffect(() => {
    const m = map.current;
    if (!m || !guideCard || !hazard) return;
    const card = guideCard;
    const slide = () => {
      if (hazardUnder(m, card) <= 0.01) return;
      const [w, s, e, n] = hazard.hazardBounds;
      m.fitBounds([[w, s], [e, n]], {
        padding: { left: card[2] + 24, right: 24, top: 70, bottom: 40 },
        maxZoom: m.getZoom(), duration: 600,
      });
    };
    if (m.isMoving() || !m.loaded()) m.once("idle", slide);
    else requestAnimationFrame(slide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey, hazard]);

  // The page took the guide away (its close button, Done, or a change in the
  // panel), so take its popup off the map.
  const hasGuide = guide != null;
  useEffect(() => {
    if (!hasGuide) guidePopup.current?.remove();
  }, [hasGuide]);

  return (
    <>
      <div ref={div} style={{ position: "absolute", inset: 0 }} />
      {guideHost && guide != null && createPortal(guide, guideHost)}
    </>
  );
}

// The popup for one segment.
//
// Written to be read rather than decoded: no column names, no normalised
// units, and every number introduced by a phrase that says what it counts.
// The two datasets answer different questions, so they get different wording
// rather than one generic table that fits neither well.
function describe(p: Record<string, any>, classField: string, score: Score,
                  countyKey: string): string {
  const cls = Number(p[classField]);
  const style = STYLES[classField]?.classes.find((c) => c.value === cls);
  const { primary } = splitNames(p.road_name);
  const type = roadTypeLabel(p.class);
  const isPinch = p.pinch_score != null || p.detour_len_m != null;

  const sections: Section[] = [];
  let footnote = "";

  if (isPinch) {
    // run-pinch.py zeroes any segment with a degree-1 endpoint: closing a
    // cul-de-sac cuts off only the properties on it, which is not a network
    // failure. That rule is invisible in the output, so a dead end shows real
    // traffic and no way around yet still lands in class 1, which reads as a
    // contradiction. Both ingredients positive with a zero product can only
    // mean the rule fired, and it covers 38% of roads, so it is worth saying.
    const score0 = Number(p.pinch_score ?? 0) === 0;
    const bothPositive = Number(p.centrality_norm ?? 0) > 0
      && Number(p.detour_len_m ?? 0) > 0;
    if (score0 && bothPositive) {
      sections.push({
        heading: "Why this ranks lowest",
        lines: ["This is a dead end. Closing it cuts off only the properties "
          + "along it rather than through traffic, so it is set to zero on "
          + "purpose and the figures below do not count toward its rank."],
      });
    }
    // The pinch score multiplies two things, so the popup shows both
    // ingredients and then the result. Reading only the result tells you
    // nothing about which of the two put the road where it is.
    const m = p.detour_len_m != null ? Number(p.detour_len_m) : null;
    // The sentinel means the search gave up, not that the detour is that
    // long, so it has to be worded as a search result rather than a distance.
    const detour: [string, string][] = m == null ? [] : [[
      "Shortest way around",
      m >= PINCH_NO_ALTERNATIVE_M
        ? `none found within ${humanMiles(PINCH_MAX_DETOUR_M)}`
        : `${humanMiles(m)} farther`,
    ]];
    if (detour.length) sections.push({ heading: "If this road closes", rows: detour });

    if (p.centrality_norm != null) {
      const v = Number(p.centrality_norm);
      const rank = rankSentence("centrality_norm", v, {
        more: "Carries more journeys between buildings",
        most: "Carries the most journeys between buildings",
        scope: "in the state",
      });
      sections.push({
        heading: "How much uses it",
        lines: [rank ? `${rank}.` : "Almost no journeys pass along it."],
      });
      footnote = "A journey between buildings means one building travelling to "
        + "another, counted on the quickest route. Every building is tied to "
        + "its nearest road, and a route joining two busy places counts for "
        + "more than one joining two empty ones. These are estimates from "
        + "where buildings are, not measured traffic counts.";
    }
  } else {
    const rows: [string, string][] = [];
    const raw = p[score.raw];
    if (raw != null && isFinite(Number(raw))) {
      const v = Number(raw);
      if (score.unit === "s") {
        rows.push(["Extra driving added", v > 0 ? humanSeconds(v) : "none"]);
        const cmp = score.compare && rankSentence(`${countyKey}:combined_extra_sec`, v,
          { ...score.compare, scope: "in this county" });
        if (cmp) rows.push(["Against other roads", cmp]);
      } else if (score.base === "max_service" || score.base === "mean_service") {
        const cmp = score.compare && rankSentence(`${countyKey}:${score.raw}`, v,
          { ...score.compare, scope: "in this county" });
        if (cmp) rows.push(["Against other roads", cmp]);
      } else {
        rows.push(["Weighted delay score", humanNumber(v)]);
      }
    }
    if (p.combined_affected_od != null && Number(p.combined_affected_od) > 0) {
      rows.push(["Trips forced to re-route", humanNumber(p.combined_affected_od)]);
    }
    if (p.combined_disconnected_od != null && Number(p.combined_disconnected_od) > 0) {
      rows.push(["Trips with no route at all", humanNumber(p.combined_disconnected_od)]);
    }
    if (p.services_affected != null) {
      const n = Number(p.services_affected);
      // The combined file keeps only the count. Which of the four they are is
      // dropped by run-detour-combine.py, so it cannot be named here.
      rows.push(["Services affected",
        n === 0 ? "none" : n === 4 ? "all four" : `${n} of 4`]);
    }
    if (p.travel_time_sec != null) {
      rows.push(["Time to drive this stretch", humanSeconds(Number(p.travel_time_sec))]);
    }
    if (rows.length) sections.push({ heading: "If this road closes", rows });

    // Each line is a whole statement. A bare "past 3 minutes: 5" leaves the
    // reader to guess what the 5 counts and which direction it moved; these
    // columns count routes that *used* to reach a service inside the window
    // and no longer do, which is a sentence, not a label.
    const total = Number(p.combined_affected_od ?? 0);
    const missed: string[] = [];
    for (const mins of [3, 5, 8, 15, 30, 60]) {
      const n = Number(p[`combined_lost_within_${mins}min`] ?? 0);
      if (n > 0) {
        // Given against the total it came out of, so the figure reads as the
        // share it is rather than as a bare count with no scale.
        // The noun goes on every line. The heading above names it once, but
        // these lines get read on their own, and a bare count leaves the
        // reader asking "306 of what?".
        missed.push(`${humanNumber(n)} ${n === 1 ? "trip" : "trips"} can no `
          + `longer reach a service within ${mins} minutes`);
      }
    }
    if (missed.length) {
      sections.push({
        heading: total > 0 ? `Of those ${humanNumber(total)} trips` : "Of those trips",
        lines: missed,
      });
    }
    // Without this, every count above is a number with no unit: the reader has
    // no way to know that one "trip" is one starting point going to one
    // service, nor that the services are a fixed set of four.
    if (sections.length) {
      footnote = "A trip means one starting point travelling to one service: "
        + "a fire station, medical facility, school, or grocery or convenience "
        + "store. Only trips whose quickest route runs along this road are "
        + "counted.";
    }
  }

  const rank = style
    ? `${swatch(style.color)}Ranked <b>${cls} of 10</b>`
      + `${cls === 10 ? " (highest)" : cls === 1 ? " (lowest)" : ""}`
      + ` for ${escapeHtml(score.label.toLowerCase())}`
    : "Not ranked on this measure";

  return renderPopup(primary, type, rank, sections, footnote, isPinch ? 470 : 510);
}

// `lead` sets the first line in bold, for the one sentence a section is for.
type Section = { heading: string; rows?: [string, string][]; lines?: string[]; lead?: boolean };

const swatch = (color: string) =>
  `<span style="display:inline-block;width:20px;height:4px;background:${color};`
  + `vertical-align:middle;margin-right:7px;border-radius:2px"></span>`;

const isTrue = (v: unknown) => v === true || v === 1 || v === "true" || v === "1";

// How far a road is from a point on screen, in pixels.
function screenDistance(m: Map, pt: maplibregl.Point, f: maplibregl.MapGeoJSONFeature): number {
  const g = f.geometry;
  const lines = g.type === "LineString" ? [g.coordinates]
    : g.type === "MultiLineString" ? g.coordinates : [];
  let best = Infinity;
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = m.project(line[i] as [number, number]);
      const b = m.project(line[i + 1] as [number, number]);
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy)));
    }
  }
  return best;
}

// The popup for one road on the functional isolation tab.
//
// Built around one question: how much of what this road could reach within a
// short drive can it still reach once the hazard closes the roads it covers?
// The chosen drive time leads, as whole sentences, and the other two follow
// one line each, so the reader sees the shape: close by unchanged and
// farther out cut back, or the reverse. A road cut off completely, or a piece
// inside the hazard, says that first.
function describeIsolation(p: Record<string, any>, classField: string, score: Score,
                           hazard: Hazard): string {
  const w = HAZARD_WORDS[hazard.kind];
  const cls = Number(p[classField]);
  const style = STYLES[classField]?.classes.find((c) => c.value === cls);
  const { primary } = splitNames(p.road_name);
  const type = roadTypeLabel(p.class);
  const minutes = score.minutes ?? 15;
  const blocked = isTrue(p.is_blocked);
  const isolated = isTrue(p.is_isolated) || cls === CUT_OFF_CLASS;
  const loss = Number(p[`loss_${minutes}m`] ?? 0);
  const losing = hazard.losing[String(minutes)] ?? 0;
  const sections: Section[] = [];
  const buildings = (n: number) => `${humanNumber(n)} ${n === 1 ? "building" : "buildings"}`;

  // A road that reaches no buildings even before the hazard, at the longest
  // drive time, is not joined to the rest of the network in the data (mostly
  // driveways). It has nothing to lose, so it lands in rank 1, and "no loss"
  // would read as though the hazard spared it.
  const longest = ISOLATION_CUTOFFS[ISOLATION_CUTOFFS.length - 1];
  if (!blocked && !isolated && p[`bld_${longest}m_baseline`] != null
      && Number(p[`bld_${longest}m_baseline`]) === 0) {
    return renderPopup(primary, type, `${style ? swatch(style.color) : ""}Not part of this measure`, [{
      heading: "Not joined to the road network",
      lines: [
        `This road reaches no buildings in the data, even before ${w.event}.`,
        "It is not joined to the rest of the road network, as happens with many driveways, "
          + "so there is nothing for this measure to count.",
      ],
    }], "", 470);
  }

  let rank: string;
  if (blocked) {
    rank = `${swatch(STYLES[classField]?.classes.find((c) => c.value === CUT_OFF_CLASS)?.color ?? "rgb(165, 15, 21)")}`
      + `<b>Closed</b>, ${escapeHtml(w.inside)}`;
  } else if (isolated) {
    rank = `${swatch(style?.color ?? "rgb(165, 15, 21)")}<b>Cut off completely</b>`;
  } else if (!(loss > 0)) {
    rank = `${style ? swatch(style.color) : ""}No loss within ${minutes} minutes`;
  } else if (losing < MIN_RANKED) {
    // Too few roads lose anything at this drive time for ten ranks to mean
    // anything, so no rank is claimed.
    rank = `${style ? swatch(style.color) : ""}Not ranked: only ${humanNumber(losing)} `
      + `${losing === 1 ? "road loses" : "roads lose"} anything within ${minutes} minutes`;
  } else if (style) {
    rank = `${swatch(style.color)}Ranked <b>${cls} of 10</b>`
      + `${cls === 10 ? " (highest)" : cls === 1 ? " (lowest)" : ""}`
      + ` for ${escapeHtml(score.label.toLowerCase())}`;
  } else {
    rank = "Not ranked on this measure";
  }

  if (blocked) {
    sections.push({ heading: "Closed", lines: [
      `This stretch is ${w.inside}, so it is closed.`,
      "It is drawn dark red, like the roads cut off completely.",
    ] });
    return renderPopup(primary, type, rank, sections, "", 470);
  }

  if (isolated) {
    const stranded = Number(p.isolated_buildings ?? 0);
    sections.push({
      heading: "Cut off completely",
      lines: [`With ${w.closed} closed, there is no road out from here at any drive time.`
        + (stranded > 0
          ? ` ${buildings(stranded)} ${stranded === 1 ? "is" : "are"} cut off along with it.`
          : "")],
    });
  }

  const before = Number(p[`bld_${minutes}m_baseline`]);
  const lost = Number(p[`lost_${minutes}m`] ?? 0);
  // Led by the share, in the same words as the panel: what a person on this
  // road can no longer get to. The counts behind it follow.
  if (isFinite(before)) {
    const lines: string[] = [];
    if (before <= 0) lines.push(`No buildings are within a ${minutes} minute drive of here.`);
    else if (lost > 0) {
      lines.push(`About ${humanPercent(lost / before)} of the homes, shops, schools and other `
        + `buildings they could drive to within ${minutes} minutes are now out of reach.`);
      lines.push(`Before ${w.event} they could reach ${buildings(before)} within ${minutes} minutes. `
        + `With ${w.closed} closed, they can reach ${humanNumber(before - lost)}, which is `
        + `${humanNumber(lost)} fewer.`);
    } else {
      lines.push(`Everything they could drive to within ${minutes} minutes, ${buildings(before)}, `
        + `is still in reach.`);
    }
    sections.push({ heading: "For someone on this road", lines, lead: lost > 0 });
  }

  const others: string[] = [];
  for (const c of ISOLATION_CUTOFFS) {
    if (c === minutes) continue;
    const b = Number(p[`bld_${c}m_baseline`]);
    const l = Number(p[`lost_${c}m`] ?? 0);
    if (!isFinite(b) || b <= 0) continue;
    others.push(l > 0
      ? `Within ${c} minutes you lose ${humanNumber(l)} of ${buildings(b)}, about ${humanPercent(l / b)}.`
      : `Within ${c} minutes you lose none of ${buildings(b)}.`);
  }
  if (others.length) sections.push({ heading: "At the other drive times", lines: others });

  const dist = p.dist_to_hazard_m != null ? Number(p.dist_to_hazard_m) : null;
  if (dist != null && isFinite(dist)) {
    sections.push({
      heading: "Where it is",
      lines: [dist <= 30 ? `Right beside ${w.area}.` : `About ${milesInWords(dist)} from ${w.area}.`],
    });
  }

  const footnote = "A building means any building: a home, a business, a school or any other "
    + "kind, each counted once whatever its size. Drive times assume no traffic.";
  return renderPopup(primary, type, rank, sections, footnote, 470);
}

// Turn the hazard's highlight (its cut-off and closed roads and buildings, in
// yellow) on or off.
function setHazardHighlight(m: Map, on: boolean) {
  for (const id of HAZARD_HL_LAYERS) {
    if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  }
}

// A rectangle on the map, in map pixels: [left, top, right, bottom].
type Rect = [number, number, number, number];

// The hazard's layers the guide must not cover: the hatched area and the
// buildings drawn on it.
const HAZARD_SHAPE_LAYERS = ["hazard-fill", "hazard-line", "hazard-bldg-cut_off", "hazard-bldg-in_hazard"];

// How much of a rectangle the hazard covers, from 0 to 1, sampled on a 9 by 9
// grid. Off the map nothing is drawn to test, so a point there counts as
// covered when it falls inside the hazard's bounding box, which is where the
// hazard would be once the map slides over to show it.
function hazardUnder(m: Map, [x0, y0, x1, y1]: Rect, bounds?: Bounds): number {
  const layers = HAZARD_SHAPE_LAYERS.filter((id) => m.getLayer(id));
  if (!layers.length) return 0;
  const w = m.getContainer().clientWidth, h = m.getContainer().clientHeight;
  let hit = 0;
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) {
      const x = x0 + ((x1 - x0) * (i + 0.5)) / 9, y = y0 + ((y1 - y0) * (j + 0.5)) / 9;
      if (x < 0 || y < 0 || x > w || y > h) {
        const ll = m.unproject([x, y]);
        if (bounds && ll.lng >= bounds[0] && ll.lng <= bounds[2] && ll.lat >= bounds[1] && ll.lat <= bounds[3]) hit += 1;
      }
      else if (m.queryRenderedFeatures([x, y], { layers }).length) hit += 1;
    }
  }
  return hit / 81;
}

// Where the hazard's popup goes: beside the hazard, on whichever side has room
// for it (right, left, below, above, in that order). When none has, MapLibre
// picks the anchor that keeps the popup on the map.
type PopAnchor = "left" | "right" | "top" | "bottom" | undefined;
function hazardSide(m: Map, h: Hazard): { at: [number, number]; anchor: PopAnchor } {
  const [w, s, e, n] = h.hazardBounds;
  const midLat = (s + n) / 2, midLon = (w + e) / 2;
  const width = m.getContainer().clientWidth, height = m.getContainer().clientHeight;
  const NEED_W = 320, NEED_H = 190;
  const sides: { at: [number, number]; anchor: PopAnchor; room: (x: number, y: number) => boolean }[] = [
    { at: [e, midLat], anchor: "left", room: (x) => width - x > NEED_W },
    { at: [w, midLat], anchor: "right", room: (x) => x > NEED_W },
    { at: [midLon, s], anchor: "top", room: (_, y) => height - y > NEED_H },
    { at: [midLon, n], anchor: "bottom", room: (_, y) => y > NEED_H + 60 },
  ];
  for (const side of sides) {
    const p = m.project(side.at);
    if (side.room(p.x, p.y)) return { at: side.at, anchor: side.anchor };
  }
  return { at: [e, midLat], anchor: undefined };
}

// A service's popup: its name and what kind of place it is.
function describeService(p: Record<string, any>): string {
  const kind = SERVICE_KINDS.find((k) => k.id === p.kind);
  return renderPopup(String(p.name || kind?.one || "Service"), kind?.one ?? "", "", [{
    heading: "Where trips go",
    lines: [`One of the ${(kind?.label ?? "services").toLowerCase()} the trips on this map are counted to.`],
  }], "", 360);
}

// The hazard's own popup, on hovering or clicking its hatched area: what it
// is, what it cuts off, and what is in it. White on charcoal (the
// hazard-pop class in index.html), so it never reads as a road's popup.
function describeHazard(h: Hazard): string {
  const w = HAZARD_WORDS[h.kind];
  const kind = h.kind.charAt(0).toUpperCase() + h.kind.slice(1);
  const n = (v: number, one: string, many: string) => `${humanNumber(v)} ${v === 1 ? one : many}`;
  const lines = [
    h.about[0],
    `Every road ${w.inside} is closed and drawn in dark red.`,
    h.isolatedRoads > 0
      ? `It cuts off ${n(h.isolatedRoads, "road", "roads")} completely, with `
        + `${n(h.isolatedBuildings, "building", "buildings")} on ${h.isolatedRoads === 1 ? "it" : "them"}.`
      : "It cuts off no road completely.",
    ...(h.hazardBuildings > 0
      ? [`${n(h.hazardBuildings, "building is", "buildings are")} ${w.inside} or on its closed roads.`]
      : []),
    ...h.about.slice(1),
  ];
  return `<div style="font-family:Figtree,Helvetica,Arial,sans-serif;max-width:380px;color:#fff">`
    + `<div style="font-size:10.5px;letter-spacing:0.06em;text-transform:uppercase;color:#c9ced4;font-weight:700">${escapeHtml(kind)}</div>`
    + `<div style="font-weight:700;font-size:13.5px;line-height:1.3;margin-top:1px">${escapeHtml(h.label)}</div>`
    + lines.map((l) => `<div style="font-size:11.5px;line-height:1.5;margin-top:5px">${escapeHtml(l)}</div>`).join("")
    + `</div>`;
}

function renderPopup(primary: string, type: string, rank: string, sections: Section[],
                     footnote: string, maxWidth: number): string {
  const body = sections.map(({ heading, rows, lines, lead }) => {
    const head = `<div style="font-size:10.5px;color:#7a8490;text-transform:uppercase;`
      + `letter-spacing:0.05em;margin:8px 0 3px">${escapeHtml(heading)}</div>`;
    if (lines) {
      return head + lines.map((l, i) =>
        `<div style="font-size:${lead && i === 0 ? "12.5px;font-weight:700" : "11.5px"};line-height:1.5`
        + `${lead && i === 0 ? ";margin-bottom:3px" : ""}">${escapeHtml(l)}</div>`).join("");
    }
    return head + `<table style="border-collapse:collapse;font-size:11.5px">`
      + (rows ?? []).map(([k, v]) =>
          `<tr><td style="color:#667;padding:2px 12px 2px 0;vertical-align:top">${escapeHtml(k)}</td>`
          + `<td style="font-weight:600;padding:2px 0">${escapeHtml(v)}</td></tr>`).join("")
      + `</table>`;
  }).join("");

  return `
    <div style="font-family:Figtree,Helvetica,Arial,sans-serif;max-width:${maxWidth}px">
      <div style="font-weight:700;font-size:13.5px;line-height:1.3">${escapeHtml(primary)}</div>
      <div style="color:#667;font-size:11.5px">${escapeHtml(type)}</div>
      ${rank ? `<div style="font-size:12px;margin-top:7px">${rank}</div>` : ""}
      ${body}
      ${footnote ? `<div style="font-size:10.5px;color:#7a8490;line-height:1.45;`
        + `margin-top:8px;border-top:1px solid #e3e7ea;padding-top:5px">`
        + `${escapeHtml(footnote)}</div>` : ""}
    </div>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
