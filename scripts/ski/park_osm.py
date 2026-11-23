#!/usr/bin/env python3
"""Snow park candidates of one resort from OpenStreetMap (round 4A), projected into the resort's world frame.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/ski/park_osm.py <rid>

Reads the "parks" layer of fetch_osm.py (piste:type=snow_park ways / areas, leisure=snow_park, downhill pistes named "...park"),
drops boarder / ski cross courses, race stadiums and summer parks, and writes $SKI_WORK/<rid>/park-candidates.json:
[{ name, kind: "area" | "line", pts: [x, z, ...], diff }]. scripts/ski/park_site.mjs picks the site (or places one) from it.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import WORK_ROOT, Frame, osm_path, resort_arg  # noqa: E402

SKIP = re.compile(r"cross|boarder|stade|slalom|parking|été|summer|kinder|kids|family|yeti|himalaya|bk park|movie|cup|bumpy|canyon|aventure|speedy|western|carabosse|pixel|natural", re.I)   # fun zones, kids parks, race courses


def park_shapes(el):
    """A way's geometry, or each outer ring of a multipolygon park (Obertauern "The Spot": three rings = three candidates; member ways
    joined end to end until a ring closes)."""
    if el["type"] == "way":
        return [[g for g in el.get("geometry") or [] if g]]
    key = lambda g: (g["lat"], g["lon"])  # noqa: E731
    rings, cur = [], []
    for m in el.get("members", []):
        part = [g for g in m.get("geometry") or [] if g]
        if m.get("role") != "outer" or len(part) < 2:
            continue
        if cur and key(part[-1]) == key(cur[-1]):
            part = part[::-1]
        cur = cur + part[1:] if cur and key(part[0]) == key(cur[-1]) else (cur if cur else []) + part
        if key(cur[0]) == key(cur[-1]):
            rings.append(cur)
            cur = []
    if cur:
        rings.append(cur)
    return rings


def main():
    rid = resort_arg()
    path = osm_path(rid, "parks")
    if not os.path.exists(path):
        raise SystemExit("no parks layer: run fetch_osm.py %s parks first" % rid)
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    frame = Frame(rid)
    out = []
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        name = tags.get("name", "")
        if el["type"] not in ("way", "relation"):
            continue
        if SKIP.search(name):
            continue
        is_park = tags.get("piste:type") == "snow_park" or tags.get("leisure") == "snow_park" or re.search(r"\bpark\b", name, re.I)
        if not is_park:
            continue
        for geom in park_shapes(el):
            if len(geom) < 2:
                continue
            xs, zs = frame.to_world_many([g["lon"] for g in geom], [g["lat"] for g in geom])
            pts = []
            for x, z in zip(xs, zs):
                pts += [round(float(x), 1), round(float(z), 1)]
            closed = geom[0]["lat"] == geom[-1]["lat"] and geom[0]["lon"] == geom[-1]["lon"]
            out.append({"name": name or "Snowpark", "kind": "area" if (tags.get("area") == "yes" or closed) else "line", "pts": pts,
                        "diff": tags.get("piste:difficulty", ""), "osm": el["id"]})
    dest = os.path.join(WORK_ROOT, rid, "park-candidates.json")      # where park_site.mjs reads it (not the box-specific cache folder)
    with open(dest, "w", encoding="utf-8") as fh:
        json.dump(out, fh)
    print(rid, len(out), "candidates ->", dest)
    for c in out:
        print("  ", c["osm"], c["kind"], c["name"], c["diff"], len(c["pts"]) // 2, "points")


if __name__ == "__main__":
    main()
