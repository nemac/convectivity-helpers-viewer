// The search box on the map: find a place or an address and go there.
//
// Esri's World Geocoding Service answers both (places such as "Canton fire
// station" and street addresses). Results are never stored (forStorage is
// false): the map goes to the result and a pin marks it until the box is
// cleared. Esri's terms ask for "Powered by Esri" wherever its services are
// used; it is under the suggestions and in the map's attribution line
// (attributionControl in MapView).
//
// With VITE_ESRI_API_KEY set at build time, the search goes to Esri's keyed
// address (geocode-api.arcgis.com) with that key, which is how Esri's terms
// ask for it to be used. The key is meant for browsers: Esri limits it to the
// site's own addresses. Without one, it uses the older keyless address.
import React, { useEffect, useRef, useState } from "react";
import { Autocomplete, Box, Paper, TextField, Typography } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import maplibregl from "maplibre-gl";
import { getFeedbackMap } from "./feedback/mapHandle";
import { BULLDOG_BLUE, NIGHT_SKY } from "./brand";
import { NC_BOUNDS } from "./config";

const ESRI_KEY: string | undefined = import.meta.env.VITE_ESRI_API_KEY || undefined;
const GEOCODER = ESRI_KEY
  ? "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer"
  : "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";
const ESRI_URL = "https://www.esri.com";
const FAILED = "Search is not answering. Try again shortly.";

type Suggestion = { text: string; magicKey: string; isCollection: boolean };
type Found = { label: string; lngLat: [number, number]; extent?: [number, number, number, number] };

// Results near the middle of the map come first, and only from North
// Carolina and a little past its edges (a study area can cross into South
// Carolina), so "Canton" never offers Ohio.
const [W, S, E, N] = NC_BOUNDS;
const EXTENT = `${W - 0.6},${S - 0.6},${E + 0.6},${N + 0.6}`;
function near(): Record<string, string> {
  const c = getFeedbackMap()?.getCenter();
  return { searchExtent: EXTENT, ...(c ? { location: `${c.lng.toFixed(5)},${c.lat.toFixed(5)}` } : {}) };
}

async function geocode(op: string, params: Record<string, string>, signal?: AbortSignal): Promise<any> {
  const q = new URLSearchParams({ f: "json", ...params, ...(ESRI_KEY ? { token: ESRI_KEY } : {}) });
  const r = await fetch(`${GEOCODER}/${op}?${q}`, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message ?? "error");
  return j;
}

async function suggest(text: string, signal: AbortSignal): Promise<Suggestion[]> {
  const j = await geocode("suggest", { text, maxSuggestions: "6", countryCode: "USA", ...near() }, signal);
  return (j.suggestions ?? []) as Suggestion[];
}

// One place for a picked suggestion (magicKey) or for text typed and sent
// with Enter.
async function find(text: string, magicKey: string | undefined, signal: AbortSignal): Promise<Found | null> {
  const j = await geocode("findAddressCandidates", {
    SingleLine: text, maxLocations: "1", countryCode: "USA",
    forStorage: "false", ...(magicKey ? { magicKey } : near()),
  }, signal);
  const c = j.candidates?.[0];
  if (!c) return null;
  const e = c.extent;
  return {
    label: c.address ?? text,
    lngLat: [c.location.x, c.location.y],
    extent: e ? [e.xmin, e.ymin, e.xmax, e.ymax] : undefined,
  };
}

// The list of suggestions, with Esri's credit under it. It is drawn outside
// the search box in the page, so it carries its own feedback area name.
function ResultsPaper(props: React.HTMLAttributes<HTMLElement>) {
  const { children, ...rest } = props;
  return (
    <Paper {...rest} data-feedback-area="Search results"
      sx={{ mt: 0.75, borderRadius: 2, boxShadow: "0 4px 14px rgba(0,20,45,0.22)" }}>
      {children}
      <Typography variant="caption" component="div" color="text.secondary"
        onMouseDown={(e) => e.preventDefault()}
        sx={{ px: 2, py: 0.75, borderTop: "1px solid #e6e8eb" }}>
        Results powered by{" "}
        <a href={ESRI_URL} target="_blank" rel="noopener" style={{ color: BULLDOG_BLUE }}>Esri</a>
      </Typography>
    </Paper>
  );
}

const VISUALLY_HIDDEN = {
  position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap",
} as const;

