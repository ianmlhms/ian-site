#!/usr/bin/env python3
"""The projection of the printed piste map (the "Pistekaart"), Python side. The browser's twin is pb/ski/pano.js: the same numbers, the
same table, the same bicubic heights, so a point of a piste lands on the same pixel the painter painted.

A bent oblique view, like the hand-painted panoramas: the observer looks along azimuth `az`; every ground point has a depth s (metres
along the look direction from the front edge of the ski area) and a side offset r. Near the front the map is seen from steeply above
(almost a plan), further back ever flatter, and the mountains behind the ski area stand up to the skyline:

    u = r * R(s)                         R = 1 / (1 + s / K + (max(0, s - L) / Kb)^2)   (a little perspective; far mountains shrink)
    v = F(s) + G(s) * (y - y0)           F' = f(s) * R(s),  G = sqrt(1 - f(s)^2) * E * R(s)
    f(s) = f0 (s <= 0) ... linear ... f1 (s = L) ... exponential ... fi (far behind), f = sin(look-down angle)

    pixel x = (u - u0) * k,  pixel y = (v1 - v) * k
"""
import json
import os

import numpy as np

S_MIN, S_MAX, S_STEP = -6000.0, 40000.0, 25.0          # the table of F (keep in step with pb/ski/pano.js)


def catmull(t):
    t2, t3 = t * t, t * t * t
    return (-0.5 * t + t2 - 0.5 * t3, 1 - 2.5 * t2 + 1.5 * t3, 0.5 * t + 2 * t2 - 1.5 * t3, -0.5 * t2 + 0.5 * t3)


def _cr(w, p0, p1, p2, p3):
    v = w[0] * p0 + w[1] * p1 + w[2] * p2 + w[3] * p3
    return np.clip(v, np.minimum(p1, p2), np.maximum(p1, p2))


class FarGrid:
    """The 40 m height grid (far.bin), sampled like pb/ski/field.js sampleBicubic."""

    def __init__(self, data, step, margin):
        self.g, self.step, self.margin = data.astype(np.float32), step, margin

    def __call__(self, x, z):
        g = self.g
        nz, nx = g.shape
        gx = np.clip((np.asarray(x, np.float64) + self.margin) / self.step, 0, nx - 1.0000001)
        gz = np.clip((np.asarray(z, np.float64) + self.margin) / self.step, 0, nz - 1.0000001)
        i, j = np.floor(gx).astype(np.int32), np.floor(gz).astype(np.int32)
        wx, wz = catmull(gx - i), catmull(gz - j)
        c0, c1, c3 = np.maximum(0, i - 1), np.minimum(nx - 1, i + 1), np.minimum(nx - 1, i + 2)
        rows = []
        for k in range(4):
            jj = np.clip(j - 1 + k, 0, nz - 1)
            rows.append(_cr(wx, g[jj, c0], g[jj, i], g[jj, c1], g[jj, c3]))
        return _cr(wz, *rows)


