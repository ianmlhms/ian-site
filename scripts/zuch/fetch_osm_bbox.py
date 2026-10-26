#!/usr/bin/env python3
"""OSM data for the surroundings of a station abroad (no Geofabrik mirror reachable here: fetch straight from the official API).

    python3 scripts/zuch/fetch_osm_bbox.py <key> <lat> <lon> [--half-m 480]

Fetches https://api.openstreetmap.org/api/0.6/map?bbox=... (the OSM editing API: current, real data, no mirror), a box of `2*half_m` metres centred on
(lat, lon), caches the raw XML and a parsed JSON OUTSIDE the repo (ZUCH_ABROAD_WORK, default ~/zuch-work/abroad-osm/), and never re-fetches a cached key.
Parsed JSON: {"bbox":[...], "ways":[{"id","tags","nodes":[[lat,lon],...],"closed"}], "nodes":[{"id","lat","lon","tags"}]}  (relations are flattened: a
multipolygon's outer ways are chained end to end into one ring per relation; inner rings / holes are dropped, which only matters for a park or water body
that has an island here, which none of these ten stations have).
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

UA = "ian.lu-zuch-sim/1.0 (konto@ian.lu)"
API = "https://api.openstreetmap.org/api/0.6/map"
WORK = os.environ.get("ZUCH_ABROAD_WORK", os.path.expanduser("~/zuch-work/abroad-osm"))


def bbox_of(lat, lon, half_m):
    dlat = half_m / 110540.0
    dlon = half_m / (111320.0 * math.cos(math.radians(lat)))
    return (lon - dlon, lat - dlat, lon + dlon, lat + dlat)


def fetch_xml(key, lat, lon, half_m, tries=5):
    os.makedirs(WORK, exist_ok=True)
    xml_path = os.path.join(WORK, key + ".xml")
    if os.path.exists(xml_path):
        return xml_path
    minlon, minlat, maxlon, maxlat = bbox_of(lat, lon, half_m)
    url = API + "?bbox=%.6f,%.6f,%.6f,%.6f" % (minlon, minlat, maxlon, maxlat)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    last = None
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            with open(xml_path + ".part", "wb") as fh:
                fh.write(data)
            os.replace(xml_path + ".part", xml_path)
            return xml_path
        except urllib.error.HTTPError as error:
            last = error
            if error.code in (400, 509) and half_m > 300:
                half_m *= 0.75
                minlon, minlat, maxlon, maxlat = bbox_of(lat, lon, half_m)
                url = API + "?bbox=%.6f,%.6f,%.6f,%.6f" % (minlon, minlat, maxlon, maxlat)
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                continue
            time.sleep(2 + attempt * 2)
        except (urllib.error.URLError, TimeoutError) as error:
            last = error
            time.sleep(2 + attempt * 2)
    raise RuntimeError("OSM bbox fetch of %s failed: %s" % (key, last))


def chain_outer(way_id_to_coords, outer_ids):
    """Chain OSM ways end to end through shared endpoints into closed rings; a part that cannot be chained is kept as its own ring."""
    parts = [list(way_id_to_coords[w]) for w in outer_ids if w in way_id_to_coords]
    rings = []
    while parts:
        chain = parts.pop(0)
        changed = True
        while changed:
            changed = False
            for i, p in enumerate(parts):
                if chain[-1] == p[0]:
                    chain += p[1:]; parts.pop(i); changed = True; break
                if chain[-1] == p[-1]:
                    chain += list(reversed(p))[1:]; parts.pop(i); changed = True; break
                if chain[0] == p[-1]:
                    chain = p[:-1] + chain; parts.pop(i); changed = True; break
                if chain[0] == p[0]:
                    chain = list(reversed(p))[:-1] + chain; parts.pop(i); changed = True; break
        rings.append(chain)
    return rings


def parse(xml_path):
    tree = ET.parse(xml_path)
    root = tree.getroot()
    nodes = {}
    node_tags = {}
    for n in root.findall("node"):
        nid = n.get("id")
        nodes[nid] = (float(n.get("lat")), float(n.get("lon")))
        tags = {t.get("k"): t.get("v") for t in n.findall("tag")}
        if tags:
            node_tags[nid] = tags
    ways = {}
    way_tags = {}
    for w in root.findall("way"):
        wid = w.get("id")
        refs = [nd.get("ref") for nd in w.findall("nd")]
        coords = [nodes[r] for r in refs if r in nodes]
        if len(coords) < 2:
            continue
        ways[wid] = coords
        way_tags[wid] = {t.get("k"): t.get("v") for t in w.findall("tag")}
    out_ways = [{"id": wid, "tags": way_tags[wid], "nodes": coords, "closed": coords[0] == coords[-1] and len(coords) > 2}
                for wid, coords in ways.items()]
    # relations: only multipolygon-ish ones with tags we care about (building / landuse / natural / leisure / waterway area); outer ways chained into one ring
    out_rels = []
    for rel in root.findall("relation"):
        tags = {t.get("k"): t.get("v") for t in rel.findall("tag")}
        if not tags or tags.get("type") not in ("multipolygon", "boundary"):
            continue
        outer_ids = [m.get("ref") for m in rel.findall("member") if m.get("type") == "way" and m.get("role") in ("outer", "")]
        rings = chain_outer(ways, outer_ids)
        for ring in rings:
            if len(ring) >= 4:
                out_rels.append({"id": "r" + rel.get("id"), "tags": tags, "nodes": ring, "closed": ring[0] == ring[-1]})
    out_nodes = [{"id": nid, "lat": lat, "lon": lon, "tags": node_tags.get(nid, {})} for nid, (lat, lon) in nodes.items() if nid in node_tags]
    return out_ways + out_rels, out_nodes


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("key")
    ap.add_argument("lat", type=float)
    ap.add_argument("lon", type=float)
    ap.add_argument("--half-m", type=float, default=480.0)
    ap.add_argument("--force", action="store_true", help="re-fetch even if a cached XML exists")
    args = ap.parse_args()
    os.makedirs(WORK, exist_ok=True)
    xml_path = os.path.join(WORK, args.key + ".xml")
    if args.force and os.path.exists(xml_path):
        os.remove(xml_path)
    xml_path = fetch_xml(args.key, args.lat, args.lon, args.half_m)
    ways, nodes = parse(xml_path)
    out = {"key": args.key, "lat": args.lat, "lon": args.lon, "half_m": args.half_m, "ways": ways, "nodes": nodes}
    json_path = os.path.join(WORK, args.key + ".json")
    with open(json_path, "w") as fh:
        json.dump(out, fh)
    print("%-24s %5d ways/rings, %5d tagged nodes -> %s" % (args.key, len(ways), len(nodes), json_path))


if __name__ == "__main__":
    main()
