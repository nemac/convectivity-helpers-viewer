"""
Write src/hazards.json: what the viewer needs to know about each functional
isolation hazard run before any of its tiles have loaded.

For each <county>_functional_isolation_<hazard>.gpkg in the analysis repo's
output/, this keeps:

  - the study area (30 miles around the hazard by default) as a ring of
    lon/lat points, so the map can shade
    everything outside it (the run has no roads there, which an empty map
    would otherwise pass off as roads that are fine);
  - the bounds of the study area and of the hazard, for "show it all" and for
    framing the hazard, and a point that lies inside the hazard, where the
    leader line of the hazard's note box ends;
  - the counts from the study_area layer, including how many roads and
    buildings the hazard cuts off completely;
  - how many roads lose any reach at each cutoff, so the viewer can tell when
    a cutoff has too few such roads for ten ranks to mean anything (the I-40
    landslide has 2 within 5 minutes);
  - for every cutoff and classification, the lowest and highest share lost
    within each rank 1 to 10, so the legend can say what a rank means
    ("62 to 100% of the places within a 15 minute drive out of reach")
    rather than only "10 (highest)".

The names a reader sees are not here. They are written in src/config.ts.

Needs ogr2ogr (GDAL), which scripts/build_tiles.sh needs too.

Usage:  python3 scripts/make_hazards.py
"""
import glob
import json
import os
import sqlite3
import subprocess

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "src", "hazards.json")

# The GeoPackages live in the analysis repo, which is assumed to sit next to
# this one. Set ANALYSIS_REPO to point somewhere else.
ANALYSIS = os.environ.get("ANALYSIS_REPO",
                          os.path.join(REPO, os.pardir, "conectivity_helpers"))
COUNTIES = ("haywood", "mecklenburg", "new_hanover")
CUTOFFS = (5, 10, 15, 30)
METHODS = ("geometric", "log10", "quantile")


def geojson(path, layer):
    """One layer as GeoJSON in EPSG:4326, through ogr2ogr."""
    out = subprocess.run(
        ["ogr2ogr", "-f", "GeoJSON", "/vsistdout/", path, layer,
         "-t_srs", "EPSG:4326", "-lco", "COORDINATE_PRECISION=5"],
        check=True, capture_output=True, text=True).stdout
    return json.loads(out)["features"]


def point_inside(path):
    """A point guaranteed to lie inside the hazard, in lon/lat. The middle of
    its bounds can fall outside a winding creek."""
    out = subprocess.run(
        ["ogr2ogr", "-f", "GeoJSON", "/vsistdout/", path, "-dialect", "sqlite",
         "-sql", "SELECT ST_PointOnSurface(ST_Union(geom)) AS geom FROM hazard",
         "-t_srs", "EPSG:4326", "-lco", "COORDINATE_PRECISION=5"],
        check=True, capture_output=True, text=True).stdout
    return json.loads(out)["features"][0]["geometry"]["coordinates"][:2]


def bounds(rings):
    xs = [p[0] for r in rings for p in r]
    ys = [p[1] for r in rings for p in r]
    return [round(min(xs), 4), round(min(ys), 4), round(max(xs), 4), round(max(ys), 4)]


def outer_rings(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"][0]]
    if geom["type"] == "MultiPolygon":
        return [poly[0] for poly in geom["coordinates"]]
    raise ValueError(f"unexpected geometry {geom['type']}")


out = {}
for path in sorted(glob.glob(os.path.join(ANALYSIS, "output", "*_functional_isolation_*.gpkg"))):
    name = os.path.basename(path)[:-len(".gpkg")]
    county, hazard = name.split("_functional_isolation_", 1)
    if county not in COUNTIES:
        print(f"  skip {name}: unknown county {county}")
        continue

    study = geojson(path, "study_area")[0]
    hazard_rings = [r for f in geojson(path, "hazard") for r in outer_rings(f["geometry"])]
    study_ring = outer_rings(study["geometry"])[0]
    props = study["properties"]

    con = sqlite3.connect(f"file:{path}?immutable=1", uri=True)
    try:
        cur = con.cursor()
        losing, max_loss, class_ranges = {}, {}, {}
        # A run made before a cutoff was added has no columns for it. SQLite
        # would read a missing "column" as a string, so check first.
        present = {row[1] for row in cur.execute(f'PRAGMA table_info("{name}")')}
        for c in CUTOFFS:
            if f"loss_{c}m" not in present:
                continue
            cur.execute(f'SELECT COUNT(*), MAX("loss_{c}m") FROM "{name}" '
                        f'WHERE "loss_{c}m" > 0 AND NOT "is_blocked"')
            n, mx = cur.fetchone()
            losing[str(c)] = n
            max_loss[str(c)] = round(mx or 0, 4)
            for method in METHODS:
                col = f"loss_{c}m_{method}_class"
                cur.execute(f'SELECT "{col}", MIN("loss_{c}m"), MAX("loss_{c}m") FROM "{name}" '
                            f'WHERE NOT "is_blocked" AND NOT "is_isolated" AND "{col}" BETWEEN 1 AND 10 '
                            f'GROUP BY "{col}"')
                found = {int(k): [round(lo, 4), round(hi, 4)] for k, lo, hi in cur.fetchall()}
                class_ranges[f"{c}_{method}"] = [found.get(k) for k in range(1, 11)]
    finally:
        con.close()

    out[f"{county}/{hazard}"] = {
        "county": county,
        "hazard": hazard,
        "tiles": f"{county}_isolation_{hazard}.pmtiles",
        "bounds": bounds([study_ring]),
        "hazardBounds": bounds(hazard_rings),
        "hazardPoint": point_inside(path),
        "studyArea": study_ring,
        "bufferMiles": props["buffer_miles"],
        "overtureRelease": props["overture_release"],
        "roads": props["segments"],
        "buildings": props["buildings"],
        "isolatedRoads": props["isolated_segments"],
        "isolatedBuildings": props["isolated_buildings"],
        "hazardBuildings": props.get("hazard_buildings") or 0,
        "losing": losing,
        "maxLoss": max_loss,
        "classRanges": class_ranges,
    }
    print(f"  {county}/{hazard:<22} {props['segments']:>7,} roads   "
          f"cut off {props['isolated_segments']:>3} roads, {props['isolated_buildings']:>5,} buildings   "
          f"losing {losing['5']}/{losing['10']}/{losing['15']}")

with open(OUT, "w") as fh:
    json.dump(out, fh, separators=(",", ":"))
    fh.write("\n")
print(f"\nwrote {OUT} ({len(out)} hazards, {os.path.getsize(OUT):,} bytes)")
