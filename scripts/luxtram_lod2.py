"""Extract the buildings near the Luxtram line from the national LOD 2.2 CityGML (ACT 3D buildings 2023, CC0) -> pickle.

CityGML here has the axis order (Northing, Easting, height) in EPSG:2169.  Returned buildings are in the local game frame (x east, z south, y absolute
height in metres):  {gid, ground: [(x,z,y)...], roofs: [ring], walls: [ring], zmin, zmax, c: (x, z), area}.  Each ring is a list of (x, z, y).
"""
import os
import pickle
import sys

import numpy as np
from lxml import etree
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import luxtram_geo as G  # noqa: E402

NS_B = "http://www.opengis.net/citygml/building/2.0"
NS_GML = "http://www.opengis.net/gml"
Q = "{%s}" % NS_B
GQ = "{%s}" % NS_GML


def parse_commune(path, tree, rmax, keep_fn=None):
    out = []
    ctx = etree.iterparse(path, events=("end",), tag=Q + "Building", huge_tree=True)
    seen = 0
    for _, el in ctx:
        seen += 1
        gid = el.get(GQ + "id")
        surfaces = {"roof": [], "wall": [], "ground": []}
        for bs in el.iter(Q + "RoofSurface", Q + "WallSurface", Q + "GroundSurface", Q + "OuterCeilingSurface", Q + "OuterFloorSurface", Q + "ClosureSurface"):
            kind = {"RoofSurface": "roof", "WallSurface": "wall", "GroundSurface": "ground"}.get(etree.QName(bs).localname, "roof")
            for poly in bs.iter(GQ + "Polygon"):
                ext = poly.find(GQ + "exterior")
                if ext is None:
                    continue
                pl = ext.find(".//" + GQ + "posList")
                if pl is None or not pl.text:
                    continue
                a = np.array(pl.text.split(), dtype=float).reshape(-1, 3)
                if len(a) >= 2 and np.allclose(a[0], a[-1]):
                    a = a[:-1]
                if len(a) < 3:
                    continue
                surfaces[kind].append(a)
        el.clear()
        while el.getprevious() is not None:
            del el.getparent()[0]
        if not surfaces["roof"] and not surfaces["wall"]:
            continue
        allp = np.vstack(surfaces["roof"] + surfaces["wall"] + surfaces["ground"])
        # (N, E, z) -> local
        cn, ce = allp[:, 0].mean(), allp[:, 1].mean()
        cx, cz = G.luref_to_local(ce, cn)
        d, _ = tree.query([cx, cz])
        if d > rmax:
            continue

        def conv(a):
            x, z = G.luref_to_local(a[:, 1], a[:, 0])
            return np.c_[x, z, a[:, 2]]

        rec = {"gid": gid, "roofs": [conv(a) for a in surfaces["roof"]], "walls": [conv(a) for a in surfaces["wall"]], "ground": [conv(a) for a in surfaces["ground"]], "d": float(d)}
        pts = np.vstack(rec["roofs"] + rec["walls"])
        rec["c"] = (float(pts[:, 0].mean()), float(pts[:, 1].mean()))
        rec["zmin"] = float(pts[:, 2].min())
        rec["zmax"] = float(pts[:, 2].max())
        out.append(rec)
    print("  ", os.path.basename(path), "buildings scanned", seen, "kept", len(out))
    return out


def main():
    rmax = float(os.environ.get("LUXTRAM_LOD2_R", "400"))
    line = np.array(G.line_points())
    tree = cKDTree(G.densify(line, 6.0))
    d = os.path.join(G.RAW_GEO, "lod2")
    allb = []
    for fn in sorted(os.listdir(d)):
        if fn.endswith(".gml"):
            allb += parse_commune(os.path.join(d, fn), tree, rmax)
    with open(os.path.join(G.RAW_GEO, "lod2_corridor.pkl"), "wb") as fh:
        pickle.dump(allb, fh)
    print("total", len(allb))


if __name__ == "__main__":
    main()
