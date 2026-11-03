#!/usr/bin/env python3
"""Extract the OSM features of the Lux Drive area from the local Luxembourg extract.

    ~/Library/Caches/zuch-work/osm-venv/bin/python scripts/luxdrive/fetch_osm.py

The pbf is the whole country (47 MB); this reads it once and keeps only what the game needs
inside the play area (the buffered commune union, read from raw/area_luref.json):

    roads      highway=* that a car may drive on, with width / lanes / oneway / bridge / tunnel / layer
    rail       railway=tram (the Luxtram) and railway=rail
    water      waterway=* and the water polygons
    classes    landuse / natural / leisure polygons (fields, forest, park, grass, ...)
    buildings  building=* footprints (the LOD2 model is the primary source; OSM fills the gaps)
    places     place=* (names of the districts, to signpost them)

Writes ~/Library/Caches/luxdrive-work/raw/osm.json (raw, never in the repo).
"""
import json
import os
import sys

import osmium

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.get("LUXDRIVE_WORK", os.path.expanduser("~/Library/Caches/luxdrive-work"))
RAW = os.path.join(WORK, "raw")
os.makedirs(RAW, exist_ok=True)

PBF = os.path.expanduser("~/Library/Caches/zuch-work/lux.osm.pbf")
MARGIN_DEG = 0.006                 # about 500 m of latitude

DRIVABLE = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
    "secondary", "secondary_link", "tertiary", "tertiary_link",
    "unclassified", "residential", "living_street", "pedestrian", "road",
    "service", "track", "busway",
}
WALKABLE = {"footway", "path", "cycleway", "bridleway", "steps"}
TRACK = {"track", "service", "bridleway"}
RAIL = {"tram", "light_rail", "rail", "subway", "narrow_gauge", "monorail", "funicular"}

KEEP = (
    "name", "name:lb", "name:de", "name:fr", "name:en", "official_name", "int_name", "short_name",
    "highway", "lanes", "oneway", "junction", "width", "surface", "layer", "bridge", "tunnel",
    "railway", "public_transport", "route", "natural", "waterway", "landuse", "leisure", "amenity",
    "building", "building:levels", "building:material", "man_made", "barrier", "tourism", "historic",
    "place", "operator", "brand", "shelter", "description", "area:highway", "alt_name",
    "network", "electrified", "traffic_calming", "surface:colour", "lit", "sidewalk",
    "cycleway", "shoulder", "maxspeed", "maxheight", "maxweight", "access", "colour", "height",
    "roof:shape", "roof:material", "roof:colour", "building:colour",
    "starting_date", "ref", "official_ref", "wikipedia", "website", "opening_hours",
    "ford", "crossing", "gate", "turn:lanes", "hgv", "hazmat", "seamark:type", "source",
)


def pick(taglist):
    out = {}
    for k in KEEP:
        v = taglist.get(k)
        if v is not None:
            out[k] = v
    return out


def interesting(tags):
    """Does this way/relation matter for the game?"""
    if "highway" in tags or "railway" in tags or "waterway" in tags:
        return True
    if "building" in tags and tags["building"] not in ("no", "roof"):
        return True
    for k in ("landuse", "natural", "leisure", "place", "man_made", "amenity"):
        if k in tags:
            return True
    return False


def main():
    area = json.load(open(os.path.join(RAW, "area_luref.json"), encoding="utf-8"))
    lon0, lat0, lon1, lat1 = area["lonlat"]
    lon0 -= MARGIN_DEG; lat0 -= MARGIN_DEG; lon1 += MARGIN_DEG; lat1 += MARGIN_DEG
    print("bbox lon %.5f..%.5f lat %.5f..%.5f" % (lon0, lon1, lat0, lat1))

    nodes = {}
    pois = []

    class NodeHandler(osmium.SimpleHandler):
        def node(self, n):
            loc = n.location
            if not loc.valid():
                return
            lon, lat = loc.lon, loc.lat
            if not (lon0 <= lon <= lon1 and lat0 <= lat <= lat1):
                return
            nodes[n.id] = (lon, lat)
            if n.tags:
                t = pick(n.tags)
                if t:
                    pois.append({"id": n.id, "lon": lon, "lat": lat, "t": t})

    NodeHandler().apply_file(PBF, locations=True)
    print("nodes in bbox:", len(nodes))

    ways = []

    class WayHandler(osmium.SimpleHandler):
        def way(self, w):
            if not w.tags:
                return
            tags = pick(w.tags)
            if not interesting(tags):
                return
            refs = [n.ref for n in w.nodes]
            if not any(r in nodes for r in refs):
                return
            ways.append({"id": w.id, "n": refs, "t": tags})

    WayHandler().apply_file(PBF, locations=False)
    print("ways:", len(ways))

    rels = []

    class RelHandler(osmium.SimpleHandler):
        def relation(self, r):
            if not r.tags:
                return
            tags = pick(r.tags)
            if not interesting(tags):
                return
            members = []
            hit = False
            for m in r.members:
                members.append({"t": m.type, "r": m.ref, "role": m.role})
                if m.type == "w" and m.ref in way_ids:
                    hit = True
            if not hit and r.tags.get("type") not in ("multipolygon", "route", "boundary"):
                return
            rels.append({"id": r.id, "m": members, "t": tags})

    way_ids = set(w["id"] for w in ways)
    RelHandler().apply_file(PBF, locations=False)
    print("relations:", len(rels))

    out = {"bbox": [lon0, lat0, lon1, lat1],
           "nodes": {str(k): v for k, v in nodes.items()},
           "ways": ways, "rels": rels, "pois": pois}
    path = os.path.join(RAW, "osm.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print("wrote", path, os.path.getsize(path) // 1024, "kB")


if __name__ == "__main__":
    sys.exit(main())
