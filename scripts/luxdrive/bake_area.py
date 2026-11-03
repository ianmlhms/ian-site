#!/usr/bin/env python3
"""Phase 2 of the area extraction: project the commune rings to LUREF, buffer them by 300 m and
cut the world box (a 512 m block grid).

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/luxdrive/bake_area.py

Reads  ~/Library/Caches/luxdrive-work/raw/admin_rings.json  (written by fetch_admin.py)
Writes ~/Library/Caches/luxdrive-work/raw/area_world.json      (the buffered area in world metres)
       ~/Library/Caches/luxdrive-work/raw/area_luref.json       (the same in LUREF EPSG:2169)
       ~/Library/Caches/luxdrive-work/raw/world.json            (the world box constants)

World frame (the same as the MTB game's):
    x = LUREF easting  - ORIGIN_E        (east, metres)
    z = ORIGIN_N_TOP   - LUREF northing  (south, metres)
"""
import json
import os
import sys

from pyproj import Transformer
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.get("LUXDRIVE_WORK", os.path.expanduser("~/Library/Caches/luxdrive-work"))
RAW = os.path.join(WORK, "raw")
os.makedirs(RAW, exist_ok=True)

BUFFER_M = 300.0
BLOCK = 512.0
COMMUNES = ("Luxembourg", "Niederanven")


def _valid(poly):
    if not poly.is_valid:
        poly = poly.buffer(0)
    return poly


def main():
    to_luref = Transformer.from_crs(4326, 2169, always_xy=True)
    rings = json.load(open(os.path.join(RAW, "admin_rings.json"), encoding="utf-8"))

    geoms = []
    for name in COMMUNES:
        info = rings[name]
        outers, holes = [], []
        for ring in info["outer"]:
            e, n = to_luref.transform([p[0] for p in ring], [p[1] for p in ring])
            g = _valid(Polygon([(float(a), float(b)) for a, b in zip(e, n)]))
            if not g.is_empty and g.area > 1:
                outers.append(g)
        for ring in info["inner"]:
            e, n = to_luref.transform([p[0] for p in ring], [p[1] for p in ring])
            g = _valid(Polygon([(float(a), float(b)) for a, b in zip(e, n)]))
            if not g.is_empty and g.area > 1:
                holes.append(g)
        commune = unary_union(outers)
        if holes:
            commune = Polygon(commune.exterior.coords,
                              [h.exterior.coords for h in holes if commune.contains(h)]).buffer(0)
        print("%-14s %.1f km2" % (name, commune.area / 1e6))
        geoms.append(commune)

    merged = unary_union(geoms)
    area = merged.buffer(BUFFER_M, resolution=16)
    print("union %.1f km2, +%d m buffer -> %.1f km2" % (merged.area / 1e6, BUFFER_M, area.area / 1e6))

    minx, miny, maxx, maxy = area.bounds
    # The bbox in degrees too: the OSM extraction runs in a venv without pyproj, so it needs the
    # area as a plain lon/lat box.
    to_wgs = Transformer.from_crs(2169, 4326, always_xy=True)
    lo, la = to_wgs.transform(minx, miny)
    lo2, la2 = to_wgs.transform(maxx, maxy)
    lonlat = [min(lo, lo2), min(la, la2), max(lo, lo2), max(la, la2)]
    # The box is a rectangle of whole 512 m blocks.  z grows to the south, so the north edge of the
    # box sits at the northernmost point of the area (rounded up to a block edge) and the south edge
    # at the southernmost point (rounded up to a block edge too).
    origin_e = float(int(minx // BLOCK) * BLOCK)
    origin_n = float(-(-maxy // BLOCK) * BLOCK)
    width = float(-(-(maxx - origin_e) // BLOCK) * BLOCK)
    depth = float(-(-(origin_n - miny) // BLOCK) * BLOCK)

    polys = [area] if area.geom_type == "Polygon" else list(area.geoms)
    luref = []
    for g in polys:
        rr = [list(g.exterior.coords)] + [list(i.coords) for i in g.interiors]
        luref.append([[[round(x, 2), round(y, 2)] for x, y in r] for r in rr])
    world = [[[[round(x - origin_e, 2), round(origin_n - y, 2)] for x, y in r] for r in g] for g in luref]

    json.dump({"polygons": luref, "bounds": [minx, miny, maxx, maxy], "lonlat": lonlat},
              open(os.path.join(RAW, "area_luref.json"), "w", encoding="utf-8"))
    json.dump({"polygons": world, "bounds": [minx, miny, maxx, maxy]},
              open(os.path.join(RAW, "area_world.json"), "w", encoding="utf-8"))
    json.dump({"originE": origin_e, "originNTop": origin_n, "width": width, "depth": depth,
               "block": BLOCK, "bufferM": BUFFER_M, "areaKm2": round(area.area / 1e6, 2),
               "communeKm2": round(merged.area / 1e6, 2)},
              open(os.path.join(RAW, "world.json"), "w", encoding="utf-8"), indent=1)

    print("world: origin E %.0f N %.0f, box %.0f x %.0f m (%.1f km2)" %
          (origin_e, origin_n, width, depth, width * depth / 1e6))
    print("wrote", RAW)


if __name__ == "__main__":
    sys.exit(main())
