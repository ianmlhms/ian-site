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
    # IC 16 Luxembourg - Brussels (OSM relation 3920818: Luxembourg, Arlon, Marbehan, Libramont, Rochefort-Jemelle, Marloie, Ciney, Namur, Gembloux, Ottignies, Bruxelles-Luxembourg, Schuman, Nord, Central, Midi);
    # Schuman / Nord / Central are underground stops of the north-south junction and are passed here (the line runs through the Brussels tunnel to Midi)
    "brussels": {
        "prefix": "B",
        "first_side": "right",
        "tiles": ["brussels"],
        "rail_class": True,
        "snap_gap": 8.0,                                      # dead ends within 8 m are joined (the Namur station throat has a 5.3 m mapping gap)
        "ardennes_between": ["Arlon", "Namur"],              # forest / farmland between these stops: the 'ardennes' biome
        "params": {"per_real": 0.06, "leg_min": 700.0, "leg_max": 3400.0},
        "fetch": {"pbfs": ["lux", "belgium"], "box": (4.28, 49.50, 6.20, 50.90), "corridor_m": 2600},
        "stops": [
            ("Luxembourg", "Lëtzebuerg", 3),
            ("Arlon", "Arlon", 2, (49.68042, 5.80953)),
            ("Marbehan", "Marbehan", 1, (49.72742, 5.53939)),
            ("Libramont", "Libramont", 2, (49.92024, 5.37931)),
            ("Rochefort-Jemelle", "Jemelle", 1, (50.15998, 5.26716)),
            ("Marloie", "Marloie", 1, (50.20250, 5.31396)),
            ("Ciney", "Ciney", 1, (50.29138, 5.09145)),
            ("Namur", "Namur", 3, (50.46866, 4.86253)),
            ("Gembloux", "Gembloux", 1, (50.57018, 4.69111)),
            ("Ottignies", "Ottignies", 2, (50.67456, 4.56856)),
            ("Bruxelles-Luxembourg - Brussel-Luxemburg", "Bruxelles-Luxembourg", 2, (50.83820, 4.37365)),
            ("Bruxelles-Midi - Brussel-Zuid", "Bruxelles-Midi", 3, (50.83578, 4.33605)),
        ],
    },
    # TGV InOui 803B Luxembourg - Paris-Est (OSM 8536525 / 8536618): Thionville, Metz, Champagne-Ardenne TGV (Meuse TGV only some trains), LGV Est
    "paris": {
        "prefix": "P",
        "first_side": "right",
        "tiles": ["paris"],
        "rail_class": True,
        "highspeed_biome": True,                              # farmland / forest beside a line with maxspeed >= 200 -> 'highspeed' (the LGV look)
        "open_terminal_m": 800.0,                             # no tunnel within this real distance before the last stop: the terminal (Paris-Est) is an open hall; a 60 m bore 430 m before it became a whole 60 m game tunnel butting the hall
        "params": {"per_real": 0.05, "leg_min": 1500.0, "leg_max": 8500.0},
        "fetch": {"pbfs": ["lux", "lorraine", "champagne-ardenne", "picardie", "ile-de-france"], "box": (2.20, 48.80, 6.30, 49.65), "corridor_m": 2600},
        "stops": [
            ("Luxembourg", "Lëtzebuerg", 3),
            ("Thionville", "Thionville", 2),
            ("Metz", "Metz-Ville", 3),
            ("Champagne-Ardenne TGV", "Champagne-Ardenne TGV", 2, (49.2085, 3.9890)),
            ("Gare de l'Est", "Paris-Est", 3, (48.8767, 2.3592)),
        ],
    },
}
