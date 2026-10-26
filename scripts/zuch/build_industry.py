#!/usr/bin/env python3
"""W3: industrial silhouettes (steelworks halls, chimneys, tanks, cooling towers, pipe racks, logistics sheds) beside a real route.

    PY=/Users/Ian/Library/Caches/luxtram-work/.venv/bin/python
    $PY scripts/zuch/build_industry.py south [--plot x.png]     # adds legs[<id>].industry to pb/train-sim/data/real/<route>-features.json (run AFTER build_real_route.py emit)

Sources: OSM industrial landuse polygons (the zones), the national LOD2.2 3D buildings of the communes along the route (footprint, eave and ridge height, scripts/zuch/lod2_zone_buildings.py),
OSM man_made chimney / storage_tank / tower:type=cooling.  Every object is mapped like the rest of the real scenery: its vertices go through the leg mapping (real s -> game s, lateral
distance unchanged), so the compressed legs squash the works along the track; a hall is then stretched along the track again as far as it does not touch its neighbours (EXPAND_MAX).
Objects inside a station patch (the patch draws its own LOD2 buildings) are dropped.

Record formats (game coordinates of the leg, centre `s` / `l` = along / lateral right, polygon `p` relative to the centre as [ds, dl]):
    {"k":"h","s","l","p":[[ds,dl]..],"e":eave m,"r":ridge m,"th":ridge direction rad in the (s, l) plane (0 = along the track)}     hall (extruded polygon, gable / flat roof)
    {"k":"c","s","l","h","r":base radius}                                                                                           chimney
    {"k":"t","s","l","h","r"}                                                                                                       storage tank / silo / gas holder
    {"k":"w","s","l","h","r"}                                                                                                       cooling tower
    {"k":"p","s","l","th","len","w","h"}                                                                                           pipe rack / conveyor bridge
"""
import argparse
import json
import math
import os
import pickle
import sys

import numpy as np
import shapely
from shapely import STRtree
from shapely.affinity import rotate, scale, translate
from shapely.geometry import LineString, Point, Polygon

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_real_route as brr  # noqa: E402
import real_line_scenery as sc  # noqa: E402
from lod2_zone_buildings import zone_buildings  # noqa: E402
from osm_rail import bbox_wgs, read_layer  # noqa: E402

REPO = brr.REPO
OUT = brr.OUT
CACHE = brr.CACHE
LUX = os.path.join(os.path.expanduser("~/Library/Caches/zuch-work"), "lux.osm.pbf")

CFG = {
    "south": {
        "communes": ["bettembourg", "kayl", "roeser", "schifflange", "esch-sur-alzette", "sanem", "differdange", "petange"],
        "box": (266000, 5480000, 296000, 5500000),
        "zone_dist": 750.0,        # industrial landuse polygons within this distance of the line
        "zone_min_area": 6000.0,
    },
}
MAX_LAT = 480.0          # objects further from the track are not drawn
MIN_LAT = 6.5
MIN_HALL_AREA = 140.0
CHIMNEY_MIN_H = 30.0
TANK_FILL = (0.72, 0.86)        # footprint area / bounding square of a round tank
PATCH_REACH_S = 335.0           # the station patch frame: +-320 m along, +-160 m across
PATCH_REACH_L = 170.0
EXPAND_MAX = 1.9
EXPAND_STEPS = (1.9, 1.6, 1.35, 1.15, 1.0)
EXPAND_MAX_LEN = 200.0     # m: a hall is not stretched beyond this along the track
MAX_VERTS = 12


def hall_polygon(poly):
    p = poly.simplify(1.2, preserve_topology=True)
    if p.geom_type != "Polygon" or p.is_empty:
        p = poly.minimum_rotated_rectangle
    if len(p.exterior.coords) - 1 > MAX_VERTS:
        p = poly.minimum_rotated_rectangle if poly.area / max(1.0, poly.minimum_rotated_rectangle.area) > 0.7 else poly.convex_hull.simplify(2.0)
    if p.geom_type != "Polygon":
        p = poly.minimum_rotated_rectangle
    return p


