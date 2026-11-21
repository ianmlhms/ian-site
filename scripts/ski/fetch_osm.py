#!/usr/bin/env python3
"""Download the OpenStreetMap vectors of one resort (cached in $SKI_WORK/<resort>/osm/):
pistes (piste:type=downhill ways + relations), aerialways (+ pylons), buildings, land cover, water, roads, peaks and places.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/ski/fetch_osm.py killy [layer ...]

© OpenStreetMap contributors, ODbL 1.0 (credited in the game).
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import RESORTS, overpass, resort_arg  # noqa: E402


def queries(bbox, margin=0.03):
    s, w, n, e = bbox
    box = "%.4f,%.4f,%.4f,%.4f" % (s, w, n, e)
    wide = "%.4f,%.4f,%.4f,%.4f" % (s - margin, w - margin, n + margin, e + margin)
    return {
        "pistes": '[out:json][timeout:240];(way["piste:type"="downhill"](%s);relation["piste:type"="downhill"](%s););out geom tags;' % (box, box),
        "lifts": '[out:json][timeout:240];(way["aerialway"](%s);node["aerialway"~"^(pylon|station)$"](%s););out geom tags;' % (box, box),
        "buildings": '[out:json][timeout:240];(way["building"](%s);relation["building"](%s););out geom tags;' % (box, box),
        "areas": '[out:json][timeout:240];(way["landuse"~"^(forest|residential|meadow|grass|commercial|retail|construction|reservoir|basin)$"](%s);'
                 'way["natural"~"^(wood|water|bare_rock|scree|glacier|cliff|scrub|heath|grassland|shingle|rock)$"](%s);'
                 'relation["natural"~"^(wood|water|bare_rock|scree|glacier)$"](%s);relation["landuse"~"^(forest|reservoir)$"](%s);'
                 'way["waterway"="riverbank"](%s););out geom tags;' % ((wide,) * 5),
        "water": '[out:json][timeout:240];(way["waterway"~"^(river|stream)$"](%s););out geom tags;' % wide,
        "roads": '[out:json][timeout:240];(way["highway"~"^(primary|secondary|tertiary|unclassified|residential|service|living_street|pedestrian|track)$"](%s););out geom tags;' % box,
        "poi": '[out:json][timeout:240];(node["natural"~"^(peak|saddle|glacier)$"](%s);node["place"~"^(village|hamlet|town|locality|isolated_dwelling|suburb|neighbourhood)$"](%s);'
               'node["mountain_pass"="yes"](%s);node["amenity"~"^(restaurant|cafe|bar)$"](%s););out center tags;' % (wide, wide, wide, box),
    }


if __name__ == "__main__":
    rid = resort_arg()
    names = [a for a in sys.argv[2:] if not a.startswith("-")]
    q = queries(RESORTS[rid]["bbox"])
    for name in names or list(q):
        data = overpass(rid, q[name], name)
        print(name, len(data["elements"]))
        time.sleep(2)
