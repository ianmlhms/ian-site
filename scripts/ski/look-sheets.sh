#!/bin/bash
# Round 5: the before / after sheets from look-shots.sh + look-park.sh (one column, labelled, phone-readable).
#   scripts/ski/look-sheets.sh DIR      DIR holds before/ and after/; the sheets land in DIR
D="$1"; PY="${SKI_PY:-$HOME/Library/Caches/luxtram-work/.venv/bin/python}"; S="$(cd "$(dirname "$0")" && pwd)/look_sheet.py"
B="$D/before"; A="$D/after"
name() { case "$1" in killy) echo "Espace Killy";; 3vallees) echo "3 Vallées";; zermatt) echo "Zermatt";; arlberg) echo "St. Anton";; kronplatz) echo "Kronplatz";; esac; }
for r in killy 3vallees zermatt arlberg kronplatz vialattea obertauern; do
  n="$(name $r)"
  "$PY" "$S" "$D/sheet-$r.jpg" --width 1400 \
    "$n · Niddreg · VIRDRUN|$B/$r-low-run.png" "$n · Niddreg · NEI|$A/$r-low-run.png" \
    "$n · Héich · VIRDRUN|$B/$r-high-run.png" "$n · Héich · NEI|$A/$r-high-run.png" \
    "$n · Niddreg · VIRDRUN|$B/$r-low-vista.png" "$n · Niddreg · NEI|$A/$r-low-vista.png" \
    "$n · Héich · VIRDRUN|$B/$r-high-vista.png" "$n · Héich · NEI|$A/$r-high-vista.png"
done
"$PY" "$S" "$D/sheet-closeup.jpg" --width 1400 \
  "Skifuerer + Schnéi · Niddreg · VIRDRUN|$B/killy-low-snowclose.png" "Skifuerer + Schnéi · Niddreg · NEI|$A/killy-low-snowclose.png" \
  "Skifuerer + Schnéi · Héich · VIRDRUN|$B/killy-high-snowclose.png" "Skifuerer + Schnéi · Héich · NEI|$A/killy-high-snowclose.png" \
  "Vu vir · Héich · VIRDRUN|$B/killy-high-close.png" "Vu vir · Héich · NEI|$A/killy-high-close.png"
"$PY" "$S" "$D/sheet-pixels.jpg" --width 1400 --crop 0.28,0.3,0.72,0.74 \
  "Niddreg, Ausschnëtt 1:1 · VIRDRUN|$B/killy-low-run.png" "Niddreg, Ausschnëtt 1:1 · NEI|$A/killy-low-run.png" \
  "Niddreg, Duerf 1:1 · VIRDRUN|$B/killy-low-vista.png" "Niddreg, Duerf 1:1 · NEI|$A/killy-low-vista.png"
"$PY" "$S" "$D/sheet-weather.jpg" --width 1400 \
  "Owend · VIRDRUN|$B/killy-high-eve.png" "Owend · NEI|$A/killy-high-eve.png" \
  "Moien · VIRDRUN|$B/killy-high-morn.png" "Moien · NEI|$A/killy-high-morn.png" \
  "Niwwel · VIRDRUN|$B/killy-high-fog.png" "Niwwel · NEI|$A/killy-high-fog.png" \
  "Schnéi · VIRDRUN|$B/killy-high-snow.png" "Schnéi · NEI|$A/killy-high-snow.png" \
  "Wolleken · VIRDRUN|$B/killy-high-cloudy.png" "Wolleken · NEI|$A/killy-high-cloudy.png"
"$PY" "$S" "$D/sheet-park.jpg" --width 1400 \
  "Snowpark Agank · Héich · VIRDRUN|$B/killy-high-park.png" "Snowpark Agank · Héich · NEI|$A/killy-high-park.png" \
  "Kicker L · Héich · VIRDRUN|$B/killy-high-park-kicker.png" "Kicker L · Héich · NEI|$A/killy-high-park-kicker.png" \
  "Kicker L · Niddreg · VIRDRUN|$B/killy-low-park-kicker.png" "Kicker L · Niddreg · NEI|$A/killy-low-park-kicker.png" \
  "Rails + Boxen · Héich · VIRDRUN|$B/killy-high-park-rails.png" "Rails + Boxen · Héich · NEI|$A/killy-high-park-rails.png" \
  "Halfpipe · Héich · VIRDRUN|$B/killy-high-park-pipe.png" "Halfpipe · Héich · NEI|$A/killy-high-park-pipe.png" \
  "Stärekaart · VIRDRUN|$B/killy-high-stars.png" "Stärekaart · NEI|$A/killy-high-stars.png"