def rect_info(poly):
    """(centre, length, width, angle of the long axis in radians) of the minimum rotated rectangle."""
    r = poly.minimum_rotated_rectangle
    c = np.array(r.exterior.coords)[:4]
    e = [c[(i + 1) % 4] - c[i] for i in range(4)]
    l0, l1 = np.hypot(*e[0]), np.hypot(*e[1])
    v = e[0] if l0 >= l1 else e[1]
    return np.array(r.centroid.coords[0]), max(l0, l1), min(l0, l1), math.atan2(v[1], v[0])


def classify(rec):
    """hall | chimney | tank | rack from a LOD2 building record."""
    fp = rec["fp"]
    c, ln, wd, ang = rect_info(fp)
    fill = fp.area / max(1.0, ln * wd)
    r_eq = math.sqrt(fp.area / math.pi)
    if ln <= 14.0 and rec["ridge"] >= CHIMNEY_MIN_H and fp.area < 160.0:
        return "c", {"h": rec["ridge"], "r": r_eq}
    if ln <= 60.0 and wd / ln > 0.8 and TANK_FILL[0] <= fp.area / (ln * ln) <= TANK_FILL[1] and 30.0 <= fp.area <= 2600.0 and rec["ridge"] >= 3.0 and fill < 0.9:
        return "t", {"h": rec["ridge"], "r": r_eq}
    if ln >= 28.0 and wd <= 6.5 and rec["ridge"] >= 3.5:
        return "p", {"len": ln, "w": wd, "h": rec["ridge"], "ang": ang}
    return "h", {}


def load_osm(route, cfg):
    path = os.path.join(CACHE, "industry-%s.pkl" % route)
    if os.path.exists(path):
        with open(path, "rb") as f:
            return pickle.load(f)
    bb = bbox_wgs(*cfg["box"])
    out = {}
    for name, layer, where in [
        ("man_points", "points", "man_made IS NOT NULL"),
        ("man_polys", "multipolygons", "man_made IS NOT NULL OR other_tags LIKE '%\"tower:type\"=>\"cooling\"%'"),
        ("man_lines", "lines", "man_made IS NOT NULL"),
        ("landuse", "multipolygons", "landuse='industrial' OR man_made='works'"),
    ]:
        feats = read_layer(layer, bb, where=where, pbfs=[LUX])
        out[name] = [{"id": f["id"], "wkb": f["g"].wkb, "t": f["t"]} for f in feats]
        print("  OSM", name, len(feats), flush=True)
    with open(path, "wb") as f:
        pickle.dump(out, f)
    return out


class Mapper:
    """Real UTM point -> (leg id, game s, lateral) with the leg mappings of build_real_route (legs + 290 m station blocks)."""

    def __init__(self, attrs, metas):
        self.attrs = attrs
        self.line = LineString(attrs.xy)
        self.metas = metas
        self.geoms = {lid: sc.LegGeom(attrs, m) for lid, m in metas.items()}
        self.order = sorted(metas, key=lambda k: metas[k]["real"][0])

    def leg_of(self, sr):
        for lid in self.order:
            a, b = self.metas[lid]["real"]
            if a <= sr <= b:
                return lid
        return None

    def game_s(self, g, sr):
        """real -> game s with linear extension beyond the leg ends (so a vertex a little outside the leg keeps a sensible position)."""
        if sr < g.a:
            k0 = (g.game[1] - g.game[0]) / max(1e-6, g.real[1] - g.real[0])
            return float(g.game[0] + (sr - g.a) * k0)
        if sr > g.b:
            k1 = (g.game[-1] - g.game[-2]) / max(1e-6, g.real[-1] - g.real[-2])
            return float(g.game[-1] + (sr - g.b) * k1)
        return float(g.game_of(sr))

    def to_game(self, lid, pts):
        g = self.geoms[lid]
        out = []
        for q in pts:
            sr = float(self.line.project(Point(q)))
            sc_ = min(max(sr, g.a - 400), g.b + 400)
            p, r, _ = g.frame(np.array([min(max(sc_, 0), self.attrs.length - 0.01)]))
            lat = float(np.dot(np.asarray(q) - p[0], r[0]))
            out.append((self.game_s(g, sc_), lat))
        return out


