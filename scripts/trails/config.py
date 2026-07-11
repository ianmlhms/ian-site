"""Category definitions for the trail-site pipeline (hiking + MTB).

Every pipeline script accepts `--cat <key>` (default: hiking) and reads its
paths, Overpass filter and tuning from here, so both sites share one code
path. Adding a third category (e.g. road cycling) = one new entry + UI
strings + composer banks.
"""
from __future__ import annotations

import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

CATEGORIES = {
    "hiking": {
        "key": "hiking",
        "data_dir": os.path.join(REPO, "data", "trails"),
        "out_dir": os.path.join(REPO, "trails"),
        "base_url": "https://ian.lu/trails",
        "sitemap_file": os.path.join(REPO, "sitemap-trails.xml"),
        # discovery
        "overpass_members": 'relation["route"="hiking"](area.lu);',
        "name_include": r"^auto[ -]?p[ée]destre\b",
        "name_strip": r"^auto[ -]?p[ée]destre\b",
        # planning / duration
        "komoot_sport": "hike",
        "speed_kmh": 4.0,
        "climb_m_per_h": 600,
        # auto difficulty: (easy_max_km, easy_max_gain, hard_min_km, hard_min_gain)
        "difficulty": (7, 120, 12, 400),
        "chooser_template": "chooser.html",
    },
    "mtb": {
        "key": "mtb",
        "data_dir": os.path.join(REPO, "data", "mtb"),
        "out_dir": os.path.join(REPO, "mtb"),
        "base_url": "https://ian.lu/mtb",
        "sitemap_file": os.path.join(REPO, "sitemap-mtb.xml"),
        "overpass_members": (
            'relation["route"="mtb"](area.lu);'
            'relation["route"="bicycle"]["bicycle:type"="mtb"](area.lu);'
        ),
        "name_include": r".",  # every named MTB relation
        "name_strip": r"^(?:mtb|mountainbike\s*/\s*vtt\s+tour\s+\d+[a-z]?|becher)\b[\s:]*",
        "komoot_sport": "mtb",
        "speed_kmh": 11.0,
        "climb_m_per_h": 500,
        "difficulty": (15, 250, 30, 800),
        "chooser_template": "chooser-mtb.html",
    },
}


def pick_category(argv: list) -> tuple:
    """Return (category dict, argv without the --cat flag)."""
    args = list(argv)
    key = "hiking"
    if "--cat" in args:
        i = args.index("--cat")
        try:
            key = args[i + 1]
        except IndexError:
            raise SystemExit("--cat needs a value: " + ", ".join(CATEGORIES))
        del args[i:i + 2]
    if key not in CATEGORIES:
        raise SystemExit(f"Unknown category '{key}'. Known: {', '.join(CATEGORIES)}")
    return CATEGORIES[key], args
