#!/usr/bin/env python3
"""Stage 1 of the real-line pipeline: the main-track centre line of every part of the Mosel line (shared A, west branch W, Trier Hbf
branch H, shared tail B) from OSM, the stops projected on it, and the legs between consecutive stops.

Everything is cached in ~/Library/Caches/zuch-work/realline/path-<tile>.pkl.
"""
import os
import pickle
import sys

import numpy as np
import shapely
from shapely.geometry import LineString, Point

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from osm_rail import WORK, RailGraph, bbox_wgs, read_layer, resample  # noqa: E402

CACHE = os.path.join(WORK, "realline")

# One entry per stop of the line.  osm = name of the OSM station / halt node; game = name in the simulator; size / biome as in routes.js.
# segment: A shared Luxembourg - Trier-Zewen, W west branch (Weststrecke), H Trier Hbf branch (Moselstrecke), B shared tail.
STOPS = [
    ("A", "Luxembourg", "Lëtzebuerg", 3),
    ("A", "Cents-Hamm", "Cents-Hamm", 1),
    ("A", "Sandweiler-Contern", "Sandweiler-Contern", 1),
    ("A", "Oetrange", "Oetrange", 1),
    ("A", "Munsbach", "Munsbach", 1),
    ("A", "Roodt", "Roodt-Syr", 1),
    ("A", "Betzdorf", "Betzder", 1),
    ("A", "Wecker", "Wecker", 1),
    ("A", "Manternach", "Manternach", 2),
    ("A", "Mertert", "Mertert", 1),
    ("A", "Wasserbillig", "Wasserbëlleg", 2),
    ("A", "Igel", "Igel", 1),
    ("W", "Trier-Zewen", "Tréier-Zewen", 1),
    ("W", "Trier-Euren", "Tréier-Euren", 1),
    ("W", "Trier West", "Tréier West", 1),
    ("W", "Trier-Pallien", "Tréier-Pallien", 1),
    ("H", "Kreuz Konz", "Kreuz Konz", 1),
    ("H", "Trier Süd", "Tréier Süd", 1),
    ("H", "Trier Hbf", "Tréier Hbf", 3),
    ("B", "Trier Hafenstraße", "Tréier Hafestrooss", 1),
    ("B", "Trier-Ehrang Ort", "Ehrang Ort", 1),
    ("B", "Trier-Quint", "Quint", 1),
    ("B", "Schweich DB", "Schweich", 1),
    ("B", "Föhren", "Föhren", 1),
    ("B", "Hetzerath", "Hetzerath", 1),
    ("B", "Sehlem (Kreis Wittlich)", "Sehlem", 1),
    ("B", "Salmtal", "Salmtal", 1),
    ("B", "Wittlich Hauptbahnhof", "Wittlich", 2),
]

# route plan: node sequences (OSM names) the Dijkstra has to pass.  The last A node is the junction stop Trier-Zewen.
PLAN = {
    "A": ["Luxembourg", "Wasserbillig", "Igel"],
    "W": ["Igel", "Trier-Zewen", "Trier-Euren", "Trier West", "Trier-Pallien", "Trier-Ehrang Ort"],
    "H": ["Igel", "Kreuz Konz", "Trier Süd", "Trier Hbf", "Pfalzel", "Trier-Ehrang Ort"],
    "B": ["Trier-Ehrang Ort", "Trier-Quint", "Schweich DB", "Föhren", "Hetzerath", "Sehlem (Kreis Wittlich)", "Salmtal", "Wittlich Hauptbahnhof"],
}


LAYERS = ("rails", "railpoints", "waterways", "highways", "landuse", "places", "misc")


def load_tiles(layers=LAYERS):
    out = {k: [] for k in layers}
    seen = {k: set() for k in layers}
    for tile in sorted(f for f in os.listdir(CACHE) if f.startswith("corridor-")):
        with open(os.path.join(CACHE, tile), "rb") as f:
            d = pickle.load(f)
        for key in out:
            for it in d.get(key, []):
                if it["id"] in seen[key]:
                    continue
                seen[key].add(it["id"])
                out[key].append({"id": it["id"], "g": shapely.from_wkb(it["wkb"]), "t": it["t"]})
    return out


def stop_points(railpoints):
    pts = {}
    for p in railpoints:
        if p["t"].get("railway") in ("station", "halt") and p["t"].get("name"):
            pts.setdefault(p["t"]["name"], p["g"])
    return pts


def build_paths(tiles=None):
    """Dijkstra chains per segment.  Returns {seg: LineString (UTM)} and the stop points."""
    tiles = tiles or load_tiles()
    ways = [w for w in tiles["rails"] if w["t"].get("railway") == "rail" and w["t"].get("service") not in ("yard", "siding", "spur")]
    G = RailGraph(ways)
    pts = stop_points(tiles["railpoints"])
    paths = {}
    for seg, names in PLAN.items():
        names = [n for n in names if n in pts]
        chain, way_tags = [], []
        for a, b in zip(names[:-1], names[1:]):
            na, _ = G.nearest(pts[a].x, pts[a].y)
            nb, _ = G.nearest(pts[b].x, pts[b].y)
            r = G.route(na, nb)
            if r is None:
                print("WARNING: no rail route %s -> %s, line ends at %s" % (a, b, a))
                break
            path, wl = r
            chain += path if not chain else path[1:]
            way_tags += [(w["t"], w["id"]) for w in wl]
        paths[seg] = {"xy": np.array(chain), "ways": way_tags}
    return paths, pts


def station_s(path_xy, pt, platforms=()):
    """Arc length of the stop on the path: the projection of the platform centre when a platform is known, else of the station node."""
    line = LineString(path_xy)
    if platforms:
        c = shapely.unary_union(list(platforms)).centroid
        return line.project(c), line.distance(c)
    return line.project(pt), line.distance(pt)


def save(name, obj):
    os.makedirs(CACHE, exist_ok=True)
    with open(os.path.join(CACHE, name), "wb") as f:
        pickle.dump(obj, f)


if __name__ == "__main__":
    paths, pts = build_paths()
    for seg, p in paths.items():
        xy = p["xy"]
        L = float(np.hypot(*np.diff(xy, axis=0).T).sum())
        print(seg, len(xy), "nodes", round(L), "m")
        for sg, osm, game, size in STOPS:
            if sg == seg or (seg == "B" and osm == "Trier-Ehrang Ort"):
                s, d = station_s(xy, pts[osm])
                print("   ", game, round(s), "m  off-path", round(d), "m")
