#!/usr/bin/env python3
"""Ruins of closed ski lifts (Ski Alpen, 28 Nov 2026): pb/ski/data/<resort>/ruins.json for the pylons / huts still standing.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/ski/ruins.py [resort ...]      (no argument: all resorts)

OSM ways tagged abandoned:aerialway / disused:aerialway / was:aerialway (razed:aerialway = nothing left: skipped), and aerialway=* with
abandoned=yes, or whose name says it is closed for good. Plain aerialway=* + disused=yes is NOT taken: that is often a lift out of service for
a season (Cime Caron, Chatelet), see SKIP_WAYS for the single ways the research agents ruled out. Same frame, same DEM mosaic as bake.py;
a ruin on the line of a current lift (a replaced lift) is dropped. Output rows:
    {name, type, pts: flat [x, z, ...], pylons: [arc length m], bottom: {x, z, y}, top: {x, z, y}, state: "abandoned" | "disused", len, osm}
Overpass: https://overpass.openstreetmap.fr (User-Agent ski-map-check), one request per resort, 6 s pause, cached under $SKI_WORK/ruins/.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake import Dem, apply_drawdown, dp_simplify, flat, load_mosaic, load_osm, polyline_len, resample, way_xz, LIFT_KIND, PYLON_GAP  # noqa: E402
from common import RESORTS, WORK_ROOT, Frame, out_dir  # noqa: E402

ENDPOINTS = ["https://overpass.openstreetmap.fr/api/interpreter", "https://overpass-api.de/api/interpreter"]
UA = "ski-map-check"
# lifts that are not ruins (research agents, 28 Nov 2026): Cime Caron cable car (reopens), Chatelet chair (avalanche, reopens 2026/27),
# Killy "Panoramic" (summer only), Gornergrat - Hohtaelli (razed)
SKIP_WAYS = {22462908, 29422053, 47420189, 964884240}
# Owner rule (28 Nov 2026): OSM is not trusted for what exists. A ruin is only built where a NON-OSM source confirms the lift closed for good and
# it is not dismantled / razed (OSM gives the geometry only). OSM way id -> the source (latest-maps research, ~/Library/Caches/ski-work/latest-maps).
# Every other abandoned / disused way is listed as "unconfirmed" by the script and left out.
CONFIRMED = {
    663382790: "Moncrons J-bar, closed 2016/17, replaced by Cote Faure (skiresort l2038, remontees-mecaniques)",
    334481488: "Sciovia Chardonet, Moncrons sector abandoned, not on the 2025/26 map",
    437427053: "Sciovia Scoiattolo, Moncrons sector abandoned, not on the 2025/26 map",
    770919064: "Sciovia Costapiana, Moncrons sector abandoned, not on the 2025/26 map",
    239353856: "Pragelato Plan Conca del Sole chair, unused since ~2011-14 (Legambiente 2020)",
    239353854: "Pragelato Plan Belotte Piz platter, unused since ~2011-14 (Legambiente 2020)",
    261134871: "Pragelato Plan Cristallo platter, unused since ~2011-14 (Legambiente 2020)",
    261148443: "Pragelato Plan Smeraldo platter, unused since ~2011-14 (Legambiente 2020)",
    517973334: "Pragelato Plan Trampolini chair, unused since ~2011-14 (Legambiente 2020)",
    402259544: "Davos Strelagrat T-bar (1971), closed 2002, not replaced (skiresort.info)",
    25931352: "Kronplatz Lorenzi gondola, closed 2020",
    148112999: "Zermatt Triftji T-bar, closed 2017, not replaced (skiresort.com l92968)",
}
PREFIXES = ("abandoned", "disused", "was", "razed")
MIN_LEN = 70.0
LIVE_NEAR = 25.0          # m: a ruin whose line lies within this of a live lift for most of its length is a replaced lift
KIND = dict(LIFT_KIND)
KIND.update({"yes": "drag", "j-bar": "drag", "t-bar": "drag", "platter": "drag"})
CLOSED_NAME = ("stillgelegt", "(zou)", "abbandon", "in disuso", "(ferm")


def query(rid):
    s, w, n, e = RESORTS[rid]["bbox"]
    m = 0.01
    box = "%f,%f,%f,%f" % (s - m, w - m, n + m, e + m)
    lines = ['way[~"^(abandoned|disused|was|razed):aerialway$"~"."](%s);' % box, 'way["aerialway"]["abandoned"="yes"](%s);' % box,
             'way["aerialway"]["name"~"stillgelegt|in disuso|abbandon|\\\\(ferm",i](%s);' % box]
    return "[out:json][timeout:120];(%s);out geom tags;" % "".join(lines)


def fetch(rid):
    cache = os.path.join(WORK_ROOT, "ruins", rid + ".json")
    if os.path.exists(cache):
        with open(cache, encoding="utf-8") as fh:
            return json.load(fh)["elements"]
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    body = urllib.parse.urlencode({"data": query(rid)}).encode()
    for attempt in range(6):
        for url in ENDPOINTS:
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=180) as resp:
                    data = json.load(resp)
                if "error" in str(data.get("remark", "")).lower():
                    raise RuntimeError(data["remark"][:100])
                with open(cache, "w", encoding="utf-8") as fh:
                    json.dump(data, fh)
                time.sleep(6)
                return data["elements"]
            except Exception as err:  # noqa: BLE001
                print("  retry", rid, url, str(err)[:80], file=sys.stderr)
                time.sleep(10 * (attempt + 1))
    raise SystemExit("Overpass failed for " + rid)


def classify(t):
    """(state, osm lift type) or None."""
    for pre in PREFIXES:
        v = t.get(pre + ":aerialway")
        if v:
            if pre == "razed":
                return None
            return ("disused" if pre == "disused" else "abandoned"), v
    if t.get("aerialway") and (t.get("abandoned") == "yes" or any(k in t.get("name", "").lower() for k in CLOSED_NAME)):
        return "abandoned", t["aerialway"]
    return None


def live_cover(p, lines):
    """Share of the polyline's points (every 10 m) that lie within LIVE_NEAR of one of `lines`."""
    if not lines:
        return 0.0
    q = resample(p, 10.0)
    hit = 0
    for x, z in q:
        for a in lines:
            if np.hypot(a[:, 0] - x, a[:, 1] - z).min() < LIVE_NEAR:
                hit += 1
                break
    return hit / len(q)


