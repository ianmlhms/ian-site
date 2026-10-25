"""Trail features, checkpoints and signposts for the named trails (called by bake_trails.py; deterministic: every trail has a seed).

A feature is a stylised addition to the carved bed, placed ALONG the real path where the terrain suits it:
    roller    n bumps of period p and height h (pump them)                    needs a gentle straight descent
    kicker    ramp up, sharp lip, a gap and a landing hump (a small table)     needs a straight descent
    drop      the bed is raised on the approach and falls away at the lip      needs a straight steep stretch
    berm      a boosted banked turn                                            at a tight bend
    slab      a stretch of bare sandstone (rock surface, stepped)
    roots     tree roots across the path (bumps, slippery when wet)
    mud       a muddy stretch (slow, low grip)
    leaves    deep leaf litter (a little less grip)
    boardwalk wooden planks over soft ground (fast, slippery when wet)
    bridge    a wooden bridge deck where the trail crosses a stream            (found automatically)
The runtime (pb/mtb/trails.js) turns each feature into bed offsets, a surface code and (bridge, boardwalk) physics decks; pb/mtb/props.js draws the roots, planks, rails.
Positions are WORLD metres of the feature's first point; `len` is its length along the trail (m), so the runtime does not depend on the exact smoothing of the line.
"""
import math
import os
import random
import struct

import numpy as np

from common import OUT_DIR

DENSE = 2.0                 # m between analysis points
EDGE_FREE = 45.0            # no feature within this distance of the start and the finish (the gate and the arch need calm ground)
MAX_DECK_GRADE = 0.16       # a bridge deck is never steeper than this (rise / run)
MIN_GAP = 22.0              # m between features
KINDS_STREAM = (4, 5)       # stream, river (ditches are too small for a bridge)
GRADE_FEATURES = {
    "green": {"roller": 0.26, "kicker": 0.0, "drop": 0.0, "gap": 0.0},
    "blue": {"roller": 0.38, "kicker": 0.55, "drop": 0.6, "gap": 3.4},
    "red": {"roller": 0.45, "kicker": 0.72, "drop": 0.95, "gap": 4.2},
    "black": {"roller": 0.5, "kicker": 0.95, "drop": 1.4, "gap": 5.4},
}
CHECKPOINT_SPACING = 480.0  # m between split times (a trail of L metres gets round(L / 480) - 1 checkpoints, at least 1)
SIGN_SPACING = 260.0        # m between direction signposts
POST_OFFSET = 2.1           # m to the right of the trail centre


def load_streams():
    """streams.bin (the carved water channels): list of {kind, pts} with kind 4 stream / 5 river / 6 ditch."""
    import json
    bin_ = open(os.path.join(OUT_DIR, "streams.bin"), "rb").read()
    meta = json.load(open(os.path.join(OUT_DIR, "streams.json")))
    count = struct.unpack_from("<I", bin_, 0)[0]
    pos = 4
    out = []

    def varint():
        nonlocal pos
        r, shift = 0, 0
        while True:
            b = bin_[pos]
            pos += 1
            r |= (b & 0x7F) << shift
            if b < 0x80:
                return r
            shift += 7
    for w in range(count):
        n, x, z = struct.unpack_from("<Hii", bin_, pos)
        pos += 10
        pts = [(x * 0.1, z * 0.1)]
        for _ in range(n - 1):
            dx, dz = varint(), varint()
            x += (dx >> 1) ^ -(dx & 1)
            z += (dz >> 1) ^ -(dz & 1)
            pts.append((x * 0.1, z * 0.1))
        out.append({"kind": meta[w]["k"], "tunnel": bool(meta[w]["f"] & 2), "pts": pts})
    return out


def load_classes():
    b = open(os.path.join(OUT_DIR, "classes.bin"), "rb").read()
    nx, nz = struct.unpack("<HH", b[:4])
    pos = 4
    out = bytearray()
    while len(out) < nx * nz:
        v = b[pos]
        pos += 1
        r, shift = 0, 0
        while True:
            c = b[pos]
            pos += 1
            r |= (c & 0x7F) << shift
            if c < 0x80:
                break
            shift += 7
        out.extend(bytes([v]) * r)
    return np.frombuffer(bytes(out[:nx * nz]), dtype=np.uint8).reshape(nz, nx)


