#!/bin/bash
# R8c: re-bake the resorts one at a time (nice), then the data manifest. Log per resort in ~/Library/Caches/ski-work/round8c/.
cd "$(dirname "$0")/../.." || exit 1
PY=~/Library/Caches/luxtram-work/.venv/bin/python
for r in "${@:-killy 3vallees zermatt arlberg kronplatz vialattea obertauern livigno davos}"; do
  for rid in $r; do
    echo "== bake $rid $(date +%H:%M:%S)"
    nice -n 10 "$PY" scripts/ski/bake.py "$rid" > ~/Library/Caches/ski-work/round8c/bake-"$rid".log 2>&1 || { echo "bake $rid FAILED"; tail -5 ~/Library/Caches/ski-work/round8c/bake-"$rid".log; exit 1; }
    grep -E "drop |join " ~/Library/Caches/ski-work/round8c/bake-"$rid".log | cut -c10- | cut -c1-220
  done
done
echo "== manifest"; python3 scripts/gamedata_manifest.py | tail -3
