#!/usr/bin/env python3
"""Fetch the Luxembourg open geodata behind the Lokféierer Luxtram world (geoportail.lu / data.public.lu, CC0, (c) ACT Luxembourg).

Setup (once):   uv venv /Users/Ian/Library/Caches/luxtram-work/.venv
                uv pip install --python .../.venv/bin/python numpy rasterio pyogrio shapely pillow pyproj scipy lxml
Run:            .venv/bin/python scripts/fetch_luxtram_geo.py [ortho] [lidar] [lod2] [far]      (default: all; every step is cached on disk)

What it downloads (nothing is re-downloaded; heavy rasters live in $LUXTRAM_WORK/geo, outside OneDrive):
  ortho   orthophotos from the geoportail WMS (layer ortho_latest), one PNG per world tile, requested in EPSG:4326 so the pixel grid is exactly the
          local game frame (see luxtram_geo.py)  ->  geo/ortho/<i>_<j>.png
  lidar   the 50 cm LiDAR 2024 terrain (MNT/DTM) and surface (MNS/DSM) models.  They are cloud-optimised GeoTIFFs on data.public.lu, so only the
          windows along the line are read over HTTP range requests (raw float heights, no colour-ramp decoding)  ->  geo/h/<i>_<j>.npz (1 m grids)
  lod2    the national 3D buildings 2023 (LOD 2.2 CityGML, one zip per commune).  Only the .gml member of each commune zip is downloaded (range
          requests), cropped to the corridor and written as geo/lod2_<commune>.json   (extraction: build_luxtram_geo.py)
  far     coarse orthophoto + terrain for the horizon ring (+-1.4 km around the line)
"""
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import rasterio
from rasterio.windows import from_bounds
from scipy.ndimage import map_coordinates

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import luxtram_geo as G  # noqa: E402

WMS = "https://wms.geoportail.lu/opendata/service"
ORTHO_LAYER = os.environ.get("LUXTRAM_ORTHO", "ortho_latest")
UA = "ian.lu-luxtram-sim/1.0 (konto@ian.lu)"
COG_BASE = "https://download.data.public.lu/resources/bd-l-lidar2024-releve-3d-du-territoire-luxembourgeois/20241223-093912/"
COGS = {"dtm": COG_BASE + "MNT_Lidar2024.tif", "dsm": COG_BASE + "MNS_Lidar2024.tif"}


def http_get(url, tries=6):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            print("   retry", k, e)
            time.sleep(2 + 3 * k)
    raise RuntimeError("GET failed " + url[:120])


def wms_ortho(path, x0, z0, x1, z1, px, layer=None):
    if os.path.exists(path) and os.path.getsize(path) > 200:
        return False
    lon0, lat1 = G.local_to_lonlat(x0, z0)   # north-west corner (z grows south)
    lon1, lat0 = G.local_to_lonlat(x1, z1)
    q = urllib.parse.urlencode({
        "SERVICE": "WMS", "VERSION": "1.1.1", "REQUEST": "GetMap", "SRS": "EPSG:4326", "STYLES": "", "FORMAT": "image/png",
        "LAYERS": layer or ORTHO_LAYER, "BBOX": "%.9f,%.9f,%.9f,%.9f" % (lon0, lat0, lon1, lat1), "WIDTH": px, "HEIGHT": px,
    })
    data = http_get(WMS + "?" + q)
    if data[:4] != b"\x89PNG":
        raise RuntimeError("WMS did not return a PNG: " + data[:200].decode("latin1"))
    with open(path, "wb") as fh:
        fh.write(data)
    return True


