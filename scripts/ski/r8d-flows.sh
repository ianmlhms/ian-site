#!/bin/bash
# R8d: after r8d-checks.sh: ground-check again, the flows in Chromium then WebKit, then the WebKit contact sheets (ONE browser at a time).
#   scripts/ski/r8d-flows.sh [out dir] [steps: ground flows-chromium flows-webkit sheets]
cd "$(dirname "$0")/../.." || exit 1
OUT=${1:-$HOME/Library/Caches/ski-work/round8d}
STEPS=${2:-"calls village ground pose flows-chromium flows-webkit sheets sonnenkopf"}
SLOT="python3 $HOME/Library/Caches/browser-slot.py"
export BROWSER_POOL=ski
mkdir -p "$OUT"
for s in $STEPS; do
  case $s in
    ground) $SLOT node scripts/ski/ground-check.mjs --engines chromium,webkit --out "$OUT/ground" > "$OUT/ground-check.log" 2>&1; echo "ground exit $?" ;;
    flows-chromium) FLOW_BROWSER=chromium $SLOT node scripts/flows/run_all.mjs ski home-page arcade-pad mp-lobby > "$OUT/flows-chromium.log" 2>&1; echo "flows chromium exit $?" ;;
    flows-webkit) FLOW_BROWSER=webkit $SLOT node scripts/flows/run_all.mjs ski home-page arcade-pad mp-lobby > "$OUT/flows-webkit.log" 2>&1; echo "flows webkit exit $?" ;;
    calls) $SLOT node scripts/ski/calls-sweep7d.mjs --json "$OUT/calls-sweep.json" > "$OUT/calls-sweep.log" 2>&1; echo "calls exit $?" ;;
    village)
      $SLOT node scripts/ski/r8c-drv.mjs chromium 8795 "$OUT/drv" > "$OUT/drv.log" 2>&1 &
      for i in $(seq 1 120); do curl -s -m 2 http://127.0.0.1:8795/logs > /dev/null && break; sleep 5; done
      PORT=8795 scripts/ski/r8d-sweeps.sh "low medium" "killy 3vallees zermatt arlberg kronplatz" "$OUT/final" > "$OUT/village-sweep.log" 2>&1
      python3 scripts/ski/r8d-drv.py 8795 quit > /dev/null; wait; echo "village exit" ;;
    pose)
      $SLOT node scripts/ski/pose-check.mjs --engine chromium --out "$OUT/pose" > "$OUT/pose-chromium.log" 2>&1; echo "pose chromium exit $?"
      $SLOT node scripts/ski/pose-check.mjs --engine webkit --out "$OUT/pose" > "$OUT/pose-webkit.log" 2>&1; echo "pose webkit exit $?" ;;
    sonnenkopf) $SLOT node scripts/ski/round8-sheet.mjs --engine webkit --resorts arlberg --lift Sonnenkopfbahn --tag sonnenkopf --out "$OUT/sheet" > "$OUT/sheet-sonnenkopf.log" 2>&1; echo "sonnenkopf exit $?" ;;
    sheets) $SLOT node scripts/ski/round8-sheet.mjs --engine webkit --out "$OUT/sheet" > "$OUT/sheet.log" 2>&1; echo "sheets exit $?" ;;
  esac
done
