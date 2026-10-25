#!/usr/bin/env python3
"""Route the named trails over the OSM way graph and bake pb/mtb/data/trails.json.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/mtb/bake_trails.py        (then bake_ways.py, which cuts the used edges out of the plain way network)

scripts/mtb/trails.def.json lists the trails: an id, a grade (green / blue / red / black), names in four languages and `via` points
(world metres). The route between consecutive via points follows the cheapest OSM ways (paths preferred, see network.py), so every trail is a
REAL path. Output per trail: `line` (the chained OSM node positions, decimetres), length, climb and descent measured on the LiDAR terrain.
"""
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT_DIR, RAW_DIR  # noqa: E402
from network import load_graph  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SNAP_MAX = 60.0         # a via point farther than this from any way is an error (typo in the definition)


DTM = np.load(os.path.join(RAW_DIR, "dtm2.npy"))
GRADE_LIMIT = {"green": 0.09, "blue": 0.15, "red": 0.26, "black": 0.5}     # steepest comfortable grade per colour (rise / run)
GRADE_WEIGHT = 120.0


def height_at(x, z):
    nz, nx = DTM.shape
    i = min(nx - 2, max(0, x / 2.0)); j = min(nz - 2, max(0, z / 2.0))
    i0, j0 = int(i), int(j); fx, fz = i - i0, j - j0
    return float((DTM[j0, i0] * (1 - fx) + DTM[j0, i0 + 1] * fx) * (1 - fz) + (DTM[j0 + 1, i0] * (1 - fx) + DTM[j0 + 1, i0 + 1] * fx) * fz)


def terrain_profile(line):
    return [height_at(x, z) for x, z in line]


def remove_cycles(keys):
    """Cut every loop A..A out of the route: a via point that snaps onto a side stub would otherwise add an out-and-back spur."""
    out, where = [], {}
    for k in keys:
        if k in where:
            del out[where[k] + 1:]
            where = {kk: i for i, kk in enumerate(out)}
        else:
            where[k] = len(out)
            out.append(k)
    return out


def grade_penalty(graph, grade):
    """Edge multiplier: 1 up to the colour's comfortable grade, growing quadratically beyond it (a blue trail avoids a 45 degree scramble)."""
    limit = GRADE_LIMIT[grade]
    cache = {}

    def penalty(edge):
        if edge in cache:
            return cache[edge]
        (ax, az), (bx, bz) = graph.pos[edge[0]], graph.pos[edge[1]]
        run = max(1.0, math.hypot(bx - ax, bz - az))
        g = abs(height_at(bx, bz) - height_at(ax, az)) / run
        m = 1.0 + GRADE_WEIGHT * (max(0.0, g - limit) / 0.1) ** 2
        cache[edge] = m
        return m
    return penalty


def main():
    defs = json.load(open(os.path.join(HERE, "trails.def.json"), encoding="utf-8"))
    g = load_graph()
    used = set()
    trails = []
    for td in defs:
        keys = []
        penalty = grade_penalty(g, td["grade"])
        for a, b in zip(td["via"], td["via"][1:]):
            ka, da = g.nearest(*a)
            kb, db = g.nearest(*b)
            if max(da, db) > SNAP_MAX:
                raise SystemExit("%s: via point %s is %.0f m from the nearest way" % (td["id"], a if da > db else b, max(da, db)))
            seen = set(zip(keys, keys[1:])) | set(zip(keys[1:], keys))
            seg = g.route(ka, kb, lambda e: penalty(e) * (8.0 if e in seen else 1.0))        # no out-and-back along the same way
            keys.extend(seg if not keys else seg[1:])
        keys = remove_cycles(keys)
        line = [g.pos[k] for k in keys]
        for u, v in zip(keys, keys[1:]):
            used.add((u, v)); used.add((v, u))
        # drop immediate reversals (route goes out and comes back along the same edge at a via point)
        length = sum(math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]) for i in range(len(line) - 1))
        hs = terrain_profile(line)
        climb = sum(max(0.0, hs[i + 1] - hs[i]) for i in range(len(hs) - 1))
        descent = sum(max(0.0, hs[i] - hs[i + 1]) for i in range(len(hs) - 1))
        trails.append({"id": td["id"], "grade": td["grade"], "name": td["name"], "blurb": td.get("blurb", {}), "length": round(length, 1), "climb": round(climb, 1), "descent": round(descent, 1),
                       "line": [[round(x, 1), round(z, 1)] for x, z in line]})
        # steepest 20 m stretch of the route (rise / run on the LiDAR terrain), the number that decides whether a rider can pedal it
        worst = 0.0
        acc = [0.0]
        for i in range(len(line) - 1):
            acc.append(acc[-1] + math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]))
        j = 0
        for i in range(len(line)):
            while j < len(line) - 1 and acc[j] - acc[i] < 20.0:
                j += 1
            if acc[j] - acc[i] >= 15.0:
                worst = max(worst, abs(hs[j] - hs[i]) / (acc[j] - acc[i]))
        print("%-18s %-6s %6.0f m  up %4.0f  down %4.0f  %d points, steepest 20 m: %.0f %%" % (td["id"], td["grade"], length, climb, descent, len(line), worst * 100))
    with open(os.path.join(OUT_DIR, "trails.json"), "w", encoding="utf-8") as fh:
        json.dump({"version": 1, "trails": trails}, fh, separators=(",", ":"), ensure_ascii=False)
    with open(os.path.join(RAW_DIR, "used_edges.json"), "w") as fh:
        json.dump([[list(u), list(v)] for u, v in used], fh)
    print("trails.json", os.path.getsize(os.path.join(OUT_DIR, "trails.json")), "bytes;", len(used) // 2, "edges claimed")


if __name__ == "__main__":
    main()
