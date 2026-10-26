#!/usr/bin/env python3
"""W2c: cache the OSM features of the corridors of the other routes (north, south, west, abroad) per tile as pickles, like fetch_corridor.py does for the
Mosel line.  Usage: fetch_route_corridor.py [tile ...]   Output: ~/Library/Caches/zuch-work/realline/route-<tile>.pkl (the Mosel `corridor-*` files are not touched).
Extracts: Geofabrik Luxembourg / Belgium / France regions in ~/Library/Caches/zuch-work (abroad/ for the non-Luxembourg ones)."""
import os
import pickle
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from osm_rail import WORK, bbox_wgs, read_layer  # noqa: E402
from fetch_corridor import HIGHWAYS  # noqa: E402

OUT = os.path.join(WORK, "realline")
ABROAD = os.path.join(WORK, "abroad")
LUX = os.path.join(WORK, "lux.osm.pbf")


def pbf(name):
    return os.path.join(ABROAD, name + ".osm.pbf")


TILES = {   # name: (UTM 32N box (E0, N0, E1, N1), [pbf files])
    "north-a": ((279000, 5495000, 301000, 5527000), [LUX]),
    "north-b": ((279000, 5525000, 301000, 5560000), [LUX]),
    "south": ((266000, 5480000, 296000, 5500000), [LUX]),
    "west": ((264000, 5496000, 296000, 5513000), [LUX, pbf("belgium")]),
}


def fetch(tile):
    box, pbfs = TILES[tile]
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
            feats = read_layer(layer, bb, where=where, pbfs=pbfs)
        except Exception as e:  # noqa: BLE001
            print("  ", tile, name, "FAILED", e, flush=True)
            feats = []
        out[name] = [{"id": f["id"], "wkb": f["g"].wkb, "t": f["t"]} for f in feats]
        print("  ", tile, name, len(feats), "%.0fs" % (time.time() - t0), flush=True)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "route-%s.pkl" % tile), "wb") as f:
        pickle.dump(out, f)


if __name__ == "__main__":
    for t in sys.argv[1:] or list(TILES):
        fetch(t)
