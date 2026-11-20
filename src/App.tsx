import React, { useMemo, useRef, useState } from "react";
import {
  Box, ButtonBase, Checkbox, Divider, Drawer, FormControl, Link, MenuItem, MenuList, Popover, Radio, RadioGroup,
  FormControlLabel, ListSubheader, Select, Slider, Stack, Tab, Tabs, Tooltip, Typography,
} from "@mui/material";
import MapView, { Focus, PENDING_RUN, RunFiles } from "./MapView";
import {
  AreasCard, DrawCard, DrawHint, MapBar, NameDialog, RemoveButton, RoutesBox, RoutesCard, ShareButton,
  ShareIconButton, ShareNote, areaLine, areaLink, useShareNote,
} from "./OnDemand";
import {
  ApiError, DrawCheck, fiApi, FiLimits, RUN_CUTOFF, RunPosted, RunStatus, SavedArea, api, checkShape, finishWhy,
  expiryWords, loadAreas, rememberCode, runHazard, saveAreas, unexpired,
  ONDEMAND_LIVE, ROUTES_CHANGED, routesApi, ROUTE_ID, TARGET_SWITCHABLE, useApiTarget, SavedRoute, SharedRoutes, loadRoutes, newSavedRoute, saveRoutes,
  shareLink, sharedRoute, unexpiredRoutes,
} from "./ondemandApi";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import HealthAndSafetyIcon from "@mui/icons-material/HealthAndSafety";
import SchoolIcon from "@mui/icons-material/School";
import LocalGroceryStoreIcon from "@mui/icons-material/LocalGroceryStore";
import PublicIcon from "@mui/icons-material/Public";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import LayersIcon from "@mui/icons-material/Layers";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import MapBoundary from "./MapBoundary";
import Methodology from "./Methodology";
import { BULLDOG_BLUE, NIGHT_SKY, ORG_LOGO_SCREEN, ORG_NAME, ORG_URL } from "./brand";
import {
  BASEMAPS, BasemapKey, COUNTIES, CUT_OFF_CLASS, DEFAULT_BASEMAP, DEFAULT_COUNTY, DEFAULT_CUTOFF, DEFAULT_METHOD,
  DEFAULT_TAB, DETOUR_SCORES, HAZARDS, HAZARD_WORDS, IMPROVE_NOTES, ISOLATION_SCORES, METHODOLOGY, METHODS,
  MIN_RANKED, MethodId, NC_BOUNDS, NC_CENTER, NC_ZOOM, PINCH_SCORES, PINCH_TILES,
  STYLES, Score, TILES_BASE, TabId, classField, defaultHazard, hazardView, hazardsIn, Hazard,
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
const LEGEND_KEY = "legendOpen";
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
// "Access to services" was "Detours" until 2026-11-17, when the user asked
// for a name that says what the tab shows, and for it to go last. Its id
// stays "detour", so old links still open it.
const NAV_TABS: { value: TabId; label: string }[] = [
  { value: "isolation", label: "Functional isolation" },
  { value: "pinch", label: "Pinch points & alternate routing" },
  { value: "detour", label: "Access to services" },
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
  // A ring outside the solid blue picker when it has keyboard focus: the
  // field itself looked the same focused or not.
  "& .MuiSelect-select:focus-visible": { outline: "none" },
  "&:has(.MuiSelect-select:focus-visible)": { outline: `2px solid ${BULLDOG_BLUE}`, outlineOffset: 2 },
};

// Overture's release name ("2026-10-21.0") as a reader would say it
// ("October 2026"), so no version code shows on screen.
function releaseWords(release: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(release);
  if (!m) return release;
  const month = new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleString("en-US", { month: "long" });
  return `${month} ${m[1]}`;
}

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
    const m = fromUrl("method", DEFAULT_METHOD);
    return METHODS.some((x) => x.id === m) ? (m as MethodId) : DEFAULT_METHOD;
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
  // The legend on the map starts open; folding it is remembered.
  const [legendOpen, setLegendOpen] = useState<boolean>(() => {
    try { return window.localStorage.getItem(LEGEND_KEY) !== "closed"; } catch { return true; }
  });
  const toggleLegend = () => setLegendOpen((o) => {
    try { window.localStorage.setItem(LEGEND_KEY, o ? "closed" : "open"); } catch { /* not remembered */ }
    return !o;
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
  // The "No data here" notice can be closed (the user asked for an X). It
  // comes back the next time the map goes from having data to having none.
  const [emptyClosed, setEmptyClosed] = useState(false);
  React.useEffect(() => { if (!mapEmpty) setEmptyClosed(false); }, [mapEmpty]);
  const closeEmpty = (
    <Box component="button" type="button" aria-label="Close" title="Close" onClick={() => setEmptyClosed(true)}
      sx={{
        position: "absolute", top: 6, right: 6, width: 30, height: 30, border: "none", borderRadius: "50%",
        bgcolor: "transparent", color: "#57606a", cursor: "pointer", display: "flex",
        alignItems: "center", justifyContent: "center", "&:hover": { bgcolor: "#eef1f5", color: NIGHT_SKY },
      }}>
      <CloseIcon aria-hidden="true" sx={{ fontSize: 18 }} />
    </Box>
  );
  // Bumped to move the map on demand. Picking the county you are already on
  // has to fly anyway, and that would not change the key by itself.
  const [flyNonce, setFlyNonce] = useState(0);

  // ---- the drawing tool (Functional isolation) ----
  // The areas drawn in this browser, until their results expire.
  // Expired areas are dropped from storage too, not only from the list.
  const [areas, setAreasState] = useState<SavedArea[]>(() => {
    const all = loadAreas(), live = unexpired(all);
    if (live.length !== all.length) saveAreas(live);
    return live;
  });
  const setAreas = (f: (a: SavedArea[]) => SavedArea[]) =>
    setAreasState((cur) => { const next = f(cur); saveAreas(next); return next; });
  // the list as it is now, for handlers that outlive a render (the polling)
  const areasNow = useRef(areas);
  areasNow.current = areas;
  // The drawn area being shown, from the list or a link (run=<id> in the
  // hash); its latest status from the server; and, once read, its results.
  // A build without the tools (ONDEMAND_LIVE false) ignores run= in a link
  // and opens the usual view, and so does a link to another tab.
  const [runId, setRunId] = useState<string | null>(
    () => (ONDEMAND_LIVE && tab === "isolation" ? urlState.get("run") : null));
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [runView, setRunView] = useState<{ id: string; hazard: Hazard; files: RunFiles } | null>(null);
  const activeRun = useRef(runId);
  activeRun.current = runId;
  const tabNow = useRef(tab);
  tabNow.current = tab;
  // A drawn area that finished while another tab was open: the map moves to
  // it when Functional isolation is opened again, not on the other tab.
  const flyOnReturn = useRef<string | null>(null);
  // Whether to move the map to a drawn area's results once they are read.
  // Not for a link that already carries a map position.
  const flyNext = useRef(!(urlState.get("run") && urlState.get("lon") && urlState.get("zoom")));

  // ---- saved routes (Pinch points) ----
  // The sets of alternate routes saved in this browser for 7 days. Expired
  // ones are dropped from storage on load and on the once-a-minute tick.
  const [savedRoutes, setSavedRoutesState] = useState<SavedRoute[]>(() => {
    const all = loadRoutes(), live = unexpiredRoutes(all);
    if (live.length !== all.length) saveRoutes(live);
    return live;
  });
  // A set saved again under the same server id (one opened from a shared
  // link that was already in the list) replaces the older entry.
  // a set that just got its share id (shareIdFor) is reread from storage
  React.useEffect(() => {
    const reread = () => setSavedRoutesState(unexpiredRoutes(loadRoutes()));
    window.addEventListener(ROUTES_CHANGED, reread);
    return () => window.removeEventListener(ROUTES_CHANGED, reread);
  }, []);
  const addSavedRoute = (r: SavedRoute) => {
    setSavedRoutesState((cur) => {
      const next = [...unexpiredRoutes(cur).filter((x) => !(r.route_id && x.route_id === r.route_id)), r];
      saveRoutes(next);
      return next;
    });
    return r.id;
  };
  // the saved set whose routes are on the map now, marked in "Your routes"
  const [shownRoute, setShownRoute] = useState<string | null>(null);
  // The X beside a saved set takes it out of this browser at once. When that
  // set is on the map, its popup (which watches `removedRoute`) closes and the
  // map goes back to the tab's usual view.
  const [removedRoute, setRemovedRoute] = useState<{ id: string; n: number } | null>(null);
  const removeSavedRoute = (id: string) => {
    setSavedRoutesState((cur) => { const next = cur.filter((r) => r.id !== id); saveRoutes(next); return next; });
    setRemovedRoute((cur) => ({ id, n: (cur?.n ?? 0) + 1 }));
  };
  // The saved set to open on the map; the key changes with each pick.
  const [openRoutes, setOpenRoutes] = useState<{ key: string; saved: SavedRoute } | null>(null);
  const pickSavedRoute = (id: string) => {
    const r = savedRoutes.find((x) => x.id === id);
    if (r) { setOpenRoutes({ key: `${id}:${Date.now()}`, saved: r }); setTouched(true); }
  };
  // a pick belongs to the pinch tab: coming back to it later opens nothing
  React.useEffect(() => { if (tab !== "pinch") setOpenRoutes(null); }, [tab]);
  // A shared link to a set of routes (route=<id> in the hash, Pinch points
  // only): the server's stored copy is read, which uses no daily click, and
  // opened like a saved set. One already in this browser's list opens as
  // that entry. An expired or unknown link gets a notice and the usual view.
  // Read once; the hash effect below then drops route= from the address.
  React.useEffect(() => {
    const id = ONDEMAND_LIVE && tab === "pinch" ? urlState.get("route") : null;
    if (!id) return;
    const gone = "These routes have expired or were never saved, so the map shows the usual view.";
    if (!ROUTE_ID.test(id)) { setNotice({ text: gone }); return; }
    let live = true;
    api<SharedRoutes>(routesApi(), `/routes/saved/${id}`)
      .then((s) => {
        if (!live) return;
        const mine = loadRoutes().find((r) => r.route_id === id && Date.parse(r.expires_at) > Date.now());
        setOpenRoutes({ key: `link:${id}`, saved: mine ?? sharedRoute(s) });
        setTouched(true);
      })
      .catch((e) => {
        if (!live) return;
        setNotice({ text: e instanceof ApiError && e.status === 404 ? gone
          : `The shared routes could not be shown. ${e instanceof ApiError ? e.message : ""}`.trim() });
      });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [drawing, setDrawing] = useState(false);
  const [drawCheck, setDrawCheck] = useState<DrawCheck | null>(null);
  const [corners, setCorners] = useState(0);
  // the last corner's place on the map, in pixels: Finish and Cancel sit by it
  const [lastCornerPx, setLastCornerPx] = useState<[number, number] | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const cornersRef = useRef<[number, number][]>([]);
  const [drawn, setDrawn] = useState<[number, number][] | null>(null);
  const [naming, setNaming] = useState(false);
  const [limits, setLimits] = useState<FiLimits | null>(null);
  const [limitsFailed, setLimitsFailed] = useState(false);
  // Where the two tools send their work: AWS, or on the dev server at
  // localhost the copy on this computer if picked (TargetSwitch). Switching
  // reads the counts again; saved areas and routes are left as they are.
  const { target: apiTarget } = useApiTarget();
  const targetNow = useRef(apiTarget);
  targetNow.current = apiTarget;
  const openSetup = import.meta.env.DEV
    ? () => setDoc({ file: "local-setup.md", label: "Running the tools on this computer" }) : undefined;
  // A short message on the map. `shape`, when given, is the drawn hazard it
  // is about: the message sits beside its outline (see `note` in MapView).
  const [notice, setNotice] = useState<{
    text: string; action?: { label: string; run: () => void }; shape?: [number, number][] | null;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());

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

  // Escape closes the guide, wherever it is (a dialog or menu open over it
  // takes Escape for itself first).
  const endGuideNow = useRef(endGuide);
  endGuideNow.current = endGuide;
  const guideOpen = guide != null;
  React.useEffect(() => {
    if (!guideOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) endGuideNow.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [guideOpen]);

  React.useEffect(() => {
    if (guide || launcher !== "pill") return;
    const t = window.setTimeout(() => setLauncher("circle"), PILL_MS);
    return () => window.clearTimeout(t);
  }, [guide, launcher]);

  // Put the panel into the state the example is written for, then send the
  // map to the road. The steps quote ranks out of 10 on the first score and
  // the default classification, so those are set rather than assumed.
  const startExample = (ex: Example) => {
    setTab(ex.tab);
    setCounty(ex.county);
    setMethod(DEFAULT_METHOD);
    if (ex.tab === "detour") setDetourScore(DETOUR_SCORES[0].base);
    if (ex.hazard) { setHazardId(ex.hazard); setCutoff(DEFAULT_CUTOFF); }
    setMinClass(1);
    setRunId(null);           // the guide ignores drawn areas
    setDrawing(false);
    setGuideProps(null);
    setGuide({ ex, step: 0, nudged: false });
    setFocus((f) => focusFor(ex, f ? Number(f.key.split(":")[1]) + 1 : 1));
  };

  // A drawn area is worked out for a 10 minute drive only. The slider's own
  // setting is kept for when a published hazard is picked again.
  const runOn = tab === "isolation" && runId != null;
  const cut = runOn ? RUN_CUTOFF : cutoff;
  const score: Score = useMemo(
    () => (tab === "pinch" ? PINCH_SCORES[0]
      : tab === "isolation" ? ISOLATION_SCORES.find((s) => s.minutes === cut)!
      : DETOUR_SCORES.find((s) => s.base === detourScore)!),
    [tab, detourScore, cut]);

  const field = classField(score.base, method);
  const classes = STYLES[field]?.classes ?? [];
  // The ranks 1 to 10, and apart from them the class for roads cut off
  // completely, which only the functional isolation styles have.
  const ranks = classes.filter((c) => c.value !== CUT_OFF_CLASS);
  const cutOffStyle = classes.find((c) => c.value === CUT_OFF_CLASS);
  const countyObj = COUNTIES.find((c) => c.id === county)!;
  const pubHazard = HAZARDS.find((h) => h.id === hazardId) ?? null;
  // The drawn hazard's results once read, shaped like a published hazard.
  const runReady = runOn && runView?.id === runId ? runView : null;
  // The drawn hazard on show, when it is one of this browser's own. One
  // opened from someone else's link is not, and is called "Shared hazard".
  const runArea = areas.find((a) => a.run_id === runId);
  const runShared = runOn && !runArea;
  const readyHazard = useMemo(
    () => (runReady ? { ...runReady.hazard, shared: runShared } : null), [runReady, runShared]);
  const hazard = readyHazard ?? pubHazard;
  // The drive times this hazard's run has. A run made before 30 minutes was
  // added has only 5, 10 and 15, and the slider offers only those; a link or
  // a switch landing on a drive time the run lacks falls back to 15.
  const cutoffsHere = ISOLATION_SCORES.filter((x) => pubHazard?.losing?.[String(x.minutes)] != null);
  const slidable = cutoffsHere.length ? cutoffsHere : ISOLATION_SCORES;
  React.useEffect(() => {
    if (tab === "isolation" && !slidable.some((x) => x.minutes === cutoff)) setCutoff(DEFAULT_CUTOFF);
  }, [tab, hazardId, cutoff]);
  const hazardWords = HAZARD_WORDS[hazard?.kind ?? "flood"];
  // Too few roads losing anything at this drive time for ten ranks to mean
  // anything (the I-40 landslide within 5 minutes).
  const unranked = tab === "isolation" && hazard
    ? (hazard.losing[String(cut)] ?? 0) < MIN_RANKED : false;
  // What each rank stands for on this hazard, drive time and classification:
  // the lowest and highest share of places out of reach among its roads.
  const rankRanges = tab === "isolation" && hazard && !(runOn && !runReady)
    ? hazard.classRanges?.[`${cut}_${method}`] ?? null : null;
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
      setMethod(DEFAULT_METHOD);
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
    setRunId(null);
    setCounty(id);
    if (id !== county) setHazardId(defaultHazard(id));
    setFlyNonce((n) => n + 1);
  };
  const goToHazard = (id: string) => {
    panelChanged();
    setRunId(null);
    setHazardId(id);
    setFlyNonce((n) => n + 1);
  };

  // ---- the drawing tool ----

  // The runs left today, read when the tab opens and after each run.
  React.useEffect(() => { setLimits(null); setLimitsFailed(false); }, [apiTarget]);
  React.useEffect(() => {
    if (tab !== "isolation" || !ONDEMAND_LIVE) return;
    let live = true;
    api<FiLimits>(fiApi(), "/limits")
      .then((l) => { if (live) { setLimits(l); setLimitsFailed(false); } })
      .catch(() => { if (live) setLimitsFailed(true); });
    return () => { live = false; };
  }, [tab, apiTarget]);

  // Once a minute: the countdowns move on, and expired areas leave the list.
  React.useEffect(() => {
    const t = window.setInterval(() => {
      setNow(Date.now());
      setAreasState((cur) => {
        const next = unexpired(cur);
        if (next.length === cur.length) return cur;
        saveAreas(next);
        return next;
      });
      setSavedRoutesState((cur) => {
        const next = unexpiredRoutes(cur);
        if (next.length === cur.length) return cur;
        saveRoutes(next);
        return next;
      });
    }, 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Read a finished run's area and study area, and show its results.
  const loadResults = async (st: RunStatus) => {
    if (!st.files || !st.stats) return;
    try {
      const [hz, study] = await Promise.all([st.files.hazard, st.files.study_area].map(async (u) => {
        const r = await fetch(u);
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as GeoJSON.FeatureCollection;
      }));
      if (activeRun.current !== st.run_id) return;
      setRunView({
        id: st.run_id, hazard: runHazard(st, hz, study),
        files: { roads: st.files.roads, hazard: hz, buildings: st.files.hazard_buildings },
      });
      setDrawn(null);
      if (flyNext.current) {
        if (tabNow.current === "isolation") setFlyNonce((n) => n + 1);
        else flyOnReturn.current = st.run_id;
      }
      flyNext.current = true;
    } catch {
      if (activeRun.current === st.run_id) {
        setNotice({ text: "The results for this hazard could not be read. Try picking it again." });
      }
    }
  };

  // What the server says about a run: the list is updated, and the area being
  // shown follows it. A run that finishes while another is on screen gets a
  // notice with a button to show it.
  const onRunStatus = (st: RunStatus, fromPoll: boolean) => {
    setAreas((list) => list.map((a) => (a.run_id === st.run_id ? { ...a, status: st.status } : a)));
    if (st.run_id === activeRun.current) {
      setRunStatus(st);
      if (st.status === "done") loadResults(st);
    } else if (fromPoll && st.status === "done") {
      setNotice({
        text: `Your hazard "${st.name}" is ready.`, action: { label: "Show it", run: () => pickRun(st.run_id) },
        shape: areasNow.current.find((a) => a.run_id === st.run_id)?.geometry ?? null,
      });
    }
  };
  const onRunGone = (id: string) => {
    // With the dev server's toggle, an area not made on the target in use is
    // not found there; it stays in the list for when the toggle goes back.
    setAreas((list) => list.filter((a) => a.run_id !== id
      || (TARGET_SWITCHABLE && a.target !== targetNow.current)));
    if (id === activeRun.current) {
      const shape = areasNow.current.find((a) => a.run_id === id)?.geometry ?? null;
      setRunId(null);
      setNotice({ text: "This hazard has expired or was never saved, so the map is back on a published hazard.", shape });
    }
  };
  // The X beside one of the reader's own areas (in "Your areas" or the hazard
  // list) takes it out of this browser's list at once. One on the map is
  // cleared, and the map goes back to the published hazard picked. The
  // published hazards themselves have no X and are never removed.
  const removeArea = (id: string) => {
    const gone = areas.find((a) => a.run_id === id);
    setAreas((list) => list.filter((a) => a.run_id !== id));
    setNotice(null);
    setHazardMenu(false);
    if (id === activeRun.current) {
      setRunId(null);
      setFlyNonce((n) => n + 1);
      // said in a short message, since the map changes under the reader
      const back = HAZARDS.find((h) => h.id === hazardId)?.label;
      setNotice({ text: `Removed your hazard "${gone?.name ?? runName}".${back ? ` The map is back on ${back}.` : ""}` });
    }
  };
  // The hazard list's menu, held here so removing the area shown in it can
  // close it (the entry picked is gone, so the menu has nothing to point at).
  const [hazardMenu, setHazardMenu] = useState(false);
  // "Link copied" (or the link to copy by hand) under the hazard pulldown,
  // after its share icon beside one of the reader's areas
  const hazardShare = useShareNote();

  // The area being shown: read its status, and its results when done.
  React.useEffect(() => {
    if (!runId) { setRunStatus(null); setRunView(null); return; }
    let live = true;
    setRunStatus(null);
    api<RunStatus>(fiApi(), `/runs/${runId}`)
      .then((st) => { if (live) onRunStatus(st, false); })
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 404) onRunGone(runId);
        else setNotice({ text: e instanceof ApiError ? e.message : "This hazard could not be loaded just now. Try picking it again." });
      });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Ask after every run still going every 3 seconds, backing off when the
  // server cannot be reached. A reload picks this up again from the list.
  const pollIds = Array.from(new Set([
    ...areas.filter((a) => a.status === "running" && (!TARGET_SWITCHABLE || a.target === apiTarget))
      .map((a) => a.run_id),
    ...(runStatus?.status === "running" ? [runStatus.run_id] : []),
  ])).join(",");
  React.useEffect(() => {
    if (!pollIds) return;
    let live = true;
    let fails = 0;
    let timer: number | undefined;
    const tick = async () => {
      let failed = false;
      for (const id of pollIds.split(",")) {
        try {
          const st = await api<RunStatus>(fiApi(), `/runs/${id}`);
          if (!live) return;
          if (st.status !== "running") onRunStatus(st, true);
          else if (id === activeRun.current) setRunStatus(st);
        } catch (e) {
          if (!live) return;
          if (e instanceof ApiError && e.status === 404) onRunGone(id);
          else failed = true;
        }
      }
      fails = failed ? fails + 1 : 0;
      if (live) timer = window.setTimeout(tick, Math.min(30_000, 3000 * 2 ** fails));
    };
    timer = window.setTimeout(tick, 3000);
    return () => { live = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollIds, apiTarget]);

  const pickRun = (id: string) => {
    panelChanged();
    setTab("isolation");
    setDrawing(false);
    setNotice(null);
    flyNext.current = true;
    if (id === runId && runView?.id === id) setFlyNonce((n) => n + 1);
    setRunId(id);
  };

  const startDrawing = () => {
    endGuide();
    setNotice(null);
    setDrawCheck(null);
    setCorners(0);
    setRefusal(null);
    cornersRef.current = [];
    setDrawing(true);
  };
  const stopDrawing = () => { setDrawing(false); setDrawn(null); };
  const onDraw = (pts: [number, number][], cursor: [number, number] | null, lastPx: [number, number] | null) => {
    if (pts.length !== cornersRef.current.length) setRefusal(null);
    cornersRef.current = pts;
    setCorners(pts.length);
    setLastCornerPx((p) => (p && lastPx && p[0] === lastPx[0] && p[1] === lastPx[1]) || (!p && !lastPx) ? p : lastPx);
    setDrawCheck(checkShape(cursor ? [...pts, cursor] : pts));
  };
  const finishDrawing = (pts: [number, number][]) => {
    const c = checkShape(pts);
    if (c.problem) { setRefusal(c.problem); return false; }
    setDrawing(false);
    setDrawn(pts);
    setNaming(true);
    return true;
  };
  const submitRun = async (name: string, code: string) => {
    const ring = drawn ?? [];
    const sentTo = targetNow.current;
    const res = await api<RunPosted>(fiApi(), "/runs", {
      code, name, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
    });
    rememberCode(code);
    setLimits((l) => (l ? { ...l, runs_left: res.runs_left, big_left: res.big_left } : l));
    setAreas((list) => [...list.filter((a) => a.run_id !== res.run_id), {
      run_id: res.run_id, name: res.name, created_at: res.created_at, expires_at: res.expires_at,
      county: res.county, status: "running", geometry: ring,
      ...(TARGET_SWITCHABLE ? { target: sentTo } : {}),
    }]);
    setNaming(false);
    flyNext.current = true;
    setRunId(res.run_id);
  };
  // The outline in the drawing color: the area just drawn, while it is
  // named and run.
  const keepShape = naming ? drawn
    : runOn && !runReady ? (runArea?.geometry ?? drawn) : null;
  const runName = runReady?.hazard.label ?? runStatus?.name ?? runArea?.name ?? "loading";

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
  const [coach, setCoach] = useState<{ top: number; left: number; arrow: number | null; room: number;
    w?: number; h?: number }>({ top: 16, left: 16, arrow: null, room: 600 });
  React.useLayoutEffect(() => {
    if (!onPanelStep) return;
    const panel = panelRef.current;
    const target = panelTarget
      ? document.querySelector<HTMLElement>(`[data-guide="${panelTarget}"]`) ?? null : null;
    // the legend and the services sit on the map now; only panel cards scroll
    if (target && panel?.contains(target)) target.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const place = () => {
      const area = mapAreaRef.current?.getBoundingClientRect();
      if (!area) return;
      // 12 px clear of the map's top and bottom, less the card's padding
      const room = Math.max(180, area.height - 24 - 26);
      const w = coachRef.current?.offsetWidth ?? 380;
      const h = coachRef.current?.offsetHeight ?? 300;
      if (!target) { setCoach({ top: 16, left: 16, arrow: null, room, w, h }); return; }
      const t = target.getBoundingClientRect();
      // a target on the map (the legend): the card goes to its right
      const left = t.left >= area.left ? Math.round(t.right - area.left + 14) : 16;
      // Aim at the card's heading and first control rather than its middle,
      // since some cards (the color key) are tall.
      const aim = t.top + Math.min(t.height / 2, 32) - area.top;
      const top = Math.max(12, Math.min(aim - 34, area.height - h - 12));
      setCoach({ top, left, arrow: Math.max(18, Math.min(aim - top, h - 18)), room, w, h });
    };
    place();
    panel?.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    const seen = new ResizeObserver(place);
    if (coachRef.current) seen.observe(coachRef.current);
    if (target && !panel?.contains(target)) seen.observe(target);
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

  React.useEffect(() => {
    if (tab !== "isolation" || !flyOnReturn.current) return;
    if (flyOnReturn.current === runId && runView?.id === runId) setFlyNonce((n) => n + 1);
    flyOnReturn.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const onHazard = tab === "isolation" && hazard != null;
  // A drawn area on its way: the published hazard's roads, area, shade and
  // ranks are left off the map and the legend until the area's own results
  // are read, so nothing on screen describes the wrong place.
  const runPending = runOn && !runReady;
  // The stats strip under the map: functional isolation, no guide open.
  // Not while a drawn area is still on its way: the map still shows the
  // published hazard then, and its numbers would read as the drawn area's.
  const showStats = onHazard && !guide && !(runOn && !runReady);
  const tilesUrl = runReady ? `run:${runReady.id}` : runPending ? "run:pending" : new URL(
    tab === "pinch" ? PINCH_TILES : onHazard ? hazard.tiles : countyObj.tiles, TILES_BASE).href;
  // What the map draws. While a drawn hazard is worked out, the last view
  // on this tab stays on screen, dimmed and answering no hovers or clicks,
  // until the results arrive (blank only when there was none before, as for
  // a link opened cold).
  const liveView = {
    tilesUrl, field, score,
    run: runReady?.files ?? (runPending ? PENDING_RUN : null),
    hazard: onHazard && !runPending ? hazard : null,
  };
  const lastView = useRef<typeof liveView | null>(null);
  if (tab === "isolation" && !runPending) lastView.current = liveView;
  const dimmed = runPending && lastView.current != null;
  const shown = dimmed ? lastView.current! : liveView;
  const sourceLayer = tab === "pinch" ? "pinch" : tab === "isolation" ? "roads" : "detour";
  const view = onHazard ? hazardView(hazard) : null;
  const center: [number, number] = tab === "pinch" ? NC_CENTER : view ? view.center : countyObj.center;
  const zoom = tab === "pinch" ? NC_ZOOM : view ? view.zoom : countyObj.zoom;
  const fullBounds = tab === "pinch" ? NC_BOUNDS : onHazard ? hazard.bounds : countyObj.bounds;
  const fullLabel = tab === "pinch" ? "Show the whole state"
    : onHazard ? `Show everything within ${hazard.bufferMiles} miles of the hazard`
    : `Show all of ${countyObj.label} County`;

  // The message on the map about a drawn hazard, beside its outline: the
  // server's own words on its progress while it is worked out, then
  // "loading", or why it failed; otherwise any other notice.
  const runLabel = runShared ? `the shared hazard "${runName}"` : `your hazard "${runName}"`;
  let mapNote: React.ReactNode = null;
  let noteRing: [number, number][] | null = null;
  if (!drawing && runOn && runStatus?.status === "running") {
    mapNote = (
      <MapBar spinner>
        <b>Working on {runLabel}.</b> {runStatus.progress}
        {/^(Waiting|Loading)/.test(runStatus.progress ?? "") ? " Big cities take about 2 minutes." : ""}
      </MapBar>
    );
    noteRing = keepShape;
  } else if (!drawing && runOn && runStatus?.status === "done" && !runReady) {
    mapNote = <MapBar spinner>Loading the results for {runLabel}.</MapBar>;
    noteRing = keepShape;
  } else if (!drawing && runOn && runStatus?.status === "failed") {
    mapNote = (
      <MapBar onClose={() => setRunId(null)}>
        {runLabel.charAt(0).toUpperCase() + runLabel.slice(1)} could not be worked out. {runStatus.error ?? ""}
      </MapBar>
    );
    noteRing = keepShape;
  } else if (!drawing && notice && !(runOn && runStatus && runStatus.status !== "done")) {
    mapNote = (
      <MapBar onClose={() => setNotice(null)}>
        {notice.text}
        {notice.action && (
          <Box component="button" type="button" onClick={() => { notice.action!.run(); setNotice(null); }} sx={{
            ml: 1.25, font: "inherit", fontWeight: 700, fontSize: 13, cursor: "pointer", px: 1.25, py: 0.25,
            borderRadius: 999, border: "1.5px solid #fff", color: "#fff", bgcolor: "transparent",
            "&:hover": { bgcolor: "rgba(255,255,255,0.15)" },
          }}>
            {notice.action.label}
          </Box>
        )}
      </MapBar>
    );
    noteRing = notice.shape ?? null;
  }

  // keep the hash in step with the panel
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    Object.entries({
      tab, county, hazard: hazardId, cutoff: String(cutoff), method, score: detourScore, basemap,
      buildings: buildings ? "1" : "0", svc: services.join(","), hb: hazardBldgs.join(","),
      min: String(minClass), left: String(left),
    }).forEach(([k, v]) => p.set(k, v));
    if (runId && tab === "isolation") p.set("run", runId); else p.delete("run");
    // a shared routes link is read once at load (see above), not kept
    p.delete("route");
    window.history.replaceState(null, "", `#${p.toString()}`);
  }, [tab, county, hazardId, cutoff, method, detourScore, basemap, buildings, services, hazardBldgs, minClass, left, runId]);

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

  // The legend, drawn on the map under the Basemap button (MapLegend). The
  // same contents the panel's Legend card had: the color key with each
  // rank's share, the rank slider, the building checkboxes and the hazard's
  // hatching, plus the services' checkboxes on Access to services.
  const legendBody = (
    <>
      {tab === "detour" && (
        <Box data-guide="services" sx={{ mb: 1.25, pb: 1, borderBottom: "1px solid #e6e8eb" }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
            Services on the map: the places the trips are counted to.
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
        </Box>
      )}
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          {tab === "isolation"
            ? `Each rank, with the share of the places within a ${cut}-minute drive that someone on those roads can no longer get to:`
            : "Each color is a rank, from 1 (lowest) to 10 (highest)."}
        </Typography>
        {unranked && hazard && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Only {hazard.losing[String(cut)]}{" "}
            {hazard.losing[String(cut)] === 1 ? "road loses" : "roads lose"} anything
            within {cut} minutes, too few to rank, so the other roads are all in rank 1.
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
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <Box sx={{ minWidth: 0 }}>
            {[...ranks].reverse().map((c) => (
              <LegendRow key={c.value} c={c}
                on={c.value >= minClass && !(rankRanges && !rankRanges[c.value - 1])}
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
              getAriaValueText={(v) => (v === 1 ? "All ranks shown" : `Ranks ${v} to 10 shown`)}
              sx={{
                color: BULLDOG_BLUE,
                height: (ranks.length - 1) * LEGEND_ROW, my: `${LEGEND_ROW / 2}px`,
              }} />
          </Stack>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.35, mt: 0.25 }}>
          Slide the handle up to hide the lower ranks.
        </Typography>
        {/* Buildings, under the ranks at the user's request, with a heading
            that links to Overture's page on its buildings data. Each row
            is a checkbox, a footprint swatch in the color the map draws,
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
                Every road inside it is closed and drawn in dark red, like the roads it cuts off
                completely. The shaded part of the map is more than{" "}
                {hazard?.bufferMiles ?? 30} miles from it and was not looked at.
              </Typography>
            </Stack>
          </Box>
        )}
    </>
  );

  // The "No data here" notices sit in the middle of the part of the map to
  // the right of the open legend, so they never cover it.
  const legendShown = guide ? panelTarget === "legend" || panelTarget === "services" : drawing ? false : legendOpen;
  const emptySx = {
    position: "absolute", top: "50%", transform: "translate(-50%, -50%)",
    left: legendShown ? "calc(50% + 161px)" : "50%",
    width: "max-content", maxWidth: legendShown ? "min(460px, calc(100% - 346px))" : "min(460px, calc(100% - 24px))",
    boxSizing: "border-box",
    bgcolor: "#fff", borderRadius: 2, px: 2.5, py: 2, pr: 5,
    boxShadow: "0 6px 24px rgba(16,24,40,0.18)",
    border: "1px solid #dfe3e8", zIndex: 5,
  } as const;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Title bar across the full width, above both the panel and the map.
          The wordmark is white on transparent, so it needs the dark Night Sky
          behind it to read at all. */}
      {/* On narrow screens the bar wraps, putting the tabs on a second row
          rather than letting the title run into them or the tabs run off the
          right edge. */}
      <Box component="header" sx={{
        bgcolor: NIGHT_SKY, display: "flex", alignItems: "center", gap: 2,
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
          onChange={(_, v) => { endGuide(); setDrawing(false); setTab(v); }}
          sx={{
            // gaps kept tight so the bar fits a 1280 px window without
            // scrolling sideways
            ml: 0.5, minHeight: 0, flexShrink: 0,
            "& .MuiTabs-flexContainer": { gap: 1 },
            "& .MuiTabs-indicator": { display: "none" },
            "& .MuiTab-root": {
              textTransform: "none", fontWeight: 600, fontSize: 15,
              minHeight: 0, minWidth: 0, px: 1.5, py: 0.75, borderRadius: 999,
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
            there is room beside the tabs: from 1500 px wide, since below that
            it was squeezed to a narrow column and pushed the page sideways. */}
        <Typography sx={{
          color: "rgba(255,255,255,0.92)", fontSize: 13.5, fontWeight: 500,
          textAlign: "right", maxWidth: 300, minWidth: 0, lineHeight: 1.4,
          display: "none", "@media (min-width: 1500px)": { display: "block" },
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
          {/* The same box on every tab, first: the name of what the colors
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
                buildings they could drive to within {cut} minutes,{" "}
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
              <Select fullWidth size="small" value={county} labelId={cardTitleId("county")}
                onChange={(e) => goToCounty(e.target.value)}
                sx={PICKER_SX}>
                {COUNTIES.map((c) => <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>)}
              </Select>
            </Card>
          )}

          {tab === "isolation" && (
            <Card title="Choose a hazard" guide="hazard" lit={panelTarget === "hazard"}>
              {/* A drawn hazard on show is the selected entry, "Your hazard: ..." (or "Shared hazard: ..." from someone else's link);
                  picking a published hazard goes back to it. Only the
                  reader's own area (one in this browser's list) has the
                  remove X; the published hazards never do. The closed field
                  shows the name alone, without the X. */}
              <Select fullWidth size="small" value={runOn ? "__run" : hazardId} sx={PICKER_SX}
                labelId={cardTitleId("hazard")}
                open={hazardMenu} onOpen={() => setHazardMenu(true)} onClose={() => setHazardMenu(false)}
                onChange={(e) => {
                  const v = String(e.target.value);
                  if (v === "__run") return;
                  if (v.startsWith("run:")) { setHazardMenu(false); pickRun(v.slice(4)); return; }
                  goToHazard(v);
                }}
                renderValue={(v) => (v === "__run" ? `${runShared ? "Shared hazard" : "Your hazard"}: ${runName}`
                  : hazardsIn(county).find((h) => h.id === v)?.label ?? v)}>
                {/* Every area drawn in this browser, not only the one on
                    show, each with its expiry date and an X (the user found
                    them "lost" when only the shown one was listed). */}
                {runOn && !runArea && (
                  <MenuItem value="__run">Shared hazard: {runName}</MenuItem>
                )}
                {areas.length > 0 && <ListSubheader sx={{ lineHeight: "32px" }}>Your hazards</ListSubheader>}
                {[...areas].sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at)).map((a) => {
                  // the same row as in "Your areas" and "Your routes": a
                  // check and a bold name on the one on the map, the name,
                  // its expiry or "Running...", the share icon and the X
                  const link = areaLink(a);
                  const shown = runOn && a.run_id === runId;
                  return (
                    <MenuItem key={a.run_id} value={a.run_id === runId ? "__run" : `run:${a.run_id}`} sx={{ gap: 0.75, py: 0.5 }}
                      aria-current={shown ? "true" : undefined}>
                      <Box sx={{ width: 18, flexShrink: 0, display: "flex" }} title={shown ? "On the map now" : undefined}>
                        {shown && <CheckIcon sx={{ fontSize: 18, color: BULLDOG_BLUE }} aria-label="On the map now" />}
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" noWrap sx={{ fontWeight: shown ? 700 : 400 }}>{a.name}</Typography>
                        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                          {areaLine(a, Math.max(now, Date.now()))}
                        </Typography>
                      </Box>
                      {link && (
                        <ShareIconButton name={a.name}
                          onShare={() => { setHazardMenu(false); hazardShare.share(a.name, link()); }} />
                      )}
                      <RemoveButton name={a.name} onRemove={() => removeArea(a.run_id)} />
                    </MenuItem>
                  );
                })}
                {areas.length > 0 && <ListSubheader sx={{ lineHeight: "32px" }}>Published hazards</ListSubheader>}
                {/* The published hazards get the same share icon (no X: they
                    are never removed). The link opens that hazard with the
                    drive time and grouping on show. */}
                {hazardsIn(county).map((h) => (
                  <MenuItem key={h.id} value={h.id} sx={{ gap: 0.75 }}>
                    <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {h.label}
                    </Box>
                    <ShareIconButton name={h.label}
                      onShare={() => {
                        setHazardMenu(false);
                        hazardShare.share(h.label, shareLink(
                          { tab: "isolation", county, hazard: h.id, cutoff: String(cutoff), method }, false));
                      }} />
                  </MenuItem>
                ))}
              </Select>
              <ShareNote note={hazardShare.note} onClose={hazardShare.clear} />
            </Card>
          )}

          {/* The drive time as a slider rather than a list, so moving between
              5, 10, 15 and 30 minutes shows the loss growing or shrinking. It
              stops only at the three times the runs measured. */}
          {tab === "isolation" && runOn && (
            <Card title="Drive time" guide="score" lit={panelTarget === "score"}>
              <Typography variant="body2">
                10 minutes. Drawn hazards are worked out for a 10-minute drive only.
              </Typography>
            </Card>
          )}
          {tab === "isolation" && !runOn && (
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
                  sx={{
                    color: BULLDOG_BLUE, "& .MuiSlider-markLabel": { fontSize: 13 },
                    // the end labels sit inside the card: the first starts at
                    // its mark and the last ends at its mark
                    "& .MuiSlider-markLabel[data-index='0']": { transform: "translateX(-4px)" },
                    [`& .MuiSlider-markLabel[data-index='${slidable.length - 1}']`]: {
                      transform: "translateX(calc(-100% + 4px))",
                    },
                  }} />
              </Box>
            </Card>
          )}

          {tab === "detour" && (
            <Card title="Choose what the map shows" guide="score" lit={panelTarget === "score"}>
              <FormControl fullWidth>
                <Select size="small" value={detourScore} sx={PICKER_SX} labelId={cardTitleId("score")}
                  onChange={(e) => { panelChanged(); setDetourScore(e.target.value); }}>
                  {DETOUR_SCORES.map((s) => <MenuItem key={s.base} value={s.base}>{s.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Card>
          )}


          <Card title="How roads are sorted into colors" guide="classes" lit={panelTarget === "classes"}>
            <RadioGroup value={method} aria-labelledby={cardTitleId("classes")}
              onChange={(e) => { panelChanged(); setMethod(e.target.value as MethodId); }}>
              {METHODS.map((m) => (
                <Tooltip key={m.id} title={m.help} placement="right" arrow describeChild>
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
          </Card>


          {/* There is no Map card: the basemap is picked with the globe
              button on the map, and the road opacity slider was removed at
              the user's request. */}

          {/* The drawing tool and the areas drawn in this browser, just above
              Methodology, as in the approved mockups. Left out of a
              production build unless VITE_ONDEMAND_LIVE=1 (ONDEMAND_LIVE). */}
          {tab === "isolation" && ONDEMAND_LIVE && (
            <DrawCard drawing={drawing} limits={limits} limitsFailed={limitsFailed}
              onStart={startDrawing} onCancel={stopDrawing} onSetup={openSetup} lit={panelTarget === "draw"} />
          )}
          {tab === "isolation" && ONDEMAND_LIVE && (
            <AreasCard areas={areas} activeId={runOn ? runId : null} now={now} onPick={pickRun} onRemove={removeArea} />
          )}
          {/* Where to find the alternate routes, which live in a road's
              popup, and below it the routes saved from road popups, just
              above Methodology. */}
          {tab === "pinch" && ONDEMAND_LIVE && (
            <Card title="Alternate routes" guide="routes" lit={panelTarget === "routes"}>
              <Typography variant="body2" sx={{ lineHeight: 1.5 }}>
                Click any road, then "Get alternate and truck-safe routes" in its popup, to see up
                to three alternate routes for when that road is closed.
              </Typography>
            </Card>
          )}
          {tab === "pinch" && ONDEMAND_LIVE && (
            <RoutesCard routes={savedRoutes} shownId={shownRoute} now={now} onPick={pickSavedRoute}
              onRemove={removeSavedRoute} />
          )}

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
                How these numbers were worked out, in detail.
              </Typography>
            </Card>
          )}

          {IMPROVE_NOTES[tab].length > 0 && (
            <Card title="Things to improve">
              <Stack spacing={0.75}>
                {IMPROVE_NOTES[tab].map((d) => (
                  <Link key={d.file} component="button" underline="hover" sx={{ textAlign: "left", color: BULLDOG_BLUE }}
                    onClick={() => setDoc(d)}>
                    <Typography variant="body2">{d.label}</Typography>
                  </Link>
                ))}
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                What the tools in testing could do better, and what is worth knowing about the map.
              </Typography>
            </Card>
          )}

          {/* Double-clicking this line is a hidden reset: see resetRemembered. */}
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}
            onDoubleClick={resetRemembered}>
            {onHazard && hazard.overtureRelease
              ? `Roads and buildings from Overture Maps, ${releaseWords(hazard.overtureRelease)}.`
              : "Roads from Overture Maps."}
          </Typography>
        </Box>
      </Drawer>

      {/* Clipped to its own edges, so on a narrow window, where the panel
          leaves the map only a sliver, nothing on the map pushes the page
          into scrolling sideways. */}
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <Box ref={mapAreaRef} sx={{ position: "relative", flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        <MapBoundary>
          <MapView
            onEmptyChange={setMapEmpty}
            tilesUrl={shown.tilesUrl}
            sourceLayer={sourceLayer}
            classField={shown.field}
            score={shown.score}
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
            hazard={shown.hazard}
            buildingsUrl={buildings && overtureRelease ? overtureBuildingsUrl(overtureRelease) : null}
            services={tab === "detour" ? services : null}
            hazardBuildings={hazardBldgs}
            guideOnHazard={onHazard && step?.showsHazard === true}
            guideStep={guide && !onPanelStep ? guide.step : -1}
            guideCard={guide && onPanelStep && coach.w && coach.h
              ? [coach.left, coach.top, coach.left + coach.w, coach.top + coach.h] : null}
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
            run={shown.run}
            dimmed={dimmed}
            note={mapNote}
            noteRing={noteRing}
            drawing={drawing}
            onDraw={onDraw}
            onDrawFinish={finishDrawing}
            onDrawCancel={stopDrawing}
            drawShape={keepShape}
            routeBox={ONDEMAND_LIVE ? (ctx) => (
              <RoutesBox key={ctx.key} ctx={ctx}
                onSave={(name, road, result) => addSavedRoute(newSavedRoute(name, road,
                  String(ctx.props.overture_id ?? ""), ctx.lngLat, ctx.props, result))}
                removed={removedRoute} onGone={() => setFlyNonce((n) => n + 1)} onShowing={setShownRoute}
                onSetup={openSetup} />
            ) : undefined}
            openRoutes={openRoutes}
          />
        </MapBoundary>

        <BasemapPicker value={basemap} onChange={setBasemap} />
        {/* Folded while the guide talks about the road or other panel cards,
            so it never covers the hazard or the guide; open on the guide's
            steps about the legend and the services. */}
        <MapLegend
          // folded while an area is drawn, so it never covers the drawing
          open={guide ? panelTarget === "legend" || panelTarget === "services" : drawing ? false : legendOpen}
          lit={panelTarget === "legend" || panelTarget === "services"}
          onToggle={toggleLegend}>
          {legendBody}
        </MapLegend>

        {/* The guide during the steps about the panel: a dark card on the
            map's left edge, its arrow on the panel card being described. */}
        {guide && onPanelStep && (
          <Box ref={coachRef} className="guide-card"
            style={{ ["--guide-room" as string]: `${coach.room}px` }}
            sx={{
            position: "absolute", left: coach.left, top: coach.top, zIndex: 6,
            // the same 2 px white rim as the hazard's popup, so it holds up
            // on the dark basemaps and the imagery
            bgcolor: NIGHT_SKY, color: "#fff", borderRadius: "12px", p: "14px 16px 12px", border: "2px solid #fff",
            boxShadow: "0 12px 32px rgba(0,20,45,0.38)", transition: "top 250ms ease",
          }}>
            {coach.arrow != null && (
              <Box aria-hidden="true" sx={{
                // white, joined to the white rim, as the hazard popup's tip is
                position: "absolute", left: -12, top: coach.arrow - 10, width: 0, height: 0,
                borderTop: "10px solid transparent", borderBottom: "10px solid transparent",
                borderRight: "10px solid #fff", transition: "top 250ms ease",
              }} />
            )}
            <MapGuide ex={guide.ex} step={guide.step} steps={steps}
              color={null} nudged={guide.nudged}
              onStep={goToStep} onEnd={endGuide} />
          </Box>
        )}

        {/* Drawing: the hint with Finish and Cancel, and the live size. */}
        {drawing && (
          <DrawHint check={refusal && drawCheck ? { ...drawCheck, problem: refusal } : drawCheck}
            corners={Math.max(corners, refusal ? 3 : 0)}
            canFinish={checkShape(cornersRef.current).problem == null}
            finishWhy={finishWhy(checkShape(cornersRef.current))}
            onFinish={() => finishDrawing(cornersRef.current)} onCancel={stopDrawing}
            anchor={corners > 0 ? lastCornerPx : null} />
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
        {!guide && !touched && !drawing && !(tab !== "pinch" && mapEmpty) && (
          <Box sx={{
            position: "absolute", bottom: launcher === "pill" ? 34 + LAUNCHER_SIZE + 12 : 34,
            left: launcher === "pill" ? "50%" : `calc(50% + ${(12 + LAUNCHER_SIZE) / 2}px)`,
            transform: "translateX(-50%)", transition: "bottom 400ms, left 400ms",
            bgcolor: "rgba(16,23,31,0.86)", color: "#fff", borderRadius: 999, border: "2px solid #fff",
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
        {onHazard && mapEmpty && !emptyClosed && !drawing && !runPending && (
          <Box sx={emptySx}>
            {closeEmpty}
            <Typography sx={{ fontWeight: 700, fontSize: 14.5, mb: 0.5 }}>
              Nothing to show here
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {runReady
                ? `Results for "${hazard.label}" cover the roads within ${hazard.bufferMiles} miles of it.`
                : `Each hazard covers the roads within ${hazard.bufferMiles} miles of it. This one `
                  + `is ${hazard.label.charAt(0).toLowerCase() + hazard.label.slice(1)}.`}
            </Typography>
            <Box component="button" onClick={() => (runReady ? setFlyNonce((n) => n + 1) : goToHazard(hazard.id))}
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

        {tab === "detour" && mapEmpty && !emptyClosed && (
          <Box sx={emptySx}>
            {closeEmpty}
            <Typography sx={{ fontWeight: 700, fontSize: 14.5, mb: 0.5 }}>
              No access to services data here
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Access to services has been worked out for three counties so far.
              Pinch points & alternate routing covers the whole state, so that tab has data everywhere.
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
      {/* What the hazard closes and cuts off, counted by the analysis, in
          big numbers like the landslide viewer, in a strip under the map
          rather than over it. Functional isolation only, and hidden while
          the guide is open. */}
      {showStats && (
        <Box sx={{
          flexShrink: 0, bgcolor: "#f4f6f8", borderTop: "1px solid #dfe3e8", px: 1.5, py: 1.25,
        }}>
          <Stack direction="row" spacing={1} alignItems="stretch" flexWrap="wrap" useFlexGap>
            <Stat value={hazard.isolatedBuildings} label="buildings cut off" />
            <Stat value={hazard.hazardBuildings} label={`buildings ${hazardWords.inside}`} />
            <Stat value={hazard.isolatedRoads} label="roads cut off" />
            <Stat value={hazard.closedRoads} label="roads closed" />
            <Stat value={`${feet(hazard.isolatedRoadM + hazard.closedRoadM)} ft`}
              label={`of road cut off or closed (${feet(hazard.isolatedRoadM)} ft cut off, `
                + `${feet(hazard.closedRoadM)} ft closed)`} />
            {/* A drawn area's results: a link that opens them for anyone,
                with no new run, until they expire. */}
            {runReady && ONDEMAND_LIVE && (
              <Box sx={{ ml: "auto", alignSelf: "center" }}>
                <ShareButton label="Share this hazard"
                  link={() => shareLink({ tab: "isolation", run: runReady.id }, true)} />
              </Box>
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, lineHeight: 1.3 }}>
            {runReady
              ? "Counted for the drawn hazard, within 12 miles of it. Buildings and roads from Overture Maps"
                + (hazard.overtureRelease ? `, ${releaseWords(hazard.overtureRelease)}.` : ".")
              : `Counted for this hazard. Buildings and roads from Overture Maps, `
                + `${releaseWords(hazard.overtureRelease)}.`}
          </Typography>
        </Box>
      )}
      </Box>
      </Box>

      <NameDialog open={naming} onCancel={() => { setNaming(false); setDrawn(null); }} onSubmit={submitRun} />

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
// widens back into the labeled pill under the mouse or keyboard focus.
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
        {/* the same X icon as every other close button */}
        <Box component="button" type="button" onClick={onEnd} aria-label="Close the guide"
          title="Close the guide"
          sx={{
            width: 28, height: 28, mr: -0.75, p: 0, border: "none", borderRadius: 999,
            bgcolor: "transparent", cursor: "pointer", display: "flex", color: "#fff",
            alignItems: "center", justifyContent: "center",
            "&:hover": { bgcolor: "rgba(255,255,255,0.15)" },
          }}>
          <CloseIcon aria-hidden="true" sx={{ fontSize: 18 }} />
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

// The legend on the map, under Basemap and in the same style. Folded, it is
// a white pill with a layers icon, "Legend" and a down chevron (just the
// icon on a phone). Open, the same box grows into a card: the pill becomes
// its header, with the chevron pointing up, and the legend sits right under
// it, scrolling when the map is short. The user asked for it on the map,
// open to start, attached to its button and shrinking when folded.
function MapLegend({ open, lit, onToggle, children }: {
  open: boolean; lit: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  const Chevron = open ? KeyboardArrowUpIcon : KeyboardArrowDownIcon;
  const shadow = "0 2px 6px rgba(0,20,45,0.25)";
  return (
    <Box data-guide="legend" sx={{
      position: "absolute", top: 58, left: 10, zIndex: 3, bgcolor: "#fff",
      borderRadius: open ? "14px" : "20px", boxShadow: shadow,
      width: open ? 300 : "auto", maxWidth: "calc(100% - 20px)",
      maxHeight: "calc(100% - 58px - 100px)", display: "flex", flexDirection: "column",
      overflow: "hidden", boxSizing: "border-box",
      ...(lit && {
        boxShadow: `0 0 0 3px ${BULLDOG_BLUE}`,
        animation: "guidePulse 1.8s ease-in-out infinite",
        "@keyframes guidePulse": {
          "0%, 100%": { boxShadow: `0 0 0 3px ${BULLDOG_BLUE}, 0 0 0 3px rgba(0,61,165,0.25)` },
          "50%": { boxShadow: `0 0 0 3px ${BULLDOG_BLUE}, 0 0 0 10px rgba(0,61,165,0.12)` },
        },
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }),
    }}>
      <Tooltip title={open ? "Fold the legend away" : "Show the legend"} placement="right">
        <ButtonBase aria-label={open ? "Fold the legend away" : "Show the legend"}
          aria-expanded={open} aria-controls="map-legend" onClick={onToggle}
          sx={{
            flexShrink: 0, justifyContent: "flex-start", gap: 0.75, height: 40, minWidth: 40,
            px: { xs: 0, md: 1.5 }, pr: { md: 1 }, color: NIGHT_SKY, fontSize: 14, fontWeight: 700,
            borderRadius: "inherit", width: open ? "100%" : "auto",
            borderBottom: open ? "1px solid #e6e8eb" : "none",
            borderBottomLeftRadius: open ? 0 : undefined, borderBottomRightRadius: open ? 0 : undefined,
            "&:hover": { bgcolor: "#eef2f7" },
            "&.Mui-focusVisible": { outline: `2px solid ${BULLDOG_BLUE}`, outlineOffset: -2 },
          }}>
          <LayersIcon fontSize="small" sx={{ ml: { xs: "10px", md: 0 } }} />
          <Box component="span" aria-hidden="true" sx={{ display: { xs: open ? "inline" : "none", md: "inline" } }}>
            Legend
          </Box>
          <Chevron fontSize="small" sx={{ display: { xs: open ? "inline-block" : "none", md: "inline-block" },
            ml: open ? "auto" : -0.25 }} />
        </ButtonBase>
      </Tooltip>
      {open && (
        <Box id="map-legend" role="region" aria-label="Legend"
          sx={{ overflowY: "auto", px: 1.75, pt: 1.25, pb: 1.5 }}>
          {children}
        </Box>
      )}
    </Box>
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
// color the map draws it, and its name.
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

const cardTitleId = (guide: PanelTarget) => `card-title-${guide}`;

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
      {/* its id names the picker in the card for screen readers (cardTitleId) */}
      {title && <Typography variant="subtitle2" gutterBottom id={guide ? cardTitleId(guide) : undefined}>{title}</Typography>}
      {children}
    </Box>
  );
}

// One big number with what it counts under it, and any smaller lines beside
// it: the landslide viewer's stat card, a little smaller to keep the map clear.
function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string[] }) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="flex-end"
      sx={{ border: "1px solid #ddd", borderRadius: 1.5, px: 1.25, py: 0.75, bgcolor: "#fff", flex: "1 1 auto" }}>
      <Box>
        <Typography sx={{ fontSize: 28, lineHeight: 1, fontWeight: 800, color: NIGHT_SKY }}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.3, mt: 0.25 }}>
          {label}
        </Typography>
      </Box>
      {sub && sub.length > 0 && (
        <Box sx={{ pb: 2.25 }}>
          {sub.map((line) => (
            <Typography key={line} variant="caption" color="text.secondary"
              sx={{ display: "block", lineHeight: 1.35 }}>{line}</Typography>
          ))}
        </Box>
      )}
    </Stack>
  );
}

// Metres as whole feet, written with thousands separators.
const feet = (m: number) => Math.round(m * 3.28084).toLocaleString();
