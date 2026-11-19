#!/bin/bash
# `npm run dev:local`: everything for local work in one command, at one
# address, http://localhost:5190. It reads the tiles from public/data/ and
# starts the two on-demand APIs (drawn areas and alternate routes) on this
# Mac in Docker, rebuilding their images first so code changes are picked
# up (a quick build when nothing changed). Ctrl+C stops all of it.
#
# The APIs live in the analysis repo (ANALYSIS_REPO, a sibling folder by
# default). If Docker is not running, the map still works; only Draw a
# hazard and the routes button do not.
set -euo pipefail
VIEWER="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AN="${ANALYSIS_REPO:-$(cd "$VIEWER/.." && pwd)/conectivity_helpers}"
API="$AN/ondemand_api"

if [ -d "$API" ] && docker info >/dev/null 2>&1; then
    echo "Starting the drawn-area and alternate-route tools ..."
    bash "$API/build.sh" >/dev/null
    # On this Mac nothing costs money, so the daily counts and the cost cap
    # never block (the user asked: "since it's running local"). The real
    # limits apply only on AWS.
    NOLIMIT=1000000
    FORCE=1 RUNS_PER_DAY=$NOLIMIT RUNS_PER_DAY_FIRST_WEEK=$NOLIMIT \
      BIG_RUNS_PER_DAY=$NOLIMIT BIG_RUNS_PER_DAY_FIRST_WEEK=$NOLIMIT \
      ROUTES_PER_DAY=$NOLIMIT ROUTES_PER_DAY_FIRST_WEEK=$NOLIMIT \
      COST_CAP_USD=$NOLIMIT COST_CAP_USD_FIRST_WEEK=$NOLIMIT \
      bash "$API/start_local.sh" >/dev/null
    # while this runs, nothing else may stop the tools (see stop_local.sh)
    touch "$AN/output/.ondemand_keep_running"
    trap 'FORCE=1 bash "$API/stop_local.sh" >/dev/null 2>&1 || true' EXIT
else
    echo "Docker is not running: the map works, but Draw a hazard and the routes button will not."
fi

cd "$VIEWER"
VITE_TILES_BASE=data/ \
VITE_FI_API_BASE=http://localhost:8787/fi \
VITE_ROUTES_API_BASE=http://localhost:8787/routes \
npx vite
