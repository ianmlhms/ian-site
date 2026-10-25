"""OSM way graph for routing the named trails (shared by bake_trails.py and the map previews).

Nodes are the OSM node positions (the Overpass geometry has no node ids, shared junction nodes have identical lon/lat, so the key is
the rounded coordinate pair).  Edge weight = length * penalty(kind): paths are cheap, tracks a bit more, roads dear, steps very dear,
so a route between two points follows the forest paths wherever there is one.
"""
import heapq
import json
import math
import os

from common import load_osm, lonlat_to_world

PENALTY = {"path": 1.0, "footway": 1.05, "track": 1.1, "cycleway": 1.2, "bridleway": 1.0, "service": 1.8, "unclassified": 3.5,
           "residential": 4.0, "tertiary": 4.5, "secondary": 6.0, "living_street": 4.0, "pedestrian": 4.0, "steps": 30.0}


def node_key(lon, lat):
    return (round(lon * 1e7), round(lat * 1e7))


class Graph:
    def __init__(self):
        self.pos = {}                 # key -> (x, z)
        self.adj = {}                 # key -> list of (key2, length, way_index, seg_index)
        self.ways = []                # {id, highway, tags, keys: [node keys]}

    def add_way(self, el):
        tags = el.get("tags", {})
        hw = tags.get("highway")
        if hw not in PENALTY or "geometry" not in el:
            return
        g = el["geometry"]
        xs, zs = lonlat_to_world([p["lon"] for p in g], [p["lat"] for p in g])
        keys = [node_key(p["lon"], p["lat"]) for p in g]
        wi = len(self.ways)
        self.ways.append({"id": el["id"], "highway": hw, "tags": tags, "keys": keys})
        for i, k in enumerate(keys):
            self.pos[k] = (float(xs[i]), float(zs[i]))
        for i in range(len(keys) - 1):
            a, b = keys[i], keys[i + 1]
            if a == b:
                continue
            ln = math.hypot(self.pos[a][0] - self.pos[b][0], self.pos[a][1] - self.pos[b][1])
            pen = PENALTY[hw]
            if tags.get("bridge") or tags.get("tunnel"):
                pen *= 1.0
            self.adj.setdefault(a, []).append((b, ln, pen, wi, i))
            self.adj.setdefault(b, []).append((a, ln, pen, wi, i))

    def nearest(self, x, z):
        best, bd = None, 1e18
        for k, (px, pz) in self.pos.items():
            d = (px - x) ** 2 + (pz - z) ** 2
            if d < bd:
                best, bd = k, d
        return best, math.sqrt(bd)

    def route(self, src, dst, extra_penalty=None):
        """Dijkstra. extra_penalty(edge_key_pair) -> multiplier (>1 discourages, e.g. already used edges). Returns the list of node keys."""
        dist = {src: 0.0}
        prev = {}
        heap = [(0.0, src)]
        while heap:
            d, u = heapq.heappop(heap)
            if u == dst:
                break
            if d > dist.get(u, 1e18):
                continue
            for v, ln, pen, wi, si in self.adj.get(u, ()):
                m = extra_penalty((u, v)) if extra_penalty else 1.0
                nd = d + ln * pen * m
                if nd < dist.get(v, 1e18):
                    dist[v] = nd
                    prev[v] = u
                    heapq.heappush(heap, (nd, v))
        if dst not in prev and src != dst:
            raise ValueError("no route")
        path = [dst]
        while path[-1] != src:
            path.append(prev[path[-1]])
        return path[::-1]


def load_graph():
    g = Graph()
    for el in load_osm("ways"):
        g.add_way(el)
    return g
