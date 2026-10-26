#!/usr/bin/env python3
"""W2c: cache the OSM features of the corridors of the other routes (north, south, west, abroad) per tile as pickles, like fetch_corridor.py does for the
Mosel line.  Usage: fetch_route_corridor.py [tile ...]   Output: ~/Library/Caches/zuch-work/realline/route-<tile>.pkl (the Mosel `corridor-*` files are not touched).
Extracts: Geofabrik Luxembourg / Belgium / France regions in ~/Library/Caches/zuch-work (abroad/ for the non-Luxembourg ones)."""
import os
import pickle
import sys
import time

import numpy as np

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


EXTRA_LAYERS = [   # platform polygons (closed ways are multipolygons in the OGR layers) and station buildings
    ("platpoly", "multipolygons", "other_tags LIKE '%\"railway\"=>\"platform\"%'"),
    ("stbuild", "multipolygons", "building = 'train_station' OR other_tags LIKE '%train_station%' OR other_tags LIKE '%\"public_transport\"=>\"station\"%'"),
]


def fetch_extra(tile):
    """Adds the EXTRA_LAYERS to an existing route-<tile>.pkl (no need to read the big layers again)."""
    box, pbfs = TILES[tile]
    bb = bbox_wgs(*box)
    path = os.path.join(OUT, "route-%s.pkl" % tile)
    with open(path, "rb") as f:
        out = pickle.load(f)
    for name, layer, where in EXTRA_LAYERS:
        feats = read_layer(layer, bb, where=where, pbfs=pbfs)
        out[name] = [{"id": f["id"], "wkb": f["g"].wkb, "t": f["t"]} for f in feats]
        print("  ", tile, name, len(feats), flush=True)
    with open(path, "wb") as f:
        pickle.dump(out, f)


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


def pbf_files(names):
    return [LUX if n == "lux" else pbf(n) for n in names]


def fetch_two_stage(route_id):
    """W3, abroad routes: the corridor of a long route (150 - 370 km) without reading the box around it.
    Stage 1: only the rails and the station nodes of a wide lon / lat box (spec["fetch"]["box"]) -> the real path between the stops (build_real_route.build_path, Dijkstra).
    Stage 2: every other layer inside `corridor_m` of that path (GDAL tests each feature against the corridor polygon while reading, see osm_rail.read_layer(mask=)).
    Output: route-<id>.pkl in the format of the single-tile fetch (box = bounding box of the corridor)."""
    import shapely
    from shapely.geometry import LineString
    from osm_rail import TO_WGS
    import build_real_route as brr
    from real_route_defs import ROUTES
    spec = ROUTES[route_id]
    cfg = spec["fetch"]
    pbfs = pbf_files(cfg["pbfs"])
    t0 = time.time()
    stage1 = {}
    for name, layer, where in [("rails", "lines", "railway IN ('rail')"), ("railpoints", "points", "other_tags LIKE '%railway%'")]:
        feats = read_layer(layer, cfg["box"], where=where, pbfs=pbfs)
        stage1[name] = [{"id": f["id"], "g": f["g"], "t": f["t"]} for f in feats]
        print("  stage 1", route_id, name, len(feats), "%.0fs" % (time.time() - t0), flush=True)
    route, _ = brr.build_path(stage1, spec)
    line = LineString(route["xy"]).simplify(60.0)
    corridor = line.buffer(cfg.get("corridor_m", 2500.0), cap_style="round", join_style="round").simplify(40.0)
    mask = shapely.transform(corridor, lambda c: np.c_[TO_WGS.transform(c[:, 0], c[:, 1])[0], TO_WGS.transform(c[:, 0], c[:, 1])[1]])
    print("  path %.1f km, corridor %.0f km2" % (LineString(route["xy"]).length / 1000, corridor.area / 1e6), flush=True)
    out = {"box": corridor.bounds}
    for name, layer, where in [
        ("highways", "lines", "highway IN " + HIGHWAYS),
        ("waterways", "lines", "waterway IN ('river','canal','stream','ditch')"),
        ("rails", "lines", "railway IN ('rail','platform','platform_edge')"),
        ("landuse", "multipolygons", "landuse IS NOT NULL OR natural IS NOT NULL OR leisure IS NOT NULL OR place IS NOT NULL"),
        ("places", "points", "place IS NOT NULL"),
        ("railpoints", "points", "other_tags LIKE '%railway%'"),
        ("misc", "points", "other_tags LIKE '%man_made%' OR highway IS NOT NULL OR barrier IS NOT NULL"),
    ] + EXTRA_LAYERS:
        feats = read_layer(layer, None, where=where, pbfs=pbfs, mask=mask)
        out[name] = [{"id": f["id"], "wkb": f["g"].wkb, "t": f["t"]} for f in feats]
        print("  stage 2", route_id, name, len(feats), "%.0fs" % (time.time() - t0), flush=True)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "route-%s.pkl" % route_id), "wb") as f:
        pickle.dump(out, f)


if __name__ == "__main__":
    args = sys.argv[1:]
    two = [a for a in args if a in ("metz", "brussels", "paris")]
    if two:
        for r in two:
            fetch_two_stage(r)
        sys.exit(0)
    extra = "--extra" in args
    args = [a for a in args if a != "--extra"]
    for t in args or list(TILES):
        (fetch_extra if extra else fetch)(t)
