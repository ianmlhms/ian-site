#!/usr/bin/env python3
"""Luxtram "painted realism": LOD2 buildings with the context the facade system needs (P-FACADE).

Replaces the building step of build_luxtram_geo.py (which still bakes the *orthophoto* median colour into every roof).  This one does not touch
the orthophoto at all: roof colours are decided in the game from the OSM tags (roof:colour / roof:material / roof:shape), the building type, the
district and the roof geometry.  What it adds to the old b/<i>_<j>.bin:
  * OSM building subtype (apartments, house, retail, ...), roof:levels, roof:shape, roof:material, roof:colour, building:colour
  * the number of shops / cafes / banks around the building (OSM shop_*.json, scripts/fetch_luxtram_shops.py)
  * ring structure: roof / wall polygons (facets) stay separate, so the game can put an integer number of window bays on every wall and
    dormers on real roof facets
  * per wall: faces a road (which class), party wall (another building touches it), shop type of the POI in front

Run with the venv python:
  /Users/Ian/Library/Caches/luxtram-work/.venv/bin/python scripts/build_luxtram_facades.py
Writes pb/train-sim/data/luxtram/bf/<i>_<j>.bin  (the old b/ directory is obsolete, `git rm -r` it).

bf/<i>_<j>.bin: u16 count, then per building
  u8 kind, u8 levels, u8 flags (1 roof rgb, 2 wall rgb), u8 roof rgb x3, u8 wall rgb x3,
  u8 sub, u8 roofLevels, u8 roofShape, u8 roofMat, u8 shopsNear, u8 spare,
  i32 ax, az, ay (dm), u16 nv nR nW nB nRR nWR,
  i16 V[nv*3] (5 cm from the anchor), u16 R[nR*3], u16 W[nW*3], u16 B[nB],
  u16 roofRingTris[nRR], u16 wallRingTris[nWR], u8 wallInfo[nWR]
  wallInfo: bits 0-2 road class in front (0 none, 1 primary/secondary, 2 tertiary/residential, 3 pedestrian, 4 service),
            bits 3-5 shop type in front (0 none, 1 shop, 2 food, 3 bank/office, 4 pharmacy, 5 hotel, 6 culture), bit 6 party wall.
"""
import json
import math
import os
import pickle
import struct
import sys
from collections import defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import luxtram_geo as G  # noqa: E402
import build_luxtram as B  # noqa: E402

OUT = os.path.join(HERE, "..", "pb", "train-sim", "data", "luxtram", "bf")
INDEX = os.path.join(HERE, "..", "pb", "train-sim", "data", "luxtram", "index.json")
RAW = B.RAW_DEFAULT
Q5 = 20.0
R_FULL = 170.0

SUB = ["", "yes", "apartments", "residential", "house", "detached", "terrace", "semidetached_house", "dormitory", "office", "commercial", "retail",
       "supermarket", "hotel", "public", "civic", "government", "school", "kindergarten", "university", "college", "hospital", "museum", "church",
       "chapel", "cathedral", "garage", "garages", "roof", "shed", "carport", "service", "industrial", "warehouse", "parking", "train_station",
       "stadium", "sports_hall", "sports_centre", "theatre", "cinema", "construction", "greenhouse", "container", "kiosk", "tower", "mall"]
SUB_IX = {n: i for i, n in enumerate(SUB)}
ROOF_SHAPE = ["", "flat", "gabled", "hipped", "pyramidal", "skillion", "dome", "half-hipped", "mansard", "gambrel", "round", "cone", "saltbox", "many"]
ROOF_MAT = ["", "roof_tiles", "slate", "metal", "copper", "zinc", "concrete", "gravel", "glass", "grass", "tar_paper", "eternit", "thatch"]
ROAD_CLASS = {"trunk": 1, "primary": 1, "secondary": 1, "tertiary": 2, "unclassified": 2, "residential": 2, "living_street": 2, "pedestrian": 3,
              "service": 4, "motorway_link": 0, "trunk_link": 1, "primary_link": 1, "secondary_link": 1, "tertiary_link": 2}
SHOP_AMENITY = {"restaurant": 2, "cafe": 2, "fast_food": 2, "bar": 2, "pub": 2, "ice_cream": 2, "bakery": 2, "bank": 3, "post_office": 3,
                "bureau_de_change": 3, "pharmacy": 4, "cinema": 6, "theatre": 6, "marketplace": 1}


def triangulate(ring3):
    import mapbox_earcut as earcut
    n = len(ring3)
    if n < 3:
        return []
    if n == 3:
        return [(0, 1, 2)]
    e1 = ring3[1] - ring3[0]
    ax = np.zeros(3)
    for k in range(1, n - 1):
        ax += np.cross(ring3[k] - ring3[0], ring3[k + 1] - ring3[0])
    drop = int(np.abs(ax).argmax())
    cols = [c for c in (0, 1, 2) if c != drop]
    p2 = np.ascontiguousarray(ring3[:, cols], dtype=np.float64)
    idx = earcut.triangulate_float64(p2, np.array([n], dtype=np.uint32))
    del e1
    return [tuple(int(v) for v in idx[k:k + 3]) for k in range(0, len(idx), 3)]


