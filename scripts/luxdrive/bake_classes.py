#!/usr/bin/env python3
"""Bake the land classes of Lux Drive into pb/lux-drive/data/classes.bin.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/luxdrive/bake_classes.py

An 8 m class map of the whole world box (fields, forest, water, parks, the built-up city) - the
ground shader paints it, the props (trees, hedges, reeds) read it.

classes.bin layout: a run length encoding of the class bytes, row major, north to south:
    varint (run length - 1), u8 class
"""
import json
import os
import sys

import numpy as np
from rasterio.features import rasterize
from rasterio.transform import from_origin
from shapely.geometry import shape, LineString
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (ORIGIN_E, ORIGIN_N_TOP, OUT_DIR, RAW_DIR, WORLD_H, WORLD_W,
                    lonlat_to_luref)  # noqa: E402

STEP = 8.0
CLASS_NAMES = ["grass", "forest", "water", "park", "urban", "farmland", "sand", "scrub"]
C_GRASS, C_FOREST, C_WATER, C_PARK, C_URBAN, C_FARM, C_SAND, C_SCRUB = range(8)
# How far the built-up area reaches past the houses (in cells of 8 m): the streets between the houses belong to
# the town, not to the meadow.
URBAN_GROWTH_CELLS = 2


def dilate(mask, radius):
    """The mask grows by `radius` cells.  A square dilation, done with slices (no wrap around at the border)."""
    out = mask.copy()
    nz, nx = mask.shape
    for dx in range(-radius, radius + 1):
        for dz in range(-radius, radius + 1):
            if dx == 0 and dz == 0:
                continue
            xs0, xs1 = max(0, dx), min(nx, nx + dx)
            zs0, zs1 = max(0, dz), min(nz, nz + dz)
            out[zs0:zs1, xs0:xs1] |= mask[zs0 - dz:zs1 - dz, xs0 - dx:xs1 - dx]
    return out

# the OSM tags of each class, in the order they are painted (later wins)
RULES = [
    (C_FARM, "landuse", ["farmland", "farmyard", "orchard", "vineyard", "meadow"]),
    (C_SCRUB, "natural", ["scrub", "heath", "grassland"]),
    (C_FOREST, "natural", ["wood", "forest"]),
    (C_FOREST, "landuse", ["forest"]),
    (C_PARK, "leisure", ["park", "garden", "pitch", "playground", "recreation_ground", "nature_reserve"]),
    (C_SAND, "natural", ["sand", "beach"]),
    (C_SCRUB, "natural", ["bare_rock", "scree"]),
    (C_URBAN, "landuse", ["residential", "commercial", "industrial", "retail", "quarry", "construction"]),
    (C_URBAN, "amenity", ["parking", "school", "university", "hospital"]),
    (C_URBAN, "railway", ["rail"]),
]