def dense_line(line):
    """The OSM node chain resampled every DENSE metres: returns (xs, zs, s) numpy arrays."""
    pts = np.asarray(line, dtype=float)
    seg = np.hypot(np.diff(pts[:, 0]), np.diff(pts[:, 1]))
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    total = cum[-1]
    s = np.arange(0.0, total, DENSE)
    s = np.append(s, total)
    return np.interp(s, cum, pts[:, 0]), np.interp(s, cum, pts[:, 1]), s


def smooth(a, k):
    if k <= 1:
        return a
    kernel = np.ones(k) / k
    pad = np.pad(a, (k // 2, k // 2), mode="edge")
    return np.convolve(pad, kernel, mode="valid")[:len(a)]


def analyse(line, height_at, classes):
    xs, zs, s = dense_line(line)
    h = np.array([height_at(x, z) for x, z in zip(xs, zs)])
    hs = smooth(h, 5)
    slope = np.gradient(hs, s)                                 # rise / run along the trail (negative = downhill)
    heading = np.unwrap(np.arctan2(np.gradient(zs), np.gradient(xs)))
    kappa = smooth(np.gradient(heading, s), 5)                 # 1/m, + = turning towards +z (right turn when heading east)
    cls = np.array([classes[min(classes.shape[0] - 1, int(z / 4)), min(classes.shape[1] - 1, int(x / 4))] for x, z in zip(xs, zs)])
    return {"x": xs, "z": zs, "s": s, "h": h, "slope": smooth(slope, 7), "kappa": kappa, "cls": cls, "heading": heading, "length": float(s[-1])}


def crossings(a, streams):
    """Where the trail crosses a (non tunnel, non ditch) stream: list of (s, x, z, kind). Vectorised over the trail segments."""
    out = []
    xs, zs, s = a["x"], a["z"], a["s"]
    ax, az, bx, bz = xs[:-1], zs[:-1], xs[1:], zs[1:]
    for st in streams:
        if st["tunnel"] or st["kind"] not in KINDS_STREAM:
            continue
        pts = st["pts"]
        sx0, sx1 = min(p[0] for p in pts), max(p[0] for p in pts)
        sz0, sz1 = min(p[1] for p in pts), max(p[1] for p in pts)
        near = (np.maximum(ax, bx) >= sx0 - 5) & (np.minimum(ax, bx) <= sx1 + 5) & (np.maximum(az, bz) >= sz0 - 5) & (np.minimum(az, bz) <= sz1 + 5)
        idx = np.nonzero(near)[0]
        if idx.size == 0:
            continue
        for (cx, cz), (dx, dz) in zip(pts, pts[1:]):
            d = (bx[idx] - ax[idx]) * (dz - cz) - (bz[idx] - az[idx]) * (dx - cx)
            ok = np.abs(d) > 1e-9
            dd = np.where(ok, d, 1.0)
            t = ((cx - ax[idx]) * (dz - cz) - (cz - az[idx]) * (dx - cx)) / dd
            u = ((cx - ax[idx]) * (bz[idx] - az[idx]) - (cz - az[idx]) * (bx[idx] - ax[idx])) / dd
            hit = ok & (t >= 0) & (t <= 1) & (u >= 0) & (u <= 1)
            for k in np.nonzero(hit)[0]:
                i = idx[k]
                out.append((float(s[i] + t[k] * (s[i + 1] - s[i])), float(ax[i] + t[k] * (bx[i] - ax[i])), float(az[i] + t[k] * (bz[i] - az[i])), st["kind"]))
    out.sort()
    merged = []
    for c in out:                                              # two nearby crossings of one winding brook share one bridge
        if merged and c[0] - merged[-1][0] < 14:
            continue
        merged.append(c)
    return merged


def straighten(line, streams, pad=5.0):
    """A bridge deck is a straight plank: where the trail crosses a stream, the line is made straight for (deck length / 2 + pad) metres either side of the crossing
    (the real footbridges are straight too; only the approach bends). Returns a new node chain; the original nodes outside the straightened stretches are kept."""
    for _ in range(3):                                         # a straightened stretch can move a crossing: repeat until stable
        xs, zs, s = dense_line(line)
        a = {"x": xs, "z": zs, "s": s}
        found = crossings(a, streams)
        if not found:
            return line
        cum = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff([p[0] for p in line]), np.diff([p[1] for p in line])))])
        cuts = []
        for cs, cx, cz, kind in found:
            half = (9.0 if kind == 5 else 7.0) / 2 + pad
            cuts.append((max(0.0, cs - half), min(float(s[-1]), cs + half)))
        merged = []
        for lo, hi in cuts:
            if merged and lo <= merged[-1][1] + 1.0:
                merged[-1] = (merged[-1][0], max(hi, merged[-1][1]))
            else:
                merged.append((lo, hi))
        out = []
        pos = lambda m: (float(np.interp(m, s, xs)), float(np.interp(m, s, zs)))
        k = 0
        for lo, hi in merged:
            while k < len(line) and cum[k] < lo - 0.5:
                out.append(tuple(line[k]))
                k += 1
            out.append(pos(lo))
            out.append(pos(hi))
            while k < len(line) and cum[k] <= hi + 0.5:
                k += 1
        while k < len(line):
            out.append(tuple(line[k]))
            k += 1
        if len(out) == len(line) and all(abs(p[0] - q[0]) < 0.01 and abs(p[1] - q[1]) < 0.01 for p, q in zip(out, line)):
            return line
        line = out
    return line


