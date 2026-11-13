import React, { useMemo, useState } from "react";
import {
  Box, Divider, Drawer, FormControl, Link, MenuItem, Radio, RadioGroup,
  FormControlLabel, Select, Slider, Stack, Tab, Tabs, Tooltip, Typography,
} from "@mui/material";
import MapView, { Focus } from "./MapView";
import MapBoundary from "./MapBoundary";
import Methodology from "./Methodology";
import { BULLDOG_BLUE, NIGHT_SKY, ORG_LOGO, ORG_NAME, ORG_URL } from "./brand";
import {
  BASEMAPS, BasemapKey, COUNTIES, DEFAULT_BASEMAP, DEFAULT_COUNTY, DEFAULT_TAB,
  DETOUR_SCORES, METHODOLOGY, METHODS, MethodId, NC_BOUNDS, NC_CENTER, NC_ZOOM,
  PINCH_SCORES, PINCH_TILES, SERVICES, STYLES, Score, TILES_BASE, TabId, classField,
} from "./config";
import { EXAMPLES, Example, OPENING_EXAMPLE, classColor, guideSteps } from "./guide";

const TRY_KEY = "tryExamplesBox";
const LEFT = 540;
const MIN_LEFT = 300;
const MAX_LEFT = 820;
const DOC_WIDTH = 760;

