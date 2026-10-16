#!/usr/bin/env python3
"""Smooth the road surfaces of the Luxtram world (pb/train-sim/data/luxtram/h/*.bin).

  /Users/Ian/Library/Caches/luxtram-work/.venv/bin/python scripts/smooth_luxtram_roads.py [--dry] [--report out.json]

The LiDAR ground model is bumpy under a road (single-node spikes, gutters, parked cars, sampling noise): a carriageway draped on it ripples by 5-30 cm
and a car on it seems to sink or hop.  A real road is a smooth ribbon: a longitudinal profile (vertical curves, no waves shorter than ~60-120 m) with a
flat cross section.  This script rebuilds that ribbon and writes it back into the height tiles, so every consumer of the DEM (terrain mesh, draped asphalt,
kerbs, markings, cars, lamps, trees) sees the same smooth road, and the ground next to it is blended in (no walls, gaps or holes).

  1. every OSM carriageway (class 0-5, ground level: no bridge / tunnel / elevated layer) is resampled every 2 m; the LiDAR level is the median of five
     samples across the carriageway (gutters and kerbs do not bias it);
  2. profile = weighted Whittaker smoother (second-difference penalty, wavelength cutoff WAVE_M[class]), pulled back where it strays more than MAX_DEV from the
     LiDAR level, then capped to MAX_GRADE and MIN_VRAD (vertical curve radius);
  3. junctions: roads that share a point (OSM nodes, 0.4 m) get ONE height there (the more important road wins); the end of a ground road that runs into a
     bridge / tunnel keeps the LiDAR level there (the deck end bends to meet it, see luxtram-ground.js decorateDecks);
  4. the profile height is laid across the road (flat cross section) over the carriageway + sidewalk, then blended into the LiDAR ground over BLEND_MIN..BLEND_MAX m
     (wider where the road differs more from the terrain); ground that is far above / below the road (cutting, bank, retaining wall) is not touched;
  5. the tiles are re-encoded with 5 mm resolution (HQ 200, was 50): the 2 cm steps of the old encoding would make a smooth 1 % grade look terraced.

The script reads and writes the shipped tiles in place.  It is idempotent (smoothing a smooth road changes nothing).  Needs the venv (numpy scipy shapely pyproj).
After a run bump "v" in data/luxtram/index.json and HQ in luxtram-world.js decodeHeights (HQ = 200) if the encoding changed.
"""
import json
import math
import os
import sys
import time

import numpy as np
from scipy.sparse import diags
from scipy.sparse.linalg import spsolve
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import luxtram_ground_model as M  # noqa: E402

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pb", "train-sim", "data", "luxtram")
TILE = 128.0
H0 = 150.0
HQ_OLD = 50.0
HQ_NEW = 200.0

DS = 2.0                                   # profile station spacing (m)
WAVE_M = {0: 160.0, 1: 110.0, 2: 100.0, 3: 90.0, 4: 80.0, 5: 45.0}     # wavelength cutoff of the profile (50 % gain) per OSM class
DEV_VALID = 1.2                            # a profile station further than this from the LiDAR level is not applied
MAX_DEV = 0.7                              # the profile stays within this of the LiDAR level (m)
MAX_GRADE = {0: 0.07, 1: 0.10, 2: 0.10, 3: 0.12, 4: 0.14, 5: 0.16}       # steepest grade of a street (m / m)
MIN_VRAD = 250.0                           # smallest vertical curve radius (m)
CAP_W = 3.0                                # extra plateau beyond the carriageway edge = sidewalk (m), + SIDEWALK_W of the class
BLEND_MIN, BLEND_MAX = 4.0, 14.0           # width of the blend into the LiDAR ground (m)
DEV_FULL, DEV_ZERO = 0.35, 0.9             # ground that differs more than this from the road level is left alone (bank, cutting, wall): full effect below
                                           # DEV_FULL, none above DEV_ZERO
