#!/usr/bin/env python3
"""Campus Geesseknäppchen: bakes pb/lux-drive/campus-data.js (the footprints, heights, colours and grounds of the campus).

    ~/Library/Caches/luxtram-work/.venv/bin/python -I scripts/luxdrive/campus_bake.py

Inputs (all in ~/Library/Caches/luxdrive-work, never in the repo):
  campus/refs/osm_campus_raw.json   OSM (Overpass, ODbL) of the bbox 49.5985,6.1040 .. 49.6065,6.1170 (`out tags geom`)
  campus/refs/ortho_campus.jpg      geoportail.lu orthophoto (ortho_latest, EPSG:2169, 0.25 m/px) of x 3100..4000, z 9450..10080:
                                    used ONLY to read the roof and ground colours (never drawn in the game)
  raw/dsm4.npy, raw/dtm4.npy        the LiDAR surface / terrain models of the bake (4 m): the roof elevation of every part
  campus/refs/lod2_campus.json      the LOD2 blocks of buildings.bin near the campus (tools/dump_lod2.mjs): which blocks a building replaces
The spec (what the buildings are made of) is campus_spec.py.  Output coordinates are the world frame (x east, z south, m)."""
import json
import os
import sys

import numpy as np
from PIL import Image
from shapely.geometry import Polygon, MultiPolygon, box
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import campus_spec as S  # noqa: E402
from campus_osm import OSM, REFS, WORK  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "pb", "lux-drive", "campus-data.js")
ORTHO_X0, ORTHO_Z0, ORTHO_PPM = 3100.0, 9450.0, 4.0
DSM = np.load(os.path.join(WORK, "raw", "dsm4.npy"), mmap_mode="r")
DTM = np.load(os.path.join(WORK, "raw", "dtm4.npy"), mmap_mode="r")
ORTHO = np.asarray(Image.open(os.path.join(REFS, "ortho_campus.jpg")).convert("RGB"))
MIN_PART_WIDTH = 1.6  # m: mean width (area / half the perimeter): a thinner cut is a sliver of two nearly equal outlines and would double a wall
MIN_PART_AREA = 6.0   # m2: smaller slivers of a cut are dropped
SIMPLIFY = 0.12       # m: collinear and doubled points of a cut are removed
ROOF_DARKEN = 0.52    # the game's painted light brightens flat colours: the orthophoto's roof grey would read pale
SHRINK = 1.6          # m: the roof samples keep away from the walls (the 4 m LiDAR grid blurs edges)


