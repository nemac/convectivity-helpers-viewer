import React, { useMemo, useRef, useState } from "react";
import {
  Box, ButtonBase, Checkbox, Divider, Drawer, FormControl, Link, MenuItem, MenuList, Popover, Radio, RadioGroup,
  FormControlLabel, Select, Slider, Stack, Tab, Tabs, Tooltip, Typography,
} from "@mui/material";
import MapView, { Focus } from "./MapView";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import HealthAndSafetyIcon from "@mui/icons-material/HealthAndSafety";
import SchoolIcon from "@mui/icons-material/School";
import LocalGroceryStoreIcon from "@mui/icons-material/LocalGroceryStore";
import PublicIcon from "@mui/icons-material/Public";
import CheckIcon from "@mui/icons-material/Check";
import MapBoundary from "./MapBoundary";
import Methodology from "./Methodology";
import { BULLDOG_BLUE, NIGHT_SKY, ORG_LOGO_SCREEN, ORG_NAME, ORG_URL } from "./brand";
import {
  BASEMAPS, BasemapKey, COUNTIES, CUT_OFF_CLASS, DEFAULT_BASEMAP, DEFAULT_COUNTY, DEFAULT_CUTOFF,
  DEFAULT_TAB, DETOUR_SCORES, HAZARDS, HAZARD_WORDS, ISOLATION_SCORES, METHODOLOGY, METHODS,
  MIN_RANKED, MethodId, NC_BOUNDS, NC_CENTER, NC_ZOOM, PINCH_SCORES, PINCH_TILES,
  STYLES, Score, TILES_BASE, TabId, classField, defaultHazard, hazardView, hazardsIn,
  latestOvertureRelease, overtureBuildingsUrl, BUILDING_COLOR, BUILDING_OUTLINE, OVERTURE_BUILDINGS_URL,
  shareRange,
  SERVICE_INK, SERVICE_KINDS, ServiceKind, HAZARD_BUILDING_COLORS, HazardBuildingStatus,
} from "./config";
import {
  Example, GuideStep, OPENING_EXAMPLE, PanelTarget, classColor, firstExample, guideSteps, nudge,
} from "./guide";

// Set once someone has closed the guide that opens on a first visit, so the
// next visit opens with only the round button. Double-clicking the credits
// line at the foot of the panel clears it; see resetRemembered below.
const GUIDE_KEY = "guideClosed";
const GUIDE_DONE = (() => {
  try { return window.localStorage.getItem(GUIDE_KEY) === "1"; } catch { return false; }
})();
const rememberGuideClosed = () => {
  try { window.localStorage.setItem(GUIDE_KEY, "1"); } catch { /* not remembered */ }
};
// How long the "Start the guide" pill waits under the map before tucking
// itself into a circle in the corner.
const PILL_MS = 15000;

// The tabs in the title bar, in order. The first is the one a plain address
// opens on (DEFAULT_TAB in config.ts).
const NAV_TABS: { value: TabId; label: string }[] = [
  { value: "isolation", label: "Functional isolation" },
  { value: "detour", label: "Detours" },
  { value: "pinch", label: "Pinch points" },
];
const LEFT = 540;
const MIN_LEFT = 300;
const MAX_LEFT = 820;
const DOC_WIDTH = 760;

