"""Shared helpers for the Lux Drive data pipeline (scripts/luxdrive/*.py).

The world frame (one frame for ALL data, render and physics) is the same as the MTB game's:
    x = LUREF easting  - ORIGIN_E        (east, metres)
    z = ORIGIN_N_TOP   - LUREF northing  (south, metres; three.js: x east, y up, z south)
LUREF (EPSG:2169) is a Transverse-Mercator grid with scale ~1.0 here, so metres in the frame are
metres on the ground.

The numbers come from raw/world.json, which bake_area.py writes (the OSM commune boundaries
buffered by 300 m, cut into a 512 m block grid).

Geodata (c) ACT Luxembourg (LiDAR 2024, LOD2 3D building model, CC0),
(c) OpenStreetMap contributors (ODbL) for the vectors.
"""
import json
import math
import os

import numpy as np
from pyproj import Transformer

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
WORK = os.environ.get("LUXDRIVE_WORK", os.path.expanduser("~/Library/Caches/luxdrive-work"))
RAW_DIR = os.path.join(WORK, "raw")
OUT_DIR = os.path.join(REPO, "pb", "lux-drive", "data")
for _d in (RAW_DIR, OUT_DIR):
    os.makedirs(_d, exist_ok=True)

_world = json.load(open(os.path.join(RAW_DIR, "world.json"), encoding="utf-8"))
ORIGIN_E = _world["originE"]
ORIGIN_N_TOP = _world["originNTop"]
WORLD_W = _world["width"]
WORLD_H = _world["depth"]
BLOCK = _world["block"]
FAR_MARGIN = 8192.0

NEAR_STEP = 4.0          # m between nodes of terrain.bin (the MTB game uses 2 m; Lux Drive's
                          # world is nine times bigger, and the data budget is 30 MB)
FAR_STEP = 32.0          # m between nodes of far.bin
CANOPY_STEP = 16         # m between nodes of canopy.bin

_to_luref = Transformer.from_crs(4326, 2169, always_xy=True)
_to_wgs = Transformer.from_crs(2169, 4326, always_xy=True)


def lonlat_to_luref(lon, lat):
    """WGS84 -> LUREF (EPSG:2169), the metre grid the whole pipeline works in."""
    return _to_luref.transform(np.asarray(lon, dtype=float), np.asarray(lat, dtype=float))


def lonlat_to_world(lon, lat):
    e, n = lonlat_to_luref(lon, lat)
    return e - ORIGIN_E, ORIGIN_N_TOP - n


def world_to_luref(x, z):
    return ORIGIN_E + np.asarray(x, dtype=float), ORIGIN_N_TOP - np.asarray(z, dtype=float)


def luref_to_world(e, n):
    """LUREF (easting, northing) -> world (x east, z south)."""
    return np.asarray(e, dtype=float) - ORIGIN_E, ORIGIN_N_TOP - np.asarray(n, dtype=float)


def world_to_lonlat(x, z):
    e, n = world_to_luref(x, z)
    return _to_wgs.transform(e, n)


def sample_bicubic(grid, x, z):
    """Clamped Catmull-Rom sample of a regular grid - the Python twin of sampleBicubic() in
    pb/lux-drive/base-field.js.  The bake uses it so a building base sits exactly on the terrain
    the game draws."""
    nx, nz, data = grid
    gx = min(nx - 1.0000001, max(0.0, x))
    gz = min(nz - 1.0000001, max(0.0, z))
    i = int(math.floor(gx))
    j = int(math.floor(gz))
    tx = gx - i
    tz = gz - j
    t2x, t3x = tx * tx, tx * tx * tx
    t2z, t3z = tz * tz, tz * tz * tz
    wx = (-0.5 * t3x + t2x - 0.5 * tx, 1.5 * t3x - 2.5 * t2x + 1,
          -1.5 * t3x + 2 * t2x + 0.5 * tx, 0.5 * t3x - 0.5 * t2x)
    wz = (-0.5 * t3z + t2z - 0.5 * tz, 1.5 * t3z - 2.5 * t2z + 1,
          -1.5 * t3z + 2 * t2z + 0.5 * tz, 0.5 * t3z - 0.5 * t2z)
    x0 = max(0, i - 1); x1 = i; x2 = i + 1; x3 = min(nx - 1, i + 2)
    z0 = max(0, j - 1); z1 = j; z2 = j + 1; z3 = min(nz - 1, j + 2)
    total = 0.0
    for r, zr in enumerate((z0, z1, z2, z3)):
        o = zr * nx
        total += wz[r] * (wx[0] * data[o + x0] + wx[1] * data[o + x1]
                          + wx[2] * data[o + x2] + wx[3] * data[o + x3])
    a = data[z1 * nx + x1]; b = data[z1 * nx + x2]
    c = data[z2 * nx + x1]; d = data[z2 * nx + x2]
    lo = min(a, b, c, d); hi = max(a, b, c, d)
    return min(max(total, lo), hi)


def checksum(data):
    """The same order-sensitive checksum as gridChecksum() in pb/lux-drive/codec.js: it proves
    that the browser decoded the grid exactly as the bake wrote it."""
    v = np.rint(np.asarray(data, dtype=np.float64).ravel() * 64).astype(np.int64)
    a = 0
    b = 0
    for start in range(0, v.size, 1 << 16):
        for x in v[start:start + (1 << 16)].tolist():
            a = (a + x) % 1000003
            b = (b + a) % 1000033
    return a * 1000033 + b
