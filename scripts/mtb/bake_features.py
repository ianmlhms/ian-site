#!/usr/bin/env python3
"""Bake the W2 world features: streams, cliffs, forest leaf type, field ids.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/mtb/bake_features.py

Outputs in pb/mtb/data/:
  streams.bin + streams.json  OSM waterways (stream / river / ditch) in the ways format of bake_ways.py (kind 4 stream, 5 river, 6 ditch); the way direction is the flow direction.
                              `f` flag bit 2 (value 2) = culvert / tunnel (never carved).  falls.json = the waterfall nodes of OSM.
  cliffs.bin + cliffs.json    OSM natural=cliff lines (kind 7). OSM rule: the drop is on the RIGHT of the way direction.
  leaf.bin                    4 m raster, run-length coded: 0 unknown, 1 broadleaved, 2 needleleaved, 3 mixed (OSM leaf_type of forest areas).
  fields.bin                  4 m raster, run-length coded: 0 none, 1..199 a meadow / grass / farmland / orchard polygon id (the shader hashes it to a crop pattern, the
                              hedgerows stand where the id changes).
"""
import json
import os
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import LineString, Polygon, box

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake_classes import CELL, NX, NZ, rings_of_relation, rle, to_px  # noqa: E402
from bake_ways import SIMPLIFY_M, varint, zigzag  # noqa: E402
from common import OUT_DIR, WORLD_H, WORLD_W, load_osm, lonlat_to_world  # noqa: E402

MARGIN = 100.0
STREAM_KIND = {"stream": 4, "brook": 4, "river": 5, "ditch": 6, "drain": 6}
CLIFF_KIND = 7
LEAF = {"broadleaved": 1, "needleleaved": 2, "mixed": 3}
FIELD_LANDUSE = {"meadow", "grass", "farmland", "orchard", "vineyard", "allotments", "recreation_ground"}
FIELD_IDS = 199