// A visit with nothing after the address is someone arriving cold, so it opens
// on a guided example. A link that carries settings is someone coming back to
// a view, or being sent one, and is left exactly as it was saved. Read once at
// module load, before the effects below start writing the hash.
const ARRIVED_COLD = window.location.hash.replace(/^#/, "") === "";
const OPEN_ON_ARRIVAL = ARRIVED_COLD && !GUIDE_DONE;
const focusFor = (ex: Example, n: number): Focus =>
  ({ key: `${ex.id}:${n}`, lngLat: ex.lngLat, zoom: ex.zoom, road: ex.road });

// Forget that this browser has closed the guide, then load the plain address,
// which is exactly what a first visit sees. A hidden way to see the first
// visit again; nothing on screen points to it. "tryExamplesBox" is the
// remembered state of a panel box that has since been removed.
const resetRemembered = () => {
  try {
    window.localStorage.removeItem(GUIDE_KEY);
    window.localStorage.removeItem("tryExamplesBox");
  } catch { /* nothing stored */ }
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  window.location.reload();
};

// The panel settings live in the URL hash, so a link reopens the same view.
const urlState = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const fromUrl = (key: string, fallback: string) => urlState.get(key) ?? fallback;

// The two choices on the detour tab, the county and what the map shows, share
// one solid Bulldog Blue look, so both read as the controls that change the
// map. The score picker in plain white was easy to miss among the cards.
// Checkboxes in the panel, ticked in Bulldog Blue.
const CHECK_SX = { "&.Mui-checked": { color: BULLDOG_BLUE } };

const PICKER_SX = {
  bgcolor: BULLDOG_BLUE, color: "#fff",
  "& fieldset, &:hover fieldset, &.Mui-focused fieldset": { borderColor: BULLDOG_BLUE },
  "& .MuiSvgIcon-root": { color: "#fff" },
};

export default function App() {
  const [tab, setTab] = useState<TabId>(() => {
    const t = fromUrl("tab", DEFAULT_TAB);
    return NAV_TABS.some((x) => x.value === t) ? (t as TabId) : DEFAULT_TAB;
  });
  const [county, setCounty] = useState(() => {
    const c = fromUrl("county", DEFAULT_COUNTY);
    return COUNTIES.some((x) => x.id === c) ? c : DEFAULT_COUNTY;
  });
  // The hazard on the functional isolation tab, always one in the county
  // picked; a link naming a hazard in another county gets that county's first.
  const [hazardId, setHazardId] = useState(() => {
    const h = fromUrl("hazard", "");
    return hazardsIn(county).some((x) => x.id === h) ? h : defaultHazard(county);
  });
  const [cutoff, setCutoff] = useState(() => {
    const c = Number(fromUrl("cutoff", String(DEFAULT_CUTOFF)));
    return ISOLATION_SCORES.some((s) => s.minutes === c) ? c : DEFAULT_CUTOFF;
  });
  const [method, setMethod] = useState<MethodId>(() => {
    const m = fromUrl("method", "geometric");
    return METHODS.some((x) => x.id === m) ? (m as MethodId) : "geometric";
  });
  const [detourScore, setDetourScore] = useState(() => {
    const s = fromUrl("score", DETOUR_SCORES[0].base);
    return DETOUR_SCORES.some((x) => x.base === s) ? s : DETOUR_SCORES[0].base;
  });
  // Overture's buildings over the basemap, for context. Off unless the link
  // or the reader turns them on. The release is looked up the first time.
  const [buildings, setBuildings] = useState(fromUrl("buildings", "0") === "1");
  const [overtureRelease, setOvertureRelease] = useState<string | null>(null);
  React.useEffect(() => {
    if (buildings && !overtureRelease) latestOvertureRelease().then(setOvertureRelease);
  }, [buildings, overtureRelease]);
  // The services drawn as icons on the Detours tab: all four to begin with.
  const [services, setServices] = useState<ServiceKind[]>(() => {
    const raw = urlState.get("svc");
    if (raw == null) return SERVICE_KINDS.map((k) => k.id);
    return SERVICE_KINDS.map((k) => k.id).filter((id) => raw.split(",").includes(id));
  });
  const toggleService = (id: ServiceKind) =>
    setServices((cur) => (cur.includes(id) ? cur.filter((x) => x !== id)
      : SERVICE_KINDS.map((k) => k.id).filter((k) => k === id || cur.includes(k))));
  // The hazard's own buildings on the functional isolation tab: both kinds
  // shown to begin with.
  const [hazardBldgs, setHazardBldgs] = useState<HazardBuildingStatus[]>(() => {
    const raw = urlState.get("hb");
    const all: HazardBuildingStatus[] = ["cut_off", "in_hazard"];
    return raw == null ? all : all.filter((k) => raw.split(",").includes(k));
  });
  const toggleHazardBldg = (k: HazardBuildingStatus) => setHazardBldgs((cur) =>
    (cur.includes(k) ? cur.filter((x) => x !== k)
      : (["cut_off", "in_hazard"] as HazardBuildingStatus[]).filter((x) => x === k || cur.includes(x))));
  const [basemap, setBasemap] = useState<BasemapKey>(() => {
    const b = fromUrl("basemap", DEFAULT_BASEMAP);
    return (b in BASEMAPS ? b : DEFAULT_BASEMAP) as BasemapKey;
  });
  // The roads' opacity, fixed now that its slider is gone.
  const opacity = 0.95;
  const [minClass, setMinClass] = useState(Number(fromUrl("min", "1")) || 1);
  const [left, setLeft] = useState(() =>
    Math.min(MAX_LEFT, Math.max(MIN_LEFT, Number(fromUrl("left", String(LEFT))) || LEFT)));
  const [doc, setDoc] = useState<{ file: string; label: string } | null>(null);
  const [mapEmpty, setMapEmpty] = useState(false);
  // Bumped to move the map on demand. Picking the county you are already on
  // has to fly anyway, and that would not change the key by itself.
  const [flyNonce, setFlyNonce] = useState(0);

  // The guide on screen, if any: which road, which step, and that road's
  // numbers once the map has read them from the tiles. It sits in a dark popup
  // on the road itself. A first visit opens it, and so does the round "Start
  // the guide" button. `nudged` marks the step reached by the first click away
  // from the popup, which carries a friendly line on top.
  const [guide, setGuide] = useState<{ ex: Example; step: number; nudged: boolean } | null>(
    OPEN_ON_ARRIVAL ? { ex: OPENING_EXAMPLE, step: 0, nudged: false } : null);
  const [focus, setFocus] = useState<Focus | null>(
    OPEN_ON_ARRIVAL ? focusFor(OPENING_EXAMPLE, 0) : null);
  const [guideProps, setGuideProps] = useState<Record<string, any> | null>(null);
  // Whether the reader has hovered or clicked a road yet. Until then, and
  // while no example is running, the map carries a one-line hint.
  const [touched, setTouched] = useState(false);
  // The way back into the guide when it is closed: a pill under the map just
  // after closing, which tucks into a circle in the corner after a while.
  const [launcher, setLauncher] = useState<"pill" | "circle">("circle");
  // The first click away from the popup guide is answered with a nudge and
  // the next step, once per page load. Every click after that is let through.
  const nudgeUsed = useRef(false);
  // Whether the guide now running has been on screen. Its popup only opens
  // once the road's tiles are drawn, which can take a few seconds, and a guide
  // closed before then (say by switching tabs) was never seen, so it is not
  // remembered as closed.
  const guideSeen = useRef(false);

  // Closing the guide by any route (its close button, Done, a second click
  // away, or a change in the panel) is remembered, and leaves the pill.
  const endGuide = () => {
    if (guide && guideSeen.current) {
      rememberGuideClosed();
      setLauncher("pill");
    }
    guideSeen.current = false;
    setGuide(null);
    setFocus(null);
  };

  React.useEffect(() => {
    if (guide || launcher !== "pill") return;
    const t = window.setTimeout(() => setLauncher("circle"), PILL_MS);
    return () => window.clearTimeout(t);
  }, [guide, launcher]);

  // Put the panel into the state the example is written for, then send the
  // map to the road. The steps quote ranks out of 10 on the first score and
  // the geometric classes, so those are set rather than assumed.
  const startExample = (ex: Example) => {
    setTab(ex.tab);
    setCounty(ex.county);
    setMethod("geometric");
    if (ex.tab === "detour") setDetourScore(DETOUR_SCORES[0].base);
    if (ex.hazard) { setHazardId(ex.hazard); setCutoff(DEFAULT_CUTOFF); }
    setMinClass(1);
    setGuideProps(null);
    setGuide({ ex, step: 0, nudged: false });
    setFocus((f) => focusFor(ex, f ? Number(f.key.split(":")[1]) + 1 : 1));
  };

  const score: Score = useMemo(
    () => (tab === "pinch" ? PINCH_SCORES[0]
      : tab === "isolation" ? ISOLATION_SCORES.find((s) => s.minutes === cutoff)!
      : DETOUR_SCORES.find((s) => s.base === detourScore)!),
    [tab, detourScore, cutoff]);

  const field = classField(score.base, method);
  const classes = STYLES[field]?.classes ?? [];
  // The ranks 1 to 10, and apart from them the class for roads cut off
  // completely, which only the functional isolation styles have.
  const ranks = classes.filter((c) => c.value !== CUT_OFF_CLASS);
  const cutOffStyle = classes.find((c) => c.value === CUT_OFF_CLASS);
  const countyObj = COUNTIES.find((c) => c.id === county)!;
  const hazard = HAZARDS.find((h) => h.id === hazardId) ?? null;
  // The drive times this hazard's run has. A run made before 30 minutes was
  // added has only 5, 10 and 15, and the slider offers only those; a link or
  // a switch landing on a drive time the run lacks falls back to 15.
  const cutoffsHere = ISOLATION_SCORES.filter((x) => hazard?.losing?.[String(x.minutes)] != null);
  const slidable = cutoffsHere.length ? cutoffsHere : ISOLATION_SCORES;
  React.useEffect(() => {
    if (tab === "isolation" && !slidable.some((x) => x.minutes === cutoff)) setCutoff(DEFAULT_CUTOFF);
  }, [tab, hazardId, cutoff]);
  const hazardWords = HAZARD_WORDS[hazard?.kind ?? "flood"];
  // Too few roads losing anything at this drive time for ten ranks to mean
  // anything (the I-40 landslide within 5 minutes).
  const unranked = tab === "isolation" && hazard
    ? (hazard.losing[String(cutoff)] ?? 0) < MIN_RANKED : false;
  // What each rank stands for on this hazard, drive time and classification:
  // the lowest and highest share of places out of reach among its roads.
  const rankRanges = tab === "isolation" && hazard ? hazard.classRanges?.[`${cutoff}_${method}`] ?? null : null;
  const steps = guide ? guideSteps(guide.ex, guideProps, field) : [];
  const step = guide ? steps[Math.min(guide.step, steps.length - 1)] : null;
  // The guide's first steps sit in the popup on the road; the rest point at
  // the panel from a card on the map's left edge.
  const onPanelStep = step?.place === "panel";
  const panelTarget = onPanelStep ? step?.target ?? null : null;

  // A click on the map while the guide is open. The first one, if there is a
  // next step to show, is kept: the guide says so and moves on.
  const onGuideAway = () => {
    if (!guide || nudgeUsed.current || guide.step >= steps.length - 1) return false;
    nudgeUsed.current = true;
    setGuide({ ...guide, step: guide.step + 1, nudged: true });
    return true;
  };

  // Move the guide to step n. Going back from the panel steps to the road
  // steps puts the panel back the way the road steps describe it, since the
  // reader may have changed the county or the score in between, and sends the
  // map back to the road to reopen its popup there.
  const goToStep = (n: number) => {
    if (!guide) return;
    if (steps[n]?.place === "road" && step?.place === "panel") {
      setCounty(guide.ex.county);
      setMethod("geometric");
      if (guide.ex.tab === "detour") setDetourScore(DETOUR_SCORES[0].base);
      if (guide.ex.hazard) { setHazardId(guide.ex.hazard); setCutoff(DEFAULT_CUTOFF); }
      setFocus((f) => focusFor(guide.ex, f ? Number(f.key.split(":")[1]) + 1 : 1));
    }
    setGuide({ ...guide, step: n, nudged: false });
  };

  // A change in the panel. During the road steps it would leave the popup
  // quoting the old settings, so it ends the guide. During the steps about
  // the panel, trying the controls is the point, so the guide stays.
  const panelChanged = () => { if (!onPanelStep) endGuide(); };

  // Go to a study area and make sure the map actually moves there. A new
  // county also brings its first hazard, so the hazard always belongs to the
  // county shown.
  const goToCounty = (id: string) => {
    panelChanged();
    setCounty(id);
    if (id !== county) setHazardId(defaultHazard(id));
    setFlyNonce((n) => n + 1);
  };
  const goToHazard = (id: string) => {
    panelChanged();
    setHazardId(id);
    setFlyNonce((n) => n + 1);
  };

  // Where the guide's card sits on the map during the panel steps: level with
  // the card it is pointing at, kept inside the map, with its arrow on that
  // card. `room` caps the guide's height to the map's, so a long step scrolls
  // inside the card and its Back and Next row stays on screen. Measured again
  // as the panel scrolls, the window resizes, the guide's own height changes
  // from step to step, or anything in the panel changes size (dragging the
  // panel's edge, or a card above the target growing when the score changes).
  const panelRef = useRef<HTMLDivElement>(null);
  const mapAreaRef = useRef<HTMLDivElement>(null);
  const coachRef = useRef<HTMLDivElement>(null);
  const [coach, setCoach] = useState<{ top: number; arrow: number | null; room: number }>(
    { top: 16, arrow: null, room: 600 });
  React.useLayoutEffect(() => {
    if (!onPanelStep) return;
    const panel = panelRef.current;
    const target = panelTarget
      ? panel?.querySelector<HTMLElement>(`[data-guide="${panelTarget}"]`) ?? null : null;
    target?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const place = () => {
      const area = mapAreaRef.current?.getBoundingClientRect();
      if (!area) return;
      // 12 px clear of the map's top and bottom, less the card's padding
      const room = Math.max(180, area.height - 24 - 26);
      if (!target) { setCoach({ top: 16, arrow: null, room }); return; }
      const h = coachRef.current?.offsetHeight ?? 300;
      const t = target.getBoundingClientRect();
      // Aim at the card's heading and first control rather than its middle,
      // since some cards (the colour key) are tall.
      const aim = t.top + Math.min(t.height / 2, 32) - area.top;
      const top = Math.max(12, Math.min(aim - 34, area.height - h - 12));
      setCoach({ top, arrow: Math.max(18, Math.min(aim - top, h - 18)), room });
    };
    place();
    panel?.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    const seen = new ResizeObserver(place);
    if (coachRef.current) seen.observe(coachRef.current);
    if (panel) {
      seen.observe(panel);
      Array.from(panel.children).forEach((c) => seen.observe(c));
    }
    return () => {
      panel?.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
      seen.disconnect();
    };
  }, [onPanelStep, panelTarget]);

  const onHazard = tab === "isolation" && hazard != null;
  const tilesUrl = new URL(
    tab === "pinch" ? PINCH_TILES : onHazard ? hazard.tiles : countyObj.tiles, TILES_BASE).href;
  const sourceLayer = tab === "pinch" ? "pinch" : tab === "isolation" ? "roads" : "detour";
  const view = onHazard ? hazardView(hazard) : null;
  const center: [number, number] = tab === "pinch" ? NC_CENTER : view ? view.center : countyObj.center;
  const zoom = tab === "pinch" ? NC_ZOOM : view ? view.zoom : countyObj.zoom;
  const fullBounds = tab === "pinch" ? NC_BOUNDS : onHazard ? hazard.bounds : countyObj.bounds;
  const fullLabel = tab === "pinch" ? "Show the whole state"
    : onHazard ? `Show everything within ${hazard.bufferMiles} miles of the hazard`
    : `Show all of ${countyObj.label} County`;

  // keep the hash in step with the panel
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    Object.entries({
      tab, county, hazard: hazardId, cutoff: String(cutoff), method, score: detourScore, basemap,
      buildings: buildings ? "1" : "0", svc: services.join(","), hb: hazardBldgs.join(","),
      min: String(minClass), left: String(left),
    }).forEach(([k, v]) => p.set(k, v));
    window.history.replaceState(null, "", `#${p.toString()}`);
  }, [tab, county, hazardId, cutoff, method, detourScore, basemap, buildings, services, hazardBldgs, minClass, left]);

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
      {/* On narrow screens the bar wraps, putting the tabs on a second row
          rather than letting the title run into them or the tabs run off the
          right edge. */}
      <Box component="header" sx={{
        bgcolor: NIGHT_SKY, display: "flex", alignItems: "center", gap: 2.5,
        flexWrap: { xs: "wrap", md: "nowrap" }, rowGap: 1,
        px: 2.5, py: 1.25, flexShrink: 0,
      }}>
        <Link href={ORG_URL} target="_blank" rel="noopener"
          sx={{ display: "block", lineHeight: 0, flexShrink: 0 }}>
          <Box component="img" src={new URL(ORG_LOGO_SCREEN, document.baseURI).href}
            alt={ORG_NAME}
            // Sized by a whole-pixel height rather than a width: the logo's
            // fine small capitals and hairline divider look soft when its
            // edges land between screen pixels.
            sx={{ height: { xs: 46, md: 60 }, width: "auto", display: "block" }} />
        </Link>
        <Box sx={{ width: "1px", alignSelf: "stretch", bgcolor: "rgba(255,255,255,0.25)" }} />
        {/* Wide screens squeeze the centre's name on the right rather than
            the title, which would otherwise wrap a word to a line. On narrow
            ones the title takes a fixed 150 px (two lines), which is what
            decides when the tabs drop to a second row. */}
        <Box sx={{
          minWidth: 0, flexShrink: { xs: 0, md: 1, lg: 0 }, flexBasis: { xs: 150, md: "auto" },
        }}>
          {/* Whole-pixel line heights keep the title bar an even number of
              pixels tall however the title wraps, so the centred logo lands
              on whole pixels and stays sharp. */}
          <Typography sx={{ color: "#fff", fontWeight: 700, fontSize: 19, lineHeight: "24px" }}>
            Road network connectivity
          </Typography>
          <Typography sx={{ color: "rgba(255,255,255,0.78)", fontSize: 13, lineHeight: "20px" }}>
            North Carolina
          </Typography>
        </Box>

        {/* The tabs, set as pill-shaped links in the title bar. The open one
            is a solid light pill with Night Sky text. Every other one is an
            outlined pill on a muted tint of the bar, with a small arrow saying
            it goes somewhere; a muted pill alone did not read as clickable.
            The arrow nudges right on hover. Each pill keeps the same 1.5 px
            border, white on the open one, so switching does not shift the
            row's height. Still MUI Tabs underneath, so the arrow keys and
            screen readers treat them as tabs. A third tab is one more entry
            in NAV_TABS. */}
        <Tabs
          value={tab}
          onChange={(_, v) => { endGuide(); setTab(v); }}
          sx={{
            ml: 1.5, minHeight: 0, flexShrink: 0,
            "& .MuiTabs-flexContainer": { gap: 1.5 },
            "& .MuiTabs-indicator": { display: "none" },
            "& .MuiTab-root": {
              textTransform: "none", fontWeight: 600, fontSize: 15,
              minHeight: 0, minWidth: 0, px: 2, py: 0.75, borderRadius: 999,
              flexDirection: "row", gap: 0.5,
              color: "rgba(255,255,255,0.92)", bgcolor: "rgba(255,255,255,0.1)",
              border: "1.5px solid rgba(255,255,255,0.45)",
              transition: "color 140ms, background-color 140ms, border-color 140ms",
              "& .tab-arrow": { transition: "transform 140ms" },
              "&:hover": {
                color: "#fff", bgcolor: "rgba(255,255,255,0.2)", borderColor: "rgba(255,255,255,0.85)",
                "& .tab-arrow": { transform: "translateX(2px)" },
              },
            },
            "& .MuiTab-root.Mui-selected": {
              color: NIGHT_SKY, bgcolor: "#fff", borderColor: "#fff",
              "&:hover": { bgcolor: "#fff" },
            },
            "& .MuiTab-root.Mui-focusVisible": { outline: "2px solid #fff", outlineOffset: 2 },
          }}
        >
          {NAV_TABS.map((t) => (
            <Tab key={t.value} value={t.value} label={
              <>
                {t.label}
                {/* a chevron drawn as an SVG, since Figtree has no arrow glyphs */}
                {t.value !== tab && (
                  <Box component="svg" className="tab-arrow" viewBox="0 0 24 24" aria-hidden="true" sx={{
                    width: 16, height: 16, fill: "none", stroke: "currentColor",
                    strokeWidth: 2.6, strokeLinecap: "round", strokeLinejoin: "round", flexShrink: 0,
                  }}>
                    <path d="M9 6l6 6-6 6" />
                  </Box>
                )}
              </>
            } />
          ))}
        </Tabs>

        <Box sx={{ flex: 1 }} />
        {/* Set in full white rather than a dim tint: at this size a faded grey
            on navy is the first thing to become unreadable. Shown only where
            there is room beside the tabs. */}
        <Typography sx={{
          color: "rgba(255,255,255,0.92)", fontSize: 13.5, fontWeight: 500,
          textAlign: "right", maxWidth: 300, minWidth: 0, lineHeight: 1.4,
          display: { xs: "none", lg: "block" },
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

        <Box ref={panelRef} sx={{ p: 2, overflowY: "auto", flex: 1 }}>
          {/* The same box on every tab, first: the name of what the colours
              measure and a sentence or two on what it means. On the detour
              and functional isolation tabs the lists that change it follow. */}
          {/* The panel used to open with a paragraph on what each tab is
              about; at the user's request it was folded into this box's
              text, to keep the panel short. */}
          <Card title="What the map shows" guide="shows" lit={panelTarget === "shows"}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{score.label}</Typography>
            {/* On the functional isolation tab the measure is spelled out in
                full, in body text, with the share itself in bold: the user
                asked for it to stand out, since everything else on the tab
                is read through it. */}
            {tab === "isolation" ? (
              <Typography variant="body2" sx={{ mt: 0.5, lineHeight: 1.5 }}>
                For someone on a road near the hazard: of the homes, shops, schools and other
                buildings they could drive to within {cutoff} minutes,{" "}
                <b>the share they can no longer get to</b> once the hazard closes the roads it covers.
              </Typography>
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                {score.help}
              </Typography>
            )}
          </Card>

          {tab !== "pinch" && (
            <Card title="Choose a county" guide="county" lit={panelTarget === "county"}>
              <Select fullWidth size="small" value={county}
                onChange={(e) => goToCounty(e.target.value)}
                sx={PICKER_SX}>
                {COUNTIES.map((c) => <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>)}
              </Select>
            </Card>
          )}

          {tab === "isolation" && (
            <Card title="Choose a hazard" guide="hazard" lit={panelTarget === "hazard"}>
              <Select fullWidth size="small" value={hazardId} sx={PICKER_SX}
                onChange={(e) => goToHazard(e.target.value)}>
                {hazardsIn(county).map((h) => <MenuItem key={h.id} value={h.id}>{h.label}</MenuItem>)}
              </Select>
            </Card>
          )}

          {/* The drive time as a slider rather than a list, so moving between
              5, 10, 15 and 30 minutes shows the loss growing or shrinking. It
              stops only at the three times the runs measured. */}
          {tab === "isolation" && (
            <Card title="Choose a drive time" guide="score" lit={panelTarget === "score"}>
              <Box sx={{ px: 1.5, pt: 0.5 }}>
                {/* One even step per drive time, so 5, 10 and 15 do not
                    bunch up beside a far-off 30. */}
                <Slider value={Math.max(0, slidable.findIndex((x) => x.minutes === cutoff))}
                  min={0} max={slidable.length - 1} step={1}
                  marks={slidable.map((x, i) => ({ value: i, label: `${x.minutes} min` }))}
                  onChange={(_, v) => {
                    const m = slidable[v as number]?.minutes;
                    if (m != null && m !== cutoff) { panelChanged(); setCutoff(m); }
                  }}
                  aria-label="Drive time in minutes"
                  getAriaValueText={(v) => `${slidable[v]?.minutes} minutes`}
                  sx={{ color: BULLDOG_BLUE, "& .MuiSlider-markLabel": { fontSize: 13 } }} />
              </Box>
            </Card>
          )}

          {tab === "detour" && (
            <Card title="Choose what the map shows" guide="score" lit={panelTarget === "score"}>
              <FormControl fullWidth>
                <Select size="small" value={detourScore} sx={PICKER_SX}
                  onChange={(e) => { panelChanged(); setDetourScore(e.target.value); }}>
                  {DETOUR_SCORES.map((s) => <MenuItem key={s.base} value={s.base}>{s.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Card>
          )}

          {tab === "detour" && (
            <Card title="Services on the map" guide="services" lit={panelTarget === "services"}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
                The places the trips are counted to.
              </Typography>
              {SERVICE_KINDS.map((k) => (
                <FormControlLabel key={k.id} sx={{ ml: -0.75, display: "flex", my: 0.25 }}
                  control={<Checkbox size="small" checked={services.includes(k.id)} sx={CHECK_SX}
                    onChange={() => toggleService(k.id)} />}
                  label={
                    <Stack direction="row" spacing={1} alignItems="center">
                      <ServiceIcon kind={k.id} />
                      <Typography variant="body2">{k.label}</Typography>
                    </Stack>
                  } />
              ))}
            </Card>
          )}

          <Card title="Classification" guide="classes" lit={panelTarget === "classes"}>
            <RadioGroup value={method}
              onChange={(e) => { panelChanged(); setMethod(e.target.value as MethodId); }}>
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

          <Card title="Legend" guide="legend" lit={panelTarget === "legend"}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              {tab === "isolation"
                ? `Each rank, with the share of the places within a ${cutoff} minute drive that someone on those roads can no longer get to:`
                : `${score.label}, ${METHODS.find((m) => m.id === method)?.label.toLowerCase()} breaks.`}
            </Typography>
            {unranked && hazard && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                Only {hazard.losing[String(cutoff)]}{" "}
                {hazard.losing[String(cutoff)] === 1 ? "road loses" : "roads lose"} anything
                within {cutoff} minutes, too few to rank, so the other roads are all in rank 1.
              </Typography>
            )}
            {/* High class at the top, as a map legend reads. On the functional
                isolation tab the red for roads cut off completely or closed
                sits above 10, as the last value of the scale (the user asked
                for it there rather than set apart). It never fades with the
                slider, which never hides it. */}
            {cutOffStyle && <LegendRow c={cutOffStyle} label="Cut off completely or closed" on />}
            {/* The ranks, with the slider standing beside them: each rank's
                row lines up with a stop on the slider, so the handle sits
                beside the lowest rank still shown. Moving it up hides the
                ranks below it. Set beside the list rather than under it, at
                the user's request, to keep the panel short. */}
            <Stack direction="row" spacing={2} alignItems="flex-start">
              <Box sx={{ minWidth: 0 }}>
                {[...ranks].reverse().map((c) => (
                  <LegendRow key={c.value} c={c} on={c.value >= minClass}
                    label={rankRanges ? `${c.label}: ${shareRange(rankRanges[c.value - 1])}` : c.label} />
                ))}
              </Box>
              <Stack alignItems="center" sx={{ flexShrink: 0 }}>
                {/* the blue part of the track runs beside the ranks still shown */}
                <Slider orientation="vertical" size="small" min={1} max={10} step={1} marks value={minClass}
                  track="inverted"
                  onChange={(_, v) => setMinClass(v as number)}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(v) => (v === 1 ? "all ranks" : `rank ${v} and up`)}
                  aria-label="Lowest rank shown"
                  sx={{
                    color: BULLDOG_BLUE,
                    height: (ranks.length - 1) * LEGEND_ROW, my: `${LEGEND_ROW / 2}px`,
                  }} />
              </Stack>
              <Typography variant="caption" color="text.secondary"
                sx={{ alignSelf: "flex-end", maxWidth: 110, lineHeight: 1.35, pb: 0.25 }}>
                Slide up to hide the lower ranks.
              </Typography>
            </Stack>
            {/* Buildings, under the ranks at the user's request, with a heading
                that links to Overture's page on its buildings data. Each row
                is a checkbox, a footprint swatch in the colour the map draws,
                and its name. */}
            <Typography variant="caption" sx={{ display: "block", mt: 1.25, fontWeight: 700 }}>
              Buildings, from{" "}
              <Link href={OVERTURE_BUILDINGS_URL} target="_blank" rel="noopener" sx={{ color: BULLDOG_BLUE }}>
                Overture Maps
              </Link>
            </Typography>
            <BuildingRow checked={buildings} onChange={() => setBuildings((b) => !b)}
              fill={BUILDING_COLOR} edge={BUILDING_OUTLINE} label="All buildings" />
            {tab === "isolation" && ([
              ["cut_off", "Cut off"],
              ["in_hazard", `${hazardWords.inside.charAt(0).toUpperCase()}${hazardWords.inside.slice(1)}`],
            ] as [HazardBuildingStatus, string][]).map(([k, label]) => (
              <BuildingRow key={k} checked={hazardBldgs.includes(k)} onChange={() => toggleHazardBldg(k)}
                fill={HAZARD_BUILDING_COLORS[k]} edge="#141414" label={label} />
            ))}
            {/* the hazard itself, in its hatching */}
            {tab === "isolation" && (
              <Box sx={{ mt: 1.5, pt: 1.25, borderTop: "1px solid #e6e8eb" }}>
                <Stack direction="row" spacing={1} alignItems="flex-start">
                  <Box sx={{
                    width: 26, height: 16, flexShrink: 0, border: "2px solid #23272e", borderRadius: "2px",
                    background: "repeating-linear-gradient(135deg, #23272e 0 2px, #fff 2px 3px, "
                      + "transparent 3px 7px, #fff 7px 8px)",
                  }} />
                  <Typography variant="caption" sx={{ lineHeight: 1.45 }}>
                    <b>{hazardWords.area.charAt(0).toUpperCase() + hazardWords.area.slice(1)}.</b>{" "}
                    Every road inside it is closed and drawn in red, like the roads it cuts off
                    completely. The shaded part of the map lies beyond the{" "}
                    {hazard?.bufferMiles ?? 20} miles around it that this run covers.
                  </Typography>
                </Stack>
              </Box>
            )}
          </Card>

          {/* There is no Map card: the basemap is picked with the globe
              button on the map, and the road opacity slider was removed at
              the user's request. */}

          {/* left off entirely on a tab whose note is not written yet */}
          {METHODOLOGY[tab].length > 0 && (
            <Card title="Methodology" guide="methodology" lit={panelTarget === "methodology"}>
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

          {/* Double-clicking this line is a hidden reset: see resetRemembered. */}
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}
            onDoubleClick={resetRemembered}>
            Symbology from {STYLES[field]?.source ?? "the QGIS styles"} in output/.
            {onHazard
              ? ` Roads and buildings: Overture Maps Foundation, release ${hazard.overtureRelease}.`
              : " Roads: Overture Maps Foundation."}
          </Typography>
        </Box>
      </Drawer>

      {/* Clipped to its own edges, so on a narrow window, where the panel
          leaves the map only a sliver, nothing on the map pushes the page
          into scrolling sideways. */}
      <Box ref={mapAreaRef} sx={{ position: "relative", flex: 1, minWidth: 0, overflow: "hidden" }}>
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
            // The same key on every tab, so switching tabs keeps the view;
            // picking a county or a hazard moves it.
            flyKey={`${county}:${hazardId}:${flyNonce}`}
            countyKey={county}
            fullBounds={fullBounds}
            fullLabel={fullLabel}
            hazard={onHazard ? hazard : null}
            buildingsUrl={buildings && overtureRelease ? overtureBuildingsUrl(overtureRelease) : null}
            services={tab === "detour" ? services : null}
            hazardBuildings={hazardBldgs}
            focus={focus}
            onFocusFeature={(key, props) => {
              // called once the guide's popup is on the road, found or not
              if (key !== focus?.key) return;
              guideSeen.current = true;
              setGuideProps(props);
            }}
            onInteract={() => setTouched(true)}
            guide={guide && !onPanelStep ? (
              <MapGuide ex={guide.ex} step={guide.step} steps={steps}
                color={classColor(field, guideProps)} nudged={guide.nudged}
                onStep={goToStep} onEnd={endGuide} />
            ) : null}
            onGuideAway={onGuideAway}
            onGuideClosed={endGuide}
          />
        </MapBoundary>

        <BasemapPicker value={basemap} onChange={setBasemap} />

        {/* The guide during the steps about the panel: a dark card on the
            map's left edge, its arrow on the panel card being described. */}
        {guide && onPanelStep && (
          <Box ref={coachRef} className="guide-card"
            style={{ ["--guide-room" as string]: `${coach.room}px` }}
            sx={{
            position: "absolute", left: 16, top: coach.top, zIndex: 6,
            bgcolor: NIGHT_SKY, color: "#fff", borderRadius: "12px", p: "14px 16px 12px",
            boxShadow: "0 12px 32px rgba(0,20,45,0.38)", transition: "top 250ms ease",
          }}>
            {coach.arrow != null && (
              <Box aria-hidden="true" sx={{
                position: "absolute", left: -10, top: coach.arrow - 10, width: 0, height: 0,
                borderTop: "10px solid transparent", borderBottom: "10px solid transparent",
                borderRight: `10px solid ${NIGHT_SKY}`, transition: "top 250ms ease",
              }} />
            )}
            <MapGuide ex={guide.ex} step={guide.step} steps={steps}
              color={null} nudged={guide.nudged}
              onStep={goToStep} onEnd={endGuide} />
          </Box>
        )}

        {!guide && (
          <GuideLauncher shape={launcher} onStart={() => startExample(firstExample(tab, hazardId))} />
        )}

        {/* One line on what to do, for someone who arrived by a link or left
            the example. It goes away for good the first time a road is hovered
            or clicked, and never takes clicks away from the map. It sits above
            the "Start the guide" pill while that is showing, and once the
            pill has become the circle in the corner, it is centred in the
            space to the circle's right so it never covers it. */}
        {!guide && !touched && !(tab !== "pinch" && mapEmpty) && (
          <Box sx={{
            position: "absolute", bottom: launcher === "pill" ? 34 + LAUNCHER_SIZE + 12 : 34,
            left: launcher === "pill" ? "50%" : `calc(50% + ${(12 + LAUNCHER_SIZE) / 2}px)`,
            transform: "translateX(-50%)", transition: "bottom 400ms, left 400ms",
            bgcolor: "rgba(16,23,31,0.86)", color: "#fff", borderRadius: 999,
            px: 2, py: 0.9, fontSize: 13.5, fontWeight: 500, zIndex: 4,
            pointerEvents: "none", whiteSpace: "nowrap",
            maxWidth: launcher === "pill"
              ? "calc(100% - 24px)" : `calc(100% - ${2 * (12 + LAUNCHER_SIZE + 12)}px)`,
            overflow: "hidden", textOverflow: "ellipsis",
          }}>
            Move your mouse over a road to see its numbers. Click to keep them open.
          </Box>
        )}

        {/* The view is kept when the tabs are switched, which means the map can
            land somewhere the detour runs do not cover: those exist for three
            counties, not the whole state. Rather than leave a blank map with no
            explanation, say so and offer the places that do have data. */}
        {/* The same on the functional isolation tab, where each hazard's run
            covers only the area around it. */}
        {onHazard && mapEmpty && (
          <Box sx={{
            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            bgcolor: "#fff", borderRadius: 2, px: 2.5, py: 2, maxWidth: 460,
            boxShadow: "0 6px 24px rgba(16,24,40,0.18)",
            border: "1px solid #dfe3e8", zIndex: 5,
          }}>
            <Typography sx={{ fontWeight: 700, fontSize: 14.5, mb: 0.5 }}>
              No data for this hazard here
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Each hazard covers the roads within {hazard.bufferMiles} miles of it. This one
              is {hazard.label.charAt(0).toLowerCase() + hazard.label.slice(1)}.
            </Typography>
            <Box component="button" onClick={() => goToHazard(hazard.id)}
              sx={{
                font: "inherit", fontWeight: 600, fontSize: 13.5, cursor: "pointer",
                px: 1.75, py: 0.75, borderRadius: 1.5, color: "#fff",
                bgcolor: BULLDOG_BLUE, border: "none",
                "&:hover": { bgcolor: NIGHT_SKY },
              }}>
              Go to the hazard
            </Box>
          </Box>
        )}

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

const LAUNCHER_SIZE = 46;
const LAUNCHER_WIDE = 184;

// The way back into the guide. Right after the guide closes it is a pill
// under the middle of the map, where the eye already is. After PILL_MS it
// slides to the bottom left corner as a circle with a question mark, and
// widens back into the labelled pill under the mouse or keyboard focus.
// Night Sky with a white rim, so it holds up on the dark basemap too.
function GuideLauncher({ shape, onStart }: { shape: "pill" | "circle"; onStart: () => void }) {
  const circle = shape === "circle";
  return (
    <Box component="button" type="button" onClick={onStart} aria-label="Start the guide"
      sx={{
        position: "absolute", zIndex: 5,
        bottom: circle ? 40 : 34,
        left: circle ? "12px" : "50%",
        transform: circle ? "translateX(0)" : "translateX(-50%)",
        width: circle ? LAUNCHER_SIZE : LAUNCHER_WIDE, height: LAUNCHER_SIZE,
        display: "flex", alignItems: "center", gap: 1, pl: "10px", pr: 0,
        overflow: "hidden", whiteSpace: "nowrap", cursor: "pointer",
        font: "inherit", fontWeight: 700, fontSize: 15, color: "#fff",
        bgcolor: NIGHT_SKY, border: "2px solid #fff", borderRadius: 999,
        boxShadow: "0 4px 14px rgba(0,20,45,0.35)",
        transition: "left 700ms ease, bottom 700ms ease, transform 700ms ease, "
          + "width 250ms ease, background-color 140ms",
        "& .launcher-label": { opacity: circle ? 0 : 1, transition: "opacity 200ms" },
        "&:hover, &:focus-visible": {
          width: LAUNCHER_WIDE, bgcolor: BULLDOG_BLUE,
          "& .launcher-label": { opacity: 1 },
        },
        "&:focus-visible": { outline: `3px solid ${BULLDOG_BLUE}`, outlineOffset: 2 },
      }}>
      {/* a question mark drawn as an SVG, so it does not depend on the font */}
      <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{
        width: 22, height: 22, flexShrink: 0, fill: "none", stroke: "#fff",
        strokeWidth: 2.6, strokeLinecap: "round", strokeLinejoin: "round",
      }}>
        <path d="M8.6 8.6a3.5 3.5 0 0 1 6.8 1.2c0 2.3-3.4 3.2-3.4 3.2" />
        <path d="M12 18h.01" />
      </Box>
      <span className="launcher-label">Start the guide</span>
    </Box>
  );
}

// The guide's content: in the map's popup on the road for the road steps, and
// in the card on the map's left edge for the steps about the panel. Dark, in
// Night Sky, so it reads as the site talking rather than as a road's numbers.
// It draws its own close button; see pin() in MapView for why the popup's own
// is turned off.
function MapGuide({ ex, step, steps, color, nudged, onStep, onEnd }: {
  ex: Example;
  step: number;
  steps: GuideStep[];
  color: string | null;
  nudged: boolean;
  onStep: (n: number) => void;
  onEnd: () => void;
}) {
  const last = step >= steps.length - 1;
  const s = steps[Math.min(step, steps.length - 1)];
  const button = {
    font: "inherit", fontWeight: 700, fontSize: 13.5, cursor: "pointer",
    px: 1.75, py: 0.7, borderRadius: 999, border: "1.5px solid #fff",
  } as const;
  // --guide-room is the height there is to fill: the room above the road in
  // the popup (set by MapView) or the map's height in the card. The heading
  // and the Back and Next row always show; a step too long for the room
  // scrolls between them.
  return (
    <Box aria-live="polite" sx={{
      width: 340, maxWidth: "100%", color: "#fff",
      display: "flex", flexDirection: "column", maxHeight: "var(--guide-room, none)",
    }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ flexShrink: 0 }}>
        <Typography sx={{
          fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em",
          textTransform: "uppercase", color: "rgba(255,255,255,0.72)",
        }}>
          Quick guide, step {step + 1} of {steps.length}
        </Typography>
        {/* an X drawn as an SVG, since Figtree has no glyph for it */}
        <Box component="button" type="button" onClick={onEnd} aria-label="Close the guide"
          title="Close the guide"
          sx={{
            width: 28, height: 28, mr: -0.75, p: 0, border: "none", borderRadius: 999,
            bgcolor: "transparent", cursor: "pointer", display: "flex",
            alignItems: "center", justifyContent: "center",
            "&:hover": { bgcolor: "rgba(255,255,255,0.15)" },
          }}>
          <Box component="svg" viewBox="0 0 24 24" aria-hidden="true" sx={{
            width: 18, height: 18, fill: "none", stroke: "#fff",
            strokeWidth: 2.4, strokeLinecap: "round",
          }}>
            <path d="M6 6l12 12M18 6L6 18" />
          </Box>
        </Box>
      </Stack>

      {/* the road's name, only while the steps are about the road */}
      {s.place === "road" && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, flexShrink: 0 }}>
          {color && <Box sx={{ width: 22, height: 5, borderRadius: "2px", bgcolor: color, flexShrink: 0 }} />}
          <Typography sx={{ fontSize: 12.5, color: "rgba(255,255,255,0.82)" }}>
            {ex.road}, {ex.countyLabel} County
          </Typography>
        </Stack>
      )}

      <Box sx={{
        flex: "1 1 auto", minHeight: 0, overflowY: "auto", mr: -1, pr: 1,
        scrollbarColor: "rgba(255,255,255,0.4) transparent",
      }}>
        {nudged && (
          <Box sx={{
            mt: 1.25, px: 1.25, py: 1, borderRadius: 1.5,
            bgcolor: "rgba(255,255,255,0.14)", borderLeft: "4px solid #fff",
          }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.45 }}>{nudge(s.place)}</Typography>
          </Box>
        )}

        <Typography sx={{ fontWeight: 700, fontSize: 16.5, mt: 1.25, mb: 0.75, lineHeight: 1.3 }}>
          {s.title}
        </Typography>
        {s.lines.map((l) => (
          <Typography key={l} sx={{ fontSize: 14, lineHeight: 1.55, mb: 0.9, color: "rgba(255,255,255,0.93)" }}>
            {l}
          </Typography>
        ))}
        {s.items && (
          <Box sx={{ borderLeft: "2px solid rgba(255,255,255,0.3)", pl: 1.25, mt: 0.25 }}>
            {s.items.map((it) => (
              <Typography key={it.label} sx={{ fontSize: 13, lineHeight: 1.5, mb: 0.75, color: "rgba(255,255,255,0.9)" }}>
                <Box component="span" sx={{ fontWeight: 700, color: "#fff" }}>{it.label}.</Box>{" "}
                {it.text}
              </Typography>
            ))}
          </Box>
        )}
      </Box>

      {/* Next always sits at the right edge and Back at the left. With Back
          on Next's left, Back appeared where Next had just been, and a second
          click on the same spot went backwards. In the popup the row also
          stays at the same height, since the popup is anchored by its lower
          edge; in the card on the left edge it moves with the card, which
          follows the panel box being described. */}
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 1.5, flexShrink: 0 }}>
        {step > 0 ? (
          <Box component="button" type="button" onClick={() => onStep(step - 1)} sx={{
            ...button, color: "#fff", bgcolor: "transparent",
            "&:hover": { bgcolor: "rgba(255,255,255,0.15)" },
          }}>
            Back
          </Box>
        ) : <span />}
        <Box component="button" type="button" onClick={() => (last ? onEnd() : onStep(step + 1))} sx={{
          ...button, color: NIGHT_SKY, bgcolor: "#fff", minWidth: 78,
          "&:hover": { bgcolor: "#dbe7fb" },
        }}>
          {last ? "Done" : "Next"}
        </Box>
      </Stack>
    </Box>
  );
}

