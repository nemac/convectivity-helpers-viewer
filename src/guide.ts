// The guided examples: one real road per county on each tab, and the short
// plain-English walkthrough shown beside it.
//
// The words are written here but the numbers are not. Each step is filled in
// from the road's own properties as the map reads them out of the tiles, so
// the walkthrough always agrees with the popup next to it and cannot go stale
// when an analysis is re-run. If the road cannot be read, every step still
// makes sense without its numbers.
import {
  PINCH_MAX_DETOUR_M, PINCH_NO_ALTERNATIVE_M, STYLES, TabId,
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
// midpoints. If a re-run moves a segment, the walkthrough falls back to its
// wording without numbers rather than describing the wrong road.
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

export interface GuideStep {
  title: string;
  lines: string[];              // each one a whole sentence or two
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

const TRY_IT = [
  "Move your mouse over any road to see its numbers. Click a road to keep them on the screen.",
];

// The swatch colour for the example road, so the walkthrough can show the
// colour it is talking about.
export function classColor(classField: string, props: Record<string, any> | null): string | null {
  const cls = Number(props?.[classField]);
  return STYLES[classField]?.classes.find((c) => c.value === cls)?.color ?? null;
}

export function guideSteps(ex: Example, props: Record<string, any> | null,
                           classField: string): GuideStep[] {
  const name = props ? splitNames(props.road_name).primary : ex.road;
  const cls = props ? Number(props[classField]) : NaN;
  const hasClass = isFinite(cls) && cls >= 1 && cls <= 10;
  const where = `This is ${name} in ${ex.countyLabel} County. It is the road with the glow around it on the map.`;

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
      numbers.push("The box on the map lists how many trips would have to go another way, "
        + "and how much longer they would take.");
    }
    numbers.push("A trip is one starting point going to one of those four kinds of place. "
      + "The box on the map shows these same numbers.");

    return [
      { title: "Start with one road", lines: [
        where,
        "For every road, this tab asks one question. If this road closed, how much harder "
          + "would it be to reach a fire station, a medical facility, a school, or a grocery "
          + "or convenience store?",
      ] },
      { title: "What the colour and thickness mean", lines: [
        hasClass
          ? `This road is drawn ${drawnAs(cls)}. It ranks ${cls} out of 10, and 10 is the worst road to lose.`
          : "Every road is ranked from 1 to 10, and 10 is the worst road to lose.",
        "Thick orange roads cause the most extra driving when they close. "
          + "Thin blue roads cause very little.",
      ] },
      { title: "What the numbers say", lines: numbers },
      { title: "Now try it yourself", lines: [
        ...TRY_IT,
        "Use the County box to look at another county, and the Score box to ask a different question.",
        "The button with four arrows on the map zooms out to show the whole county.",
      ] },
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
    { title: "Start with one road", lines: [
      where,
      "This tab covers every road in North Carolina. It asks which roads would hurt the "
        + "most to lose.",
    ] },
    { title: "Two things make a pinch point", lines: ingredients },
    { title: "What the colour and thickness mean", lines: [
      hasClass
        ? `This road is drawn ${drawnAs(cls)}. It ranks ${cls} out of 10, and 10 is the strongest pinch point.`
        : "Every road is ranked from 1 to 10, and 10 is the strongest pinch point.",
      "A busy road with an easy way around ranks low. So does a quiet road, even one "
        + "with no way around.",
      "Dead-end streets always rank lowest, because closing one only affects the homes "
        + "and businesses along it.",
    ] },
    { title: "Now try it yourself", lines: [
      ...TRY_IT,
      "Zoom out to see how the pinch points line up across the state. The button with "
        + "four arrows on the map shows the whole state.",
    ] },
  ];
}
