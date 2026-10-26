#!/usr/bin/env python3
"""W2c: OSM -> leg geometry + scenery for the single-line routes (north, south, west, and the abroad routes), the generalisation of build_real_line.py
(which stays Mosel-specific: three services on one line with two branches).  Decision and method: pb/train-sim/REAL-LINES.md ("Wave 2" and "W2c").

    PY=/Users/Ian/Library/Caches/luxtram-work/.venv/bin/python
    $PY scripts/zuch/fetch_route_corridor.py              # once: OSM features of the corridors (route-<tile>.pkl)
    $PY scripts/zuch/build_real_route.py plan north       # path, stops, legs (prints; --plot x.png writes the heading QA sheet)
    $PY scripts/zuch/build_real_route.py emit north       # writes pb/train-sim/real-north.js + data/real/north-{layout,features}.json

Everything of the Mosel pipeline is reused (fit, DEM, land classes, scenery rasters); only the line handling differs: one chain of stops joined by Dijkstra
on the rail graph, no branches.  Options per route in real_route_defs.py (stops, tiles); speed / length parameters below.
"""
import argparse
import json
import os
import pickle
import sys

import numpy as np
import shapely
from shapely import STRtree
from shapely.geometry import LineString, Point

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_real_line as brl  # noqa: E402
import real_line_scenery as sc  # noqa: E402
from osm_rail import RailGraph, num, resample  # noqa: E402
from real_line_dem import Dem  # noqa: E402
from real_line_land import LandIndex  # noqa: E402
from real_line_path import CACHE  # noqa: E402
from real_route_defs import ROUTES  # noqa: E402

REPO = brl.REPO
OUT = brl.OUT
HALF_BLOCK = brl.HALF_BLOCK
PLATFORM_LAT_MAX = 45.0       # platforms / parallel tracks beyond this lateral distance from the main track are not part of the station
PLATFORM_REACH = 170.0        # ... and beyond this distance along it from the stop
BRIDGE_VIADUCT_MIN_H = 9.0
BIG_BRIDGE_LEN = 140.0        # a bridge longer than this over water with a high deck is a viaduct (Pfaffenthal / Pulvermuehle), not a river bridge


def load_route_tiles(names):
    layers = ("rails", "railpoints", "waterways", "highways", "landuse", "places", "misc")
    out = {k: [] for k in layers}
    seen = {k: set() for k in layers}
    for name in names:
        with open(os.path.join(CACHE, "route-%s.pkl" % name), "rb") as f:
            d = pickle.load(f)
        for key in out:
            for it in d.get(key, []):
                if it["id"] in seen[key]:
                    continue
                seen[key].add(it["id"])
                out[key].append({"id": it["id"], "g": shapely.from_wkb(it["wkb"]), "t": it["t"]})
    return out


def stop_node(railpoints, osm, hint=None):
    """The OSM station / halt node called `osm`; with a (lat, lon) hint the one nearest to it (names that exist twice)."""
    cands = [p for p in railpoints if p["t"].get("railway") in ("station", "halt") and p["t"].get("name") == osm]
    if not cands:
        raise SystemExit("no OSM station node called %r" % osm)
    if hint:
        from osm_rail import utm
        e, n = utm(hint[1], hint[0])
        cands.sort(key=lambda p: (p["g"].x - e) ** 2 + (p["g"].y - n) ** 2)
    return cands[0]["g"]


def build_path(tiles, spec):
    ways = [w for w in tiles["rails"] if w["t"].get("railway") == "rail" and w["t"].get("service") not in ("yard", "siding", "spur")]
    G = RailGraph(ways)
    pts = [stop_node(tiles["railpoints"], s[0], s[3] if len(s) > 3 else None) for s in spec["stops"]]
    chain, tags = [], []
    for (a, b), sa, sb in zip(zip(pts[:-1], pts[1:]), spec["stops"][:-1], spec["stops"][1:]):
        na, _ = G.nearest(a.x, a.y)
        nb, _ = G.nearest(b.x, b.y)
        r = G.route(na, nb)
        if r is None:
            raise SystemExit("no rail route %s -> %s" % (sa[0], sb[0]))
        path, wl = r
        chain += path if not chain else path[1:]
        tags += [(w["t"], w["id"]) for w in wl]
    route = brl.remove_spurs(np.array(chain), tags)
    return {"xy": route["xy"], "tags": route["tags"]}, pts


