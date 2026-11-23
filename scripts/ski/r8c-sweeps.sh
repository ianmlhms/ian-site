#!/bin/bash
# R8c: the village sweep (every village / hamlet centre, 4 headings) per resort and level through the running r8c-drv.mjs (PORT).
#   scripts/ski/r8c-sweeps.sh "low medium" "killy 3vallees zermatt arlberg kronplatz vialattea" <out dir>
HERE="$(cd "$(dirname "$0")" && pwd)"
P=${PORT:-8791}
OUT=${3:-$HOME/Library/Caches/ski-work/round8c}
q() { curl -s -m 2400 "$@"; }
for lv in $1; do
  for rid in $2; do
    q "http://127.0.0.1:$P/goto?q=go%3D1%26debug%3D1%26q%3D$lv%26weather%3Dsun%26time%3Dmidday%26resort%3D$rid" > /dev/null
    q -X POST --data-binary @"$HERE/r8c-helpers.js" "http://127.0.0.1:$P/eval" > /dev/null
    q -X POST --data-binary "const r = await window.__r8.sweep('$rid'); return r;" "http://127.0.0.1:$P/eval" > "$OUT/sweep-$lv-$rid.json"
    python3 -c "
import json,sys; d=json.load(open('$OUT/sweep-$lv-$rid.json'))
print('$lv $rid: %d spots, max %d tris (%s), max %d calls (%s), worst village layer %d' % (len(d), max(x['tris'] for x in d), max(d,key=lambda x:x['tris'])['name'], max(x['calls'] for x in d), max(d,key=lambda x:x['calls'])['name'], max(x['village'] for x in d)))"
  done
done
