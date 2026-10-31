#!/usr/bin/env python3
"""W5 (roads beside the rail track): tidies the road polylines of the real-line feature files (pb/train-sim/data/real/<route>-features.json).

Root cause (REAL-LINES.md "W5 roads"): a leg is compressed along the track by k = real length / game length (1.2 - 20), but the lateral distance is kept.  A real road
that runs at an angle `a` to the line therefore gets the angle atan(tan(a) * k) in game space: the near-parallel roads of the real world (the main road, the field
track beside the line: 15 - 30 % of all road metres) become diagonal "tongues" across the fields, and every perpendicular village street keeps its real
lateral length but a k times smaller spacing (a comb: a street every 3 - 10 m).

This stage works on the game-space polylines (s, lat) of every leg, per leg and with the leg's k (from `$ZUCH_WORK/realline/<route>-legs-meta.json`):

 1. SHEAR   a road whose REAL angle (atan(dlat / (ds * k))) is below PAR_REAL_DEG over its whole length is sheared back to that angle: lat' = lat_ref + (lat - lat_ref) / k,
            lat_ref = the lateral position of its vertex nearest to the track.  The road is parallel to the line again, like in the real world.
 2. SNAP    roads that end ON a sheared road (T-junctions: a side street, an arm of a level crossing) follow it: the end vertex (and the crossing arm tips) move by the
            displacement the sheared road got at that place, so the network stays connected.
 3. TRIM    a road that comes from the open land and ends within NEAR_END m of the track axis (the pipeline cut it at ROAD_CLEAR where it really crosses the line: an
            overbridge / underpass / a level crossing the game dropped) is pulled back to TRIM_TO m, so that no road seems to run into the rails.
 4. THIN    minor perpendicular roads (residential, service, track, ...) closer than MIN_SPACING m (along the track, same side) to a more important kept one are dropped
            (comb).  Level-crossing arms and everything that touches an arm stay.

Idempotent: the first run keeps the untouched pipeline output as `$ZUCH_WORK/realline/<route>-features.raw.json` and marks the feature file (`"tidy": 1`); later runs start from that raw copy.  `build_real_route.py emit` / `build_real_line.py emit` call it last.
  usage: real_line_roads_tidy.py [route ...] [--dry] [--report]      (default: west south north mosel metz brussels paris)"""
import json
import math
import os
import sys

import numpy as np
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(REPO, "pb", "train-sim", "data", "real")
WORK = os.environ.get("ZUCH_WORK", os.path.expanduser("~/Library/Caches/zuch-work"))