def load_osm():
    from shapely.geometry import Polygon
    from shapely.strtree import STRtree
    els = B.load_many(RAW, "bld")
    polys, tags, seen = [], [], set()
    for el in els:
        key = (el["type"], el["id"])
        if key in seen:
            continue
        seen.add(key)
        t = el.get("tags", {})
        rings = B.relation_rings(el) if el["type"] == "relation" else [B.ring_from_way(el)]
        for r in rings:
            if r and len(r) >= 3:
                p = Polygon(r)
                if p.is_valid and p.area > 5:
                    polys.append(p)
                    tags.append(t)
    return STRtree(polys), polys, tags


def load_roads():
    from shapely.geometry import LineString
    from shapely.strtree import STRtree
    lines, cls = [], []
    for el in B.load_many(RAW, "road"):
        t = el.get("tags", {})
        c = ROAD_CLASS.get(t.get("highway", ""), 0)
        if not c or "geometry" not in el:
            continue
        if t.get("tunnel") in ("yes", "building_passage") or t.get("covered") == "yes":
            continue
        pts = [G.lonlat_to_local(p["lon"], p["lat"]) for p in el["geometry"]]
        pts = [(float(x), float(z)) for x, z in pts]
        if len(pts) >= 2:
            lines.append(LineString(pts))
            cls.append(c)
    return STRtree(lines), lines, cls


def load_shops():
    out = []
    for f in sorted(os.listdir(RAW)):
        if not (f.startswith("shop_") and f.endswith(".json")):
            continue
        for el in json.load(open(os.path.join(RAW, f)))["elements"]:
            t = el.get("tags", {})
            c = el.get("center") or ({"lat": el["lat"], "lon": el["lon"]} if "lat" in el else None)
            if not c:
                continue
            typ = 0
            if "shop" in t:
                typ = 1
                if t["shop"] in ("bakery", "pastry", "confectionery", "butcher", "deli", "coffee", "wine"):
                    typ = 2 if t["shop"] in ("coffee",) else 1
                if t["shop"] in ("chemist", "optician", "hairdresser", "beauty", "mobile_phone") and False:
                    typ = 1
            elif t.get("amenity") in SHOP_AMENITY:
                typ = SHOP_AMENITY[t["amenity"]]
            elif t.get("tourism") in ("hotel", "hostel"):
                typ = 5
            elif t.get("tourism") in ("gallery", "museum"):
                typ = 6
            elif "craft" in t:
                typ = 1
            elif "office" in t:
                typ = 3
            if typ:
                x, z = G.lonlat_to_local(c["lon"], c["lat"])
                out.append((float(x), float(z), typ))
    # dedupe node + way duplicates
    seen, res = set(), []
    for x, z, t in out:
        k = (round(x), round(z), t)
        if k not in seen:
            seen.add(k)
            res.append((x, z, t))
    return res


def rgb_int(hexs):
    h = B.hex_color(hexs) if hexs else 0
    return h or 0


