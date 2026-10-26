#!/usr/bin/env python3
"""OSM -> leg geometry for the Mosel line (Lëtzebuerg - Wasserbëlleg - Trier - Wittlich - Koblenz).  Decision and method: pb/train-sim/REAL-LINES.md.

Stage `layout`: real main-track centre line of the routes `wittlich` (via the Weststrecke) and `trier` (via Trier Hbf) -> for every leg between two
stops: straights / arcs (curve sequence, sides, radii capped by the line speed), grades from the DEM, maxspeed, bridges, tunnels and level crossings of
the real line; compressed to the game leg length (curves keep their radius, lengths are scaled).  Writes pb/train-sim/data/real/mosel-layout.json.
Stage `plot`: QA overlays of the real centre line against the fitted game geometry.

    /Users/Ian/Library/Caches/luxtram-work/.venv/bin/python scripts/zuch/build_real_line.py layout [--only A]
"""
import argparse
import json
import math
import os
import sys

import numpy as np
import shapely
from shapely import STRtree
from shapely.geometry import LineString, Point

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import real_line_fit as fit  # noqa: E402
import real_line_path as rp  # noqa: E402
from osm_rail import num, resample  # noqa: E402
from real_line_dem import Dem  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(REPO, "pb", "train-sim", "data", "real")

HALF_BLOCK = 145.0         # a station block (approach + platform + approach) is 290 m long in the sim
GAME_PER_REAL = 0.27       # compression of a leg: game metres per real metre ...
LEG_MIN, LEG_MAX = 480.0, 1750.0   # ... clamped to this range
ARC_COMPRESS_MAX = 2.2     # arcs are compressed at most this much (their radius stays)
ARC_SHARE_MAX = 0.62       # arcs may take this much of a leg
R_MIN = 380.0              # smallest game radius
LINE_V_DEFAULT = 100
GRADE_STEP = 0.25          # % quantisation of the grade tokens
GRADE_MIN_RUN = 350.0      # real metres
GRADE_MAX = 1.0            # authored grade % (the sim multiplies by 2.4 and clamps at 2.5 %)
BRIDGE_MIN_REAL = 28.0
TUNNEL_MIN_REAL = 45.0
MIN_PIECE_GAME = 30.0
CROSS_END_GAME = 20.0     # game metres a crossing keeps from the station blocks at the ends of its leg
CROSS_EQUIP_GAME = 35.0   # ... from bridges and tunnels
CROSS_LOST_DEG = 3.5       # a crossing on a curve is straightened when the window loses at most this heading change
CROSS_CROSS_GAME = 60.0   # ... from the next crossing
SIDE_SEARCH = 90.0         # platforms within this distance of the track decide the platform side


def clamp(v, a, b):
    return max(a, min(b, v))


# ------------------------------------------------------------------------------------------------------------------------------ route polylines
def concat_paths(parts):
    """parts: [{xy, ways}] sharing end/start nodes -> {xy, edge_tags}"""
    xy, tags = [], []
    for p in parts:
        pts = p["xy"]
        if xy:
            pts = pts[1:]
        xy.extend(map(tuple, pts))
        tags.extend(p["ways"])
    return remove_spurs(np.array(xy), tags)


def remove_spurs(xy, tags, back_deg=100.0, max_nodes=80, close=10.0):
    """Cut out the dead-end spurs the shortest path takes at switches: where the direction reverses (> back_deg) and the path returns to within
    `close` m of the reversal point within max_nodes nodes, drop the detour."""
    xy = [tuple(p) for p in xy]
    tags = list(tags)
    changed = True
    while changed:
        changed = False
        for i in range(1, len(xy) - 1):
            v1 = np.subtract(xy[i], xy[i - 1])
            v2 = np.subtract(xy[i + 1], xy[i])
            n1, n2 = np.hypot(*v1), np.hypot(*v2)
            if n1 < 1e-6 or n2 < 1e-6:
                continue
            ang = math.degrees(math.acos(clamp(float(np.dot(v1, v2) / (n1 * n2)), -1, 1)))
            if ang < back_deg:
                continue
            # the reversal is at node i: find where the path comes back near node i-1 .. i
            for j in range(i + 1, min(len(xy), i + max_nodes)):
                if math.hypot(xy[j][0] - xy[i - 1][0], xy[j][1] - xy[i - 1][1]) < close:
                    xy = xy[:i] + xy[j + 1:] if j + 1 < len(xy) else xy[:i]
                    tags = tags[:i - 1] + tags[j:]
                    changed = True
                    break
            if changed:
                break
    return {"xy": np.array(xy), "tags": tags}


def edge_table(xy, tags):
    seg = np.hypot(*np.diff(xy, axis=0).T)
    cum = np.r_[0.0, np.cumsum(seg)]
    return cum


def common_prefix_len(xy_a, xy_b, tol=3.5):
    """Arc length of the common start of two polylines."""
    lb = LineString(xy_b)
    cum = np.r_[0.0, np.cumsum(np.hypot(*np.diff(xy_a, axis=0).T))]
    bad = 0
    for i, p in enumerate(xy_a):
        if lb.distance(Point(p)) > tol:
            bad += 1
            if bad >= 3:
                return float(cum[max(0, i - 2)])
        else:
            bad = 0
    return float(cum[-1])


def common_suffix_len(xy_a, xy_b, tol=3.5):
    r = common_prefix_len(xy_a[::-1], xy_b[::-1], tol)
    return r


def build_routes():
    tiles = rp.load_tiles()
    paths, pts = rp.build_paths(tiles)
    A, W, H, B = (paths[k] for k in "AWHB")
    # W and H end at Trier-Ehrang Ort and B starts there: the tail is shared by construction, the branches meet where they coincide
    routes = {
        "wittlich": concat_paths([A, W, B]),
        "trier": concat_paths([A, H, B]),
    }
    return routes, pts, tiles