def dsm(x, z):
    return float(DSM[int(z // 4), int(x // 4)])


def dtm(x, z):
    return float(DTM[int(z // 4), int(x // 4)])


def sample_points(poly, step=2.0):
    inner = poly.buffer(-SHRINK)
    if inner.is_empty:
        inner = poly.buffer(-0.5)
    if inner.is_empty:
        return [(poly.centroid.x, poly.centroid.y)]
    minx, miny, maxx, maxy = inner.bounds
    pts = []
    x = minx
    while x <= maxx:
        z = miny
        while z <= maxy:
            if inner.contains(__import__("shapely.geometry", fromlist=["Point"]).Point(x, z)):
                pts.append((x, z))
            z += step
        x += step
    return pts or [(poly.centroid.x, poly.centroid.y)]


def roof_top(poly, pct):
    """The roof elevation of a part: a low percentile of the LiDAR surface under it (the plant on a roof does not make the roof)."""
    vals = [dsm(x, z) for x, z in sample_points(poly)]
    return round(float(np.percentile(vals, pct)), 1)


def ground_mean(poly):
    vals = [dtm(x, z) for x, z in sample_points(poly)]
    return float(np.mean(vals))


def ortho_color(poly):
    """The median colour of the orthophoto inside a polygon (a reference for the painted flat colour, never a texture)."""
    pts = sample_points(poly, 1.0)
    cols = []
    for x, z in pts:
        px = int((x - ORTHO_X0) * ORTHO_PPM); pz = int((z - ORTHO_Z0) * ORTHO_PPM)
        if 0 <= pz < ORTHO.shape[0] and 0 <= px < ORTHO.shape[1]:
            cols.append(ORTHO[pz, px])
    if not cols:
        return None
    m = np.median(np.array(cols, dtype=float), axis=0) / 255.0 * ROOF_DARKEN
    return [round(float(v), 3) for v in m]


def rings(geom):
    """The outer rings of a (multi)polygon, as lists of [x, z] (no closing point)."""
    polys = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom]
    out = []
    for p in polys:
        if p.geom_type != "Polygon" or p.is_empty or p.area < MIN_PART_AREA or p.area / (p.length / 2) < MIN_PART_WIDTH:
            continue
        ring = [[round(x, 1), round(z, 1)] for x, z in list(p.simplify(SIMPLIFY).exterior.coords)[:-1]]
        clean = [q for i, q in enumerate(ring) if i == 0 or (abs(q[0] - ring[i - 1][0]) + abs(q[1] - ring[i - 1][1])) > 0.25]
        if len(clean) >= 3:
            out.append(clean)
    return out


def bake_buildings(lod2):
    buildings = []
    hide = set()
    parts_all = []
    for b in S.BUILDINGS:
        placed = []                       # the polygons of the earlier parts of this building (a later part wins the overlap)
        out_parts = []
        for spec in b["parts"]:
            poly = spec["poly"]
            if not poly.is_valid:
                poly = poly.buffer(0)
            fp = b.get("footprint")
            if spec.get("clip", True) and fp is not None:
                poly = poly.intersection(fp)
            later = [q["poly"] for q in b["parts"] if q.get("order", 0) > spec.get("order", 0)]
            if later:
                poly = poly.difference(unary_union([p if p.is_valid else p.buffer(0) for p in later]))
            for i, ring in enumerate(rings(poly)):
                pg = Polygon(ring)
                top = spec.get("top")
                if top is None and spec.get("dh") is not None:
                    top = ground_mean(pg) + spec["dh"]
                if top is None:
                    top = roof_top(pg, spec.get("pct", 35)) + spec.get("dtop", 0.0)
                roof = spec.get("roof") or ortho_color(pg)
                part = {"key": spec["key"] + (f"#{i}" if i else ""), "pts": ring, "top": round(top, 1),
                        "wall": spec["wall"], "roof": roof, "fx": spec.get("fx", "blank"), "fp": spec.get("fp", {}),
                        "rf": spec.get("rf", {})}
                out_parts.append(part)
                parts_all.append(pg)
        outline = unary_union([Polygon(p["pts"]).buffer(0.05) for p in out_parts]).buffer(-0.05)
        mine = []
        buildings.append({"key": b["key"], "name": b["name"], "zone": b["zone"], "parts": out_parts, "outline": rings(outline), "custom": b.get("custom"), "hide": mine})
        for blk in lod2:
            bp = Polygon(blk["pts"]).buffer(0)
            if bp.is_empty or blk["id"] in S.NEVER_HIDE:
                continue
            over = bp.intersection(outline).area / bp.area
            if blk["id"] in b.get("lod2", []):
                hide.add(blk["id"])
                mine.append(blk["id"])
                if over < 0.2:
                    print(f"  WARN {b['key']}: LOD2 {blk['id']} overlaps only {over:.0%}")
            elif over > 0.5 and blk["id"] not in b.get("lod2", []):
                print(f"  NOTE {b['key']}: LOD2 block {blk['id']} is {over:.0%} covered but not in lod2=[...]")
    return buildings, sorted(hide)


PATH_WIDTH = {"footway": 2.4, "pedestrian": 3.0, "path": 1.9, "cycleway": 2.6}
PATH_COLOR = [0.60, 0.58, 0.52]


def bake_paths(buildings, lod2):
    """The footpaths of the game's own network (roads.bin, dumped by campus/tools/dump_roads.mjs) inside the campus: the game keeps them as thin
    painted lines that vanish at a few metres, but the paths are what links the schools, so they are drawn here as ribbons (not carved, like
    everywhere in the game).  Pieces under a building are cut out."""
    from shapely.geometry import LineString
    campus = Polygon(OSM[S.CAMPUS_WAY]["pts"][:-1]).buffer(12)
    solid = unary_union([Polygon(p["pts"]).buffer(0.3) for b in buildings for p in b["parts"]] + [Polygon(b["pts"]).buffer(0.2) for b in lod2 if b["id"] in S.HIDDEN_PATH_BLOCKS])
    out = []
    for r in json.load(open(os.path.join(REFS, "roads_campus.json"))):
        if r["kind"] not in PATH_WIDTH or r.get("layer", 0) != 0 or len(r["pts"]) < 2:
            continue
        line = LineString(r["pts"]).intersection(campus).difference(solid)
        parts = list(line.geoms) if line.geom_type == "MultiLineString" else [line]
        for seg in parts:
            if seg.geom_type != "LineString" or seg.length < 3:
                continue
            seg = seg.simplify(0.4)
            out.append({"pts": [[round(x, 1), round(z, 1)] for x, z in seg.coords], "w": PATH_WIDTH[r["kind"]], "c": PATH_COLOR})
    return out


def main():
    lod2 = json.load(open(os.path.join(REFS, "lod2_campus.json")))
    buildings, hide = bake_buildings(lod2)
    data = {"buildings": buildings}
    data.update(S.bake_grounds(OSM, ortho_color) if hasattr(S, "bake_grounds") else {})
    data["paths"] = bake_paths(buildings, lod2)
    js = "/* GENERATED by scripts/luxdrive/campus_bake.py - do not edit by hand.\n * Sources: OpenStreetMap (c) contributors (ODbL), the LiDAR surface model of the bake (CC0, ACT Luxembourg), colours read from the geoportail.lu orthophoto (a reference, never drawn). */\n"
    js += "export const CAMPUS = " + json.dumps(data, separators=(",", ":")) + ";\n"
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(js)
    n = sum(len(b["parts"]) for b in buildings)
    print(f"campus-data.js: {len(buildings)} buildings, {n} parts, hide {len(hide)} LOD2 blocks, {len(js) / 1024:.0f} kB")
    json.dump([{"key": p["key"], "pts": p["pts"], "top": p["top"]} for b in buildings for p in b["parts"]], open(os.path.join(REFS, "..", "parts.json"), "w"))


if __name__ == "__main__":
    main()
