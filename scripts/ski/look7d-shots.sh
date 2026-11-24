#!/bin/bash
# R7-D look shots on all five resorts: look7d-shots.sh OUT_DIR [chromium|webkit]
#   chromium = the Mac GPU (ANGLE Metal) at DPR 2; webkit = Playwright WebKit (Safari's engine), DPR 2
# One browser at a time, each through the ski browser pool, below the Mini's load limit (Ian, 21 Nov 2026: load < 40).
set -u
OUT="$1"; ENGINE="${2:-chromium}"
cd "$(dirname "$0")/../.." || exit 1
mkdir -p "$OUT"
for r in killy 3vallees zermatt arlberg kronplatz vialattea obertauern livigno davos; do
  while [ "$(sysctl -n vm.loadavg | awk '{print int($2)}')" -ge 40 ]; do sleep 15; done
  if [ "$ENGINE" = webkit ]; then
    FLOW_BROWSER=webkit BROWSER_POOL=ski nice -n 10 python3 ~/Library/Caches/browser-slot.py node scripts/ski/shot.mjs "$OUT/$r" --dpr 2 --size 1180x820 --until ready \
      --url "/pb/ski.html?resort=$r&go=1&debug=1&q=high&weather=sun&time=midday&res=fixed" --script scripts/ski/look7d-shots.mjs 2>&1 | grep -E "skip|info|Error|rror" | cut -c1-200
  else
    BROWSER_POOL=ski nice -n 10 python3 ~/Library/Caches/browser-slot.py node scripts/ski/shot.mjs "$OUT/$r" --gpu --dpr 2 --size 1180x820 --until ready \
      --url "/pb/ski.html?resort=$r&go=1&debug=1&q=high&weather=sun&time=midday&res=fixed" --script scripts/ski/look7d-shots.mjs 2>&1 | grep -E "skip|info|Error|rror" | cut -c1-200
  fi
done
