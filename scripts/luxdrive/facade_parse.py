#!/usr/bin/env python3
"""Façades step 1 (houses17): stream the ACT LOD2.2 CityGML of Luxembourg-Ville and keep the buildings of the façade
area with every wall / roof polygon and its texture reference (the oblique-photo atlas JPEG + the uv of each corner).

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/luxdrive/facade_parse.py [out.json]

The GML is the one bake_buildings.py reads (1.1 GB, streamed with lxml.iterparse, one building at a time).
Output: {"box": [x0, x1, z0, z1], "buildings": [{id, surfaces: [{t, pid, pts: [[x, y, z], ...]}]}],
         "tex": {polygon id: [image name, [u, v, ...]]}}  - x, z game world metres, y metres above sea level.
"""
import json
import os
import sys
import time

from lxml import etree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ORIGIN_E, ORIGIN_N_TOP  # noqa: E402
from facade_area import BOX, WORK  # noqa: E402

GML = os.path.expanduser("~/Library/Caches/luxtram-work/geo/lod2/luxembourg.gml")
MARGIN = 30.0             # m: buildings whose corners reach this far outside the box are kept (their walls face the area)
B = "{http://www.opengis.net/citygml/building/2.0}"
G = "{http://www.opengis.net/gml}"
A = "{http://www.opengis.net/citygml/appearance/2.0}"
SURF = {B + "RoofSurface": "roof", B + "WallSurface": "wall", B + "GroundSurface": "ground"}


def inside(x, z):
    x0, x1, z0, z1 = BOX
    return x0 - MARGIN <= x <= x1 + MARGIN and z0 - MARGIN <= z <= z1 + MARGIN


def building(el):
    surfaces, hit = [], False
    for tag, kind in SURF.items():
        for s in el.iter(tag):
            for poly in s.iter(G + "Polygon"):
                ring = poly.find(f"{G}exterior/{G}LinearRing")
                pl = ring.find(G + "posList") if ring is not None else None
                if pl is None or not pl.text:
                    continue
                v = [float(t) for t in pl.text.split()]
                # CityGML writes the national grid as (northing, easting, height)
                pts = [[round(v[i + 1] - ORIGIN_E, 3), round(v[i + 2], 3), round(ORIGIN_N_TOP - v[i], 3)] for i in range(0, len(v), 3)]
                hit = hit or any(inside(p[0], p[2]) for p in pts)
                surfaces.append({"t": kind, "pid": poly.get(G + "id"), "pts": pts})
    if not hit:
        return None
    return {"id": el.get(G + "id"), "surfaces": surfaces}


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(WORK, "act", "area.json")
    if not os.path.exists(GML):
        raise SystemExit(f"facade_parse: the LOD2 GML is missing: {GML}")
    t0 = time.time()
    out, keep, tex, n = [], set(), {}, 0
    tags = (B + "Building", A + "ParameterizedTexture", A + "X3DMaterial")
    for _ev, el in etree.iterparse(GML, events=("end",), tag=tags, huge_tree=True):
        if el.tag == B + "Building":
            parent = el.getparent()
            if parent is not None and parent.tag == B + "consistsOfBuildingPart":
                continue                                   # a part: read with its parent building
            n += 1
            b = building(el)
            if b:
                out.append(b)
                keep.update(s["pid"] for s in b["surfaces"])
            el.clear()
        elif el.tag == A + "ParameterizedTexture":
            uri = el.findtext(A + "imageURI")
            for tg in el.iter(A + "target"):
                pid = (tg.get("uri") or "").lstrip("#")
                if pid in keep:
                    tc = tg.find(f"{A}TexCoordList/{A}textureCoordinates")
                    tex[pid] = [uri.replace("\\", "/").split("/")[-1], [round(float(t), 6) for t in tc.text.split()]]
            el.clear()
        else:
            el.clear()
        # free the parsed siblings (the 1.1 GB file never sits in memory)
        while el.getprevious() is not None and el.getparent() is not None and el.getparent().tag != B + "Building":
            del el.getparent()[0]
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump({"box": BOX, "buildings": out, "tex": tex}, f)
    print(f"facade_parse: {n} buildings read, {len(out)} kept, {len(tex)} textured polygons, "
          f"{len({v[0] for v in tex.values()})} images, {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
