#!/usr/bin/env python3
"""Lux Drive: a small Overpass query for the landmark work, results in the game's world frame (x east, z south, metres).

    python3 -I scripts/luxdrive/osm_query.py 'way["building:part"]' --bbox 49.615,6.135,49.625,6.150 [--out out.json]

Prints (and saves) every way as { id, tags, pts: [[x, z], ...] } with world coordinates (the origin of the bake: LUREF E 72192,
N 83968 at the top).  Uses the mirrors in order until one answers; one request per run; a User-Agent with a contact."""
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request

from pyproj import Transformer

ORIGIN_E, ORIGIN_N_TOP = 72192.0, 83968.0
UA = "ian-site-luxdrive/1.0 (konto@ian.lu)"
MIRRORS = ["https://overpass-api.de/api/interpreter",
           "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
_to = Transformer.from_crs(4326, 2169, always_xy=True)
_back = Transformer.from_crs(2169, 4326, always_xy=True)


def to_world(lon, lat):
    e, n = _to.transform(lon, lat)
    return round(e - ORIGIN_E, 1), round(ORIGIN_N_TOP - n, 1)


def to_lonlat(x, z):
    return _back.transform(ORIGIN_E + x, ORIGIN_N_TOP - z)


def query(ql):
    last = None
    for url in MIRRORS:
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": ql}).encode(), headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)
        except Exception as e:  # try the next mirror, but say why this one failed
            last = e
            print(f"mirror {url} failed: {e}", file=sys.stderr)
            time.sleep(2)
    raise RuntimeError(f"no Overpass mirror answered: {last}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("selector")
    ap.add_argument("--bbox", required=True, help="south,west,north,east in degrees")
    ap.add_argument("--out")
    a = ap.parse_args()
    ql = f'[out:json][timeout:60];{a.selector}({a.bbox});out tags geom;'
    data = query(ql)
    out = []
    for el in data["elements"]:
        if el["type"] != "way" or "geometry" not in el:
            continue
        out.append({"id": el["id"], "tags": el.get("tags", {}), "pts": [list(to_world(g["lon"], g["lat"])) for g in el["geometry"]]})
    text = json.dumps(out, separators=(",", ":"))
    if a.out:
        open(a.out, "w").write(text)
    print(f"{len(out)} ways", file=sys.stderr)
    for o in out:
        t = o["tags"]
        print(o["id"], t.get("name", ""), t.get("height", ""), t.get("building:levels", ""), t.get("building:colour", ""), t.get("roof:shape", ""), len(o["pts"]))


if __name__ == "__main__":
    main()
