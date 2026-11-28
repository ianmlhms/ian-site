#!/bin/bash
# Standing lifts (28 Nov 2026): the flows this round touches, one engine at a time (log to stdout).
#   scripts/ski/standing-flows.sh chromium|webkit flow-name ...   (each through ~/Library/Caches/browser-slot.py, pool ski)
cd "$(dirname "$0")/../.." || exit 1
engine="$1"; shift
for f in "$@"; do
  echo "== $engine $f"
  FLOW_BROWSER="$engine" BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node scripts/flows/run_all.mjs "=$f" 2>&1 | grep -v "browser-slot" | tail -25
done
