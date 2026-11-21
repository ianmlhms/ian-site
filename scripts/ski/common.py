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
        "villages": [                              # name, lon, lat, radius m [, "chalet": paint even big blocks as wood-and-stone chalets]
            ("Val d'Isère", 6.9797, 45.4486, 1300), ("La Daille", 6.9600, 45.4680, 450), ("Le Fornet", 7.0150, 45.4370, 400),
            ("Tignes le Lac", 6.9070, 45.4690, 700), ("Val Claret", 6.9030, 45.4560, 550), ("Le Lavachet", 6.9180, 45.4730, 350),
            ("Tignes 1800", 6.9350, 45.4880, 450), ("Les Boisses", 6.9280, 45.4980, 350), ("Les Brévières", 6.9230, 45.5050, 400),
        ],
    },
    # All three valleys: Courchevel / La Tania (east), Méribel / Brides (middle), Les Menuires / Val Thorens / Saint-Martin and the Orelle
    # side down to Plan Bouchet (west and south). Valmorel (west of 6.475), La Plagne / Champagny (north-east) and the Maurienne below
    # Orelle stay out. near_keep is tighter than Killy's and only the buildings of the villages below + those next to pistes / lifts are kept (twice the pistes of Killy in a ~10 MB budget).
    "3vallees": {"name": "Les 3 Vallées", "short": "Courchevel · Méribel · Val Thorens", "country": "FR", "crs": "EPSG:2154",
                 "bbox": (45.236, 6.475, 45.456, 6.690), "dem": ["ign-rgealti"], "far": ["ign-rgealti", "copernicus-glo30"],
                 "near_keep": 150.0, "buildings": "villages",
                 "start": "combe-de-la-saulire",            # the first piste on the map: Saulire -> Courchevel 1850
                 "villages": [
                     ("Courchevel 1850", 6.6345, 45.4150, 850, "chalet"), ("Courchevel Moriond", 6.6480, 45.4235, 450, "chalet"), ("Courchevel Village", 6.6310, 45.4300, 380, "chalet"),
                     ("Courchevel Le Praz", 6.6280, 45.4405, 380, "chalet"), ("La Tania", 6.5935, 45.4315, 380, "chalet"), ("Méribel", 6.5666, 45.3991, 900, "chalet"),
                     ("Méribel Mottaret", 6.5810, 45.3738, 480, "chalet"), ("Méribel Village", 6.5800, 45.4120, 300, "chalet"), ("Brides-les-Bains", 6.5680, 45.4530, 500),
                     ("Saint-Martin-de-Belleville", 6.5055, 45.3800, 450, "chalet"), ("Les Menuires", 6.5360, 45.3250, 950), ("Val Thorens", 6.5800, 45.2975, 700),
                 ]},
    "kronplatz": {"name": "Kronplatz", "short": "Plan de Corones", "country": "IT", "crs": "EPSG:25832",
                  "bbox": (46.700, 11.850, 46.790, 11.990), "dem": ["bz-dtm", "copernicus-glo30"], "far": ["copernicus-glo30"], "villages": []},
    # Matterhorn ski paradise: Zermatt (Sunnegga / Rothorn, Gornergrat / Stockhorn, Schwarzsee / Klein Matterhorn / Theodul glacier) and
    # Breuil-Cervinia + Valtournenche on the Italian side. The box crosses the border on the main ridge (Plateau Rosa / Theodulpass):
    # swissALTI3D north of it, the Aosta Valley lidar DTM south of it, merged with a feather (fetch_dem.py merge_sources).
    # "keep" = extra places whose 5 m tiles are always shipped (the Matterhorn itself lies 2-3 km from the nearest piste).
    "zermatt": {"name": "Zermatt · Cervinia", "short": "Matterhorn", "country": "CH", "crs": "EPSG:2056",
                "bbox": (45.862, 7.600, 46.040, 7.830), "dem": ["swissalti3d", "vda-dtm", "copernicus-glo30"], "far": ["copernicus-glo30"],
                "near_keep": 220.0,
                "keep": [("Matterhorn", 7.6586, 45.9763, 800)],
                "skip_ways": [1305881375],                 # OSM piste ways left out: "Grenzpiste (stillgelegt)", closed and ungroomed
                "start": "riffelalp",                      # the first piste on the map: Riffelberg -> Riffelalp, the Matterhorn ahead
                "villages": [
                    ("Zermatt", 7.7480, 46.0190, 1250, "chalet"), ("Furi", 7.7300, 46.0040, 260, "chalet"), ("Zum See", 7.7350, 46.0050, 160, "chalet"), ("Riffelalp", 7.7505, 46.0017, 220, "chalet"),
                    ("Riffelberg", 7.7543, 45.9930, 160), ("Gornergrat", 7.7830, 45.9834, 140), ("Findeln", 7.7640, 46.0115, 260, "chalet"), ("Sunnegga", 7.7698, 46.0174, 160),
                    ("Schwarzsee", 7.7090, 45.9915, 160), ("Trockener Steg", 7.7215, 45.9710, 160), ("Klein Matterhorn", 7.7295, 45.9385, 120),
                    ("Plateau Rosa", 7.7080, 45.9370, 180), ("Breuil-Cervinia", 7.6300, 45.9345, 900), ("Plan Maison", 7.6465, 45.9400, 200),
                    ("Valtournenche", 7.6235, 45.8775, 550), ("Salette", 7.6400, 45.8800, 200),
                ]},
    "arlberg": {"name": "St. Anton · Arlberg", "short": "Ski Arlberg", "country": "AT", "crs": "EPSG:31287",
                "bbox": (47.100, 10.060, 47.250, 10.320), "dem": ["at-dgm", "copernicus-glo30"], "far": ["copernicus-glo30"], "villages": []},
}

# Height tiles: TILE_CELLS cells of NEAR_STEP metres (the files hold TILE_CELLS + 1 nodes per side, neighbours share their edge).
NEAR_STEP = 5.0
TILE_CELLS = 256                       # 1280 m tiles
TILE_SIZE = NEAR_STEP * TILE_CELLS
FAR_STEP = 40.0                        # distant-mountains grid
FAR_MARGIN = 14000.0                   # the far grid reaches this far beyond the box on every side
CLASS_STEP = 10.0                      # land-cover raster (forest, rock, water, built-up)
NEAR_KEEP = 700.0                      # a height tile is shipped when it lies within this distance of a piste, a lift or a village
                                       # (a resort may set its own "near_keep"; "keep" lists extra (name, lon, lat, radius m) to ship)

# In-game credit line (Luxembourgish) of every DEM source; bake.py lists the ones a resort uses, then OSM.
SOURCE_CREDITS = {
    "ign-rgealti": "Gelänn: IGN RGE ALTI® 5 m (© IGN, Licence Ouverte / Etalab 2.0), iwwer de Géoplateforme",
    "swissalti3d": "Gelänn Schwäiz: swissALTI3D 2 m (© swisstopo, Open Government Data, fräi Notzung mat Quellenugab)",
    "vda-dtm": "Gelänn Italien: DTM 2005/2008 Lidar 2 m (© Regione Autonoma Valle d'Aosta, CC BY 4.0)",
    "copernicus-glo30": "Bierger an der Distanz: Copernicus DEM GLO-30 (© DLR e.V. 2010-2014 an © Airbus Defence and Space GmbH 2014-2018, ënnert COPERNICUS vun der EU an der ESA)",
}
OSM_CREDIT = "Pisten, Liften, Haiser, Bësch: © OpenStreetMap-Mataarbechter (ODbL 1.0)"


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
