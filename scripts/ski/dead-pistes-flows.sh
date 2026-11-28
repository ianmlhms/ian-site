#!/bin/bash
# Flows for the dead-pistes round (28 Nov 2026): Chromium ski, ski-resorts, ski-goals, ski-challenges + WebKit ski. Output: $1 (default ski-work/dead-pistes/flows.txt)
cd "$(dirname "$0")/../.." || exit 1
OUT="${1:-$HOME/Library/Caches/ski-work/dead-pistes/flows.txt}"
: > "$OUT"
for f in ski ski-resorts ski-goals ski-challenges; do
  echo "== $f" >> "$OUT"
  BROWSER_POOL=ski python3 "$HOME/Library/Caches/browser-slot.py" node scripts/flows/run_all.mjs "=$f" 2>&1 | tail -6 >> "$OUT"
done
echo "== webkit ski" >> "$OUT"
FLOW_BROWSER=webkit BROWSER_POOL=ski python3 "$HOME/Library/Caches/browser-slot.py" node scripts/flows/run_all.mjs "=ski" 2>&1 | tail -6 >> "$OUT"
echo ALLDONE >> "$OUT"
