#!/bin/bash
# Aerial contact sheets along a route: scripts/zuch/aerial_sheet.sh <route> <outDir> <s0> <s1> <step> [up]   -> <outDir>/<route>-sheet-N.png (9 tiles each)
set -e
ROUTE=$1; OUT=$2; S0=$3; S1=$4; STEP=$5; UP=${6:-160}
PY=/Users/Ian/Library/Caches/luxtram-work/.venv/bin/python
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT/$ROUTE"
node "$HERE/route_aerial.mjs" "$ROUTE" "$OUT/$ROUTE" "$S0" "$S1" "$STEP" --up "$UP" --quality medium
files=("$OUT/$ROUTE"/aerial-*.png)
n=${#files[@]}; i=0; sheet=1
while [ $i -lt $n ]; do
  args=()
  for f in "${files[@]:$i:9}"; do b=$(basename "$f" .png); args+=("${b#aerial-}=$f"); done
  $PY "$HERE/montage.py" "$OUT/$ROUTE-sheet-$sheet.png" --cols 3 --w 640 "${args[@]}" >/dev/null
  i=$((i+9)); sheet=$((sheet+1))
done
echo "$ROUTE: $n shots, $((sheet-1)) sheets"
