#!/usr/bin/env python3
"""Read the LiDAR 2024 terrain (DTM) and surface (DSM) models for the Lux Drive world into node grids
(cached as .npy under $LUXDRIVE_WORK/raw).

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/luxdrive/fetch_lidar.py

The national models are cloud-optimised GeoTIFFs (0.5 m, EPSG:2169) on data.public.lu; only the
windows we need are read with HTTP range requests (the internal overviews give the area-averaged
values without downloading the 0.5 m pixels).

A grid node (i, j) sits at world x = i*step, z = j*step; its value is the mean over the step x step
cell CENTRED on the node, so the node lattice of the game is the LiDAR sampled exactly where the game
samples it.

  dtm4.npy    float32 [NZ+1, NX+1]   terrain, 4 m nodes over the world box
  dsm4.npy    float32 [NZ+1, NX+1]   surface (trees, roofs), same lattice  -> canopy height = dsm - dtm
  far32.npy   float32 [FZ+1, FX+1]   terrain, 32 m nodes over the box + FAR_MARGIN on every side
"""
import json
import os
import sys

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds
from scipy.ndimage import distance_transform_edt

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.get("LUXDRIVE_WORK", os.path.expanduser("~/Library/Caches/luxdrive-work"))
RAW = os.path.join(WORK, "raw")
os.makedirs(RAW, exist_ok=True)

COG_BASE = "https://download.data.public.lu/resources/bd-l-lidar2024-releve-3d-du-territoire-luxembourgeois/20241223-093912/"
COGS = {"dtm": COG_BASE + "MNT_Lidar2024.tif", "dsm": COG_BASE + "MNS_Lidar2024.tif"}
NODATA = -9999.0
STRIP_NODES = 512          # rows read per request
NEAR_STEP = 4.0
FAR_STEP = 32.0
FAR_MARGIN = 8192.0


def read_nodes(ds, origin_e, origin_n, x0, z0, step, nx, nz):
    """Mean over the step x step cell centred on each node of the lattice (x0 + i*step, z0 + j*step)."""
    out = np.full((nz, nx), NODATA, dtype=np.float32)
    for r0 in range(0, nz, STRIP_NODES):
        rows = min(STRIP_NODES, nz - r0)
        west = origin_e + x0 - step / 2.0
        east = west + nx * step
        north = origin_n - (z0 + r0 * step) + step / 2.0
        south = north - rows * step
        win = from_bounds(west, south, east, north, ds.transform)
        data = ds.read(1, window=win, out_shape=(rows, nx), resampling=Resampling.average,
                       boundless=True, fill_value=NODATA)
        out[r0:r0 + rows] = data.astype(np.float32)
        print("  rows %d / %d" % (r0 + rows, nz), flush=True)
    return out


def fill_nodata(a):
    """Nearest-valid fill (building holes, water); raises if nothing valid."""
    bad = a <= NODATA / 2
    if not bad.any():
        return a, 0.0
    if bad.all():
        raise SystemExit("no LiDAR data in the window")
    idx = distance_transform_edt(bad, return_distances=False, return_indices=True)
    return a[tuple(idx)], float(bad.mean())


def main():
    world = json.load(open(os.path.join(RAW, "world.json"), encoding="utf-8"))
    origin_e = world["originE"]
    origin_n = world["originNTop"]
    w, h = world["width"], world["depth"]
    print("world box %.0f x %.0f m at E %.0f N %.0f" % (w, h, origin_e, origin_n))

    nx, nz = int(w / NEAR_STEP) + 1, int(h / NEAR_STEP) + 1
    far_nx = int((w + 2 * FAR_MARGIN) / FAR_STEP) + 1
    far_nz = int((h + 2 * FAR_MARGIN) / FAR_STEP) + 1

    env = rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
                       GDAL_HTTP_MAX_RETRY="6", GDAL_HTTP_RETRY_DELAY="2", VSI_CACHE="TRUE",
                       VSI_CACHE_SIZE="268435456")
    with env:
        dtm = rasterio.open("/vsicurl/" + COGS["dtm"])
        dsm = rasterio.open("/vsicurl/" + COGS["dsm"])
        for name, ds in (("dtm4", dtm), ("dsm4", dsm)):
            path = os.path.join(RAW, name + ".npy")
            if os.path.exists(path):
                print("have", name)
                continue
            print("reading", name, nx, "x", nz, "at %.0f m" % NEAR_STEP, flush=True)
            a = read_nodes(ds, origin_e, origin_n, 0.0, 0.0, NEAR_STEP, nx, nz)
            a, frac = fill_nodata(a)
            print("  nodata filled: %.4f%%, range %.1f .. %.1f" % (frac * 100, a.min(), a.max()))
            np.save(path, a)
        path = os.path.join(RAW, "far32.npy")
        if not os.path.exists(path):
            print("reading far32", far_nx, "x", far_nz, flush=True)
            a = read_nodes(dtm, origin_e, origin_n, -FAR_MARGIN, -FAR_MARGIN, FAR_STEP, far_nx, far_nz)
            a, frac = fill_nodata(a)
            print("  nodata filled: %.2f%%, range %.1f .. %.1f" % (frac * 100, a.min(), a.max()))
            np.save(path, a)
    print("done")


if __name__ == "__main__":
    sys.exit(main())
