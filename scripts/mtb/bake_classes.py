#!/usr/bin/env python3
"""Rasterise the OSM land cover of the MTB world into pb/mtb/data/classes.bin (4 m cells, run-length coded) and the landmark list.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/mtb/bake_classes.py

Classes (also in pb/mtb/world-map.js):  0 unknown (the canopy decides)  1 forest  2 meadow / grass  3 farmland  4 built-up  5 water
                                        6 bare rock / quarry / scree  7 scrub / orchard / wetland
Later entries paint over earlier ones; buildings (dilated one cell) and water come last.
"""
import json
import os
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import LineString
from shapely.ops import polygonize, unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT_DIR, WORLD_H, WORLD_W, load_osm, lonlat_to_world  # noqa: E402

CELL = 4.0
NX, NZ = int(WORLD_W / CELL), int(WORLD_H / CELL)
LANDUSE = {"forest": 1, "meadow": 2, "grass": 2, "farmland": 3, "orchard": 7, "vineyard": 3, "residential": 4, "retail": 4, "industrial": 4, "quarry": 6,
           "cemetery": 2, "recreation_ground": 2, "allotments": 3}
NATURAL = {"wood": 1, "scrub": 7, "grassland": 2, "heath": 7, "wetland": 7, "bare_rock": 6, "scree": 6, "sand": 6, "water": 5}
LEISURE = {"park": 2, "pitch": 2, "golf_course": 2, "garden": 2, "playground": 2}
ORDER = {2: 0, 3: 0, 1: 1, 7: 1, 6: 2, 4: 3, 5: 4}        # paint order: grass/farmland, forest/scrub, rock, built-up, water


def klass(tags):
    if tags.get("natural") in NATURAL:
        return NATURAL[tags["natural"]]
    if tags.get("landuse") in LANDUSE:
        return LANDUSE[tags["landuse"]]
    if tags.get("leisure") in LEISURE:
        return LEISURE[tags["leisure"]]
    return None


def to_px(geom):
    xs, zs = lonlat_to_world([p["lon"] for p in geom], [p["lat"] for p in geom])
    return [(float(x) / CELL, float(z) / CELL) for x, z in zip(xs, zs)]


def rings_of_relation(el):
    outer, inner = [], []
    for m in el.get("members", []):
        g = m.get("geometry")
        if not g or len(g) < 2:
            continue
        line = LineString(to_px(g))
        (inner if m.get("role") == "inner" else outer).append(line)
    def polys(lines):
        if not lines:
            return []
        return list(polygonize(unary_union(lines)))
    return polys(outer), polys(inner)


def rle(data):
    out = bytearray(struct.pack("<HH", NX, NZ))
    flat = data.ravel()
    i = 0
    n = flat.size
    while i < n:
        v = flat[i]
        j = i + 1
        while j < n and flat[j] == v:
            j += 1
        run = j - i
        out.append(int(v))
        while run >= 0x80:
            out.append((run & 0x7F) | 0x80)
            run >>= 7
        out.append(run)
        i = j
    return bytes(out)


def main():
    img = Image.new("L", (NX, NZ), 0)
    draw = ImageDraw.Draw(img)
    items = []
    for el in load_osm("areas"):
        k = klass(el.get("tags", {}))
        if k is None:
            continue
        if el["type"] == "way" and el.get("geometry") and len(el["geometry"]) > 3:
            items.append((ORDER[k], k, [to_px(el["geometry"])], []))
        elif el["type"] == "relation":
            outer, inner = rings_of_relation(el)
            items.append((ORDER[k], k, [list(p.exterior.coords) for p in outer], [list(p.exterior.coords) for p in inner]))
    items.sort(key=lambda it: it[0])
    for _, k, outers, inners in items:
        for ring in outers:
            if len(ring) >= 3:
                draw.polygon(ring, fill=k)
        for ring in inners:
            if len(ring) >= 3:
                draw.polygon(ring, fill=0)
    # buildings: footprint + one cell
    nb = 0
    for el in load_osm("buildings"):
        if el.get("geometry") and len(el["geometry"]) > 3:
            pts = to_px(el["geometry"])
            draw.polygon(pts, fill=4)
            draw.line(pts, fill=4, width=2)
            nb += 1
    # (W2) streams are real carved channels with their own water ribbon now (bake_features.py): the class raster only keeps water AREAS, no painted stripes
    arr = np.array(img, dtype=np.uint8)
    blob = rle(arr)
    with open(os.path.join(OUT_DIR, "classes.bin"), "wb") as fh:
        fh.write(blob)
    counts = {int(k): int((arr == k).sum()) for k in range(8)}
    print("classes.bin", len(blob), "bytes;", nb, "buildings;", {k: "%.1f%%" % (100 * v / arr.size) for k, v in counts.items()})
    # POI / landmarks
    if True:
        pois = []
        for el in load_osm("poi") + [e for e in load_osm("waterways") if e["type"] == "node"]:
            t = el.get("tags", {})
            lat = el.get("lat") or el.get("center", {}).get("lat")
            lon = el.get("lon") or el.get("center", {}).get("lon")
            if lat is None:
                continue
            x, z = lonlat_to_world(lon, lat)
            if 0 <= x <= WORLD_W and 0 <= z <= WORLD_H and (t.get("name") or t.get("tourism") == "viewpoint"):
                kind = t.get("tourism") or t.get("natural") or t.get("historic") or t.get("amenity") or t.get("place") or t.get("waterway") or "poi"
                pois.append({"x": round(float(x), 1), "z": round(float(z), 1), "kind": kind, "name": t.get("name", "")})
        with open(os.path.join(OUT_DIR, "landmarks.json"), "w", encoding="utf-8") as fh:
            json.dump(pois, fh, ensure_ascii=False, separators=(",", ":"))
        print("landmarks", len(pois))


if __name__ == "__main__":
    main()