// A visit with nothing after the address is someone arriving cold, so it opens
// on a guided example. A link that carries settings is someone coming back to
// a view, or being sent one, and is left exactly as it was saved. Read once at
// module load, before the effects below start writing the hash.
const ARRIVED_COLD = window.location.hash.replace(/^#/, "") === "";
const focusFor = (ex: Example, n: number): Focus =>
  ({ key: `${ex.id}:${n}`, lngLat: ex.lngLat, zoom: ex.zoom, road: ex.road });

// The panel settings live in the URL hash, so a link reopens the same view.
const urlState = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const fromUrl = (key: string, fallback: string) => urlState.get(key) ?? fallback;

export default function App() {
  const [tab, setTab] = useState<TabId>(
    fromUrl("tab", DEFAULT_TAB) === "pinch" ? "pinch" : "detour");
  const [county, setCounty] = useState(() => {
    const c = fromUrl("county", DEFAULT_COUNTY);
    return COUNTIES.some((x) => x.id === c) ? c : DEFAULT_COUNTY;
  });
  const [method, setMethod] = useState<MethodId>(() => {
    const m = fromUrl("method", "geometric");
    return METHODS.some((x) => x.id === m) ? (m as MethodId) : "geometric";
  });
  const [detourScore, setDetourScore] = useState(() => {
    const s = fromUrl("score", DETOUR_SCORES[0].base);
    return DETOUR_SCORES.some((x) => x.base === s) ? s : DETOUR_SCORES[0].base;
  });
  const [basemap, setBasemap] = useState<BasemapKey>(() => {
    const b = fromUrl("basemap", DEFAULT_BASEMAP);
    return (b in BASEMAPS ? b : DEFAULT_BASEMAP) as BasemapKey;
  });
  const [opacity, setOpacity] = useState(Number(fromUrl("opacity", "0.95")) || 0.95);
  const [minClass, setMinClass] = useState(Number(fromUrl("min", "1")) || 1);
  const [left, setLeft] = useState(() =>
    Math.min(MAX_LEFT, Math.max(MIN_LEFT, Number(fromUrl("left", String(LEFT))) || LEFT)));
  const [doc, setDoc] = useState<{ file: string; label: string } | null>(null);
  const [mapEmpty, setMapEmpty] = useState(false);
  // Bumped to move the map on demand. Picking the county you are already on
  // has to fly anyway, and that would not change the key by itself.
  const [flyNonce, setFlyNonce] = useState(0);

  // The guided example on screen, if any: which road, which step, and that
  // road's numbers once the map has read them from the tiles.
  const [guide, setGuide] = useState<{ ex: Example; step: number } | null>(
    ARRIVED_COLD ? { ex: OPENING_EXAMPLE, step: 0 } : null);
  const [focus, setFocus] = useState<Focus | null>(
    ARRIVED_COLD ? focusFor(OPENING_EXAMPLE, 0) : null);
  const [guideProps, setGuideProps] = useState<Record<string, any> | null>(null);
  // Whether the reader has hovered or clicked a road yet. Until then, and
  // while no example is running, the map carries a one-line hint.
  const [touched, setTouched] = useState(false);

  const endGuide = () => { setGuide(null); setFocus(null); };

  // Whether the "Try an example" box is open. Remembered in this browser so
  // that someone who has tucked it away does not have to do so on every visit.
  // Storage can be unavailable (private windows, blocked site data), in which
  // case the box simply starts open each time.
  const [tryOpen, setTryOpen] = useState(() => {
    try { return window.localStorage.getItem(TRY_KEY) !== "closed"; } catch { return true; }
  });
  const toggleTry = () => setTryOpen((open) => {
    try { window.localStorage.setItem(TRY_KEY, open ? "closed" : "open"); } catch { /* not remembered */ }
    return !open;
  });

  // Put the panel into the state the example is written for, then send the
  // map to the road. The steps quote ranks out of 10 on the first score and
  // the geometric classes, so those are set rather than assumed.
  const startExample = (ex: Example) => {
    setTab(ex.tab);
    setCounty(ex.county);
    setMethod("geometric");
    if (ex.tab === "detour") setDetourScore(DETOUR_SCORES[0].base);
    setMinClass(1);
    setGuideProps(null);
    setGuide({ ex, step: 0 });
    setFocus((f) => focusFor(ex, f ? Number(f.key.split(":")[1]) + 1 : 1));
  };

  const score: Score = useMemo(
    () => (tab === "pinch" ? PINCH_SCORES[0] : DETOUR_SCORES.find((s) => s.base === detourScore)!),
    [tab, detourScore]);

  const field = classField(score.base, method);
  const classes = STYLES[field]?.classes ?? [];
  const countyObj = COUNTIES.find((c) => c.id === county)!;

  // Go to a study area and make sure the map actually moves there.
  const goToCounty = (id: string) => {
    endGuide();
    setCounty(id);
    setFlyNonce((n) => n + 1);
  };

  const tilesUrl = new URL(tab === "pinch" ? PINCH_TILES : countyObj.tiles, TILES_BASE).href;
  const sourceLayer = tab === "pinch" ? "pinch" : "detour";
  const center: [number, number] = tab === "pinch" ? NC_CENTER : countyObj.center;
  const zoom = tab === "pinch" ? NC_ZOOM : countyObj.zoom;

  // keep the hash in step with the panel
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    Object.entries({
      tab, county, method, score: detourScore, basemap,
      opacity: String(opacity), min: String(minClass), left: String(left),
    }).forEach(([k, v]) => p.set(k, v));
    window.history.replaceState(null, "", `#${p.toString()}`);
  }, [tab, county, method, detourScore, basemap, opacity, minClass, left]);

  // drag the panel's right edge to resize it
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const move = (ev: MouseEvent) =>
      setLeft(Math.min(MAX_LEFT, Math.max(MIN_LEFT, ev.clientX)));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Title bar across the full width, above both the panel and the map.
          The wordmark is white on transparent, so it needs the dark Night Sky
          behind it to read at all. */}
      <Box component="header" sx={{
        bgcolor: NIGHT_SKY, display: "flex", alignItems: "center", gap: 2.5,
        px: 2.5, py: 1.25, flexShrink: 0,
      }}>
        <Link href={ORG_URL} target="_blank" rel="noopener"
          sx={{ display: "block", lineHeight: 0, flexShrink: 0 }}>
          <Box component="img" src={new URL(ORG_LOGO, document.baseURI).href}
            alt={ORG_NAME}
            sx={{ width: 360, height: "auto", display: "block" }} />
        </Link>
        <Box sx={{ width: "1px", alignSelf: "stretch", bgcolor: "rgba(255,255,255,0.25)" }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ color: "#fff", fontWeight: 700, fontSize: 19, lineHeight: 1.25 }}>
            Road network connectivity
          </Typography>
          <Typography sx={{ color: "rgba(255,255,255,0.78)", fontSize: 13 }}>
            North Carolina
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        {/* Set in full white rather than a dim tint: at this size a faded grey
            on navy is the first thing to become unreadable. */}
        <Typography sx={{
          color: "rgba(255,255,255,0.92)", fontSize: 13.5, fontWeight: 500,
          textAlign: "right", maxWidth: 300, lineHeight: 1.4,
          display: { xs: "none", md: "block" },
        }}>
          {ORG_NAME}
        </Typography>
      </Box>

      <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
      <Drawer variant="permanent" sx={{
        width: left, flexShrink: 0,
        // Pinned inside the row rather than to the viewport, so the title bar
        // above is not overlapped.
        "& .MuiDrawer-paper": {
          width: left, boxSizing: "border-box", bgcolor: "#fafafa",
          position: "relative", height: "100%",
        },
      }}>
        <Box onMouseDown={startDrag} sx={{
          position: "absolute", top: 0, right: 0, bottom: 0, width: 6, cursor: "col-resize",
          zIndex: 2, "&:hover": { bgcolor: "rgba(0,0,0,0.08)" },
        }} />

        {/* A segmented control rather than MUI's default tabs. The default is a
            flat label with a hairline underline, which on a panel this busy
            does not read as something to click. The sunken track with one
            raised segment is a familiar switch, so it reads as interactive
            without a heavy block of colour shouting over the panel. */}
        <Box sx={{ px: 2, pt: 1.75, pb: 1.5 }}>
          <Tabs
            value={tab}
            onChange={(_, v) => { endGuide(); setTab(v); }}
            variant="fullWidth"
            sx={{
              minHeight: 0,
              bgcolor: "#e7eaee",
              borderRadius: 2,
              p: "4px",
              "& .MuiTabs-indicator": { display: "none" },
              "& .MuiTabs-flexContainer": { gap: "4px" },
              "& .MuiTab-root": {
                textTransform: "none",
                fontWeight: 600,
                fontSize: 14,
                minHeight: 0,
                py: 1,
                borderRadius: 1.5,
                color: "#5a6672",
                transition: "background-color 140ms, color 140ms",
                "&:hover": { bgcolor: "rgba(255,255,255,0.6)", color: BULLDOG_BLUE },
              },
              "& .Mui-selected": {
                bgcolor: "#fff",
                color: `${BULLDOG_BLUE} !important`,
                boxShadow: "0 1px 2px rgba(16,24,40,0.16)",
                "&:hover": { bgcolor: "#fff" },
              },
            }}
          >
            <Tab label="Detours" value="detour" />
            <Tab label="Pinch points" value="pinch" />
          </Tabs>
        </Box>

        <Box sx={{ p: 2, overflowY: "auto", flex: 1 }}>
          {guide && (
            <Guide ex={guide.ex} step={guide.step}
              steps={guideSteps(guide.ex, guideProps, field)}
              color={classColor(field, guideProps)}
              onStep={(n) => setGuide({ ex: guide.ex, step: n })}
              onEnd={endGuide} />
          )}

          {tab === "pinch" ? (
            <Typography variant="body2" color="text.secondary">
              Every road segment in the state, scored by how much traffic depends on it and
              how far that traffic must go if it is cut. Click a segment for its numbers.
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">
              What happens when one segment is cut and traffic must re-route to reach{" "}
              {SERVICES.join(", ")}. Click a segment for its numbers.
            </Typography>
          )}

          {/* Offered whenever no example is running, so there is always a way
              back into one. */}
          {!guide && (
            <TryExamples open={tryOpen} onToggle={toggleTry}
              examples={EXAMPLES.filter((e) => e.tab === tab)} onPick={startExample} />
          )}

          {tab === "detour" && (
            <Card title="County">
              <Select fullWidth size="small" value={county}
                onChange={(e) => { endGuide(); setCounty(e.target.value); }}
                sx={{
                  bgcolor: BULLDOG_BLUE, color: "#fff",
                  "& fieldset, &:hover fieldset, &.Mui-focused fieldset": { borderColor: BULLDOG_BLUE },
                  "& .MuiSvgIcon-root": { color: "#fff" },
                }}>
                {COUNTIES.map((c) => <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>)}
              </Select>
            </Card>
          )}

          {tab === "detour" && (
            <Card title="Score">
              <FormControl fullWidth>
                <Select size="small" value={detourScore}
                  onChange={(e) => { endGuide(); setDetourScore(e.target.value); }}>
                  {DETOUR_SCORES.map((s) => <MenuItem key={s.base} value={s.base}>{s.label}</MenuItem>)}
                </Select>
              </FormControl>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                {score.help}
              </Typography>
            </Card>
          )}

          {tab === "pinch" && (
            <Card title="Score">
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{score.label}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                {score.help}
              </Typography>
            </Card>
          )}

          <Card title="Classification">
            <RadioGroup value={method}
              onChange={(e) => { endGuide(); setMethod(e.target.value as MethodId); }}>
              {METHODS.map((m) => (
                <Tooltip key={m.id} title={m.help} placement="right" arrow>
                  <FormControlLabel value={m.id} control={<Radio size="small" sx={{ alignSelf: "flex-start", pt: 0.5 }} />}
                    sx={{ alignItems: "flex-start", mb: 0.5 }}
                    label={
                      <Box>
                        <Typography variant="body2">{m.label}</Typography>
                        <Typography variant="caption" color="text.secondary">{m.short}</Typography>
                      </Box>
                    } />
                </Tooltip>
              ))}
            </RadioGroup>
            <Typography variant="caption" color="text.secondary">
              Column: <code>{field}</code>
            </Typography>
          </Card>

          <Card title="Legend">
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              {score.label}, {METHODS.find((m) => m.id === method)?.label.toLowerCase()} breaks.
            </Typography>
            {/* high class at the top, as a map legend reads */}
            {[...classes].reverse().map((c) => (
              <Stack key={c.value} direction="row" spacing={1} alignItems="center"
                sx={{ opacity: c.value >= minClass ? 1 : 0.3, py: 0.1 }}>
                <Box sx={{
                  width: 26, bgcolor: c.color,
                  height: Math.max(2, c.widthMm * 7), borderRadius: "1px",
                }} />
                <Typography variant="caption">{c.label}</Typography>
              </Stack>
            ))}
            {/* the slider and its instruction sit together, set apart from the
                swatches above so the two read as separate things */}
            <Box sx={{ mt: 3.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                Drag to hide the lower classes.
              </Typography>
              <Box sx={{ px: 0.5 }}>
                <Slider size="small" min={1} max={10} step={1} marks value={minClass}
                  onChange={(_, v) => setMinClass(v as number)}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(v) => (v === 1 ? "all classes" : `class ${v} and up`)}
                  sx={{ color: BULLDOG_BLUE }} />
              </Box>
            </Box>
          </Card>

          <Card title="Map">
            <Typography variant="caption" color="text.secondary">Basemap</Typography>
            <Select fullWidth size="small" value={basemap} sx={{ mt: 0.5, mb: 1.5 }}
              onChange={(e) => setBasemap(e.target.value as BasemapKey)}>
              {(Object.keys(BASEMAPS) as BasemapKey[]).map((k) =>
                <MenuItem key={k} value={k}>{BASEMAPS[k].label}</MenuItem>)}
            </Select>
            <Typography variant="caption" color="text.secondary">Road opacity</Typography>
            <Box sx={{ px: 0.5 }}>
              <Slider size="small" min={0.2} max={1} step={0.05} value={opacity}
                onChange={(_, v) => setOpacity(v as number)}
                valueLabelDisplay="auto"
                valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
                sx={{ color: BULLDOG_BLUE }} />
            </Box>
          </Card>

          {/* left off entirely on a tab whose note is not written yet */}
          {METHODOLOGY[tab].length > 0 && (
            <Card title="Methodology">
              <Stack spacing={0.75}>
                {METHODOLOGY[tab].map((d) => (
                  <Link key={d.file} component="button" underline="hover" sx={{ textAlign: "left", color: BULLDOG_BLUE }}
                    onClick={() => setDoc(d)}>
                    <Typography variant="body2">{d.label}</Typography>
                  </Link>
                ))}
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                The technical note from the repository, rendered here.
              </Typography>
            </Card>
          )}

          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
            Symbology from {STYLES[field]?.source ?? "the QGIS styles"} in output/.
            Roads: Overture Maps Foundation.
          </Typography>
        </Box>
      </Drawer>

      <Box sx={{ position: "relative", flex: 1 }}>
        <MapBoundary>
          <MapView
            onEmptyChange={setMapEmpty}
            tilesUrl={tilesUrl}
            sourceLayer={sourceLayer}
            classField={field}
            score={score}
            basemap={basemap}
            opacity={opacity}
            minClass={minClass}
            center={center}
            zoom={zoom}
            flyKey={`${county}:${flyNonce}`}
            countyKey={county}
            fullBounds={tab === "pinch" ? NC_BOUNDS : countyObj.bounds}
            fullLabel={tab === "pinch" ? "Show the whole state" : `Show all of ${countyObj.label} County`}
            focus={focus}
            onFocusFeature={(key, props) => { if (key === focus?.key) setGuideProps(props); }}
            onInteract={() => setTouched(true)}
          />
        </MapBoundary>

        {/* One line on what to do, for someone who arrived by a link or left
            the example. It goes away for good the first time a road is hovered
            or clicked, and never takes clicks away from the map. */}
        {!guide && !touched && !(tab === "detour" && mapEmpty) && (
          <Box sx={{
            position: "absolute", bottom: 34, left: "50%", transform: "translateX(-50%)",
            bgcolor: "rgba(16,23,31,0.86)", color: "#fff", borderRadius: 999,
            px: 2, py: 0.9, fontSize: 13.5, fontWeight: 500, zIndex: 4,
            pointerEvents: "none", whiteSpace: "nowrap", maxWidth: "calc(100% - 24px)",
            overflow: "hidden", textOverflow: "ellipsis",
          }}>
            Move your mouse over a road to see its numbers. Click to keep them open.
          </Box>
        )}

        {/* The view is kept when the tabs are switched, which means the map can
            land somewhere the detour runs do not cover: those exist for three
            counties, not the whole state. Rather than leave a blank map with no
            explanation, say so and offer the places that do have data. */}
        {tab === "detour" && mapEmpty && (
          <Box sx={{
            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            bgcolor: "#fff", borderRadius: 2, px: 2.5, py: 2, maxWidth: 460,
            boxShadow: "0 6px 24px rgba(16,24,40,0.18)",
            border: "1px solid #dfe3e8", zIndex: 5,
          }}>
            <Typography sx={{ fontWeight: 700, fontSize: 14.5, mb: 0.5 }}>
              No detour data here
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Detours have been run for three counties so far. Pinch points cover
              the whole state, so that tab has data everywhere.
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {COUNTIES.map((c) => (
                <Box key={c.id} component="button" onClick={() => goToCounty(c.id)}
                  sx={{
                    font: "inherit", fontWeight: 600, fontSize: 13.5, cursor: "pointer",
                    px: 1.75, py: 0.75, borderRadius: 1.5, color: "#fff",
                    bgcolor: BULLDOG_BLUE, border: "none",
                    "&:hover": { bgcolor: NIGHT_SKY },
                  }}>
                  {c.label}
                </Box>
              ))}
            </Stack>
          </Box>
        )}
      </Box>
      </Box>

      <Methodology file={doc?.file ?? null} title={doc?.label ?? ""} width={DOC_WIDTH}
        onClose={() => setDoc(null)} />
    </Box>
  );
}

