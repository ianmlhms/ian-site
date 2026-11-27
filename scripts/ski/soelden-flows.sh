#!/bin/bash
# Sölden (resort 11): the browser flows of the HANDOFF, one at a time through the browser slot. Logs in $OUT (default ~/Library/Caches/ski-work/soelden/flows).
#   scripts/ski/soelden-flows.sh chromium|webkit [flow ...]
cd "$(dirname "$0")/../.." || exit 1
eng=${1:-chromium}; shift
OUT=${OUT:-$HOME/Library/Caches/ski-work/soelden/flows}
mkdir -p "$OUT"
export BROWSER_POOL=ski
SLOT="python3 $HOME/Library/Caches/browser-slot.py"
if [ "$eng" = webkit ]; then DEF="ski ski-webkit ski-lift"; else
  DEF="ski ski-resorts ski-spawn ski-lift ski-lifts-all ski-course ski-challenges ski-park ski-freeride ski-npc ski-modules ski-teleport ski-boarding ski-ride-down ski-ipad-start arcade-feature home-page"; fi
for f in ${@:-$DEF}; do
  case $f in
    ski-lifts-all) export FLOW_SKI_RESORTS=soelden ;;
    ski-boarding) export SKI_BOARDING_RESORTS=soelden ;;
    ski-ipad-start) export SKI_RESORT=soelden ;;
    *) unset FLOW_SKI_RESORTS SKI_BOARDING_RESORTS SKI_RESORT ;;
  esac
  FLOW_POWER=${FLOW_POWER:-1} FLOW_BROWSER=$eng $SLOT node scripts/flows/run_all.mjs "=$f" > "$OUT/flow-$eng-$f.log" 2>&1
  echo "flow $eng $f exit $?"
done
