#!/bin/bash
# Round 5 look sheets: the same views of every resort at Niddreg and Héich, on the Mac's GPU at DPR 2 (an iPad's 2160 x 1620).
#   scripts/ski/look-shots.sh OUT_DIR [ROOT] [resorts] [levels]      ROOT = another copy of the site (the "before" snapshot)
# One browser per resort + level, each through the ski browser pool. Sheets: scripts/ski/look_sheet.py.
OUT="$1"; ROOT="$2"; RESORTS="${3:-killy 3vallees zermatt arlberg kronplatz}"; LEVELS="${4:-low high}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"
pose() {
  case "$1" in
    killy) echo "vista=pose:11386,8935,45,10025,8336,150,55;run=tp:250;close=orbit:250,155,3.4,1.1,42;snowclose=orbit:250,35,2.6,0.7,50;eve=tp:250@sun/evening;morn=pose:7188,6365,300,6574,8175,0,60@sun/morning;fog=tp:900@fog/midday;snow=tp:900@snow/midday;cloudy=tp:250@cloudy/midday" ;;
    3vallees) echo "vista=pose:10998,16860,60,9562,19816,200,60;run=tp:250" ;;
    zermatt) echo "vista=pose:11978,5978,20,4568,7860,-200,40;run=tp:250" ;;
    arlberg) echo "vista=pose:12064,10741,20,10850,9237,0,45;run=tp:250" ;;
    kronplatz) echo "vista=pose:10373,8337,120,7852,7431,0,40;run=tp:250" ;;
  esac
}
for r in $RESORTS; do
  for q in $LEVELS; do
    BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node "$HERE/shot.mjs" "$OUT/$r-$q" --gpu --dpr 2 --size 1080x810 \
      --url "/pb/ski.html?resort=$r&auto=1&bot=1&debug=1&q=$q&weather=sun&time=midday" ${ROOT:+--root "$ROOT"} \
      --wait 4500 --shots "$(pose "$r")" > "$OUT/$r-$q.log" 2>&1
    tail -n 3 "$OUT/$r-$q.log" | cut -c1-220
  done
done
