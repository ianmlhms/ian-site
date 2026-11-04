"""The OSM ways and nodes of the campus bbox in the world frame (x east, z south, m); shared by campus_bake.py and campus_spec.py."""
import json
import os

from pyproj import Transformer

WORK = os.environ.get("LUXDRIVE_WORK", os.path.expanduser("~/Library/Caches/luxdrive-work"))
REFS = os.path.join(WORK, "campus", "refs")
ORIGIN_E, ORIGIN_N_TOP = 72192.0, 83968.0
_to_luref = Transformer.from_crs(4326, 2169, always_xy=True)


def to_world(lon, lat):
    e, n = _to_luref.transform(lon, lat)
    return (round(e - ORIGIN_E, 1), round(ORIGIN_N_TOP - n, 1))


def load_osm():
    out = {}
    for e in json.load(open(os.path.join(REFS, "osm_campus_raw.json")))["elements"]:
        if e["type"] == "way" and "geometry" in e:
            out[e["id"]] = {"type": "way", "tags": e.get("tags", {}), "pts": [to_world(g["lon"], g["lat"]) for g in e["geometry"]]}
        elif e["type"] == "node":
            out[e["id"]] = {"type": "node", "tags": e.get("tags", {}), "pts": [to_world(e["lon"], e["lat"])]}
    return out


OSM = load_osm()
