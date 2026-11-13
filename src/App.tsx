import React, { useMemo, useState } from "react";
import {
  Box, Divider, Drawer, FormControl, Link, MenuItem, Radio, RadioGroup,
  FormControlLabel, Select, Slider, Stack, Tab, Tabs, Tooltip, Typography,
} from "@mui/material";
import MapView from "./MapView";
import MapBoundary from "./MapBoundary";
import Methodology from "./Methodology";
import { BULLDOG_BLUE, NIGHT_SKY, ORG_LOGO, ORG_NAME, ORG_URL } from "./brand";
import {
  BASEMAPS, BasemapKey, COUNTIES, DEFAULT_BASEMAP, DEFAULT_COUNTY, DEFAULT_TAB,
  DETOUR_SCORES, METHODOLOGY, METHODS, MethodId, NC_CENTER, NC_ZOOM,
  PINCH_SCORES, PINCH_TILES, SERVICES, STYLES, Score, TILES_BASE, TabId, classField,
} from "./config";

const LEFT = 540;
const MIN_LEFT = 300;
const MAX_LEFT = 820;
const DOC_WIDTH = 760;

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

  const score: Score = useMemo(
    () => (tab === "pinch" ? PINCH_SCORES[0] : DETOUR_SCORES.find((s) => s.base === detourScore)!),
    [tab, detourScore]);

  const field = classField(score.base, method);
  const classes = STYLES[field]?.classes ?? [];
  const countyObj = COUNTIES.find((c) => c.id === county)!;

  // Go to a study area and make sure the map actually moves there.
  const goToCounty = (id: string) => {
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
            onChange={(_, v) => setTab(v)}
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

          {tab === "detour" && (
            <Card title="County">
              <Select fullWidth size="small" value={county} onChange={(e) => setCounty(e.target.value)}
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
                <Select size="small" value={detourScore} onChange={(e) => setDetourScore(e.target.value)}>
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
            <RadioGroup value={method} onChange={(e) => setMethod(e.target.value as MethodId)}>
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
          />
        </MapBoundary>

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

// a left-panel section, boxed like the landslide viewer's
function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <Box sx={{ border: "1px solid #ddd", borderRadius: 1.5, px: 2, py: 1.5, bgcolor: "#fff", mt: 2 }}>
      {title && <Typography variant="subtitle2" gutterBottom>{title}</Typography>}
      {children}
    </Box>
  );
}
