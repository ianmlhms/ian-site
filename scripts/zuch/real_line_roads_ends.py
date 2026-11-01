#!/usr/bin/env python3
"""W5 roads3: every visible road ends at something.

After the tidy (real_line_roads_tidy.py) some roads still stopped dead in an open field, a few hundred game metres from the line (paris / brussels / metz, k >= 6: the pieces
the shear / skew / thin / claim steps left behind).  A road end (game coordinates s, lat) is acceptable when
  * another road, a crossing arm or an overbridge touches it (a junction),
  * it lies in built-up land (residential / industrial / urban cells of the land raster within BUILT_R): a street ending at its houses,
  * it lies at the edge of the visible strip (|lat| >= EDGE_LAT: the road goes on beyond what is drawn) or beside the rail corridor (|lat| < NEAR_LAT: the road runs to the
    line, where an overbridge / underpass / crossing the game does not model carries it on).
Every other free end is fixed, in this order:
  1. JOIN    another free road end within JOIN_MAX that points the same way (near-collinear fragments of one road): the two are bridged (one road),
  2. SNAP    a road / arm / overbridge line hit by the extension of the end within SNAP_MAX: the end is extended to it (a T-junction),
  3. REACH   an important road (motorway .. tertiary) goes on in a straight line to the strip edge (where OSM continues; the clipped piece was the only thing missing),
  4. DROP    a minor road (unclassified / residential / service / track) that still ends in the field is removed (isolated fragments go with it).
The passes repeat (a dropped road can leave a new free end) up to PASSES times.  `fix_ends` works on the road list of one leg; `run` applies it to a features json
(`python3 real_line_roads_ends.py [route ...]`, idempotent: a second run changes nothing).
"""
import json
import math
import os
import sys

import numpy as np
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(REPO, "pb", "train-sim", "data", "real")

EDGE_LAT = 112.0          # the medium strip is 120 m wide; the data (and the real roads) go on beyond
NEAR_LAT = 30.0           # an end this close to the axis belongs to the rail corridor
BUILT_CLASSES = (4, 5, 8)  # land raster: resid, indus, urban
BUILT_R = (15.0, 20.0)    # lateral / along-track half size of the neighbourhood that is searched for houses (lat, s)
JOIN_TOL = 2.2            # another line within this distance = junction (same as the tidy)
JOIN_MAX = 60.0           # near-collinear free ends closer than this are one road
JOIN_DOT = 0.8            # cos of the angle between the two end directions (and the gap direction)
SNAP_MAX = 50.0           # ray length for a T-junction
REACH_MAX = 260.0         # an important road is extended at most this far to the strip edge
PASSES = 4
MAJOR = ("motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link")


def path_len(p):
    return float(sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(p[:-1], p[1:])))


