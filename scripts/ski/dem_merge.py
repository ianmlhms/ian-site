#!/usr/bin/env python3
"""Height tiles of a resort that spans several DEMs (a border, a regional model with holes): one mosaic per source, merged
without a step. Used by fetch_dem.py for resorts with "merge": True (Zermatt-Cervinia: swissALTI3D north of the main ridge,
the Aosta Valley lidar DTM south of it, Copernicus GLO-30 wherever neither has data).

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/ski/fetch_dem.py zermatt      (calls fetch_near_merged)

Per source the 5 m nodes of the whole box are cached in $SKI_WORK/<resort>/dem/src/<source>.npy (NaN = no data), the raw downloads
in dem/raw/<source>/. The merge (merge_sources), from the lowest priority up:
  1. offset: where the higher source and the current base overlap near the higher source's edge, their difference (datums, glacier
     change between survey years) is measured, smoothed along the edge (normalised convolution) and added to the base, fading out
     with the distance from that edge. The base then meets the higher source at the same height.
  2. feather: across FEATHER m inside the higher source's coverage the two are blended with a smoothstep, so the slope changes
     gently instead of at a seam.
The result is written as the usual dem/near_<tx>_<tz>.npy tiles (cut from the one merged mosaic: neighbours share their edge
nodes exactly) and dem/sources.json lists the sources that contributed (bake.py credits them).

Sources
    swissalti3d   swisstopo swissALTI3D, 2 m GeoTIFF tiles of 1 km (LV95, EPSG:2056, LN02 heights), listed through the STAC API
                  of data.geo.admin.ch (collection ch.swisstopo.swissalti3d; the newest survey year of every tile is used).
                  Open Government Data of swisstopo: free use with the source named.
    vda-dtm       Regione Autonoma Valle d'Aosta, DTM 2005/2008 aggregato, lidar, 2 m, quota ortometrica, UTM 32N ED50 (EPSG:23032),
                  from geoprodotti.regione.vda.it: one 2.6 GB zip of the whole region (a 9.9 GB ASCII grid). It is downloaded once,
                  the box is cut out while streaming (dem/raw/vda-dtm/crop.npz) and the zip deleted. CC BY 4.0. The ED50 -> LV95
                  shift is checked against swissALTI3D on the overlap. When the server is unreachable the source is skipped and
                  Copernicus fills in (the run says so, and sources.json does not list it).
    copernicus-glo30  see fetch_dem.py.
"""
from __future__ import annotations

import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import zipfile

import numpy as np
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import NEAR_STEP, RESORTS, TILE_CELLS, USER_AGENT, http_get, work_dir  # noqa: E402

FEATHER = 260.0            # m of smoothstep blend inside the higher source's coverage
OFFSET_BAND = 500.0        # m inside the higher source's edge where the difference is measured
OFFSET_SIGMA = 450.0       # m of smoothing of that difference along the edge
OFFSET_FADE = 2500.0       # m beyond the edge over which the offset of the base fades out
STAC = "https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d/items?bbox={w},{s},{e},{n}&limit=100"
VDA_ZIP = "https://geoprodotti.regione.vda.it/download/DTM0508_002/DTM0508_002_UNICO.zip"


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def node_grid(frame):
    """The 5 m node grid of the whole box: (e0, n_top, nx, nz)."""
    n = TILE_CELLS
    return frame.east0, frame.north0, frame.tiles_x * n + 1, frame.tiles_z * n + 1