def run(rid):
    cfg = RESORTS[rid]
    frame = Frame(rid)
    frame.rid = rid
    raw = load_mosaic(rid, frame)
    raw, _, _ = apply_drawdown(frame, cfg, raw, load_osm(rid, "areas"))
    dem = Dem(raw)
    with open(os.path.join(out_dir(rid), "resort.json"), encoding="utf-8") as fh:
        live = json.load(fh).get("lifts", [])
    live_lines = []
    for l in live:                                               # (resampled: a live line's vertices are far apart)
        a = np.array(l["pts"], float).reshape(-1, 2)
        live_lines.append(resample(a, 8.0))
    rows, notes = [], []
    for e in fetch(rid):
        if e["type"] != "way" or not e.get("geometry") or e["id"] in SKIP_WAYS:
            continue
        cl = classify(e.get("tags", {}))
        if not cl:
            continue
        state, osm_type = cl
        if e["id"] not in CONFIRMED:
            notes.append("unconfirmed (OSM only), skipped: %s %s %s" % (e["id"], e["tags"].get("name", ""), osm_type))
            continue
        if osm_type in ("goods", "zip_line", "magic_carpet"):
            continue
        kind = KIND.get(osm_type, "drag")
        if kind == "carpet":
            continue
        p = way_xz(frame, e["geometry"])
        if not all(0 <= q[0] <= frame.width and 0 <= q[1] <= frame.depth for q in (p[0], p[-1])):
            continue
        length = polyline_len(p)
        if length < MIN_LEN:
            continue
        h = dem(p[:, 0], p[:, 1])
        if h[0] > h[-1]:
            p, h = p[::-1].copy(), h[::-1].copy()
        if live_cover(p, live_lines) > 0.6:
            notes.append("replaced by a live lift: %s %s" % (e["id"], e["tags"].get("name", "")))
            continue
        gap = PYLON_GAP.get(kind) or 70
        n = max(1, int(length // gap))
        pyl = [round(length * (i + 0.5) / n, 1) for i in range(n)] if n > 1 else [round(length / 2, 1)]
        pyl = [s for s in pyl if 8 < s < length - 8]
        rows.append({"name": e["tags"].get("name", ""), "type": kind, "pts": flat(dp_simplify(p, 0.8)), "pylons": pyl, "len": round(length), "osm": e["id"],
                     "bottom": {"x": round(float(p[0][0]), 1), "z": round(float(p[0][1]), 1), "y": round(float(h[0]), 1)},
                     "top": {"x": round(float(p[-1][0]), 1), "z": round(float(p[-1][1]), 1), "y": round(float(h[-1]), 1)}, "state": state})
    rows.sort(key=lambda r: -r["len"])                           # two ways on one line (both lanes): keep the longer
    kept = []
    for r in rows:
        if any(live_cover(np.array(r["pts"], float).reshape(-1, 2), [resample(np.array(k["pts"], float).reshape(-1, 2), 8.0)]) > 0.8 for k in kept):
            continue
        kept.append(r)
    with open(os.path.join(out_dir(rid), "ruins.json"), "w", encoding="utf-8") as fh:
        json.dump(kept, fh, separators=(",", ":"), ensure_ascii=False)
    print("%-10s %2d ruins %s" % (rid, len(kept), [(r["name"] or "-", r["type"], r["state"], r["len"]) for r in kept]))
    for n_ in notes:
        print("   ", n_)
    return len(kept)


def main():
    ids = [a for a in sys.argv[1:] if not a.startswith("-")] or list(RESORTS)
    for rid in ids:
        run(rid)


if __name__ == "__main__":
    main()
