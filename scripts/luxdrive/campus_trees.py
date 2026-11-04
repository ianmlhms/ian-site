#!/usr/bin/env python3
"""Campus Geesseknäppchen: the trees (pb/lux-drive/campus-trees-data.js).

The game has no trees on the campus (its woods come from the canopy of forest areas, its OSM trees are the street trees).  The campus is a
park full of groves, tree rows and single trees, so they are placed here: every OSM natural=tree node of the campus, and the crowns the
LiDAR surface model (4 m) shows (surface minus terrain >= 3 m) outside every building, thinned so that two trunks stand at least a crown apart.

    ~/Library/Caches/luxtram-work/.venv/bin/python -I scripts/luxdrive/campus_trees.py   (after campus_bake.py: it keeps off the new buildings)

A tree: [x, z, height m, kind (0 beech, 1 oak), girth percent (crown width / height)]."""
import json
import math
import os
import random
import sys

import numpy as np
from shapely.geometry import Point, Polygon, LineString, box
from shapely.ops import unary_union
from shapely.strtree import STRtree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from campus_osm import OSM, REFS, WORK  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "pb", "lux-drive", "campus-trees-data.js")
DSM = np.load(os.path.join(WORK, "raw", "dsm4.npy"), mmap_mode="r")
DTM = np.load(os.path.join(WORK, "raw", "dtm4.npy"), mmap_mode="r")
CAMPUS_WAY = 26245561
MIN_HEIGHT = 3.2          # m: lower than this is a hedge or a bush, not a tree
MAX_HEIGHT = 27.0
BUILDING_MARGIN = 2.2     # m: no tree this close to a wall (the LiDAR of a roof edge looks like a crown)
ROAD_KERB = 1.0           # m: no trunk this close to the edge of a carriageway
REACH = 40.0              # m: the campus polygon grown by this
RNG = random.Random(20261104)


def n_dsm(x, z):
    return float(DSM[int(z // 4), int(x // 4)] - DTM[int(z // 4), int(x // 4)])


def main():
    lod2 = json.load(open(os.path.join(REFS, "lod2_campus.json")))
    # the campus grown by REACH, plus the boulevard rows south of it (the box): the park the pupils walk through
    campus = unary_union([Polygon(OSM[CAMPUS_WAY]["pts"][:-1]).buffer(REACH), box(3150, 9480, 4000, 10100)])
    mine = json.load(open(os.path.join(REFS, "..", "parts.json")))
    blocked = [Polygon(b["pts"]).buffer(BUILDING_MARGIN) for b in lod2] + [Polygon(p["pts"]).buffer(BUILDING_MARGIN) for p in mine]
    for o in OSM.values():
        if o["type"] == "way" and "building" in o["tags"] and len(o["pts"]) > 3:
            blocked.append(Polygon(o["pts"]).buffer(BUILDING_MARGIN))
    # the ways of the GAME (roads.bin, dumped by tools/dump_roads.mjs): a trunk stays off the carriageway (half the width + the kerb) and off the paths
    for r in json.load(open(os.path.join(REFS, "roads_campus.json"))):
        if len(r["pts"]) < 2:
            continue
        foot = r["kind"] in ("footway", "path", "steps", "cycleway", "bridleway")
        blocked.append(LineString(r["pts"]).buffer((r["width"] or 2.0) / 2 + (0.5 if foot else ROAD_KERB)))
    block = unary_union(blocked)
    tree_block = STRtree([block])
    kept = []                              # (x, z, h)
    # the street trees the game already has (trees.bin, dumped by tools/dump_trees.mjs) take their place: none of ours stands on or beside them
    game = [(x, z, 9.0) for x, z in json.load(open(os.path.join(REFS, "trees_game.json")))]
    # the street trees the game already has (trees.bin, dumped by tools/dump_trees.mjs) take their place: none of ours stands on or beside them
    game = [(x, z, 9.0) for x, z in json.load(open(os.path.join(REFS, "trees_game.json")))]

    def free(x, z):
        p = Point(x, z)
        return campus.contains(p) and not block.contains(p)

    def spaced(x, z, h):
        r = 0.26 * h + 1.9
        return all((x - kx) ** 2 + (z - kz) ** 2 >= (r + 0.26 * kh + 1.9) ** 2 * 0.42 for kx, kz, kh in kept)

    # OSM trees first: they are real, tagged ones
    for o in OSM.values():
        if o["type"] == "node" and o["tags"].get("natural") == "tree":
            x, z = o["pts"][0]
            if not free(x, z):
                continue
            h = float(str(o["tags"].get("height", "")).replace(",", ".") or 0) or max(MIN_HEIGHT + 2, min(MAX_HEIGHT, n_dsm(x, z)))
            kept.append((x, z, min(MAX_HEIGHT, max(4.0, h))))
    n_osm = len(kept)
    kept = game + kept
    minx, minz, maxx, maxz = campus.bounds
    cells = []
    z = minz
    while z < maxz:
        x = minx
        while x < maxx:
            h = n_dsm(x + 2, z + 2)
            if MIN_HEIGHT <= h <= MAX_HEIGHT + 6:
                cells.append((h, x + 2, z + 2))
            x += 4
        z += 4
    cells.sort(reverse=True)                # the tall crowns first: they keep their place, the small ones fill in
    for h, cx, cz in cells:
        x = cx + RNG.uniform(-1.6, 1.6)
        z = cz + RNG.uniform(-1.6, 1.6)
        if not free(x, z):
            continue
        height = min(MAX_HEIGHT, h)
        if spaced(x, z, height):
            kept.append((x, z, height))
    out = []
    for x, z, h in kept[len(game):]:
        crown = 0.5 * h + 2.2
        girth = max(0.52, min(0.95, crown / h))
        out.append([round(x, 1), round(z, 1), round(h, 1), RNG.randint(0, 1), round(girth * 100)])
    js = "/* GENERATED by scripts/luxdrive/campus_trees.py - do not edit by hand.\n * The trees of Campus Geesseknäppchen: OSM natural=tree nodes (ODbL, (c) OpenStreetMap contributors) and the crowns of the LiDAR surface model (CC0, ACT Luxembourg).\n * [x, z, height m, kind, girth percent] */\n"
    js += "export const CAMPUS_TREES = " + json.dumps(out, separators=(",", ":")) + ";\n"
    open(OUT, "w", encoding="utf-8").write(js)
    print(f"campus-trees-data.js: {len(out)} trees ({n_osm} from OSM), {len(js) / 1024:.0f} kB")


if __name__ == "__main__":
    main()