JOIN_MAX_SPREAD = 1.0                      # roads at one node whose smoothed levels differ more than this are not at one level (m)
JOIN = 0.4                                 # points closer than this are one OSM node (m)
CLASS_W = {0: 1000.0, 1: 300.0, 2: 100.0, 3: 30.0, 4: 10.0, 5: 3.0}       # who wins at a junction


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------------------------------------------------- height tiles
def decode_heights(buf, hq):
    n = buf[0]
    pos = 1
    vals = []
    ln = len(buf)
    while pos < ln:
        x = 0
        sh = 0
        while True:
            by = buf[pos]
            pos += 1
            x |= (by & 0x7F) << sh
            sh += 7
            if by < 0x80:
                break
        vals.append((x >> 1) ^ -(x & 1))
    v = np.array(vals, dtype=np.int64).reshape(n, n)
    q = np.cumsum(np.cumsum(v, axis=0), axis=1)          # pred = left + up - upleft  <=>  q is the 2D prefix sum of the residuals
    return q / hq + H0


def encode_heights(nodes, hq):
    q = np.round((nodes - H0) * hq).astype(np.int64)
    n = q.shape[0]
    # mixed second difference: v[r, c] = q[r, c] - q[r, c-1] - q[r-1, c] + q[r-1, c-1]
    v = q.copy()
    v[:, 1:] -= q[:, :-1]
    t = v.copy()
    v[1:, :] -= t[:-1, :]
    out = bytearray([n])
    for z in v.ravel().tolist():
        z = (z << 1) ^ (z >> 63)
        while z >= 0x80:
            out.append((z & 0x7F) | 0x80)
            z >>= 7
        out.append(z)
    return bytes(out)


