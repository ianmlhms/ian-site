"""Painted-ground model of the Luxtram world: OSM + LiDAR -> shapely geometry (shared by build_luxtram_ground.py).

Frame: the local equirectangular frame of build_luxtram.py (x east, z south, metres; shapely treats (x, z) as the plane's (x, y)).
Everything here is vector: carriageways (merged, with proper junctions), sidewalks, kerb lines, paths, markings, zebra crossings, parking,
water, rails, bridge decks.  The raster class map is made from these plus an orthophoto *classification* (vegetation vs. hard ground only;
the photo itself is never shipped).
"""
import math
import os
import sys

import numpy as np
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon, box
from shapely.ops import unary_union
from shapely.strtree import STRtree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_luxtram as B  # noqa: E402

RAW = B.RAW_DEFAULT

# ----------------------------------------------------------------------------------------------------------------- classes
HW_CLASS = {
    "motorway": 0, "motorway_link": 0, "trunk": 0, "trunk_link": 0, "primary": 1, "primary_link": 1, "secondary": 2, "secondary_link": 2,
    "tertiary": 3, "tertiary_link": 3, "unclassified": 4, "residential": 4, "living_street": 4, "service": 5, "pedestrian": 6,
    "cycleway": 7, "track": 8, "footway": 9, "path": 9, "bridleway": 9, "steps": 10, "construction": 5,
}
ROAD_W = {0: 7.5, 1: 7.0, 2: 6.4, 3: 6.0, 4: 5.2, 5: 3.4, 6: 5.0, 7: 2.2, 8: 3.0, 9: 1.8, 10: 2.0}
SIDEWALK_W = {0: 0.0, 1: 2.4, 2: 2.2, 3: 2.0, 4: 1.8, 5: 0.0, 6: 0.0}
CARRIAGE = (0, 1, 2, 3, 4, 5)           # classes drawn as asphalt carriageways
SETT_SURF = ("sett", "cobblestone", "unhewn_cobblestone", "paving_stones", "cobblestone:flattened", "stone")
GRAVEL_SURF = ("gravel", "fine_gravel", "compacted", "unpaved", "dirt", "ground", "earth", "grass", "sand", "pebblestone", "mud")


def parse_w(v):
    return B.parse_height(v)


class Road:
    __slots__ = ("id", "pts", "cls", "w", "hw", "bridge", "tunnel", "oneway", "lanes", "tags", "sw", "name", "surf", "line", "layer", "nodes", "rev")

    def __init__(self, el):
        t = el["tags"]
        self.id = el["id"]
        self.tags = t
        self.cls = HW_CLASS[t["highway"]]
        self.pts = [B.proj(p["lat"], p["lon"]) for p in el["geometry"]]
        self.nodes = el.get("nodes")
        self.bridge = t.get("bridge") in ("yes", "viaduct", "movable", "boardwalk") or t.get("man_made") == "bridge"
        self.tunnel = t.get("tunnel") in ("yes", "culvert", "building_passage") or t.get("covered") == "yes"
        self.oneway = t.get("oneway") in ("yes", "1", "true") or t.get("junction") == "roundabout"
        lanes = t.get("lanes")
        self.lanes = int(lanes) if lanes and lanes.isdigit() else 0
        self.layer = int(t["layer"]) if t.get("layer", "").lstrip("-").isdigit() else 0
        self.name = t.get("name") or t.get("ref") or ""
        w = parse_w(t.get("width")) or parse_w(t.get("est_width"))
        if not w:
            w = ROAD_W[self.cls]
            if self.cls <= 4:
                if self.lanes:
                    w = max(w if not self.oneway else 3.0, 3.1 * (self.lanes if self.oneway else self.lanes) + 0.5)
                    if not self.oneway and self.lanes <= 2:
                        w = max(w, ROAD_W[self.cls] if self.cls >= 3 else 6.2)
                elif self.oneway:
                    w = 4.4 if self.cls >= 3 else 6.0
            if t.get("service") in ("driveway",):
                w = 3.0
            elif t.get("service") in ("parking_aisle",):
                w = 5.0
            elif t.get("service") in ("alley", "emergency_access", "drive-through"):
                w = 3.2
        self.w = float(min(max(w, 1.0), 30.0))
        self.hw = self.w / 2
        self.surf = t.get("surface", "")
        self.sw = None        # (left, right) sidewalks: width or 0
        self.line = LineString(self.pts) if len(self.pts) > 1 else None
        self.rev = False


def load_all_elements(prefix):
    out = []
    seen = set()
    for el in B.load_many(RAW, prefix):
        k = (el["type"], el["id"])
        if k in seen:
            continue
        seen.add(k)
        out.append(el)
    return out


def ring_poly(g):
    pts = [B.proj(p["lat"], p["lon"]) for p in g]
    if len(pts) >= 4 and B.dist(pts[0], pts[-1]) < 0.5:
        return pts[:-1]
    return None


def el_polygons(el):
    """shapely polygons of a closed way / multipolygon relation (outer rings with their inner rings)."""
    if el["type"] == "way":
        r = ring_poly(el.get("geometry") or [])
        if r and len(r) >= 3:
            p = Polygon(r)
            return [p if p.is_valid else p.buffer(0)]
        return []
    outers, inners = [], []
    for m in el.get("members", []):
        if m.get("type") != "way" or not m.get("geometry"):
            continue
        g = [B.proj(p["lat"], p["lon"]) for p in m["geometry"]]
        (inners if m.get("role") == "inner" else outers).append(g)
    # stitch open ways into rings
    def stitch(ways):
        rings = []
        ways = [list(w) for w in ways]
        while ways:
            cur = ways.pop(0)
            changed = True
            while changed and B.dist(cur[0], cur[-1]) > 0.5:
                changed = False
                for i, w in enumerate(ways):
                    if B.dist(cur[-1], w[0]) < 0.5:
                        cur += w[1:]
                    elif B.dist(cur[-1], w[-1]) < 0.5:
                        cur += w[::-1][1:]
                    elif B.dist(cur[0], w[-1]) < 0.5:
                        cur = w[:-1] + cur
                    elif B.dist(cur[0], w[0]) < 0.5:
                        cur = w[::-1][:-1] + cur
                    else:
                        continue
                    ways.pop(i)
                    changed = True
                    break
            if len(cur) >= 4 and B.dist(cur[0], cur[-1]) < 0.5:
                rings.append(cur[:-1])
        return rings
    out = []
    ins = [Polygon(r) for r in stitch(inners) if len(r) >= 3]
    for r in stitch(outers):
        if len(r) < 3:
            continue
        p = Polygon(r)
        if not p.is_valid:
            p = p.buffer(0)
        for h in ins:
            if p.contains(h.representative_point()):
                p = p.difference(h)
        out.append(p)
    return out


def polys_of(g):
    if g is None or g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    if hasattr(g, "geoms"):
        out = []
        for x in g.geoms:
            out += polys_of(x)
        return out
    return []


def lines_of(g):
    if g is None or g.is_empty:
        return []
    if isinstance(g, LineString):
        return [g]
    if isinstance(g, MultiLineString):
        return list(g.geoms)
    if hasattr(g, "geoms"):
        out = []
        for x in g.geoms:
            out += lines_of(x)
        return out
    return []


def clean(g, tol=0.0):
    if g is None or g.is_empty:
        return g
    if not g.is_valid:
        g = g.buffer(0)
    return g
