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
    ground) for e in chromium webkit; do for r in killy 3vallees zermatt arlberg kronplatz; do $SLOT node scripts/ski/ground-check.mjs --engines $e --resorts $r --out "$OUT/ground" > "$OUT/ground-$e-$r.log" 2>&1; echo "ground $e $r exit $?"; done; done ;;
    # one flow per browser (memory rule 22 Nov: a browser tree > 2.5 GB is killed); FLOWS overrides the list
    flows-chromium|flows-webkit)
      eng=${s#flows-}
      for f in ${FLOWS:-home-page ski ski-ipad-start ski-resorts ski-mp ski-challenges ski-park ski-freeride ski-lift ski-skis ski-lifts-all ski-webkit ski-look7d ski-mp-freeride ski-teleport ski-spawn ski-firstperson ski-avalanche ski-course mp-lobby-connect4 mp-lobby-slf mp-lobby-quick-match mp-lobby-games mp-lobby-color mp-lobby-party mp-lobby-arcade mp-lobby-roulette mp-lobby-blackjack arcade-pad}; do
        FLOW_POWER=${FLOW_POWER:-1} FLOW_BROWSER=$eng $SLOT node scripts/flows/run_all.mjs "=$f" > "$OUT/flow-$eng-$f.log" 2>&1; echo "flow $eng $f exit $?"
      done ;;
    calls) for r in killy 3vallees zermatt arlberg kronplatz; do $SLOT node scripts/ski/calls-sweep7d.mjs --resorts $r --json "$OUT/calls-sweep-$r.json" > "$OUT/calls-sweep-$r.log" 2>&1; echo "calls $r exit $?"; done ;;
    village) PORT=8795 scripts/ski/r8d-sweeps.sh "low medium" "killy 3vallees zermatt arlberg kronplatz" "$OUT/village" > "$OUT/village-sweep.log" 2>&1; echo "village exit $?" ;;
    pose)
      for e in chromium webkit; do for r in killy 3vallees zermatt arlberg kronplatz; do $SLOT node scripts/ski/pose-check.mjs --engine $e --resorts $r --out "$OUT/pose" > "$OUT/pose-$e-$r.log" 2>&1; echo "pose $e $r exit $?"; done; done ;;
    sonnenkopf) $SLOT node scripts/ski/round8-sheet.mjs --engine webkit --resorts arlberg --lift Sonnenkopfbahn --tag sonnenkopf --out "$OUT/sheet" > "$OUT/sheet-sonnenkopf.log" 2>&1; echo "sonnenkopf exit $?" ;;
    sheets) for r in killy 3vallees zermatt arlberg kronplatz; do $SLOT node scripts/ski/round8-sheet.mjs --engine webkit --resorts $r --out "$OUT/sheet" > "$OUT/sheet-$r.log" 2>&1; echo "sheet $r exit $?"; done ;;
  esac
done
