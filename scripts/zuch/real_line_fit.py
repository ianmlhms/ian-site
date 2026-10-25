#!/usr/bin/env python3
"""Curve fitting for the real-line pipeline: a real centre line (UTM metres) -> straights and constant-radius arcs.

fit_pieces(xy_5m, ...) -> [{s0, s1, kind: 's'|'c', R, dir: 'L'|'R', dtheta}] in real metres along the line.
Method: heading theta(s) is fitted by a piecewise LINEAR function (dynamic programming with a penalty per piece); a flat piece is a
straight, a sloped piece an arc of radius 1/|slope|.  Pieces that turn less than MIN_TURN are straightened, neighbouring arcs of the
same direction with similar radius are merged.
"""
import math

import numpy as np

STEP = 10.0           # m between heading samples
PIECE_PENALTY = 0.03  # rad^2 * samples a new piece must save
MIN_PIECE = 4         # samples (40 m)
MIN_TURN = math.radians(3.0)
STRAIGHT_KAPPA = 1.0 / 3200.0
MAX_R = 6000.0


def smooth_xy(xy, step, sigma):
    """Gaussian smoothing of a uniformly resampled polyline (ends kept by edge padding)."""
    n = max(1, int(round(sigma / step * 3)))
    k = np.exp(-0.5 * (np.arange(-n, n + 1) * step / sigma) ** 2)
    k /= k.sum()
    out = np.empty_like(xy)
    for c in range(2):
        pad = np.r_[np.full(n, xy[0, c]) + (xy[0, c] - xy[min(n, len(xy) - 1), c]) * 0, xy[:, c], np.full(n, xy[-1, c])]
        out[:, c] = np.convolve(pad, k, mode="valid")
    return out


def headings(xy, step):
    d = np.gradient(xy, step, axis=0)
    th = np.unwrap(np.arctan2(d[:, 0], d[:, 1]))   # heading from north (clockwise positive): + = turning right
    return th


def fit_pieces(xy, step=STEP, sigma=22.0, penalty=PIECE_PENALTY):
    """xy: (N,2) points every `step` m.  Returns the list of pieces."""
    n = len(xy)
    if n < 6:
        return [{"s0": 0.0, "s1": (n - 1) * step, "kind": "s", "R": 0.0, "dir": "L", "dtheta": 0.0}]
    th = headings(smooth_xy(xy, step, sigma), step)
    t = np.arange(n, dtype=float)
    c1 = np.r_[0, np.cumsum(th)]
    c2 = np.r_[0, np.cumsum(th * th)]
    ct = np.r_[0, np.cumsum(t)]
    ctt = np.r_[0, np.cumsum(t * t)]
    ctth = np.r_[0, np.cumsum(t * th)]

    def cost(i, j):   # inclusive samples i..j: SSE of the best line theta = a + b t
        m = j - i + 1
        st, stt = ct[j + 1] - ct[i], ctt[j + 1] - ctt[i]
        sy, syy, sty = c1[j + 1] - c1[i], c2[j + 1] - c2[i], ctth[j + 1] - ctth[i]
        den = m * stt - st * st
        if abs(den) < 1e-9:
            return max(0.0, syy - sy * sy / m)
        b = (m * sty - st * sy) / den
        a = (sy - b * st) / m
        return max(0.0, syy - a * sy - b * sty)

    best = np.full(n + 1, 1e18)
    best[0] = 0.0
    prev = np.zeros(n + 1, dtype=int)
    for j in range(1, n + 1):
        lo = max(0, j - 400)
        for i in range(lo, j - MIN_PIECE + 1):
            if best[i] >= 1e17:
                continue
            c = best[i] + cost(i, j - 1) + penalty
            if c < best[j]:
                best[j], prev[j] = c, i
        if j < MIN_PIECE and best[j] >= 1e17:
            best[j] = 1e17
    cuts, j = [], n
    while j > 0:
        cuts.append((int(prev[j]), j - 1))
        j = int(prev[j])
    cuts.reverse()
    pieces = []
    for i, j in cuts:
        m = j - i + 1
        tt = t[i:j + 1]
        slope = float(np.polyfit(tt, th[i:j + 1], 1)[0]) / step if m > 2 else 0.0   # rad per metre = curvature (+ right)
        s0, s1 = i * step, (j + 1) * step if j < n - 1 else (n - 1) * step
        pieces.append({"s0": s0, "s1": s1, "kappa": slope})
    # make the pieces contiguous
    for a, b in zip(pieces[:-1], pieces[1:]):
        mid = (a["s1"] + b["s0"]) / 2
        a["s1"], b["s0"] = mid, mid
    pieces[0]["s0"], pieces[-1]["s1"] = 0.0, (n - 1) * step
    out = []
    for p in pieces:
        k = p["kappa"]
        dth = abs(k) * (p["s1"] - p["s0"])
        if abs(k) < STRAIGHT_KAPPA or dth < MIN_TURN:
            out.append({"s0": p["s0"], "s1": p["s1"], "kind": "s", "R": 0.0, "dir": "L", "dtheta": 0.0})
        else:
            out.append({"s0": p["s0"], "s1": p["s1"], "kind": "c", "R": min(MAX_R, 1.0 / abs(k)), "dir": "R" if k > 0 else "L", "dtheta": dth})
    return merge(out)


def merge(pieces):
    """Join consecutive straights and consecutive arcs of the same direction and similar radius."""
    out = []
    for p in pieces:
        q = out[-1] if out else None
        if q and q["kind"] == "s" and p["kind"] == "s":
            q["s1"] = p["s1"]
        elif q and q["kind"] == "c" and p["kind"] == "c" and q["dir"] == p["dir"] and abs(math.log(q["R"] / p["R"])) < 0.3:
            lq, lp = q["s1"] - q["s0"], p["s1"] - p["s0"]
            q["R"] = (lq + lp) / (lq / q["R"] + lp / p["R"])
            q["dtheta"] += p["dtheta"]
            q["s1"] = p["s1"]
        else:
            out.append(dict(p))
    return out


def reconstruct(pieces, step=2.0):
    """Integrate the pieces to a polyline (for the QA plot): heading from north, + = right.  Returns (N,2) in the leg's local frame."""
    pts = [(0.0, 0.0)]
    th = 0.0
    for p in pieces:
        length = p["s1"] - p["s0"]
        k = 0.0 if p["kind"] == "s" else (1.0 if p["dir"] == "R" else -1.0) / p["R"]
        m = max(1, int(length / step))
        h = length / m
        for _ in range(m):
            mid = th + k * h / 2
            pts.append((pts[-1][0] + math.sin(mid) * h, pts[-1][1] + math.cos(mid) * h))
            th += k * h
    return np.array(pts)
