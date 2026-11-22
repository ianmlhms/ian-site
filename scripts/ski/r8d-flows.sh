#!/bin/bash
# R8d: after r8d-checks.sh: ground-check again, the flows in Chromium then WebKit, then the WebKit contact sheets (ONE browser at a time).
#   scripts/ski/r8d-flows.sh [out dir] [steps: ground flows-chromium flows-webkit sheets]
cd "$(dirname "$0")/../.." || exit 1
OUT=${1:-$HOME/Library/Caches/ski-work/round8d}
STEPS=${2:-"ground flows-chromium flows-webkit sheets"}
SLOT="python3 $HOME/Library/Caches/browser-slot.py"
export BROWSER_POOL=ski
mkdir -p "$OUT"
for s in $STEPS; do
  case $s in
    ground) $SLOT node scripts/ski/ground-check.mjs --engines chromium,webkit --out "$OUT/ground" > "$OUT/ground-check.log" 2>&1; echo "ground exit $?" ;;
    flows-chromium) FLOW_BROWSER=chromium $SLOT node scripts/flows/run_all.mjs ski home-page arcade-pad mp-lobby > "$OUT/flows-chromium.log" 2>&1; echo "flows chromium exit $?" ;;
    flows-webkit) FLOW_BROWSER=webkit $SLOT node scripts/flows/run_all.mjs ski home-page arcade-pad mp-lobby > "$OUT/flows-webkit.log" 2>&1; echo "flows webkit exit $?" ;;
    sheets) $SLOT node scripts/ski/round8-sheet.mjs --engine webkit --out "$OUT/sheet" > "$OUT/sheet.log" 2>&1; echo "sheets exit $?" ;;
  esac
done