def builtup_fn(land, lat0, col, cols):
    """land: leg land raster {rows, n, ds}.  -> f(s, lat) True when a built-up cell lies within BUILT_R of the point"""
    rows, n, ds = land["rows"], land["n"], land["ds"]

    def cell(s, lat):
        r = min(n - 1, max(0, int(s / ds)))
        c = int((lat - lat0) // col)
        if c < 0 or c >= cols:
            return -1
        return int(rows[r][c], 16)

    def built(s, lat):
        for dl in (-BUILT_R[0], 0.0, BUILT_R[0]):
            for dsv in (-BUILT_R[1], 0.0, BUILT_R[1]):
                if cell(s + dsv, lat + dl) in BUILT_CLASSES:
                    return True
        return False
    return built


def _direction(p, end):
    """unit vector (s, lat) of the road at its end, pointing away from the road (end = 0 start / -1 end), measured over at least 6 m"""
    seq = p if end == -1 else p[::-1]
    e = np.array(seq[-1], float)
    for q in reversed(seq[:-1]):
        d = e - np.array(q, float)
        if np.hypot(*d) >= 6.0:
            return d / np.hypot(*d)
    d = e - np.array(seq[0], float)
    n = np.hypot(*d)
    return d / n if n > 1e-6 else np.array([0.0, 0.0])


def mark_free_ends(roads, extra_lines):
    """sets r["f"] (bit 0 start, bit 1 end free) like the tidy: an end is joined when another road / arm / overbridge line passes within JOIN_TOL"""
    lines = [LineString(r["p"]) for r in roads] + list(extra_lines)
    tree = STRtree(lines) if lines else None
    out = []
    for i, r in enumerate(roads):
        code = 0
        for bit, e in ((1, r["p"][0]), (2, r["p"][-1])):
            pt = Point(e)
            joined = False
            for j in tree.query(pt.buffer(JOIN_TOL + 0.5)):
                j = int(j)
                if j != i and lines[j].distance(pt) <= JOIN_TOL:
                    joined = True
                    break
            if not joined:
                code |= bit
        out.append(dict(r, f=code))
    return out


def _fix_one_pass(roads, extra_lines, built, stats):
    roads = mark_free_ends(roads, extra_lines)
    n = len(roads)
    lines = [LineString(r["p"]) for r in roads] + list(extra_lines)
    tree = STRtree(lines) if lines else None
    drop = set()
    new_p = {}
    open_ends = []     # (road index, end, point, direction) of every free end that needs a fix
    for i, r in enumerate(roads):
        for bit, end in ((1, 0), (2, -1)):
            if not r["f"] & bit:
                continue
            e = r["p"][end]
            a = abs(e[1])
            if a >= EDGE_LAT or a < NEAR_LAT or built(e[0], e[1]):
                continue
            open_ends.append((i, end, e, _direction(r["p"], end)))
    taken = set()
    for i, end, e, d in open_ends:
        if i in drop or (i, end) in taken:
            continue
        r = roads[i]
        pe = Point(e)
        # 1. JOIN with another free end that points back at this one
        best = None
        for j, end2, e2, d2 in open_ends:
            if j == i or j in drop or (j, end2) in taken:
                continue
            gap = np.array(e2, float) - np.array(e, float)
            gl = float(np.hypot(*gap))
            if gl < 1e-6 or gl > JOIN_MAX:
                continue
            g = gap / gl
            if float(np.dot(d, g)) >= JOIN_DOT and float(np.dot(d2, -g)) >= JOIN_DOT and (best is None or gl < best[0]):
                best = (gl, j, end2, e2)
        if best is not None:
            _gl, j, end2, e2 = best
            new_p.setdefault(i, {})[end] = [round(float(e2[0]), 1), round(float(e2[1]), 1)]
            taken.add((i, end))
            taken.add((j, end2))
            stats["joined"] += 1
            continue
        # 2. SNAP: the extension of the end hits a road / arm / overbridge within SNAP_MAX
        if np.hypot(*d) > 0.5:
            ray = LineString([e, (e[0] + d[0] * SNAP_MAX, e[1] + d[1] * SNAP_MAX)])
            hit, hit_d = None, None
            for j in tree.query(ray):
                j = int(j)
                if j == i:
                    continue
                inter = ray.intersection(lines[j])
                if inter.is_empty:
                    continue
                pts = [inter] if inter.geom_type == "Point" else [q for q in getattr(inter, "geoms", []) if q.geom_type == "Point"]
                for q in pts:
                    dd = pe.distance(q)
                    if dd > 1.0 and (hit_d is None or dd < hit_d):
                        hit, hit_d = q, dd
            if hit is not None:
                new_p.setdefault(i, {})[end] = [round(float(hit.x), 1), round(float(hit.y), 1)]
                taken.add((i, end))
                stats["snapped"] += 1
                continue
        # 3. REACH: an important road goes on straight to the strip edge when it points outward
        if r["c"] in MAJOR and abs(d[1]) > 0.3 and d[1] * e[1] > 0:
            t = (math.copysign(EDGE_LAT + 8.0, e[1]) - e[1]) / d[1]
            if 0 < t <= REACH_MAX:
                new_p.setdefault(i, {})[end] = [round(float(e[0] + d[0] * t), 1), round(float(e[1] + d[1] * t), 1)]
                taken.add((i, end))
                stats["reached"] += 1
                continue
        # 4. DROP the minor road (an important road that cannot be extended stays, the sim tapers its end)
        if r["c"] not in MAJOR:
            drop.add(i)
            stats["dropped"] += 1
    out = []
    for i, r in enumerate(roads):
        if i in drop:
            continue
        p = [list(q) for q in r["p"]]
        for end, q in (new_p.get(i) or {}).items():
            if end == 0:
                p.insert(0, q)
            else:
                p.append(q)
        out.append(dict(r, p=p))
    return out, len(drop) + len(new_p)


def fix_ends(roads, extra_lines, built):
    """roads: the road list of one leg (game coordinates); extra_lines: shapely lines of crossing arms and overbridges; built: builtup_fn.  -> (roads with f, stats)"""
    stats = {"joined": 0, "snapped": 0, "reached": 0, "dropped": 0}
    cur = roads
    for _ in range(PASSES):
        cur, changed = _fix_one_pass(cur, extra_lines, built, stats)
        if not changed:
            break
    return mark_free_ends(cur, extra_lines), stats


def _lines_of(leg):
    lines = []
    for c in leg.get("crossings", []):
        for arm in (c.get("arms") or {}).values():
            pts = [(c["s"] + a, l) for a, l in arm["p"]]
            if len(pts) >= 2:
                lines.append(LineString(pts))
    for ob in leg.get("ob", []):
        if len(ob["p"]) >= 2:
            lines.append(LineString(ob["p"]))
    return lines


def run(route, dry=False):
    path = os.path.join(OUT, "%s-features.json" % route)
    with open(path) as f:
        doc = json.load(f)
    tot = {"joined": 0, "snapped": 0, "reached": 0, "dropped": 0, "before": 0, "after": 0}
    for lid, leg in doc["legs"].items():
        if lid.startswith("st:"):
            continue
        built = builtup_fn(leg["land"], doc["lat0"], doc["col"], doc["cols"])
        roads, st = fix_ends(leg["roads"], _lines_of(leg), built)
        tot["before"] += len(leg["roads"])
        tot["after"] += len(roads)
        for k in st:
            tot[k] += st[k]
        leg["roads"] = roads
    print("%-9s roads %6d -> %6d | joined %4d snapped %4d reached %4d dropped %4d" % (route, tot["before"], tot["after"], tot["joined"], tot["snapped"], tot["reached"], tot["dropped"]))
    if not dry:
        with open(path, "w") as f:
            json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    for r in args or ["west", "south", "north", "mosel", "metz", "brussels", "paris"]:
        run(r, "--dry" in sys.argv)
