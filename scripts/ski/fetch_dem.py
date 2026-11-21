#!/usr/bin/env python3
"""Download the terrain of one resort into $SKI_WORK/<resort>/dem/ as float32 .npy grids in the resort frame.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/ski/fetch_dem.py killy          # near tiles + far grid
    ... fetch_dem.py killy --far                                                           # far grid only

Outputs
    dem/near_<tx>_<tz>.npy   (TILE_CELLS + 1)^2 nodes at NEAR_STEP m, node (i, j) at world (tx*TILE + i*step, tz*TILE + j*step), NaN = no data
    dem/far.npy              the FAR_STEP grid over the box + FAR_MARGIN, node (0, 0) at world (-FAR_MARGIN, -FAR_MARGIN)

Sources (each a function below; RESORTS[rid]["dem"] / ["far"] list them in priority order):
    ign-rgealti       IGN RGE ALTI (France), WMS-R of the Géoplateforme, layer RGEALTI-MNT_PYR-ZIP_FXX_LAMB93_WMS, format
                      image/x-bil;bits=32 in Lambert-93. Licence Ouverte / Etalab 2.0. One request per second at most (the
                      service announces x-ratelimit-limit-second: 1).
    copernicus-glo30  Copernicus DEM GLO-30 (30 m DSM, EGM2008 heights), cloud-optimised GeoTIFFs on the AWS open-data bucket
                      copernicus-dem-30m, read with range requests. © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH
                      2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved (free licence
                      with attribution).
    swissalti3d / bz-dtm / vda-dtm / at-dgm: planned for the next resorts (swisstopo swissALTI3D, Provincia di Bolzano DTM,
                      Regione Valle d'Aosta DTM, Land Tirol / Vorarlberg DGM via data.gv.at); not implemented yet.
"""
from __future__ import annotations

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import FAR_MARGIN, FAR_STEP, NEAR_STEP, RESORTS, TILE_CELLS, TILE_SIZE, Frame, http_get, resort_arg, work_dir  # noqa: E402

NODATA_BELOW = -1000.0
IGN_WMS = ("https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=RGEALTI-MNT_PYR-ZIP_FXX_LAMB93_WMS"
           "&STYLES=&CRS=EPSG:2154&BBOX={x0},{y0},{x1},{y1}&WIDTH={w}&HEIGHT={h}&FORMAT=image/x-bil;bits=32")
COP_URL = "https://copernicus-dem-30m.s3.amazonaws.com/{n}/{n}.tif"


def ign_grid(frame, rid, e0, n_top, nx, nz, step, cache):
    """IGN nodes at (e0 + i*step, n_top - j*step), i < nx, j < nz (pixel centres = nodes). Lambert-93 frames only."""
    if frame.crs != "EPSG:2154":
        raise SystemExit("ign-rgealti needs a Lambert-93 resort frame (got %s)" % frame.crs)
    half = step / 2
    url = IGN_WMS.format(x0=e0 - half, y0=n_top - (nz - 1) * step - half, x1=e0 + (nx - 1) * step + half, y1=n_top + half, w=nx, h=nz)
    body = http_get(url, cache, pause=1.1)
    a = np.frombuffer(body, "<f4").astype(np.float32)
    if a.size != nx * nz:
        os.remove(cache)
        raise SystemExit("IGN answer has %d values, expected %d (%s)" % (a.size, nx * nz, body[:200]))
    a = a.reshape(nz, nx).copy()
    a[a < NODATA_BELOW] = np.nan
    return a


def copernicus_grid(frame, e0, n_top, nx, nz, step):
    """Copernicus GLO-30 resampled (bilinear) onto the frame grid; NaN where no tile exists (sea, outside)."""
    import rasterio
    from rasterio.warp import Resampling, reproject
    from rasterio.transform import from_origin
    out = np.full((nz, nx), np.nan, np.float32)
    lons, lats = [], []
    for e in (e0, e0 + (nx - 1) * step):
        for n in (n_top, n_top - (nz - 1) * step):
            lo, la = frame.inv.transform(e, n)
            lons.append(lo)
            lats.append(la)
    dst_t = from_origin(e0 - step / 2, n_top + step / 2, step, step)
    os.environ.setdefault("GDAL_HTTP_USERAGENT", "ian-site-ski/1.0 (https://ian.lu)")
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    for lat in range(math.floor(min(lats)), math.floor(max(lats)) + 1):
        for lon in range(math.floor(min(lons)), math.floor(max(lons)) + 1):
            name = "Copernicus_DSM_COG_10_%s%02d_00_%s%03d_00_DEM" % ("N" if lat >= 0 else "S", abs(lat), "E" if lon >= 0 else "W", abs(lon))
            url = "/vsicurl/" + COP_URL.format(n=name)
            try:
                with rasterio.open(url) as src:
                    part = np.full((nz, nx), np.nan, np.float32)
                    reproject(rasterio.band(src, 1), part, src_nodata=src.nodata, dst_transform=dst_t, dst_crs=frame.crs,
                              dst_nodata=np.nan, resampling=Resampling.bilinear)
            except Exception as err:  # noqa: BLE001  (no tile there, e.g. the sea)
                print("  copernicus: no tile", name, str(err)[:80])
                continue
            keep = np.isnan(out) & ~np.isnan(part)
            out[keep] = part[keep]
            print("  copernicus", name, int(keep.sum()), "nodes")
    return out


