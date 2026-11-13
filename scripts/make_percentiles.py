"""
Write src/percentiles.json: a lookup that turns a raw score into "busier than
N% of roads".

Why this exists. The viewer used to show these scores as a share of the highest
value in the layer, and that reading is useless here. Measured across the
statewide pinch layer, the median road sits at 0.0000% of the maximum, and even
the median road in the top class reaches only 4.4%, because a single extreme
road sets the denominator. Every popup therefore read "under 0.01%", including
on roads the map had just ranked 9 out of 10, which looks like a bug.

A percentile says something a reader can act on instead: not how this road
compares with the one worst road in the state, but how it compares with all the
others. The table below is 101 breakpoints per column, so the viewer can map a
value to a percentile with a binary search and no extra data loading.

Usage:  python3 scripts/make_percentiles.py
"""
import json
import os
import sqlite3

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "src", "percentiles.json")

# The GeoPackages live in the analysis repo, which is assumed to sit next to
# this one. Set ANALYSIS_REPO to point somewhere else.
ANALYSIS = os.environ.get("ANALYSIS_REPO",
                          os.path.join(REPO, os.pardir, "conectivity_helpers"))

# (key the viewer looks up, gpkg under output/, layer, column)
SOURCES = [
    ("centrality_norm", "north_carolina_pinch_points.gpkg",
     "north_carolina_pinch_points", "centrality_norm"),
    ("pinch_score", "north_carolina_pinch_points.gpkg",
     "north_carolina_pinch_points", "pinch_score"),
]

# Per county, because a detour score is only ever compared within its own run.
for _county in ("haywood", "mecklenburg", "new_hanover"):
    for _col in ("combined_extra_sec", "max_service_norm", "mean_service_norm"):
        SOURCES.append((f"{_county}:{_col}",
                        f"{_county}_detour_combined.gpkg",
                        f"{_county}_detour_combined", _col))

STEPS = 101   # p0 .. p100 inclusive


def breakpoints(path, layer, column):
    """101 evenly spaced quantiles of the non-null values, ascending.

    Zeros are kept. They are most of the distribution in these layers, and
    dropping them would make a road that genuinely beats nothing look average.
    """
    con = sqlite3.connect(f"file:{path}?immutable=1", uri=True)
    try:
        cur = con.cursor()
        cur.execute(f'SELECT "{column}" FROM "{layer}" WHERE "{column}" IS NOT NULL')
        values = sorted(r[0] for r in cur.fetchall())
    finally:
        con.close()
    if not values:
        return None
    n = len(values)
    return [values[round(i / (STEPS - 1) * (n - 1))] for i in range(STEPS)], n


out = {}
for key, gpkg, layer, column in SOURCES:
    path = os.path.join(ANALYSIS, "output", gpkg)
    if not os.path.exists(path):
        print(f"  skip {key}: {gpkg} not found")
        continue
    result = breakpoints(path, layer, column)
    if result is None:
        print(f"  skip {key}: no values")
        continue
    breaks, n = result
    out[key] = breaks
    print(f"  {key:<34} {n:>9,} rows   median {breaks[50]:.6g}   max {breaks[100]:.6g}")

with open(OUT, "w") as fh:
    json.dump(out, fh)
    fh.write("\n")
print(f"\nwrote {OUT} ({len(out)} columns, {os.path.getsize(OUT):,} bytes)")
