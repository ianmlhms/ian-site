#!/bin/bash
# R8d: the browser checks one after the other (each through browser-slot.py, ONE browser at a time); logs in OUT.
#   scripts/ski/r8d-checks.sh [out dir] [steps: ground pose calls]
cd "$(dirname "$0")/../.." || exit 1
OUT=${1:-$HOME/Library/Caches/ski-work/round8d}
STEPS=${2:-"ground pose calls"}
SLOT="python3 $HOME/Library/Caches/browser-slot.py"
export BROWSER_POOL=ski
mkdir -p "$OUT"
for s in $STEPS; do
  case $s in
    ground) $SLOT node scripts/ski/ground-check.mjs --engines chromium,webkit --out "$OUT/ground" > "$OUT/ground-check.log" 2>&1; echo "ground exit $?" ;;
    pose)
      $SLOT node scripts/ski/pose-check.mjs --engine chromium --out "$OUT/pose" > "$OUT/pose-chromium.log" 2>&1; echo "pose chromium exit $?"
      $SLOT node scripts/ski/pose-check.mjs --engine webkit --out "$OUT/pose" > "$OUT/pose-webkit.log" 2>&1; echo "pose webkit exit $?" ;;
    calls) $SLOT node scripts/ski/calls-sweep7d.mjs --json "$OUT/calls-sweep.json" > "$OUT/calls-sweep.log" 2>&1; echo "calls exit $?" ;;
  esac
done