export default function PlaceSearch() {
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  // A problem shown under the box for a few seconds, and what a screen
  // reader hears (problems and the place gone to).
  const [note, setNote] = useState<string | null>(null);
  const [spoken, setSpoken] = useState("");
  const noteFromSuggest = useRef(false);
  const highlighted = useRef(false);
  const marker = useRef<maplibregl.Marker | null>(null);
  // Only the latest search moves the map: each one, and each clearing of
  // the box, takes a new number, and an answer for an older one is dropped.
  const req = useRef(0);
  const findCtl = useRef<AbortController | null>(null);

  const say = (text: string | null, fromSuggest = false) => {
    setNote(text);
    noteFromSuggest.current = fromSuggest;
    if (text) setSpoken(text);
  };

  // A problem note fades after six seconds.
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 6000);
    return () => window.clearTimeout(t);
  }, [note]);

  // Suggestions as the words are typed, a quarter of a second after the
  // last key, and only for the latest words.
  useEffect(() => {
    const text = input.trim();
    if (text.length < 3) { setOptions([]); return; }
    const ctl = new AbortController();
    const t = window.setTimeout(() => {
      suggest(text, ctl.signal)
        .then((s) => { setOptions(s); if (noteFromSuggest.current) say(null); })
        .catch((e) => { if (e.name !== "AbortError") say(FAILED, true); });
    }, 250);
    return () => { ctl.abort(); window.clearTimeout(t); };
  }, [input]);

  const clearPin = () => { marker.current?.remove(); marker.current = null; };
  const cancel = () => { req.current += 1; findCtl.current?.abort(); findCtl.current = null; };
  useEffect(() => () => { cancel(); clearPin(); }, []);

  const go = async (text: string, magicKey?: string) => {
    const m = getFeedbackMap();
    if (!m || !text.trim()) return;
    cancel();
    const mine = req.current;
    const ctl = new AbortController();
    findCtl.current = ctl;
    let f: Found | null = null;
    try {
      f = await find(text.trim(), magicKey, ctl.signal);
    } catch (e: any) {
      if (mine === req.current && e?.name !== "AbortError") say(FAILED);
      return;
    }
    if (mine !== req.current) return;
    if (!f) { say(`Nothing found for "${text.trim()}".`); return; }
    say(null);
    setSpoken(`Showing ${f.label} on the map.`);
    clearPin();
    const el = document.createElement("div");
    el.setAttribute("aria-hidden", "true");
    el.title = f.label;
    Object.assign(el.style, {
      width: "18px", height: "18px", borderRadius: "50%", background: NIGHT_SKY,
      border: "3px solid #fff", boxShadow: "0 1px 4px rgba(0,0,0,0.45)", boxSizing: "border-box",
    });
    marker.current = new maplibregl.Marker({ element: el }).setLngLat(f.lngLat).addTo(m);
    const [w, s, e, n] = f.extent ?? [0, 0, 0, 0];
    if (f.extent && e - w > 1e-6 && n - s > 1e-6) {
      m.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 16, duration: 1200 });
    } else {
      m.flyTo({ center: f.lngLat, zoom: 16, duration: 1200 });
    }
  };

  return (
    <Box data-feedback-area="Search" sx={{
      position: "absolute", top: 10, zIndex: 3,
      left: { xs: 58, md: 150 },
      width: { xs: "calc(100% - 118px)", md: 320 },
      maxWidth: { md: "calc(100% - 220px)" },
    }}>
      <Autocomplete<Suggestion, false, false, true>
        freeSolo
        options={options}
        // the list opens only when there is something in it
        open={open && options.length > 0}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        filterOptions={(o) => o}
        getOptionLabel={(o) => (typeof o === "string" ? o : o.text)}
        isOptionEqualToValue={(a, b) => a.magicKey === b.magicKey}
        inputValue={input}
        onInputChange={(_, v, reason) => {
          if (reason === "reset") { setInput(v); return; }
          setInput(v);
          if (reason === "clear" || v === "") { cancel(); clearPin(); say(null); setSpoken(""); }
        }}
        onHighlightChange={(_, o) => { highlighted.current = o != null; }}
        // Enter on typed words always searches, even the same words again
        // (a retry, or going back after panning away). MUI would ignore a
        // second Enter on words it already took.
        onKeyDown={(e) => {
          if (e.key === "Enter" && !(open && highlighted.current)) {
            (e as any).defaultMuiPrevented = true;
            e.preventDefault();
            setOpen(false);
            go(input);
          }
        }}
        onChange={(_, v) => { if (v && typeof v !== "string") go(v.text, v.magicKey); }}
        PaperComponent={ResultsPaper}
        renderOption={(props, o) => {
          const { key, ...rest } = props as typeof props & { key: string };
          return <li key={key} {...rest} data-feedback-pass="">{o.text}</li>;
        }}
        renderInput={(params) => (
          <TextField {...params} placeholder="Search for a place or address"
            inputProps={{ ...params.inputProps, "aria-label": "Search for a place or address", "data-feedback-pass": "" }}
            InputProps={{
              ...params.InputProps,
              startAdornment: <SearchIcon fontSize="small" sx={{ color: NIGHT_SKY, ml: 0.5 }} />,
            }}
            sx={{
              "& .MuiOutlinedInput-root": {
                height: 40, py: 0, pl: 1, borderRadius: "20px", bgcolor: "#fff", fontSize: 14,
                boxShadow: "0 2px 6px rgba(0,20,45,0.25)",
              },
              // 5.9:1 on white; MUI's faded default is too light to read
              "& input::placeholder": { color: "#5f6670", opacity: 1 },
              "& .MuiOutlinedInput-notchedOutline": { border: "none" },
              "& .Mui-focused .MuiOutlinedInput-notchedOutline": { border: `2px solid ${BULLDOG_BLUE}` },
            }} />
        )}
      />
      {/* Always in the page, so a screen reader announces each change. */}
      <Box role="status" sx={VISUALLY_HIDDEN}>{spoken}</Box>
      {/* Over the legend's top edge for a moment, so clicks pass through it. */}
      {note && (
        <Typography variant="caption" aria-hidden="true" sx={{
          display: "block", mt: 0.75, px: 1.5, py: 0.5, bgcolor: "#fff1c7", color: "#6b4b00",
          borderRadius: 1.5, boxShadow: "0 2px 6px rgba(0,20,45,0.2)", pointerEvents: "none",
          position: "relative", zIndex: 4,
        }}>
          {note}
        </Typography>
      )}
    </Box>
  );
}