def fetch_ortho(tiles):
    os.makedirs(os.path.join(G.RAW_GEO, "ortho"), exist_ok=True)

    def one(t):
        i, j, d, res = t
        n = G.tile_px(res)
        pad = res                      # one pixel of overlap on every side (seamless filtering)
        path = os.path.join(G.RAW_GEO, "ortho", "%d_%d.png" % (i, j))
        got = wms_ortho(path, i * G.TILE - pad, j * G.TILE - pad, (i + 1) * G.TILE + pad, (j + 1) * G.TILE + pad, n + 2)
        return got

    done = 0
    with ThreadPoolExecutor(max_workers=3) as ex:
        for got in ex.map(one, tiles):
            done += 1
            if done % 25 == 0:
                print("ortho", done, "/", len(tiles))


def sample_tile(ds, x0, z0, n, step, margin=3):
    """Bilinear samples of a COG at the nodes of a local grid ((n+1)^2 points, spacing `step`)."""
    xs = x0 + np.arange(n + 1) * step
    zs = z0 + np.arange(n + 1) * step
    X, Z = np.meshgrid(xs, zs)
    E, N = G.local_to_luref(X, Z)
    e0, e1, n0, n1 = E.min() - margin, E.max() + margin, N.min() - margin, N.max() + margin
    win = from_bounds(e0, n0, e1, n1, ds.transform).round_offsets().round_lengths()
    arr = ds.read(1, window=win, boundless=True, fill_value=-9999.0).astype(np.float32)
    t = ds.window_transform(win)
    col = (E - t.c) / t.a - 0.5
    row = (N - t.f) / t.e - 0.5
    bad = (arr <= -9000).astype(np.float32)
    arr2 = np.where(arr <= -9000, np.nan, arr)
    # fill nodata by nearest valid before interpolation
    if np.isnan(arr2).any():
        from scipy.ndimage import distance_transform_edt
        idx = distance_transform_edt(np.isnan(arr2), return_distances=False, return_indices=True)
        arr2 = arr2[tuple(idx)] if not np.isnan(arr2).all() else np.zeros_like(arr2)
    out = map_coordinates(arr2, [row, col], order=1, mode="nearest")
    return out.astype(np.float32), float(bad.mean())


def fetch_lidar(tiles):
    os.makedirs(os.path.join(G.RAW_GEO, "h"), exist_ok=True)
    env = rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", VSI_CACHE="TRUE",
                       VSI_CACHE_SIZE="268435456", GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="2")
    with env:
        dsets = {k: rasterio.open("/vsicurl/" + u) for k, u in COGS.items()}
        n = int(G.TILE)
        for c, (i, j, d, res) in enumerate(tiles):
            path = os.path.join(G.RAW_GEO, "h", "%d_%d.npz" % (i, j))
            if os.path.exists(path):
                continue
            out = {}
            for k, ds in dsets.items():
                out[k], bad = sample_tile(ds, i * G.TILE, j * G.TILE, n, 1.0)
            np.savez_compressed(path, dtm=out["dtm"].astype(np.float32), dsm=out["dsm"].astype(np.float32))
            if c % 20 == 0:
                print("lidar", c, "/", len(tiles), "dtm range", float(out["dtm"].min()), float(out["dtm"].max()))


def fetch_far(line):
    """Coarse ring around the line: orthophoto 2.5 m/px in 640 m tiles and a 16 m terrain grid (DTM)."""
    far_dir = os.path.join(G.RAW_GEO, "far")
    os.makedirs(far_dir, exist_ok=True)
    pts = G.densify(line, 40.0)
    FT = 640.0
    R = 1400.0
    i0 = int(np.floor((pts[:, 0].min() - R) / FT))
    i1 = int(np.floor((pts[:, 0].max() + R) / FT))
    j0 = int(np.floor((pts[:, 1].min() - R) / FT))
    j1 = int(np.floor((pts[:, 1].max() + R) / FT))
    tiles = []
    for i in range(i0, i1 + 1):
        for j in range(j0, j1 + 1):
            if G.rect_dist_to_points(pts, i * FT, j * FT, (i + 1) * FT, (j + 1) * FT) <= R:
                tiles.append((i, j))
    print("far tiles", len(tiles))
    env = rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", VSI_CACHE="TRUE")
    with env:
        dsets = {k: rasterio.open("/vsicurl/" + u) for k, u in COGS.items()}
        for c, (i, j) in enumerate(tiles):
            pad = 2.5
            wms_ortho(os.path.join(far_dir, "o_%d_%d.png" % (i, j)), i * FT - pad, j * FT - pad, (i + 1) * FT + pad, (j + 1) * FT + pad, int(FT / 2.5) + 2)
            hp = os.path.join(far_dir, "h_%d_%d.npz" % (i, j))
            if not os.path.exists(hp):
                nn = int(FT / 8)
                dtm, _ = sample_tile(dsets["dtm"], i * FT, j * FT, nn, 8.0, margin=12)
                dsm, _ = sample_tile(dsets["dsm"], i * FT, j * FT, nn, 8.0, margin=12)
                np.savez_compressed(hp, dtm=dtm, dsm=dsm)
            if c % 10 == 0:
                print("far", c, "/", len(tiles))


