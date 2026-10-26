#!/usr/bin/env python3
"""W2c: the stop lists of the single-line routes (north, south, west, ...) for the real-line pipeline (build_real_route.py).

Every stop: (OSM station / halt name, game name, size 1..3[, hint (lat, lon) for names that exist twice]).  The stop lists come from the OSM public-transport
route relations (CFL-1 / CFL-50 / CFL-60 / CFL-70, the RE patterns) of the Geofabrik extracts of 25 Oct 2026, see pb/train-sim/REAL-LINES.md ("W2c: stop lists").
"""

ROUTES = {
    # line 10, RB: every stop between Luxembourg and Clervaux (the real line goes on to Troisvierges)
    "north": {
        "prefix": "N",
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
}