def reproject_into(dst, src_path_or_ds, frame, e0, n_top, step, resampling):
    """Resample one raster onto the node grid (pixel centres = nodes) and fill dst where it is still NaN."""
    import rasterio
    from rasterio.transform import from_origin
    from rasterio.warp import reproject
    part = np.full(dst.shape, np.nan, np.float32)
    ds = rasterio.open(src_path_or_ds) if isinstance(src_path_or_ds, str) else src_path_or_ds
    try:
        reproject(rasterio.band(ds, 1), part, src_nodata=ds.nodata, dst_transform=from_origin(e0 - step / 2, n_top + step / 2, step, step),
                  dst_crs=frame.crs, dst_nodata=np.nan, resampling=resampling)
    finally:
        if isinstance(src_path_or_ds, str):
            ds.close()
    part[part < -1000] = np.nan
    keep = np.isnan(dst) & ~np.isnan(part)
    dst[keep] = part[keep]
    return int(keep.sum())


# ---------------------------------------------------------------- swissALTI3D
def swiss_items(frame, rid):
    """{tile id "2623-1095": (year, url of the 2 m GeoTIFF)} for every tile that touches the box (newest year wins)."""
    cache = os.path.join(work_dir(rid, "dem", "raw", "swissalti3d"), "items.json")
    if os.path.exists(cache):
        with open(cache, encoding="utf-8") as fh:
            return json.load(fh)
    s, w, n, e = RESORTS[rid]["bbox"]
    url = STAC.format(w=w, s=s, e=e, n=n)
    best = {}
    pages = 0
    while url:
        page = json.loads(http_get(url, pause=0.3))
        pages += 1
        for f in page.get("features", []):
            m = re.match(r"swissalti3d_(\d{4})_(\d{4}-\d{4})$", f["id"])
            if not m:
                continue
            year, tid = int(m.group(1)), m.group(2)
            href = next((a["href"] for a in f["assets"].values() if a["href"].endswith(".tif") and a.get("eo:gsd") == 2.0), None)
            if href and (tid not in best or year > best[tid][0]):
                best[tid] = (year, href)
        url = next((l["href"] for l in page.get("links", []) if l.get("rel") == "next"), None)
    log("swissalti3d: %d tiles in %d STAC pages" % (len(best), pages))
    with open(cache, "w", encoding="utf-8") as fh:
        json.dump(best, fh)
    return best


