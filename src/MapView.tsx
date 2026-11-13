import { useEffect, useRef } from "react";
import maplibregl, { Map, MapMouseEvent } from "maplibre-gl";
import { Protocol } from "pmtiles";
import {
  BASEMAPS, BasemapKey, PINCH_MAX_DETOUR_M, PINCH_NO_ALTERNATIVE_M, STYLES,
  Score, humanMiles, humanNumber, humanSeconds, percentileOf,
  rankSentence, roadTypeLabel, splitNames,
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
export function viewFromUrl(): { lon: number; lat: number; zoom: number } | null {
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
  const match: any[] = ["match", ["get", classField]];
  for (const c of classes) match.push(c.value, c.widthMm * MM_TO_PX * WIDTH_GAIN);
  match.push(0.4);   // anything outside 1..10: barely there, mirroring "no all other values"
  const interp: any[] = ["interpolate", ["linear"], ["zoom"]];
  for (const [z, f] of ZOOM_SCALE) interp.push(z, ["*", match, f]);
  return interp;
}

function colorExpression(classField: string, classes: { value: number; color: string }[]) {
  const match: any[] = ["match", ["get", classField]];
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

function hitLayer(sourceLayer: string, classField: string, minClass: number): any {
  return {
    id: "roads-hit",
    type: "line",
    source: "roads",
    "source-layer": sourceLayer,
    filter: (minClass > 1
      ? [">=", ["coalesce", ["get", classField], 0], minClass]
      : ["all"]),
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#000", "line-opacity": 0, "line-width": HIT_WIDTH },
  };
}

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
}

export default function MapView({
  tilesUrl, sourceLayer, classField, score, basemap, opacity, minClass, center, zoom, flyKey,
  countyKey, onEmptyChange,
}: Props) {
  const div = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const ready = useRef(false);
  const hover = useRef<maplibregl.Popup | null>(null);    // follows the cursor
  const pinned = useRef<maplibregl.Popup | null>(null);   // left by a click
  // the current props, read by handlers that are registered once
  const latest = useRef({ tilesUrl, sourceLayer, classField, score, basemap, opacity, minClass, countyKey });
  latest.current = { tilesUrl, sourceLayer, classField, score, basemap, opacity, minClass, countyKey };
  const emptyCb = useRef(onEmptyChange);
  emptyCb.current = onEmptyChange;
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
        },
        layers: [
          ...baseLayers,
          // beneath the coloured road, so the road's own class colour still
          // shows through the middle of the glow
          ...HOVER_LAYERS,
          {
            id: "roads-line",
            type: "line",
            source: "roads",
            "source-layer": sourceLayer,
            // Built into the style rather than set afterwards, for the same
            // reason as the basemap above: the first paint is already correct.
            filter: (minClass > 1
              ? [">=", ["coalesce", ["get", classField], 0], minClass]
              : ["all"]) as any,
            layout: {
              "line-cap": "round",
              "line-join": "round",
              // The QML sets symbol levels so class 10 draws over class 1.
              // line-sort-key is the same idea: higher sorts later, so the
              // top classes end up on top instead of being buried.
              "line-sort-key": ["coalesce", ["get", classField], 0],
            },
            paint: {
              "line-color": colorExpression(classField, STYLES[classField]?.classes ?? []) as any,
              "line-width": widthExpression(classField, STYLES[classField]?.classes ?? []) as any,
              "line-opacity": opacity,
            },
          },
          hitLayer(sourceLayer, classField, minClass),
        ],
      },
      center: urlView ? [urlView.lon, urlView.lat] : center,
      zoom: urlView ? urlView.zoom : zoom,
      maxZoom: 18,
      // Keeps the drawing buffer readable after each frame, so the canvas can
      // be captured. Without it a screenshot of the map comes back blank.
      preserveDrawingBuffer: true,
    });

    m.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "imperial" }));

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
        Number(f.properties?.[field] ?? 0) > Number(best.properties?.[field] ?? 0) ? f : best);
    };

    m.on("mousemove", (e: MapMouseEvent) => {
      const hit = pick(e);
      m.getCanvas().style.cursor = hit ? "pointer" : "";
      // A pinned popup from a click wins: the hover one would sit on top of it
      // and fight for the same space.
      const glow = m.getSource("hover") as maplibregl.GeoJSONSource | undefined;
      if (pinned.current) { hover.current?.remove(); return; }
      if (!hit) {
        hover.current?.remove();
        glow?.setData(EMPTY_FC);
        return;
      }
      glow?.setData({ type: "FeatureCollection", features: [{ type: "Feature", geometry: hit.geometry, properties: {} }] });
      const html = describe(hit.properties ?? {}, latest.current.classField, latest.current.score,
        latest.current.countyKey);
      if (!hover.current) {
        hover.current = new maplibregl.Popup({
          closeButton: false, closeOnClick: false, maxWidth: "540px",
          offset: 12, className: "road-hover",
        });
      }
      hover.current.setLngLat(e.lngLat).setHTML(html).addTo(m);
    });

    // Leaving the canvas entirely, which mousemove never reports.
    m.getCanvas().addEventListener("mouseout", () => {
      hover.current?.remove();
      (m.getSource("hover") as maplibregl.GeoJSONSource | undefined)?.setData(EMPTY_FC);
      m.getCanvas().style.cursor = "";
    });

    // Click pins a popup so it can be read and its text selected without
    // having to hold the cursor still.
    m.on("click", (e: MapMouseEvent) => {
      const hit = pick(e);
      const glow = m.getSource("hover") as maplibregl.GeoJSONSource | undefined;
      hover.current?.remove();
      pinned.current?.remove();
      pinned.current = null;
      if (!hit) { glow?.setData(EMPTY_FC); return; }
      glow?.setData({ type: "FeatureCollection", features: [{ type: "Feature", geometry: hit.geometry, properties: {} }] });
      const p = new maplibregl.Popup({ closeButton: true, maxWidth: "540px", offset: 12 })
        .setLngLat(e.lngLat)
        .setHTML(describe(hit.properties ?? {}, latest.current.classField, latest.current.score,
        latest.current.countyKey))
        .addTo(m);
      p.on("close", () => {
        if (pinned.current === p) pinned.current = null;
        (m.getSource("hover") as maplibregl.GeoJSONSource | undefined)?.setData(EMPTY_FC);
      });
      pinned.current = p;
    });

    map.current = m;
    return () => { m.remove(); map.current = null; ready.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swapping counties means a different tile file. MapLibre cannot repoint a
  // vector source's url, so the source and its layer are rebuilt.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    if (m.getLayer("roads-hit")) m.removeLayer("roads-hit");
    if (m.getLayer("roads-line")) m.removeLayer("roads-line");
    if (m.getSource("roads")) m.removeSource("roads");
    m.addSource("roads", { type: "vector", url: `pmtiles://${tilesUrl}` } as any);
    m.addLayer({
      id: "roads-line", type: "line", source: "roads", "source-layer": sourceLayer,
      filter: (minClass > 1
        ? [">=", ["coalesce", ["get", classField], 0], minClass]
        : ["all"]),
      layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["coalesce", ["get", classField], 0] },
      paint: {
        "line-color": colorExpression(classField, STYLES[classField]?.classes ?? []) as any,
        "line-width": widthExpression(classField, STYLES[classField]?.classes ?? []) as any,
        "line-opacity": opacity,
      },
    } as any);
    m.addLayer(hitLayer(sourceLayer, classField, minClass));
    wasEmpty.current = null;   // re-answered on the next idle
    apply(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tilesUrl, sourceLayer]);

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
      m.setLayoutProperty("roads-line", "line-sort-key", ["coalesce", ["get", classField], 0] as any);
      const filter = (minClass > 1
        ? [">=", ["coalesce", ["get", classField], 0], minClass]
        : ["all"]) as any;
      m.setFilter("roads-line", filter);
      // The hit layer tracks the same filter: a class hidden by the slider
      // must not still answer the cursor.
      if (m.getLayer("roads-hit")) m.setFilter("roads-hit", filter);
    }
    for (const k of Object.keys(BASEMAPS) as BasemapKey[]) {
      m.setLayoutProperty(`base-${k}`, "visibility", k === basemap ? "visible" : "none");
    }
  };
  useEffect(() => {
    if (map.current && ready.current) apply(map.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classField, basemap, opacity, minClass]);

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

  return <div ref={div} style={{ position: "absolute", inset: 0 }} />;
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

  const sections: { heading: string; rows?: [string, string][]; lines?: string[] }[] = [];
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

  const swatch = style
    ? `<span style="display:inline-block;width:20px;height:4px;background:${style.color};`
      + `vertical-align:middle;margin-right:7px;border-radius:2px"></span>`
    : "";
  const rank = style
    ? `${swatch}Ranked <b>${cls} of 10</b>`
      + `${cls === 10 ? " (highest)" : cls === 1 ? " (lowest)" : ""}`
      + ` for ${escapeHtml(score.label.toLowerCase())}`
    : "Not ranked on this measure";

  const body = sections.map(({ heading, rows, lines }) => {
    const head = `<div style="font-size:10.5px;color:#7a8490;text-transform:uppercase;`
      + `letter-spacing:0.05em;margin:8px 0 3px">${escapeHtml(heading)}</div>`;
    if (lines) {
      return head + lines.map((l) =>
        `<div style="font-size:11.5px;line-height:1.5">${escapeHtml(l)}</div>`).join("");
    }
    return head + `<table style="border-collapse:collapse;font-size:11.5px">`
      + (rows ?? []).map(([k, v]) =>
          `<tr><td style="color:#667;padding:2px 12px 2px 0;vertical-align:top">${escapeHtml(k)}</td>`
          + `<td style="font-weight:600;padding:2px 0">${escapeHtml(v)}</td></tr>`).join("")
      + `</table>`;
  }).join("");

  return `
    <div style="font-family:Figtree,Helvetica,Arial,sans-serif;max-width:${isPinch ? 470 : 510}px">
      <div style="font-weight:700;font-size:13.5px;line-height:1.3">${escapeHtml(primary)}</div>
      <div style="color:#667;font-size:11.5px">${escapeHtml(type)}</div>
      <div style="font-size:12px;margin-top:7px">${rank}</div>
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