def pack(rec, ctx):
    from shapely.geometry import Point, Polygon
    verts, vkey = [], {}

    def vid(p):
        k = (int(round(p[0] * Q5)), int(round(p[1] * Q5)), int(round(p[2] * Q5)))
        if k not in vkey:
            vkey[k] = len(verts)
            verts.append(k)
        return vkey[k]

    roof_t, wall_t, roof_ring, wall_ring = [], [], [], []
    for ring in rec["roofs"]:
        ids = [vid(p) for p in ring]
        n0 = len(roof_t)
        for t in triangulate(ring):
            tri = (ids[t[0]], ids[t[1]], ids[t[2]])
            if len(set(tri)) == 3:
                roof_t.extend(tri)
        if len(roof_t) > n0:
            roof_ring.append((len(roof_t) - n0) // 3)
    wall_geo = []
    for ring in rec["walls"]:
        ids = [vid(p) for p in ring]
        n0 = len(wall_t)
        for t in triangulate(ring):
            tri = (ids[t[0]], ids[t[1]], ids[t[2]])
            if len(set(tri)) == 3:
                wall_t.extend(tri)
        if len(wall_t) > n0:
            wall_ring.append((len(wall_t) - n0) // 3)
            wall_geo.append(ring)
    if not verts or len(verts) > 65000:
        return None
    ground_keys = set()
    for ring in rec["ground"]:
        for p in ring:
            ground_keys.add((int(round(p[0] * Q5)), int(round(p[1] * Q5)), int(round(p[2] * Q5))))
    bottom = [i for i, k in enumerate(verts) if k in ground_keys]
    if not bottom:
        zlow = min(v[2] for v in verts)
        bottom = [i for i, k in enumerate(verts) if k[2] <= zlow + 4]
    ax = int(round(rec["c"][0] * 10))
    az = int(round(rec["c"][1] * 10))
    ay = int(round(min(v[2] for v in verts) / Q5 * 10))
    V = []
    for x, z, y in verts:
        V.extend([x - ax * 2, z - az * 2, y - ay * 2])

    # ---- OSM context
    c = Point(rec["c"])
    tags = {}
    for k in ctx["bt"].query(c):
        if ctx["bpolys"][k].contains(c):
            tags = ctx["btags"][k]
            break
    b = tags.get("building") or tags.get("building:part") or "yes"
    kind = B.KIND.get(b, 0)
    lv = tags.get("building:levels", "")
    levels = int(float(lv)) if lv.replace(".", "", 1).isdigit() else 0
    rl = tags.get("roof:levels", "")
    roof_levels = int(float(rl)) if rl.replace(".", "", 1).isdigit() else 0
    sub = SUB_IX.get(b, 1 if b == "yes" else 0)
    shape = ROOF_SHAPE.index(tags.get("roof:shape")) if tags.get("roof:shape") in ROOF_SHAPE else 0
    rmat = ROOF_MAT.index(tags.get("roof:material")) if tags.get("roof:material") in ROOF_MAT else 0
    rcol = rgb_int(tags.get("roof:colour"))
    wcol = rgb_int(tags.get("building:colour"))

    # footprint
    polys = []
    for ring in rec["ground"]:
        if len(ring) >= 3:
            pg = Polygon(ring[:, :2])
            if not pg.is_valid:
                pg = pg.buffer(0)
            if not pg.is_empty and pg.area > 0.5:
                polys.append(pg)
    if polys:
        from shapely.ops import unary_union
        foot = unary_union(polys)
    else:
        foot = Polygon(np.array([[p[0], p[1]] for p in verts]) / Q5).convex_hull
    cen = np.array([rec["c"][0], rec["c"][1]])

    shops_near = 0
    sx = ctx["shop_xy"]
    if len(sx):
        d = np.hypot(sx[:, 0] - cen[0], sx[:, 1] - cen[1])
        shops_near = int(min(255, (d < 38).sum()))

    winfo = []
    for ring in wall_geo:
        xz = ring[:, :2]
        # horizontal tangent: the longest horizontal edge
        best, bt = 0.0, None
        for i in range(len(ring)):
            a = xz[i]
            bq = xz[(i + 1) % len(ring)]
            l = math.hypot(bq[0] - a[0], bq[1] - a[1])
            if l > best:
                best, bt = l, (bq[0] - a[0], bq[1] - a[1])
        info = 0
        if bt is None or best < 1.5:
            winfo.append(0)
            continue
        tx, tz = bt[0] / best, bt[1] / best
        n = np.array([tz, -tx])
        m = xz.mean(axis=0)
        # outward: the point a little in front must be outside the footprint
        if foot.contains(Point(m + n * 0.35)):
            n = -n
        # party wall: another building right in front
        probe = Point(m + n * 0.9)
        party = False
        for k in ctx["ft"].query(probe):
            if ctx["fkeys"][k] != rec["gid"] and ctx["fpolys"][k].distance(probe) < 0.15:
                party = True
                break
        rclass = 0
        shop = 0
        if not party:
            p6 = Point(m + n * 4.0)
            blocked = False
            for k in ctx["ft"].query(p6):
                if ctx["fkeys"][k] != rec["gid"] and ctx["fpolys"][k].distance(p6) < 0.2:
                    blocked = True
                    break
            if not blocked:
                best_d, best_c = 1e9, 0
                for k in ctx["rt"].query(Point(m).buffer(24.0)):
                    ln = ctx["rlines"][k]
                    d = ln.distance(Point(m))
                    if d > 24.0:
                        continue
                    fp = ln.interpolate(ln.project(Point(m)))
                    v = np.array([fp.x - m[0], fp.y - m[1]])
                    if np.dot(v, n) < 0.55 * max(d, 0.01) or d < 0.8:
                        continue
                    if d < best_d:
                        best_d, best_c = d, ctx["rcls"][k]
                rclass = best_c
                if rclass:
                    # a shop / cafe / bank in front of this wall (within 14 m of its middle, on the building side of the road)
                    bd, bt2 = 1e9, 0
                    for (px, pz, ty) in ctx["shops"]:
                        if abs(px - m[0]) > 16 or abs(pz - m[1]) > 16:
                            continue
                        d = math.hypot(px - m[0], pz - m[1])
                        along = (px - m[0]) * tx + (pz - m[1]) * tz
                        out_ = (px - m[0]) * n[0] + (pz - m[1]) * n[1]
                        if abs(along) <= best * 0.6 + 4 and -6 < out_ < 12 and d < bd:
                            bd, bt2 = d, ty
                    shop = bt2
        info = rclass | (shop << 3) | (64 if party else 0)
        winfo.append(info)

    return dict(kind=kind, levels=levels, roof=rcol, wall=wcol, sub=sub, roofLevels=roof_levels, shape=shape, rmat=rmat, shops=shops_near,
                ax=ax, az=az, ay=ay, V=V, nv=len(verts), R=roof_t, W=wall_t, Bt=bottom, rr=roof_ring, wr=wall_ring, wi=winfo)


def write_tile(lst):
    b = bytearray(struct.pack("<H", len(lst)))
    for d in lst:
        flags = (1 if d["roof"] else 0) | (2 if d["wall"] else 0)
        rr = (d["roof"] >> 16 & 255, d["roof"] >> 8 & 255, d["roof"] & 255)
        ww = (d["wall"] >> 16 & 255, d["wall"] >> 8 & 255, d["wall"] & 255)
        b += struct.pack("<BBB6B6B3i6H", d["kind"], min(d["levels"], 255), flags, *rr, *ww, d["sub"], min(d["roofLevels"], 255), d["shape"], d["rmat"],
                         min(d["shops"], 255), 0, d["ax"], d["az"], d["ay"], d["nv"], len(d["R"]) // 3, len(d["W"]) // 3, len(d["Bt"]), len(d["rr"]), len(d["wr"]))
        b += struct.pack("<%dh" % len(d["V"]), *d["V"])
        b += struct.pack("<%dH" % len(d["R"]), *d["R"])
        b += struct.pack("<%dH" % len(d["W"]), *d["W"])
        b += struct.pack("<%dH" % len(d["Bt"]), *d["Bt"])
        b += struct.pack("<%dH" % len(d["rr"]), *d["rr"])
        b += struct.pack("<%dH" % len(d["wr"]), *d["wr"])
        b += struct.pack("<%dB" % len(d["wi"]), *d["wi"])
    return bytes(b)


def main():
    from shapely.geometry import Polygon
    from shapely.strtree import STRtree
    meta = json.load(open(INDEX))["tiles"]
    blds = pickle.load(open(os.path.join(G.RAW_GEO, "lod2_corridor.pkl"), "rb"))
    bt, bpolys, btags = load_osm()
    rt, rlines, rcls = load_roads()
    shops = load_shops()
    print("osm buildings", len(bpolys), "roads", len(rlines), "shop points", len(shops))
    fpolys, fkeys = [], []
    for rec in blds:
        rings = [Polygon(r[:, :2]) for r in rec["ground"] if len(r) >= 3] or [Polygon(r[:, :2]) for r in rec["roofs"] if len(r) >= 3]
        for pg in rings:
            if not pg.is_valid:
                pg = pg.buffer(0)
            if not pg.is_empty:
                fpolys.append(pg)
                fkeys.append(rec["gid"])
    ctx = dict(bt=bt, bpolys=bpolys, btags=btags, rt=rt, rlines=rlines, rcls=rcls, shops=shops, shop_xy=np.array([(s[0], s[1]) for s in shops]).reshape(-1, 2),
               ft=STRtree(fpolys), fpolys=fpolys, fkeys=fkeys)
    per_tile = defaultdict(list)
    n = 0
    for rec in sorted(blds, key=lambda r: (int(math.floor(r["c"][0] / G.TILE)), int(math.floor(r["c"][1] / G.TILE)))):
        i, j = int(math.floor(rec["c"][0] / G.TILE)), int(math.floor(rec["c"][1] / G.TILE))
        if rec["d"] > R_FULL or ("%d_%d" % (i, j)) not in meta:
            continue
        pk = pack(rec, ctx)
        if pk:
            per_tile["%d_%d" % (i, j)].append(pk)
            n += 1
        if n % 500 == 0:
            print(" ", n, flush=True)
    os.makedirs(OUT, exist_ok=True)
    for fn in os.listdir(OUT):
        os.remove(os.path.join(OUT, fn))
    total = 0
    for key, lst in per_tile.items():
        data = write_tile(lst)
        with open(os.path.join(OUT, key + ".bin"), "wb") as fh:
            fh.write(data)
        total += len(data)
    print("buildings: %d in %d tiles, %.2f MB" % (n, len(per_tile), total / 1e6))
    stats = defaultdict(int)
    for lst in per_tile.values():
        for d in lst:
            for w in d["wi"]:
                stats["front" if w & 7 else "back"] += 1
                if (w >> 3) & 7:
                    stats["shop"] += 1
                if w & 64:
                    stats["party"] += 1
    print(dict(stats))


if __name__ == "__main__":
    main()
