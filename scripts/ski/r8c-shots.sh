#!/bin/bash
# R8c: the after shots through the running r8c-drv.mjs (PORT); names <engine>-<resort>-<spot>.png in the driver's out dir.
#   scripts/ski/r8c-shots.sh [resorts]
HERE="$(cd "$(dirname "$0")" && pwd)"
P=${PORT:-8791}
q() { curl -s -m 900 "$@"; }
js() { q -X POST --data-binary "$1" "http://127.0.0.1:$P/eval"; echo; }
shot() { q "http://127.0.0.1:$P/shot?name=$1"; echo; }
load() { q "http://127.0.0.1:$P/goto?q=go%3D1%26debug%3D1%26q%3Dmedium%26weather%3Dsun%26time%3Dmidday%26resort%3D$1" > /dev/null; q -X POST --data-binary @"$HERE/r8c-helpers.js" "http://127.0.0.1:$P/eval" > /dev/null; }
# a spot looking uphill (rock faces) or toward (tx, tz)
up() { js "const S=window.__ski,f=S.field,x=$2,z=$3,d=20; const h=Math.atan2(f.height(x,z+d)-f.height(x,z-d), f.height(x+d,z)-f.height(x-d,z)); return await window.__r8.spot(x-Math.cos(h)*30, z-Math.sin(h)*30, h, [x-Math.cos(h)*45, z-Math.sin(h)*45, 1.6, x, z, 2, 60])"; shot "$1"; }
look() { js "return await window.__r8.spot($2, $3, Math.atan2($5-$3, $4-$2), [$2, $3, ${6:-3}, $4, $5, ${7:-0}, 55])"; shot "$1"; }
for rid in ${1:-killy 3vallees zermatt arlberg kronplatz}; do
  load "$rid"
  shot "$rid-spawn"
  js "return window.__r8.labelBoxes()"
  case $rid in
    killy) up killy-rock-bellevarde 9844 9429; js "window.__ski.startPark(); await new Promise(r=>setTimeout(r,5000)); return 1"; shot killy-park-start ;;
    3vallees) up 3v-rock-mauduit 10700 8250; up 3v-rock-boucblanc 12400 5600; up 3v-rock-brides 8281 754
      look 3v-zebra-saulire 12400 5600 12173 9800 6 200; look 3v-brides-street 8281 754 8388 926 3 0; look 3v-courchevel-street 14155 4908 14300 4700 3 0 ;;
    zermatt) js "return await window.__r8.ride('l65', 480, 'chase')"; shot zermatt-ggb-chase; js "window.__ski.toggleRideView(); await new Promise(r=>setTimeout(r,2000)); return 1"; shot zermatt-ggb-window
      js "await window.__r8.offLift(); return await window.__r8.ride('l5', 1600, 'window')"; shot zermatt-cable-window; js "await window.__r8.offLift(); return 1" ;;
    arlberg) look arlberg-zuers-over 12000 12800 12148 12912 60 0; js "return await window.__r8.spot(12148, 12912, 0)"; shot arlberg-zuers ;;
    kronplatz) js "window.__ski.startPark(); await new Promise(r=>setTimeout(r,5000)); return 1"; shot kronplatz-park-start ;;
  esac
done
