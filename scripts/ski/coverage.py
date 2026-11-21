#!/usr/bin/env python3
"""Which pistes and lifts of a resort lie (partly) outside its box? Reads the OSM downloads of fetch_osm.py (asked for in the box + a
margin) and lists every piste / lift way that leaves RESORTS[rid]["bbox"], grouped by name, with the box that would hold them all.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/ski/coverage.py arlberg

Features of a neighbouring area (Valmorel next to the 3 Vallées, La Plagne next to Courchevel) show up here too: the list is for a
human to decide what belongs to the resort (then widen the bbox in common.py).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import RESORTS, Frame, osm_path, resort_arg  # noqa: E402

EDGE = 200.0          # m: a feature closer than this to the edge of the baked box counts as cut (the height tiles feather out there)


def features(rid):
    out = []
    for layer in ("pistes", "lifts"):
        with open(osm_path(rid, layer), encoding="utf-8") as fh:
            els = json.load(fh)["elements"]
        for e in els:
            t = e.get("tags", {})
            if e["type"] != "way" or "geometry" not in e:
                continue
            if layer == "lifts" and not t.get("aerialway") and t.get("railway") != "funicular":
                continue
            if layer == "lifts" and t.get("aerialway") in ("pylon", "station", "zip_line", "goods"):
                continue
            kind = t.get("aerialway") or t.get("railway") or "piste:" + t.get("piste:difficulty", "?")
            out.append({"id": e["id"], "layer": layer, "kind": kind, "name": t.get("name") or t.get("piste:name") or "",
                        "pts": [(p["lat"], p["lon"]) for p in e["geometry"]]})
    return out


def main():
    rid = resort_arg()
    s, w, n, e = RESORTS[rid]["bbox"]
    frame = Frame(rid)

    def inside(la, lo):
        x, z = frame.to_world(lo, la)
        return EDGE <= x <= frame.width - EDGE and EDGE <= z <= frame.depth - EDGE
    out_part, out_all = [], []
    for f in features(rid):
        flags = [inside(*p) for p in f["pts"]]
        if all(flags):
            continue
        (out_part if any(flags) else out_all).append(f)
    print("bbox", RESORTS[rid]["bbox"], "baked box %.1f x %.1f km" % (frame.width / 1000, frame.depth / 1000),
          "lon/lat corners", [tuple(round(v, 4) for v in frame.to_lonlat(x, z)) for x, z in ((0, 0), (frame.width, frame.depth))])
    for title, group in (("PARTLY OUTSIDE (cut at the edge)", out_part), ("WHOLLY OUTSIDE (within the margin)", out_all)):
        print("\n" + title, len(group))
        for f in sorted(group, key=lambda f: (f["layer"], f["name"])):
            las = [p[0] for p in f["pts"]]
            los = [p[1] for p in f["pts"]]
            print("  %-6s %-22s %-34s lat %.4f..%.4f lon %.4f..%.4f  way %d" % (f["layer"], f["kind"][:22], f["name"][:34], min(las), max(las), min(los), max(los), f["id"]))
    if out_part:
        las = [p[0] for f in out_part for p in f["pts"]]
        los = [p[1] for f in out_part for p in f["pts"]]
        print("\nbox holding every cut feature: (%.4f, %.4f, %.4f, %.4f)" % (min(s, min(las)), min(w, min(los)), max(n, max(las)), max(e, max(los))))


if __name__ == "__main__":
    main()
