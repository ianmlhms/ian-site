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
    bz-dtm            Autonomous Province of Bolzano - South Tyrol, DTM 2.5 m (LiDAR), WCS 2.0.1 of the provincial GeoServer
                      (coverage p_bz-Elevation__DigitalTerrainModel-2.5m, ETRS89 / UTM 32N, GeoTIFF float32, nodata -9999 outside the
                      province). One GetCoverage per 1280 m tile at 5 m (SCALEFACTOR, deflated, ~0.2 MB), cached in dem/raw/. Licence CC0 1.0 (open data
                      portal South Tyrol, attribution given anyway).
    at-dgm            Austria-wide ALS DTM 1 m of the BEV (Bundesamt für Eich- und Vermessungswesen), the mosaic of the Länder airborne
                      laser scans (Tirol, Vorarlberg, ...), 50 km cloud-optimised GeoTIFFs in EPSG:3035 on data.bev.gv.at, read with
                      range requests from the 4 m overview. Licence CC BY 4.0. Chosen over the tiris WCS of Land Tirol (gis.tirol.gv.at
                      does not answer from outside Austria: connection timeout) and the per-district zip downloads of data.gv.at
                      (Gigabytes for a 20 km box); the BEV mosaic is the same Länder data, open, and covers Tirol and Vorarlberg at once.
    swissalti3d / vda-dtm: in dem_merge.py (swisstopo swissALTI3D 2 m via the STAC API, Regione Valle d'Aosta lidar DTM 2 m),
                      merged with a feather across the border (Zermatt-Cervinia). --remerge redoes the merge from the cached sources.
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


BZ_WCS = ("https://geoservices9.civis.bz.it/geoserver/ows?service=WCS&version=2.0.1&request=GetCoverage"
          "&coverageId=p_bz-Elevation__Di" "gitalTerrainModel-2.5m&format=image/tiff&subset=E({x0:.2f},{x1:.2f})&subset=N({y0:.2f},{y1:.2f})"
          "&SCALEFACTOR={scale:g}&geotiff:compression=Deflate")              # served at the frame step (2.5 m -> 5 m) and deflated: ~0.2 MB a tile
BEV_DTM = "https://data.bev.gv.at/download/ALS/DTM/{date}/ALS_DTM_CRS3035RES50000mN{n}E{e}.tif"
BEV_DATES = ("20250915", "20240915", "20230915", "20220915", "20190915")     # newest first; a tile is filled from the newest file that has data
BEV_TILE = 50000
BEV_OVERVIEW = 1                                                            # overview level 1 = 4 m (level 0 = 2 m)


def _gdal_env():
    os.environ.setdefault("GDAL_HTTP_USERAGENT", "ian-site-ski/1.0 (https://ian.lu)")
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
    os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "4")
    os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "3")


def raster_onto(frame, src, e0, n_top, nx, nz, step):
    """Any rasterio dataset resampled (bilinear) onto the frame grid nodes (e0 + i*step, n_top - j*step); NaN where it has no data."""
    import rasterio
    from rasterio.transform import from_origin
    from rasterio.warp import Resampling, reproject
    out = np.full((nz, nx), np.nan, np.float32)
    reproject(rasterio.band(src, 1), out, src_nodata=src.nodata, dst_transform=from_origin(e0 - step / 2, n_top + step / 2, step, step),
              dst_crs=frame.crs, dst_nodata=np.nan, resampling=Resampling.bilinear)
    out[out < NODATA_BELOW] = np.nan
    return out


def frame_bounds_in(frame, crs, e0, n_top, nx, nz, step, pad):
    """(x0, y0, x1, y1) of the frame grid rectangle (+ pad m) in another CRS."""
    from pyproj import Transformer
    t = Transformer.from_crs(frame.crs, crs, always_xy=True)
    xs, ys = [], []
    for e in np.linspace(e0 - pad, e0 + (nx - 1) * step + pad, 5):
        for n in np.linspace(n_top + pad, n_top - (nz - 1) * step - pad, 5):
            x, y = t.transform(e, n)
            xs.append(x)
            ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)


def bz_grid(frame, e0, n_top, nx, nz, step, cache):
    """South Tyrol DTM 2.5 m via WCS: one GeoTIFF of the rectangle (+ 10 m) in EPSG:25832 at the frame step, resampled onto the frame nodes."""
    import rasterio
    x0, y0, x1, y1 = frame_bounds_in(frame, "EPSG:25832", e0, n_top, nx, nz, step, 10.0)
    body = http_get(BZ_WCS.format(x0=x0, x1=x1, y0=y0, y1=y1, scale=min(1.0, 2.5 / step)), cache, timeout=240, pause=1.0)
    if body[:2] not in (b"II", b"MM"):
        os.remove(cache)
        raise SystemExit("South Tyrol WCS did not answer a GeoTIFF: %r" % body[:300])
    with rasterio.open(cache) as src:
        return raster_onto(frame, src, e0, n_top, nx, nz, step)