# ------------------------------------------------------------------------------------------------------------------------------ bridges
def detect_bridges(attrs, dem, waters_tree, waters):
    """Like build_real_line.detect_bridges, but a long high bridge over a river is a viaduct WITH water (Pfaffenthal, Pulvermuehle), up to 45 m high."""
    out = []
    xy = attrs.xy
    for s0, s1 in attrs.runs(brl.is_bridge, brl.BRIDGE_MIN_REAL):
        i0, i1 = int(s0 // attrs.step), int(min(len(xy) - 1, s1 // attrs.step))
        seg = LineString(xy[i0:i1 + 1])
        near = [waters[j] for j in waters_tree.query(seg.buffer(14))]
        wat = [w for w in near if w["g"].distance(seg) < 12 and w["g"].intersects(seg.buffer(10))]
        big = [w for w in wat if w["t"].get("waterway") in ("river", "canal")]
        d = np.gradient(xy[i0:i1 + 1], axis=0)
        nrm = np.c_[-d[:, 1], d[:, 0]]
        nrm /= np.hypot(nrm[:, 0], nrm[:, 1])[:, None] + 1e-9
        samples = []
        for off in (-45.0, -22.0, 22.0, 45.0):
            pts = xy[i0:i1 + 1] + nrm * off
            samples.append(dem.height(pts[:, 0], pts[:, 1]))
        ground = float(np.min(np.vstack(samples)))
        deck = float(np.median(attrs.z_raw[max(0, i0 - 8):i1 + 9]))
        h = brl.clamp(deck - ground, 3.0, 50.0)
        name = (big[0]["t"].get("name") if big else "") or ""
        length = s1 - s0
        if (big or wat) and length >= BIG_BRIDGE_LEN and h >= 14:
            out.append((s0, s1, {"kind": "viaduct", "h": int(round(min(h, 45))), "water": True, "name": name}))
        elif big or wat:
            kind = "steel" if (big and name in ("Mosel", "Sauer", "Saar", "Our") and length > 90) else "river"
            h = brl.clamp(max(h, 5.0), 5, 24)
            out.append((s0, s1, {"kind": kind, "h": int(round(h)), "water": True, "name": name}))
        elif h >= BRIDGE_VIADUCT_MIN_H and length >= 70:
            out.append((s0, s1, {"kind": "viaduct", "h": int(round(min(h, 45))), "water": False, "name": ""}))
    return out


def route_features(attrs, dem, tiles):
    waters = brl.waterway_index(tiles)
    tree = STRtree([w["g"] for w in waters])
    return {"bridges": detect_bridges(attrs, dem, tree, waters), "tunnels": attrs.runs(brl.is_tunnel, brl.TUNNEL_MIN_REAL), "crossings": brl.crossings_of(attrs, tiles["railpoints"])}


# ------------------------------------------------------------------------------------------------------------------------------ stations
def station_layout(attrs, s_stop, platforms, rails, main_line):
    """Platforms (lateral offset of the edge nearest to the track, along-track extent relative to the stop, + = right of travel) and the other tracks
    (lateral offsets) within PLATFORM_REACH of the stop, from OSM.  Used for the platform layout of the station models."""
    i0 = int(max(0, (s_stop - PLATFORM_REACH) // attrs.step))
    i1 = int(min(len(attrs.xy) - 2, (s_stop + PLATFORM_REACH) // attrs.step))
    idx = np.arange(i0, i1 + 1)
    p = attrs.xy[idx]
    t = attrs.xy[idx + 1] - attrs.xy[idx]
    t /= np.hypot(t[:, 0], t[:, 1])[:, None] + 1e-9
    r = np.c_[t[:, 1], -t[:, 0]]            # right-hand normal
    s_of = idx * attrs.step

    def lateral(g, step=4.0):
        """(s_rel, lat) samples of a geometry's points within the lateral band of the stop."""
        out = []
        parts = [g] if g.geom_type == "LineString" else list(g.geoms) if hasattr(g, "geoms") else []
        for ls in parts:
            if ls.geom_type != "LineString" or ls.length < 1:
                continue
            n = max(2, int(ls.length // step) + 1)
            for k in range(n):
                q = ls.interpolate(ls.length * k / (n - 1))
                d2 = (p[:, 0] - q.x) ** 2 + (p[:, 1] - q.y) ** 2
                j = int(d2.argmin())
                lat = float((q.x - p[j, 0]) * r[j, 0] + (q.y - p[j, 1]) * r[j, 1])
                if abs(lat) <= PLATFORM_LAT_MAX and d2[j] < (PLATFORM_LAT_MAX * 1.4) ** 2:
                    out.append((float(s_of[j] - s_stop), lat))
        return out

    plats = []
    for pl in platforms:
        if pl["g"].distance(Point(*attrs.xy[min(len(attrs.xy) - 1, int(s_stop // attrs.step))])) > PLATFORM_REACH + PLATFORM_LAT_MAX:
            continue
        pts = [(s, lat) for s, lat in lateral(pl["g"]) if abs(s) <= PLATFORM_REACH and abs(lat) >= 1.2]
        if len(pts) < 2:
            continue
        ss = [x[0] for x in pts]
        lat = float(np.median([x[1] for x in pts])) if len(pts) > 2 else pts[0][1]
        edge = min((x[1] for x in pts), key=abs)
        plats.append({"lat": round(lat, 1), "edge": round(edge, 1), "s0": round(min(ss), 1), "s1": round(max(ss), 1), "ref": pl["t"].get("ref", "")})
    # one platform per OSM way pair: the edge line and the area of the same platform are merged when they overlap and lie within 4 m laterally
    plats.sort(key=lambda q: q["lat"])
    merged = []
    for q in plats:
        m = next((x for x in merged if abs(x["lat"] - q["lat"]) < 4.5 and q["s0"] < x["s1"] and q["s1"] > x["s0"]), None)
        if m:
            m["s0"], m["s1"] = min(m["s0"], q["s0"]), max(m["s1"], q["s1"])
            if abs(q["edge"]) < abs(m["edge"]):
                m["edge"] = q["edge"]
            m["lat"] = round((m["lat"] + q["lat"]) / 2, 1)
        else:
            merged.append(dict(q))
    tracks = []
    for rl in rails:
        if rl["t"].get("railway") != "rail" or rl["t"].get("service") in ("yard",):
            continue
        for s, lat in lateral(rl["g"], 6.0):
            if abs(s) <= PLATFORM_REACH * 0.7 and 2.5 < abs(lat) < PLATFORM_LAT_MAX:
                tracks.append(round(lat * 2) / 2)
    vals, cnts = np.unique(tracks, return_counts=True) if tracks else (np.array([]), np.array([]))
    others = [float(v) for v, c in zip(vals, cnts) if c >= 4]
    cl = []
    for v in others:
        if cl and v - cl[-1][-1] < 2.0:
            cl[-1].append(v)
        else:
            cl.append([v])
    return merged, [round(float(np.mean(c)), 1) for c in cl]


# ------------------------------------------------------------------------------------------------------------------------------ legs
def leg_len(real_gap, par):
    return brl.clamp(par["per_real"] * real_gap, par["leg_min"], par["leg_max"])


PARAMS = {"per_real": brl.GAME_PER_REAL, "leg_min": brl.LEG_MIN, "leg_max": brl.LEG_MAX}


def ardennes_windows(biomes, s_from):
    """Biome windows beyond s_from: forest / farmland become 'ardennes' (the hills and spruce forests of the Eislek)."""
    out = []
    for a, b, name in biomes:
        if b <= s_from:
            out.append((a, b, name))
        elif a >= s_from:
            out.append((a, b, "ardennes" if name in ("forest", "farmland") else name))
        else:
            out.append((a, s_from, name))
            out.append((s_from, b, "ardennes" if name in ("forest", "farmland") else name))
    merged = []
    for w in out:
        if merged and merged[-1][2] == w[2]:
            merged[-1] = (merged[-1][0], w[1], w[2])
        else:
            merged.append(w)
    return merged


def urban_halo(biomes, stops):
    """The land-use polygons around the big stations are often railway land (not classified): the windows next to a size-3 station that came out as farmland /
    forest become city (first stop, 1.6 km) or suburb (others, 450 m)."""
    cuts = sorted({round(x, 1) for w in biomes for x in (w[0], w[1])})
    for st in stops:
        if st["size"] >= 3:
            r = 1600.0 if st is stops[0] else 450.0
            cuts += [max(0.0, st["s"] - r), st["s"] + r]
    cuts = sorted(set(cuts))
    out = []
    for a, b in zip(cuts[:-1], cuts[1:]):
        mid = (a + b) / 2
        name = next((w[2] for w in biomes if w[0] <= mid <= w[1]), biomes[-1][2])
        for st in stops:
            if st["size"] >= 3 and abs(mid - st["s"]) < (1600.0 if st is stops[0] else 450.0) and name in ("farmland", "forest"):
                name = "city" if st is stops[0] else "suburb"
        if out and out[-1][2] == name:
            out[-1] = (out[-1][0], b, name)
        else:
            out.append((a, b, name))
    return out


def build(route_id, dem=None):
    spec = ROUTES[route_id]
    tiles = load_route_tiles(spec["tiles"])
    dem = dem or Dem()
    land = LandIndex(tiles["landuse"])
    route, pts = build_path(tiles, spec)
    attrs = brl.RouteAttrs(route, dem)
    feats = route_features(attrs, dem, tiles)
    line = LineString(attrs.xy)
    stops, prev = [], -1.0
    for st, pt in zip(spec["stops"], pts):
        s = float(line.project(pt))
        if s <= prev:
            raise SystemExit("stop %s is not after the previous one on the path (s=%.0f <= %.0f)" % (st[1], s, prev))
        prev = s
        stops.append({"osm": st[0], "game": st[1], "size": st[2], "s": s, "off": float(line.distance(pt))})
    biomes = brl.biome_windows(attrs, land)
    if spec.get("ardennes_after"):
        s_a = next(x["s"] for x in stops if x["osm"] == spec["ardennes_after"])
        biomes = ardennes_windows(biomes, s_a)
    biomes = urban_halo(biomes, stops)
    platforms = [p for p in tiles["rails"] if p["t"].get("railway") in ("platform", "platform_edge")]
    for st in stops:
        side = brl.platform_side(attrs, st, platforms)
        st["side"] = "right" if (side or 1) > 0 else "left"
        st["side_known"] = side is not None
        st["biome"] = "city" if st["size"] >= 3 else next((w[2] for w in biomes if w[0] <= st["s"] <= w[1]), "farmland")
        st["plat"], st["trk"] = station_layout(attrs, st["s"], platforms, tiles["rails"], line)
    brl.side_fix(stops)
    legs = []
    for i in range(len(stops) - 1):
        A, B = stops[i], stops[i + 1]
        a, b = A["s"] + HALF_BLOCK, B["s"] - HALF_BLOCK
        if b - a < 120:
            raise SystemExit("leg %s -> %s too short (%d m real)" % (A["game"], B["game"], b - a))
        Lg = leg_len(b - a, PARAMS)
        br = [x for x in feats["bridges"] if x[1] > a and x[0] < b]
        tu = [x for x in feats["tunnels"] if x[1] > a and x[0] < b]
        cr = [c["s"] for c in feats["crossings"] if a + 20 < c["s"] < b - 20 and not any(abs(c["s"] - st["s"]) < HALF_BLOCK + 20 for st in stops)]
        bw = [w for w in biomes if w[1] > a and w[0] < b]
        leg = brl.build_leg(attrs, a, b, Lg, name=A["game"], bridges=[(max(x[0], a), min(x[1], b), x[2]) for x in br],
                            tunnels=[(max(x[0], a), min(x[1], b)) for x in tu], crossings=cr, biome_at=bw)
        leg.update({"from": A["game"], "to": B["game"], "real_gap": round(b - a)})
        legs.append(leg)
    return {"attrs": attrs, "stops": stops, "feats": feats, "legs": legs, "tiles": tiles, "land": land, "dem": dem, "biomes": biomes}


def report(res):
    attrs, stops, feats, legs = res["attrs"], res["stops"], res["feats"], res["legs"]
    print("route %d m real; %d stops; %d bridges %d tunnels %d crossings" % (attrs.length, len(stops), len(feats["bridges"]), len(feats["tunnels"]), len(feats["crossings"])))
    for st in stops:
        print("  stop %-24s s=%6.0f off %3.0f side %-5s%s biome %-10s plat %s trk %s" % (st["game"], st["s"], st["off"], st["side"], "" if st["side_known"] else "?", st["biome"], [(q["lat"], q["s0"], q["s1"]) for q in st["plat"]], st["trk"]))
    for leg in legs:
        print("%-24s -> %-24s real %5d m game %4d  %s" % (leg["from"], leg["to"], leg["real_gap"], leg["length"], leg["spec"][:170]))
    for b in feats["bridges"]:
        print("  bridge s=%.0f..%.0f %s" % (b[0], b[1], b[2]))
    for t in feats["tunnels"]:
        print("  tunnel s=%.0f..%.0f (%d m)" % (t[0], t[1], t[1] - t[0]))


# ------------------------------------------------------------------------------------------------------------------------------ emit
def emit(route_id, res):
    spec = ROUTES[route_id]
    attrs, stops, legs = res["attrs"], res["stops"], res["legs"]
    segs, legs_meta = [], {}
    for i, st in enumerate(stops):
        segs.append({"t": "station", "name": st["game"]})
        if i < len(legs):
            lg = legs[i]
            lid = "%s%02d" % (spec["prefix"], i + 1)
            segs.append({"t": "leg", "id": lid, "from": lg["from"], "to": lg["to"], "length": lg["length"], "spec": lg["spec"]})
            legs_meta[lid] = {"route": route_id, "from": lg["from"], "to": lg["to"], "real": lg["real"], "k": lg["k"], "mapping": lg["mapping"], "pieces": lg["pieces"]}
    stations = {st["game"]: {"size": st["size"], "side": st["side"], "biome": st["biome"], "osm": st["osm"], "s_real": round(st["s"], 1),
                             "plat": st["plat"], "trk": st["trk"]} for st in stops}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "%s-layout.json" % route_id), "w") as f:
        json.dump({"version": 1, "stations": stations, "segments": {"main": segs}}, f, ensure_ascii=False, indent=1)
    slim = {"version": 1, "id": route_id, "stations": {n: {k: v[k] for k in ("size", "side", "biome", "plat", "trk")} for n, v in stations.items()}, "segments": {"main": segs}}
    js = os.path.join(REPO, "pb", "train-sim", "real-%s.js" % route_id)
    with open(js, "w") as f:
        f.write("/* GENERATED by scripts/zuch/build_real_route.py emit %s (OSM main track, see pb/train-sim/REAL-LINES.md \"W2c\"). Do not edit by hand. */\n" % route_id)
        f.write("(function () { 'use strict'; window.TS = window.TS || {}; window.TS.realLines = window.TS.realLines || {}; window.TS.realLines[%s] = Object.freeze(" % json.dumps(route_id))
        json.dump(slim, f, ensure_ascii=False, separators=(",", ":"))
        f.write("); })();\n")
    # scenery features per leg and per station block
    tiles, dem, land = res["tiles"], res["dem"], res["land"]
    waters = [w for w in tiles["waterways"] if w["t"].get("waterway") in ("river", "canal", "stream")]
    wtree = STRtree([w["g"] for w in waters])
    roads = [w for w in tiles["highways"] if w["t"].get("highway") in sc.ROAD_CLASSES]
    rtree = STRtree([w["g"] for w in roads])
    all_meta = dict(legs_meta)
    for name, st in stations.items():
        all_meta["st:" + name] = {"route": route_id, "from": name, "to": name, "real": [st["s_real"] - HALF_BLOCK, st["s_real"] + HALF_BLOCK], "k": 1.0,
                                  "mapping": [[0.0, 0.0], [2 * HALF_BLOCK, 2 * HALF_BLOCK]]}
    out = {}
    for lid, meta in all_meta.items():
        g = sc.LegGeom(attrs, meta)
        rd = sc.roads_of_leg(g, roads, rtree)
        out[lid] = {
            "L": round(g.length, 1), "land": sc.land_raster(g, land), "far": sc.far_raster(g, land), "water": sc.water_windows(g, waters, wtree), "roads": rd,
            "relief": sc.relief(g, dem), "places": sc.places_of_leg(g, tiles["places"]), "crossings": sc.crossings_of_leg(g, res["feats"]["crossings"], rd),
        }
        print("  features", lid, meta["from"], "->", meta["to"], "roads", len(rd), "water", len(out[lid]["water"]), "places", len(out[lid]["places"]), "crossings", len(out[lid]["crossings"]), flush=True)
    doc = {"version": 1, "row": sc.ROW_M, "col": sc.COL_M, "lat0": sc.LAT0, "cols": sc.COLS, "far": {"row": sc.FAR_ROW, "col": sc.FAR_COL, "lat0": sc.FAR_LAT0, "cols": sc.FAR_COLS},
           "classes": __import__("real_line_land").CLASS_NAMES, "legs": out}
    path = os.path.join(OUT, "%s-features.json" % route_id)
    with open(path, "w") as f:
        json.dump(doc, f, separators=(",", ":"), ensure_ascii=False)
    print("features ->", path, os.path.getsize(path) // 1024, "kB")
    with open(os.path.join(CACHE, "%s-legs-meta.json" % route_id), "w") as f:
        json.dump(legs_meta, f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=["plan", "emit"])
    ap.add_argument("route", choices=sorted(ROUTES))
    ap.add_argument("--plot", default="")
    args = ap.parse_args()
    res = build(args.route)
    report(res)
    if args.plot:
        brl.plot_legs(res["attrs"], res["legs"], args.plot)
    if args.stage == "emit":
        emit(args.route, res)


if __name__ == "__main__":
    main()
