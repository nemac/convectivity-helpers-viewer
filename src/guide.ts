// The guide: one real road per tab, a few short plain-English steps about it,
// and then a walk through the controls in the panel.
//
// The words are written here but the numbers are not. Each road step is
// filled in from the road's own properties as the map reads them out of the
// tiles, so the guide cannot go stale when an analysis is re-run. If the road
// cannot be read, every step still makes sense without its numbers.
//
// The steps about the panel reuse the panel's own descriptions (the score
// help and the classification lines in config.ts), so the guide and the
// panel always say the same thing in the same words.
import {
  DETOUR_SCORES, METHODS, PINCH_MAX_DETOUR_M, PINCH_NO_ALTERNATIVE_M, STYLES, TabId,
  humanMiles, humanNumber, rankSentence, splitNames,
} from "./config";

export interface Example {
  id: string;
  tab: TabId;
  county: string;               // id in COUNTIES
  countyLabel: string;
  road: string;                 // road_name in the data, used to pick the segment
  lngLat: [number, number];     // the middle of the segment
  zoom: number;
}

// Chosen from the analysis outputs: on the detour tab, the named road whose
// closure adds the most driving in each county; on the pinch tab, the
// strongest named pinch point inside each county. Coordinates are segment
// midpoints. If a re-run moves a segment, the guide falls back to its wording
// without numbers rather than describing the wrong road.
//
// Only the first road on each tab is opened today, by a first visit and by
// the round "Start the guide" button. The others are kept so a guide per
// county can come back without picking roads again.
export const EXAMPLES: Example[] = [
  { id: "detour-haywood", tab: "detour", county: "haywood", countyLabel: "Haywood",
    road: "Soco Road", lngLat: [-83.08013, 35.51339], zoom: 13 },
  { id: "detour-mecklenburg", tab: "detour", county: "mecklenburg", countyLabel: "Mecklenburg",
    road: "Providence Road", lngLat: [-80.82139, 35.18589], zoom: 13 },
  { id: "detour-new_hanover", tab: "detour", county: "new_hanover", countyLabel: "New Hanover",
    road: "Market Street", lngLat: [-77.85188, 34.25243], zoom: 13 },
  { id: "pinch-haywood", tab: "pinch", county: "haywood", countyLabel: "Haywood",
    road: "Asheville Highway", lngLat: [-82.82363, 35.53446], zoom: 13 },
  { id: "pinch-mecklenburg", tab: "pinch", county: "mecklenburg", countyLabel: "Mecklenburg",
    road: "Monroe Road", lngLat: [-80.78873, 35.19513], zoom: 13 },
  { id: "pinch-new_hanover", tab: "pinch", county: "new_hanover", countyLabel: "New Hanover",
    road: "Carolina Beach Road", lngLat: [-77.92905, 34.18226], zoom: 13 },
];

// What a first visit with no link opens on.
export const OPENING_EXAMPLE = EXAMPLES[0];

// What the round "Start the guide" button opens: the first example on the tab
// being looked at.
export const firstExample = (tab: TabId): Example => EXAMPLES.find((e) => e.tab === tab)!;

// Shown once, the first time someone clicks the map while the guide is open,
// along with the next step. The second click lets them go. When that next
// step is one of the panel steps, a click on the map no longer closes the
// guide (trying things is the point there), so it says to use the X instead.
export const nudge = (next: GuideStep["place"]) =>
  "Not so fast! We'd really like to help you find your way around this map, so here's the "
  + (next === "road"
    ? "next part. Click the map again whenever you'd rather explore on your own."
    : "next part. Close this box with the X at its top whenever you'd rather explore on your own.");

// The parts of the panel a step can point at. Each one is the `guide` name of
// a card in App.tsx.
export type PanelTarget = "county" | "score" | "shows" | "classes" | "legend" | "map" | "methodology";

export interface GuideStep {
  title: string;
  lines: string[];              // each one a whole sentence or two
  // A short list under the lines: a name in bold and what it means.
  items?: { label: string; text: string }[];
  // "road": in the popup on the example road. "panel": in a card on the left
  // edge of the map, pointing at `target` in the panel (or at nothing, for the
  // last step).
  place: "road" | "panel";
  target?: PanelTarget;
}

