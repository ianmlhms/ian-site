#!/bin/bash
# Round 7-C2 shots on all five resorts: course start / mid / finish + an avalanche, Chromium on the Mac's GPU (DPR 2) and WebKit, one
# browser job at a time; then one sheet per resort (GPU left, WebKit right) and the in-page check lines in OUT/checks.txt.
#   scripts/ski/round7c2-shots.sh OUT_DIR [resort ...]       BROWSERS="gpu" / "webkit" / "" (only the sheets)
set -u
BROWSERS=${BROWSERS:-gpu webkit}
OUT=${1:-$HOME/Library/Caches/ski-work/round7c2}; shift || true
RESORTS=${*:-killy 3vallees zermatt arlberg kronplatz}
cd "$(dirname "$0")/../.."
mkdir -p "$OUT/gpu" "$OUT/webkit"
for rid in $RESORTS; do
  url="/pb/ski.html?resort=$rid&go=1&debug=1&q=high&weather=sun&time=morning&res=fixed"
  for b in $BROWSERS; do
    while [ "$(sysctl -n vm.loadavg | awk '{print int($2)}')" -gt 40 ]; do sleep 20; done
    if [ "$b" = gpu ]; then
      BROWSER_POOL=ski nice -n 10 python3 ~/Library/Caches/browser-slot.py node scripts/ski/shot.mjs "$OUT/gpu/$rid" --gpu --dpr 2 --size 1180x820 --until ready --url "$url" --script scripts/ski/round7c2-shots.mjs 2>&1 | grep -E "R7C2|pageerror|Error" | sed "s/^/$rid gpu: /" >> "$OUT/checks.txt"
    else
      FLOW_BROWSER=webkit BROWSER_POOL=ski nice -n 10 python3 ~/Library/Caches/browser-slot.py node scripts/ski/shot.mjs "$OUT/webkit/$rid" --size 1180x820 --until ready --url "${url/q=high/q=medium}" --script scripts/ski/round7c2-shots.mjs 2>&1 | grep -E "R7C2|pageerror|Error" | sed "s/^/$rid webkit: /" >> "$OUT/checks.txt"
    fi
  done
done
PY=~/Library/Caches/luxtram-work/.venv/bin/python
for rid in killy 3vallees zermatt arlberg kronplatz; do
  args=()
  for s in course-start course-mid course-finish avalanche; do
    for b in gpu webkit; do [ -f "$OUT/$b/$rid-$s.png" ] && args+=("$rid · $s ($b)|$OUT/$b/$rid-$s.png"); done
  done
  [ ${#args[@]} -gt 0 ] && $PY scripts/ski/look_sheet.py "$OUT/sheet-$rid.jpg" "${args[@]}" --width 2000 --cols 2
done
