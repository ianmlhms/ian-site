#!/usr/bin/env python3
"""Fallback for fetch_osm.py when every Overpass mirror is at capacity (23 Nov 2026: overpass-api.de / kumi / private.coffee all 502 /
504 for an hour): the same layers, built from the main OSM API's `map` call (https://api.openstreetmap.org/api/0.6/map.json, the box
in chunks, split again when a chunk is over the API's node limit) plus `relation/<id>/full` for every relation a layer keeps (so
multipolygons and piste routes get all their members). Writes the layer files in Overpass `out geom` form into the same cache
(common.osm_path), so bake.py / coverage.py / park_osm.py read them as usual. A layer already cached is left alone.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/ski/fetch_osm_api.py obertauern [layer ...]

© OpenStreetMap contributors, ODbL 1.0 (credited in the game).
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import RESORTS, USER_AGENT, osm_path, resort_arg, work_dir  # noqa: E402

API = "https://api.openstreetmap.org/api/0.6"
MARGIN = 0.03            # degrees: pistes / lifts / areas / water / peaks are asked for in the box + this (as fetch_osm.py)
CHUNK = (0.03, 0.02)     # degrees lon / lat per map call (split in four when the API says too many nodes)
PAUSE = 1.0


def get_json(url, tries=4):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=180) as resp:
                body = resp.read()
            time.sleep(PAUSE)
            return json.loads(body)
        except urllib.error.HTTPError as err:
            if err.code == 400:                      # too many nodes / too big an area: the caller splits
                raise
            last = err
        except Exception as err:  # noqa: BLE001  (busy: wait and try again)
            last = err
        print("  retry", url[:100], str(last)[:80], file=sys.stderr)
        time.sleep(5 * (attempt + 1))
    raise SystemExit("OSM API failed: %s: %s" % (url, last))


def map_chunk(w, s, e, n, store, cache_dir, depth=0):
    name = os.path.join(cache_dir, "map_%.4f_%.4f_%.4f_%.4f.json" % (w, s, e, n))
    if os.path.exists(name):
        with open(name, encoding="utf-8") as fh:
            data = json.load(fh)
    else:
        try:
            data = get_json("%s/map.json?bbox=%.5f,%.5f,%.5f,%.5f" % (API, w, s, e, n))
        except urllib.error.HTTPError:
            if depth > 5:
                raise
            mx, my = (w + e) / 2, (s + n) / 2
            for box in ((w, s, mx, my), (mx, s, e, my), (w, my, mx, n), (mx, my, e, n)):
                map_chunk(*box, store, cache_dir, depth + 1)
            return
        with open(name + ".part", "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        os.replace(name + ".part", name)
    for el in data.get("elements", []):
        store[(el["type"], el["id"])] = el
    print("  map %.3f,%.3f..%.3f,%.3f: %d elements (%d total)" % (w, s, e, n, len(data.get("elements", [])), len(store)))


def download(rid):
    s, w, n, e = RESORTS[rid]["bbox"]
    s, w, n, e = s - MARGIN, w - MARGIN, n + MARGIN, e + MARGIN
    cache_dir = work_dir(rid, "osm-api")
    store = {}
    lat = s
    while lat < n - 1e-9:
        lon = w
        while lon < e - 1e-9:
            map_chunk(lon, lat, min(lon + CHUNK[0], e), min(lat + CHUNK[1], n), store, cache_dir)
            lon += CHUNK[0]
        lat += CHUNK[1]
    return store, cache_dir


def complete_relations(rel_ids, store, cache_dir):
    """relation/<id>/full for every kept relation: members outside the downloaded box come in too."""
    for rid_ in sorted(rel_ids):
        name = os.path.join(cache_dir, "rel_%d.json" % rid_)
        if os.path.exists(name):
            with open(name, encoding="utf-8") as fh:
                data = json.load(fh)
        else:
            try:
                data = get_json("%s/relation/%d/full.json" % (API, rid_))
            except urllib.error.HTTPError as err:
                print("  relation", rid_, "not completed:", err, file=sys.stderr)
                continue
            with open(name, "w", encoding="utf-8") as fh:
                json.dump(data, fh)
        for el in data.get("elements", []):
            store.setdefault((el["type"], el["id"]), el)


def inside(lat, lon, box):
    s, w, n, e = box
    return s <= lat <= n and w <= lon <= e


def way_geom(el, store):
    return [({"lat": store[("node", r)]["lat"], "lon": store[("node", r)]["lon"]} if ("node", r) in store else None) for r in el["nodes"]]


def bounds(pts):
    pts = [p for p in pts if p]
    if not pts:
        return None
    return {"minlat": min(p["lat"] for p in pts), "minlon": min(p["lon"] for p in pts),
            "maxlat": max(p["lat"] for p in pts), "maxlon": max(p["lon"] for p in pts)}


def out_way(el, store):
    g = way_geom(el, store)
    return {"type": "way", "id": el["id"], "bounds": bounds(g), "nodes": el["nodes"], "geometry": g, "tags": el.get("tags", {})}


def out_node(el):
    return {"type": "node", "id": el["id"], "lat": el["lat"], "lon": el["lon"], "tags": el.get("tags", {})}


def out_relation(el, store):
    members, pts = [], []
    for m in el.get("members", []):
        row = {"type": m["type"], "ref": m["ref"], "role": m.get("role", "")}
        key = (m["type"], m["ref"])
        if m["type"] == "way" and key in store:
            row["geometry"] = way_geom(store[key], store)
            pts += row["geometry"]
        elif m["type"] == "node" and key in store:
            row["lat"], row["lon"] = store[key]["lat"], store[key]["lon"]
            pts.append(row)
        members.append(row)
    return {"type": "relation", "id": el["id"], "bounds": bounds(pts), "members": members, "tags": el.get("tags", {})}


def touches(el, store, box):
    """Overpass (bbox) on a way / relation: at least one of its nodes in the box (close enough for a whole-area download)."""
    if el["type"] == "node":
        return inside(el["lat"], el["lon"], box)
    if el["type"] == "way":
        return any(("node", r) in store and inside(store[("node", r)]["lat"], store[("node", r)]["lon"], box) for r in el["nodes"])
    for m in el.get("members", []):
        key = (m["type"], m["ref"])
        if key in store and store[key]["type"] in ("node", "way") and touches(store[key], store, box):
            return True
    return False


def rx(pattern):
    return lambda v: v is not None and re.search(pattern, v) is not None


# layer -> [(element type, {tag: test}, wide?)]; every test of a rule must pass (as one Overpass statement)
EQ = lambda want: (lambda v: v == want)  # noqa: E731
ANY = lambda v: v is not None  # noqa: E731
RULES = {
    "pistes": [("way", {"piste:type": EQ("downhill")}, True), ("relation", {"piste:type": EQ("downhill")}, True)],
    "lifts": [("way", {"aerialway": ANY}, True), ("node", {"aerialway": rx("^(pylon|station)$")}, True),
              ("way", {"railway": rx("^(funicular|narrow_gauge|rail|light_rail|monorail)$")}, True),
              ("node", {"railway": rx("^(station|halt|stop)$")}, True)],
    "buildings": [("way", {"building": ANY}, False), ("relation", {"building": ANY}, False)],
    "areas": [("way", {"landuse": rx("^(forest|residential|meadow|grass|commercial|retail|construction|reservoir|basin)$")}, True),
              ("way", {"natural": rx("^(wood|water|bare_rock|scree|glacier|cliff|scrub|heath|grassland|shingle|rock)$")}, True),
              ("relation", {"natural": rx("^(wood|water|bare_rock|scree|glacier)$")}, True),
              ("relation", {"landuse": rx("^(forest|reservoir)$")}, True), ("way", {"waterway": EQ("riverbank")}, True)],
    "water": [("way", {"waterway": rx("^(river|stream)$")}, True)],
    "roads": [("way", {"highway": rx("^(primary|secondary|tertiary|unclassified|residential|service|living_street|pedestrian|track)$")}, False)],
    "parks": [("way", {"piste:type": EQ("snow_park")}, False), ("relation", {"piste:type": EQ("snow_park")}, False),
              ("node", {"piste:type": EQ("snow_park")}, False), ("way", {"leisure": EQ("snow_park")}, False),
              ("way", {"piste:type": EQ("downhill"), "name": rx("[Pp]ark")}, False)],
    "aeroway": [("way", {"aeroway": rx("^(runway|apron|taxiway|helipad)$")}, False)],
    "poi": [("node", {"natural": rx("^(peak|saddle|glacier)$")}, True),
            ("node", {"place": rx("^(village|hamlet|town|locality|isolated_dwelling|suburb|neighbourhood)$")}, True),
            ("node", {"mountain_pass": EQ("yes")}, True), ("node", {"amenity": rx("^(restaurant|cafe|bar)$")}, False)],
}


def select(store, layer, box, wide):
    picked = []
    for el in list(store.values()):
        tags = el.get("tags", {})
        for typ, tests, is_wide in RULES[layer]:
            if el["type"] == typ and all(test(tags.get(k)) for k, test in tests.items()) and touches(el, store, wide if is_wide else box):
                picked.append(el)
                break
    return picked


def main():
    rid = resort_arg()
    names = [a for a in sys.argv[2:] if not a.startswith("-")] or list(RULES)
    todo = [ln for ln in names if not (os.path.exists(osm_path(rid, ln)) and os.path.getsize(osm_path(rid, ln)) > 50 and
                                       os.path.dirname(osm_path(rid, ln)).find("data-round") >= 0)]
    if not todo:
        print("every layer cached already")
        return
    store, cache_dir = download(rid)
    s, w, n, e = RESORTS[rid]["bbox"]
    box, wide = (s, w, n, e), (s - MARGIN, w - MARGIN, n + MARGIN, e + MARGIN)
    for layer in todo:
        picked = select(store, layer, box, wide)
        complete_relations({el["id"] for el in picked if el["type"] == "relation"}, store, cache_dir)
        out = []
        for el in picked:
            if el["type"] == "node":
                out.append(out_node(el))
            elif el["type"] == "way":
                out.append(out_way(el, store))
            else:
                out.append(out_relation(store[("relation", el["id"])], store))
        data = {"version": 0.6, "generator": "fetch_osm_api.py (OSM API 0.6 map + relation/full)",
                "osm3s": {"copyright": "The data included in this document is from www.openstreetmap.org. The data is made available under ODbL."},
                "elements": out}
        path = osm_path(rid, layer, write=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        print(layer, len(out), "elements ->", path)


if __name__ == "__main__":
    main()