// The way into the guided examples. It is set on Night Sky, the darker of the
// two UNC Asheville colours in brand.ts, so it stands apart from the white
// settings cards below it, and it folds down to its title for anyone who does
// not want it.
function TryExamples({ open, onToggle, examples, onPick }: {
  open: boolean;
  onToggle: () => void;
  examples: Example[];
  onPick: (e: Example) => void;
}) {
  return (
    <Box sx={{ borderRadius: 1.5, bgcolor: NIGHT_SKY, color: "#fff", mt: 2, overflow: "hidden" }}>
      <Box component="button" onClick={onToggle} aria-expanded={open}
        title={open ? "Minimize" : "Show the examples"}
        sx={{
          font: "inherit", color: "inherit", bgcolor: "transparent", border: "none",
          cursor: "pointer", width: "100%", textAlign: "left",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          px: 2, py: 1.25, "&:hover": { bgcolor: "rgba(255,255,255,0.08)" },
        }}>
        <Typography sx={{ fontWeight: 700, fontSize: 15 }}>
          New here? Try an example
        </Typography>
        {/* a chevron drawn as an SVG, since Figtree has no arrow glyphs */}
        <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{
          width: 20, height: 20, flexShrink: 0, fill: "none", stroke: "#fff",
          strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round",
          transform: open ? "rotate(180deg)" : "none", transition: "transform 140ms",
        }}>
          <path d="M6 9l6 6 6-6" />
        </Box>
      </Box>
      {open && (
        <Box sx={{ px: 2, pb: 1.75 }}>
          <Typography sx={{ fontSize: 13, color: "rgba(255,255,255,0.88)", mb: 1.25 }}>
            Pick a road for a short walk through what the map is saying about it.
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {examples.map((e) => (
              <Box key={e.id} component="button" onClick={() => onPick(e)}
                sx={{
                  font: "inherit", fontWeight: 600, fontSize: 13, cursor: "pointer",
                  px: 1.5, py: 0.75, borderRadius: 1.5, textAlign: "left",
                  color: NIGHT_SKY, bgcolor: "#fff", border: "1px solid #fff",
                  "&:hover": { bgcolor: "#dbe7fb" },
                }}>
                {e.countyLabel}: {e.road}
              </Box>
            ))}
          </Stack>
        </Box>
      )}
    </Box>
  );
}

