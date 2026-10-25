"""Shared helpers for the MTB Mëllerdall data pipeline (scripts/mtb/*.py).

Setup (once):  reuse the Luxtram venv  /Users/Ian/Library/Caches/luxtram-work/.venv
               (numpy rasterio shapely pillow pyproj scipy; see scripts/fetch_luxtram_geo.py)
Run order:     fetch_osm.py  ->  fetch_lidar.py  ->  bake_world.py   (every step caches its raw download under $MTB_WORK, outside the repo)

World frame (one frame for ALL data, render and physics):
    x = LUREF easting  - ORIGIN_E        (east, metres)
    z = ORIGIN_N_TOP   - LUREF northing  (south, metres; three.js: x east, y up, z south)
LUREF (EPSG:2169) is a Transverse-Mercator grid with scale ~1.0 here, so metres in the frame are metres on the ground.
Geodata (c) ACT Luxembourg (LiDAR 2024, CC0), (c) OpenStreetMap contributors (ODbL) for the vectors.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
from pyproj import Transformer

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
WORK = os.environ.get("MTB_WORK", os.path.expanduser("~/Library/Caches/mtb-work"))
OSM_DIR = os.path.join(WORK, "osm")
RAW_DIR = os.path.join(WORK, "raw")
OUT_DIR = os.path.join(REPO, "pb", "mtb", "data")
for _d in (OSM_DIR, RAW_DIR, OUT_DIR):
    os.makedirs(_d, exist_ok=True)

# ---- the world: a block grid of 512 m blocks (12 x 9 = 6.14 x 4.61 km) --------------------------------------------------
BLOCK = 512.0
BLOCKS_X = 12
BLOCKS_Z = 9
WORLD_W = BLOCK * BLOCKS_X       # 6144 m
WORLD_H = BLOCK * BLOCKS_Z       # 4608 m
ORIGIN_E = 87000.0               # LUREF easting of x = 0   (west edge): Schiessentümpel at x 376, Berdorf at x 5340, Hohllay at x 5943
ORIGIN_N_TOP = 100608.0          # LUREF northing of z = 0  (north edge): Beaufort castle at z ~700, Müllerthal village at z ~3100
FAR_MARGIN = 8192.0              # the distant-hills field reaches this far beyond the playable box on every side


_to_luref = Transformer.from_crs(4326, 2169, always_xy=True)
_to_wgs = Transformer.from_crs(2169, 4326, always_xy=True)


WGS_BOX = None  # set below: south, west, north, east of the world plus a margin (OSM queries)


def lonlat_to_world(lon, lat):
    e, n = _to_luref.transform(np.asarray(lon, dtype=float), np.asarray(lat, dtype=float))
    return e - ORIGIN_E, ORIGIN_N_TOP - n


def world_to_luref(x, z):
    return ORIGIN_E + np.asarray(x, dtype=float), ORIGIN_N_TOP - np.asarray(z, dtype=float)


def world_to_lonlat(x, z):
    e, n = world_to_luref(x, z)
    return _to_wgs.transform(e, n)


OVERPASS_MIRRORS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
USER_AGENT = "ian.lu-mtb-game/1.0 (https://ian.lu; konto@ian.lu)"


def overpass(query, cache_name, tries=3):
    """POST an Overpass query, cache the JSON under $MTB_WORK/osm/<cache_name>.json, rotate through mirrors with back-off."""
    path = os.path.join(OSM_DIR, cache_name + ".json")
    if os.path.exists(path) and os.path.getsize(path) > 50:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    body = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for attempt in range(tries):
        for url in OVERPASS_MIRRORS:
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=240) as resp:
                    data = json.load(resp)
                with open(path, "w", encoding="utf-8") as fh:
                    json.dump(data, fh)
                print("overpass ok", cache_name, url, len(data.get("elements", [])), "elements")
                return data
            except Exception as err:  # noqa: BLE001  (a mirror may be down, busy or rate limited: try the next one)
                last = err
                print("  overpass retry", cache_name, url, str(err)[:90], file=sys.stderr)
        time.sleep(8 * (attempt + 1))
    raise SystemExit("All Overpass mirrors failed for %s: %s" % (cache_name, last))


def _wgs_box(margin=400.0):
    lons, lats = [], []
    for x, z in ((-margin, -margin), (WORLD_W + margin, -margin), (-margin, WORLD_H + margin), (WORLD_W + margin, WORLD_H + margin)):
        lo, la = world_to_lonlat(x, z)
        lons.append(lo)
        lats.append(la)
    return (round(min(lats), 4), round(min(lons), 4), round(max(lats), 4), round(max(lons), 4))


WGS_BOX = _wgs_box()