# ------------------------------------------------------------------------------------------------------------------------------ attributes along a route
class RouteAttrs:
    """10 m samples of the route: xy, elevation, grade %, maxspeed, bridge / tunnel tags."""

    def __init__(self, route, dem, step=10.0):
        xy, ss = resample(route["xy"], step)
        self.step = step
        self.xy = xy
        self.s = ss
        self.length = float(ss[-1])
        cum = np.r_[0.0, np.cumsum(np.hypot(*np.diff(route["xy"], axis=0).T))]
        eidx = np.clip(np.searchsorted(cum, ss, side="right") - 1, 0, len(route["tags"]) - 1)
        tag_of = [route["tags"][i][0] for i in eidx]
        self.tags = tag_of
        self.way_ids = [route["tags"][i][1] for i in eidx]
        ez = dem.height(xy[:, 0], xy[:, 1])
        self.z_raw = ez
        # median then gaussian smoothing of the surface model (trees, bridges)
        k = 9
        pad = np.r_[np.full(k, ez[0]), ez, np.full(k, ez[-1])]
        med = np.array([np.median(pad[i:i + 2 * k + 1]) for i in range(len(ez))])
        self.z = fit.smooth_xy(np.c_[med, med], step, 200.0)[:, 0]
        self.grade = np.gradient(self.z, step) * 100.0
        self.grade = fit.smooth_xy(np.c_[self.grade, self.grade], step, 150.0)[:, 0]
        self.maxspeed = self._speeds()

    def _speeds(self):
        v = np.array([num(t.get("maxspeed")) or 0.0 for t in self.tags])
        # fill the gaps with the nearest known value
        known = np.where(v > 0)[0]
        if not len(known):
            return np.full(len(v), float(LINE_V_DEFAULT))
        idx = np.searchsorted(known, np.arange(len(v)))
        idx = np.clip(idx, 0, len(known) - 1)
        left = known[np.clip(idx - 1, 0, len(known) - 1)]
        right = known[idx]
        near = np.where(np.abs(np.arange(len(v)) - left) <= np.abs(right - np.arange(len(v))), left, right)
        return v[near]

    def runs(self, pred, min_len):
        """Maximal runs [s0, s1] (real metres) where pred(tags) holds, at least min_len long."""
        out, start = [], None
        for i, t in enumerate(self.tags):
            on = pred(t)
            if on and start is None:
                start = i
            if (not on or i == len(self.tags) - 1) and start is not None:
                end = i if on else i - 1
                s0, s1 = self.s[start], self.s[end] + self.step
                if s1 - s0 >= min_len:
                    out.append((float(s0), float(s1)))
                start = None
        # merge runs separated by < 25 m
        merged = []
        for r in out:
            if merged and r[0] - merged[-1][1] < 25:
                merged[-1] = (merged[-1][0], r[1])
            else:
                merged.append(r)
        return merged


def is_bridge(t):
    return bool(t.get("bridge")) and t.get("bridge") != "no"


def is_tunnel(t):
    return bool(t.get("tunnel")) and t.get("tunnel") not in ("no",)


