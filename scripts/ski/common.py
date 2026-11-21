#!/usr/bin/env python3
"""Shared settings of the Ski Alpen data pipeline (scripts/ski/): one RESORTS entry per resort, paths, the world frame, Overpass.

Every script takes the resort id as its first argument (default "killy"):

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/ski/fetch_osm.py killy
    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/ski/fetch_dem.py killy
    nice -n 10 ~/Library/Caches/luxtram-work/.venv/bin/python scripts/ski/bake.py killy

World frame of a resort: the resort's projected CRS (metres), origin = the north-west corner of its box,
x = east, z = south (z = north0 - northing), y = up (metres above sea level). One frame for render, physics and data.

Raw downloads are cached in $SKI_WORK (default ~/Library/Caches/ski-work/<resort>/); baked data goes to pb/ski/data/<resort>/.
Network rules: no email address in any request, User-Agent "ian-site-ski/1.0 (https://ian.lu)", polite pauses between requests.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
USER_AGENT = "ian-site-ski/1.0 (https://ian.lu)"
WORK_ROOT = os.environ.get("SKI_WORK", os.path.expanduser("~/Library/Caches/ski-work"))

OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

# ---------------------------------------------------------------------------------------------------------------
# Resorts. bbox = (south, west, north, east) in WGS84 around every piste and lift of the resort; the baked box is
# this bbox in the resort CRS, rounded out to whole height tiles. dem = ordered list of sources for the 5 m tiles
# (the first that has data at a node wins); far = source of the distant-mountains grid. Sources are implemented in
# fetch_dem.py. Only "killy" is baked in phase 1; the other entries are the plan for the next rounds (bbox checked
# against the resort maps roughly, DEM sources named, nothing downloaded yet).
# ---------------------------------------------------------------------------------------------------------------
RESORTS = {
    "killy": {
        "name": "Val d'Isère · Tignes",
        "short": "Espace Killy",
        "country": "FR",
        "crs": "EPSG:2154",                       # Lambert-93, the native CRS of IGN RGE ALTI
        "bbox": (45.395, 6.845, 45.515, 7.060),
        "dem": ["ign-rgealti"],
        "far": ["ign-rgealti", "copernicus-glo30"],
        "villages": [                              # name, lon, lat, radius m (buildings are kept within these circles)
            ("Val d'Isère", 6.9797, 45.4486, 1300), ("La Daille", 6.9600, 45.4680, 450), ("Le Fornet", 7.0150, 45.4370, 400),
            ("Tignes le Lac", 6.9070, 45.4690, 700), ("Val Claret", 6.9030, 45.4560, 550), ("Le Lavachet", 6.9180, 45.4730, 350),
            ("Tignes 1800", 6.9350, 45.4880, 450), ("Les Boisses", 6.9280, 45.4980, 350), ("Les Brévières", 6.9230, 45.5050, 400),
        ],
    },
    # --- planned (later rounds) ---
    "3vallees": {"name": "Les 3 Vallées", "short": "Courchevel · Méribel · Val Thorens", "country": "FR", "crs": "EPSG:2154",
                 "bbox": (45.260, 6.480, 45.430, 6.660), "dem": ["ign-rgealti"], "far": ["ign-rgealti", "copernicus-glo30"], "villages": []},
    # Kronplatz: the whole Kronplatz / Plan de Corones area from Reischach (Bruneck) and Olang to St. Vigil and the Piz de Plaies /
    # Piculin side, all inside South Tyrol, so the 5 m tiles come from the province's 2.5 m DTM (WCS, ETRS89 / UTM 32N = the frame).
    "kronplatz": {
        "name": "Kronplatz", "short": "Plan de Corones", "country": "IT", "crs": "EPSG:25832",
        "bbox": (46.668, 11.868, 46.803, 12.030),
        "dem": ["bz-dtm", "copernicus-glo30"], "far": ["copernicus-glo30"],
        "start": "Sylvester",
        "tree_line": 2250.0, "derived_forest": 2050.0,       # spruce / larch up to about 2100 m on the Kronplatz flanks, the summit dome bare
        "villages": [
            ("Reischach", 11.9530, 46.7880, 700), ("Olang", 12.0200, 46.7480, 900), ("St. Vigil", 11.9420, 46.6990, 800),
            ("Gassl", 12.0050, 46.7370, 300), ("Piculin", 11.9030, 46.6780, 400), ("Kronplatz", 11.9575, 46.7390, 260),
        ],
        "landmarks": [
            # kind, name, lon, lat (+ kind options); placed on the terrain by the bake, drawn by pb/ski/landmarks.js
            {"kind": "bell", "name": "Concordia 2000", "lon": 11.95827, "lat": 46.73876},          # OSM man_made=tower, 21.8 m
            {"kind": "mmm", "name": "Messner Mountain Museum Corones", "lon": 11.95440, "lat": 46.73731, "face": 215, "clear": 30},  # OSM footprint; glass towards the Dolomites
        ],
    },
    "zermatt": {"name": "Zermatt · Cervinia", "short": "Matterhorn", "country": "CH", "crs": "EPSG:2056",
                "bbox": (45.900, 7.580, 46.040, 7.800), "dem": ["swissalti3d", "vda-dtm", "copernicus-glo30"], "far": ["copernicus-glo30"], "villages": []},
    # Ski Arlberg: St. Anton, St. Christoph, Stuben and Rendl, plus Zürs and Lech over the Flexen pass (Flexenbahn). Warth-Schröcken and
    # Sonnenkopf stay out (data budget). ETRS89 / UTM 32N frame (not MGI Lambert: no datum shift between the DEM, OSM and the frame).
    "arlberg": {
        "name": "St. Anton · Arlberg", "short": "Ski Arlberg", "country": "AT", "crs": "EPSG:25832",
        "bbox": (47.095, 10.088, 47.232, 10.312),
        "dem": ["at-dgm", "copernicus-glo30"], "far": ["copernicus-glo30"],
        "start": "Kandahar-Kapall",
        "near_keep": 350.0,                                  # 5 m tiles only this close to pistes, lifts, houses (10 MB budget)
        "tree_line": 2000.0, "derived_forest": 1850.0,       # north side of the Alps: the forest ends near 1900 m (St. Anton 1300 m, St. Christoph 1800 m bare)
        "villages": [
            ("St. Anton", 10.2660, 47.1290, 1300), ("Nasserein", 10.2860, 47.1340, 500), ("St. Jakob", 10.2990, 47.1390, 450),
            ("St. Christoph", 10.1960, 47.1310, 450), ("Stuben", 10.1580, 47.1360, 400), ("Alpe Rauz", 10.1790, 47.1370, 250),
            ("Zürs", 10.1680, 47.1700, 650), ("Lech", 10.1420, 47.2080, 1100), ("Oberlech", 10.1270, 47.2000, 450),
            ("Zug", 10.1280, 47.2200, 350),
        ],
        "landmarks": [
            # spots from the OSM buildings / roads: Vallugabahn II top station, Galzigbahn top station, the B197 at the Hospiz, the
            # Christophorus chapel next to the Hospiz
            {"kind": "summit-station", "name": "Valluga 2811 m", "lon": 10.21330, "lat": 47.15770, "antenna": True, "face": 150},
            {"kind": "summit-station", "name": "Galzig", "lon": 10.23089, "lat": 47.13082, "big": True, "face": 130, "clear": 22},
            {"kind": "pass", "name": "Arlbergpass 1793 m", "lon": 10.21345, "lat": 47.12768, "face": 135},
            {"kind": "chapel", "name": "St. Christoph", "lon": 10.21329, "lat": 47.12738},
            # the World Cup course: OSM has it as two pistes (Kapall start -> Galzig); nets on both, the start house on the first
            {"kind": "worldcup", "name": "Kandahar", "piste": "Kandahar-Kapall"},
            {"kind": "worldcup", "name": "Kandahar", "piste": "Kandahar-Galzig", "house": False},
        ],
    },
}

# Height tiles: TILE_CELLS cells of NEAR_STEP metres (the files hold TILE_CELLS + 1 nodes per side, neighbours share their edge).
NEAR_STEP = 5.0
TILE_CELLS = 256                       # 1280 m tiles
TILE_SIZE = NEAR_STEP * TILE_CELLS
FAR_STEP = 40.0                        # distant-mountains grid
FAR_MARGIN = 14000.0                   # the far grid reaches this far beyond the box on every side
CLASS_STEP = 10.0                      # land-cover raster (forest, rock, water, built-up)
NEAR_KEEP = 700.0                      # a height tile is shipped when it lies within this distance of a piste, a lift or a village


def resort_arg(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    rid = next((a for a in argv if not a.startswith("-")), "killy")
    if rid not in RESORTS:
        raise SystemExit("unknown resort %r (known: %s)" % (rid, ", ".join(RESORTS)))
    return rid


def work_dir(rid, *parts):
    path = os.path.join(WORK_ROOT, rid, *parts)
    os.makedirs(path if not os.path.splitext(path)[1] else os.path.dirname(path), exist_ok=True)
    return path


def out_dir(rid):
    path = os.path.join(REPO, "pb", "ski", "data", rid)
    os.makedirs(path, exist_ok=True)
    return path


class Frame:
    """lon/lat <-> world metres of one resort (see the module doc)."""

    def __init__(self, rid):
        from pyproj import Transformer
        cfg = RESORTS[rid]
        self.crs = cfg["crs"]
        self.fwd = Transformer.from_crs("EPSG:4326", self.crs, always_xy=True)
        self.inv = Transformer.from_crs(self.crs, "EPSG:4326", always_xy=True)
        s, w, n, e = cfg["bbox"]
        xs, ys = [], []
        for lon, lat in ((w, s), (e, s), (w, n), (e, n)):
            x, y = self.fwd.transform(lon, lat)
            xs.append(x)
            ys.append(y)
        # round out to whole tiles (and to the 40 m far step) so tile edges sit on round numbers
        self.east0 = TILE_SIZE * (min(xs) // TILE_SIZE)
        self.north0 = TILE_SIZE * -((-max(ys)) // TILE_SIZE)
        self.tiles_x = int(-((-(max(xs) - self.east0)) // TILE_SIZE))
        self.tiles_z = int(-((-(self.north0 - min(ys))) // TILE_SIZE))
        self.width = self.tiles_x * TILE_SIZE
        self.depth = self.tiles_z * TILE_SIZE

    def to_world(self, lon, lat):
        e, n = self.fwd.transform(lon, lat)
        return e - self.east0, self.north0 - n

    def to_world_many(self, lons, lats):
        e, n = self.fwd.transform(lons, lats)
        import numpy as np
        return np.asarray(e) - self.east0, self.north0 - np.asarray(n)

    def to_lonlat(self, x, z):
        return self.inv.transform(self.east0 + x, self.north0 - z)


def http_get(url, path=None, timeout=120, tries=4, pause=1.2):
    """GET with the project User-Agent, retries with back-off; cached at `path` when given."""
    if path and os.path.exists(path) and os.path.getsize(path) > 0:
        with open(path, "rb") as fh:
            return fh.read()
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read()
            if path:
                with open(path + ".part", "wb") as fh:
                    fh.write(body)
                os.replace(path + ".part", path)
            time.sleep(pause)
            return body
        except Exception as err:  # noqa: BLE001  (busy or rate limited: wait and try again)
            last = err
            print("  retry", url[:110], str(err)[:80], file=sys.stderr)
            time.sleep(4 * (attempt + 1))
    raise SystemExit("GET failed: %s: %s" % (url, last))


def overpass(rid, query, cache_name, tries=3):
    """POST an Overpass query, cache the JSON under $SKI_WORK/<resort>/osm/<cache_name>.json, rotate through mirrors."""
    path = os.path.join(work_dir(rid, "osm"), cache_name + ".json")
    if os.path.exists(path) and os.path.getsize(path) > 50:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    body = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for attempt in range(tries):
        for url in OVERPASS_MIRRORS:
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=300) as resp:
                    data = json.load(resp)
                with open(path, "w", encoding="utf-8") as fh:
                    json.dump(data, fh)
                print("overpass ok", cache_name, url, len(data.get("elements", [])), "elements")
                return data
            except Exception as err:  # noqa: BLE001  (a mirror may be down, busy or rate limited: try the next one)
                last = err
                print("  overpass retry", cache_name, url, str(err)[:90], file=sys.stderr)
        time.sleep(10 * (attempt + 1))
    raise SystemExit("All Overpass mirrors failed for %s: %s" % (cache_name, last))