class Projection:
    def __init__(self, cam):
        self.cam = cam
        a = np.radians(cam["az"])
        self.sa, self.ca = np.sin(a), np.cos(a)
        self.s = np.arange(S_MIN, S_MAX + S_STEP / 2, S_STEP)
        fr = self.f(self.s) * self.R(self.s)
        F = np.concatenate([[0.0], np.cumsum((fr[1:] + fr[:-1]) * 0.5 * S_STEP)])
        self.F_tab = F - F[int(round(-S_MIN / S_STEP))]

    def f(self, s):
        c = self.cam
        t = np.clip(s / c["L"], 0, 1)
        return np.where(s <= c["L"], c["f0"] + (c["f1"] - c["f0"]) * t, c["fi"] + (c["f1"] - c["fi"]) * np.exp(-np.maximum(s - c["L"], 0) / c["lam"]))

    def R(self, s):
        c = self.cam
        b = np.maximum(s - c["L"], 0) / c["Kb"]
        return 1.0 / (1.0 + s / c["K"] + b * b)

    def F(self, s):
        return np.interp(s, self.s, self.F_tab)

    def G(self, s):
        f = self.f(s)
        return np.sqrt(1 - f * f) * self.cam["E"] * self.R(s)

    def rs(self, x, z):
        dx, dz = np.asarray(x) - self.cam["cx"], np.asarray(z) - self.cam["cz"]
        return dx * self.ca + dz * self.sa, dx * self.sa - dz * self.ca            # r (right), s (depth)

    def world(self, r, s):
        return self.cam["cx"] + r * self.ca + s * self.sa, self.cam["cz"] + r * self.sa - s * self.ca

    def uv(self, x, z, y):
        r, s = self.rs(x, z)
        return r * self.R(s), self.F(s) + self.G(s) * (np.asarray(y) - self.cam["y0"])

    def px(self, x, z, y):
        u, v = self.uv(x, z, y)
        return (u - self.cam["u0"]) * self.cam["k"], (self.cam["v1"] - v) * self.cam["k"]


def hidden_by(proj, far, x, z, y, step=30.0, reach=6000.0, eps=12.0):
    """How far (in map metres) each point lies below the skyline of the ground in front of it (<= 0: visible)."""
    u, v = proj.uv(x, z, y)
    r, s = proj.rs(x, z)
    worst = np.full(u.shape, -1e9)
    for d in np.arange(step, reach, step):
        s2 = s - d
        x2, z2 = proj.world(u / proj.R(s2), s2)
        v2 = proj.F(s2) + proj.G(s2) * (far(x2, z2) - proj.cam["y0"])
        worst = np.maximum(worst, v2 - v)
    return worst - eps


def decode_grid(blob):
    """MBG1 (scripts/ski/codec.py) decoded fast: 8x8 blocks of zigzag residuals, the planar prediction undone by two cumulative sums."""
    from codec import HEADER, MAGIC
    magic, nx, nz, step, h0, block, _ = HEADER.unpack_from(blob, 0)
    if magic != MAGIC:
        raise ValueError("not an MBG1 grid")
    data = blob[HEADER.size:]
    res = np.zeros((nz, nx), dtype=np.int64)
    bit = 0
    for by in range(0, nz, block):
        hh = min(block, nz - by)
        for bx in range(0, nx, block):
            ww = min(block, nx - bx)
            n = hh * ww
            byte, off = bit >> 3, bit & 7
            w = (int.from_bytes(data[byte:byte + 2], "little") >> off) & 15
            bit += 4
            if not w:
                continue
            byte, off = bit >> 3, bit & 7
            big = int.from_bytes(data[byte:byte + (off + n * w + 7) // 8], "little") >> off
            mask = (1 << w) - 1
            zz = np.array([(big >> (k * w)) & mask for k in range(n)], dtype=np.int64)
            res[by:by + hh, bx:bx + ww] = ((zz >> 1) ^ -(zz & 1)).reshape(hh, ww)
            bit += n * w
    return (h0 + np.cumsum(np.cumsum(res, axis=0), axis=1) * step).astype(np.float32)


def load_far(data_dir):
    with open(os.path.join(data_dir, "resort.json"), encoding="utf-8") as fh:
        meta = json.load(fh)["far"]
    with open(os.path.join(data_dir, "far.bin"), "rb") as fh:
        grid = decode_grid(fh.read())
    return FarGrid(grid, meta["step"], meta["margin"])


def load_resort(data_dir):
    """resort.json with the packed lines unpacked: pistes[].line, network[].p (flat x, z lists)."""
    from linepack import unpack_line
    with open(os.path.join(data_dir, "resort.json"), encoding="utf-8") as fh:
        r = json.load(fh)
    for p in r["pistes"]:
        if "lz" in p:
            p["line"] = unpack_line(p["lz"])
    for n in r["network"]:
        if "pz" in n:
            n["p"] = unpack_line(n["pz"])
    return r
