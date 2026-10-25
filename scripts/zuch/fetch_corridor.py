#!/usr/bin/env python3
"""Cache the OSM features of the Mosel-line corridor (roads, waterways, landuse, places, level crossings, rails) per tile as pickles.
Usage: fetch_corridor.py [tile ...]   (default: all tiles).  Output: ~/Library/Caches/zuch-work/realline/corridor-<tile>.pkl"""
import os
import pickle
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from osm_rail import WORK, bbox_wgs, read_layer  # noqa: E402

OUT = os.path.join(WORK, "realline")
TILES = {   # UTM 32N boxes (E0, N0, E1, N1)
    "lux": (291000, 5494000, 324500, 5513500),
    "trier": (323500, 5508500, 340500, 5525000),
    "wittlich": (336500, 5518500, 353000, 5541000),
    "gap": (352000, 5534000, 376000, 5541000),
    "cochem": (350000, 5540000, 375000, 5562000),
    "koblenz": (373000, 5555000, 400500, 5584000),
}
HIGHWAYS = "('motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','unclassified','residential','service','track','path','cycleway','footway')"


def fetch(tile):
    box = TILES[tile]
    bb = bbox_wgs(*box)
    out = {"box": box}
    t0 = time.time()
    for name, layer, where in [
        ("highways", "lines", "highway IN " + HIGHWAYS),
        ("waterways", "lines", "waterway IN ('river','canal','stream','ditch')"),
        ("rails", "lines", "railway IN ('rail','platform','platform_edge')"),
        ("landuse", "multipolygons", "landuse IS NOT NULL OR natural IS NOT NULL OR leisure IS NOT NULL OR place IS NOT NULL"),
        ("places", "points", "place IS NOT NULL"),
        ("railpoints", "points", "other_tags LIKE '%railway%'"),
        ("misc", "points", "other_tags LIKE '%man_made%' OR highway IS NOT NULL OR barrier IS NOT NULL"),
    ]:
        try:
            feats = read_layer(layer, bb, where=where)
        except Exception as e:  # noqa: BLE001
            print("  ", tile, name, "FAILED", e, flush=True)
            feats = []
        out[name] = [{"id": f["id"], "wkb": f["g"].wkb, "t": f["t"]} for f in feats]
        print("  ", tile, name, len(feats), "%.0fs" % (time.time() - t0), flush=True)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "corridor-%s.pkl" % tile), "wb") as f:
        pickle.dump(out, f)


if __name__ == "__main__":
    for t in sys.argv[1:] or list(TILES):
        fetch(t)