PAR_REAL_DEG = 22.0       # real angle below which a road counts as "parallel to the line"
SKEW_MIN_DEG = 7.0        # the game angle must differ at least this much from the real one for the shear to matter
MIN_SHEAR_LEN = 24.0      # game metres
CORRIDOR_CLIP = 16.0      # a road that crosses the line is cut where it comes closer than this to the axis (ROAD_CLEAR 11 + the verge)
NEAR_END = 17.0           # an end closer than this to the track axis is a cut end (ROAD_CLEAR = 11)
TRIM_TO = 21.0
MIN_AFTER_TRIM = 14.0
MIN_SPACING = 26.0        # m along the track between perpendicular minor roads of one side
SKEW_DROP_DEG = (14.0, 66.0)   # a minor road that is still this oblique to the line after the shear is dropped
SKEW_DROP_LEN = 30.0
ISOLATED_MIN_LEN = 60.0   # a road with no junction at either end shorter than this is dropped
PERP_MIN_DEG = 68.0       # game angle from which a road is a "rung" of the comb
JOIN_TOL = 2.2            # another road within this distance of an end = a junction
SNAP_TOL = 3.2            # an end this close to a sheared road follows it
MINOR = ("unclassified", "residential", "living_street", "service", "track")
RANK = {c: i for i, c in enumerate(["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "service", "track"])}


def seg_angles(p):
    d = np.diff(p, axis=0)
    ln = np.hypot(d[:, 0], d[:, 1])
    ang = np.degrees(np.arctan2(np.abs(d[:, 1]), np.abs(d[:, 0]) + 1e-9))
    return ln, ang


def path_len(p):
    return float(np.hypot(*np.diff(p, axis=0).T).sum())


def weighted_real_angle(p, k):
    d = np.diff(p, axis=0)
    ln = np.hypot(d[:, 0], d[:, 1])
    if ln.sum() < 1e-6:
        return 90.0, 90.0
    real = np.degrees(np.arctan2(np.abs(d[:, 1]), np.abs(d[:, 0]) * k + 1e-9))
    game = np.degrees(np.arctan2(np.abs(d[:, 1]), np.abs(d[:, 0]) + 1e-9))
    return float((real * ln).sum() / ln.sum()), float((game * ln).sum() / ln.sum())


def shear(p, k):
    """-> (new points, per-vertex lateral displacement)"""
    ref = p[np.abs(p[:, 1]).argmin(), 1]
    q = p.copy()
    q[:, 1] = ref + (p[:, 1] - ref) / k
    return q, q[:, 1] - p[:, 1]


def clip_band(p, half):
    """The pieces of polyline p (n x 2: s, lat) outside the band |lat| < half, with the cut points interpolated.  A road whose vertices jump from one side of the line to the
    other (the pipeline cuts vertices inside +-ROAD_CLEAR, but a simplified segment can still span the line) has its part over the rails removed."""
    pieces, cur = [], []
    def inside(q):
        return abs(q[1]) < half
    for i in range(len(p)):
        q = p[i]
        if i > 0:
            a = p[i - 1]
            # the sub-intervals of the segment a -> q that lie outside the band: split at lat = -half, +half
            ts = sorted({0.0, 1.0} | {t for t in ((half - a[1]) / (q[1] - a[1]) if q[1] != a[1] else -1, (-half - a[1]) / (q[1] - a[1]) if q[1] != a[1] else -1) if 0.0 < t < 1.0})
            for t0, t1 in zip(ts[:-1], ts[1:]):
                mid = a + (q - a) * ((t0 + t1) / 2)
                A = a + (q - a) * t0
                B = a + (q - a) * t1
                if abs(mid[1]) >= half:
                    if not cur:
                        cur = [A]
                    cur.append(B)
                elif cur:
                    pieces.append(np.array(cur)); cur = []
        elif not inside(q):
            cur = [q]
    if cur:
        pieces.append(np.array(cur))
    return [pc for pc in pieces if len(pc) >= 2]


def tidy_leg(roads, crossings, k, report):
    """roads: [{c, w, p, n, ref}], crossings: [{s, arms: {l|r: {c, n, end, p: [[a, l]]}}}] of one leg (game coordinates).  Returns (roads, crossings) as new objects."""
    # 0. a road that spans the rail corridor (consecutive vertices on both sides of the line, or inside the corridor) is split: no road over the rails
    split = []
    for r in roads:
        p = np.array(r["p"], float)
        crosses = len(p) >= 2 and bool(np.any(p[:-1, 1] * p[1:, 1] < 0) or np.any(np.abs(p[:, 1]) < NEAR_END - 6.0))
        if crosses:
            for pc in clip_band(p, CORRIDOR_CLIP):
                split.append(dict(r, p=[[round(float(x), 1), round(float(y), 1)] for x, y in pc]))
            continue
        split.append(r)
    out = [dict(r, p=[list(q) for q in r["p"]]) for r in split]
    roads = split
    arr = [np.array(r["p"], float) for r in out]
    n = len(out)
    stats = {"roads": n, "sheared": 0, "snapped": 0, "trimmed": 0, "dropped_short": 0, "thinned": 0, "skew_dropped": 0, "isolated": 0}
    if n == 0:
        return out, crossings, stats

    # ---- 1. shear the near-parallel roads
    sheared = {}
    for i, p in enumerate(arr):
        if len(p) < 2 or k < 1.5 or path_len(p) < MIN_SHEAR_LEN:
            continue
        real, game = weighted_real_angle(p, k)
        if real <= PAR_REAL_DEG and game - real >= SKEW_MIN_DEG:
            q, disp = shear(p, k)
            sheared[i] = (p.copy(), q, disp)
            arr[i] = q
            stats["sheared"] += 1
    orig_lines = {i: LineString(v[0]) for i, v in sheared.items()}
    shear_tree = STRtree([orig_lines[i] for i in sheared]) if sheared else None
    shear_ids = list(sheared.keys())

    def displacement_at(pt, skip):
        """the displacement a sheared road got at the point of its ORIGINAL line nearest to pt (None when none within SNAP_TOL)"""
        if shear_tree is None:
            return None
        best = None
        pp = Point(pt)
        for j in shear_tree.query(pp.buffer(SNAP_TOL + 1.0)):
            i = shear_ids[int(j)]
            if i == skip:
                continue
            ln = orig_lines[i]
            d = ln.distance(pp)
            if d > SNAP_TOL or (best is not None and d >= best[0]):
                continue
            p0, _q, disp = sheared[i]
            t = ln.project(pp)
            # vertex arc lengths of the original polyline
            seg = np.hypot(*np.diff(p0, axis=0).T)
            cum = np.concatenate([[0.0], np.cumsum(seg)])
            best = (d, float(np.interp(t, cum, disp)))
        return None if best is None else best[1]

    # ---- 2. snap the ends (and the arm tips) that touch a sheared road
    un_ids = [j for j in range(n) if j not in sheared and len(arr[j]) >= 2]
    un_lines = [LineString(arr[j]) for j in un_ids]
    un_tree = STRtree(un_lines) if un_lines else None
    for i, p in enumerate(arr):
        if len(p) < 2:
            continue
        for end in (0, -1):
            d = displacement_at(p[end], i)
            if d is not None and abs(d) > 0.05:
                p[end, 1] += d
                stats["snapped"] += 1
        # a sheared road whose own end touches an UNSHEARED road keeps that end where it was (the junction stays closed): blend the shift out over the last metres
        if i in sheared:
            p0, q, disp = sheared[i]
            for end in (0, -1):
                touch = None
                if un_tree is not None:
                    pe = Point(p0[end])
                    for jj in un_tree.query(pe.buffer(SNAP_TOL + 0.5)):
                        if un_lines[int(jj)].distance(pe) <= SNAP_TOL:
                            touch = un_ids[int(jj)]
                            break
                if touch is None:
                    continue
                cum = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(q, axis=0).T))])
                dist = cum if end == 0 else cum[-1] - cum
                w = np.clip(1.0 - dist / 60.0, 0.0, 1.0)[:, None]
                arr[i] = q * (1 - w) + p0 * w
                p = arr[i]

    new_crossings = []
    for c in crossings:
        cc = dict(c)
        if c.get("arms"):
            arms = {}
            for side, arm in c["arms"].items():
                pts = np.array([[c["s"] + a, l] for a, l in arm["p"]], float)
                d = displacement_at(pts[-1], -1)
                if d is not None and abs(d) > 0.05:
                    cum = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(pts, axis=0).T))])
                    w = np.clip(1.0 - (cum[-1] - cum) / 40.0, 0.0, 1.0)
                    pts[:, 1] += d * w
                    arm = dict(arm, p=[[round(float(x - c["s"]), 1), round(float(y), 1)] for x, y in pts])
                    stats["snapped"] += 1
                arms[side] = arm
            cc["arms"] = arms
        new_crossings.append(cc)

    # arm geometry (leg coordinates) = what must stay
    arm_lines = []
    for c in new_crossings:
        for arm in (c.get("arms") or {}).values():
            pts = [(c["s"] + a, l) for a, l in arm["p"]]
            if len(pts) >= 2:
                arm_lines.append(LineString(pts))

    keep_skew = [True] * n

    # ---- 3. trim the cut ends beside the track
    for i, p in enumerate(arr):
        if len(p) < 2:
            continue
        for end in (0, -1):
            seq = p if end == 0 else p[::-1]
            if abs(seq[0, 1]) >= NEAR_END or np.abs(seq[:, 1]).max() < 40.0:
                continue
            side = 1.0 if seq[0, 1] >= 0 else -1.0
            cut = None
            for j in range(1, len(seq)):
                if side * seq[j, 1] >= TRIM_TO:
                    a, b = seq[j - 1], seq[j]
                    t = (side * TRIM_TO - side * a[1]) / ((side * b[1] - side * a[1]) or 1.0)
                    cut = (j, a + (b - a) * max(0.0, min(1.0, t)))
                    break
            if cut is None:
                continue
            seq2 = np.vstack([cut[1][None, :], seq[cut[0]:]])
            arr[i] = seq2 if end == 0 else seq2[::-1]
            p = arr[i]
            stats["trimmed"] += 1

    # ---- 4a. the roads that are still diagonal / zigzag after the shear (a real oblique or winding minor road squashed k times along the line): scratches across the fields
    arm_tree0 = STRtree(arm_lines) if arm_lines else None
    for i, p in enumerate(arr):
        if len(p) < 2 or out[i]["c"] not in MINOR or path_len(p) < SKEW_DROP_LEN:
            continue
        _real, game = weighted_real_angle(p, 1.0)
        if SKEW_DROP_DEG[0] <= game <= SKEW_DROP_DEG[1]:
            if arm_tree0 is not None and any(arm_lines[int(j)].distance(Point(e)) <= 5.0 for e in (p[0], p[-1]) for j in arm_tree0.query(Point(e).buffer(6.0))):
                continue
            stats["skew_dropped"] = stats.get("skew_dropped", 0) + 1
            keep_skew[i] = False

    # ---- 4. thin the comb
    keep = list(keep_skew)
    for i, p in enumerate(arr):
        if len(p) < 2 or path_len(p) < MIN_AFTER_TRIM:
            keep[i] = False
            stats["dropped_short"] += 1
    arm_tree = STRtree(arm_lines) if arm_lines else None

    def near_arm(p):
        if arm_tree is None:
            return False
        for e in (p[0], p[-1]):
            for j in arm_tree.query(Point(e).buffer(6.0)):
                if arm_lines[int(j)].distance(Point(e)) <= 5.0:
                    return True
        return False

    rungs = []
    for i, p in enumerate(arr):
        if not keep[i] or out[i]["c"] not in MINOR:
            continue
        _real, game = weighted_real_angle(p, 1.0)
        if game < PERP_MIN_DEG or near_arm(p):
            continue
        rungs.append((RANK.get(out[i]["c"], 99), -path_len(p), i))
    rungs.sort()
    kept = []     # (side, s_mid, lat_lo, lat_hi)
    for _rank, _nl, i in rungs:
        p = arr[i]
        s_mid = float((p[:, 0].min() + p[:, 0].max()) / 2)
        lo, hi = float(p[:, 1].min()), float(p[:, 1].max())
        side = 1 if (lo + hi) / 2 >= 0 else -1
        if any(sd == side and abs(sm - s_mid) < MIN_SPACING and not (hi < l0 or lo > l1) for sd, sm, l0, l1 in kept):
            keep[i] = False
            stats["thinned"] += 1
        else:
            kept.append((side, s_mid, lo, hi))

    res = []
    for i, r in enumerate(out):
        if not keep[i]:
            continue
        res.append(dict(r, p=[[round(float(x), 1), round(float(y), 1)] for x, y in arr[i]]))
    # free ends: an end is a real junction when ANOTHER road passes within JOIN_TOL of it (T-junction or end to end) or it lies on a crossing arm; the sim tapers the free
    # ends into the ground (real-line.js; it only knew end-to-end meetings before, so every T-junction onto the middle of a way was drawn as a tapered stub)
    lines = [LineString(r["p"]) for r in res] + arm_lines
    tree = STRtree(lines) if lines else None
    for i, r in enumerate(res):
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
        r["f"] = code
    # a short road that touches nothing at both ends is a dark lens in the field (both ends taper): dropped
    before = len(res)
    res = [r for r in res if not (r["f"] == 3 and path_len(np.array(r["p"], float)) < ISOLATED_MIN_LEN)]
    stats["isolated"] = before - len(res)
    stats["kept"] = len(res)
    return res, new_crossings, stats


