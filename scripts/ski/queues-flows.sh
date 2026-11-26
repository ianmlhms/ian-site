#!/bin/bash
# Lift lines round (26 Nov 2026): the flows (exact names) one browser at a time through the ski pool.
#   scripts/ski/queues-flows.sh chromium|webkit name [name ...]
cd "$(dirname "$0")/../.." || exit 1
engine="$1"; shift
args=()
for n in "$@"; do args+=("=$n"); done
if [ "$engine" = "webkit" ]; then export FLOW_BROWSER=webkit; fi
BROWSER_POOL=ski python3 "$HOME/Library/Caches/browser-slot.py" node scripts/flows/run_all.mjs "${args[@]}"
