#!/bin/bash
# Round 5 look sheets, game modes: the star map and the snow park (Espace Killy) at Niddreg and Héich, GPU, DPR 2.
#   scripts/ski/look-park.sh OUT_DIR [ROOT] [levels] [resort]
OUT="$1"; ROOT="$2"; LEVELS="${3:-low high}"; RID="${4:-killy}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"
for q in $LEVELS; do
  BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node "$HERE/shot.mjs" "$OUT/$RID-$q" --gpu --dpr 2 --size 1080x810 --until map \
    --url "/pb/ski.html?resort=$RID&map=1&debug=1&q=$q&weather=sun&time=midday" ${ROOT:+--root "$ROOT"} \
    --wait 4000 --script "$HERE/look-park.mjs" > "$OUT/$RID-park-$q.log" 2>&1
  tail -n 4 "$OUT/$RID-park-$q.log" | cut -c1-220
done
