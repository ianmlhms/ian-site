#!/usr/bin/env python3
"""Level road beds (28 Nov 2026): the village streets of roads.json get a terrain that is flat ACROSS the street.

The 5 m terrain banks sideways where the real slope does (Courchevel's streets lean 10-20 degrees across), so a street drawn on it
looked like a bobsled run. `flatten_roads` lowers / raises the 5 m mosaic around every street polyline so that

  * under the street and a little beyond it (half width + FLAT_PAD) the ground has the street's own height at its nearest point
    (cross slope 0; the height ALONG the street is the terrain's, smoothed over ~25 m and agreed between streets that meet),
  * over the next SHOULDER m a smooth step carries it back into the slope,
  * nothing moves under pistes (their groomed mask) or inside a house footprint (its `ground` is fixed in buildings.json), the ground next
    to a house moves at most HOUSE_SLOPE m per m of distance from the wall, and nowhere by more than MAX_MOVE m (a very steep side slope keeps part of its lean).

Pure numpy / scipy, no I/O. Called from bake.py before the station pads (a pad wins over a street bed).
"""
from __future__ import annotations

import os

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

FLAT_PAD = 6.5          # m of level ground beyond the street's edge
SHOULDER = 10.0         # m over which the level bed fades into the slope
MAX_MOVE = 5.0          # m: the bed never cuts or fills more than this
SPACING = 2.5           # m between the samples along a street
ALONG_SIGMA = 5         # samples (12.5 m): smoothing of the street's height profile
JOIN_RADIUS = 6.0       # m: samples of streets that meet agree on one height
HOUSE_SLOPE = 1.2       # m of move allowed per m of distance from a house footprint (0 inside it: a house keeps its ground)


def _sample(mosaic, step, x, z):
    return ndimage.map_coordinates(mosaic, [z / step, x / step], order=1, mode="nearest")


def _resample(p, spacing):
    d = np.hypot(*np.diff(p, axis=0).T)
    s = np.r_[0, np.cumsum(d)]
    if s[-1] < 1e-6:
        return p[:1]
    t = np.arange(0, s[-1], spacing)
    t = np.r_[t, s[-1]]
    return np.c_[np.interp(t, s, p[:, 0]), np.interp(t, s, p[:, 1])]


def flatten_roads(mosaic, step, segments, pmask, house_polys=(), log=print):
    """mosaic: heights [z, x] on a `step` m grid; segments: [(half width m, Nx2 points)]; pmask: piste mask on the same grid.
    Returns a new array (the input is not changed)."""
    if not segments or os.environ.get("SKI_NO_BEDS"):          # SKI_NO_BEDS=1: a baseline bake without the beds (to see what else drifted)
        return mosaic
    px, pz, ph, phw = [], [], [], []
    for hw, pts in segments:
        q = _resample(np.asarray(pts, float), SPACING)
        if len(q) < 2:
            continue
        h = _sample(mosaic, step, q[:, 0], q[:, 1])
        if len(h) > 3:
            h = ndimage.gaussian_filter1d(h, ALONG_SIGMA, mode="nearest")
        px.append(q[:, 0]); pz.append(q[:, 1]); ph.append(h); phw.append(np.full(len(q), hw))
    if not px:
        return mosaic
    px, pz, ph, phw = (np.concatenate(a) for a in (px, pz, ph, phw))
    tree = cKDTree(np.c_[px, pz])
    # streets that meet agree on one height (and a street's own profile gets a little smoother)
    sums = np.zeros(len(ph))
    cnt = np.zeros(len(ph))
    for a, b in tree.query_pairs(JOIN_RADIUS, output_type="ndarray"):
        sums[a] += ph[b]; cnt[a] += 1
        sums[b] += ph[a]; cnt[b] += 1
    ph = (ph + sums) / (1 + cnt)

    nz, nx = mosaic.shape
    reach = float(phw.max()) + FLAT_PAD + SHOULDER
    marks = np.zeros(mosaic.shape, bool)
    ii = np.clip(np.round(px / step).astype(int), 0, nx - 1)
    jj = np.clip(np.round(pz / step).astype(int), 0, nz - 1)
    marks[jj, ii] = True
    cand = ndimage.distance_transform_edt(~marks) * step <= reach + step
    cj, ci = np.nonzero(cand)
    d, k = tree.query(np.c_[ci * step, cj * step], distance_upper_bound=reach)
    ok = np.isfinite(d)
    cj, ci, d, k = cj[ok], ci[ok], d[ok], k[ok]
    flat = phw[k] + FLAT_PAD
    t = np.clip(1 - (d - flat) / SHOULDER, 0, 1)
    w = t * t * (3 - 2 * t)
    w *= 1 - np.clip(pmask[cj, ci], 0, 1)                      # pistes keep their own groomed surface
    cap = np.full(len(d), MAX_MOVE)
    if len(house_polys):
        from PIL import Image, ImageDraw
        img = Image.new("L", (nx, nz), 0)
        dr = ImageDraw.Draw(img)
        for poly in house_polys:
            dr.polygon([(float(x) / step, float(z) / step) for x, z in poly], fill=255)
        inside = np.asarray(img) > 0
        away = ndimage.distance_transform_edt(~inside) * step
        cap = np.minimum(MAX_MOVE, HOUSE_SLOPE * away[cj, ci])
    out = mosaic.astype(np.float64).copy()
    cur = out[cj, ci]
    out[cj, ci] = cur + w * np.clip(ph[k] - cur, -cap, cap)
    moved = np.abs(out - mosaic)
    log("road beds: %d streets samples, %d nodes moved (mean %.2f m, max %.2f m)" % (len(ph), int((moved > 0.02).sum()),
                                                                                    float(moved[moved > 0.02].mean()) if (moved > 0.02).any() else 0.0, float(moved.max())))
    return out.astype(np.float32)
