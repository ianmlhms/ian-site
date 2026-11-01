#!/usr/bin/env python3
"""W5 (roads2): road overbridges over the line.

Until now a road that really crosses the line on a bridge (OSM `bridge=*` / `layer>=1`, the way crosses the rail path) was cut at ROAD_CLEAR (11 m) on both sides by
`real_line_scenery.roads_of_leg`, and `real_line_roads_tidy` pulled the two stubs back to 21 m: the road ended in a field on both sides of the line.  This stage finds
those structures, follows the road through the bridge way and the ways that continue it (the same trace as the level crossing arms, real_line_crossings.py) and emits it as
ONE polyline in game coordinates, `ob` of the leg:

    { "s": game s where the road crosses the axis, "c": class, "w": width, "n": name, "r": ref, "p": [[s, lat], ...] }     p runs from the far end on one side to the far end on the other

The sim (overbridges.js + overbridges-mesh.js) builds deck, abutments, wing walls, parapets, the embankment ramps and the asphalt from it, and carries the road across.  The road
ribbons that run along the claimed stretch are removed from the scenery road list (`claim_ribbons`) so that the road is not drawn twice.

An overbridge is NOT emitted (the road keeps ending beside the line as before) when it lies close to a tunnel / bridge / level crossing / leg end of the game layout, when the
road is too short on one side to carry a ramp, or when it duplicates another carriageway.  Underpasses (road under the line) are only counted (`under` list of the leg result).
"""
import math
import os

import numpy as np
from shapely.geometry import LineString, Point

from real_line_crossings import RANK, _densify, _simplify, _trace  # noqa: F401

OB_LAT_CAP = 112.0          # lateral distance up to which the ramp is carried (the medium strip is 120 m wide, the low one 90 m: the mesh stage clips)
OB_LEN_CAP = 215.0          # game metres of road claimed on each side
OB_MIN_SIDE = 40.0          # each side must have at least this lateral reach, else the road cannot ramp up
OB_TURN_STOP_DEG = 38.0     # a road that turns this much (real angle) within the claim stops the chain there
OB_PARALLEL_DEG = 10.0      # ... and so does a road that runs along the line (real angle to the line below this) beyond OB_PARALLEL_LAT
OB_PARALLEL_LAT = 30.0
OB_BORDER = 85.0            # game metres kept free at both ends of a leg (station blocks)
OB_WINDOW_PAD = 60.0        # game metres kept free around tunnels, bridges and level crossings
OB_DUP_FACTOR = 0.9         # two chains closer than this many half widths are one carriageway pair
OB_SAMPLE = 5.0
DROP_DIST = 3.2             # ribbon points this close to a claimed chain are removed ...
KEEP_TAIL = 3.5             # ... except next to its far end, where the ordinary ribbon takes over
DEBUG = bool(os.environ.get("OB_DEBUG"))
CORRIDOR_LAT = 9.0          # a chain vertex further than this from the axis tells the side the chain runs to


def _layer(tags):
    try:
        return int(str(tags.get("layer", "0")).split(";")[0])
    except ValueError:
        return 0


def structure_kind(tags):
    """'over' / 'under' / None for a way, from its tags alone (the caller checks that it crosses the rail path)."""
    br = tags.get("bridge")
    tu = tags.get("tunnel")
    lay = _layer(tags)
    if (tu and tu not in ("no", "building_passage", "avalanche_protector")) or (lay < 0 and not br):
        return "under"
    if (br and br not in ("no", "boardwalk")) or lay >= 1:
        return "over"
    return None


def _real_angle(dp, dl, k):
    """angle (deg) between a road segment (game ds = dp, lateral dl) and the line, with the along-track length un-compressed by k"""
    return math.degrees(math.atan2(abs(dl), abs(dp) * k + 1e-9))


def _turn_deg(a, b, c, k):
    """turn angle (deg) at b between the segments a-b and b-c (game coordinates, along-track un-compressed by k)"""
    d0 = ((b[0] - a[0]) * k, b[1] - a[1])
    d1 = ((c[0] - b[0]) * k, c[1] - b[1])
    n0, n1 = math.hypot(*d0), math.hypot(*d1)
    if n0 < 6 or n1 < 6:
        return 0.0
    cosv = (d0[0] * d1[0] + d0[1] * d1[1]) / (n0 * n1)
    return math.degrees(math.acos(max(-1.0, min(1.0, cosv))))


def _project(g, track_line, pts):
    """Real coordinates -> (s_real, game s, lat) arrays"""
    arr = np.array(pts, float)
    s_real = np.array([track_line.project(Point(q)) for q in arr])
    p, r, _ = g.frame(np.clip(s_real, 0, g.attrs.length - 0.01))
    lat = np.einsum("ij,ij->i", arr - p, r)
    sg = g.game_of(np.clip(s_real, g.a, g.b))
    return s_real, sg, lat


