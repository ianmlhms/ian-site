#!/bin/bash
# R7-D look sheets (phone-readable, one column, labelled) from look7d-shots.sh output:
#   look7d-sheets.sh DIR    (DIR/before, DIR/after = Chromium GPU, DIR/webkit = WebKit)
D="$1"; PY="${SKI_PY:-$HOME/Library/Caches/luxtram-work/.venv/bin/python}"; S="$(cd "$(dirname "$0")" && pwd)/look_sheet.py"
R="killy 3vallees zermatt arlberg kronplatz vialattea obertauern livigno davos laax soelden"
pair() {   # pair OUT shot...: before / after per resort (after only where no before exists)
  local out="$1"; shift; local args=()
  for r in $R; do for n in "$@"; do
    [ -f "$D/before/$r-$n.png" ] && args+=("$r · $n · before|$D/before/$r-$n.png")
    [ -f "$D/after/$r-$n.png" ] && args+=("$r · $n · after|$D/after/$r-$n.png")
  done; done
  "$PY" "$S" "$out" "${args[@]}" --width 1100
}
only() {   # only OUT SUBDIR LABEL shot...: one engine's shots per resort
  local out="$1" sub="$2" lab="$3"; shift 3; local args=()
  for r in $R; do for n in "$@"; do [ -f "$D/$sub/$r-$n.png" ] && args+=("$r · $n · $lab|$D/$sub/$r-$n.png"); done; done
  "$PY" "$S" "$out" "${args[@]}" --width 1100
}
pair "$D/sheet-trees.jpg" fir larch
pair "$D/sheet-evening.jpg" evening-run evening-shade
pair "$D/sheet-gate.jpg" gate
pair "$D/sheet-park-kickers.jpg" park-kicker park-runup
only "$D/sheet-park-pipe.jpg" after "after (Chromium)" park-pipe park-pipe-in
only "$D/sheet-midday-unchanged.jpg" after "after, midday" midday-shade
if [ -d "$D/webkit" ]; then
  only "$D/sheet-webkit-trees-gate.jpg" webkit WebKit fir larch gate
  only "$D/sheet-webkit-park.jpg" webkit WebKit park-kicker park-runup park-pipe park-pipe-in
  only "$D/sheet-webkit-evening.jpg" webkit WebKit evening-run evening-shade
fi
ls -la "$D"/sheet-*.jpg
