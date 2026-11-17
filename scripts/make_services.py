"""
Write public/data/services.geojson: the four kinds of place the detour runs
route to, for drawing on the Detours map.

These are the same point files run-detour.py was given (see
aws/run_twelve_detours.sh in the analysis repo), read from its output/:

  fire       output/fs.gpkg            NC fire stations
  medical    output/med_fac.gpkg       NC licensed medical facilities
  school     output/ccd-schools.gpkg   NCES Common Core of Data schools, 2025
  grocery    output/food.gpkg          USDA SNAP retailer locations

Only the points inside the three counties' detour runs are kept, using the
same bounds as COUNTIES in src/config.ts, with a name for the popup. The
files are national or statewide and run to tens of megabytes; what the viewer
needs is a few hundred kilobytes.

Needs ogr2ogr (GDAL), which scripts/build_tiles.sh needs too.

Usage:  python3 scripts/make_services.py
"""
import json
import os
import subprocess

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "public", "data", "services.geojson")

# The GeoPackages live in the analysis repo, which is assumed to sit next to
# this one. Set ANALYSIS_REPO to point somewhere else.
ANALYSIS = os.environ.get("ANALYSIS_REPO",
                          os.path.join(REPO, os.pardir, "conectivity_helpers"))

# West, south, east, north: the bounds of each county's detour run, as in
# COUNTIES in src/config.ts.
COUNTY_BOUNDS = {
    "haywood": (-83.439, 35.137, -82.563, 35.941),
    "mecklenburg": (-81.236, 34.855, -80.37, 35.66),
    "new_hanover": (-78.212, 33.839, -77.573, 34.543),
}

# (kind, file, layer, columns to read, how to make the name from them)
def _fire_name(p):
    dept = (p.get("DEPT_NAME") or "").strip()
    num = p.get("STATION_NU")
    try:
        return f"{dept} Station {int(num)}" if num is not None else dept
    except (TypeError, ValueError):
        return dept


SOURCES = [
    ("fire", "fs.gpkg", "fire_stations", ["DEPT_NAME", "STATION_NU"], _fire_name),
    ("medical", "med_fac.gpkg", "medical_facilities", ["facility"], lambda p: p.get("facility")),
    ("school", "ccd-schools.gpkg", "schools_points_2025_ccd", ["SCH_NAME"], lambda p: p.get("SCH_NAME")),
    ("grocery", "food.gpkg", "snap_retailer_location_data", ["Store_Name"], lambda p: p.get("Store_Name")),
]


def read(path, layer, columns, bounds):
    """Points of one layer inside bounds (lon/lat), as GeoJSON features."""
    w, s, e, n = bounds
    out = subprocess.run(
        ["ogr2ogr", "-f", "GeoJSON", "/vsistdout/", path, layer,
         "-select", ",".join(columns),
         "-spat", str(w), str(s), str(e), str(n), "-spat_srs", "EPSG:4326",
         "-t_srs", "EPSG:4326", "-lco", "COORDINATE_PRECISION=5"],
        check=True, capture_output=True, text=True).stdout
    return json.loads(out)["features"]


features = []
seen = set()
for kind, gpkg, layer, columns, make_name in SOURCES:
    path = os.path.join(ANALYSIS, "output", gpkg)
    if not os.path.exists(path):
        print(f"  skip {kind}: {gpkg} not found")
        continue
    n = 0
    for county, bounds in COUNTY_BOUNDS.items():
        for f in read(path, layer, columns, bounds):
            if not f.get("geometry"):
                continue
            x, y = f["geometry"]["coordinates"][:2]
            key = (kind, round(x, 5), round(y, 5))
            if key in seen:      # the same place inside two counties' bounds
                continue
            seen.add(key)
            name = str(make_name(f["properties"]) or "").strip()
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(x, 5), round(y, 5)]},
                "properties": {"kind": kind, "name": name},
            })
            n += 1
    print(f"  {kind:<8} {n:>5} points")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as fh:
    json.dump({"type": "FeatureCollection", "features": features}, fh, separators=(",", ":"))
    fh.write("\n")
print(f"\nwrote {OUT} ({len(features)} points, {os.path.getsize(OUT):,} bytes)")