// The basemap button at the map's top left, as in the DamSure frontend: a
// white pill with a globe and the word "Basemap" (just the globe on a
// phone), opening a short list with a tick by the one in use. Picking one
// changes the map at once and the list stays open, so another can be tried.
// A click outside, Escape or the button again closes it.
function BasemapPicker({ value, onChange }: { value: BasemapKey; onChange: (k: BasemapKey) => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const label = `Basemap: ${BASEMAPS[value].label}`;
  return (
    <>
      <Tooltip title={open ? "" : label} placement="right">
        <ButtonBase ref={button} aria-label={`${label}. Change the basemap`} aria-haspopup="menu"
          aria-expanded={open} onClick={() => setOpen((o) => !o)}
          sx={{
            position: "absolute", top: 10, left: 10, zIndex: 3, gap: 0.75, height: 40, minWidth: 40,
            px: { xs: 0, md: 1.5 }, borderRadius: "20px", color: NIGHT_SKY, bgcolor: "#fff",
            fontSize: 14, fontWeight: 700,
            boxShadow: open ? `0 2px 6px rgba(0,20,45,0.25), 0 0 0 2px ${BULLDOG_BLUE}` : "0 2px 6px rgba(0,20,45,0.25)",
            "&:hover": { bgcolor: "#eef2f7" },
            "&.Mui-focusVisible": { outline: `2px solid ${BULLDOG_BLUE}`, outlineOffset: 2 },
          }}>
          <PublicIcon fontSize="small" />
          <Box component="span" aria-hidden="true" sx={{ display: { xs: "none", md: "inline" } }}>Basemap</Box>
        </ButtonBase>
      </Tooltip>
      <Popover open={open} anchorEl={button.current} onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { width: 210, mt: 1, py: 1, borderRadius: 2, boxShadow: "0 4px 14px rgba(0,20,45,0.22)" } } }}>
        <Typography variant="caption" component="div" sx={{
          px: 2, pb: 0.5, color: "text.secondary", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
        }}>
          Basemap
        </Typography>
        <MenuList dense disablePadding autoFocusItem={open} aria-label="Basemap"
          onKeyDown={(e) => { if (e.key === "Tab") { e.preventDefault(); setOpen(false); } }}>
          {(Object.keys(BASEMAPS) as BasemapKey[]).map((k) => (
            <MenuItem key={k} role="menuitemradio" aria-checked={k === value} selected={k === value}
              onClick={() => onChange(k)}
              sx={{
                justifyContent: "space-between", gap: 1, fontWeight: k === value ? 700 : 400,
                "&.Mui-selected": { bgcolor: "transparent" },
                "&:hover, &.Mui-selected:hover": { bgcolor: "#eef2f7" },
              }}>
              {BASEMAPS[k].label}
              {k === value && <CheckIcon sx={{ fontSize: 18, color: BULLDOG_BLUE }} />}
            </MenuItem>
          ))}
        </MenuList>
      </Popover>
    </>
  );
}

