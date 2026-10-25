#!/usr/bin/env python3
"""Bake the OpenStreetMap way network of the MTB world into pb/mtb/data/ways.bin (geometry) and ways.json (attributes).

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/mtb/bake_ways.py

kind: 0 trail (ridden MTB trail, assigned by bake_trails.py), 1 path, 2 track, 3 road.   Geometry is clipped to the world box + 100 m,
simplified (Douglas-Peucker, 0.25 m) and stored as varint deltas in decimetres.  A way on a bridge or in a tunnel keeps its flag (no carving).
"""
import json
import math
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT_DIR, RAW_DIR, WORLD_H, WORLD_W, load_osm, lonlat_to_world  # noqa: E402
from shapely.geometry import LineString, box  # noqa: E402

KIND = {"trail": 0, "path": 1, "track": 2, "road": 3}
HIGHWAY_KIND = {
    "path": "path", "footway": "path", "bridleway": "path", "steps": "path", "cycleway": "track", "track": "track", "service": "track",
    "unclassified": "road", "residential": "road", "tertiary": "road", "secondary": "road", "living_street": "road", "pedestrian": "road",
}
SURFACES = ["", "ground", "dirt", "grass", "gravel", "compacted", "asphalt", "paved", "wood", "rock", "sand", "mud", "roots", "cobble"]
SURFACE_OF = {
    "ground": 1, "dirt": 2, "earth": 2, "unpaved": 2, "grass": 3, "gravel": 4, "fine_gravel": 4, "compacted": 5, "asphalt": 6, "paved": 7,
    "concrete": 7, "paving_stones": 13, "cobblestone": 13, "sett": 13, "wood": 8, "rock": 9, "sand": 10, "mud": 11, "roots": 12,
}
MARGIN = 100.0
SIMPLIFY_M = 0.25


def varint(n, out):
    while n >= 0x80:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    out.append(n)


def zigzag(n):
    return (n << 1) ^ (n >> 63)


def parse_mtb(tags):
    v = tags.get("mtb:scale")
    if v is None:
        return 255
    try:
        return int(str(v).rstrip("+-"))
    except ValueError:
        return 255


def node_key(lon, lat):
    return (round(lon * 1e7), round(lat * 1e7))       # same key as network.py


def load_used_edges():
    """Edges claimed by the named trails (bake_trails.py): they are drawn/carved as trails, not a second time as plain ways."""
    path = os.path.join(RAW_DIR, "used_edges.json")
    if not os.path.exists(path):
        return set()
    return {(tuple(u), tuple(v)) for u, v in json.load(open(path))}


def unused_runs(geometry, used):
    """Split an OSM way geometry into runs of consecutive edges that no trail uses. Returns lists of (lon, lat) points."""
    keys = [node_key(p["lon"], p["lat"]) for p in geometry]
    runs, cur = [], [geometry[0]]
    for i in range(len(geometry) - 1):
        if (keys[i], keys[i + 1]) in used:
            if len(cur) > 1:
                runs.append(cur)
            cur = [geometry[i + 1]]
        else:
            cur.append(geometry[i + 1])
    if len(cur) > 1:
        runs.append(cur)
    return runs


def main():
    used = load_used_edges()
    clip = box(-MARGIN, -MARGIN, WORLD_W + MARGIN, WORLD_H + MARGIN)
    meta = []
    blob = bytearray()
    total_pts = 0
    for el in load_osm("ways"):
        tags = el.get("tags", {})
        kind = HIGHWAY_KIND.get(tags.get("highway"))
        if not kind or "geometry" not in el:
            continue
        bridge = 1 if tags.get("bridge") not in (None, "no") else 0
        tunnel = 1 if tags.get("tunnel") not in (None, "no") else 0
        geoms = []
        for run in unused_runs(el["geometry"], used):
            xs, zs = lonlat_to_world([p["lon"] for p in run], [p["lat"] for p in run])
            parts = LineString(list(zip(xs.tolist(), zs.tolist()))).intersection(clip)
            geoms += [parts] if parts.geom_type == "LineString" else [g for g in getattr(parts, "geoms", []) if g.geom_type == "LineString"]
        for g in geoms:
            if g.length < 3:
                continue
            g = g.simplify(SIMPLIFY_M, preserve_topology=False)
            pts = list(g.coords)
            if len(pts) < 2:
                continue
            idx = len(meta)
            row = {"id": el["id"], "k": KIND[kind], "m": parse_mtb(tags), "s": SURFACE_OF.get(tags.get("surface", ""), 0), "f": bridge | (tunnel << 1), "len": round(g.length, 1)}
            if tags.get("name"):
                row["n"] = tags["name"]
            if tags.get("highway") in ("path", "footway", "track") and tags.get("tracktype"):
                row["tt"] = tags["tracktype"]
            meta.append(row)
            blob += struct.pack("<H", len(pts))
            px, pz = round(pts[0][0] * 10), round(pts[0][1] * 10)
            blob += struct.pack("<ii", px, pz)
            for x, z in pts[1:]:
                qx, qz = round(x * 10), round(z * 10)
                varint(zigzag(qx - px), blob)
                varint(zigzag(qz - pz), blob)
                px, pz = qx, qz
            total_pts += len(pts)
    out = struct.pack("<I", len(meta)) + bytes(blob)
    with open(os.path.join(OUT_DIR, "ways.bin"), "wb") as fh:
        fh.write(out)
    with open(os.path.join(OUT_DIR, "ways.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, separators=(",", ":"), ensure_ascii=False)
    km = {}
    for m in meta:
        km[m["k"]] = km.get(m["k"], 0) + m["len"]
    print("ways", len(meta), "points", total_pts, "bytes bin", len(out), "json", os.path.getsize(os.path.join(OUT_DIR, "ways.json")), {k: round(v / 1000, 1) for k, v in km.items()})


if __name__ == "__main__":
    main()
