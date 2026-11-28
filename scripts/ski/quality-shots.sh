#!/bin/bash
# Grafik round (28 Nov 2026): Niddreg vs Héich at the same spots, iPad landscape (1080 x 810 @2), on the Mac's GPU, fixed resolution.
#   scripts/ski/quality-shots.sh OUT [ROOT] [levels] [extra-url]     ROOT = another copy of the site (the "before" snapshot)
# Sheets: python3 scripts/ski/look_sheet.py (see look-sheets.sh).
OUT="$1"; ROOT="$2"; LEVELS="${3:-low high}"; EXTRA="$4"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"
pose() {
  case "$1" in
    killy) echo "vista=pose:11386,8935,45,10025,8336,150,55;run=tp:250;close=orbit:250,155,3.4,1.1,42;forest=tp:900;eve=tp:250@sun/evening" ;;
    3vallees) echo "vista=pose:10998,16860,60,9562,19816,200,60;run=tp:250;far=tp:700" ;;
  esac
}
for r in killy 3vallees; do
  for q in $LEVELS; do
    BROWSER_POOL=ski python3 ~/Library/Caches/browser-slot.py node "$HERE/shot.mjs" "$OUT/$r-$q" --gpu --dpr 2 --size 1080x810 \
      --url "/pb/ski.html?resort=$r&auto=1&bot=1&debug=1&q=$q&weather=sun&time=midday&res=fixed$EXTRA" ${ROOT:+--root "$ROOT"} \
      --wait 4500 --shots "$(pose "$r")" > "$OUT/$r-$q.log" 2>&1
    tail -n 2 "$OUT/$r-$q.log" | cut -c1-260
  done
done