// One row of the legend: the line as the map draws it, and its name. Every
// row is the same height, so the rank rows line up with the stops on the
// slider beside them.
const LEGEND_ROW = 20;
function LegendRow({ c, label, on }: { c: { color: string; widthMm: number }; label: string; on: boolean }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ height: LEGEND_ROW, opacity: on ? 1 : 0.3 }}>
      <Box sx={{
        width: 26, bgcolor: c.color, flexShrink: 0,
        height: Math.max(2, c.widthMm * 7), borderRadius: "1px",
      }} />
      <Typography variant="caption" sx={{ whiteSpace: "nowrap" }}>{label}</Typography>
    </Stack>
  );
}

// One kind of building in the legend: its checkbox, a small footprint in the
// colour the map draws it, and its name.
function BuildingRow({ checked, onChange, fill, edge, label }: {
  checked: boolean; onChange: () => void; fill: string; edge: string; label: string;
}) {
  return (
    <FormControlLabel sx={{ ml: -0.75, display: "flex", height: 30 }}
      control={<Checkbox size="small" checked={checked} onChange={onChange} sx={CHECK_SX} />}
      label={
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ width: 16, height: 11, bgcolor: fill, border: `1px solid ${edge}`, borderRadius: "1px" }} />
          <Typography variant="body2">{label}</Typography>
        </Stack>
      } />
  );
}

