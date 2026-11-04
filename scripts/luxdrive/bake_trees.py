#!/usr/bin/env python3
"""Bake the trees of Lux Drive: the trees OSM knows and the rows of trees along the streets.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/luxdrive/bake_trees.py

The woods are not in here: they come from the LiDAR canopy at run time (a forest is a cover, not a list of trees).
What OSM knows are the trees a person mapped one by one: the plane trees of the boulevards, the trees of the parks,
the old trees of the villages.  The rows of trees (`natural=tree_row`) are the lines of trees along the streets:
they are spread out here at the real spacing of a street tree (9 m), so the Avenue des Arts gets its avenue of trees.

trees.bin layout (little endian):
    u32 count
    per tree:
      i32 x (decimetres), i32 z (decimetres)
      u8  height (decimetres)
      u8  kind      0 = a broadleaf, 1 = a conifer, 2 = a bush
      u8  girth     the width of the crown in per cent of the height
      u8  flags     bit0 = the tree stands in a street (the trees of a row)
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT_DIR, RAW_DIR, lonlat_to_luref, luref_to_world  # noqa: E402

KIND_BROADLEAF, KIND_CONIFER, KIND_BUSH = 0, 1, 2
FLAG_IN_STREET = 1
ROW_SPACING = 9.0             # m between the trees of a row (the plane trees of the boulevards)
STREET_HEIGHT = 13.0          # m, the height of a street tree
FIELD_HEIGHT = 12.0           # m, the height of a tree in a park or a meadow


def height_of(tags, default, seed):
    """The height of a tree: the surveyed height when there is one, else a default that varies with the seed."""
    raw = tags.get("height")
    if raw:
        digits = ""
        for ch in raw.strip():
            if ch.isdigit() or ch == ".":
                digits += ch
            else:
                break
        try:
            value = float(digits)
            if 1.0 <= value <= 25.0:
                return value
        except ValueError:
            pass
    return max(2.0, default + ((seed * 37) % 7) - 3.0)


def main():
    osm = json.load(open(os.path.join(RAW_DIR, "osm.json"), encoding="utf-8"))
    trees = []

    # ---- the trees that OSM knows one by one --------------------------------
    for p in osm["pois"]:
        t = p["t"]
        if t.get("natural") not in ("tree", "shrub"):
            continue
        x, z = luref_to_world(*lonlat_to_luref(p["lon"], p["lat"]))
        bush = t.get("natural") == "shrub"
        kind = KIND_BUSH if bush else KIND_BROADLEAF
        h = height_of(t, 3.0 if bush else FIELD_HEIGHT, p["id"])
        girth = 95 if bush else int(52 + (p["id"] % 23))
        trees.append({"x": float(x), "z": float(z), "h": h, "kind": kind, "girth": girth, "flags": 0})

    # ---- the rows of trees along the streets ---------------------------------
    nodes = osm["nodes"]
    rows = 0
    for w in osm["ways"]:
        t = w["t"]
        if t.get("natural") != "tree_row":
            continue
        pts = []
        for nid in w["n"]:
            p = nodes.get(str(nid))
            if p:
                pts.append(p)
        if len(pts) < 2:
            continue
        lons = [p[0] for p in pts]
        lats = [p[1] for p in pts]
        e, n = lonlat_to_luref(lons, lats)
        wx, wz = luref_to_world(e, n)
        pts = list(zip(wx.tolist(), wz.tolist()))
        # spread the row out at the real spacing of a street tree
        for i in range(1, len(pts)):
            ax, az = pts[i - 1]
            bx, bz = pts[i]
            length = ((bx - ax) ** 2 + (bz - az) ** 2) ** 0.5
            if length < 1.0:
                continue
            count = max(1, int(length // ROW_SPACING))
            for k in range(count):
                f = (k + 0.5) / count
                h = height_of(t, STREET_HEIGHT, w["id"] + k)
                trees.append({"x": ax + (bx - ax) * f, "z": az + (bz - az) * f, "h": h,
                              "kind": KIND_BROADLEAF, "girth": 58, "flags": FLAG_IN_STREET})
            rows += count

    blob = bytearray()
    blob += (len(trees)).to_bytes(4, "little")
    for t in trees:
        blob += int(round(t["x"] * 10)).to_bytes(4, "little", signed=True)
        blob += int(round(t["z"] * 10)).to_bytes(4, "little", signed=True)
        blob += int(round(t["h"] * 10)).to_bytes(1, "little")
        blob += t["kind"].to_bytes(1, "little")
        blob += t["girth"].to_bytes(1, "little")
        blob += t["flags"].to_bytes(1, "little")
    with open(os.path.join(OUT_DIR, "trees.bin"), "wb") as fh:
        fh.write(blob)

    from collections import Counter
    print("trees %d (%s), the rows %d, trees.bin %.1f kB" %
          (len(trees), dict(Counter(t["kind"] for t in trees)), rows, len(blob) / 1024.0))


if __name__ == "__main__":
    main()
