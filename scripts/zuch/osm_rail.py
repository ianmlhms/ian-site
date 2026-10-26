#!/usr/bin/env python3
"""Shared helpers for the real-line pipeline: read OSM railway data from the Geofabrik extracts (Luxembourg + Rheinland-Pfalz) in UTM 32N,
build the track graph and route a main track between two points.  Open data only (OpenStreetMap contributors, ODbL)."""
import heapq
import math
import os
import re

import numpy as np
import pyproj
import shapely
from pyogrio.raw import read

WORK = os.environ.get("ZUCH_WORK", os.path.expanduser("~/Library/Caches/zuch-work"))
PBFS = [os.path.join(WORK, "lux.osm.pbf"), os.path.join(WORK, "rlp.osm.pbf")]
TO_UTM = pyproj.Transformer.from_crs(4326, 25832, always_xy=True)
TO_WGS = pyproj.Transformer.from_crs(25832, 4326, always_xy=True)
TAG_RE = re.compile(r'"((?:[^"\\]|\\.)*)"=>"((?:[^"\\]|\\.)*)"')


def utm(lon, lat):
    return TO_UTM.transform(lon, lat)


def bbox_wgs(e0, n0, e1, n1, pad=0.0):
    lo0, la0 = TO_WGS.transform(e0 - pad, n0 - pad)
    lo1, la1 = TO_WGS.transform(e1 + pad, n1 + pad)
    return (min(lo0, lo1), min(la0, la1), max(lo0, lo1), max(la0, la1))


def read_layer(layer, bbox, where=None, pbfs=None, mask=None):
    """Features of the extracts inside a lon/lat bbox: [{id, g (shapely, UTM 32N), t (tags incl. other_tags)}].  Features that appear in both extracts (border) are de-duplicated by id.
    mask (W3, abroad corridors): a lon / lat shapely polygon instead of the bbox; GDAL tests every feature against it while reading, so a long thin corridor does not load the box around it."""
    out, seen = [], set()
    for pbf in pbfs or PBFS:
        if not os.path.exists(pbf):
            continue
        meta, _, geom, fields = read(pbf, layer=layer, bbox=bbox, mask=mask, where=where)
        names = [str(n) for n in meta["fields"]]
        for i in range(len(geom)):
            if geom[i] is None:
                continue
            t, oid = {}, None
            for k, n in enumerate(names):
                v = fields[k][i]
                if n == "other_tags":
                    if isinstance(v, str):
                        for a, b in TAG_RE.findall(v):
                            t[a.replace('\\"', '"')] = b.replace('\\"', '"')
                elif n in ("osm_id", "osm_way_id"):
                    if isinstance(v, str) and v:
                        oid = (oid or "") + ("w" if n == "osm_way_id" else ("r" if layer == "multipolygons" else "n" if layer == "points" else "w")) + v
                elif n == "z_order":
                    continue
                elif isinstance(v, str) and v:
                    t[n] = v
            if oid in seen:
                continue
            seen.add(oid)
            g = shapely.from_wkb(geom[i])
            g = shapely.transform(g, lambda c: np.c_[TO_UTM.transform(c[:, 0], c[:, 1])[0], TO_UTM.transform(c[:, 0], c[:, 1])[1]])
            out.append({"id": oid, "g": g, "t": t})
    return out


SNAP = 2.6


def num(v):
    if v is None:
        return None
    m = re.match(r"\s*(-?\d+(?:[.,]\d+)?)", str(v))
    return float(m.group(1).replace(",", ".")) if m else None


class RailGraph:
    """Graph of railway=rail ways (no service tracks); vertices keyed by rounded UTM coordinates (ways of the extracts share vertex coordinates)."""

    def __init__(self, ways):
        self.nodes = {}
        self.adj = {}
        self.way_of = {}
        for w in ways:
            geoms = [w["g"]] if w["g"].geom_type == "LineString" else list(w["g"].geoms)
            for ls in geoms:
                c = np.asarray(ls.coords)
                keys = [(round(float(x), 1), round(float(y), 1)) for x, y in c[:, :2]]
                for a, b in zip(keys[:-1], keys[1:]):
                    if a == b:
                        continue
                    d = math.hypot(a[0] - b[0], a[1] - b[1])
                    self.nodes[a] = a
                    self.nodes[b] = b
                    cost = d * (1.0 if not w["t"].get("service") else 3.0)
                    self.adj.setdefault(a, []).append((b, cost, w))
                    self.adj.setdefault(b, []).append((a, cost, w))
        self.keys = list(self.nodes)
        self._arr = np.array(self.keys)
        from scipy.spatial import cKDTree
        self._tree = cKDTree(self._arr)
        # near-miss junctions: nodes of different ways closer than SNAP m are joined (mapping gaps at switches)
        for i, j in self._tree.query_pairs(SNAP):
            a, b = self.keys[i], self.keys[j]
            if not any(v == b for v, _, _ in self.adj[a]):
                self.adj[a].append((b, 0.5, {"t": {}, "id": "snap", "snap": True}))
                self.adj[b].append((a, 0.5, {"t": {}, "id": "snap", "snap": True}))

    def nearest(self, e, n):
        d, i = self._tree.query([e, n])
        return self.keys[i], float(d)

    def route(self, a, b, penalty=None):
        """Dijkstra from node key a to b.  penalty(way) -> multiplier (>= 1)."""
        dist = {a: 0.0}
        prev = {}
        pq = [(0.0, a)]
        while pq:
            d, u = heapq.heappop(pq)
            if u == b:
                break
            if d > dist.get(u, 1e18):
                continue
            for v, c, w in self.adj[u]:
                m = penalty(w) if penalty else (6.0 if w['t'].get('service') else 1.0)
                nd = d + c * m
                if nd < dist.get(v, 1e18):
                    dist[v] = nd
                    prev[v] = (u, w)
                    heapq.heappush(pq, (nd, v))
        if b not in prev and a != b:
            return None
        path, ways, u = [b], [], b
        while u != a:
            p, w = prev[u]
            ways.append(w)
            path.append(p)
            u = p
        path.reverse()
        ways.reverse()
        return path, ways


def resample(pts, step):
    """Resample a polyline (N,2) at `step` m (arc length from the first point): returns (xy, s)."""
    pts = np.asarray(pts, float)
    seg = np.hypot(*np.diff(pts, axis=0).T)
    s = np.r_[0.0, np.cumsum(seg)]
    n = max(2, int(math.floor(s[-1] / step)) + 1)
    ss = np.linspace(0, s[-1], n)
    return np.c_[np.interp(ss, s, pts[:, 0]), np.interp(ss, s, pts[:, 1])], ss
