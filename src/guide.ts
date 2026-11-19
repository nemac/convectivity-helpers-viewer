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
  CUT_OFF_CLASS, DETOUR_SCORES, ISOLATION_CUTOFFS, HAZARDS, HAZARD_WORDS, Hazard, METHODS, PINCH_MAX_DETOUR_M,
  PINCH_NO_ALTERNATIVE_M, STYLES, TabId, hazardsIn, humanMiles, humanNumber, humanPercent, milesInWords,
  sharePct,
  rankSentence, splitNames,
} from "./config";

export interface Example {
  id: string;
  tab: TabId;
  county: string;               // id in COUNTIES
  countyLabel: string;
  hazard?: string;              // on the functional isolation tab, the hazard's id
  road: string;                 // road_name in the data, used to pick the segment
  lngLat: [number, number];     // the middle of the segment
  zoom: number;
}

// Chosen from the analysis outputs. On the functional isolation tab, one per
// hazard: the named road outside the hazard that loses the largest share of
// what it could reach within 15 minutes, among roads that could reach at
// least 500 buildings before, so a tiny count cannot top the list. On the
// detour tab, the named road whose closure adds the most driving in each
// county; on the pinch tab, the strongest named pinch point inside each
// county. Coordinates are segment midpoints. If a re-run moves a segment, the
// guide falls back to its wording without numbers rather than describing the
// wrong road.
//
// A first visit opens the first road in this list. The round "Start the
// guide" button opens the road for the hazard being looked at on the
// functional isolation tab, and the first road of the tab on the other two.
// The other detour and pinch roads are kept so a guide per county can come
// back without picking roads again.
export const EXAMPLES: Example[] = [
  { id: "isolation-flood_canton1", tab: "isolation", county: "haywood", countyLabel: "Haywood",
    hazard: "flood_canton1", road: "Penland Street", lngLat: [-82.84237, 35.53013], zoom: 14 },
  { id: "isolation-df_cruso_276_big", tab: "isolation", county: "haywood", countyLabel: "Haywood",
    hazard: "df_cruso_276_big", road: "Johnny Baxter Loop", lngLat: [-82.81217, 35.41413], zoom: 14 },
  // The only example road that does not touch its hazard, which is several
  // miles off in the gorge. Zoomed out further so both are on screen.
  { id: "isolation-df_i40_gorge_poly", tab: "isolation", county: "haywood", countyLabel: "Haywood",
    hazard: "df_i40_gorge_poly", road: "Cold Springs Creek Road", lngLat: [-83.02382, 35.73728], zoom: 12.5 },
  { id: "isolation-little_sugar_creek1", tab: "isolation", county: "mecklenburg", countyLabel: "Mecklenburg",
    hazard: "little_sugar_creek1", road: "Archdale Drive", lngLat: [-80.85931, 35.1477], zoom: 14 },
  { id: "isolation-mallard_doby_creek1", tab: "isolation", county: "mecklenburg", countyLabel: "Mecklenburg",
    hazard: "mallard_doby_creek1", road: "US Hwy 29 Service (Frontage) Road",
    lngLat: [-80.72769, 35.32799], zoom: 14 },
  { id: "isolation-mcmullen_creek1", tab: "isolation", county: "mecklenburg", countyLabel: "Mecklenburg",
    hazard: "mcmullen_creek1", road: "Robinhood Road", lngLat: [-80.78324, 35.17022], zoom: 14 },
  { id: "isolation-burntmillcreek1", tab: "isolation", county: "new_hanover", countyLabel: "New Hanover",
    hazard: "burntmillcreek1", road: "One Tree Hill Way", lngLat: [-77.92781, 34.25536], zoom: 14 },
  { id: "isolation-northchase1", tab: "isolation", county: "new_hanover", countyLabel: "New Hanover",
    hazard: "northchase1", road: "Olsen Park Lane", lngLat: [-77.86558, 34.29782], zoom: 14 },
  { id: "isolation-pagescreek1", tab: "isolation", county: "new_hanover", countyLabel: "New Hanover",
    hazard: "pagescreek1", road: "Upland Drive", lngLat: [-77.80002, 34.2804], zoom: 14 },
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

// What a first visit with no link opens on: the flooding in Canton. The
// examples were re-picked from the 2026-11-17 runs (30 miles, 5 to 30
// minutes, the junction fix); Canton's moved from Main Street to Penland
// Street, one of the side streets the old split had cut off.
export const OPENING_EXAMPLE = EXAMPLES[0];

// What the round "Start the guide" button opens: on the functional isolation
// tab, the example for the hazard being looked at; elsewhere, the first
// example on the tab.
export const firstExample = (tab: TabId, hazard?: string): Example =>
  (tab === "isolation" && EXAMPLES.find((e) => e.hazard === hazard))
  || EXAMPLES.find((e) => e.tab === tab)!;

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// A hazard's county as it is written, from the example roads that name it.
const countyName = (h: Hazard) => EXAMPLES.find((e) => e.county === h.county)?.countyLabel ?? h.county;
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const plural = (n: number, one: string, many: string) => `${humanNumber(n)} ${n === 1 ? one : many}`;

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
export type PanelTarget =
  "county" | "hazard" | "score" | "services" | "shows" | "classes" | "legend" | "methodology";

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
  // The step about the hazard: the map lights it up and moves the guide aside.
  showsHazard?: boolean;
}