def trim_ends(line, height_at, max_trim=90.0, grade=0.16, trim_end=True):
    """A trail ends where the path ends, often at the foot of a bank or in a little hook: a rider would stall on the last climb. Cut the ends at the last 2 m step steeper than `grade`
    (uphill in the riding direction at the end, uphill against it at the start) within `max_trim` metres."""
    xs, zs, s = dense_line(line)
    h = np.array([height_at(x, z) for x, z in zip(xs, zs)])
    step = np.diff(h) / np.maximum(np.diff(s), 1e-6)
    lo, hi = 0, len(s) - 1
    for i in range(len(step)):
        if s[i] > max_trim:
            break
        if step[i] < -grade:                   # the first metres go UP steeply when ridden backwards: the start is at the foot of a bank
            lo = i + 1
    for i in range(len(step) - 1, -1, -1):
        if not trim_end or s[-1] - s[i] > max_trim:
            break
        if step[i] > grade:
            hi = i
    # a bank right at the end: also drop the climb itself (everything after the last flat-ish step)
    if lo == 0 and hi == len(s) - 1:
        return line
    cum = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff([p[0] for p in line]), np.diff([p[1] for p in line])))])
    out = [(float(xs[lo]), float(zs[lo]))]
    out += [tuple(p) for p, c in zip(line, cum) if s[lo] + 1.0 < c < s[hi] - 1.0]
    out.append((float(xs[hi]), float(zs[hi])))
    return out


def at(a, s):
    i = int(np.clip(round(s / DENSE), 0, len(a["s"]) - 1))
    return float(a["x"][i]), float(a["z"][i]), i


class Placer:
    """Keeps the list of placed features and answers 'is this stretch free?'."""

    def __init__(self, total):
        self.total = total
        self.spans = [(-1e9, EDGE_FREE), (total - EDGE_FREE, 1e9)]
        self.features = []

    def free(self, s0, s1):
        return all(s1 + MIN_GAP <= a or s0 - MIN_GAP >= b for a, b in self.spans)

    def add(self, a, kind, s0, length, **params):
        x, z, _ = at(a, s0)
        self.spans.append((s0, s0 + length))
        feat = {"k": kind, "x": round(x, 1), "z": round(z, 1), "len": round(length, 1)}
        feat.update({k: (round(v, 2) if isinstance(v, float) else v) for k, v in params.items()})
        self.features.append((s0, feat))


def candidates(a, length, predicate, step=4.0):
    out = []
    s = EDGE_FREE
    while s + length < a["length"] - EDGE_FREE:
        i0, i1 = int(s / DENSE), int((s + length) / DENSE)
        if predicate(i0, i1) and not a["blocked"][i0:i1 + 1].any():
            out.append(s)
        s += step
    return out