class Dem:
    def __init__(self, tiles, steps):
        self.t = tiles        # key -> (n, n) array
        self.step = steps     # key -> node spacing

    def at(self, x, z):
        """bilinear height at arrays x, z (local metres); NaN outside the tiles."""
        x = np.asarray(x, dtype=float)
        z = np.asarray(z, dtype=float)
        out = np.full(x.shape, np.nan)
        ti = np.floor(x / TILE).astype(int)
        tj = np.floor(z / TILE).astype(int)
        for key in set(zip(ti.ravel().tolist(), tj.ravel().tolist())):
            k = "%d_%d" % key
            if k not in self.t:
                continue
            m = (ti == key[0]) & (tj == key[1])
            h = self.t[k]
            n = h.shape[0]
            st = self.step[k]
            u = (x[m] - key[0] * TILE) / st
            v = (z[m] - key[1] * TILE) / st
            iu = np.clip(np.floor(u).astype(int), 0, n - 2)
            iv = np.clip(np.floor(v).astype(int), 0, n - 2)
            fu = np.clip(u - iu, 0, 1)
            fv = np.clip(v - iv, 0, 1)
            a = h[iv, iu]
            b = h[iv, iu + 1]
            c = h[iv + 1, iu]
            d = h[iv + 1, iu + 1]
            out[m] = (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv
        return out


# ------------------------------------------------------------------------------------------------------------- roads
class Rd:
    pass


def load_roads():
    els = M.load_all_elements("road")
    roads = []
    for el in els:
        t = el.get("tags", {})
        if t.get("highway") not in M.HW_CLASS or not el.get("geometry"):
            continue
        r = M.Road(el)
        if r.cls > 5 or len(r.pts) < 2:
            continue
        roads.append(r)
    return roads


def resample(pts, ds):
    p = np.array(pts, dtype=float)
    seg = np.hypot(np.diff(p[:, 0]), np.diff(p[:, 1]))
    arc = np.concatenate([[0.0], np.cumsum(seg)])
    L = arc[-1]
    n = max(2, int(round(L / ds)) + 1)
    s = np.linspace(0.0, L, n)
    return np.stack([np.interp(s, arc, p[:, 0]), np.interp(s, arc, p[:, 1])], axis=1), s, arc, L


def whittaker(y, w, lam):
    """z minimises sum w (z - y)^2 + lam * sum (second difference of z)^2."""
    n = len(y)
    if n < 3:
        return y.copy()
    D = diags([np.ones(n - 2), -2 * np.ones(n - 2), np.ones(n - 2)], [0, 1, 2], shape=(n - 2, n))
    A = (diags(w) + lam * (D.T @ D)).tocsc()
    return spsolve(A, w * y)


def smooth_profile(y0, w0, cls, pins):
    """y0: LiDAR level per station (NaN allowed), w0: base weights; pins: {index: (height, weight)}."""
    n = len(y0)
    ok = np.isfinite(y0)
    if ok.sum() < 3:
        return None
    y = np.interp(np.arange(n), np.where(ok)[0], y0[ok])
    w = np.where(ok, w0, 1e-4)
    for i, (h, ww) in pins.items():
        y[i] = h
        w[i] = ww
    lam = (WAVE_M[cls] / DS / (2 * math.pi)) ** 4
    z = whittaker(y, w, lam)
    for _ in range(14):                        # pull back where the fit strays from the LiDAR level
        bad = np.abs(z - y) > MAX_DEV
        for i in pins:
            bad[i] = False
        if not bad.any():
            break
        w = np.where(bad, w * 6.0, w)
        z = whittaker(y, w, lam)
    return z


def limit_shape(z, cls, zref):
    """cap the grade and the vertical curvature (iterative relaxation; rarely needed after the smoother).  Where the real road (zref = the LiDAR level
    lightly smoothed, 25 m) is steeper / sharper than the street limits (a motorway ramp, a ramp up to a bridge) it keeps 120 % of its own value."""
    z = z.copy()
    dref = np.abs(np.diff(zref))
    gmax = np.maximum(MAX_GRADE[cls] * DS, 1.2 * dref)
    cref = np.abs(zref[:-2] - 2 * zref[1:-1] + zref[2:])
    dmax = np.maximum(DS * DS / MIN_VRAD, 1.2 * cref)
    for _ in range(30):
        changed = False
        d = np.diff(z)
        big = np.abs(d) > gmax + 1e-9
        if big.any():
            changed = True
            for i in np.where(big)[0]:
                m = 0.5 * (z[i] + z[i + 1])
                z[i] = m - math.copysign(gmax[i], d[i]) / 2
                z[i + 1] = m + math.copysign(gmax[i], d[i]) / 2
        c = z[:-2] - 2 * z[1:-1] + z[2:]
        bad = np.abs(c) > dmax + 1e-9
        if bad.any():
            changed = True
            idx = np.where(bad)[0] + 1
            z[idx] -= (c[idx - 1] - np.clip(c[idx - 1], -dmax[idx - 1], dmax[idx - 1])) / 2
        if not changed:
            break
    return z


def reversals(z, step, dead=0.0):
    g = np.diff(z) / step
    g = g[np.abs(g) > dead]
    if len(g) < 2:
        return 0
    s = np.sign(g)
    return int(np.sum(s[1:] != s[:-1]))


# ------------------------------------------------------------------------------------------------------------- main
def main():
    dry = "--dry" in sys.argv
    report = None
    if "--report" in sys.argv:
        report = sys.argv[sys.argv.index("--report") + 1]
    t0 = time.time()
    idx = json.load(open(os.path.join(DATA, "index.json")))
    hq_in = HQ_OLD if idx.get("v", 1) < 5 else HQ_NEW
    tiles, steps = {}, {}
    for key, meta in idx["tiles"].items():
        buf = open(os.path.join(DATA, "h", key + ".bin"), "rb").read()
        tiles[key] = decode_heights(buf, hq_in)
        steps[key] = float(meta["step"])
    print("tiles", len(tiles), "decoded in %.0fs (HQ %g)" % (time.time() - t0, hq_in))
    orig = {k: v.copy() for k, v in tiles.items()}
    dem = Dem(tiles, steps)

    roads = load_roads()
    print("roads", len(roads))
    ground, deck = [], []
    for r in roads:
        (deck if (r.bridge or r.tunnel or r.layer > 0) else ground).append(r)
    print("ground roads", len(ground), "bridge / tunnel / elevated", len(deck))

    # ---- stations, LiDAR level
    R = []
    for r in ground:
        xy, s, arc, L = resample(r.pts, DS)
        if L < 6.0:
            continue
        d = Rd()
        d.r = r
        d.cls = r.cls
        d.hw = r.hw
        d.xy = xy
        d.s = s
        d.L = L
        d.arc = arc
        tx = np.gradient(xy[:, 0])
        tz = np.gradient(xy[:, 1])
        tl = np.hypot(tx, tz) + 1e-9
        nx, nz = -tz / tl, tx / tl
        offs = [-0.6, -0.3, 0.0, 0.3, 0.6]
        hs = np.stack([dem.at(xy[:, 0] + nx * o * r.hw, xy[:, 1] + nz * o * r.hw) for o in offs])
        d.y0 = np.nanmedian(np.where(np.isfinite(hs), hs, np.nan), axis=0) if np.isfinite(hs).any() else np.full(len(xy), np.nan)
        R.append(d)
    print("profiles", len(R), "%.0fs" % (time.time() - t0))

    # ---- node clusters (junctions)
    cell = {}
    for ri, d in enumerate(R):
        vx = np.array(d.r.pts, dtype=float)
        for vi in range(len(vx)):
            key = (int(round(vx[vi, 0] / JOIN)), int(round(vx[vi, 1] / JOIN)))
            cell.setdefault(key, []).append((ri, vi, False))
    deck_ends = {}
    for r in deck:
        for p in (r.pts[0], r.pts[-1]):
            deck_ends[(int(round(p[0] / JOIN)), int(round(p[1] / JOIN)))] = True
    nodes = []
    seen = set()
    for key, members in cell.items():
        # merge with the 8 neighbour cells (a node can sit on a cell border)
        mem = list(members)
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                if (dx or dz) and (key[0] + dx, key[1] + dz) in cell:
                    mem += cell[(key[0] + dx, key[1] + dz)]
        mem = list(set(mem))
        if len(set(m[0] for m in mem)) < 2 and not any((key[0] + dx, key[1] + dz) in deck_ends for dx in (-1, 0, 1) for dz in (-1, 0, 1)):
            continue
        sig = tuple(sorted(mem))
        if sig in seen:
            continue
        seen.add(sig)
        nodes.append({"mem": mem, "deck": any((key[0] + dx, key[1] + dz) in deck_ends for dx in (-1, 0, 1) for dz in (-1, 0, 1))})
    print("junction nodes", len(nodes))
    # station index of every vertex of every road
    for d in R:
        d.vst = np.clip(np.round(d.arc / (d.L / (len(d.s) - 1))).astype(int), 0, len(d.s) - 1)

    # ---- profiles with junction pins (3 rounds)
    pins = [dict() for _ in R]
    z = [None] * len(R)
    for rnd in range(4):
        for ri, d in enumerate(R):
            zz = smooth_profile(d.y0, np.ones(len(d.s)), d.cls, pins[ri])
            z[ri] = zz if zz is not None else d.y0
        newpins = [dict() for _ in R]
        for nd in nodes:
            mem = nd["mem"]
            hs, ws = [], []
            for ri, vi, _ in mem:
                d = R[ri]
                st = int(d.vst[vi])
                if z[ri] is None or not np.isfinite(z[ri][st]):
                    continue
                hs.append(z[ri][st])
                ws.append(CLASS_W[d.cls])
            if not hs:
                continue
            if max(hs) - min(hs) > JOIN_MAX_SPREAD:
                continue                              # not one level (an overpass that shares a node in the data): no junction
            h = float(np.average(hs, weights=ws))
            if nd["deck"] and len(set(m[0] for m in mem)) < 2:
                continue                              # the end of a ground road at a bridge / tunnel: free (the deck bends to meet it)
            for ri, vi, _ in mem:
                d = R[ri]
                st = int(d.vst[vi])
                for k in (st,):
                    newpins[ri][k] = (h, 400.0)
        pins = newpins
    for ri, d in enumerate(R):
        if z[ri] is None or not np.all(np.isfinite(z[ri])):
            z[ri] = np.where(np.isfinite(d.y0), d.y0, np.nanmean(d.y0) if np.isfinite(d.y0).any() else 0.0)
        zr = whittaker(np.interp(np.arange(len(d.y0)), np.where(np.isfinite(d.y0))[0], d.y0[np.isfinite(d.y0)]) if np.isfinite(d.y0).any() else d.z0 if False else z[ri], np.ones(len(d.y0)), (25.0 / DS / (2 * math.pi)) ** 4) if np.isfinite(d.y0).any() else z[ri]
        z[ri] = limit_shape(z[ri], d.cls, zr)
        d.z = z[ri]
    print("smoothed %.0fs" % (time.time() - t0))

    # ---- statistics of the profiles (before / after) on the major roads
    stats = {"byClass": {}}
    for d in R:
        if not np.isfinite(d.y0).all():
            ok = np.isfinite(d.y0)
            if ok.sum() < 3:
                continue
        y0 = np.interp(np.arange(len(d.y0)), np.where(np.isfinite(d.y0))[0], d.y0[np.isfinite(d.y0)])
        km = d.L / 1000.0
        if km < 0.15:
            continue
        s = stats["byClass"].setdefault(str(d.cls), {"km": 0.0, "revBefore": 0, "revAfter": 0, "revBefore03": 0, "revAfter03": 0, "maxDev": 0.0})
        s["km"] += km
        s["revBefore"] += reversals(y0, DS)
        s["revAfter"] += reversals(d.z, DS)
        s["revBefore03"] += reversals(y0, DS, 0.003)
        s["revAfter03"] += reversals(d.z, DS, 0.003)
        s["maxDev"] = max(s["maxDev"], float(np.max(np.abs(d.z - y0))))
    worst = sorted(((float(np.max(np.abs(d.z - np.where(np.isfinite(d.y0), d.y0, d.z)))), d.cls, round(float(d.xy[len(d.xy) // 2][0])), round(float(d.xy[len(d.xy) // 2][1])), round(d.L)) for d in R), reverse=True)[:8]
    print("worst deviation (m, class, x, z, length):", worst)
    for k, s in stats["byClass"].items():
        s["perKmBefore"] = round(s["revBefore"] / s["km"], 1)
        s["perKmAfter"] = round(s["revAfter"] / s["km"], 1)
        s["perKmBefore03"] = round(s["revBefore03"] / s["km"], 1)
        s["perKmAfter03"] = round(s["revAfter03"] / s["km"], 1)
        s["km"] = round(s["km"], 1)
        s["maxDev"] = round(s["maxDev"], 2)
    print(json.dumps(stats))
    if report:
        json.dump(stats, open(report, "w"), indent=1)

    # ---- lay the road into the tiles
    wsum = {k: np.zeros_like(v) for k, v in tiles.items()}
    wtsum = {k: np.zeros_like(v) for k, v in tiles.items()}
    side_w = M.SIDEWALK_W
    PIECE = 120                                   # stations per piece
    for ri, d in enumerate(R):
        plateau = d.hw + side_w.get(d.cls, 1.5) + 0.6
        rad = plateau + BLEND_MAX
        # a finer polyline (1 m) for the nearest-point query
        n1 = int(round(d.L / 1.0)) + 1
        s1 = np.linspace(0, d.L, n1)
        ss = d.s
        x1 = np.interp(s1, ss, d.xy[:, 0])
        z1 = np.interp(s1, ss, d.xy[:, 1])
        h1 = np.interp(s1, ss, d.z)
        yf = np.where(np.isfinite(d.y0), d.y0, d.z)
        ok1 = (np.interp(s1, ss, np.abs(d.z - yf)) <= DEV_VALID).astype(float)       # stations where the profile left the LiDAR level (bad data, cliff): not laid into the tiles
        for a in range(0, n1, PIECE):
            b = min(n1, a + PIECE + 2)
            ax, az, ah, aok = x1[max(0, a - 1):b], z1[max(0, a - 1):b], h1[max(0, a - 1):b], ok1[max(0, a - 1):b]
            if len(ax) < 2:
                continue
            tree = cKDTree(np.stack([ax, az], axis=1))
            x0, x1b = ax.min() - rad, ax.max() + rad
            zb0, zb1 = az.min() - rad, az.max() + rad
            for ti in range(int(math.floor(x0 / TILE)), int(math.floor(x1b / TILE)) + 1):
                for tj in range(int(math.floor(zb0 / TILE)), int(math.floor(zb1 / TILE)) + 1):
                    key = "%d_%d" % (ti, tj)
                    if key not in tiles:
                        continue
                    st = steps[key]
                    n = tiles[key].shape[0]
                    c0 = max(0, int(math.floor((x0 - ti * TILE) / st)))
                    c1 = min(n - 1, int(math.ceil((x1b - ti * TILE) / st)))
                    r0 = max(0, int(math.floor((zb0 - tj * TILE) / st)))
                    r1 = min(n - 1, int(math.ceil((zb1 - tj * TILE) / st)))
                    if c1 < c0 or r1 < r0:
                        continue
                    cc, rr = np.meshgrid(np.arange(c0, c1 + 1), np.arange(r0, r1 + 1))
                    px = ti * TILE + cc * st
                    pz = tj * TILE + rr * st
                    dist, k = tree.query(np.stack([px.ravel(), pz.ravel()], axis=1), distance_upper_bound=rad)
                    m = np.isfinite(dist)
                    if not m.any():
                        continue
                    k = k[m]
                    qx, qz = px.ravel()[m], pz.ravel()[m]
                    # project on the two segments around the nearest sample (height by the projection parameter, exact lateral distance)
                    best_d = np.full(len(k), 1e9)
                    best_h = np.zeros(len(k))
                    for dk in (-1, 0):
                        i0 = np.clip(k + dk, 0, len(ax) - 2)
                        i1 = i0 + 1
                        vx, vz = ax[i1] - ax[i0], az[i1] - az[i0]
                        ll = vx * vx + vz * vz + 1e-12
                        t = np.clip(((qx - ax[i0]) * vx + (qz - az[i0]) * vz) / ll, 0, 1)
                        dd = np.hypot(qx - (ax[i0] + vx * t), qz - (az[i0] + vz * t))
                        hh = ah[i0] + (ah[i1] - ah[i0]) * t
                        better = dd < best_d
                        best_d = np.where(better, dd, best_d)
                        best_h = np.where(better, hh, best_h)
                    hcur = tiles[key][rr.ravel()[m], cc.ravel()[m]]
                    dev = best_h - hcur
                    bw = np.clip(2.2 * np.abs(dev), BLEND_MIN, BLEND_MAX)
                    wl = 1.0 - smooth(0.0, 1.0, (best_d - plateau) / bw)
                    wl = np.where(best_d <= plateau, 1.0, wl)
                    wdev = 1.0 - smooth(DEV_FULL, DEV_ZERO, np.abs(dev))
                    w = wl * wdev * np.minimum(aok[k], 1.0)
                    # the same node can be reached from several pieces of the road: keep the strongest
                    rr_, cc_ = rr.ravel()[m], cc.ravel()[m]
                    cur_w = wsum[key][rr_, cc_]
                    upd = w > 1e-4
                    # accumulate weight and weighted target; a node near two roads averages their targets
                    np.add.at(wsum[key], (rr_[upd], cc_[upd]), w[upd])
                    np.add.at(wtsum[key], (rr_[upd], cc_[upd]), (w * best_h)[upd])
        if ri % 400 == 0:
            print("  road", ri, "/", len(R), "%.0fs" % (time.time() - t0))
    changed = 0
    maxmove = 0.0
    for key in tiles:
        ws = wsum[key]
        m = ws > 1e-4
        if not m.any():
            continue
        tgt = np.where(m, wtsum[key] / np.where(m, ws, 1.0), tiles[key])
        wt = np.minimum(1.0, ws)
        new = tiles[key] + wt * (tgt - tiles[key])
        maxmove = max(maxmove, float(np.max(np.abs(new - tiles[key]))))
        changed += int(m.sum())
        tiles[key] = new
    print("nodes moved", changed, "max move %.2f m" % maxmove, "%.0fs" % (time.time() - t0))
    if dry:
        return

    # ---- write
    for key, h in tiles.items():
        buf = encode_heights(h, HQ_NEW)
        open(os.path.join(DATA, "h", key + ".bin"), "wb").write(buf)
    idx["v"] = max(5, idx.get("v", 1) + 1) if hq_in == HQ_OLD else idx.get("v", 5)
    json.dump(idx, open(os.path.join(DATA, "index.json"), "w"), separators=(",", ":"))
    print("written %d tiles, index v %s, %.0fs" % (len(tiles), idx["v"], time.time() - t0))


if __name__ == "__main__":
    main()
