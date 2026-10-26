#!/usr/bin/env python3
"""Real level crossing arms: the roads that cross the line at an OSM railway=level_crossing node, followed outward on both sides (W2b).

For every real crossing of a leg, `arms_of_crossing` returns the road on the left and right of the line as a polyline in the crossing frame
    a = game metres along the track from the crossing (compressed like the rest of the leg),  l = real metres to the right of the track axis,
following the OSM way (and the ways that continue it through OSM's way splits) until it meets another road (a T-junction: the parallel road, drawn as a
ribbon by real-scenery.js), runs |l| > ARM_LAT_MAX or ARM_REAL_MAX real metres, or ends.  The sim (crossing-roads.js) builds the crossing road on exactly this
polyline.  `drop_arm_ribbons` removes the ribbon pieces of the same road from the scenery road list so that the road is not drawn twice.
"""
import math

import numpy as np
from shapely.geometry import LineString, Point

ARM_LAT_MAX = 150.0          # the strip of the sim ends here
ARM_REAL_MAX = 420.0         # real metres of road followed from the crossing
JUNCTION_MIN_LAT = 16.0      # a junction closer to the line than this is the crossing's own apron
JUNCTION_TOL = 1.8           # another road within this distance of a vertex = a junction
NODE_TOL = 5.0               # ways whose geometry passes within this distance of the crossing node belong to the crossing road
JOIN_TOL = 3.0
MIN_DOT = 0.2                # a continuing way must keep roughly the direction
VEHICLE = ("motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link",
           "unclassified", "residential", "living_street", "service", "track")