# ------------------------------------------------------------------------------------------------------------------------------ one leg
def quantised_grade_runs(attrs, a, b):
    """Breakpoints (real s) where the quantised grade changes, with hysteresis and a minimum run length."""
    i0, i1 = int(a // attrs.step), int(b // attrs.step)
    g = attrs.grade[i0:i1 + 1]
    if not len(g):
        return [(a, b, 0.0)]
    q = np.round(g / GRADE_STEP) * GRADE_STEP
    runs = []
    start, cur = 0, q[0]
    for i in range(1, len(q)):
        if abs(g[i] - cur) > GRADE_STEP * 0.75 and abs(q[i] - cur) >= GRADE_STEP - 1e-9:
            runs.append([start, i, cur])
            start, cur = i, q[i]
    runs.append([start, len(q), cur])
    # absorb runs shorter than GRADE_MIN_RUN into the neighbour with the closer value
    changed = True
    while changed and len(runs) > 1:
        changed = False
        for k, r in enumerate(runs):
            if (r[1] - r[0]) * attrs.step < GRADE_MIN_RUN:
                nb = [x for x in (k - 1, k + 1) if 0 <= x < len(runs)]
                j = min(nb, key=lambda x: abs(runs[x][2] - r[2]))
                lo, hi = min(j, k), max(j, k)
                n_a, n_b = runs[lo], runs[hi]
                ln_a, ln_b = n_a[1] - n_a[0], n_b[1] - n_b[0]
                merged = [n_a[0], n_b[1], (n_a[2] * ln_a + n_b[2] * ln_b) / (ln_a + ln_b)]
                runs[lo:hi + 1] = [merged]
                changed = True
                break
    return [(a + r[0] * attrs.step, a + r[1] * attrs.step, float(clamp(round(r[2] / GRADE_STEP) * GRADE_STEP, -GRADE_MAX, GRADE_MAX))) for r in runs]


def game_tokens(leg_pieces, length_game):
    """leg_pieces: [{real0, real1, kind, R, dir, g, v, tunnel, bridge, crossing, min_game}] -> (items, mapping) with game lengths summing to length_game."""
    n = len(leg_pieces)
    real = np.array([p["real1"] - p["real0"] for p in leg_pieces])
    total_real = real.sum()
    k = total_real / length_game
    ka = min(k, ARC_COMPRESS_MAX)
    glen = np.zeros(n)
    arcs = [i for i, p in enumerate(leg_pieces) if p["kind"] == "c"]
    for i in arcs:
        glen[i] = real[i] / ka
    arc_total = glen.sum()
    if arc_total > ARC_SHARE_MAX * length_game:
        glen[arcs] *= ARC_SHARE_MAX * length_game / arc_total
    free = [i for i in range(n) if leg_pieces[i]["kind"] == "s"]
    rest = length_game - glen.sum()
    if free:
        w = real[free]
        glen[free] = rest * w / w.sum()
    else:
        glen *= length_game / glen.sum()
    # minimum lengths for pieces that carry equipment (bridge, tunnel, crossing)
    for _ in range(4):
        low = [i for i in range(n) if glen[i] < leg_pieces[i].get("min_game", 0)]
        if not low:
            break
        for i in low:
            glen[i] = leg_pieces[i]["min_game"]
        flex = [i for i in free if i not in low and glen[i] > leg_pieces[i].get("min_game", MIN_PIECE_GAME) + 5 and not leg_pieces[i].get("pinned")]
        over = glen.sum() - length_game
        if flex and over > 0:
            room = np.array([glen[i] - max(leg_pieces[i].get("min_game", MIN_PIECE_GAME), MIN_PIECE_GAME) for i in flex])
            take = np.minimum(room, over * room / room.sum())
            for i, t in zip(flex, take):
                glen[i] -= t
        elif over > 0:
            arc_flex = [i for i in arcs if i not in low]
            if arc_flex:
                scale = max(0.4, 1 - over / glen[arc_flex].sum())
                glen[arc_flex] *= scale
        elif over < 0 and flex:
            glen[flex] += -over * glen[flex] / glen[flex].sum()
    return glen


def piece_token(p, length, fill=False):
    flags = []
    if p.get("g"):
        flags.append("g%g" % p["g"])
    if p.get("v"):
        flags.append("v%d" % p["v"])
    if p.get("tunnel"):
        flags.append("T")
    if p.get("crossing"):
        flags.append("X")
    if p.get("biome"):
        flags.append("b" + p["biome"])
    if p.get("bridge"):
        b = p["bridge"]
        flags.append("B%s,%d,%s" % ({"viaduct": "v", "steel": "s", "river": "r"}[b["kind"]], b["h"], "w" if b["water"] else "d"))
    if p["kind"] == "s":
        head = "s*" if fill else "s%d" % round(length)
    else:
        R = clamp(p["R_game"], R_MIN, 2400)
        head = "%s%d/%d" % ("r" if p["dir"] == "R" else "l", round(R), round(length))
    return ":".join([head] + flags)


def absorb_tiny(pieces, lens, min_len=26.0):
    """Pieces shorter than min_len (game metres) without equipment are absorbed by a neighbouring straight (or the previous piece)."""
    pieces, lens = list(pieces), list(lens)
    special = lambda p: p.get("tunnel") or p.get("crossing") or p.get("bridge")
    changed = True
    while changed and len(pieces) > 1:
        changed = False
        for i, (p, l) in enumerate(zip(pieces, lens)):
            if l >= min_len or special(p):
                continue
            cand = [j for j in (i - 1, i + 1) if 0 <= j < len(pieces)]
            tgt = next((j for j in cand if pieces[j]["kind"] == "s" and not special(pieces[j])), None)
            if tgt is None:
                tgt = next((j for j in cand if not special(pieces[j])), cand[0])
            lens[tgt] += l
            for kk in ("v", "biome"):          # keep the information the tiny piece carried
                if p.get(kk) and not pieces[tgt].get(kk) and tgt > i:
                    pieces[tgt][kk] = p[kk]
            del pieces[i]
            del lens[i]
            changed = True
            break
    return pieces, np.array(lens)


def r_cap(v_kmh):
    """Radius at which the sim's curve speed (a = 1.3 m/s2) reaches v_kmh + 10: larger radii add nothing."""
    return ((v_kmh + 10.0) / 3.6) ** 2 / 1.3


def build_leg(attrs, a, b, length_game, bridges=(), tunnels=(), crossings=(), biome_at=None, name=""):
    """Fit the real stretch [a, b] (metres along the route) and emit the leg's tokens + the real->game mapping."""
    i0, i1 = int(round(a / attrs.step)), int(round(b / attrs.step))
    sub = attrs.xy[i0:i1 + 1]
    a, b = i0 * attrs.step, i0 * attrs.step + (len(sub) - 1) * attrs.step
    span = b - a
    k = span / length_game
    min_real = MIN_PIECE_GAME * k
    if len(sub) < 8:
        return {"spec": "s*", "length": int(round(length_game)), "real": [a, b], "mapping": [[0, 0], [span, length_game]], "pieces": [], "k": k}
    fitp = fit.fit_pieces(sub, attrs.step)
    # tiny arcs become straights, then neighbours merge again
    for p in fitp:
        if p["kind"] == "c" and (p["s1"] - p["s0"] < min_real * 0.9 or p["R"] > 2200):
            p.update({"kind": "s", "R": 0.0, "dtheta": 0.0})
    fitp = fit.merge(fitp)

    # ---- special windows (local real metres): bridges, tunnels, crossings
    wins = []
    for (s0, s1, meta) in bridges:
        wins.append({"kind": "bridge", "s0": s0 - a, "s1": s1 - a, "meta": meta})
    for (s0, s1) in tunnels:
        wins.append({"kind": "tunnel", "s0": s0 - a, "s1": s1 - a})
    for c in crossings:
        cs = c - a
        half = 35.0 * k
        wins.append({"kind": "crossing", "s0": cs - half, "s1": cs + half, "center": cs})
    # a game bridge / tunnel needs a minimum length: widen the window around its centre
    for w in wins:
        need = {"bridge": 70 if w["kind"] == "bridge" and w["meta"]["kind"] != "viaduct" else 130, "tunnel": 70, "crossing": 70}[w["kind"]] * k
        if w["s1"] - w["s0"] < need and w["kind"] != "crossing":
            c = (w["s0"] + w["s1"]) / 2
            w["s0"], w["s1"] = c - need / 2, c + need / 2
    wins = sorted([w for w in wins if w["s1"] > 0 and w["s0"] < span], key=lambda w: w["s0"])
    clean = []
    for w in wins:
        w["s0"], w["s1"] = clamp(w["s0"], 0, span), clamp(w["s1"], 0, span)
        if clean and w["s0"] < clean[-1]["s1"] + min_real * 0.5:
            if w["kind"] == "crossing":
                if os.environ.get("ZUCH_DEBUG"):
                    print("   [crossing dropped: overlaps %s] %s real %.0f" % (clean[-1]["kind"], name, (w["s0"] + w["s1"]) / 2))
                continue          # a crossing next to a bridge / tunnel / crossing: dropped
            if clean[-1]["kind"] == "crossing":
                clean.pop()
            else:
                continue
        clean.append(w)
    wins = clean
    # crossing roads need room (crossing-roads.js: 130 m from tunnels / bridges, 170 m from platforms, other crossings): drop crossings that would not get it
    def far_enough(w):
        ctr = (w["s0"] + w["s1"]) / 2
        if ctr < CROSS_END_GAME * k or span - ctr < CROSS_END_GAME * k:
            return False
        for o in wins:
            if o is w:
                continue
            gap = (o["s0"] - w["s1"]) if o["s0"] >= w["s1"] else (w["s0"] - o["s1"])
            need = CROSS_CROSS_GAME if o["kind"] == "crossing" else CROSS_EQUIP_GAME
            if gap < need * k:
                if os.environ.get("ZUCH_DEBUG"):
                    print("      culprit %s gap %.0f real (need %.0f) at %.0f-%.0f" % (o["kind"], gap, need * k, o["s0"], o["s1"]))
                return False
        return True
    for w in [w for w in wins if w["kind"] == "crossing"]:
        if not far_enough(w):
            if os.environ.get("ZUCH_DEBUG"):
                print("   [crossing dropped: too close] %s real %.0f of %.0f" % (name, (w["s0"] + w["s1"]) / 2, span))
            wins.remove(w)
    # a crossing sits on a straight: move it to the nearest straight (within 300 real m) or drop it
    arcs = [p for p in fitp if p["kind"] == "c"]
    def in_arc(x):
        return any(p["s0"] <= x <= p["s1"] for p in arcs)
    for w in list(wins):
        if w["kind"] != "crossing":
            continue
        ctr = (w["s0"] + w["s1"]) / 2
        half = (w["s1"] - w["s0"]) / 2
        if in_arc(ctr - half) or in_arc(ctr + half):
            # a crossing on a gentle curve stays where it is: its window is made straight (the heading change inside the window is lost, <= CROSS_LOST_DEG)
            lost = sum(max(0.0, min(p["s1"], ctr + half) - max(p["s0"], ctr - half)) / max(p["R"], 1.0) for p in arcs)
            if math.degrees(lost) <= CROSS_LOST_DEG:
                continue
            moved = None
            for d in range(10, 270, 10):
                for sg in (-1, 1):
                    c2 = ctr + sg * d
                    if half < c2 < span - half and not in_arc(c2 - half) and not in_arc(c2 + half) and all(c2 + half < o["s0"] or c2 - half > o["s1"] for o in wins if o is not w):
                        moved = c2
                        break
                if moved:
                    break
            if moved is None:
                if os.environ.get("ZUCH_DEBUG"):
                    print("   [crossing dropped: no straight] %s real %.0f of %.0f" % (name, ctr, span))
                wins.remove(w)
                continue
            w["s0"], w["s1"] = moved - half, moved + half

    # ---- cut points by priority; low priority ones must keep min_real from every accepted cut
    cuts = [(0.0, 0), (span, 0)]
    for w in wins:
        cuts += [(w["s0"], 0), (w["s1"], 0)]
    for p in fitp:
        cuts += [(p["s0"], 1), (p["s1"], 1)]
    runs = quantised_grade_runs(attrs, a, b)
    for r in runs:
        cuts += [(r[0] - a, 2), (r[1] - a, 2)]
    vs = attrs.maxspeed[i0:i1 + 1]
    for i in range(1, len(vs)):
        if round(vs[i] / 10) != round(vs[i - 1] / 10):
            cuts.append((i * attrs.step, 3))
    if biome_at:
        for s0, s1, _ in biome_at:
            cuts += [(clamp(s0 - a, 0, span), 3), (clamp(s1 - a, 0, span), 3)]
    inside = lambda x: any(w["s0"] + 1e-6 < x < w["s1"] - 1e-6 for w in wins)
    acc = []
    for c, pr in sorted(((clamp(c, 0, span), pr) for c, pr in cuts), key=lambda t: (t[1], t[0])):
        if pr >= 2 and inside(c):
            continue
        if pr == 1 and inside(c):
            continue
        if all(abs(c - x) >= (1.0 if pr == 0 else min_real) for x in acc):
            acc.append(c)
    cl = sorted(acc)
    leg_pieces = []
    for c0, c1 in zip(cl[:-1], cl[1:]):
        mid = (c0 + c1) / 2
        fp = next((p for p in fitp if p["s0"] - 1e-6 <= mid <= p["s1"] + 1e-6), fitp[-1])
        item = {"real0": c0, "real1": c1, "kind": fp["kind"], "R": fp["R"], "dir": fp["dir"]}
        i_a, i_b = int(c0 // attrs.step), max(int(c0 // attrs.step) + 1, int(c1 // attrs.step))
        item["g_real"] = float(np.mean(attrs.grade[i0 + i_a:i0 + i_b + 1]))
        item["v_real"] = float(np.median(vs[i_a:i_b + 1])) if len(vs) else 0.0
        for w in wins:
            if w["s0"] - 1e-6 <= mid <= w["s1"] + 1e-6:
                if w["kind"] == "bridge":
                    item["bridge"] = w["meta"]
                    item["min_game"] = 60 if w["meta"]["kind"] != "viaduct" else 110
                elif w["kind"] == "tunnel":
                    item["tunnel"] = True
                    item["min_game"] = 60
                elif w["kind"] == "crossing":
                    item["crossing"] = True
                    item["min_game"] = 70
                    item["kind"], item["R"] = "s", 0.0
        if biome_at:
            item["biome"] = next((x[2] for x in biome_at if x[0] - a <= mid <= x[1] - a), None)
        leg_pieces.append(item)
    # equipment pieces take their grade from the surrounding value (steady across a bridge)
    for p in leg_pieces:
        g = clamp(round(p["g_real"] / GRADE_STEP) * GRADE_STEP, -GRADE_MAX, GRADE_MAX)
        p["g"] = float(g)
        p["R_game"] = clamp(p["R"], R_MIN, r_cap(p["v_real"] or LINE_V_DEFAULT)) if p["kind"] == "c" else 0.0
    glen = game_tokens(leg_pieces, length_game)
    mapping = [[0.0, 0.0]]
    acc_g = 0.0
    for p, gl in zip(leg_pieces, glen):
        acc_g += gl
        mapping.append([p["real1"], acc_g])
    # speed tokens: where the rounded speed changes and the zone is at least 500 real metres long (the sim merges shorter ones anyway)
    cur, last_i = None, None
    for i, p in enumerate(leg_pieces):
        v = int(round(p["v_real"] / 10.0) * 10) if p["v_real"] else None
        if v and (cur is None or (v != cur and sum(q["real1"] - q["real0"] for q in leg_pieces[i:i + 6] if int(round(q["v_real"] / 10.0) * 10) == v) >= 500)):
            p["v"] = v
            cur = v
    cb = None
    for p in leg_pieces:
        if p.get("biome") and p["biome"] != cb:
            cb = p["biome"]
        else:
            p["biome"] = None
    # merge neighbours that have identical tokens (plain pieces split only by a cut that carries no information any more)
    def key(p):
        return (p["kind"], round(p["R_game"]) if p["kind"] == "c" else 0, p["dir"] if p["kind"] == "c" else "", p["g"], p.get("v"), p.get("tunnel"), p.get("crossing"), p.get("biome"), json.dumps(p.get("bridge"), sort_keys=True))
    merged, mlen = [], []
    for p, gl in zip(leg_pieces, glen):
        if merged and key(merged[-1]) == key(p) and not p.get("crossing") and not p.get("bridge") and not p.get("tunnel") and p.get("v") is None and p.get("biome") is None:
            merged[-1]["real1"] = p["real1"]
            mlen[-1] += gl
        else:
            merged.append(dict(p))
            mlen.append(gl)
    leg_pieces, glen = absorb_tiny(merged, mlen)
    fill_i = max((i for i, p in enumerate(leg_pieces) if p["kind"] == "s" and not p.get("tunnel") and not p.get("bridge") and not p.get("crossing")), key=lambda i: glen[i], default=None)
    # the fill straight (s*) must keep at least 40 m: the others give up the difference
    need = 40.0
    if fill_i is None:
        # no plain straight: the sim needs a fill piece, so a 40 m one is added and the others shrink
        glen = glen * (length_game - need) / glen.sum()
        leg_pieces = leg_pieces + [{"kind": "s", "R": 0.0, "dir": "L", "g": 0.0, "R_game": 0.0, "real0": leg_pieces[-1]["real1"], "real1": leg_pieces[-1]["real1"]}]
        glen = np.r_[glen, need]
        fill_i = len(leg_pieces) - 1
    elif glen[fill_i] < need:
        others = [i for i in range(len(glen)) if i != fill_i]
        glen[others] *= (length_game - need) / glen[others].sum()
        glen[fill_i] = need
    # W3: the minimum lengths of tunnels / bridges / crossings can push the fixed pieces past the leg (Ottignies - Bruxelles-Luxembourg: 1392 m fixed in a 1399 m leg): routes.js warns below 30 m of fill
    others_i = [i for i in range(len(glen)) if i != fill_i]
    if others_i and glen[others_i].sum() > length_game - need:
        glen[others_i] *= (length_game - need) / glen[others_i].sum()
        glen[fill_i] = need
    toks = [piece_token(p, gl, fill=(i == fill_i)) for i, (p, gl) in enumerate(zip(leg_pieces, glen))]
    return {"spec": " ".join(toks), "length": int(round(length_game)), "real": [round(a, 1), round(b, 1)], "k": round(k, 3),
            "mapping": [[round(x, 1), round(y, 1)] for x, y in mapping],
            "pieces": [{kk: (round(v, 2) if isinstance(v, float) else v) for kk, v in p.items() if kk != "meta"} for p in leg_pieces]}


# ------------------------------------------------------------------------------------------------------------------------------ features of the route
def waterway_index(tiles):
    out = []
    for t in tiles["waterways"]:
        if t["t"].get("waterway") in ("river", "canal", "stream"):
            out.append(t)
    return out


def detect_bridges(attrs, dem, waters_tree, waters):
    """[(s0, s1, {kind, h, water})] for the bridges of the route that matter in the sim."""
    out = []
    xy = attrs.xy
    for s0, s1 in attrs.runs(is_bridge, BRIDGE_MIN_REAL):
        i0, i1 = int(s0 // attrs.step), int(min(len(xy) - 1, s1 // attrs.step))
        seg = LineString(xy[i0:i1 + 1])
        near = [waters[j] for j in waters_tree.query(seg.buffer(14))]
        wat = [w for w in near if w["g"].distance(seg) < 12 and w["g"].intersects(seg.buffer(10))]
        big = [w for w in wat if w["t"].get("waterway") in ("river", "canal")]
        # ground below: lowest surface model value in a +-45 m band across the bridge vs the deck level
        d = np.gradient(xy[i0:i1 + 1], axis=0)
        nrm = np.c_[-d[:, 1], d[:, 0]]
        nrm /= np.hypot(nrm[:, 0], nrm[:, 1])[:, None] + 1e-9
        samples = []
        for off in (-45.0, -22.0, 22.0, 45.0):
            pts = xy[i0:i1 + 1] + nrm * off
            samples.append(dem.height(pts[:, 0], pts[:, 1]))
        ground = float(np.min(np.vstack(samples)))
        deck = float(np.median(attrs.z_raw[max(0, i0 - 8):i1 + 9]))
        h = clamp(deck - ground, 3.0, 50.0)
        name = (big[0]["t"].get("name") if big else "") or ""
        length = s1 - s0
        if big or wat:
            kind = "steel" if (big and name in ("Mosel", "Sauer", "Saar") and length > 90) else "river"
            h = clamp(max(h, 5.0), 5, 24)
            out.append((s0, s1, {"kind": kind, "h": int(round(h)), "water": True, "name": name}))
        elif h >= 9 and length >= 70:
            out.append((s0, s1, {"kind": "viaduct", "h": int(round(min(h, 40))), "water": False, "name": ""}))
    return out


def crossings_of(attrs, railpoints):
    line = LineString(attrs.xy)
    out = []
    for p in railpoints:
        if p["t"].get("railway") == "level_crossing" and line.distance(p["g"]) < 9:
            out.append({"s": float(line.project(p["g"])), "barrier": p["t"].get("crossing:barrier") or p["t"].get("crossing") or "", "id": p["id"],
                        "lat": 0.0, "xy": [float(p["g"].x), float(p["g"].y)]})
    out.sort(key=lambda c: c["s"])
    merged = []
    for c in out:
        if merged and c["s"] - merged[-1]["s"] < 70:
            continue
        merged.append(c)
    return merged


def route_features(attrs, dem, tiles):
    from shapely import STRtree
    waters = waterway_index(tiles)
    tree = STRtree([w["g"] for w in waters])
    return {
        "bridges": detect_bridges(attrs, dem, tree, waters),
        "tunnels": attrs.runs(is_tunnel, TUNNEL_MIN_REAL),
        "crossings": crossings_of(attrs, tiles["railpoints"]),
    }


def stops_of(route_name, pts, attrs):
    seq = [o for sg, o, g, z in rp.STOPS if sg == "A"] + [o for sg, o, g, z in rp.STOPS if sg == ("W" if route_name == "wittlich" else "H")] + [o for sg, o, g, z in rp.STOPS if sg == "B"]
    line = LineString(attrs.xy)
    out, prev = [], -1
    for osm in seq:
        if osm not in pts:
            continue
        s = float(line.project(pts[osm]))
        if s <= prev:
            continue
        prev = s
        game, size = next((g, z) for _, o, g, z in rp.STOPS if o == osm)
        out.append({"osm": osm, "game": game, "size": size, "s": s, "off": float(line.distance(pts[osm])), "seg": next(sg for sg, o, g, z in rp.STOPS if o == osm)})
    return out


def platform_side(attrs, stop, platforms):
    """+1 / -1: platform on the right / left of the direction of travel (the nearest platform edge within 40 m of the track near the stop)."""
    i = int(stop["s"] // attrs.step)
    lo, hi = max(0, i - 15), min(len(attrs.xy) - 2, i + 15)
    best = None
    for pl in platforms:
        g = pl["g"]
        for k in range(lo, hi + 1, 3):
            p = Point(attrs.xy[k])
            d = g.distance(p)
            if d > 40:
                continue
            q = g.interpolate(g.project(p))
            t = attrs.xy[min(k + 1, len(attrs.xy) - 1)] - attrs.xy[max(k - 1, 0)]
            t = t / (np.hypot(*t) + 1e-9)
            lat = (q.x - attrs.xy[k][0]) * t[1] - (q.y - attrs.xy[k][1]) * t[0]
            if best is None or d < best[0]:
                best = (d, 1 if lat > 0 else -1)
    return best[1] if best else None


def biome_windows(attrs, land, step=20.0):
    """[(s0, s1, biome)] from the land classes within 100 m of the line."""
    from real_line_land import FOREST, FIELD, INDUS, RESID, SCRUB, URBAN, VINE
    ns = int(attrs.length // step)
    idx = np.minimum((np.arange(ns) * step / attrs.step).astype(int), len(attrs.xy) - 2)
    p = attrs.xy[idx]
    t = attrs.xy[idx + 1] - attrs.xy[idx]
    t /= np.hypot(t[:, 0], t[:, 1])[:, None] + 1e-9
    r = np.c_[t[:, 1], -t[:, 0]]
    cls = []
    for off in (-100.0, -60.0, -25.0, 25.0, 60.0, 100.0):
        q = p + r * off
        cls.append(land.at(q[:, 0], q[:, 1]))
    cls = np.array(cls).T
    def frac(*c):
        return np.isin(cls, c).mean(axis=1)
    urban, res, ind, forest, vine = frac(URBAN), frac(RESID, URBAN), frac(INDUS), frac(FOREST), frac(VINE)
    urban = np.where(res >= 0.5, urban, 0.0)
    bio = np.where(ind >= 0.3, "industrial", np.where(res >= 0.5, np.where(urban >= 0.4, "city", "suburb"), np.where(res >= 0.3, "suburb", np.where(vine >= 0.2, "vineyard", np.where(forest >= 0.4, "forest", "farmland")))))
    # majority filter over 15 samples, then merge windows shorter than 200 m
    names = ["city", "suburb", "industrial", "vineyard", "forest", "farmland"]
    code = np.array([names.index(b) for b in bio])
    sm = code.copy()
    for k in range(ns):
        win = code[max(0, k - 7):k + 8]
        sm[k] = np.bincount(win, minlength=len(names)).argmax()
    wins = []
    start = 0
    for k in range(1, ns + 1):
        if k == ns or sm[k] != sm[start]:
            wins.append([start * step, k * step, names[sm[start]]])
            start = k
    changed = True
    while changed and len(wins) > 1:
        changed = False
        for n, w in enumerate(wins):
            if w[1] - w[0] < 240:
                nb = wins[n - 1] if n > 0 else wins[n + 1]
                nb2 = wins[n + 1] if n + 1 < len(wins) else nb
                tgt = nb if (w[1] - w[0]) and (nb[1] - nb[0]) >= (nb2[1] - nb2[0]) else nb2
                tgt[0], tgt[1] = min(tgt[0], w[0]), max(tgt[1], w[1])
                wins.pop(n)
                changed = True
                break
    out = []
    for w in wins:
        if out and out[-1][2] == w[2]:
            out[-1][1] = w[1]
        else:
            out.append(list(w))
    out[0][0], out[-1][1] = 0.0, attrs.length
    for a, b in zip(out[:-1], out[1:]):
        m = (a[1] + b[0]) / 2
        a[1], b[0] = m, m
    return [tuple(x) for x in out]


LEG_OVERRIDE = {('Wittlich', 'Cochem'): 2200, ('Cochem', 'Koblenz Hbf'): 1800}


def leg_length_game(real_gap):
    return clamp(GAME_PER_REAL * real_gap, LEG_MIN, LEG_MAX)


def junctions(routes):
    """(J1, J2): arc length on the route 'wittlich' where the two routes separate / meet again, and the same on 'trier'."""
    w, h = routes["wittlich"]["xy"], routes["trier"]["xy"]
    j1 = common_prefix_len(w, h)
    cum_w = np.r_[0.0, np.cumsum(np.hypot(*np.diff(w, axis=0).T))]
    cum_h = np.r_[0.0, np.cumsum(np.hypot(*np.diff(h, axis=0).T))]
    suf = common_suffix_len(w, h)
    return {"wittlich": (j1, float(cum_w[-1] - suf)), "trier": (j1, float(cum_h[-1] - suf))}


MERGE_BEFORE_BLOCK = 260.0    # the branches are cut this far before the Hafenstrasse block (the tail geometry of the Weststrecke is used for both)


def build_route_legs(route_name, routes, pts, tiles, dem, land, scale=None, only=None):
    attrs = RouteAttrs(routes[route_name], dem)
    feats = route_features(attrs, dem, tiles)
    stops = stops_of(route_name, pts, attrs)
    biomes = biome_windows(attrs, land)
    j1, j2 = junctions(routes)[route_name]
    haf = next(st for st in stops if st["osm"] == "Trier Hafenstraße")
    j2 = haf["s"] - HALF_BLOCK - MERGE_BEFORE_BLOCK
    branch = "W" if route_name == "wittlich" else "H"
    platforms = [p for p in tiles["rails"] if p["t"].get("railway") in ("platform", "platform_edge")]
    for st in stops:
        side = platform_side(attrs, st, platforms)
        st["side"] = "right" if (side or 1) > 0 else "left"
        st["side_known"] = side is not None
        st["biome"] = "city" if st["size"] >= 3 else next((w[2] for w in biomes if w[0] <= st["s"] <= w[1]), "farmland")
    scale = scale or {}
    legs = []
    for i in range(len(stops) - 1):
        A, B = stops[i], stops[i + 1]
        a, b = A["s"] + HALF_BLOCK, B["s"] - HALF_BLOCK
        if b - a < 200:
            print("  leg %s -> %s too short (%d m real)" % (A["game"], B["game"], b - a))
            continue
        Lg = LEG_OVERRIDE.get((A["game"], B["game"])) or leg_length_game(b - a)
        # split at the junctions that fall inside this leg
        cuts = [x for x in (j1, j2) if a + 150 < x < b - 150]
        edges = [a] + cuts + [b]
        parts = []
        for pa, pb in zip(edges[:-1], edges[1:]):
            mid = (pa + pb) / 2
            seg = "A" if mid < j1 else branch if mid < j2 else "B"
            parts.append((pa, pb, seg))
        weights = np.array([pb - pa for pa, pb, _ in parts])
        lens = [max(150.0, Lg * w / weights.sum()) for w in weights]
        for n, (pa, pb, seg) in enumerate(parts):
            if only and A["game"] not in only:
                continue
            Lp = lens[n] * scale.get(seg, 1.0)
            br = [x for x in feats["bridges"] if x[1] > pa and x[0] < pb]
            tu = [x for x in feats["tunnels"] if x[1] > pa and x[0] < pb]
            cr = [c["s"] for c in feats["crossings"] if pa + 20 < c["s"] < pb - 20 and not any(abs(c["s"] - st["s"]) < HALF_BLOCK + 20 for st in stops)]
            bw = [w for w in biomes if w[1] > pa and w[0] < pb]
            leg = build_leg(attrs, pa, pb, Lp, name=A["game"], bridges=[(max(x[0], pa), min(x[1], pb), x[2]) for x in br], tunnels=[(max(x[0], pa), min(x[1], pb)) for x in tu], crossings=cr, biome_at=bw)
            leg.update({"from": A["game"], "to": B["game"], "real_gap": round(pb - pa), "seg": seg, "part": n, "parts": len(parts)})
            legs.append(leg)
    return attrs, stops, feats, legs, (j1, j2), biomes


def plot_legs(attrs, legs, path):
    """QA sheet: heading (deg, relative) of the real line (blue) and of the fitted game line (red) against the normalised distance, one panel per leg; grade below."""
    from PIL import Image, ImageDraw
    W, H, M = 760, 150, 24
    im = Image.new("RGB", (W, H * len(legs)), "white")
    d = ImageDraw.Draw(im)
    for n, leg in enumerate(legs):
        y0 = n * H
        a, b = leg["real"]
        i0, i1 = int(round(a / attrs.step)), int(round(b / attrs.step))
        th = np.degrees(fit.headings(fit.smooth_xy(attrs.xy[i0:i1 + 1], attrs.step, 22.0), attrs.step))
        th -= th[0]
        lim = max(30.0, float(np.abs(th).max()) * 1.1)
        gh, acc, th_g = [0.0], 0.0, 0.0
        gx = [0.0]
        pos = 0.0
        tot = sum(sum(1 for _ in [0]) for _ in [0])
        total_game = leg["length"]
        for p in leg["pieces"]:
            gl = None
        # rebuild game heading from the mapping
        pcs = leg["pieces"]
        gl = np.diff([m[1] for m in leg["mapping"]])
        for p, l in zip(pcs, gl):
            if p["kind"] == "c":
                th_g += math.degrees(l / p["R_game"]) * (1 if p["dir"] == "R" else -1)
            pos += l
            gx.append(pos / max(1.0, leg["mapping"][-1][1]))
            gh.append(th_g)
        lim = max(lim, float(np.abs(gh).max()) * 1.1)
        def X(u):
            return M + u * (W - 2 * M)
        def Y(v):
            return y0 + H / 2 + 8 - v / lim * (H / 2 - 22)
        d.line([(M, Y(0)), (W - M, Y(0))], fill=(200, 200, 200))
        d.line([(X(i / (len(th) - 1)), Y(v)) for i, v in enumerate(th)], fill=(40, 90, 220), width=2)
        d.line([(X(u), Y(v)) for u, v in zip(gx, gh)], fill=(220, 50, 40), width=2)
        for p, l in zip(pcs, gl):
            pass
        d.text((6, y0 + 3), "%s -> %s  real %d m  game %d m  k=%.1f  %d pieces" % (leg["from"], leg["to"], leg["real_gap"], leg["length"], leg["k"], len(pcs)), fill=(0, 0, 0))
        d.text((W - 170, y0 + 3), "+/-%d deg (blue real, red game)" % lim, fill=(90, 90, 90))
    im.save(path)


def side_fix(stops):
    """Stops whose platform side could not be read from OSM take the side of the previous stop (alternating would be a guess)."""
    last = "right"
    for st in stops:
        if not st["side_known"]:
            st["side"] = last
        last = st["side"]


def emit(routes, pts, tiles, dem, land):
    """Both routes -> the four shared segments (A, W, H, B) with equal branch lengths."""
    scale = {}
    for attempt in range(2):
        res = {}
        for name in ("wittlich", "trier"):
            res[name] = build_route_legs(name, routes, pts, tiles, dem, land, scale=scale)
            side_fix(res[name][1])
        tot = {}
        for name, seg in (("wittlich", "W"), ("trier", "H")):
            _, stops, _, legs, _, _ = res[name]
            n_st = sum(1 for st in stops if st["seg"] == seg)
            tot[seg] = sum(l["length"] for l in legs if l["seg"] == seg) + n_st * (2 * HALF_BLOCK)
        print("branch totals (game m):", {k: round(v) for k, v in tot.items()}, "scale", scale)
        if attempt == 0:
            long_seg = max(tot, key=tot.get)
            short_seg = min(tot, key=tot.get)
            st_cnt = {"W": sum(1 for st in res["wittlich"][1] if st["seg"] == "W"), "H": sum(1 for st in res["trier"][1] if st["seg"] == "H")}
            legs_len = {s: tot[s] - st_cnt[s] * 2 * HALF_BLOCK for s in tot}
            scale[short_seg] = (tot[long_seg] - st_cnt[short_seg] * 2 * HALF_BLOCK) / legs_len[short_seg]
    segs = {"A": [], "W": [], "H": [], "B": []}
    legs_meta = {}
    counters = {k: 0 for k in segs}
    stations = {}
    for name in ("wittlich", "trier"):
        attrs, stops, feats, legs, (j1, j2), biomes = res[name]
        for i, st in enumerate(stops):
            take = (name == "wittlich" and st["seg"] in ("A", "W", "B")) or (name == "trier" and st["seg"] == "H")
            if take:
                segs[st["seg"]].append({"t": "station", "name": st["game"], "_i": i, "_route": name})
                stations[st["game"]] = {"size": st["size"], "side": st["side"], "biome": st["biome"], "osm": st["osm"],
                                         "s_real": round(st["s"], 1), "route": name}
        for leg in legs:
            take = (name == "wittlich" and leg["seg"] in ("A", "W", "B")) or (name == "trier" and leg["seg"] == "H")
            if not take:
                continue
            counters[leg["seg"]] += 1
            lid = "%s%02d" % (leg["seg"], counters[leg["seg"]])
            segs[leg["seg"]].append({"t": "leg", "id": lid, "from": leg["from"], "to": leg["to"], "length": leg["length"], "spec": leg["spec"], "_from_stop": leg["from"], "_route": name})
            legs_meta[lid] = {"route": name, "from": leg["from"], "to": leg["to"], "real": leg["real"], "k": leg["k"], "mapping": leg["mapping"], "pieces": leg["pieces"]}
    # order the items of every segment by their position on the route (station i, then the legs after it)
    def key(it, name_idx):
        return 0
    return segs, legs_meta, stations, res


def order_segments(segs, res):
    """Sort each segment's items in route order: stations by index, legs right after the station they start from."""
    out = {}
    for seg, items in segs.items():
        route = "trier" if seg == "H" else "wittlich"
        stops = res[route][1]
        pos = {st["game"]: i for i, st in enumerate(stops)}
        def k(it):
            if it["t"] == "station":
                return (pos[it["name"]], 0, 0)
            # legs sort after their from-station; several parts of one leg keep their creation order
            return (pos[it["from"]], 1, int(it["id"][1:]))
        out[seg] = sorted(items, key=k)
    return out


def write_layout(segs, legs_meta, stations, path_json, path_meta):
    clean = {seg: [{kk: v for kk, v in it.items() if not kk.startswith("_")} for it in items] for seg, items in segs.items()}
    # the legs keep only what the game needs; the mapping stays in the work file for the feature stage
    game_legs = {lid: {"from": m["from"], "to": m["to"], "k": m["k"]} for lid, m in legs_meta.items()}
    os.makedirs(os.path.dirname(path_json), exist_ok=True)
    doc = {"version": 1, "stations": stations, "segments": clean, "legs": game_legs}
    with open(path_json, "w") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    js = os.path.join(REPO, "pb", "train-sim", "real-mosel.js")
    slim = {"version": 1, "stations": {n: {"size": v["size"], "side": v["side"], "biome": v["biome"]} for n, v in stations.items()}, "segments": clean}
    with open(js, "w") as f:
        f.write("/* GENERATED by scripts/zuch/build_real_line.py emit (OSM main track of the Mosel line, see pb/train-sim/REAL-LINES.md). Do not edit by hand. */\n")
        f.write("(function () { 'use strict'; window.TS = window.TS || {}; window.TS.realMosel = Object.freeze(")
        json.dump(slim, f, ensure_ascii=False, separators=(",", ":"))
        f.write("); })();\n")
    with open(path_meta, "w") as f:
        json.dump(legs_meta, f)


def write_features(segs, legs_meta, stations, res, tiles, dem, land):
    import real_line_scenery as sc
    import real_line_crossings as rc
    waters = [w for w in tiles["waterways"] if w["t"].get("waterway") in ("river", "canal", "stream")]
    wtree = STRtree([w["g"] for w in waters])
    roads = [w for w in tiles["highways"] if w["t"].get("highway") in sc.ROAD_CLASSES]
    rtree = STRtree([w["g"] for w in roads])
    road_lines = [w["g"] for w in roads]
    out = {}
    # the station blocks (290 m: approach + platform + approach) get their own scenery records "st:<name>": the real stretch around the stop, 1:1
    blocks = {}
    for name, st in stations.items():
        blocks["st:" + name] = {"route": st["route"], "from": name, "to": name, "real": [st["s_real"] - HALF_BLOCK, st["s_real"] + HALF_BLOCK], "k": 1.0, "mapping": [[0.0, 0.0], [2 * HALF_BLOCK, 2 * HALF_BLOCK]]}
    all_meta = dict(legs_meta)
    all_meta.update(blocks)
    for lid, meta in all_meta.items():
        route = meta["route"]
        attrs, stops, feats, legs, _, _ = res[route]
        g = sc.LegGeom(attrs, meta)
        rd = sc.roads_of_leg(g, roads, rtree)
        is_block = lid.startswith("st:")
        arm_ctx = None if is_block else {"fn": lambda gg, xy, sgc, _l=LineString(attrs.xy): rc.arms_of_crossing(gg, xy, sgc, roads, rtree, _l, road_lines, rtree)}
        cross, arms_abs = sc.crossings_of_leg(g, feats["crossings"], rd, meta=None if is_block else all_meta[lid], arm_ctx=arm_ctx)
        rd = rc.drop_arm_ribbons(rd, arms_abs)
        out[lid] = {
            "L": round(g.length, 1),
            "land": sc.land_raster(g, land),
            "far": sc.far_raster(g, land),
            "water": sc.water_windows(g, waters, wtree),
            "roads": rd,
            "relief": sc.relief(g, dem),
            "places": sc.places_of_leg(g, tiles["places"]),
            "crossings": cross,
        }
        print("  features", lid, meta["from"], "->", meta["to"], "roads", len(rd), "water", len(out[lid]["water"]), "places", len(out[lid]["places"]), "crossings", len(out[lid]["crossings"]))
    doc = {"version": 1, "row": sc.ROW_M, "col": sc.COL_M, "lat0": sc.LAT0, "cols": sc.COLS, "far": {"row": sc.FAR_ROW, "col": sc.FAR_COL, "lat0": sc.FAR_LAT0, "cols": sc.FAR_COLS}, "classes": __import__("real_line_land").CLASS_NAMES, "legs": out}
    path = os.path.join(OUT, "mosel-features.json")
    with open(path, "w") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
    print("features ->", path, os.path.getsize(path) // 1024, "kB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=["layout", "emit"])
    ap.add_argument("--plot", default="")
    ap.add_argument("--route", default="wittlich")
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    routes, pts, tiles = build_routes()
    dem = Dem()
    from real_line_land import LandIndex
    land = LandIndex(tiles["landuse"])
    if args.stage == "emit":
        segs, legs_meta, stations, res = emit(routes, pts, tiles, dem, land)
        segs = order_segments(segs, res)
        write_layout(segs, legs_meta, stations, os.path.join(OUT, "mosel-layout.json"), os.path.join(rp.CACHE, "mosel-legs-meta.json"))
        write_features(segs, legs_meta, stations, res, tiles, dem, land)
        for seg, items in segs.items():
            print(seg, " | ".join(it["name"] if it["t"] == "station" else "%s %d" % (it["id"], it["length"]) for it in items))
        return
    only = set(x for x in args.only.split(",") if x)
    attrs, stops, feats, legs, (j1, j2), biomes = build_route_legs(args.route, routes, pts, tiles, dem, land, only=only)
    print("route", args.route, round(attrs.length), "m;", len(stops), "stops;", len(feats["bridges"]), "bridges", len(feats["tunnels"]), "tunnels", len(feats["crossings"]), "crossings; J1 %.0f J2 %.0f" % (j1, j2))
    for st in stops:
        print("  stop %-22s s=%6.0f side %-5s%s biome %s seg %s" % (st["game"], st["s"], st["side"], "" if st["side_known"] else "?", st["biome"], st["seg"]))
    for leg in legs:
        print("%-22s -> %-22s %s real %5d m game %4d  %s" % (leg["from"], leg["to"], leg["seg"], leg["real_gap"], leg["length"], leg["spec"][:150]))
    if args.plot:
        plot_legs(attrs, legs, args.plot)


if __name__ == "__main__":
    main()
