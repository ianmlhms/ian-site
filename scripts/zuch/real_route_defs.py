#!/usr/bin/env python3
"""W2c: the stop lists of the single-line routes (north, south, west, ...) for the real-line pipeline (build_real_route.py).

Every stop: (OSM station / halt name, game name, size 1..3[, hint (lat, lon) for names that exist twice]).  The stop lists come from the OSM public-transport
route relations (CFL-1 / CFL-50 / CFL-60 / CFL-70, the RE patterns) of the Geofabrik extracts of 25 Oct 2026, see pb/train-sim/REAL-LINES.md ("W2c: stop lists").
"""

ROUTES = {
    # line 10, RB: every stop between Luxembourg and Clervaux (the real line goes on to Troisvierges)
    "north": {
        "prefix": "N",
        "first_side": "right",
        "tiles": ["north-a", "north-b"],
        "stops": [
            ("Luxembourg", "Lëtzebuerg", 3),
            ("Pfaffenthal-Kirchberg", "Pafendall-Kierchbierg", 1),
            ("Dommeldange", "Dummeldeng", 1),
            ("Walferdange", "Walfer", 1),
            ("Heisdorf", "Heisdref", 1),
            ("Lorentzweiler", "Lorentzweiler", 1),
            ("Lintgen", "Lëntgen", 1),
            ("Mersch", "Miersch", 2),
            ("Cruchten", "Kruchten", 1),
            ("Colmar-Berg", "Colmer-Bierg", 1),
            ("Schieren", "Schieren", 1),
            ("Ettelbruck", "Ettelbréck", 3),
            ("Michelau", "Michelau", 1),
            ("Goebelsmühle", "Giewelmillen", 1),
            ("Kautenbach", "Kautebaach", 1),
            ("Wilwerwiltz", "Wëlwerwolz", 1),
            ("Drauffelt", "Drauffelt", 1),
            ("Clervaux", "Clierf", 2),
        ],
        "ardennes_after": "Ettelbruck",       # forest / farmland windows beyond this stop get the 'ardennes' biome
    },
    # line 60, RB: Luxembourg - Bettembourg - Esch - Belval - Differdange - Pétange - Rodange, every stop
    "south": {
        "prefix": "S",
        "first_side": "right",
        "tiles": ["south"],
        "stops": [
            ("Luxembourg", "Lëtzebuerg", 3),
            ("Howald", "Houwald", 1),
            ("Berchem", "Berchem", 1),
            ("Bettembourg", "Bettembuerg", 2),
            ("Noertzange", "Noertzange", 1),
            ("Schifflange", "Schëffleng", 1),
            ("Esch-sur-Alzette", "Esch-Uelzecht", 3),
            ("Belval-Université", "Belval-Université", 2),
            ("Belval Lycée", "Belval-Lycée", 1),
            ("Belval-Rédange", "Belval-Rédange", 1),
            ("Belvaux-Soleuvre", "Belvaux-Soleuvre", 1),
            ("Oberkorn", "Uewerkuer", 1),
            ("Differdange", "Déifferdang", 2),
            ("Niederkorn", "Nidderkuer", 1),
            ("Pétange", "Péiteng", 2, (49.55438, 5.87922)),
            ("Lamadelaine", "Lamadelaine", 1),
            ("Rodange", "Rodange", 2),
        ],
    },
    # line 50: Luxembourg - Bertrange-Strassen - Mamer-Lycée - Mamer - Capellen - Kleinbettingen (the trains go on to Arlon)
    "west": {
        "prefix": "W",
        "first_side": "right",
        "tiles": ["west"],
        "stops": [
            ("Luxembourg", "Lëtzebuerg", 3),
            ("Bertrange-Strassen", "Bertrange-Strassen", 1),
            ("Mamer Lycée", "Mamer-Lycée", 1),
            ("Mamer", "Mamer", 2),
            ("Capellen", "Capellen", 1),
            ("Kleinbettingen", "Kleinbettingen", 2),
        ],
    },
    # TER C40+ Luxembourg - Metz - Nancy (OSM relation 1061467: Luxembourg, Howald, Bettembourg, Hettange-Grande, Thionville, Uckange, Hagondange, Walygator Parc, Metz, Pagny-sur-Moselle, Pont-à-Mousson, Nancy)
    "metz": {
        "prefix": "M",
        "rail_class": True,                   # landuse=railway -> bare ballast ground (class "rail"), not fields
        "first_side": "right",
        "tiles": ["metz"],
        "params": {"per_real": 0.15, "leg_min": 600.0, "leg_max": 2800.0},          # game metres per real metre, clamped: the old authored game length (about 11 km for 150 km real) with more stops
        "fetch": {"pbfs": ["lux", "lorraine"], "box": (5.95, 48.60, 6.40, 49.65), "corridor_m": 2600},   # stage 1 (rails + stations) in this lon / lat box, stage 2 (the rest) within corridor_m of the path
        "stops": [
            ("Luxembourg", "Lëtzebuerg", 3),
            ("Howald", "Houwald", 1),
            ("Bettembourg", "Bettembuerg", 2),
            ("Hettange-Grande", "Hettange-Grande", 1),
            ("Thionville", "Thionville", 2),
            ("Uckange", "Uckange", 1),
            ("Hagondange", "Hagondange", 1, (49.25383, 6.16417)),
            ("Walygator Parc", "Walygator Parc", 1),
            ("Metz", "Metz-Ville", 3),
            ("Pagny-sur-Moselle", "Pagny-sur-Moselle", 1, (48.98548, 6.02546)),
            ("Pont-à-Mousson", "Pont-à-Mousson", 1),
            ("Nancy", "Nancy-Ville", 3),
        ],
    },
}