def main():
    osm = json.load(open(os.path.join(RAW_DIR, "osm.json"), encoding="utf-8"))
    ways = {w["id"]: w for w in osm["ways"]}

    def geometry_of(way):
        """The ring of a way in LUREF (the class raster is in the national grid)."""
        lons, lats = [], []
        for nid in way["n"]:
            p = osm["nodes"].get(str(nid))
            if p:
                lons.append(p[0])
                lats.append(p[1])
        if not lons:
            return []
        e, n = lonlat_to_luref(lons, lats)
        return list(zip(e.tolist(), n.tolist()))

    # ---- the polygons of each class ---------------------------------------
    buckets = {c: [] for c in range(8)}
    for w in osm["ways"]:
        t = w["t"]
        pts = geometry_of(w)
        if len(pts) < 3:
            continue
        closed = abs(pts[0][0] - pts[-1][0]) < 1e-7 and abs(pts[0][1] - pts[-1][1]) < 1e-7
        if not closed:
            continue
        for cls, key, values in RULES:
            if t.get(key) not in values:
                continue
            try:
                buckets[cls].append(shape({"type": "Polygon", "coordinates": [pts]}))
            except Exception:
                pass
            break
    # the water: the natural=water areas and the river banks
    for w in osm["ways"]:
        t = w["t"]
        if t.get("natural") == "water" or t.get("waterway") in ("riverbank", "dock"):
            pts = geometry_of(w)
            if len(pts) > 2:
                try:
                    buckets[C_WATER].append(shape({"type": "Polygon", "coordinates": [pts]}))
                except Exception:
                    pass
    # the railways as thin lines (they are not areas)
    rails = []
    for w in osm["ways"]:
        if w["t"].get("railway") in ("rail", "tram", "light_rail", "subway", "narrow_gauge"):
            pts = geometry_of(w)
            if len(pts) > 1:
                rails.append(LineString(pts))

    nx = int(WORLD_W / STEP) + 1
    nz = int(WORLD_H / STEP) + 1
    transform = from_origin(ORIGIN_E, ORIGIN_N_TOP, STEP, STEP)
    grid = np.zeros((nz, nx), dtype=np.uint8)

    for cls in (C_FARM, C_SCRUB, C_PARK, C_SAND, C_URBAN, C_FOREST):
        polys = [p for p in buckets[cls] if p.is_valid]
        if not polys:
            continue
        merged = unary_union(polys)
        shapes = merged.geoms if merged.geom_type == "MultiPolygon" else [merged]
        shapes = [s for s in shapes if s.geom_type in ("Polygon", "MultiPolygon")]
        if not shapes:
            continue
        burned = rasterize([(s, 1) for s in shapes], out_shape=(nz, nx), transform=transform,
                           fill=0, dtype=np.uint8, all_touched=False)
        grid[burned > 0] = cls
        print("  %-10s %6d cells" % (CLASS_NAMES[cls], int((burned > 0).sum())))

    # the water last: it covers everything else
    polys = [p for p in buckets[C_WATER] if p.is_valid]
    if polys:
        merged = unary_union(polys)
        shapes = merged.geoms if merged.geom_type == "MultiPolygon" else [merged]
        shapes = [s for s in shapes if s.geom_type in ("Polygon", "MultiPolygon")]
        burned = rasterize([(s, 1) for s in shapes], out_shape=(nz, nx), transform=transform,
                           fill=0, dtype=np.uint8)
        grid[burned > 0] = C_WATER
        print("  %-10s %6d cells" % ("water", int((burned > 0).sum())))

    # ---- the city: where the buildings are -------------------------------
    import buildings_io  # noqa: E402
    bl = buildings_io.decode_buildings()
    shapes = []
    for b in bl:
        pts = [(p[0] + ORIGIN_E, ORIGIN_N_TOP - p[1]) for p in b["pts"]]
        if len(pts) >= 3:
            try:
                shapes.append(shape({"type": "Polygon", "coordinates": [pts]}))
            except Exception:
                pass
    if shapes:
        burned = rasterize([(s, 1) for s in shapes], out_shape=(nz, nx), transform=transform,
                           fill=0, dtype=np.uint8)
        # The built-up area is the houses AND the streets between them: the class grows by two cells (16 m), so
        # the ground of the town is hard ground and not the lawn of the fields.  The parks and the water keep
        # their class: a park in the middle of the city is a park.
        dense = dilate(burned > 0, URBAN_GROWTH_CELLS)
        keep = (grid != C_WATER) & (grid != C_PARK) & (grid != C_FOREST) & (grid != C_FARM)
        urban = dense & keep
        grid[urban] = C_URBAN
        print("  urban from the buildings: %d cells" % int(urban.sum()))

    # ---- the forest also grows where the LiDAR sees a canopy ---------------
    canopy = np.load(os.path.join(RAW_DIR, "dsm4.npy")).astype(np.float64)
    dtm = np.load(os.path.join(RAW_DIR, "dtm4.npy")).astype(np.float64)
    cover = np.clip((canopy - dtm - 5.0) / 6.0, 0, 1)
    rows = min(nz * 2, cover.shape[0]) & ~1
    cols = min(nx * 2, cover.shape[1]) & ~1
    small = cover[:rows, :cols].reshape(rows // 2, 2, cols // 2, 2).mean(axis=(1, 3))
    below = grid[:small.shape[0], :small.shape[1]]
    forest = ((small > 0.45) & (below != C_WATER) & (below != C_URBAN)
              & (below != C_SAND) & (below != C_FARM))
    grid[:forest.shape[0], :forest.shape[1]][forest] = C_FOREST
    print("  forest from the canopy: %d cells" % int(forest.sum()))

    # ---- the run length encoding -----------------------------------------
    out = bytearray()
    flat = grid.ravel()
    i = 0
    n = flat.size
    while i < n:
        j = i + 1
        while j < n and flat[j] == flat[i]:
            j += 1
        run = j - i
        while run > 0:
            take = min(run, 16383)
            out += varint(take - 1)
            out.append(int(flat[i]))
            run -= take
            i += take
        i = j

    with open(os.path.join(OUT_DIR, "classes.bin"), "wb") as fh:
        fh.write(out)
    counts = {CLASS_NAMES[c]: int((grid == c).sum()) for c in range(8)}
    meta = {"nx": nx, "nz": nz, "step": STEP, "classes": CLASS_NAMES, "counts": counts,
            "bytes": len(out)}
    with open(os.path.join(OUT_DIR, "classes.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=1)
    print("classes.bin %.2f MB" % (len(out) / 1048576.0))
    print(counts)


def varint(n):
    out = bytearray()
    while n >= 0x80:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    out.append(n)
    return bytes(out)


if __name__ == "__main__":
    main()
