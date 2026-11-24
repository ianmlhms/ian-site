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

OVERPASS_MIRRORS = [                 # (maps.mail.ru dropped: its certificate is self-signed)
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
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
        "bbox": (45.395, 6.845, 45.515, 7.075),
        "dem": ["ign-rgealti"],
        "far": ["ign-rgealti", "copernicus-glo30"],
        # the box grew east in the data round (Le Fornet / Pays Désert / Montet were cut at 7.060): own cache folder, old tiles reused
        "work": "killy-r5", "work_from": ("killy", 999680.0, 6499840.0),
        # launch fix (22 Nov 2026, Ian: "Face (Schwaarz)" tops out near 32 km/h): two short OSM ways named "Face" are LINKS onto the
        # Face de Bellevarde (OSM way 30721500: off Fontaine Froide, 276 m, 34 m drop, its middle 2-4 degrees; way 52876769: from the
        # Loyes Express link). As "Face (Schwaarz)" / "(Schwaarz 2)" they read as the famous steep run. Shown names by run id (the id,
        # so the board and its ski-v1.sql floor, stay the same); bake.py applies them after the colour suffix.
        "names": {"face-black": "Verbindung Fontaine Froide → Face de Bellevarde", "face-2": "Verbindung → Face de Bellevarde"},
        "villages": [                              # name, lon, lat, radius m [, "chalet": paint even big blocks as wood-and-stone chalets]
            ("Val d'Isère", 6.9797, 45.4486, 1300), ("La Daille", 6.9600, 45.4680, 450), ("Le Fornet", 7.0150, 45.4370, 400),
            ("Tignes le Lac", 6.9070, 45.4690, 700), ("Val Claret", 6.9030, 45.4560, 550), ("Le Lavachet", 6.9180, 45.4730, 350),
            ("Tignes 1800", 6.9350, 45.4880, 450), ("Les Boisses", 6.9280, 45.4980, 350), ("Les Brévières", 6.9230, 45.5050, 400),
        ],
        # winter drawdown of the reservoir (bake.py apply_drawdown): the ice lies `drop` m below the full level, the banks slope down to it
        # over `bank` m (EDF empties Lac du Chevril through the winter: the frozen lake sits deep between bare banks)
        "reservoirs": [{"name": "Lac du Chevril", "drop": 40.0, "bank": 65.0}],
        "landmarks": [
            # Barrage du Chevril / de Tignes (OSM way 30195773, 181 m, 1953): the arch along the middle of the OSM outline, convex towards
            # the lake (`toward`), Jean-Marie Pierret's painted giant (1989) on the downstream face; crest = the lake's full level + 4 m
            {"kind": "dam", "name": "Barrage du Chevril", "lon": 6.9315, "lat": 45.4949, "reservoir": "Lac du Chevril", "toward": [6.9360, 45.4900],
             "line": [[6.92966, 45.49530], [6.93035, 45.49495], [6.93100, 45.49481], [6.93160, 45.49483], [6.93210, 45.49497],
                      [6.93260, 45.49522], [6.93300, 45.49555], [6.93325, 45.49600], [6.93335, 45.49645]]},
        ],
    },
    # All three valleys: Courchevel / La Tania (east), Méribel / Brides (middle), Les Menuires / Val Thorens / Saint-Martin and the Orelle
    # side down to Plan Bouchet (west and south). Valmorel (west of 6.475), La Plagne / Champagny (north-east) and the Maurienne below
    # Orelle stay out. near_keep is tighter than Killy's and only the buildings of the villages below + those next to pistes / lifts are kept (twice the pistes of Killy in a ~10 MB budget).
    "3vallees": {"name": "Les 3 Vallées", "short": "Courchevel · Méribel · Val Thorens", "country": "FR", "crs": "EPSG:2154",
                 "bbox": (45.203, 6.475, 45.456, 6.690), "dem": ["ign-rgealti"], "far": ["ign-rgealti", "copernicus-glo30"],
                 "buildings": "villages",
                 # the box grew south in the data round (the Orelle gondola starts at 45.208): own cache folder, old tiles reused
                 "work": "3vallees-r5", "work_from": ("3vallees", 970240.0, 6490880.0),
                 "start": "combe-de-la-saulire",            # the first piste on the map: Saulire -> Courchevel 1850
                 "villages": [
                     ("Courchevel 1850", 6.6345, 45.4150, 850, "chalet"), ("Courchevel Moriond", 6.6480, 45.4235, 450, "chalet"), ("Courchevel Village", 6.6310, 45.4300, 380, "chalet"),
                     ("Courchevel Le Praz", 6.6280, 45.4405, 380, "chalet"), ("La Tania", 6.5935, 45.4315, 380, "chalet"), ("Méribel", 6.5666, 45.3991, 900, "chalet"),
                     ("Méribel Mottaret", 6.5810, 45.3738, 480, "chalet"), ("Méribel Village", 6.5800, 45.4120, 300, "chalet"), ("Brides-les-Bains", 6.5680, 45.4530, 500),
                     ("Saint-Martin-de-Belleville", 6.5055, 45.3800, 450, "chalet"), ("Les Menuires", 6.5360, 45.3250, 950), ("Val Thorens", 6.5800, 45.2975, 700),
                 ]},
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
            ("Gassl", 12.0050, 46.7370, 300), ("Piculin", 11.9030, 46.6780, 400), ("Kronplatz", 11.9575, 46.7390, 330, "modern"),
        ],
        "landmarks": [
            # kind, name, lon, lat (+ kind options); placed on the terrain by the bake, drawn by pb/ski/landmarks.js
            {"kind": "bell", "name": "Concordia 2000", "lon": 11.95827, "lat": 46.73876},          # OSM man_made=tower, 21.8 m
            {"kind": "mmm", "name": "Messner Mountain Museum Corones", "lon": 11.95440, "lat": 46.73731, "face": 215, "clear": 30},  # OSM footprint; glass towards the Dolomites
        ],
    },
    # Matterhorn ski paradise: Zermatt (Sunnegga / Rothorn, Gornergrat / Stockhorn, Schwarzsee / Klein Matterhorn / Theodul glacier) and
    # Breuil-Cervinia + Valtournenche on the Italian side. The box crosses the border on the main ridge (Plateau Rosa / Theodulpass):
    # swissALTI3D north of it, the Aosta Valley lidar DTM south of it, merged with a feather (fetch_dem.py merge_sources).
    # "keep" = extra places whose 5 m tiles are always shipped (the Matterhorn itself lies 2-3 km from the nearest piste).
    "zermatt": {"name": "Zermatt · Cervinia", "short": "Matterhorn", "country": "CH", "crs": "EPSG:2056",
                "bbox": (45.862, 7.600, 46.040, 7.830), "dem": ["swissalti3d", "vda-dtm", "copernicus-glo30"], "far": ["copernicus-glo30"],
                "keep": [("Matterhorn", 7.6586, 45.9763, 800)],
                # the Gornergrat Bahn (rack railway Zermatt -> Gornergrat, a ski lift too): its OSM ways carry no name, only usage=tourism
                # (the Matterhorn Gotthard Bahn up the valley is usage=branch)
                "railways": [{"match": {"railway": "narrow_gauge", "usage": "tourism"}, "name": "Gornergrat Bahn"}],
                # Monterosa Ski (Frachey / Lago Ciarcerio above Champoluc) reaches into the south-east corner of the box: not this resort
                "exclude": [("Monterosa Ski", 7.745, 45.852, 1800)],
                "skip_ways": [1305881375],                 # OSM piste ways left out: "Grenzpiste (stillgelegt)", closed and ungroomed
                "landmarks": [
                    # Matterhorn glacier paradise: the top station where the cable arrives (glass front towards the Matterhorn, NW) and the
                    # summit deck with its cross on the Klein Matterhorn (3883 m); the OSM box under the station goes ("clear")
                    {"kind": "summit-station", "name": "Matterhorn glacier paradise 3821 m", "lon": 7.72950, "lat": 45.93927, "glacier": True, "face": 307, "clear": 25},
                    {"kind": "summit-station", "name": "Klein Matterhorn 3883 m", "lon": 7.72989, "lat": 45.93836, "cross": True},
                ],
                "start": "riffelalp",                      # the first piste on the map: Riffelberg -> Riffelalp, the Matterhorn ahead
                "villages": [
                    ("Zermatt", 7.7480, 46.0190, 1250, "chalet"), ("Furi", 7.7300, 46.0040, 260, "chalet"), ("Zum See", 7.7350, 46.0050, 160, "chalet"), ("Riffelalp", 7.7505, 46.0017, 220, "chalet"),
                    ("Riffelberg", 7.7543, 45.9930, 160), ("Gornergrat", 7.7830, 45.9834, 140), ("Findeln", 7.7640, 46.0115, 260, "chalet"), ("Sunnegga", 7.7698, 46.0174, 160),
                    ("Schwarzsee", 7.7090, 45.9915, 160), ("Trockener Steg", 7.7215, 45.9710, 160, "modern"), ("Klein Matterhorn", 7.7295, 45.9385, 160, "modern"),
                    ("Plateau Rosa", 7.7080, 45.9370, 180), ("Breuil-Cervinia", 7.6300, 45.9345, 900), ("Plan Maison", 7.6465, 45.9400, 200),
                    ("Valtournenche", 7.6235, 45.8775, 550), ("Salette", 7.6400, 45.8800, 200),
                ]},
    # Ski Arlberg: St. Anton, St. Christoph, Stuben and Rendl, Zürs and Lech over the Flexen pass (Flexenbahn), Warth-Schröcken (Auenfeldjet
    # from Lech) and Sonnenkopf above Klösterle (its own lifts, a bus away). ETRS89 / UTM 32N frame (not MGI Lambert: no datum shift between
    # the DEM, OSM and the frame).
    "arlberg": {
        "name": "St. Anton · Arlberg", "short": "Ski Arlberg", "country": "AT", "crs": "EPSG:25832",
        "bbox": (47.080, 10.012, 47.278, 10.312),
        "dem": ["at-dgm", "copernicus-glo30"], "far": ["copernicus-glo30"],
        "start": "Kandahar",
        # the World Cup course is two OSM pistes: Kandahar-Kapall from the start, then "Fang" down to the finish in St. Anton (the
        # Kandahar-Galzig is a separate upper part that joins lower down; it stays a run of its own)
        "chains": [{"name": "Kandahar", "pistes": ["Kandahar-Kapall", "Fang"]}],
        # the box grew north-west in the data round (Warth-Schröcken, Sonnenkopf): own cache folder, old tiles reused under new indices
        "work": "arlberg-r5", "work_from": ("arlberg", 581120.0, 5232640.0),
        # R8d (Ian): Sonnenkopf (Klösterle) is on the Ski Arlberg pass: its own network 3.4 km from Stuben, kept by bake.py tidy_network
        # (reached by the ski bus: pb/ski/config.js BUS_AREAS discovers its valley station from the start)
        "keep_areas": ("Sonnenkopfbahn",),
        "tree_line": 2000.0, "derived_forest": 1850.0,       # north side of the Alps: the forest ends near 1900 m (St. Anton 1300 m, St. Christoph 1800 m bare)
        "villages": [
            ("St. Anton", 10.2660, 47.1290, 1300), ("Nasserein", 10.2860, 47.1340, 500), ("St. Jakob", 10.2990, 47.1390, 450),
            ("St. Christoph", 10.1960, 47.1310, 450), ("Stuben", 10.1580, 47.1360, 400), ("Alpe Rauz", 10.1790, 47.1370, 250),
            ("Zürs", 10.1680, 47.1700, 650), ("Lech", 10.1420, 47.2080, 1100), ("Oberlech", 10.1270, 47.2000, 450),
            ("Zug", 10.1280, 47.2200, 350),
            ("Warth", 10.1800, 47.2580, 500), ("Hochkrumbach", 10.1310, 47.2640, 250), ("Schröcken", 10.0930, 47.2575, 400),
            ("Klösterle", 10.0600, 47.1300, 450), ("Sonnenkopf", 10.0560, 47.1110, 160),
        ],
        "landmarks": [
            # spots from the OSM buildings / roads: Vallugabahn II top station, Galzigbahn top station, the B197 at the Hospiz, the
            # Christophorus chapel next to the Hospiz
            {"kind": "summit-station", "name": "Valluga 2811 m", "lon": 10.21330, "lat": 47.15770, "antenna": True, "face": 150, "clear": 14},
            {"kind": "summit-station", "name": "Galzig", "lon": 10.23089, "lat": 47.13082, "big": True, "face": 130, "clear": 22},
            {"kind": "pass", "name": "Arlbergpass 1793 m", "lon": 10.21345, "lat": 47.12768, "face": 135},
            {"kind": "chapel", "name": "St. Christoph", "lon": 10.21329, "lat": 47.12738},
            # the World Cup course (chained from its two OSM pistes): nets where it is steep, the start house at the top
            {"kind": "worldcup", "name": "Kandahar", "piste": "Kandahar"},
        ],
    },
    # Via Lattea (Vialattea): Sestriere / Borgata, Sauze d'Oulx, Sansicario, Cesana, Claviere (Piedmont, Italy) and Montgenèvre over the
    # border (Hautes-Alpes, France), one connected lift network. ETRS89 / UTM 32N frame; heights: the Piedmont regional DTM on the
    # Italian side, IGN RGE ALTI on the French side, merged without a seam (dem_merge.py), Copernicus GLO-30 only where neither has data.
    "vialattea": {
        "name": "Via Lattea", "short": "Sestriere · Sauze d'Oulx · Montgenèvre", "country": "IT", "crs": "EPSG:25832",
        "bbox": (44.890, 6.675, 45.045, 6.940),
        "dem": ["piemonte-dtm", "ign-rgealti", "copernicus-glo30"], "far": ["copernicus-glo30"],
        "buildings": "villages",                   # the valley towns (Oulx, Beaulard, Pragelato) would pull in tiles and houses
        "ign_east": 6.83,                          # IGN chunks only west of this (France ends at ~6.76 E here)
        # piste ids never given to a run: their ski_board_floors rows on production (applied 23 Nov 2026, additive inserts only) are
        # from an earlier bake with other lines (other floors), so a run that reused one would have its times dropped
        "reserved_ids": (
            "11-alta", "12-alta", "12-media", "13", "13-2", "25", "27-bassa", "29-bis", "3-bis", "76", "79-alta", "97",
            "verbindung-1", "verbindung-11-alta", "verbindung-25-boulevard", "verbindung-29-alta", "verbindung-3-2",
            "verbindung-3-red", "verbindung-32", "verbindung-32-32", "verbindung-68-alta", "verbindung-68-bassa",
            "verbindung-71-bis-79-bassa", "verbindung-76", "verbindung-76-2", "verbindung-79-alta", "verbindung-79-bassa",
            "verbindung-79-bassa-2", "verbindung-79-bassa-79-bassa", "verbindung-bimbo-alta", "verbindung-boulevard",
            "verbindung-boulevard-golf", "verbindung-kandahar-agnelli", "verbindung-kandahar-agnelli-", "verbindung-la-blu",
            "verbindung-la-blu-2", "verbindung-schlepplift-frait", "verbindung-schlepplift-orsie", "verbindung-schlepplift-orsie-2",
            "verbindung-schlepplift-rio-n", "verbindung-schlepplift-sises", "verbindung-sessellift-baby-s",
            "verbindung-sessellift-cit-ro", "verbindung-sessellift-cit-ro-2", "verbindung-sessellift-garnel",
            "verbindung-sessellift-garnel-2", "verbindung-sessellift-jouven", "verbindung-sessellift-nube-d",
            "verbindung-sessellift-rocce-", "verbindung-sessellift-trebia", "verbindung-standard", "verbindung-tsd4-ski-lodge-la",
            "verbindung-tsd4-ski-lodge-la-2", "verbindung-tsd4-ski-lodge-la-3", "verbindung-tsd4-ski-lodge-la-4",
            "verbindung-tsd4-soleil-boeuf", "verbindung-tsd4-soleil-boeuf-2",
        ),
        "ref_names": True,                         # 62 piste lines carry their number ("81 bassa", "72 alta") as ref, without a name
        # Bardonecchia (Melezet / Chesal / Colomion) reaches into the north-west corner of the box: another ski area, not Via Lattea
        "exclude": [("Bardonecchia", 6.6950, 45.0560, 3200)],
        "tree_line": 2350.0, "derived_forest": 1950.0,       # larch and pine to ~2300 m, but the Sestriere plateau (2035 m) is open pasture
        "villages": [
            ("Sestriere", 6.8787, 44.9575, 900), ("Borgata", 6.8936, 44.9717, 350), ("Grangesises", 6.8694, 44.9424, 250),
            ("Sauze di Cesana", 6.8590, 44.9405, 300), ("Champlas du Col", 6.8515, 44.9474, 250),
            ("Sauze d'Oulx", 6.8583, 45.0270, 800), ("Jouvenceaux", 6.8469, 45.0240, 350), ("Sportinia", 6.8675, 45.0056, 250),
            ("San Sicario", 6.8146, 44.9677, 500), ("San Sicario Borgo", 6.8059, 44.9583, 300), ("Cesana", 6.7943, 44.9524, 550),
            ("Claviere", 6.7503, 44.9388, 500), ("Montgenèvre", 6.7218, 44.9312, 850),
        ],
        # the Olympic downhill (2006) above Sestriere: OSM has its upper and lower part as separate pistes, "alta" meets "bassa" end to start
        "chains": [{"name": "Kandahar Nasi", "pistes": ["Kandahar Nasi alta", "Kandahar Nasi bassa"]}],
        "start": "Kandahar Nasi",
        "landmarks": [
            # Olympic downhill: the red race nets where it is steep and the start house (the names are the OSM ones)
            {"kind": "worldcup", "name": "Kandahar Nasi", "piste": "Kandahar Nasi"},
            # Col de Montgenèvre (1851 m): the road over the border, sign and flags
            {"kind": "pass", "name": "Col de Montgenèvre 1851 m", "lon": 6.72523, "lat": 44.93142, "face": 100},
        ],
        # the Sestriere towers (Torre Rossa: 13 storeys, the white tower: 17): the only really tall buildings, kept from OSM as they are
        "tall": [("Torri di Sestriere", 6.8780, 44.9560, 350)],
    },
    # Obertauern (Salzburg): the ski ring round the Radstädter Tauern pass (1740 m), the hotel village on the pass in the middle, lifts up
    # to Gamsleiten, Zehnerkar, Seekareck, Hundskogel, Grünwaldkopf, Plattenkar. Snow-sure bowl above the tree line. Austria: BEV 1 m DTM
    # as Arlberg; frame ETRS89 / UTM 33N (13.56 E lies in zone 33: grid north = true north within 1 degree).
    "obertauern": {
        "name": "Obertauern", "short": "Tauernrunde", "country": "AT", "crs": "EPSG:25833",
        "bbox": (47.222, 13.505, 47.275, 13.625),
        "dem": ["at-dgm", "copernicus-glo30"], "far": ["copernicus-glo30"],
        "tree_line": 1950.0, "derived_forest": 1800.0,       # the pass lies at 1740 m: larch / spruce only low down on the valley sides
        # the Zehnerkarbahn is one gondola in two sections (OSM: two ways, valley -> middle station 2053 m -> Zehnerkar 2194 m): shown names
        # by OSM way id (bake.py build_lifts), so the lift list does not show the same name twice
        "lift_names": {23040142: "Zehnerkarbahn I", 1528325487: "Zehnerkarbahn II"},
        "villages": [
            ("Obertauern", 13.5590, 47.2495, 950, "chalet"),
        ],
    },
    # Livigno (Lombardy, Italy; duty-free valley, Mottolino on the east side of the valley, Carosello 3000 on the west): its own area, not
    # linked to Bormio / Santa Caterina. Heights: Regione Lombardia DTM 5 m (ImageServer of cartografia.servizirl.it), Copernicus GLO-30
    # only where it has no data. Frame ETRS89 / UTM 32N.
    "livigno": {
        "name": "Livigno", "short": "Mottolino · Carosello 3000", "country": "IT", "crs": "EPSG:25832",
        "bbox": (46.490, 10.050, 46.562, 10.190),
        "dem": ["lombardia-dtm", "copernicus-glo30"], "far": ["copernicus-glo30"],
        "tree_line": 2200.0, "derived_forest": 2050.0,       # inner Alps, valley floor 1816 m: larch / arolla pine only on the shady lower slopes
        "buildings": "villages",
        "start": "Mottolino",                    # the long red from the Mottolino top station down into the village
        "lift_strip_numbers": True, "mixed_twins": True,
        "lift_names": {204017643: "San Rocco I", 204017644: "San Rocco II"},
        "names": {"pian-della-vlope-1": "Pian della Volpe 1", "pian-della-volpe-2": "Pian della Volpe 2", "femminile-alta": "Femminile Alta"},
        "villages": [
            ("Livigno", 10.1352, 46.5385, 750, "chalet"), ("Santa Maria", 10.1417, 46.5456, 450, "chalet"), ("Pemont", 10.1450, 46.5495, 400, "chalet"),
            ("San Rocco", 10.1268, 46.5245, 450, "chalet"), ("Borch", 10.1225, 46.5185, 380, "chalet"), ("Florin", 10.1205, 46.5110, 300, "chalet"),
            ("Teola", 10.1398, 46.5317, 300, "chalet"), ("Trepalle", 10.1759, 46.5266, 380, "chalet"), ("Eira", 10.1665, 46.5384, 250, "chalet"),
        ],
    },
    # Davos Klosters (Graubünden, Switzerland): Parsenn (Davos Dorf - Weissfluhjoch - Gotschna - Klosters, one connected network) plus
    # the separate areas Jakobshorn (Davos Platz), Rinerhorn (Glaris) and Madrisa (Klosters Dorf), each reached by the bus / train in
    # reality (config.js BUS_AREAS, bake.py keep_areas). Pischa (one mapped freeride line) and Gargellen (Austria) are not in. Heights
    # swissALTI3D 2 m (LV95), Copernicus GLO-30 where the Swiss tiles end (north of Madrisa).
    "davos": {
        "name": "Davos Klosters", "short": "Parsenn · Jakobshorn · Madrisa", "country": "CH", "crs": "EPSG:2056",
        "bbox": (46.715, 9.775, 46.940, 9.945),
        "dem": ["swissalti3d", "copernicus-glo30"], "far": ["copernicus-glo30"],
        "tree_line": 2150.0, "derived_forest": 2000.0,       # inner Graubünden: larch and arolla pine up to ~2100 m, Davos valley floor 1560 m
        "buildings": "villages",
        "exclude": [("Gargellen", 9.905, 46.960, 2400), ("Wakeboard-Lift Davos", 9.8470, 46.8157, 160)],       # Montafon (Austria) over the Madrisa ridge: its own area
        "keep_areas": ("Jakobshornbahn Sektion 1", "Rinerhornbahn", "Madrisabahn"),
        "funicular_by_ref": True,   # Parsennbahn E1 / E2 (Davos Dorf - Höhenweg - Weissfluhjoch) are two sections
        "thin_pylons": True,        # mapped pylons in clusters / next to stations (a carrier touched them)
        "ref_names": True,        # Rinerhorn / Madrisa pistes are mostly mapped with their number only
        "ref_zones": [("Rinerhorn", 9.800, 46.745, 3500), ("Madrisa", 9.870, 46.912, 3500)],
        "villages": [
            ("Davos Platz", 9.8225, 46.7945, 900, "chalet"), ("Davos Dorf", 9.8385, 46.8085, 800, "chalet"), ("Davos Wolfgang", 9.8536, 46.8337, 300, "chalet"),
            ("Davos Laret", 9.8702, 46.8417, 220, "chalet"), ("Davos Frauenkirch", 9.8004, 46.7690, 280, "chalet"), ("Clavadel", 9.8156, 46.7679, 200, "chalet"),
            ("Schatzalp", 9.8150, 46.8014, 220, "chalet"), ("Davos Glaris", 9.7775, 46.7417, 300, "chalet"),
            ("Klosters Platz", 9.8822, 46.8683, 650, "chalet"), ("Klosters Dorf", 9.8751, 46.8829, 450, "chalet"), ("Selfranga", 9.8850, 46.8609, 250, "chalet"),
            ("Serneus", 9.8388, 46.8897, 350, "chalet"), ("Saas", 9.8085, 46.9109, 300, "chalet"), ("Schlappin", 9.8997, 46.9108, 160, "chalet"),
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
                                       # (a resort may set its own "near_keep"; "keep" lists extra (name, lon, lat, radius m) to ship)

# In-game credit line (Luxembourgish) of every DEM source; bake.py lists the ones a resort uses, then OSM.
SOURCE_CREDITS = {
    "ign-rgealti": "Gelänn: IGN RGE ALTI® 5 m (© IGN, Licence Ouverte / Etalab 2.0), iwwer de Géoplateforme",
    "swissalti3d": "Gelänn Schwäiz: swissALTI3D 2 m (© swisstopo, Open Government Data, fräi Notzung mat Quellenugab)",
    "vda-dtm": "Gelänn Italien: DTM 2005/2008 Lidar 2 m (© Regione Autonoma Valle d'Aosta, CC BY 4.0)",
    "lombardia-dtm": "Gelänn Italien: DTM 5 m vun der Regione Lombardia (Open Data, Geoportale Lombardia, CC BY 4.0)",
    "piemonte-dtm": "Gelänn Italien: Ripresa aerea ICE 2009-2011 DTM 5 m, Lidar (© Regione Piemonte, CC BY 4.0)",
    "bz-dtm": "Gelänn: Digitaalt Terrainmodell 2,5 m vun der Autonomer Provënz Bozen - Südtirol (Open Data Südtirol, CC0 1.0)",
    "at-dgm": "Gelänn: ALS-DTM Éisträich 1 m (Datenquell: BEV - Bundesamt für Eich- und Vermessungswesen, aus de Laserscans vun de Bundesländer, CC BY 4.0)",
    "copernicus-glo30": "Bierger an der Distanz: Copernicus DEM GLO-30 (© DLR e.V. 2010-2014 an © Airbus Defence and Space GmbH 2014-2018, ënnert COPERNICUS vun der EU an der ESA)",
}
OSM_CREDIT = "Pisten, Liften, Haiser, Bësch: © OpenStreetMap-Mataarbechter (ODbL 1.0)"


def resort_arg(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    rid = next((a for a in argv if not a.startswith("-")), "killy")
    if rid not in RESORTS:
        raise SystemExit("unknown resort %r (known: %s)" % (rid, ", ".join(RESORTS)))
    return rid


def cache_name(rid):
    """The folder of a resort's raw downloads below $SKI_WORK: the resort id, or RESORTS[rid]["work"] when its box changed (a new box
    needs new height tiles; the old folder stays as it was for branches baked from it)."""
    return RESORTS[rid].get("work", rid)


def work_dir(rid, *parts):
    path = os.path.join(WORK_ROOT, cache_name(rid), *parts)
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


# OpenStreetMap downloads of the data round (Nov 2026: every piste, lift, ski route) live in $SKI_WORK/OSM_ROUND/<resort>/osm/; a layer
# not downloaded again is read from the older $SKI_WORK/<resort>/osm/ (osm_path).
OSM_ROUND = "data-round"


def osm_path(rid, layer, write=False):
    new = os.path.join(WORK_ROOT, OSM_ROUND, rid, "osm", layer + ".json")
    if write or os.path.exists(new):
        os.makedirs(os.path.dirname(new), exist_ok=True)
        return new
    return os.path.join(WORK_ROOT, rid, "osm", layer + ".json")


def overpass(rid, query, layer, tries=10):
    """POST an Overpass query, cache the JSON under $SKI_WORK/OSM_ROUND/<resort>/osm/<layer>.json, rotate through mirrors with
    back-off (Overpass is often overloaded: 429 / 502 / 504)."""
    path = osm_path(rid, layer, write=True)
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
                remark = str(data.get("remark", ""))
                if "error" in remark.lower():          # a timed-out / out-of-memory answer is incomplete: never cache it
                    raise RuntimeError("overpass remark: " + remark[:120])
                with open(path, "w", encoding="utf-8") as fh:
                    json.dump(data, fh)
                print("overpass ok", layer, url, len(data.get("elements", [])), "elements")
                return data
            except Exception as err:  # noqa: BLE001  (a mirror may be down, busy or rate limited: try the next one)
                last = err
                print("  overpass retry", layer, url, str(err)[:90], file=sys.stderr)
                time.sleep(5)
        wait = min(300, 20 * 2 ** attempt)                   # exponential back-off, at most 5 minutes between rounds
        print("  overpass: all mirrors busy, round %d/%d, waiting %d s" % (attempt + 1, tries, wait), file=sys.stderr)
        time.sleep(wait)
    raise SystemExit("All Overpass mirrors failed for %s: %s" % (layer, last))
