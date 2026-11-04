#!/usr/bin/env python3
"""Bake the start position and the landmarks of Lux Drive into pb/lux-drive/data/places.json.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/luxdrive/bake_places.py

The car starts on the carriageway of Avenue John F. Kennedy in Kirchberg, next to Place de l'Europe
(the brief and the reviewer): the square itself is a pedestrian area paved with stone, so a car that
starts on it stands on the plaza between the office blocks.  The start point is on the tarmac of the
avenue, in the right-hand lane, facing along the road.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OUT_DIR, RAW_DIR, lonlat_to_world, luref_to_world  # noqa: E402
from roads_io import DRIVABLE, decode_roads  # noqa: E402

# The street the car starts on (the brief: next to Place de l'Europe, on the carriageway).
START_STREET = "Avenue John F. Kennedy"
# m: the start must be this far from the end of its way, so the car does not wake up in a junction.
CLEAR_OF_JUNCTION = 25.0
# The avenue carries the name on several ways: the service road beside it carries it too.  The car starts
# on the avenue itself, so the class decides: the biggest one wins.
CLASS_RANK = {
    "primary": 6, "primary_link": 5, "secondary": 4, "secondary_link": 3,
    "tertiary": 2, "tertiary_link": 1,
}

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

    # ---- the start: the carriageway of the avenue, next to the square ------------------
    roads, _ = decode_roads()

    # the ring of the square, in world coordinates: the start must stand next to it
    ring = []
    for p in pts:
        x, z = lonlat_to_world(p[0], p[1])
        ring.append((float(x), float(z)))
    if len(ring) > 2 and ring[0] != ring[-1]:
        ring.append(ring[0])

    def dist_to_ring(x, z):
        """The distance from (x, z) to the edge of the square."""
        best = 1e18
        for i in range(len(ring) - 1):
            ax, az = ring[i]
            bx, bz = ring[i + 1]
            dx, dz = bx - ax, bz - az
            ll = dx * dx + dz * dz
            if ll < 1e-9:
                continue
            t = max(0.0, min(1.0, ((x - ax) * dx + (z - az) * dz) / ll))
            d = math.hypot(x - (ax + dx * t), z - (az + dz * t))
            if d < best:
                best = d
        return best

    # the point of the avenue that lies closest to the square, on a stretch that is clear of the junctions
    best = None
    rank = 0
    for r in roads:
        if r["name"] != START_STREET or r["kind"] not in DRIVABLE:
            continue
        if r["bridge"] or r["tunnel"] or r["over"]:
            continue
        r_rank = CLASS_RANK.get(r["kind"], 0)
        if r_rank < rank:
            continue
        p = r["pts"]
        # the length of the way and the distance from its start to every point: the ends of a way are its
        # junctions, and the car must not wake up on one of them
        prefix = [0.0]
        for i in range(len(p) - 1):
            prefix.append(prefix[-1] + math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]))
        total = prefix[-1]
        for i in range(len(p) - 1):
            ax, az = p[i]
            bx, bz = p[i + 1]
            dx, dz = bx - ax, bz - az
            ll = math.hypot(dx, dz)
            if ll < 1e-9:
                continue
            steps = max(1, int(ll / 2.0))
            for k in range(steps + 1):
                u = k / steps
                s = prefix[i] + ll * u
                if min(s, total - s) < CLEAR_OF_JUNCTION:
                    continue
                px, pz = ax + dx * u, az + dz * u
                d = dist_to_ring(px, pz)
                if best is None or r_rank > rank or (r_rank == rank and d < best["d"]):
                    best = {"d": d, "x": px, "z": pz, "yaw": math.atan2(dz, dx), "road": r}
                    rank = r_rank
    if best is None:
        raise SystemExit("no stretch of %r next to the square" % START_STREET)
    r = best["road"]
    yaw = best["yaw"]
    # the right-hand lane: Luxembourg drives on the right, and the car faces along the way
    off = r["offset"]
    px = best["x"] + math.cos(yaw + math.pi / 2) * off
    pz = best["z"] + math.sin(yaw + math.pi / 2) * off
    start_road, start_kind = r["name"], r["kind"]
    print("start on %r (%s), %.1f m from the edge of the square, %.2f m right of the centre line, yaw %.3f"
          % (start_road, start_kind, best["d"], off, yaw))

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
                  "name": "Avenue John F. Kennedy, Kirchberg", "road": start_road,
                  "square": "Place de l'Europe"},
        "landmarks": marks,
    }
    with open(os.path.join(OUT_DIR, "places.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    from collections import Counter
    print("landmarks %d %s" % (len(marks), Counter(m["kind"] for m in marks)))


if __name__ == "__main__":
    main()