def place_kind(rng, placer, a, count, length, predicate, make):
    """Pick `count` random free candidate stretches; `make(s0)` adds the feature. Returns how many were placed."""
    placed = 0
    pool = candidates(a, length, predicate)
    rng.shuffle(pool)
    for s0 in pool:
        if placed >= count:
            break
        if placer.free(s0, s0 + length):
            make(s0)
            placed += 1
    return placed


def block_near(a, others, radius=9.0):
    """Marks the dense points of `a` that lie within `radius` of another trail (those parts are carved by the other trail; the later one yields)."""
    blocked = np.zeros(len(a["s"]), dtype=bool)
    for ox, oz in others:
        for i0 in range(0, len(a["s"]), 400):
            sl = slice(i0, i0 + 400)
            d2 = (a["x"][sl, None] - ox[None, :]) ** 2 + (a["z"][sl, None] - oz[None, :]) ** 2
            blocked[sl] |= d2.min(axis=1) < radius * radius
    return blocked


def build(td, a, streams):
    """Features for one trail definition `td` (dict with grade, style, id) analysed as `a`. Returns (features, checkpoints, posts)."""
    style = td.get("style", {})
    grade = td["grade"]
    G = GRADE_FEATURES[grade]
    rng = random.Random(int(style.get("seed", 1)) * 7919 + len(td["id"]))
    placer = Placer(a["length"])
    # the stone footbridge of the Schiessentuempel (trails.def.json `stoneBridge`): a bridge feature that mutes the carving under the deck; its own physics deck is decks.js landmarkDeck
    sb = td.get("stoneBridge")
    stone_s = 0.0
    if sb:
        sx, sz = sb["x"] - sb["ax"] * sb["half"], sb["z"] - sb["az"] * sb["half"]
        j = int(np.argmin((a["x"] - sx) ** 2 + (a["z"] - sz) ** 2))
        placer.add(a, "bridge", float(a["s"][j]), 2 * sb["half"], w=sb["w"], stone=True)
        stone_s = float(a["s"][j])
    # bridges first: they are fixed by the geography
    for s, x, z, kind in crossings(a, streams):
        if sb and math.hypot(x - sb["x"], z - sb["z"]) < 16.0:
            continue                                                    # the stone bridge crosses here
        length = 9.0 if kind == 5 else 7.0
        s0 = s - length / 2
        if s0 < EDGE_FREE * 0.5 or s0 + length > a["length"] - EDGE_FREE * 0.5 or a["blocked"][int(s0 / DENSE):int((s0 + length) / DENSE) + 1].any():
            continue
        hA, hB = float(np.interp(s0, a["s"], a["h"])), float(np.interp(s0 + length, a["s"], a["h"]))
        if abs(hB - hA) / length > MAX_DECK_GRADE:                      # a bridge over a creek at the foot of a stair would be a ramp: the trail fords it instead
            continue
        placer.add(a, "bridge", s0, length, w=1.9)
    slope, kappa, cls = a["slope"], a["kappa"], a["cls"]
    straight = lambda i0, i1: np.max(np.abs(kappa[i0:i1 + 1])) < 0.02
    gentle_down = lambda i0, i1: straight(i0, i1) and -0.11 <= np.mean(slope[i0:i1 + 1]) <= 0.01 and np.max(slope[i0:i1 + 1]) < 0.05
    down = lambda i0, i1: straight(i0, i1) and -0.16 <= np.mean(slope[i0:i1 + 1]) <= -0.025 and np.max(slope[i0:i1 + 1]) < 0.02
    steep = lambda i0, i1: straight(i0, i1) and -0.4 <= np.mean(slope[i0:i1 + 1]) <= -0.07
    flat = lambda i0, i1: np.max(np.abs(slope[i0:i1 + 1])) < 0.045
    forest = lambda i0, i1: np.mean(cls[i0:i1 + 1] == 1) > 0.5
    anywhere = lambda i0, i1: True
    n = lambda key: int(style.get(key, 0))

    if G["drop"] > 0:
        place_kind(rng, placer, a, n("drops"), 16, steep, lambda s0: placer.add(a, "drop", s0, 16, h=G["drop"] * rng.uniform(0.85, 1.1)))
    if G["kicker"] > 0:
        klen = 8 + G["gap"] + 10
        place_kind(rng, placer, a, n("kickers"), klen, down, lambda s0: placer.add(a, "kicker", s0, klen, h=G["kicker"] * rng.uniform(0.85, 1.1), gap=G["gap"] * rng.uniform(0.9, 1.1)))
    place_kind(rng, placer, a, n("slabs"), 34, anywhere, lambda s0: placer.add(a, "slab", s0, rng.uniform(26, 42), h=0.1))
    rolls = n("rollers")
    per = 5
    for _ in range(0, rolls, per):
        k = min(per, rolls)
        period = 7.5
        place_kind(rng, placer, a, 1, k * period + 6, gentle_down, lambda s0, k=k, period=period: placer.add(a, "roller", s0, k * period + 6, n=k, p=period, h=G["roller"] * rng.uniform(0.85, 1.1)))
        rolls -= k
    # berms at the tightest bends
    bend = [(abs(kappa[i]), i) for i in range(2, len(kappa) - 2) if abs(kappa[i]) > 0.035]
    bend.sort(reverse=True)
    placed = 0
    for _, i in bend:
        if placed >= n("berms"):
            break
        s0 = max(EDGE_FREE, a["s"][i] - 8)
        if s0 + 16 > a["length"] - EDGE_FREE or not placer.free(s0, s0 + 16):
            continue
        placer.add(a, "berm", s0, 16)
        placed += 1
    place_kind(rng, placer, a, n("roots"), 22, forest, lambda s0: placer.add(a, "roots", s0, rng.uniform(16, 30), h=0.1))
    place_kind(rng, placer, a, n("mud"), 16, lambda i0, i1: flat(i0, i1) and forest(i0, i1), lambda s0: placer.add(a, "mud", s0, rng.uniform(12, 20)))
    place_kind(rng, placer, a, n("boardwalks"), 20, flat, lambda s0: placer.add(a, "boardwalk", s0, rng.uniform(12, 20)))
    place_kind(rng, placer, a, n("leaves"), 34, forest, lambda s0: placer.add(a, "leaves", s0, rng.uniform(28, 55)))
    features = [f for _, f in sorted(placer.features, key=lambda p: p[0])]

    # checkpoints: evenly spaced, nudged out of features
    total = a["length"]
    count = max(1, round(total / CHECKPOINT_SPACING) - 1)
    cps = []
    taken = [(s0, s0 + f["len"]) for s0, f in placer.features]
    for k in range(1, count + 1):
        s = total * k / (count + 1)
        for shift in (0, 10, -10, 20, -20, 30, -30, 40, -40):
            if all(not (a0 - 6 <= s + shift <= b0 + 6) for a0, b0 in taken):
                s += shift
                break
        x, z, _ = at(a, s)
        cps.append([round(x, 1), round(z, 1)])

    # signposts: the start board, one per checkpoint, direction posts in between, the finish board
    posts = []

    def post(kind, s, n_=0):
        x, z, i = at(a, s)
        if sb and kind != "finish" and math.hypot(x - sb["x"], z - sb["z"]) < sb["half"] + 2.0:
            return                                                      # nothing is nailed to the bridge
        yaw = float(a["heading"][i])
        rx, rz = -math.sin(yaw), math.cos(yaw)
        posts.append({"k": kind, "x": round(x + rx * POST_OFFSET, 1), "z": round(z + rz * POST_OFFSET, 1), "yaw": round(yaw, 3), "n": n_})
    post("start", 6.0)
    last = 0.0
    for k, (cx, cz) in enumerate(cps):
        j = int(np.argmin((a["x"] - cx) ** 2 + (a["z"] - cz) ** 2))
        s = float(a["s"][j])
        s_mid = (last + s) / 2
        if s - last > SIGN_SPACING * 1.4:
            post("dir", s_mid, 0)
        post("cp", s, k + 1)
        last = s
    if total - last > SIGN_SPACING * 1.4:
        post("dir", (last + total) / 2, 0)
    post("finish", (stone_s - 6.0) if sb else total - 6.0)       # (on the footbridge trail the finish board stands at the foot of the bridge)
    return features, cps, posts
