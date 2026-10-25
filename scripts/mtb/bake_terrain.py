#!/usr/bin/env python3
"""Bake the LiDAR grids into the compact game files (pb/mtb/data/terrain.bin, far.bin, canopy.bin) and write their checksums into
pb/mtb/data/terrain.json.  Needs fetch_lidar.py first.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/mtb/bake_terrain.py

  terrain.bin  MBG1 grid, 2 m nodes over the playable box (3073 x 2305), 0.1 m quantisation, de-spiked
  far.bin      MBG1 grid, 32 m nodes over box + 8 km (distant hills), 0.25 m quantisation, lightly smoothed
  canopy.bin   two MBG1 grids on an 8 m lattice: mean canopy height of the cells that are covered (DSM - DTM), and the covered fraction
"""
import json
import os
import struct
import sys

import numpy as np
from scipy.ndimage import gaussian_filter, uniform_filter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import codec  # noqa: E402
from common import FAR_MARGIN, OUT_DIR, RAW_DIR, WORLD_H, WORLD_W  # noqa: E402

TERRAIN_STEP = 0.1
FAR_STEP = 0.25
SPIKE_LIMIT = 2.5          # m: a node more than this below its lowest / above its highest 4-neighbour is clipped back to neighbour -/+ SPIKE_KEEP
SPIKE_KEEP = 0.4
CANOPY_MIN = 3.0           # m: DSM - DTM above this counts as canopy
CANOPY_STEP_M = 8


def despike(a):
    """Clip single-node pits / peaks (LiDAR dropouts, poles, crevices narrower than the 2 m lattice).  Returns (new array, count)."""
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


def checksum(data):
    """Same as gridChecksum() in pb/mtb/codec.js."""
    v = np.rint(data.astype(np.float64).ravel() * 64).astype(np.int64)
    a = 0
    b = 0
    # exact replica of the JS loop, vectorised in 100k blocks
    for start in range(0, v.size, 1 << 16):
        for x in v[start:start + (1 << 16)].tolist():
            a = (a + x) % 1000003
            b = (b + a) % 1000033
    return a * 1000033 + b


def main():
    dtm = np.load(os.path.join(RAW_DIR, "dtm2.npy")).astype(np.float64)
    dsm = np.load(os.path.join(RAW_DIR, "dsm2.npy")).astype(np.float64)
    far = np.load(os.path.join(RAW_DIR, "far32.npy")).astype(np.float64)
    info = {}

    ground, n_spikes = despike(dtm)
    print("despiked %d nodes" % n_spikes)
    blob, dec = codec.encode(ground, TERRAIN_STEP)
    info["terrainBytes"] = write("terrain.bin", blob)
    info["terrain"] = {"nx": dec.shape[1], "nz": dec.shape[0], "step": 2.0, "quant": TERRAIN_STEP, "checksum": checksum(dec), "min": float(dec.min()), "max": float(dec.max()), "despiked": n_spikes}

    far_s = gaussian_filter(far, 0.7)
    blob, dec_far = codec.encode(far_s, FAR_STEP)
    info["farBytes"] = write("far.bin", blob)
    info["far"] = {"nx": dec_far.shape[1], "nz": dec_far.shape[0], "step": 32.0, "margin": FAR_MARGIN, "quant": FAR_STEP, "checksum": checksum(dec_far), "min": float(dec_far.min()), "max": float(dec_far.max())}

    chm = np.clip(dsm - ground, 0, 45)
    covered = (chm > CANOPY_MIN).astype(np.float64)
    k = CANOPY_STEP_M // 2 + 1      # 5 nodes centred on every 4th node
    sub = CANOPY_STEP_M // 2
    num = uniform_filter(chm * covered, size=k, mode="nearest")
    cover = uniform_filter(covered, size=k, mode="nearest")
    height = np.where(cover > 0.02, num / np.maximum(cover, 1e-6), 0.0)
    height = height[::sub, ::sub]
    cover = cover[::sub, ::sub]
    b1, d1 = codec.encode(height, 0.5, h0=0.0)
    b2, d2 = codec.encode(cover, 0.02, h0=0.0)
    blob = struct.pack("<I", len(b1)) + b1 + b2
    info["canopyBytes"] = write("canopy.bin", blob)
    info["canopy"] = {"nx": d1.shape[1], "nz": d1.shape[0], "step": float(CANOPY_STEP_M), "checksumHeight": checksum(d1), "checksumCover": checksum(d2), "meanCover": float(cover.mean())}

    with open(os.path.join(OUT_DIR, "terrain.json"), "w", encoding="utf-8") as fh:
        json.dump(info, fh, indent=1)
    print("total", (info["terrainBytes"] + info["farBytes"] + info["canopyBytes"]) / 1024.0, "KB")


if __name__ == "__main__":
    main()
