#!/usr/bin/env python3
"""W3: reduced LOD2.2 buildings (national 3D building model, CC0) inside given zones, for the steelworks / freight area silhouettes of the real routes.

    from lod2_zone_buildings import zone_buildings
    recs = zone_buildings(["differdange", "esch-sur-alzette"], zones_utm_geometry)

Each record: {gid, fp (shapely Polygon, EPSG:25832), z0 (ground height m), eave (m above ground), ridge (m above ground), area, tall (max z - ground)}.
The footprint is the union of the LOD2 ground surfaces (fallback: the convex hull of the wall bases); heights come from the roof / wall faces.  Results are cached per commune and
zone fingerprint in ~/Library/Caches/zuch-work/lod2/zone-<slug>-<hash>.pkl, because parsing a commune file takes minutes.
"""
import hashlib
import os
import pickle
import sys

import numpy as np
import pyproj
import shapely
from lxml import etree
from shapely import STRtree
from shapely.geometry import Polygon
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_station_patch as bsp  # noqa: E402

TO_UTM = pyproj.Transformer.from_crs(2169, 25832, always_xy=True)
NS_B = bsp.NS_B
NS_G = bsp.NS_G
MIN_AREA = 40.0           # m2 footprint: smaller things are not worth a silhouette


def _poly(a):
    """UTM polygon from a (N, E, z) ring of the Luxembourg CityGML."""
    x, y = TO_UTM.transform(a[:, 1], a[:, 0])
    p = Polygon(np.c_[x, y])
    return p if p.is_valid else p.buffer(0)


def parse_zone(path, zone_tree, zone_geoms):
    out = []
    seen = 0
    for _, el in etree.iterparse(path, events=("end",), tag=NS_B + "Building", huge_tree=True):
        seen += 1
        surf = {"roof": [], "wall": [], "ground": []}
        for bs in el.iter(NS_B + "RoofSurface", NS_B + "WallSurface", NS_B + "GroundSurface", NS_B + "OuterCeilingSurface", NS_B + "OuterFloorSurface", NS_B + "ClosureSurface"):
            kind = {"RoofSurface": "roof", "WallSurface": "wall", "GroundSurface": "ground"}.get(etree.QName(bs).localname, "roof")
            for poly in bs.iter(NS_G + "Polygon"):
                ext = poly.find(NS_G + "exterior")
                pl = ext.find(".//" + NS_G + "posList") if ext is not None else None
                if pl is None or not pl.text:
                    continue
                a = np.array(pl.text.split(), dtype=float).reshape(-1, 3)
                if len(a) >= 2 and np.abs(a[0] - a[-1]).max() < 1e-6:
                    a = a[:-1]
                if len(a) >= 3:
                    surf[kind].append(a)
        gid = el.get(NS_G + "id")
        el.clear()
        while el.getprevious() is not None:
            del el.getparent()[0]
        allp = surf["ground"] + surf["roof"] + surf["wall"]
        if not allp or not (surf["roof"] or surf["wall"]):
            continue
        pts = np.vstack(allp)
        ce, cn = pts[:, 1].mean(), pts[:, 0].mean()
        cx, cy = TO_UTM.transform(ce, cn)
        if not len(zone_tree.query(shapely.points(cx, cy))):
            continue
        hit = zone_tree.query(shapely.points(cx, cy), predicate="within")
        if not len(hit):
            continue
        rings = [_poly(a) for a in surf["ground"]] if surf["ground"] else []
        if not rings:   # no ground surface: the wall bases
            base = np.vstack([w[w[:, 2] <= w[:, 2].min() + 0.3] for w in surf["wall"]]) if surf["wall"] else None
            if base is None or len(base) < 3:
                continue
            x, y = TO_UTM.transform(base[:, 1], base[:, 0])
            rings = [shapely.MultiPoint(np.c_[x, y]).convex_hull]
        fp = unary_union([r for r in rings if not r.is_empty])
        if fp.geom_type == "MultiPolygon":
            fp = max(fp.geoms, key=lambda g: g.area)
        if fp.is_empty or fp.area < MIN_AREA:
            continue
        z0 = float(np.min(np.vstack(surf["ground"])[:, 2])) if surf["ground"] else float(np.min(pts[:, 2]))
        roofz = np.concatenate([r[:, 2] for r in surf["roof"]]) if surf["roof"] else pts[:, 2]
        wallz = np.concatenate([w[:, 2] for w in surf["wall"]]) if surf["wall"] else roofz
        top = float(max(roofz.max(), wallz.max()))
        eave = float(np.percentile(roofz, 12)) if len(roofz) > 4 else float(roofz.min())
        out.append({"gid": gid, "fp": fp, "z0": z0, "eave": max(1.5, eave - z0), "ridge": max(2.0, top - z0), "area": float(fp.area)})
    print("   ", os.path.basename(path), "scanned", seen, "kept", len(out), flush=True)
    return out


def zone_buildings(slugs, zones):
    """zones: shapely (Multi)Polygon list in UTM 32N; returns the reduced buildings of the communes `slugs` whose centroid is in a zone."""
    zone_geoms = list(zones)
    tree = STRtree(zone_geoms)
    fp = hashlib.sha1(b"".join(g.wkb for g in zone_geoms)).hexdigest()[:10]
    res = []
    for slug in slugs:
        cache = os.path.join(bsp.WORK, "lod2", "zone-%s-%s.pkl" % (slug, fp))
        if os.path.exists(cache):
            with open(cache, "rb") as f:
                part = pickle.load(f)
        else:
            part = parse_zone(bsp.lod2_gml(slug), tree, zone_geoms)
            with open(cache, "wb") as f:
                pickle.dump(part, f)
        res.extend(part)
    seen, out = set(), []
    for r in res:
        if r["gid"] in seen:
            continue
        seen.add(r["gid"])
        out.append(r)
    return out