_bev_ok = {}


def bev_grid(frame, e0, n_top, nx, nz, step):
    """Austria ALS DTM (BEV, CC BY 4.0) from the 4 m overview of the 50 km COGs, newest file first; NaN outside Austria."""
    import rasterio
    _gdal_env()
    out = np.full((nz, nx), np.nan, np.float32)
    x0, y0, x1, y1 = frame_bounds_in(frame, "EPSG:3035", e0, n_top, nx, nz, step, 20.0)
    for tn in range(int(y0 // BEV_TILE), int(y1 // BEV_TILE) + 1):
        for te in range(int(x0 // BEV_TILE), int(x1 // BEV_TILE) + 1):
            for date in BEV_DATES:
                url = BEV_DTM.format(date=date, n=tn * BEV_TILE, e=te * BEV_TILE)
                if _bev_ok.get(url) is False:
                    continue
                try:
                    with rasterio.open("/vsicurl/" + url, overview_level=BEV_OVERVIEW) as src:
                        part = raster_onto(frame, src, e0, n_top, nx, nz, step)
                    _bev_ok[url] = True
                except Exception as err:  # noqa: BLE001  (no file of that date for this 50 km tile)
                    if url not in _bev_ok:
                        print("  bev: no file", url.rsplit("/", 2)[-2:], str(err)[:70])
                    _bev_ok[url] = False
                    continue
                keep = np.isnan(out) & ~np.isnan(part)
                out[keep] = part[keep]
                if not np.isnan(out).any():
                    return out
    return out


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


def adopt_old_tiles(rid, frame):
    """A resort whose box changed gets a new cache folder (RESORTS[rid]["work"]); its height tiles that the old box had already are
    hard-linked from the old folder under their new indices (RESORTS[rid]["work_from"] = (old folder, old east0, old north0): tile
    origins sit on whole TILE_SIZE multiples, so a tile keeps its data, only its index moves). The far grid is fetched again (its size
    depends on the box)."""
    src = RESORTS[rid].get("work_from")
    if not src:
        return
    old, e0, n0 = src
    old_dir = os.path.join(os.path.dirname(work_dir(rid)), old, "dem")
    dx, dz = int(round((e0 - frame.east0) / TILE_SIZE)), int(round((frame.north0 - n0) / TILE_SIZE))
    linked = 0
    for prefix, sub in (("near_", ()), ("ign5_", ("raw",)), ("bz_", ("raw",))):
        d = os.path.join(old_dir, *sub)
        if not os.path.isdir(d):
            continue
        for name in os.listdir(d):
            if not name.startswith(prefix):
                continue
            stem, ext = os.path.splitext(name[len(prefix):])
            try:
                tx, tz = (int(v) for v in stem.split("_"))
            except ValueError:
                continue
            nx_, nz_ = tx + dx, tz + dz
            if not (0 <= nx_ < frame.tiles_x and 0 <= nz_ < frame.tiles_z):
                continue
            dst = os.path.join(work_dir(rid, "dem", *sub), "%s%d_%d%s" % (prefix, nx_, nz_, ext))
            if not os.path.exists(dst):
                os.link(os.path.join(d, name), dst)
                linked += 1
    for name in ("sources.json",):
        if os.path.exists(os.path.join(old_dir, name)) and not os.path.exists(os.path.join(work_dir(rid, "dem"), name)):
            os.link(os.path.join(old_dir, name), os.path.join(work_dir(rid, "dem"), name))
    if linked:
        print("adopted %d cached tiles from %s (index shift %+d, %+d)" % (linked, old, dx, dz))


def fetch_near(rid, frame):
    adopt_old_tiles(rid, frame)
    srcs = RESORTS[rid]["dem"]
    if any(s in ("swissalti3d", "vda-dtm") for s in srcs):     # several DEMs across a border: whole-box mosaics merged (dem_merge.py)
        from dem_merge import fetch_near_merged
        if "--remerge" in sys.argv or not all(os.path.exists(os.path.join(work_dir(rid, "dem"), "near_%d_%d.npy" % (tx, tz)))
                                              for tz in range(frame.tiles_z) for tx in range(frame.tiles_x)):
            fetch_near_merged(rid, frame, srcs)
        return
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
                elif src == "bz-dtm":
                    part = bz_grid(frame, e0, n_top, n, n, NEAR_STEP, os.path.join(work_dir(rid, "dem", "raw"), "bz_%d_%d.tif" % (tx, tz)))
                elif src == "at-dgm":
                    part = bev_grid(frame, e0, n_top, n, n, NEAR_STEP)
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