def station_patch_boxes(route, attrs, line):
    """Rectangles (real s0, s1, lat0, lat1) of the station patches of the route (stops from the layout file)."""
    with open(os.path.join(OUT, "%s-layout.json" % route)) as f:
        lay = json.load(f)
    return [(st["s_real"] - PATCH_REACH_S, st["s_real"] + PATCH_REACH_S) for st in lay["stations"].values()], lay


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("route", choices=sorted(CFG))
    ap.add_argument("--plot", default="")
    args = ap.parse_args()
    route = args.route
    cfg = CFG[route]
    res = brr.build(route)
    attrs = res["attrs"]
    line = LineString(attrs.xy)
    with open(os.path.join(CACHE, "%s-legs-meta.json" % route)) as f:
        legs_meta = json.load(f)
    patch_s, lay = station_patch_boxes(route, attrs, line)
    metas = dict(legs_meta)
    for name, st in lay["stations"].items():
        metas["st:" + name] = {"real": [st["s_real"] - brr.HALF_BLOCK, st["s_real"] + brr.HALF_BLOCK], "k": 1.0, "mapping": [[0.0, 0.0], [2 * brr.HALF_BLOCK, 2 * brr.HALF_BLOCK]]}
    mp = Mapper(attrs, metas)
    osm = load_osm(route, cfg)

    # zones
    zones = []
    for it in osm["landuse"]:
        g = shapely.from_wkb(it["wkb"])
        if g.area >= cfg["zone_min_area"] and line.distance(g) <= cfg["zone_dist"] and it["t"].get("wastewater") is None and it["t"].get("man_made") != "wastewater_plant":
            zones.append(g.buffer(4.0))
    print("zones", len(zones), "area km2 %.2f" % (sum(z.area for z in zones) / 1e6), flush=True)
    blds = zone_buildings(cfg["communes"], zones)
    print("LOD2 buildings in zones", len(blds), flush=True)

    objs = []   # (kind, centre utm, props, poly utm)
    for rec in blds:
        fp = rec["fp"]
        if line.distance(fp) > MAX_LAT + 60 or rec["area"] < MIN_HALL_AREA and classify(rec)[0] == "h":
            continue
        k, props = classify(rec)
        objs.append((k, fp, rec, props))
    # OSM man-made objects
    for it in osm["man_points"]:
        t = it["t"]
        g = shapely.from_wkb(it["wkb"])
        if t.get("man_made") == "chimney" and line.distance(g) <= MAX_LAT + 60:
            h = float(t.get("height", "0") or 0) or 60.0
            objs.append(("c", g.buffer(3.0), {"ridge": h, "gid": it["id"], "area": 28.0}, {"h": h, "r": 3.0}))
    for it in osm["man_polys"]:
        t = it["t"]
        g = shapely.from_wkb(it["wkb"])
        if line.distance(g) > MAX_LAT + 60:
            continue
        mm = t.get("man_made")
        if mm == "chimney":
            h = float(t.get("height", "0") or 0) or 60.0
            objs.append(("c", g, {"ridge": h, "gid": it["id"], "area": g.area}, {"h": h, "r": math.sqrt(g.area / math.pi)}))
        elif mm in ("storage_tank", "silo") and g.area >= 25.0:
            objs.append(("t", g, {"ridge": 12.0, "gid": it["id"], "area": g.area}, {"h": float(t.get("height", "0") or 0) or 12.0, "r": math.sqrt(g.area / math.pi)}))
        elif t.get("tower:type") == "cooling" or t.get("man_made") == "cooling_tower":
            objs.append(("w", g, {"ridge": 45.0, "gid": it["id"], "area": g.area}, {"h": float(t.get("height", "0") or 0) or 45.0, "r": math.sqrt(g.area / math.pi)}))
    print("objects", len(objs), {k: sum(1 for o in objs if o[0] == k) for k in "hctwp"}, flush=True)

    # drop the ones inside a station patch (real s window and |lat| <= PATCH_REACH_L)
    kept = []
    for k, fp, rec, props in objs:
        c = fp.centroid
        sr = float(line.project(c))
        pt = line.interpolate(sr)
        latr = float(c.distance(pt))
        in_patch = any(a <= sr <= b for a, b in patch_s) and latr <= PATCH_REACH_L
        if in_patch and k in ("h", "p", "t"):
            continue
        kept.append((k, fp, rec, props, sr))
    print("after the station patches", len(kept), flush=True)

    per_leg = {}
    for k, fp, rec, props, sr in kept:
        lid = mp.leg_of(sr)
        if lid is None:
            continue
        per_leg.setdefault(lid, []).append((k, fp, rec, props, sr))

    out = {}
    plot_polys = []
    for lid, items in per_leg.items():
        g = mp.geoms[lid]
        items.sort(key=lambda it: -it[2]["area"])
        placed, shapes = [], []
        recs = []
        for k, fp, rec, props, sr in items:
            if k == "h" or k == "p":
                verts = list(hall_polygon(fp).exterior.coords)[:-1]
                gp = mp.to_game(lid, verts)
                poly = Polygon(gp)
                if not poly.is_valid:
                    poly = poly.buffer(0)
                if poly.is_empty or poly.geom_type != "Polygon":
                    continue
                cs, cl = poly.centroid.x, poly.centroid.y
                if abs(cl) > MAX_LAT or (poly.bounds[1] < MIN_LAT and poly.bounds[3] > -MIN_LAT):
                    continue
                best = None
                for e in EXPAND_STEPS:
                    if e > 1.0 and (poly.bounds[2] - poly.bounds[0]) * e > EXPAND_MAX_LEN:
                        continue
                    cand = scale(poly, xfact=e, yfact=1.0, origin=(cs, cl))
                    if not any(cand.buffer(-0.4).intersects(q) for q in placed):
                        best = cand
                        break
                if best is None:
                    continue
                placed.append(best)
                # ridge direction: the long axis of the game-space polygon
                c2, ln2, wd2, ang2 = rect_info(best)
                rel = [[round(x - cs, 1), round(y - cl, 1)] for x, y in list(best.exterior.coords)[:-1]]
                if k == "p":
                    recs.append({"k": "p", "s": round(cs, 1), "l": round(cl, 1), "th": round(ang2, 3), "len": round(ln2, 1), "w": round(max(1.4, wd2), 1), "h": round(rec["ridge"], 1)})
                else:
                    recs.append({"k": "h", "s": round(cs, 1), "l": round(cl, 1), "p": rel, "e": round(rec["eave"], 1), "r": round(rec["ridge"], 1), "th": round(ang2, 3)})
                plot_polys.append((best, "p" if k == "p" else "h"))
            else:
                c = fp.centroid
                gp = mp.to_game(lid, [(c.x, c.y)])[0]
                if abs(gp[1]) > MAX_LAT or abs(gp[1]) < MIN_LAT + props["r"]:
                    continue
                pt = Point(gp)
                r = props["r"]
                recs.append({"k": k, "s": round(gp[0], 1), "l": round(gp[1], 1), "h": round(props["h"], 1), "r": round(max(0.8, props["r"]), 1)})
                plot_polys.append((pt.buffer(r), k))
        if recs:
            out[lid] = recs
            print("  ", lid, g.length and "%.0f m" % g.length, len(recs), "objects", flush=True)

    path = os.path.join(OUT, "%s-features.json" % route)
    with open(path) as f:
        doc = json.load(f)
    for lid, leg in doc["legs"].items():
        leg.pop("industry", None)
        if lid in out:
            leg["industry"] = out[lid]
    doc["industry"] = 1
    with open(path, "w") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
    print("features ->", path, os.path.getsize(path) // 1024, "kB; objects", sum(len(v) for v in out.values()), flush=True)


if __name__ == "__main__":
    main()
