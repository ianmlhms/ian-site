#!/usr/bin/env python3
"""Bakes the play area of Lux Drive: the buffered commune rings as a simplified ring in world metres.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/luxdrive/bake_boundary.py

Reads  ~/Library/Caches/luxdrive-work/raw/area_world.json   (written by bake_area.py)
Writes pb/lux-drive/data/area.json                          (the ring, the box of the world)

The ring is the outer limit of the car: it may drive everywhere inside the two communes and the 300 m
buffer around them, but it may not leave the area (the game pushes it back).
"""
import json
import os

from shapely.geometry import Polygon

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
WORK = os.environ.get("LUXDRIVE_WORK", os.path.expanduser("~/Library/Caches/luxdrive-work"))
RAW = os.path.join(WORK, "raw")
OUT = os.path.join(REPO, "pb", "lux-drive", "data", "area.json")
TOLERANCE_M = 2.0          # the ring may move this far from the true border


def main():
    area = json.load(open(os.path.join(RAW, "area_world.json"), encoding="utf-8"))
    rings = []
    for poly in area["polygons"]:
        ring = poly[0]
        geom = Polygon(ring)
        if not geom.is_valid:
            geom = geom.buffer(0)
        simplified = geom.simplify(TOLERANCE_M, preserve_topology=True).exterior.coords
        rings.append([[round(x, 1), round(z, 1)] for x, z in simplified])
    # the game takes the biggest ring (the two communes are one buffered shape) and the rest as holes
    rings.sort(key=len, reverse=True)
    ring = rings[0]
    xs = [p[0] for p in ring]
    zs = [p[1] for p in ring]
    out = {"ring": ring, "holes": rings[1:], "bounds": [min(xs), min(zs), max(xs), max(zs)]}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print("area.json: %d points, %d holes, %.1f kB" % (len(out["ring"]), len(out["holes"]), os.path.getsize(OUT) / 1024))


if __name__ == "__main__":
    main()
