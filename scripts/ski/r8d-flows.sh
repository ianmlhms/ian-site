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
    # one flow per browser (memory rule 22 Nov: a browser tree > 2.5 GB is killed); FLOWS overrides the list
    flows-chromium|flows-webkit)
      eng=${s#flows-}
      for f in ${FLOWS:-home-page ski ski-ipad-start ski-resorts ski-mp ski-challenges ski-park ski-freeride ski-lift ski-skis ski-lifts-all ski-webkit ski-look7d ski-mp-freeride ski-teleport ski-spawn ski-firstperson ski-avalanche ski-course mp-lobby-connect4 mp-lobby-slf mp-lobby-quick-match mp-lobby-games mp-lobby-color mp-lobby-party mp-lobby-arcade mp-lobby-roulette mp-lobby-blackjack arcade-pad}; do
        FLOW_BROWSER=$eng $SLOT node scripts/flows/run_all.mjs "=$f" > "$OUT/flow-$eng-$f.log" 2>&1; echo "flow $eng $f exit $?"
      done ;;
    calls) for r in killy 3vallees zermatt arlberg kronplatz; do $SLOT node scripts/ski/calls-sweep7d.mjs --resorts $r --json "$OUT/calls-sweep-$r.json" > "$OUT/calls-sweep-$r.log" 2>&1; echo "calls $r exit $?"; done ;;
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