def _chain_game(g, track_line, chain, k, side):
    """One half chain (real coordinates, starting at the crossing node) -> game samples [(s, lat)] cut at the claim limits.  side = +1 / -1: the side of the line the chain must run to
    (0: only project, no cutting)."""
    s_real, sg, lat = _project(g, track_line, _densify([list(q) for q in chain], OB_SAMPLE))
    out = [(float(sg[0]), float(lat[0]))]
    run = 0.0
    for i in range(1, len(sg)):
        if s_real[i] < g.a - 20 or s_real[i] > g.b + 20:
            break
        cur = (float(sg[i]), float(lat[i]))
        if side:
            if side * cur[1] < -4.0 and abs(out[-1][1]) > 12.0:        # turned back over the line
                break
            if abs(cur[1]) > OB_LAT_CAP:                               # end exactly at the lateral cap
                prev = out[-1]
                t = (OB_LAT_CAP - abs(prev[1])) / ((abs(cur[1]) - abs(prev[1])) or 1.0)
                out.append((prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t))
                break
            if abs(cur[1]) > OB_PARALLEL_LAT and _real_angle(cur[0] - out[-1][0], cur[1] - out[-1][1], k) < OB_PARALLEL_DEG:
                break
            if len(out) >= 2 and abs(cur[1]) > OB_PARALLEL_LAT and _turn_deg(out[-2], out[-1], cur, k) > OB_TURN_STOP_DEG:
                break
        run += math.hypot(cur[0] - out[-1][0], cur[1] - out[-1][1])
        if run > OB_LEN_CAP:
            break
        out.append(cur)
    return out


def _blocked(g, sg, meta, crossing_s):
    """True when the game position sg lies in the pad of a tunnel / bridge / level crossing piece or close to a leg end"""
    if sg < OB_BORDER or sg > g.length - OB_BORDER:
        return True
    if any(abs(c - sg) < OB_WINDOW_PAD for c in crossing_s):
        return True
    for pc in (meta or {}).get("pieces", []):
        if not (pc.get("tunnel") or pc.get("bridge")):
            continue
        s0 = float(np.interp(pc["real0"], g.real, g.game))
        s1 = float(np.interp(pc["real1"], g.real, g.game))
        if s0 - OB_WINDOW_PAD < sg < s1 + OB_WINDOW_PAD:
            return True
    return False


