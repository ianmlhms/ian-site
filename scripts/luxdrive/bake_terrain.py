#!/usr/bin/env python3
"""Bake the LiDAR grids into the compact game files (pb/lux-drive/data/terrain.bin, far.bin,
canopy.bin) and write their checksums into pb/lux-drive/data/terrain.json.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/luxdrive/bake_terrain.py

  terrain.bin  MBG1 grid, 4 m nodes over the world box (4225 x 3713), 0.1 m quantisation, de-spiked
  far.bin      MBG1 grid, 32 m nodes over box + 8 km (the distant hills), 0.25 m quantisation
  canopy.bin   two MBG1 grids on a 16 m lattice: mean canopy height of the covered cells, and the
               covered fraction
"""
import json
import os
import struct
import sys

import numpy as np
from scipy.ndimage import gaussian_filter, uniform_filter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import codec  # noqa: E402
from common import (CANOPY_STEP, FAR_MARGIN, FAR_STEP, NEAR_STEP, OUT_DIR, RAW_DIR,  # noqa: E402
                    WORLD_H, WORLD_W, checksum)

TERRAIN_STEP = 0.1
FAR_STEP_Q = 0.25
SPIKE_LIMIT = 2.5          # m: a node more than this below its lowest / above its highest 4-neighbour is clipped back
SPIKE_KEEP = 0.4
CANOPY_MIN = 3.0           # m: DSM - DTM above this counts as canopy


def despike(a):
    """Clip single-node pits / peaks (LiDAR dropouts, poles, crevices narrower than the lattice)."""
    p = np.pad(a, 1, mode="edge")
    nb = np.stack([p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]])
    lo, hi = nb.min(0), nb.max(0)
    out = a.copy()
    pits = a < lo - SPIKE_LIMIT
    peaks = a > hi + SPIKE_LIMIT
    out[pits] = lo[pits] - SPIKE_KEEP
    out[peaks] = hi[peaks] + SPIKE_KEEP
    return out, int(pits.sum() + peaks.sum())


def write(name, blob):
    path = os.path.join(OUT_DIR, name)
    with open(path, "wb") as fh:
        fh.write(blob)
    print("%-12s %8.1f KB" % (name, len(blob) / 1024.0))
    return len(blob)


def main():
    dtm = np.load(os.path.join(RAW_DIR, "dtm4.npy")).astype(np.float64)
    dsm = np.load(os.path.join(RAW_DIR, "dsm4.npy")).astype(np.float64)
    far = np.load(os.path.join(RAW_DIR, "far32.npy")).astype(np.float64)
    info = {}

    ground, n_spikes = despike(dtm)
    print("despiked %d nodes" % n_spikes)
    blob, dec = codec.encode(ground, TERRAIN_STEP)
    info["terrainBytes"] = write("terrain.bin", blob)
    info["terrain"] = {"nx": dec.shape[1], "nz": dec.shape[0], "step": NEAR_STEP, "quant": TERRAIN_STEP,
                       "checksum": checksum(dec), "min": float(dec.min()), "max": float(dec.max()),
                       "despiked": n_spikes}

    far_s = gaussian_filter(far, 0.7)
    blob, dec_far = codec.encode(far_s, FAR_STEP_Q)
    info["farBytes"] = write("far.bin", blob)
    info["far"] = {"nx": dec_far.shape[1], "nz": dec_far.shape[0], "step": FAR_STEP, "margin": FAR_MARGIN,
                   "quant": FAR_STEP_Q, "checksum": checksum(dec_far), "min": float(dec_far.min()),
                   "max": float(dec_far.max())}

    # canopy: the mean height of the covered cells of each 16 m square and the covered fraction
    # (the source rasters are on the 4 m lattice, so the window and the decimation are counted in 4 m steps:
    #  a window of k nodes covers k * NEAR_STEP m and taking every sub-th node leaves a CANOPY_STEP lattice)
    chm = np.clip(dsm - ground, 0, 45)
    covered = (chm > CANOPY_MIN).astype(np.float64)
    k = int(CANOPY_STEP // NEAR_STEP) + 1
    sub = int(CANOPY_STEP // NEAR_STEP)
    num = uniform_filter(chm * covered, size=k, mode="nearest")
    cover = uniform_filter(covered, size=k, mode="nearest")
    height = np.where(cover > 0.02, num / np.maximum(cover, 1e-6), 0.0)
    height = height[::sub, ::sub]
    cover = cover[::sub, ::sub]
    b1, d1 = codec.encode(height, 0.5, h0=0.0)
    b2, d2 = codec.encode(cover, 0.02, h0=0.0)
    blob = struct.pack("<I", len(b1)) + b1 + b2
    info["canopyBytes"] = write("canopy.bin", blob)
    info["canopy"] = {"nx": d1.shape[1], "nz": d1.shape[0], "step": CANOPY_STEP,
                      "checksumHeight": checksum(d1), "checksumCover": checksum(d2),
                      "meanCover": float(cover.mean())}

    with open(os.path.join(OUT_DIR, "terrain.json"), "w", encoding="utf-8") as fh:
        json.dump(info, fh, indent=1)
    total = info["terrainBytes"] + info["farBytes"] + info["canopyBytes"]
    print("total %.2f MB" % (total / 1048576.0))


if __name__ == "__main__":
    main()