def swiss_mosaic(frame, rid):
    if frame.crs != "EPSG:2056":
        raise SystemExit("swissalti3d is read in LV95 resort frames only (got %s)" % frame.crs)
    from rasterio.enums import Resampling
    e0, n_top, nx, nz = node_grid(frame)
    out = np.full((nz, nx), np.nan, np.float32)
    items = swiss_items(frame, rid)
    raw = work_dir(rid, "dem", "raw", "swissalti3d")
    for k, (tid, (year, href)) in enumerate(sorted(items.items())):
        ekm, nkm = (int(v) for v in tid.split("-"))
        # node rows / columns this 1 km tile covers (with one node of overlap for the average resampling)
        i0 = max(0, int((ekm * 1000 - e0) // NEAR_STEP) - 1)
        i1 = min(nx, int(((ekm + 1) * 1000 - e0) // NEAR_STEP) + 2)
        j0 = max(0, int((n_top - (nkm + 1) * 1000) // NEAR_STEP) - 1)
        j1 = min(nz, int((n_top - nkm * 1000) // NEAR_STEP) + 2)
        if i0 >= i1 or j0 >= j1:
            continue
        path = os.path.join(raw, os.path.basename(href))
        http_get(href, path, pause=0.15)
        sub = out[j0:j1, i0:i1]
        reproject_into(sub, path, frame, e0 + i0 * NEAR_STEP, n_top - j0 * NEAR_STEP, NEAR_STEP, Resampling.average)
        if k % 25 == 0:
            log("swissalti3d %d/%d %s (%d)" % (k + 1, len(items), tid, year))
    return out


# ---------------------------------------------------------------- Aosta Valley DTM
VDA_CRS = "EPSG:23032"     # ED50 / UTM 32N (the .PRJ: UTM zone 32, datum EUR_M, INT1909)
VDA_SHIFT_MAX = 8          # m: the ED50 -> LV95 shift is checked against swissALTI3D where both have data, within +- this


def download_stream(url, path, chunk=1 << 22):
    """A plain GET streamed to disk (the regional server answers ranges beyond 512 MiB with HTTP 500, a whole GET works)."""
    if os.path.exists(path):
        return path
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    got = 0
    with urllib.request.urlopen(req, timeout=120) as r, open(path + ".part", "wb") as fh:
        total = int(r.headers.get("Content-Length", 0))
        while True:
            block = r.read(chunk)
            if not block:
                break
            fh.write(block)
            got += len(block)
    if total and got != total:
        raise OSError("short download %d of %d" % (got, total))
    os.replace(path + ".part", path)
    return path


def vda_crop(zip_path, member, x0, y0, x1, y1):
    """Streams the 9.9 GB ASCII grid out of the zip and keeps the window [x0, x1] x [y0, y1] (UTM metres): (grid, west, north, cell)."""
    # the member is Deflate64 (zip method 9), which Python's zipfile cannot read: Info-ZIP unzip streams it
    proc = subprocess.Popen(["unzip", "-p", zip_path, member], stdout=subprocess.PIPE, bufsize=1 << 22)
    try:
        f = proc.stdout
        head = {}
        for _ in range(6):
            k, v = f.readline().decode().split()
            head[k.lower()] = float(v.replace(",", "."))
        cell, ncols = head["cellsize"], int(head["ncols"])
        west, north = head["xllcorner"], head["yllcorner"] + head["nrows"] * cell
        c0, c1 = max(0, int((x0 - west) // cell)), min(ncols, int((x1 - west) // cell) + 1)
        r0, r1 = max(0, int((north - y1) // cell)), min(int(head["nrows"]), int((north - y0) // cell) + 1)
        out = np.full((r1 - r0, c1 - c0), np.nan, np.float32)
        for r in range(r1):
            line = f.readline()
            if r < r0:
                continue
            vals = np.array(line.replace(b",", b".").split()[c0:c1], np.float32)
            out[r - r0, :len(vals)] = vals
            if (r - r0) % 1000 == 0:
                log("  vda-dtm row %d of %d..%d" % (r, r0, r1))
        out[out <= head.get("nodata_value", -9999) + 1] = np.nan
        return out, west + c0 * cell, north - r0 * cell, cell
    finally:
        proc.kill()
        proc.wait()


def vda_mosaic(frame, rid):
    """The Aosta Valley lidar DTM resampled onto the node grid (5 m box average of the 2 m grid). None when unreachable."""
    from pyproj import Transformer
    from scipy.ndimage import map_coordinates
    raw = work_dir(rid, "dem", "raw", "vda-dtm")
    e0, n_top, nx, nz = node_grid(frame)
    crop_path = os.path.join(raw, "crop.npz")
    to_utm = Transformer.from_crs(frame.crs, VDA_CRS, always_xy=True)
    if not os.path.exists(crop_path):
        try:
            zip_path = download_stream(VDA_ZIP, os.path.join(raw, os.path.basename(VDA_ZIP)))
        except Exception as err:  # noqa: BLE001  (the regional server blocks or is down: Copernicus fills in)
            log("vda-dtm: download failed (%s): skipped" % str(err)[:90])
            return None
        xs, ys = to_utm.transform([e0, e0 + (nx - 1) * NEAR_STEP] * 2, [n_top] * 2 + [n_top - (nz - 1) * NEAR_STEP] * 2)
        member = next(n for n in zipfile.ZipFile(zip_path).namelist() if n.upper().endswith(".ASC"))
        grid, west, north, cell = vda_crop(zip_path, member, min(xs) - 60, min(ys) - 60, max(xs) + 60, max(ys) + 60)
        np.savez_compressed(crop_path, grid=grid, west=west, north=north, cell=cell)
        os.remove(zip_path)                                # 2.6 GB: the crop is all this resort needs
        log("vda-dtm crop %dx%d cached, the regional zip removed" % (grid.shape[1], grid.shape[0]))
    d = np.load(crop_path)
    grid, west, north, cell = d["grid"], float(d["west"]), float(d["north"]), float(d["cell"])
    valid = ~np.isnan(grid)
    # 5 m box average of the 2 m grid (normalised, so the data edge does not sag), then bilinear at every node
    k = NEAR_STEP / cell
    filled = ndimage.uniform_filter(np.where(valid, grid, 0).astype(np.float64), k)
    wsum = ndimage.uniform_filter(valid.astype(np.float64), k)
    smooth = np.where(wsum > 0.5, filled / np.maximum(wsum, 1e-9), np.nan)
    out = np.full((nz, nx), np.nan, np.float32)
    ii = np.arange(nx) * NEAR_STEP + e0
    swiss_path = os.path.join(work_dir(rid, "dem", "src"), "swissalti3d.npy")
    shift = (0.0, 0.0)
    if os.path.exists(swiss_path):
        shift = vda_shift(frame, to_utm, smooth, west, north, cell, np.load(swiss_path))
    for j in range(0, nz, 256):
        rows = np.arange(j, min(nz, j + 256))
        E, N = np.meshgrid(ii, n_top - rows * NEAR_STEP)
        x, y = to_utm.transform(E.ravel(), N.ravel())
        col = (np.asarray(x) + shift[0] - west) / cell - 0.5
        row = (north - (np.asarray(y) + shift[1])) / cell - 0.5
        out[rows[0]:rows[-1] + 1] = map_coordinates(smooth, [row, col], order=1, cval=np.nan, mode="constant").reshape(E.shape)
    log("vda-dtm covers %.1f %% of the box (shift %+.0f, %+.0f m)" % (100 * float((~np.isnan(out)).mean()), shift[0], shift[1]))
    return out


def vda_shift(frame, to_utm, smooth, west, north, cell, swiss):
    """The UTM shift that best lays the regional DTM onto swissALTI3D where both have data (the ED50 datum shift is good to a few m)."""
    from scipy.ndimage import map_coordinates
    e0, n_top, nx, nz = node_grid(frame)
    jj, ii = np.nonzero(~np.isnan(swiss[::4, ::4]))
    if not len(jj):
        return 0.0, 0.0
    jj, ii = jj * 4, ii * 4
    x, y = to_utm.transform(e0 + ii * NEAR_STEP, n_top - jj * NEAR_STEP)
    x, y, h = np.asarray(x), np.asarray(y), swiss[jj, ii]
    best = None
    for dx in range(-VDA_SHIFT_MAX, VDA_SHIFT_MAX + 1, 2):
        for dy in range(-VDA_SHIFT_MAX, VDA_SHIFT_MAX + 1, 2):
            v = map_coordinates(smooth, [(north - (y + dy)) / cell - 0.5, (x + dx - west) / cell - 0.5], order=1, cval=np.nan, mode="constant")
            ok = ~np.isnan(v)
            if ok.sum() < 2000:
                continue
            d = v[ok] - h[ok]
            score = float(np.median(np.abs(d - np.median(d))))
            if best is None or score < best[0]:
                best = (score, dx, dy, int(ok.sum()), float(np.median(d)))
    if best is None:
        log("vda-dtm: no overlap with swissALTI3D to check the shift")
        return 0.0, 0.0
    log("vda-dtm vs swissALTI3D: best shift %+d, %+d m (MAD %.2f m over %d nodes, median diff %+.2f m)" % (best[1], best[2], best[0], best[3], best[4]))
    return float(best[1]), float(best[2])


# ---------------------------------------------------------------- Copernicus (whole box at once)
def copernicus_mosaic(frame, rid):
    from fetch_dem import copernicus_grid
    e0, n_top, nx, nz = node_grid(frame)
    return copernicus_grid(frame, e0, n_top, nx, nz, NEAR_STEP)


SOURCES = {"swissalti3d": swiss_mosaic, "vda-dtm": vda_mosaic, "copernicus-glo30": copernicus_mosaic}


# ---------------------------------------------------------------- merge
def smoothstep(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def merge_sources(mosaics, step=NEAR_STEP, coarse=8):
    """mosaics: [(name, grid)] highest priority first. Returns the merged grid (NaN only where no source has data)."""
    base = None
    for name, m in reversed(mosaics):
        valid = ~np.isnan(m)
        if not valid.any():
            continue
        if base is None:
            base = m.copy()
            continue
        both = valid & ~np.isnan(base)
        dist_in = ndimage.distance_transform_edt(valid) * step          # inside the higher source: distance to its edge
        band = both & (dist_in < OFFSET_BAND)
        if band.any():
            # difference higher - base, smoothed along the edge on a coarse grid (normalised convolution), then back to 5 m
            diff = np.where(band, m - base, 0.0).astype(np.float64)
            w = band.astype(np.float64)
            sl = (slice(None, None, coarse), slice(None, None, coarse))
            sig = OFFSET_SIGMA / (step * coarse)
            num = ndimage.gaussian_filter(ndimage.uniform_filter(diff, coarse)[sl], sig)
            den = ndimage.gaussian_filter(ndimage.uniform_filter(w, coarse)[sl], sig)
            med = float(np.median((m - base)[band]))
            off_c = np.where(den > 1e-4, num / np.maximum(den, 1e-9), med)
            off = ndimage.zoom(off_c, (m.shape[0] / off_c.shape[0], m.shape[1] / off_c.shape[1]), order=1)[:m.shape[0], :m.shape[1]]
            dist_out = ndimage.distance_transform_edt(~valid) * step
            fade = np.exp(-dist_out / OFFSET_FADE)
            log("merge %s over the base: overlap median %+.2f m, |offset| p95 %.1f m" % (name, med, float(np.percentile(np.abs(off[band]), 95))))
            base = base + (off * fade).astype(np.float32)
        wgt = smoothstep(dist_in / FEATHER).astype(np.float32)
        merged = np.where(valid, np.where(np.isnan(base), m, wgt * m + (1 - wgt) * base), base)
        base = merged.astype(np.float32)
    return base


def fetch_near_merged(rid, frame, srcs):
    e0, n_top, nx, nz = node_grid(frame)
    src_dir = work_dir(rid, "dem", "src")
    mosaics = []
    for name in srcs:
        path = os.path.join(src_dir, name + ".npy")
        if os.path.exists(path):
            grid = np.load(path)
        else:
            fn = SOURCES.get(name)
            if not fn:
                raise SystemExit("DEM source %s is not implemented for merged resorts" % name)
            grid = fn(frame, rid)
            if grid is None:
                continue                                   # unreachable: not cached, tried again next run
            np.save(path, grid)
        cover = float((~np.isnan(grid)).mean())
        log("source %s covers %.1f %% of the box" % (name, 100 * cover))
        if cover > 0:
            mosaics.append((name, grid))
        if not np.isnan(grid).any():
            break                                          # the lower ones would never show
    merged = merge_sources(mosaics)
    if merged is None or np.isnan(merged).any():
        raise SystemExit("merged DEM still has holes: add a fallback source")
    n = TILE_CELLS
    for tz in range(frame.tiles_z):
        for tx in range(frame.tiles_x):
            np.save(os.path.join(work_dir(rid, "dem"), "near_%d_%d.npy" % (tx, tz)), merged[tz * n:tz * n + n + 1, tx * n:tx * n + n + 1].copy())
    used = [name for name, _ in mosaics]
    with open(os.path.join(work_dir(rid, "dem"), "sources.json"), "w", encoding="utf-8") as fh:
        json.dump(used + [s for s in RESORTS[rid]["far"] if s not in used], fh)
    log("near tiles written from", used, "%.0f..%.0f m" % (float(merged.min()), float(merged.max())))
