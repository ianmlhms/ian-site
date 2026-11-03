#!/usr/bin/env python3
"""Bake the start position and the landmarks of Lux Drive into pb/lux-drive/data/places.json.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/luxdrive/bake_places.py

The car starts on Place de l'Europe in Kirchberg (the brief): the square itself is a pedestrian
area, so the start point is the point of the surrounding road network closest to the square.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT_DIR, RAW_DIR, lonlat_to_world, luref_to_world  # noqa: E402
from roads_io import DRIVABLE, decode_roads  # noqa: E402

# the landmarks the game names in the HUD / the minimap
LANDMARK_TAGS = (
    ("town", ("town", "city", "village")),
    ("quarter", ("neighbourhood", "suburb", "quarter")),
    ("park", ("park", "garden", "recreation_ground")),
    ("water", ("water", "reservoir", "lake", "pond")),
    ("station", ("station", "halt")),
    ("castle", ("castle", "fortress", "monastery")),
    ("school", ("school", "university", "college")),
    ("museum", ("museum", "gallery")),
    ("hospital", ("hospital", "clinic")),
)


def relation_geometry(rel, nodes):
    """The list of (lon, lat) of every member way of a relation."""
    out = []
    for m in rel.get("m", []):
        if m["t"] != "w":
            continue
        w = WAY_BY_ID.get(m["r"])
        if not w:
            continue
        for nid in w["n"]:
            p = nodes.get(str(nid))
            if p:
                out.append(p)
    return out


def main():
    global WAY_BY_ID
    osm = json.load(open(os.path.join(RAW_DIR, "osm.json"), encoding="utf-8"))
    nodes = osm["nodes"]
    WAY_BY_ID = {w["id"]: w for w in osm["ways"]}

    # ---- the start square -------------------------------------------------
    square = None
    for r in osm["rels"]:
        if r["t"].get("name") == "Place de l'Europe":
            square = r
            break
    if square is None:
        raise SystemExit("Place de l'Europe not found in the OSM extract")
    pts = relation_geometry(square, nodes)
    if not pts:
        raise SystemExit("Place de l'Europe has no geometry")
    lons = [p[0] for p in pts]
    lats = [p[1] for p in pts]
    sx, sz = lonlat_to_world(sum(lons) / len(lons), sum(lats) / len(lats))
    sx = float(sx); sz = float(sz)
    print("Place de l'Europe centre: world %.1f %.1f" % (sx, sz))

    # the start point is on the road: the closest point of the drivable network
    roads, _ = decode_roads()
    best = None
    for r in roads:
        if r["kind"] not in DRIVABLE:
            continue
        p = r["pts"]
        for i in range(len(p) - 1):
            ax, az = p[i]
            bx, bz = p[i + 1]
            dx, dz = bx - ax, bz - az
            ll = dx * dx + dz * dz
            if ll < 1e-9:
                continue
            t = max(0.0, min(1.0, ((sx - ax) * dx + (sz - az) * dz) / ll))
            px, pz = ax + dx * t, az + dz * t
            d = math.hypot(px - sx, pz - sz)
            if best is None or d < best[0]:
                yaw = math.atan2(dz, dx)
                best = (d, px, pz, yaw, r["name"], r["kind"])
    d, px, pz, yaw, name, kind = best
    print("start on %r (%s), %.1f m from the square, yaw %.3f" % (name, kind, d, yaw))

    # ---- the landmarks ----------------------------------------------------
    marks = []
    for p in osm["pois"]:
        t = p["t"]
        name = t.get("name") or t.get("name:lb")
        if not name:
            continue
        kind = None
        for k, keys in LANDMARK_TAGS:
            if any(t.get(key) for key in keys):
                kind = k
                break
        if kind is None and t.get("place"):
            kind = "town" if t["place"] in ("town", "city", "village") else "quarter"
        if kind is None:
            continue
        x, z = lonlat_to_world(p["lon"], p["lat"])
        marks.append({"name": name, "kind": kind, "x": round(float(x), 1), "z": round(float(z), 1)})
    # the relations (parks, lakes, quarters) too
    for r in osm["rels"]:
        t = r["t"]
        name = t.get("name") or t.get("name:lb")
        if not name:
            continue
        kind = None
        for k, keys in LANDMARK_TAGS:
            if any(t.get(key) for key in keys):
                kind = k
                break
        if kind is None:
            continue
        pts = relation_geometry(r, nodes)
        if not pts:
            continue
        x, z = lonlat_to_world(sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        marks.append({"name": name, "kind": kind, "x": round(float(x), 1), "z": round(float(z), 1)})

    out = {
        "start": {"x": round(px, 2), "z": round(pz, 2), "yaw": round(yaw, 4),
                  "name": "Place de l'Europe, Kirchberg", "road": name},
        "landmarks": marks,
    }
    with open(os.path.join(OUT_DIR, "places.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    from collections import Counter
    print("landmarks %d %s" % (len(marks), Counter(m["kind"] for m in marks)))


if __name__ == "__main__":
    main()