RANK = {c: i for i, c in enumerate(["primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "service", "track"])}
DROP_DIST = 4.5              # ribbon points this close to an arm are dropped
KEEP_TAIL = 7.0              # ... except near the arm's last metres (the through road at the junction keeps its ribbon)


def _coords(geom):
    return [list(geom.coords)] if geom.geom_type == "LineString" else [list(p.coords) for p in geom.geoms]


def _walk(first, ways, used, rtree_ways):
    """Follow the chain from the end of `first` (a list of (x, y)) through ways whose start lies at its end (any orientation)."""
    chain = list(first)
    guard = 0
    while guard < 12:
        guard += 1
        e = np.array(chain[-1])
        q = np.array(chain[-2]) if len(chain) > 1 else e
        t = e - q
        tl = float(np.hypot(*t)) or 1.0
        best = None
        for j in rtree_ways.query(Point(e).buffer(JOIN_TOL)):
            if j in used:
                continue
            for part in _coords(ways[j]["g"]):
                for pts in (part, part[::-1]):
                    if math.hypot(pts[0][0] - e[0], pts[0][1] - e[1]) > JOIN_TOL:
                        continue
                    d = np.array(pts[1]) - np.array(pts[0])
                    dl = float(np.hypot(*d)) or 1.0
                    dot = float(np.dot(d, t) / (dl * tl))
                    if dot > MIN_DOT and (best is None or dot > best[0]):
                        best = (dot, j, pts)
        if best is None:
            break
        used.add(best[1])
        chain.extend(tuple(p) for p in best[2][1:])
        if len(chain) > 400:
            break
    return chain


def _trace(node, ways, rtree_ways, tags_of):
    """The candidate roads away from the crossing node: [(highway, name, [(x, y), ...] starting at the node)]"""
    out = []
    p0 = Point(node)
    for j in rtree_ways.query(p0.buffer(NODE_TOL)):
        w = ways[j]
        if w["t"].get("highway") not in VEHICLE or w["g"].distance(p0) > NODE_TOL:
            continue
        for part in _coords(w["g"]):
            line = LineString(part)
            if line.distance(p0) > NODE_TOL:
                continue
            d0 = line.project(p0)
            # the two directions away from the node
            fwd = [(node[0], node[1])] + [tuple(c) for c in part if line.project(Point(c)) > d0 + 0.5]
            bwd = [(node[0], node[1])] + [tuple(c) for c in part[::-1] if line.project(Point(c)) < d0 - 0.5]
            for chain in (fwd, bwd):
                if len(chain) < 2:
                    continue
                used = {j}
                full = _walk(chain, ways, used, rtree_ways)
                out.append((w["t"].get("highway"), (w["t"].get("name") or "")[:24], full, used))
    return out


def arms_of_crossing(g, node_xy, sg_c, ways, rtree_ways, track_line, all_lines, all_tree):
    """-> {"l": arm | None, "r": arm | None};  arm = {"c": class, "n": name, "end": "junction"|"lat"|"open", "p": [[a, l], ...]}"""
    cands = _trace(node_xy, ways, rtree_ways, None)
    best = {"l": None, "r": None}
    for hw, name, chain, used in cands:
        pts = np.array(chain)
        if len(pts) < 2:
            continue
        s_real = np.array([track_line.project(Point(q)) for q in pts])
        p, r, _ = g.frame(np.clip(s_real, 0, g.attrs.length - 0.01))
        lat = np.einsum("ij,ij->i", pts - p, r)
        sg = g.game_of(np.clip(s_real, g.a, g.b))
        # which side: the first vertex clearly away from the line
        away = [k for k in range(len(pts)) if abs(lat[k]) > 9.0]
        if not away:
            continue
        side = "r" if lat[away[0]] > 0 else "l"
        # follow until a junction / lateral limit / length limit
        keep = [0]
        end = "open"
        run = 0.0
        for k in range(1, len(pts)):
            run += float(np.hypot(*(pts[k] - pts[k - 1])))
            if run > ARM_REAL_MAX:
                end = "len"
                break
            if abs(lat[k]) > ARM_LAT_MAX:
                keep.append(k)
                end = "lat"
                break
            if side == "r" and lat[k] < -2.0 or side == "l" and lat[k] > 2.0:
                break
            keep.append(k)
            if abs(lat[k]) >= JUNCTION_MIN_LAT and k < len(pts) - 1:
                q = Point(pts[k])
                touch = False
                for j in all_tree.query(q.buffer(JUNCTION_TOL)):
                    if j in used:
                        continue
                    if all_lines[j].distance(q) <= JUNCTION_TOL:
                        touch = True
                        break
                if touch:
                    end = "junction"
                    break
        if len(keep) < 3:
            continue
        a = sg[keep] - sg_c
        l = lat[keep]
        poly = _simplify(np.c_[a, l], 1.2)
        arm = {"c": hw, "n": name, "end": end, "p": [[round(float(x), 1), round(float(y), 1)] for x, y in poly], "reach": float(abs(l[-1]))}
        cur = best[side]
        if cur is None or (RANK.get(hw, 99), -arm["reach"]) < (RANK.get(cur["c"], 99), -cur["reach"]):
            best[side] = arm
    for k in ("l", "r"):
        if best[k]:
            best[k].pop("reach", None)
    return best


def _simplify(pts, tol):
    keep = np.zeros(len(pts), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = pts[i], pts[j]
        ab = b - a
        L = float(np.hypot(*ab)) + 1e-9
        d = np.abs(ab[0] * (pts[i + 1:j, 1] - a[1]) - ab[1] * (pts[i + 1:j, 0] - a[0])) / L
        k = int(d.argmax())
        if d[k] > tol:
            keep[i + 1 + k] = True
            stack += [(i, i + 1 + k), (i + 1 + k, j)]
    return pts[keep]


def _densify(p, step):
    out = [p[0]]
    for a, b in zip(p[:-1], p[1:]):
        n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) // step))
        for k in range(1, n + 1):
            out.append([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n])
    return out


def drop_arm_ribbons(roads, crossing_arms_abs):
    """roads: [{c, w, p: [[s, lat], ...]}] in leg game coordinates; crossing_arms_abs: [[(s, lat), ...] per arm] in the same coordinates.
    Points within DROP_DIST of an arm (but not of its last KEEP_TAIL metres) are removed; a road is split where points were removed."""
    lines = []
    for arm in crossing_arms_abs:
        if len(arm) < 2:
            continue
        ln = LineString(arm)
        cut = ln.length - KEEP_TAIL
        if cut > 4:
            lines.append(LineString([ln.interpolate(d).coords[0] for d in np.linspace(0, cut, int(cut // 3) + 2)]))
    if not lines:
        return roads
    boxes = [l.buffer(DROP_DIST + 2).bounds for l in lines]
    out = []
    for r in roads:
        xs = [q[0] for q in r["p"]]
        ys = [q[1] for q in r["p"]]
        near = [l for l, b in zip(lines, boxes) if not (max(xs) < b[0] or min(xs) > b[2] or max(ys) < b[1] or min(ys) > b[3])]
        if not near:
            out.append(r)
            continue
        run, dropped = [], False
        for s, lat in _densify(r["p"], 5.0):
            if any(l.distance(Point(s, lat)) < DROP_DIST for l in near):
                dropped = True
                if len(run) >= 2:
                    out.append(dict(r, p=[[round(x, 1), round(y, 1)] for x, y in _simplify(np.array(run), 1.0)]))
                run = []
            else:
                run.append([s, lat])
        if not dropped:
            out.append(r)
        elif len(run) >= 2:
            out.append(dict(r, p=[[round(x, 1), round(y, 1)] for x, y in _simplify(np.array(run), 1.0)]))
    return out