// The guided example: a few short steps beside the map, about the road the map
// has opened. It lives in the panel rather than over the map so it never
// covers the road or its popup, and it is not a dialog: everything else on the
// page keeps working while it is up, and one click on Skip removes it.
function Guide({ ex, step, steps, color, onStep, onEnd }: {
  ex: Example;
  step: number;
  steps: { title: string; lines: string[] }[];
  color: string | null;
  onStep: (n: number) => void;
  onEnd: () => void;
}) {
  const last = step >= steps.length - 1;
  const s = steps[Math.min(step, steps.length - 1)];
  const button = {
    font: "inherit", fontWeight: 600, fontSize: 13.5, cursor: "pointer",
    px: 1.75, py: 0.7, borderRadius: 1.5,
  } as const;
  return (
    <Box sx={{
      border: `1px solid ${BULLDOG_BLUE}`, borderLeft: `5px solid ${BULLDOG_BLUE}`,
      borderRadius: 1.5, bgcolor: "#f1f6ff", px: 2, py: 1.5, mb: 2,
    }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography sx={{
          fontSize: 11.5, fontWeight: 700, letterSpacing: "0.05em",
          textTransform: "uppercase", color: BULLDOG_BLUE,
        }}>
          Guided example, step {step + 1} of {steps.length}
        </Typography>
        <Box component="button" onClick={onEnd} sx={{
          ...button, px: 1, py: 0.25, fontSize: 13, color: "#44505c",
          bgcolor: "transparent", border: "none", textDecoration: "underline",
          "&:hover": { color: "#10171f" },
        }}>
          Skip
        </Box>
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.75 }}>
        {color && <Box sx={{ width: 22, height: 5, borderRadius: "2px", bgcolor: color, flexShrink: 0 }} />}
        <Typography sx={{ fontSize: 12.5, color: "#44505c" }}>
          {ex.road}, {ex.countyLabel} County
        </Typography>
      </Stack>

      <Typography sx={{ fontWeight: 700, fontSize: 16, mt: 1, mb: 0.75, lineHeight: 1.3 }}>
        {s.title}
      </Typography>
      {s.lines.map((l) => (
        <Typography key={l} sx={{ fontSize: 14, lineHeight: 1.55, mb: 0.9, color: "#1c2530" }}>
          {l}
        </Typography>
      ))}

      <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
        {step > 0 && (
          <Box component="button" onClick={() => onStep(step - 1)} sx={{
            ...button, color: BULLDOG_BLUE, bgcolor: "#fff", border: `1px solid ${BULLDOG_BLUE}`,
            "&:hover": { bgcolor: "#e4edff" },
          }}>
            Back
          </Box>
        )}
        <Box component="button" onClick={() => (last ? onEnd() : onStep(step + 1))} sx={{
          ...button, color: "#fff", bgcolor: BULLDOG_BLUE, border: `1px solid ${BULLDOG_BLUE}`,
          "&:hover": { bgcolor: NIGHT_SKY },
        }}>
          {last ? "Done" : "Next"}
        </Box>
      </Stack>
    </Box>
  );
}

// a left-panel section, boxed like the landslide viewer's
function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <Box sx={{ border: "1px solid #ddd", borderRadius: 1.5, px: 2, py: 1.5, bgcolor: "#fff", mt: 2 }}>
      {title && <Typography variant="subtitle2" gutterBottom>{title}</Typography>}
      {children}
    </Box>
  );
}
