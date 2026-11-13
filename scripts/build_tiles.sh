#!/bin/bash
# ===============================================================
# build_tiles.sh — GeoPackage outputs into PMTiles for the viewer
# ===============================================================
# Reprojects each source to EPSG:4326, keeps only the columns the
# viewer draws or shows in a popup, and writes one .pmtiles per
# dataset into viewer/public/data/.
#
# connector_ids_json is deliberately dropped. It is the largest
# column in every source and nothing in the viewer reads it, so
# carrying it would multiply the tile size for no gain.
#
# Usage:  bash scripts/build_tiles.sh [pinch|detours|all]
#
# Tiles are gitignored. Rebuild them after re-running any analysis.

set -e

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The GeoPackages live in the analysis repo, which is assumed to sit next to
# this one. Set ANALYSIS_REPO to point somewhere else.
ANALYSIS="${ANALYSIS_REPO:-$(cd "$REPO/.." && pwd)/conectivity_helpers}"
SRC="$ANALYSIS/output"
DEST="$REPO/public/data"

if [ ! -d "$SRC" ]; then
    echo "No such directory: $SRC"
    echo "Set ANALYSIS_REPO to the conectivity_helpers checkout."
    exit 1
fi
TMP="${TMPDIR:-/tmp}/conectivity-tiles.$$"

mkdir -p "$DEST" "$TMP"
trap 'rm -rf "$TMP"' EXIT

WHAT="${1:-all}"

# Columns shared by all three combined detour files.
DETOUR_COLS="combined_extra_sec,combined_band_score,combined_affected_od,\
combined_disconnected_od,services_affected,max_service_norm,mean_service_norm,\
combined_lost_within_3min,combined_lost_within_5min,combined_lost_within_8min,\
combined_lost_within_15min,combined_lost_within_30min,combined_lost_within_60min,\
combined_extra_sec_quantile_class,combined_extra_sec_log10_class,combined_extra_sec_geometric_class,\
combined_band_quantile_class,combined_band_log10_class,combined_band_geometric_class,\
max_service_quantile_class,max_service_log10_class,max_service_geometric_class,\
mean_service_quantile_class,mean_service_log10_class,mean_service_geometric_class,\
class,road_name,travel_time_sec"

PINCH_COLS="pinch_score,pinch_norm,pinch_class,pinch_log10_class,\
pinch_quantile_class,pinch_geometric_class,centrality_raw,centrality_norm,\
centrality_log,detour_len_m,class,road_name"

# tile one GeoPackage: $1 source, $2 output name, $3 layer name,
# $4 column list, $5 min zoom, $6 max zoom
tile() {
    local src="$1" out="$2" layer="$3" cols="$4" zmin="$5" zmax="$6"
    if [ ! -f "$src" ]; then
        echo "  SKIP $(basename "$src") (not found)"
        return
    fi
    local jsonl="$TMP/$out.geojsonl"
    echo "  $(basename "$src") -> $out.pmtiles"
    ogr2ogr -f GeoJSONSeq "$jsonl" "$src" -t_srs EPSG:4326 -select "$cols"
    # --drop-densest-as-needed keeps each tile under the size limit by
    # thinning the densest areas rather than failing; road networks in
    # cities are dense enough to need it.
    tippecanoe -o "$DEST/$out.pmtiles" -l "$layer" -n "$out" \
        -Z"$zmin" -z"$zmax" \
        --drop-densest-as-needed --extend-zooms-if-still-dropping \
        --force --quiet --no-progress-indicator \
        "$jsonl"
    rm -f "$jsonl"
    echo "    $(du -h "$DEST/$out.pmtiles" | cut -f1)"
}

if [ "$WHAT" = "all" ] || [ "$WHAT" = "detours" ]; then
    echo "Detour tiles:"
    for county in haywood mecklenburg new_hanover; do
        tile "$SRC/${county}_detour_combined.gpkg" \
             "${county}_detour" detour "$DETOUR_COLS" 6 14
    done
fi

if [ "$WHAT" = "all" ] || [ "$WHAT" = "pinch" ]; then
    echo "Pinch tiles:"
    # Statewide and 2.1M segments, so it starts at z5 and stops at z13.
    # Going to z14 roughly doubles the file for detail no one reads at
    # the scale this layer is for.
    tile "$SRC/north_carolina_pinch_points.gpkg" \
         "north_carolina_pinch" pinch "$PINCH_COLS" 5 13
fi

echo ""
echo "Done. Tiles in public/data:"
ls -lh "$DEST"/*.pmtiles 2>/dev/null | awk '{print "  " $5, $9}'