def fetch_near(rid, frame):
    srcs = RESORTS[rid]["dem"]
    n = TILE_CELLS + 1
    total = frame.tiles_x * frame.tiles_z
    done = 0
    for tz in range(frame.tiles_z):
        for tx in range(frame.tiles_x):
            path = os.path.join(work_dir(rid, "dem"), "near_%d_%d.npy" % (tx, tz))
            done += 1
            if os.path.exists(path):
                continue
            e0 = frame.east0 + tx * TILE_SIZE
            n_top = frame.north0 - tz * TILE_SIZE
            grid = np.full((n, n), np.nan, np.float32)
            for src in srcs:
                if src == "ign-rgealti":
                    part = ign_grid(frame, rid, e0, n_top, n, n, NEAR_STEP, os.path.join(work_dir(rid, "dem", "raw"), "ign5_%d_%d.bil" % (tx, tz)))
                elif src == "copernicus-glo30":
                    part = copernicus_grid(frame, e0, n_top, n, n, NEAR_STEP)
                else:
                    raise SystemExit("DEM source %s is not implemented yet" % src)
                keep = np.isnan(grid) & ~np.isnan(part)
                grid[keep] = part[keep]
                if not np.isnan(grid).any():
                    break
            np.save(path, grid)
            print("near %d/%d tile %d,%d  %.0f..%.0f m  nan %d" % (done, total, tx, tz, np.nanmin(grid) if not np.isnan(grid).all() else -1,
                                                                 np.nanmax(grid) if not np.isnan(grid).all() else -1, int(np.isnan(grid).sum())))


def fetch_far(rid, frame):
    path = os.path.join(work_dir(rid, "dem"), "far.npy")
    if os.path.exists(path):
        return
    nx = int(round((frame.width + 2 * FAR_MARGIN) / FAR_STEP)) + 1
    nz = int(round((frame.depth + 2 * FAR_MARGIN) / FAR_STEP)) + 1
    e0 = frame.east0 - FAR_MARGIN
    n_top = frame.north0 + FAR_MARGIN
    grid = np.full((nz, nx), np.nan, np.float32)
    chunk = 512
    for src in RESORTS[rid]["far"]:
        if src == "ign-rgealti":
            for j0 in range(0, nz, chunk):
                for i0 in range(0, nx, chunk):
                    w, h = min(chunk, nx - i0), min(chunk, nz - j0)
                    part = ign_grid(frame, rid, e0 + i0 * FAR_STEP, n_top - j0 * FAR_STEP, w, h, FAR_STEP,
                                    os.path.join(work_dir(rid, "dem", "raw"), "ign40_%d_%d.bil" % (i0, j0)))
                    sub = grid[j0:j0 + h, i0:i0 + w]
                    keep = np.isnan(sub) & ~np.isnan(part)
                    sub[keep] = part[keep]
                    print("far ign chunk", i0, j0)
        elif src == "copernicus-glo30":
            part = copernicus_grid(frame, e0, n_top, nx, nz, FAR_STEP)
            keep = np.isnan(grid) & ~np.isnan(part)
            grid[keep] = part[keep]
        else:
            raise SystemExit("DEM source %s is not implemented yet" % src)
    print("far grid %dx%d, NaN left %d" % (nx, nz, int(np.isnan(grid).sum())))
    np.save(path, grid)


if __name__ == "__main__":
    rid = resort_arg()
    frame = Frame(rid)
    print("frame %s: %d x %d tiles (%.1f x %.1f km), origin E %.0f N %.0f" % (rid, frame.tiles_x, frame.tiles_z, frame.width / 1000, frame.depth / 1000, frame.east0, frame.north0))
    fetch_far(rid, frame)
    if "--far" not in sys.argv:
        fetch_near(rid, frame)
