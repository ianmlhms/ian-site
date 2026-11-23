#!/bin/bash
# Round 7-C look shots on all five resorts: Chromium on the Mac's GPU (DPR 2) and WebKit, then labelled one-column sheets.
#   scripts/ski/round7c-shots.sh OUT_DIR [resort ...]
set -u
BROWSERS=${BROWSERS:-gpu webkit}      # BROWSERS="gpu" / "webkit" / "" (only the sheets)
OUT=${1:-$HOME/Library/Caches/ski-work/round7c}; shift || true
RESORTS=${*:-killy 3vallees zermatt arlberg kronplatz vialattea obertauern livigno}
cd "$(dirname "$0")/../.."
mkdir -p "$OUT/gpu" "$OUT/webkit"
for rid in $RESORTS; do
  url="/pb/ski.html?resort=$rid&go=1&debug=1&q=high&weather=sun&time=morning&res=fixed"
  while [ "$(sysctl -n vm.loadavg | awk '{print int($2)}')" -gt 40 ]; do sleep 20; done
  [[ " $BROWSERS " == *" gpu "* ]] && BROWSER_POOL=ski nice -n 10 python3 ~/Library/Caches/browser-slot.py node scripts/ski/shot.mjs "$OUT/gpu/$rid" --gpu --dpr 2 --size 1180x820 --until ready --url "$url" --script scripts/ski/round7c-shots.mjs
  while [ "$(sysctl -n vm.loadavg | awk '{print int($2)}')" -gt 40 ]; do sleep 20; done
  [[ " $BROWSERS " == *" webkit "* ]] && FLOW_BROWSER=webkit BROWSER_POOL=ski nice -n 10 python3 ~/Library/Caches/browser-slot.py node scripts/ski/shot.mjs "$OUT/webkit/$rid" --size 1180x820 --until ready --url "${url/q=high/q=medium}" --script scripts/ski/round7c-shots.mjs
done
PY=~/Library/Caches/luxtram-work/.venv/bin/python
for b in gpu webkit; do
  args=()
  for rid in killy 3vallees zermatt arlberg kronplatz vialattea obertauern livigno; do [ -f "$OUT/$b/$rid-spawn.png" ] && args+=("$rid: spawn at the first lift ($b)|$OUT/$b/$rid-spawn.png"); done
  $PY scripts/ski/look_sheet.py "$OUT/sheet-spawn-$b.jpg" ${args[@]+"${args[@]}"} --width 1200
  for rid in killy 3vallees zermatt arlberg kronplatz vialattea obertauern livigno; do
    args=()
    for s in map-teleport firstperson spray-carve spray-powder avalanche course-start course-finish; do [ -f "$OUT/$b/$rid-$s.png" ] && args+=("$rid · $s ($b)|$OUT/$b/$rid-$s.png"); done
    $PY scripts/ski/look_sheet.py "$OUT/sheet-$rid-$b.jpg" ${args[@]+"${args[@]}"} --width 1200
  done
done