def run(route, dry=False):
    path = os.path.join(OUT, "%s-features.json" % route)
    raw_path = os.path.join(WORK, "realline", "%s-features.raw.json" % route)
    with open(path) as f:
        doc = json.load(f)
    if doc.get("tidy"):
        if not os.path.exists(raw_path):
            sys.exit("%s is already tidied and has no raw copy (%s): re-run the pipeline emit stage" % (path, raw_path))
        with open(raw_path) as f:      # run again from the untouched pipeline output
            doc = json.load(f)
    elif not dry:
        with open(raw_path, "w") as f:
            json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
    with open(os.path.join(WORK, "realline", "%s-legs-meta.json" % route)) as f:
        meta = json.load(f)
    total = {}
    for lid, leg in doc["legs"].items():
        k = float((meta.get(lid) or {}).get("k", 1.0))
        roads, crossings, st = tidy_leg(leg["roads"], leg["crossings"], k, None)
        for key, v in st.items():
            total[key] = total.get(key, 0) + v
        leg["roads"] = roads
        leg["crossings"] = crossings
    print("%-9s roads %6d -> %6d | sheared %5d snapped %5d trimmed %5d short %5d thinned %5d skew %5d isolated %5d" % (route, total["roads"], total["kept"], total["sheared"], total["snapped"], total["trimmed"], total["dropped_short"], total["thinned"], total["skew_dropped"], total["isolated"]))
    if not dry:
        doc["tidy"] = 1
        with open(path, "w") as f:
            json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry" in sys.argv
    for r in args or ["west", "south", "north", "mosel", "metz", "brussels", "paris"]:
        run(r, dry)
