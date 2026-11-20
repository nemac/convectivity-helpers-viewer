#!/bin/bash
# `npm run dev:local`: everything for local work in one command, at one
# address, http://localhost:5190. It reads the tiles from public/data/,
# starts the two on-demand APIs (drawn areas and alternate routes) on this
# Mac in Docker, rebuilding their images first so code changes are picked
# up (a quick build when nothing changed), and starts the feedback Lambda
# function's local copy (feedback_api/local_server.py on 127.0.0.1:8788,
# which also serves the dev inbox). Ctrl+C stops all of it.
#
# The APIs live in the analysis repo (ANALYSIS_REPO, a sibling folder by
# default). If Docker is not running, the map and feedback still work; only
# Draw a hazard and the routes button do not.
set -euo pipefail
VIEWER="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AN="${ANALYSIS_REPO:-$(cd "$VIEWER/.." && pwd)/conectivity_helpers}"
API="$AN/ondemand_api"
FEEDBACK_LOG="$VIEWER/feedback_api/local_data/server.log"   # gitignored with the rest of local_data/

# One EXIT trap stops whatever was started below, so Ctrl+C or an error
# anywhere leaves nothing running.
STOP_TOOLS=0
FEEDBACK_PID=""
cleanup() {
    if [ -n "$FEEDBACK_PID" ]; then kill "$FEEDBACK_PID" 2>/dev/null || true; fi
    if [ "$STOP_TOOLS" = 1 ]; then FORCE=1 bash "$API/stop_local.sh" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

if [ -d "$API" ] && docker info >/dev/null 2>&1; then
    echo "Starting the drawn-area and alternate-route tools ..."
    bash "$API/build.sh" >/dev/null
    # On this Mac nothing costs money, so the daily counts and the cost cap
    # never block (the user asked: "since it's running local"). The real
    # limits apply only on AWS. Feedback is not theirs any more: it has its
    # own server, started below.
    NOLIMIT=1000000
    FORCE=1 RUNS_PER_DAY=$NOLIMIT RUNS_PER_DAY_FIRST_WEEK=$NOLIMIT \
      BIG_RUNS_PER_DAY=$NOLIMIT BIG_RUNS_PER_DAY_FIRST_WEEK=$NOLIMIT \
      ROUTES_PER_DAY=$NOLIMIT ROUTES_PER_DAY_FIRST_WEEK=$NOLIMIT \
      COST_CAP_USD=$NOLIMIT COST_CAP_USD_FIRST_WEEK=$NOLIMIT \
      bash "$API/start_local.sh" >/dev/null
    # while this runs, nothing else may stop the tools (see stop_local.sh)
    touch "$AN/output/.ondemand_keep_running"
    STOP_TOOLS=1
else
    echo "Docker is not running: the map works, but Draw a hazard and the routes button will not."
fi

# The feedback server: the same rules as the function on AWS, feedback kept
# in feedback_api/local_data/, and the inbox. If one is already listening
# on 8788 (started by hand), that one is used and left alone.
if lsof -iTCP:8788 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "A feedback server is already running on 127.0.0.1:8788; using it."
else
    echo "Starting the feedback server (log: feedback_api/local_data/server.log) ..."
    mkdir -p "$(dirname "$FEEDBACK_LOG")"
    python3 "$VIEWER/feedback_api/local_server.py" >>"$FEEDBACK_LOG" 2>&1 &
    FEEDBACK_PID=$!
fi

cd "$VIEWER"
VITE_TILES_BASE=data/ \
VITE_FI_API_BASE=http://localhost:8787/fi \
VITE_ROUTES_API_BASE=http://localhost:8787/routes \
VITE_FEEDBACK_API_BASE=http://127.0.0.1:8788 \
npx vite