// How a class is drawn, in the words someone would use looking at the map.
function drawnAs(cls: number): string {
  if (cls >= 8) return "thick and orange";
  if (cls >= 6) return "medium and red";
  if (cls >= 3) return "thin and purple or pink";
  return "thin and blue";
}

// A total of seconds as a rounded figure a person would say out loud.
function roughly(seconds: number): string {
  const round3 = (n: number) => Number(n.toPrecision(3)).toLocaleString();
  if (seconds < 5400) return `about ${round3(Math.max(1, seconds / 60))} minutes`;
  return `about ${round3(seconds / 3600)} hours`;
}

// The swatch colour for the example road, so the guide can show the colour it
// is talking about.
export function classColor(classField: string, props: Record<string, any> | null): string | null {
  const cls = Number(props?.[classField]);
  return STYLES[classField]?.classes.find((c) => c.value === cls)?.color ?? null;
}

// The walk through the panel, the same on both tabs apart from the two
// controls only the detour tab has.
function panelSteps(tab: TabId): GuideStep[] {
  // In the order the cards sit in the panel, top to bottom.
  const steps: GuideStep[] = [];
  if (tab === "detour") {
    steps.push({ place: "panel", target: "shows", title: "What the map shows", lines: [
      "The panel on the left holds the controls. This box at the top names the question "
        + "the colours are answering right now, and says what it means in a sentence or two.",
      "It changes whenever you pick something else from \"Choose what the map shows\" below it.",
    ] });
    steps.push({ place: "panel", target: "county", title: "Pick a county", lines: [
      "\"Choose a county\" switches between Haywood, Mecklenburg and New Hanover counties.",
      "Pick one and the map moves there. Go ahead and try it. This guide will wait.",
    ] });
    steps.push({ place: "panel", target: "score", title: "Choose what the map shows", lines: [
      "This list changes the question the colours on the map answer. There are four to "
        + "choose from.",
    ], items: DETOUR_SCORES.map((s) => ({ label: s.label, text: s.help })) });
  } else {
    steps.push({ place: "panel", target: "shows", title: "What the map shows", lines: [
      "The panel on the left holds the controls. This box at the top names what the colours "
        + "on the map measure, and says what it means in a sentence or two.",
      "On this tab there is one measure, the pinch score, so there is nothing to choose here.",
    ] });
  }
  steps.push({ place: "panel", target: "classes", title: "How roads are sorted into colours", lines: [
    "Every road gets a rank from 1 to 10. These three choices change where the line falls "
      + "between one rank and the next. If you are not sure, leave it on Geometric.",
  ], items: METHODS.map((m) => ({ label: m.label, text: m.short })) });
  steps.push({ place: "panel", target: "legend", title: "Hide the lower ranks", lines: [
    "The colour key shows which colour goes with each rank, with 10 at the top.",
    "Drag the slider under it to the right to hide the lower ranks. Only the most "
      + "important roads stay on the map.",
  ] });
  steps.push({ place: "panel", target: "map", title: "Change the background", lines: [
    "Under \"Map\", pick a different background. Esri imagery, for example, shows aerial photos.",
    "Drag \"Road opacity\" to the left to let more of the background show through the roads.",
  ] });
  steps.push({ place: "panel", target: "methodology", title: "Want the details?", lines: [
    "The link under \"Methodology\" opens a write-up of how these numbers were worked out. "
      + "It is written for readers who want the technical details.",
  ] });
  steps.push({ place: "panel", title: "Now try it yourself", lines: [
    "Move your mouse over any road to see its numbers. Click a road to keep them on the screen.",
    tab === "detour"
      ? "The button with four arrows on the map zooms out to show the whole county."
      : "Zoom out to see how the pinch points line up across the state. The button with "
        + "four arrows on the map shows the whole state.",
    "To see this guide again later, click \"Start the guide\" at the bottom of the map.",
  ] });
  return steps;
}

