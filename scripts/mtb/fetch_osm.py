#!/usr/bin/env python3
"""Download the OpenStreetMap vectors of the MTB world (cached, two tiles: the original north tile and the south strip): trail network, landuse/water, buildings, landmarks.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/mtb/fetch_osm.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OSM_TILES, overpass  # noqa: E402

def queries(box):
    BOX = "%s,%s,%s,%s" % box
    return {
        # every way a bike or a hiker could use: paths, tracks, small roads (geometry inline; tags: highway, surface, tracktype, mtb:scale, bicycle, ...)
        "ways": '[out:json][timeout:200];(way["highway"~"^(path|track|footway|cycleway|bridleway|steps|service|unclassified|residential|tertiary|secondary|living_street|pedestrian)$"](%s););out geom tags;' % BOX,
        # area features that paint the ground: forest, meadow, farmland, water, rock, scree, cliffs
        "areas": '[out:json][timeout:200];(way["landuse"~"^(forest|meadow|farmland|orchard|vineyard|grass|residential|retail|industrial|quarry|cemetery|recreation_ground|allotments)$"](%s);way["natural"~"^(wood|water|scrub|grassland|bare_rock|scree|cliff|heath|wetland|sand)$"](%s);way["leisure"~"^(park|pitch|golf_course|garden|playground)$"](%s);relation["landuse"~"^(forest|meadow|farmland)$"](%s);relation["natural"~"^(wood|water)$"](%s););out geom tags;' % ((BOX,) * 5),
        "waterways": '[out:json][timeout:120];(way["waterway"~"^(river|stream|brook|canal|ditch)$"](%s);node["waterway"="waterfall"](%s););out geom tags;' % (BOX, BOX),
        "buildings": '[out:json][timeout:200];(way["building"](%s););out geom tags;' % BOX,
        "poi": '[out:json][timeout:120];(node["tourism"~"^(viewpoint|attraction|picnic_site|information)$"](%s);node["natural"~"^(peak|cave_entrance|rock|stone|spring)$"](%s);node["historic"](%s);node["amenity"~"^(parking|bicycle_parking|shelter|drinking_water|toilets)$"](%s);node["place"~"^(village|hamlet|town|locality)$"](%s);way["historic"="castle"](%s);way["natural"="cliff"](%s);node["waterway"="waterfall"](%s);way["waterway"="waterfall"](%s);node["name"~"Schiessent|Hohllay|Wolfsschlucht|Raiberhiel|Räuberhöhle|Goldfralay|Goldkaul|Perekop|Amphitheater"](%s););out center tags;' % ((BOX,) * 10),
        "routes": '[out:json][timeout:200];(relation["route"="mtb"](%s);relation["route"="bicycle"](%s););out geom tags;' % (BOX, BOX),
    }


if __name__ == "__main__":
    tiles = [a for a in sys.argv[1:] if a.startswith("_") or a == ""]
    names = [a for a in sys.argv[1:] if a not in tiles]
    for suffix, box in OSM_TILES.items():
        if tiles and suffix not in tiles:
            continue
        q = queries(box)
        for name in names or list(q):
            data = overpass(q[name], name + suffix)
            print(name + suffix, len(data["elements"]))