def write_lines(name, items):
    """items: [(kind, flags, osm_id, tags, [(x, z) ...])] -> <name>.bin + <name>.json (the ways.bin layout)."""
    meta, blob = [], bytearray()
    for kind, flags, oid, tags, pts in items:
        idx = len(meta)
        length = sum(((pts[i + 1][0] - pts[i][0]) ** 2 + (pts[i + 1][1] - pts[i][1]) ** 2) ** 0.5 for i in range(len(pts) - 1))
        row = {"id": oid, "k": kind, "m": 255, "s": 0, "f": flags, "len": round(length, 1)}
        if tags.get("name"):
            row["n"] = tags["name"]
        meta.append(row)
        blob += struct.pack("<H", len(pts))
        px, pz = round(pts[0][0] * 10), round(pts[0][1] * 10)
        blob += struct.pack("<ii", px, pz)
        for x, z in pts[1:]:
            qx, qz = round(x * 10), round(z * 10)
            varint(zigzag(qx - px), blob)
            varint(zigzag(qz - pz), blob)
            px, pz = qx, qz
    out = struct.pack("<I", len(meta)) + bytes(blob)
    with open(os.path.join(OUT_DIR, name + ".bin"), "wb") as fh:
        fh.write(out)
    with open(os.path.join(OUT_DIR, name + ".json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, separators=(",", ":"), ensure_ascii=False)
    print(name, len(meta), "lines,", round(sum(m["len"] for m in meta) / 1000, 1), "km,", len(out), "bytes")


def clipped_lines(geometry, clip):
    xs, zs = lonlat_to_world([p["lon"] for p in geometry], [p["lat"] for p in geometry])
    parts = LineString(list(zip(xs.tolist(), zs.tolist()))).intersection(clip)
    geoms = [parts] if parts.geom_type == "LineString" else [g for g in getattr(parts, "geoms", []) if g.geom_type == "LineString"]
    out = []
    for g in geoms:
        if g.length < 3:
            continue
        g = g.simplify(SIMPLIFY_M, preserve_topology=False)
        if len(list(g.coords)) >= 2:
            out.append(list(g.coords))
    return out


def bake_streams(clip):
    items, falls = [], []
    for el in load_osm("waterways"):
        tags = el.get("tags", {})
        if el["type"] == "node" and tags.get("waterway") == "waterfall":
            x, z = lonlat_to_world(el["lon"], el["lat"])
            if 0 <= x <= WORLD_W and 0 <= z <= WORLD_H:
                falls.append({"x": round(float(x), 1), "z": round(float(z), 1), "name": tags.get("name", "")})
            continue
        kind = STREAM_KIND.get(tags.get("waterway"))
        if kind is None or el["type"] != "way" or "geometry" not in el:
            continue
        underground = tags.get("tunnel") not in (None, "no") or tags.get("culvert") not in (None, "no")
        for pts in clipped_lines(el["geometry"], clip):
            items.append((kind, 2 if underground else 0, el["id"], tags, pts))
    write_lines("streams", items)
    with open(os.path.join(OUT_DIR, "falls.json"), "w", encoding="utf-8") as fh:
        json.dump(falls, fh, ensure_ascii=False, separators=(",", ":"))
    print("falls", falls)


def bake_cliffs(clip):
    items = []
    for el in load_osm("areas"):
        tags = el.get("tags", {})
        if el["type"] != "way" or tags.get("natural") != "cliff" or "geometry" not in el:
            continue
        for pts in clipped_lines(el["geometry"], clip):
            items.append((CLIFF_KIND, 0, el["id"], tags, pts))
    write_lines("cliffs", items)


def paint(img_draw, items):
    for _, value, outers, inners in items:
        for ring in outers:
            if len(ring) >= 3:
                img_draw.polygon(ring, fill=value)
        for ring in inners:
            if len(ring) >= 3:
                img_draw.polygon(ring, fill=0)


def polygons(filter_fn, value_fn):
    items = []
    for el in load_osm("areas"):
        tags = el.get("tags", {})
        if not filter_fn(tags):
            continue
        if el["type"] == "way" and el.get("geometry") and len(el["geometry"]) > 3:
            ring = to_px(el["geometry"])
            area = Polygon(ring).area if len(ring) >= 3 else 0
            items.append((area, value_fn(el), [ring], []))
        elif el["type"] == "relation":
            outer, inner = rings_of_relation(el)
            area = sum(p.area for p in outer)
            items.append((area, value_fn(el), [list(p.exterior.coords) for p in outer], [list(p.exterior.coords) for p in inner]))
    items.sort(key=lambda it: -it[0])           # big first: small polygons are painted over them
    return items


def bake_leaf():
    img = Image.new("L", (NX, NZ), 0)
    items = polygons(lambda t: t.get("landuse") == "forest" or t.get("natural") == "wood", lambda el: LEAF.get(el.get("tags", {}).get("leaf_type"), 0))
    paint(ImageDraw.Draw(img), items)
    arr = np.array(img, dtype=np.uint8)
    with open(os.path.join(OUT_DIR, "leaf.bin"), "wb") as fh:
        fh.write(rle(arr))
    print("leaf.bin", {k: "%.1f%%" % (100 * (arr == k).sum() / arr.size) for k in range(4)})


def bake_fields():
    img = Image.new("L", (NX, NZ), 0)
    counter = {"n": 0}

    def next_id(_el):
        counter["n"] += 1
        return 1 + (counter["n"] * 7) % FIELD_IDS            # neighbouring polygons get unrelated ids

    items = polygons(lambda t: t.get("landuse") in FIELD_LANDUSE or t.get("natural") == "grassland", next_id)
    paint(ImageDraw.Draw(img), items)
    arr = np.array(img, dtype=np.uint8)
    with open(os.path.join(OUT_DIR, "fields.bin"), "wb") as fh:
        fh.write(rle(arr))
    print("fields.bin", len(items), "polygons,", "%.1f%% covered" % (100 * (arr > 0).sum() / arr.size))


if __name__ == "__main__":
    clip_box = box(-MARGIN, -MARGIN, WORLD_W + MARGIN, WORLD_H + MARGIN)
    bake_streams(clip_box)
    bake_cliffs(clip_box)
    bake_leaf()
    bake_fields()
