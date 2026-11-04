#!/usr/bin/env python3
"""Probe: no road of Lux Drive ends in nowhere.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/luxdrive/probe_roads.py

The bake takes the OSM ways of the area and clips them to the play area (the two communes and their
300 m buffer).  A way that leaves the area ends exactly on the boundary: that is the edge of the
world, not a road to nowhere.  Every other end must be a place where OSM says the road really ends:

  * a junction: the OSM node is shared with another way, and the bake has that way;
  * a real dead end: the OSM node belongs to this way alone (a cul-de-sac);
  * a turning circle: the way is a loop (a roundabout).

An end that stands in a field, or a street that stops where OSM says another way continues, is a road
to nowhere and the probe FAILS (exit code 1).

The probe reads the baked network (pb/lux-drive/data/roads.bin) and the OSM extract of the pipeline
(raw/osm.json), so it checks the bake against the truth of OSM, not against itself.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import RAW_DIR, luref_to_world  # noqa: E402
from roads_io import decode_roads, DRIVABLE  # noqa: E402
from bake_roads import ROAD_KINDS, geometry_of  # noqa: E402
from shapely.geometry import LineString, Point, Polygon  # noqa: E402
from shapely.ops import unary_union  # noqa: E402
from shapely.strtree import STRtree  # noqa: E402

END_NEAR = 6.0        # m: an OSM way this close to the end of a baked way is the way itself
END_MATCH = 3.0       # m: this close to the node of the OSM way = the same place
CLIP_TOL = 2.0        # m: this close to the boundary of the area = the way was clipped there
KEEP = 12             # how many offenders are printed


def load_clip():
    """The play area in world coordinates: the polygon the bake clips the ways to."""
    area = json.load(open(os.path.join(RAW_DIR, "area_world.json"), encoding="utf-8"))
    polys = []
    for rings in area["polygons"]:
        p = Polygon(rings[0], rings[1:]) if len(rings) > 1 else Polygon(rings[0])
        polys.append(p if p.is_valid else p.buffer(0))
    return unary_union(polys)


def load_osm_ways():
    """The OSM ways of the classes the bake takes, in world coordinates."""
    osm = json.load(open(os.path.join(RAW_DIR, "osm.json"), encoding="utf-8"))
    nodes = osm["nodes"]
    ways = []
    for way in osm["ways"]:
        tags = way["t"]
        if tags.get("highway") not in ROAD_KINDS:
            continue
        pts = geometry_of(way, nodes)
        if len(pts) < 2:
            continue
        e, n = luref_to_world([p[0] for p in pts], [p[1] for p in pts])
        coords = list(zip(e.tolist(), n.tolist()))
        ways.append({
            "id": way["id"], "hw": tags["highway"], "line": LineString(coords),
            "nodes": way["n"], "closed": way["n"][0] == way["n"][-1],
            "first": way["n"][0], "last": way["n"][-1],
        })
    return ways


def main():
    roads, names = decode_roads()
    osm_ways = load_osm_ways()
    clip = load_clip()
    tree = STRtree([w["line"] for w in osm_ways])

    # how many ways of the area use an OSM node: a node with more than one way is a junction
    degree = {}
    for w in osm_ways:
        for nid in set(w["nodes"]):
            degree[nid] = degree.get(nid, 0) + 1

    # the baked ways, so that "is there another way here" is an exact question about the geometry
    baked_lines = [LineString(r["pts"]) for r in roads]
    baked_tree = STRtree(baked_lines)

    def otherWayNear(x, z, radius, skip):
        """Another baked way within the radius (the way itself does not count)."""
        for i in baked_tree.query(Point(x, z).buffer(radius)):
            if i == skip:
                continue
            if baked_lines[i].distance(Point(x, z)) <= radius:
                return True
        return False

    stats = {"ends": 0, "border": 0, "junction": 0, "deadEnd": 0, "turningCircle": 0, "split": 0}
    bad = []
    for ri, r in enumerate(roads):
        if r["kind"] not in DRIVABLE:
            continue
        pts = r["pts"]
        for end in (pts[0], pts[-1]):
            stats["ends"] += 1
            x, z = end
            # an end on the clip of the area is the edge of the world
            if clip.boundary.distance(Point(x, z)) <= CLIP_TOL:
                stats["border"] += 1
                continue
            near = [osm_ways[i] for i in tree.query(Point(x, z).buffer(END_NEAR))]
            if not near:
                bad.append({"where": "in the middle of nowhere", "name": r["name"] or r["kind"],
                            "x": round(x), "z": round(z)})
                continue
            # the OSM way this end belongs to: the one whose node is the closest
            best = None
            for w in near:
                line = w["line"]
                d_first = Point(x, z).distance(Point(line.coords[0]))
                d_last = Point(x, z).distance(Point(line.coords[-1]))
                d_node = min(d_first, d_last)
                if best is None or d_node < best[0]:
                    best = (d_node, w, d_first <= d_last)
            d_node, w, is_first = best
            if d_node > END_MATCH:
                # the end is in the middle of an OSM way: the bake split the way there
                if otherWayNear(x, z, END_MATCH, ri):
                    stats["split"] += 1
                else:
                    bad.append({"where": "the road stops in the middle of a street", "name": r["name"] or r["kind"],
                                "x": round(x), "z": round(z)})
                continue
            node = w["first"] if is_first else w["last"]
            deg = degree.get(node, 1)
            if deg <= 1:
                # the OSM node belongs to this way alone: a real dead end (or a turning circle)
                if w["closed"] or (pts[0] == pts[-1]):
                    stats["turningCircle"] += 1
                else:
                    stats["deadEnd"] += 1
                continue
            # a junction in OSM: the other way has to be in the bake, or the street stops in the middle
            if otherWayNear(x, z, END_MATCH, ri):
                stats["junction"] += 1
            else:
                bad.append({"where": "the street stops where OSM says another way continues",
                            "name": r["name"] or r["kind"], "x": round(x), "z": round(z)})

    print("probe: the roads of Lux Drive")
    print("  the ends of the drivable ways:   %d" % stats["ends"])
    print("  on the clip of the area:          %d  (the edge of the world)" % stats["border"])
    print("  a junction (OSM has the other):   %d" % stats["junction"])
    print("  a real dead end in OSM:           %d" % stats["deadEnd"])
    print("  a turning circle:                 %d" % stats["turningCircle"])
    print("  a split of a way:                 %d" % stats["split"])
    print("  roads to nowhere:                 %d" % len(bad))
    for b in bad[:KEEP]:
        print("    %s: %s at (%d, %d)" % (b["name"], b["where"], b["x"], b["z"]))
    if len(bad) > KEEP:
        print("    ... and %d more" % (len(bad) - KEEP))
    if bad:
        print("FAIL: %d road ends are in nowhere" % len(bad))
        return 1
    print("PASS: every road end is a junction, a real dead end or the edge of the area")
    return 0


if __name__ == "__main__":
    sys.exit(main())
