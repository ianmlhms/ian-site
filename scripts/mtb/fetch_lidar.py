#!/usr/bin/env python3
"""Read the LiDAR 2024 terrain (DTM) and surface (DSM) models for the MTB world into node grids (cached as .npy under $MTB_WORK/raw).

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/mtb/fetch_lidar.py

The national models are cloud-optimised GeoTIFFs (0.5 m, EPSG:2169) on data.public.lu; only the windows we need are read with HTTP range
requests (the internal overviews give exact area-averaged 2 m / 32 m values without downloading the 0.5 m pixels).
A grid node (i, j) sits at world x = i*step, z = j*step; its value is the mean over the step x step cell CENTRED on the node, so the node
lattice of the game is the LiDAR sampled exactly where the game samples it.

  dtm2.npy   float32 [NZ+1, NX+1]   terrain, 2 m nodes over the playable box        (NX = 3072, NZ = 2304)
  dsm2.npy   float32 [NZ+1, NX+1]   surface (trees, roofs), same lattice           -> canopy height = dsm - dtm
  far32.npy  float32 [FZ+1, FX+1]   terrain, 32 m nodes over the box + FAR_MARGIN on every side (distant hills)
"""
import os
import sys

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds
from scipy.ndimage import distance_transform_edt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import FAR_MARGIN, ORIGIN_E, ORIGIN_N_TOP, RAW_DIR, WORLD_H, WORLD_W  # noqa: E402

COG_BASE = "https://download.data.public.lu/resources/bd-l-lidar2024-releve-3d-du-territoire-luxembourgeois/20241223-093912/"
COGS = {"dtm": COG_BASE + "MNT_Lidar2024.tif", "dsm": COG_BASE + "MNS_Lidar2024.tif"}
NODATA = -9999.0
STRIP_NODES = 256          # rows read per request


def read_nodes(ds, x0, z0, step, nx, nz):
    """Mean over the step x step cell centred on each node of the lattice (x0 + i*step, z0 + j*step), i < nx, j < nz.  -9999 where there is no data."""
    out = np.full((nz, nx), NODATA, dtype=np.float32)
    for r0 in range(0, nz, STRIP_NODES):
        rows = min(STRIP_NODES, nz - r0)
        west = ORIGIN_E + x0 - step / 2.0
        east = west + nx * step
        north = ORIGIN_N_TOP - (z0 + r0 * step) + step / 2.0
        south = north - rows * step
        win = from_bounds(west, south, east, north, ds.transform)
        data = ds.read(1, window=win, out_shape=(rows, nx), resampling=Resampling.average, boundless=True, fill_value=NODATA)
        out[r0:r0 + rows] = data.astype(np.float32)
        print("  rows", r0 + rows, "/", nz, flush=True)
    return out


def fill_nodata(a):
    """Nearest-valid fill (building holes, water, the foreign side of the border); raises if nothing valid."""
    bad = a <= NODATA / 2
    if not bad.any():
        return a, 0.0
    if bad.all():
        raise SystemExit("no LiDAR data in the window")
    idx = distance_transform_edt(bad, return_distances=False, return_indices=True)
    return a[tuple(idx)], float(bad.mean())


def main():
    env = rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_MAX_RETRY="6",
                       GDAL_HTTP_RETRY_DELAY="2", VSI_CACHE="TRUE", VSI_CACHE_SIZE="268435456")
    nx, nz = int(WORLD_W / 2) + 1, int(WORLD_H / 2) + 1
    far_nx = int((WORLD_W + 2 * FAR_MARGIN) / 32) + 1
    far_nz = int((WORLD_H + 2 * FAR_MARGIN) / 32) + 1
    with env:
        dtm = rasterio.open("/vsicurl/" + COGS["dtm"])
        dsm = rasterio.open("/vsicurl/" + COGS["dsm"])
        for name, ds in (("dtm2", dtm), ("dsm2", dsm)):
            path = os.path.join(RAW_DIR, name + ".npy")
            if os.path.exists(path):
                continue
            print("reading", name, nx, "x", nz)
            a = read_nodes(ds, 0.0, 0.0, 2.0, nx, nz)
            a, frac = fill_nodata(a)
            print("  nodata filled: %.4f%%, range %.1f .. %.1f" % (frac * 100, a.min(), a.max()))
            np.save(path, a)
        path = os.path.join(RAW_DIR, "far32.npy")
        if not os.path.exists(path):
            print("reading far32", far_nx, "x", far_nz)
            a = read_nodes(dtm, -FAR_MARGIN, -FAR_MARGIN, 32.0, far_nx, far_nz)
            a, frac = fill_nodata(a)
            print("  nodata filled: %.2f%%, range %.1f .. %.1f" % (frac * 100, a.min(), a.max()))
            np.save(path, a)
    print("done")


if __name__ == "__main__":
    main()