// How a class is drawn, in the words someone would use looking at the map.
function drawnAs(cls: number): string {
  if (cls === CUT_OFF_CLASS) return "thickest of all and dark red";
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

// The walk through the panel, the same on every tab apart from the pickers
// each tab has.
function panelSteps(tab: TabId, hazard?: Hazard): GuideStep[] {
  // In the order the cards sit in the panel, top to bottom.
  const steps: GuideStep[] = [];
  if (tab === "isolation") {
    steps.push({ place: "panel", target: "shows", title: "What the map shows", lines: [
      "The panel on the left holds the controls. This box at the top names what the colours "
        + "on the map measure right now, and says what it means in a sentence or two.",
      "It changes when you move the slider under \"Choose a drive time\" below it.",
    ] });
    steps.push({ place: "panel", target: "county", title: "Pick a county", lines: [
      "\"Choose a county\" switches between Haywood, Mecklenburg and New Hanover counties. "
        + "Each one has its own hazards.",
    ] });
    const others = hazard ? hazardsIn(hazard.county).map((h) => lowerFirst(h.label)) : [];
    steps.push({ place: "panel", target: "hazard", title: "Pick a hazard", lines: [
      "\"Choose a hazard\" lists the floods and landslides worked out for the county. Pick one "
        + "and the map moves to it. Go ahead and try it. This guide will wait.",
      ...(hazard && others.length > 1
        ? [`In ${countyName(hazard)} County they are ${others.slice(0, -1).join(", ")} and ${others[others.length - 1]}.`]
        : []),
    ] });
    steps.push({ place: "panel", target: "score", title: "Choose a drive time", lines: [
      "This slider sets how long a drive counts: 5, 10, 15 or 30 minutes.",
      "5 minutes shows what is out of reach close to home. 30 minutes shows what is out of "
        + "reach across the wider area. A road near the hazard can lose little close by and a "
        + "lot farther out, or the reverse, so it is worth trying each.",
    ] });
  } else if (tab === "detour") {
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
    steps.push({ place: "panel", target: "services", title: "The places trips go to", lines: [
      "The icons on the map are the fire stations, medical facilities, schools, and grocery and "
        + "convenience stores the trips are counted to.",
      "They are listed at the top of the legend on the map. Untick one to hide it, and tick it "
        + "again to bring it back. All four start shown.",
    ] });
  } else {
    steps.push({ place: "panel", target: "shows", title: "What the map shows", lines: [
      "The panel on the left holds the controls. This box at the top names what the colours "
        + "on the map measure, and says what it means in a sentence or two.",
      "On this tab there is one measure, the pinch score, so there is nothing to choose here.",
    ] });
  }
  steps.push({ place: "panel", target: "classes", title: "How roads are sorted into colours", lines: [
    "Every road gets a rank from 1 to 10. These three choices change where the line falls "
      + "between one rank and the next. If you are not sure, leave it on Log base 10.",
  ], items: METHODS.map((m) => ({ label: m.label, text: m.short })) });
  steps.push({ place: "panel", target: "legend", title: "Hide the lower ranks", lines: [
    "The legend sits on the map, under the Basemap button. Click \"Legend\" to fold it away "
      + "and again to bring it back.",
    "The colour key shows which colour goes with each rank, with 10 at the top.",
    "Slide the handle beside it up to hide the lower ranks. Only the most important "
      + "roads stay on the map.",
    ...(tab === "isolation"
      ? ["Dark red, for roads cut off completely or closed, sits at the top of the key above 10. "
          + "It is not a rank, so it always stays on the map.",
         "Under the key, \"Buildings, from Overture Maps\" has a checkbox for each kind. \"Cut off\" "
          + `and "${upperFirst(HAZARD_WORDS[hazard?.kind ?? "flood"].inside)}" show the buildings this `
          + "hazard cuts off and the ones inside it, and start on. \"All buildings\" shows every "
          + "building on Overture's map, for a sense of who lives and works along a road, and starts off."]
      : ["Tick \"All buildings\" under the colour key to show every building from Overture's map, "
          + "for a sense of who lives and works along a road."]),
  ] });
  steps.push({ place: "panel", target: "methodology", title: "Want the details?", lines: [
    "The link under \"Methodology\" opens a write-up of how these numbers were worked out. "
      + "It is written for readers who want the technical details.",
  ] });
  steps.push({ place: "panel", title: "Now try it yourself", lines: [
    "Move your mouse over any road to see its numbers. Click a road to keep them on the screen.",
    "The map starts on a dark gray background. The \"Basemap\" button with the globe, at the "
      + "top left of the map, picks another one. Esri imagery, for example, shows aerial photos.",
    ...(tab === "isolation"
      ? [
          "Move your mouse over the hatched area to see what the hazard is and what it cuts off. "
            + "While the mouse is there, every road and building it cuts off or closes lights up "
            + "in yellow. Click the hatched area to keep it lit.",
          `The button with four arrows on the map zooms out to everything within ${hazard?.bufferMiles ?? 30} `
            + "miles of the hazard, which is the area this run covers. The shaded part of the map "
            + "beyond it was not part of the run.",
        ]
      : tab === "detour"
        ? ["The button with four arrows on the map zooms out to show the whole county."]
        : ["Zoom out to see how the pinch points line up across the state. The button with "
            + "four arrows on the map shows the whole state."]),
    "The tabs at the top of the page switch between Functional isolation, Pinch points & alternate routing and "
      + "Access to services.",
    "To see this guide again later, click \"Start the guide\" at the bottom of the map. After a "
      + "few seconds it shrinks to the question mark at the bottom left.",
  ] });
  return steps;
}

// The road steps on the functional isolation tab: what the map is for, the
// hazard itself, the colours, and this road's numbers, each read from the
// road's tile properties when it has them.
function isolationSteps(hazard: Hazard | undefined, props: Record<string, any> | null,
                        classField: string, name: string, startHere: string): GuideStep[] {
  const w = HAZARD_WORDS[hazard?.kind ?? "flood"];
  const what = hazard ? `the ${lowerFirst(hazard.label)}` : w.event;
  const cls = props ? Number(props[classField]) : NaN;
  const minutes = Number(/loss_(\d+)m/.exec(classField)?.[1] ?? 15);
  const loss = props ? Number(props[`loss_${minutes}m`]) : NaN;

  const hazardLines = [
    `The hatched shape on the map is ${w.area}.`,
    ...(hazard ? [hazard.about[0]] : []),
    "Every road inside it is treated as closed, bridges included, and drawn in dark red.",
  ];
  const dist = props?.dist_to_hazard_m != null ? Number(props.dist_to_hazard_m) : null;
  if (dist != null) {
    hazardLines.push(dist <= 30 ? `${name} runs right up to ${w.area}.`
      : `${name} is about ${milesInWords(dist)} from ${w.area}.`);
  }
  if (hazard) {
    hazardLines.push(hazard.isolatedRoads > 0
      ? `${upperFirst(w.event)} cuts off ${plural(hazard.isolatedRoads, "road", "roads")} completely, with `
        + `${plural(hazard.isolatedBuildings, "building", "buildings")} `
        + `${hazard.isolatedRoads === 1 ? "on it" : "on them"}. No road leads out from there at all.`
      : `${upperFirst(w.event)} does not cut any road off completely. Every road outside it still `
        + "has some way out.");
    if (hazard.hazardBuildings > 0 || hazard.isolatedBuildings > 0) {
      hazardLines.push("The buildings drawn solid dark red are the ones cut off. The teal ones are "
        + `${w.inside} or on its closed roads.`);
    }
    hazardLines.push(...hazard.about.slice(1));
  }

  const colourLines = [
    cls === CUT_OFF_CLASS
      ? `This road is drawn ${drawnAs(cls)}, because it is `
        + (props && (props.is_blocked === true || props.is_blocked === 1)
          ? `${w.inside} and closed.` : "cut off completely.")
      : isFinite(cls) && cls >= 1 && cls <= 10
        ? `This road is drawn ${drawnAs(cls)}. It ranks ${cls} out of 10`
          + (isFinite(loss) ? `: from here, ${sharePct(loss)} of the places within a ${minutes} `
            + "minute drive are out of reach." : ", and 10 is the biggest loss.")
        : "Every road is ranked from 1 to 10, and 10 is the biggest loss.",
    "Thick orange roads have lost the most of the places within a short drive. Thin blue "
      + "roads have lost little or nothing. The colour key beside the map gives the share "
      + "each rank stands for.",
    `Dark red, the thickest line of all, marks the roads ${w.inside}, which are closed, and `
      + `any road beyond it cut off completely: with ${w.closed} closed, no road leads out from `
      + "it at any drive time.",
  ];
  if (hazard && hazard.isolatedRoads === 0) {
    colourLines.push(`${upperFirst(w.event)} cuts off no road completely, so the only dark red on this `
      + `map is the closed roads ${w.inside}.`);
  }

  const numbers: string[] = [];
  if (props && (props.is_isolated === true || props.is_isolated === 1)) {
    numbers.push(`Cut off completely. With ${w.closed} closed, there is no road out from here.`);
  }
  for (const c of [minutes, ...ISOLATION_CUTOFFS.filter((c) => c !== minutes)]) {
    const before = Number(props?.[`bld_${c}m_baseline`]);
    const lost = Number(props?.[`lost_${c}m`]);
    if (!isFinite(before) || !isFinite(lost) || before <= 0) continue;
    if (c === minutes) {
      numbers.push(lost > 0
        ? `For someone on ${name}, about ${humanPercent(lost / before)} of the homes, shops, schools `
          + `and other buildings they could drive to within ${c} minutes are now out of reach: `
          + `${plural(before, "building", "buildings")} before ${w.event}, ${humanNumber(before - lost)} `
          + `with ${w.closed} closed.`
        : `Within ${c} minutes of here you can reach ${plural(before, "building", "buildings")}, `
          + `and ${w.event} does not change that.`);
    } else {
      numbers.push(lost > 0
        ? `Within ${c} minutes you lose ${humanNumber(lost)} of ${plural(before, "building", "buildings")}, `
          + `about ${humanPercent(lost / before)}.`
        : `Within ${c} minutes you lose none of ${plural(before, "building", "buildings")}.`);
    }
  }
  if (numbers.length === 0) {
    numbers.push("Click a road once this guide is closed to see how many buildings it could "
      + "reach before and after.");
  }
  numbers.push("A building means any building: homes, businesses, schools and every other "
    + "kind, each counted once. Click this road once this guide is closed to see all of its numbers.");

  return [
    { place: "road", title: "What this map can help with", lines: [
      `This map shows what ${what} does to the roads around it. For someone on a road `
        + "nearby, it shows the share of the homes, shops, schools and other buildings they "
        + "could drive to within a few minutes that they can no longer get to once the roads "
        + "it covers are closed.",
      "It can help you find the places that lose touch with everything around them, and the "
        + "ones cut off completely, so you can see where help would be needed and which roads "
        + "matter most to keep open.",
      startHere,
    ] },
    { place: "road", title: upperFirst(w.area), lines: hazardLines, showsHazard: true },
    { place: "road", title: "What the colour and thickness mean", lines: colourLines },
    { place: "road", title: "What the numbers say", lines: numbers },
  ];
}

export function guideSteps(ex: Example, props: Record<string, any> | null,
                           classField: string): GuideStep[] {
  const name = props ? splitNames(props.road_name).primary : ex.road;
  const cls = props ? Number(props[classField]) : NaN;
  const hasClass = isFinite(cls) && cls >= 1 && cls <= 10;
  const startHere = `Let's start with one real road: ${name} in ${ex.countyLabel} County, `
    + "the road with the glow around it.";

  if (ex.tab === "isolation") {
    const hazard = HAZARDS.find((h) => h.id === ex.hazard);
    return [
      ...isolationSteps(hazard, props, classField, name, startHere),
      ...panelSteps("isolation", hazard),
    ];
  }

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
        "Access to services shows what happens when one road closes, and how much harder it becomes "
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
