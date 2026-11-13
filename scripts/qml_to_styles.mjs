// Read the QGIS .qml styles in output/ and write src/styles.json for the viewer.
//
// The point is that the map and QGIS stay in step. The colours and widths are
// not retyped here: they are pulled out of the same files QGIS loads, so
// re-running make_pinch_qml.py and then this script is all it takes to move a
// change through to the browser.
//
// Usage:  node viewer/scripts/qml_to_styles.mjs

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..");

// The .qml files live beside the GeoPackages they style, in the analysis
// repo's output/. That repo is assumed to sit next to this one; set
// ANALYSIS_REPO to point somewhere else.
const ANALYSIS = process.env.ANALYSIS_REPO ?? join(REPO, "..", "conectivity_helpers");
const QML_DIR = join(ANALYSIS, "output");
const OUT = join(REPO, "src", "styles.json");

if (!existsSync(QML_DIR)) {
  console.error(`No such directory: ${QML_DIR}`);
  console.error("Set ANALYSIS_REPO to the conectivity_helpers checkout.");
  process.exit(1);
}

// One <category value="N" .../> plus the <symbol name="N"> it points at.
// QGIS writes the symbol's colour and width as Option rows inside the layer.
function parseQml(xml) {
  const categories = [...xml.matchAll(/<category\s+symbol="([^"]*)"\s+value="([^"]*)"\s+label="([^"]*)"/g)]
    .map(([, symbol, value, label]) => ({ symbol, value: Number(value), label }));

  const symbols = {};
  // Each <symbol name="N"> ... </symbol> block, non-greedy so blocks do not merge.
  for (const [, name, body] of xml.matchAll(/<symbol[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/symbol>/g)) {
    const color = body.match(/<Option name="line_color" type="QString" value="([^"]*)"/)?.[1];
    const width = body.match(/<Option name="line_width" type="QString" value="([^"]*)"/)?.[1];
    if (color && width) {
      // QGIS stores "r,g,b,a" with a 0-255 alpha; the map wants CSS.
      const [r, g, b] = color.split(",").map(Number);
      symbols[name] = { color: `rgb(${r}, ${g}, ${b})`, widthMm: Number(width) };
    }
  }

  const attr = xml.match(/<renderer-v2[^>]*attr="([^"]*)"/)?.[1] ?? null;
  const classes = categories
    .filter((c) => symbols[c.symbol])
    .sort((a, b) => a.value - b.value)
    .map((c) => ({ value: c.value, label: c.label, ...symbols[c.symbol] }));

  return { attr, classes };
}

const styles = {};
for (const file of readdirSync(QML_DIR).filter((f) => f.endsWith(".qml")).sort()) {
  const parsed = parseQml(readFileSync(join(QML_DIR, file), "utf8"));
  if (!parsed.attr || parsed.classes.length === 0) {
    console.warn(`  skipped ${file}: no categorized renderer found`);
    continue;
  }
  // Key by the attribute the renderer targets, not the filename. The three
  // detour counties share one set of column names, so one entry serves all of
  // them, and the viewer looks a style up by the field it is drawing.
  styles[parsed.attr] = { source: basename(file), classes: parsed.classes };
}

writeFileSync(OUT, JSON.stringify(styles, null, 2) + "\n");

const n = Object.keys(styles).length;
console.log(`wrote ${OUT}`);
console.log(`  ${n} field styles from ${readdirSync(QML_DIR).filter((f) => f.endsWith(".qml")).length} qml files`);
for (const [attr, s] of Object.entries(styles)) {
  const widths = [...new Set(s.classes.map((c) => c.widthMm))].join("/");
  console.log(`  ${attr.padEnd(36)} ${s.classes.length} classes, widths ${widths} mm`);
}
