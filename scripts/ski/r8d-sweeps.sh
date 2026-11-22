#!/bin/bash
# R8d: the village sweep (every village / hamlet centre, 4 headings; r8c-helpers.js sweep) per level and resort through a running
# r8c-drv.mjs on PORT (default 8795).   scripts/ski/r8d-sweeps.sh "low medium" "killy 3vallees zermatt arlberg kronplatz" <out dir>
HERE="$(cd "$(dirname "$0")" && pwd)"
P=${PORT:-8795}
OUT=${3:-$HOME/Library/Caches/ski-work/round8d}
D="python3 $HERE/r8d-drv.py $P"
mkdir -p "$OUT"
for lv in $1; do
  for rid in $2; do
    $D goto "go=1&debug=1&q=$lv&weather=sun&time=midday&resort=$rid" > /dev/null
    $D run "$HERE/r8c-helpers.js" > /dev/null
    $D run -c "const r = await window.__r8.sweep('$rid'); return r;" > "$OUT/sweep-$lv-$rid.json"
    python3 -c "
import json; d=json.load(open('$OUT/sweep-$lv-$rid.json'))
t=max(d,key=lambda x:x['tris']); c=max(d,key=lambda x:x['calls'])
print('$lv $rid: %d spots, max %d tris (%s), max %d calls (%s)' % (len(d), t['tris'], t['name'], c['calls'], c['name']))"
  done
done