def obs_of_leg(g, ways, rtree, track_line, meta, k, crossing_s):
    """Overbridges of one leg.  g: LegGeom, ways: highway features (id, g, t), rtree: STRtree over their geometries, track_line: the whole route as LineString, meta: leg meta
    (pieces), k: real / game length, crossing_s: game s of the level crossings kept in the leg.  -> (obs, n_under)"""
    i0 = int(max(0, g.a // g.attrs.step - 3))
    a_path = LineString(g.attrs.xy[i0:int(g.b // g.attrs.step) + 5])
    cands = []
    for j in rtree.query(a_path):
        w = ways[int(j)]
        kind = structure_kind(w["t"])
        if kind is None or not w["g"].intersects(a_path):
            continue
        inter = w["g"].intersection(a_path)
        pts = [inter] if inter.geom_type == "Point" else [q for q in getattr(inter, "geoms", []) if q.geom_type == "Point"]
        for node in pts:
            s_node = float(track_line.project(node))
            if g.a + 5 < s_node < g.b - 5:
                cands.append((kind, int(j), node, s_node))
    obs = []
    n_under = 0
    for kind, j, node, s_node in sorted(cands, key=lambda c: c[3]):
        w = ways[j]
        if kind == "under":
            n_under += 1
            continue
        _dbg = lambda why: print("    ob skip s_real=%.0f %s %s: %s" % (s_node, w["t"].get("highway"), w["t"].get("name", ""), why)) if DEBUG else None
        mid = s_node - g.a
        if any((pc.get("tunnel") or pc.get("bridge")) and pc["real0"] - 12 <= mid <= pc["real1"] + 12 for pc in (meta or {}).get("pieces", [])):
            _dbg("rail in tunnel/bridge")
            continue                                            # the rail is in a tunnel / on a bridge here: the layout already draws a structure
        sides = {}
        for _hwy, _name, chain, used in _trace((node.x, node.y), ways, rtree, None):
            if j not in used or len(chain) < 2:
                continue
            probe = _chain_game(g, track_line, chain, k, 0)
            away = [q for q in probe if abs(q[1]) > CORRIDOR_LAT]
            if not away:
                continue
            sd = 1 if away[0][1] > 0 else -1
            half = _chain_game(g, track_line, chain, k, sd)
            reach = max(abs(q[1]) for q in half)
            if len(half) >= 2 and (sd not in sides or reach > sides[sd][0]):
                sides[sd] = (reach, half)
        if 1 not in sides or -1 not in sides or min(sides[1][0], sides[-1][0]) < OB_MIN_SIDE:
            _dbg("sides %s" % {k_: round(v_[0]) for k_, v_ in sides.items()})
            continue
        p = sides[-1][1][::-1] + sides[1][1][1:]
        lats = [q[1] for q in p]
        if sum(1 for a, b in zip(lats[:-1], lats[1:]) if a * b < 0) != 1:
            _dbg("wiggle")
            continue                                            # a wiggling road: skip
        arr = _simplify(np.array(p, float), 0.9)
        ia = int(np.argmax(arr[:, 1] > 0))
        a, b = arr[ia - 1], arr[ia]
        s_game = float(a[0] + (b[0] - a[0]) * (-a[1] / ((b[1] - a[1]) or 1.0)))
        if _blocked(g, s_game, meta, crossing_s):
            _dbg("blocked at game s %.0f of %.0f" % (s_game, g.length))
            continue
        obs.append({"s": round(s_game, 1), "c": w["t"].get("highway"), "w": 0.0, "n": (w["t"].get("name") or "")[:24], "r": w["t"].get("ref", ""),
                    "p": [[round(float(x), 1), round(float(y), 1)] for x, y in arr]})
    return obs, n_under


def _median_gap(a, b):
    """median distance of the far parts of chain a to chain b (game metres)"""
    pb = LineString(b["p"])
    mid = [Point(q) for q in _densify(a["p"], 4.0) if 12.0 < abs(q[1]) < 90.0]
    if len(mid) < 2:
        return 1e9
    return float(np.median([pb.distance(q) for q in mid]))


def dedupe(obs, widths):
    """Two carriageways of one road (motorway, dual primary) cross the line side by side: one structure.  -> (kept indices, {dropped index: kept index})"""
    keep, dropped = [], {}
    for i in sorted(range(len(obs)), key=lambda i: (RANK.get(obs[i]["c"], 60), -widths[i], obs[i]["s"])):
        twin = next((j for j in keep if _median_gap(obs[i], obs[j]) < OB_DUP_FACTOR * (widths[i] + widths[j]) / 2 + 3.0), None)
        if twin is None:
            keep.append(i)
        else:
            dropped[i] = twin
    return sorted(keep), dropped


def claim_ribbons(roads, lines):
    """roads: [{c, w, p}] of the leg; lines: claimed chains [[(s, lat), ...]].  The ribbon points within DROP_DIST of a chain (not of its last KEEP_TAIL metres at either end) are removed;
    a road is split where points were removed."""
    cut_lines = []
    for ln in lines:
        if len(ln) < 2:
            continue
        L = LineString(ln)
        a, b = KEEP_TAIL, L.length - KEEP_TAIL
        if b - a > 4:
            cut_lines.append(LineString([L.interpolate(d).coords[0] for d in np.linspace(a, b, int((b - a) // 3) + 2)]))
    if not cut_lines:
        return roads
    boxes = [c.buffer(DROP_DIST + 2).bounds for c in cut_lines]
    out = []
    for r in roads:
        xs = [q[0] for q in r["p"]]
        ys = [q[1] for q in r["p"]]
        near = [c for c, bx in zip(cut_lines, boxes) if not (max(xs) < bx[0] or min(xs) > bx[2] or max(ys) < bx[1] or min(ys) > bx[3])]
        if not near:
            out.append(r)
            continue
        run, dropped = [], False
        for s, lat in _densify(r["p"], 4.0):
            if any(c.distance(Point(s, lat)) < DROP_DIST for c in near):
                dropped = True
                if len(run) >= 2:
                    out.append(dict(r, p=[[round(x, 1), round(y, 1)] for x, y in _simplify(np.array(run), 0.8)]))
                run = []
            else:
                run.append([s, lat])
        if not dropped:
            out.append(r)
        elif len(run) >= 2:
            out.append(dict(r, p=[[round(x, 1), round(y, 1)] for x, y in _simplify(np.array(run), 0.8)]))
    return out


def process_leg(g, ways, rtree, track_line, meta, k, roads, crossing_s, class_width):
    """-> (roads without the claimed ribbons, obs, n_under).  Called by the emit stages between roads_of_leg and tidy."""
    found, n_under = obs_of_leg(g, ways, rtree, track_line, meta, k, crossing_s)
    if not found:
        return roads, [], n_under
    widths = [float(class_width.get(o["c"], 5.0)) for o in found]
    keep, dropped = dedupe(found, widths)
    obs = []
    for i in keep:
        o = dict(found[i])
        twins = [widths[d] for d, t in dropped.items() if t == i]
        # two carriageways side by side make one structure (motorways already carry the width of both)
        o["w"] = round(min(15.0, widths[i] + (sum(twins) if widths[i] < 12.0 else 0.0)), 1)
        obs.append(o)
    lines = [[tuple(q) for q in o["p"]] for o in found]      # the dropped twins claim their ribbons too
    return claim_ribbons(roads, lines), obs, n_under
