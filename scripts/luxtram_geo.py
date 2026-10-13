"""Shared helpers for the Luxtram real-geodata pipeline (fetch_luxtram_geo.py / build_luxtram_geo.py).

Needs the venv  /Users/Ian/Library/Caches/luxtram-work/.venv  (numpy rasterio pyogrio shapely pillow pyproj scipy lxml; see README block in
fetch_luxtram_geo.py).  Geodata (c) ACT Luxembourg (geoportail.lu), CC0.

Frame: the same equirectangular local frame as build_luxtram.py / luxtram.js: x = east, z = south, metres, origin LAT0/LON0 (WGS84).
`local_to_luref` maps it exactly onto EPSG:2169 (LUREF / Luxembourg TM, where the LiDAR, LOD2 buildings and orthophoto live).
"""
import json
import math
import os

import numpy as np
from pyproj import Transformer

LAT0 = 49.6055
LON0 = 6.1640
M_LAT = 111194.93
M_LON = M_LAT * math.cos(math.radians(LAT0))

TRACK_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pb", "train-sim", "data", "luxtram-track.json")
WORK = os.environ.get("LUXTRAM_WORK", "/Users/Ian/Library/Caches/luxtram-work")
RAW_GEO = os.path.join(WORK, "geo")           # heavy rasters stay out of OneDrive
ONEDRIVE_RAW = "/Users/ian/Library/CloudStorage/OneDrive-Mulheims/website-overnight/reports/train-sim/luxtram-raw"

TILE = 128.0           # m, world tile edge (local frame, axis aligned)
R_NEAR = 75.0          # tiles closer than this to the line get the 0.33 m orthophoto
R_MID = 120.0          # ... 0.5 m up to here
R_OUT = 170.0          # ... 1 m up to here (tile rect distance to the line)

_to_luref = Transformer.from_crs(4326, 2169, always_xy=True)
_to_wgs = Transformer.from_crs(2169, 4326, always_xy=True)


def local_to_lonlat(x, z):
    return LON0 + np.asarray(x) / M_LON, LAT0 - np.asarray(z) / M_LAT


def lonlat_to_local(lon, lat):
    return (np.asarray(lon) - LON0) * M_LON, -(np.asarray(lat) - LAT0) * M_LAT


def local_to_luref(x, z):
    lon, lat = local_to_lonlat(x, z)
    return _to_luref.transform(lon, lat)


def luref_to_local(e, n):
    lon, lat = _to_wgs.transform(e, n)
    return lonlat_to_local(lon, lat)


def decode_flat(flat):
    pts = []
    x = z = 0
    for i in range(0, len(flat) - 1, 2):
        x += flat[i]
        z += flat[i + 1]
        pts.append((x / 10.0, z / 10.0))
    return pts


def line_points(ext_before=150.0, ext_after=150.0):
    """Line polyline in local metres (as shipped in luxtram-track.json), straight-extended at both ends."""
    pts = decode_flat(json.load(open(TRACK_JSON))["path"])
    a, b = pts[0], pts[min(3, len(pts) - 1)]
    d = math.hypot(a[0] - b[0], a[1] - b[1]) or 1.0
    head = (a[0] + (a[0] - b[0]) / d * ext_before, a[1] + (a[1] - b[1]) / d * ext_before)
    a, b = pts[-1], pts[max(0, len(pts) - 4)]
    d = math.hypot(a[0] - b[0], a[1] - b[1]) or 1.0
    tail = (a[0] + (a[0] - b[0]) / d * ext_after, a[1] + (a[1] - b[1]) / d * ext_after)
    return [head] + pts + [tail]


def densify(pts, step=8.0):
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / step))
        for k in range(1, n + 1):
            out.append((a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n))
    return np.array(out)


def rect_dist_to_points(pts, x0, z0, x1, z1):
    """min distance from a point cloud (N,2) to the rectangle."""
    dx = np.maximum(np.maximum(x0 - pts[:, 0], pts[:, 0] - x1), 0)
    dz = np.maximum(np.maximum(z0 - pts[:, 1], pts[:, 1] - z1), 0)
    return float(np.sqrt(dx * dx + dz * dz).min())


def tile_list(line=None):
    """[(i, j, dist, res_m_per_px)] for all world tiles of the corridor; tile (i, j) covers x in [i*TILE, (i+1)*TILE), z likewise."""
    pts = densify(line if line is not None else line_points(), 10.0)
    i0 = int(math.floor((pts[:, 0].min() - R_OUT) / TILE))
    i1 = int(math.floor((pts[:, 0].max() + R_OUT) / TILE))
    j0 = int(math.floor((pts[:, 1].min() - R_OUT) / TILE))
    j1 = int(math.floor((pts[:, 1].max() + R_OUT) / TILE))
    out = []
    for i in range(i0, i1 + 1):
        for j in range(j0, j1 + 1):
            d = rect_dist_to_points(pts, i * TILE, j * TILE, (i + 1) * TILE, (j + 1) * TILE)
            if d > R_OUT:
                continue
            res = 1.0 / 3.0 if d <= R_NEAR else (0.5 if d <= R_MID else 1.0)
            out.append((i, j, d, res))
    return out


def tile_px(res):
    return int(round(TILE / res))