export function guideSteps(ex: Example, props: Record<string, any> | null,
                           classField: string): GuideStep[] {
  const name = props ? splitNames(props.road_name).primary : ex.road;
  const cls = props ? Number(props[classField]) : NaN;
  const hasClass = isFinite(cls) && cls >= 1 && cls <= 10;
  const startHere = `Let's start with one real road: ${name} in ${ex.countyLabel} County, `
    + "the road with the glow around it.";

  if (ex.tab === "detour") {
    const numbers: string[] = [];
    const affected = Number(props?.combined_affected_od ?? 0);
    const extra = Number(props?.combined_extra_sec ?? 0);
    const cutOff = Number(props?.combined_disconnected_od ?? 0);
    if (affected > 0) {
      numbers.push(`If this road closed, ${humanNumber(affected)} trips would have to go another way.`);
    }
    if (extra > 0) {
      numbers.push(`Added together, those trips would take ${roughly(extra)} longer.`);
    }
    if (cutOff > 0) {
      numbers.push(`${humanNumber(cutOff)} of those trips would have no way through at all.`);
    }
    const rank = rankSentence(`${ex.county}:combined_extra_sec`, extra, {
      more: "Closing it adds more driving", most: "Closing it adds the most driving",
      scope: "in this county",
    });
    if (rank) numbers.push(`${rank}.`);
    if (numbers.length === 0) {
      numbers.push("Click a road once this guide is closed to see how many trips would have "
        + "to go another way, and how much longer they would take.");
    }
    numbers.push("A trip is one starting point going to one of those four kinds of place. "
      + "Click this road once this guide is closed to see all of its numbers.");

    return [
      { place: "road", title: "What this map can help with", lines: [
        "This map shows what happens when one road closes, and how much harder it becomes "
          + "to reach a fire station, a medical facility, a school, or a grocery or "
          + "convenience store.",
        "It can help you find the roads people depend on most, and see where one closure, "
          + "from a crash, a flood or road work, would cause the most trouble.",
        startHere,
      ] },
      { place: "road", title: "What the colour and thickness mean", lines: [
        hasClass
          ? `This road is drawn ${drawnAs(cls)}. It ranks ${cls} out of 10, and 10 is the worst road to lose.`
          : "Every road is ranked from 1 to 10, and 10 is the worst road to lose.",
        "Thick orange roads cause the most extra driving when they close. "
          + "Thin blue roads cause very little.",
      ] },
      { place: "road", title: "What the numbers say", lines: numbers },
      ...panelSteps("detour"),
    ];
  }

  const ingredients: string[] = [
    "A road is a pinch point when two things are both true. Many journeys use it, "
      + "and there is no easy way around it.",
  ];
  const busy = rankSentence("centrality_norm", Number(props?.centrality_norm ?? 0), {
    more: "This road carries more journeys", most: "This road carries the most journeys",
    scope: "in the state",
  });
  if (busy) ingredients.push(`${busy}.`);
  const around = props?.detour_len_m != null ? Number(props.detour_len_m) : null;
  if (around != null) {
    ingredients.push(around >= PINCH_NO_ALTERNATIVE_M
      ? `No other way around it was found within ${humanMiles(PINCH_MAX_DETOUR_M)}.`
      : `The shortest way around it is ${humanMiles(around)} farther.`);
  }
  ingredients.push("A journey means going from one building to another by the quickest "
    + "route. These are estimates based on where buildings are, not traffic counts.");

  return [
    { place: "road", title: "What this map can help with", lines: [
      "This map covers every road in North Carolina. It shows which roads would hurt the "
        + "most to lose.",
      "It can help you find pinch points: busy roads with no easy way around, where one "
        + "closure would cause the most trouble.",
      startHere,
    ] },
    { place: "road", title: "Two things make a pinch point", lines: ingredients },
    { place: "road", title: "What the colour and thickness mean", lines: [
      hasClass
        ? `This road is drawn ${drawnAs(cls)}. It ranks ${cls} out of 10, and 10 is the strongest pinch point.`
        : "Every road is ranked from 1 to 10, and 10 is the strongest pinch point.",
      "A busy road with an easy way around ranks low. So does a quiet road, even one "
        + "with no way around.",
      "Dead-end streets always rank lowest, because closing one only affects the homes "
        + "and businesses along it.",
    ] },
    ...panelSteps("pinch"),
  ];
}