LOD2 = {
    "sandweiler": "https://download.data.public.lu/resources/base-de-donnees-nationale-des-batiments-3d-2023/20260325-120056/act2023v2-bati3d-sandweiler.zip",
    "luxembourg": "https://download.data.public.lu/resources/base-de-donnees-nationale-des-batiments-3d-2023/20260325-131430/act2023v2-bati3d-luxembourg.zip",
    "niederanven": "https://download.data.public.lu/resources/base-de-donnees-nationale-des-batiments-3d-2023/20260325-120357/act2023v2-bati3d-niederanven.zip",
    "hesperange": "https://download.data.public.lu/resources/base-de-donnees-nationale-des-batiments-3d-2023/20260325-121028/act2023v2-bati3d-hesperange.zip",
}


def fetch_lod2(communes):
    """Download just the CityGML member (deflate stream) of each commune zip: one ranged GET of the compressed bytes."""
    sys.path.insert(0, os.path.join(G.WORK, "tools"))
    import zipfile
    from httpzip import HttpFile
    os.makedirs(os.path.join(G.RAW_GEO, "lod2"), exist_ok=True)
    for name in communes:
        dst = os.path.join(G.RAW_GEO, "lod2", name + ".gml")
        if os.path.exists(dst):
            print("cached", dst)
            continue
        f = HttpFile(LOD2[name])
        z = zipfile.ZipFile(f)
        info = [i for i in z.infolist() if i.filename.lower().endswith(".gml")][0]
        print(name, info.filename, info.compress_size // 1048576, "MB compressed", info.file_size // 1048576, "MB xml")
        # local header length
        f.seek(info.header_offset)
        hdr = f.read(30)
        nlen = int.from_bytes(hdr[26:28], "little")
        elen = int.from_bytes(hdr[28:30], "little")
        start = info.header_offset + 30 + nlen + elen
        d = zlib.decompressobj(-15)
        pos = start
        end = start + info.compress_size
        CH = 8 << 20
        tmp = dst + ".part"
        with open(tmp, "wb") as out:
            while pos < end:
                blk = f._get(pos, min(end, pos + CH) - 1)
                out.write(d.decompress(blk))
                pos += len(blk)
                print("  ", (pos - start) * 100 // info.compress_size, "%", end="\r")
            out.write(d.flush())
        os.replace(tmp, dst)
        print("  wrote", dst, os.path.getsize(dst) // 1048576, "MB")


def main():
    steps = sys.argv[1:] or ["ortho", "lidar", "lod2", "far"]
    line = G.line_points()
    tiles = G.tile_list(line)
    print(len(tiles), "tiles")
    if "ortho" in steps:
        fetch_ortho(tiles)
    if "lidar" in steps:
        fetch_lidar(tiles)
    if "far" in steps:
        fetch_far(line)
    if "lod2" in steps:
        fetch_lod2(["luxembourg", "hesperange", "niederanven"])


if __name__ == "__main__":
    main()
