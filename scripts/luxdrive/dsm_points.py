#!/usr/bin/env python3
"""The LiDAR DSM (the top of everything: decks, roofs, canopy) at given points, read exactly as bake_decks.py reads it.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/luxdrive/dsm_points.py <in.json> <out.json>

in.json:  [[[x, z], ...], ...]   groups of world points (one group per way: its window is read once)
out.json: [[v or null, ...], ...] the median of the 2 m DSM within 1.5 m of every point (bake_decks.sample_dsm_median)

Used by bake_orphan_decks.mjs (the bridge ways the deck bake has no deck for).  Network: the 2024 DSM COG of data.public.lu.
"""
import json
import os
import sys

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake_decks import COG, DSM_STEP, sample_dsm_median  # noqa: E402
from common import world_to_luref  # noqa: E402

MARGIN = 24.0             # m around the points of a group: the window that is read


def main():
    src, dst = sys.argv[1], sys.argv[2]
    groups = json.load(open(src, encoding="utf-8"))
    out = []
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", VSI_CACHE="TRUE",
                      VSI_CACHE_SIZE="134217728", GDAL_HTTP_MAX_RETRY="6"):
        with rasterio.open("/vsicurl/" + COG) as ds:
            for gi, pts in enumerate(groups):
                e, n = world_to_luref([p[0] for p in pts], [p[1] for p in pts])
                west, east = float(e.min()) - MARGIN, float(e.max()) + MARGIN
                south, north = float(n.min()) - MARGIN, float(n.max()) + MARGIN
                cols = int((east - west) / DSM_STEP) + 1
                rows = int((north - south) / DSM_STEP) + 1
                win = from_bounds(west, south, east, north, ds.transform)
                grid = ds.read(1, window=win, out_shape=(rows, cols), resampling=Resampling.average)
                vals = []
                for px, py in zip(e, n):
                    v = sample_dsm_median(grid, west, north, DSM_STEP, float(px), float(py))
                    vals.append(None if v is None or not np.isfinite(v) or v < -1000 else v)
                out.append(vals)
                print("  group %d / %d: %d points" % (gi + 1, len(groups), len(pts)), flush=True)
    json.dump(out, open(dst, "w", encoding="utf-8"))


if __name__ == "__main__":
    main()
