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
# Usage:  bash scripts/build_tiles.sh [isolation|detours|pinch|all] [match]
#
# With isolation, an optional second word builds only the hazard runs whose
# file name contains it, for example "haywood" or "pagescreek1".
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
MATCH="${2:-}"

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

# Columns from every functional isolation hazard run. The cutoffs are the
# ones run-functional-isolation-hazards.sh writes (5, 10, 15 and 30 minutes).
ISOLATION_COLS="is_isolated,isolated_buildings,is_blocked,dist_to_hazard_m,class,road_name"
for c in 5 10 15 30; do
    ISOLATION_COLS="$ISOLATION_COLS,bld_${c}m_baseline,lost_${c}m,loss_${c}m"
    for m in geometric log10 quantile; do
        ISOLATION_COLS="$ISOLATION_COLS,loss_${c}m_${m}_class"
    done
done

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

# One hazard run: its roads, the hazard polygon and the study area around it,
# as three layers in one file. $1 source, $2 output name.
tile_hazard() {
    local src="$1" out="$2" layer
    layer="$(basename "$src" .gpkg)"
    echo "  $(basename "$src") -> $out.pmtiles"
    ogr2ogr -f GeoJSONSeq "$TMP/roads.geojsonl" "$src" "$layer" \
        -t_srs EPSG:4326 -select "$ISOLATION_COLS"
    ogr2ogr -f GeoJSONSeq "$TMP/hazard.geojsonl" "$src" hazard -t_srs EPSG:4326
    ogr2ogr -f GeoJSONSeq "$TMP/study_area.geojsonl" "$src" study_area \
        -t_srs EPSG:4326 -select "hazard_name"
    # The buildings the hazard cuts off or floods, written by runs from
    # 2026-11-17 on. Older runs have no such layer.
    local extra=()
    if ogrinfo -q "$src" hazard_buildings >/dev/null 2>&1; then
        ogr2ogr -f GeoJSONSeq "$TMP/hazard_buildings.geojsonl" "$src" hazard_buildings \
            -t_srs EPSG:4326 -select "status"
        extra=(-L hazard_buildings:"$TMP/hazard_buildings.geojsonl")
    fi
    # --no-tiny-polygon-reduction keeps a small hazard polygon from being
    # thinned away when zoomed out, where it is the thing to find.
    tippecanoe -o "$DEST/$out.pmtiles" -n "$out" \
        -L roads:"$TMP/roads.geojsonl" \
        -L hazard:"$TMP/hazard.geojsonl" \
        -L study_area:"$TMP/study_area.geojsonl" \
        ${extra[@]+"${extra[@]}"} \
        -Z6 -z14 \
        --drop-densest-as-needed --extend-zooms-if-still-dropping \
        --no-tiny-polygon-reduction \
        --force --quiet --no-progress-indicator
    rm -f "$TMP"/roads.geojsonl "$TMP"/hazard.geojsonl "$TMP"/study_area.geojsonl "$TMP"/hazard_buildings.geojsonl
    echo "    $(du -h "$DEST/$out.pmtiles" | cut -f1)"
}

if [ "$WHAT" = "all" ] || [ "$WHAT" = "isolation" ]; then
    echo "Functional isolation tiles:"
    # <county>_functional_isolation_<hazard>.gpkg -> <county>_isolation_<hazard>
    found=0
    for src in "$SRC"/*_functional_isolation_*.gpkg; do
        [ -f "$src" ] || continue
        case "$(basename "$src")" in *"$MATCH"*) ;; *) continue ;; esac
        found=1
        name="$(basename "$src" .gpkg)"
        tile_hazard "$src" "${name/_functional_isolation_/_isolation_}"
    done
    [ "$found" = 1 ] || echo "  SKIP (no *_functional_isolation_*.gpkg in $SRC)"
fi

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