// A service's icon as the map draws it: the filled Material icon in Night Sky
// inside a white circle with a thin ring.
const SERVICE_ICONS: Record<ServiceKind, typeof SchoolIcon> = {
  fire: LocalFireDepartmentIcon,
  medical: HealthAndSafetyIcon,
  school: SchoolIcon,
  grocery: LocalGroceryStoreIcon,
};
function ServiceIcon({ kind }: { kind: ServiceKind }) {
  const Icon = SERVICE_ICONS[kind];
  return (
    <Box sx={{
      width: 24, height: 24, borderRadius: "50%", bgcolor: "#fff", border: `1.5px solid ${SERVICE_INK}`,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>
      <Icon sx={{ fontSize: 16, color: SERVICE_INK }} />
    </Box>
  );
}

// a left-panel section, boxed like the landslide viewer's
//
// `guide` names the card for the guide to point at, and `lit` marks it as the
// one the guide is talking about: a Bulldog Blue outline with a slow pulse
// around it, which holds still for anyone who has asked for less motion.
function Card({ title, guide, lit, children }: {
  title?: string;
  guide?: PanelTarget;
  lit?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Box data-guide={guide} sx={{
      border: "1px solid #ddd", borderRadius: 1.5, px: 2, py: 1.5, bgcolor: "#fff", mt: 2,
      transition: "border-color 200ms, box-shadow 200ms",
      ...(lit && {
        borderColor: BULLDOG_BLUE,
        boxShadow: `0 0 0 3px ${BULLDOG_BLUE}`,
        animation: "guidePulse 1.8s ease-in-out infinite",
        "@keyframes guidePulse": {
          "0%, 100%": { boxShadow: `0 0 0 3px ${BULLDOG_BLUE}, 0 0 0 3px rgba(0,61,165,0.25)` },
          "50%": { boxShadow: `0 0 0 3px ${BULLDOG_BLUE}, 0 0 0 10px rgba(0,61,165,0.12)` },
        },
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }),
    }}>
      {title && <Typography variant="subtitle2" gutterBottom>{title}</Typography>}
      {children}
    </Box>
  );
}
