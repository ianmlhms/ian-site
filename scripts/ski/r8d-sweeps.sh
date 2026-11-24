#!/bin/bash
# R8d: the village sweep (every village / hamlet centre, 4 headings; r8c-helpers.js sweep) per level and resort, a FRESH browser
# (r8c-drv.mjs through browser-slot.py) for every level x resort (22 Nov memory rule: a browser tree > 2.5 GB is killed).
#   scripts/ski/r8d-sweeps.sh "low medium" "killy 3vallees zermatt arlberg kronplatz vialattea obertauern livigno davos laax" <out dir>
# Also writes mem-<level>-<rid>.json: renderer.info.memory + the JS heap at the end of the sweep.
HERE="$(cd "$(dirname "$0")" && pwd)"
P=${PORT:-8795}
OUT=${3:-$HOME/Library/Caches/ski-work/round8d}
D="python3 $HERE/r8d-drv.py $P"
mkdir -p "$OUT"
for lv in $1; do
  for rid in $2; do
    BROWSER_POOL=ski python3 "$HOME/Library/Caches/browser-slot.py" node "$HERE/r8c-drv.mjs" chromium "$P" "$OUT/drv" > "$OUT/drv-$lv-$rid.log" 2>&1 &
    DRV=$!
    for i in $(seq 1 360); do curl -s -m 2 "http://127.0.0.1:$P/logs" > /dev/null && break; kill -0 $DRV 2> /dev/null || break; sleep 5; done
    $D goto "go=1&debug=1&q=$lv&weather=sun&time=midday&resort=$rid" > /dev/null
    $D run "$HERE/r8c-helpers.js" > /dev/null
    $D run -c "const r = await window.__r8.sweep('$rid'); return r;" > "$OUT/sweep-$lv-$rid.json"
    $D run -c "const S = window.__ski; return { info: S.renderer.info.memory, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };" > "$OUT/mem-$lv-$rid.json"
    $D quit > /dev/null 2>&1
    wait $DRV
    python3 -c "
import json; d=json.load(open('$OUT/sweep-$lv-$rid.json')); m=json.load(open('$OUT/mem-$lv-$rid.json'))
t=max(d,key=lambda x:x['tris']); c=max(d,key=lambda x:x['calls'])
print('$lv $rid: %d spots, max %d tris (%s), max %d calls (%s); mem %s' % (len(d), t['tris'], t['name'], c['calls'], c['name'], m))" 2>&1 | tail -1
  done
done
