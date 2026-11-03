#!/usr/bin/env python3
"""Bake the LOD2 buildings of Lux Drive into pb/lux-drive/data/buildings.bin.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/luxdrive/bake_buildings.py

The source is the official ACT Luxembourg 3D building model (CityGML LOD2.2, CC0).  The commune
file is 1.1 GB, so it is streamed with lxml.iterparse: one <bldg:Building> at a time, and the
element is dropped as soon as it is read.

What is kept per building: the real ground footprint (simplified), the height of the eaves above
the ground and the height of the ridge.  The base follows the terrain (the game samples the
terrain under every footprint point), so nothing floats and nothing is buried.

buildings.bin layout (little endian):
    u32 count
    per building:
      u8  roof        0 = flat, 1 = pitched (a hip roof along the ridge direction)
      u8  style       0 = house, 1 = apartment block, 2 = office, 3 = industrial / shed
      u8  ridgeDir    the direction of the ridge, 0..255 = 0..360 degrees
      u8  levels      the number of storeys (for the window bands), 0 = unknown
      u16 eave        (decimetres, the height of the eaves above the ground)
      u16 ridge       (decimetres, the height of the ridge above the ground)
      u16 npts
      i32 x0 (decimetres), i32 z0 (decimetres)
      varint zigzag deltas of x and z (decimetres)
"""
import json
import math
import os
import sys
import time

import numpy as np
from lxml import etree
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union
from shapely.prepared import prep

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import codec  # noqa: E402
from common import (NEAR_STEP, OUT_DIR, RAW_DIR, luref_to_world, sample_bicubic)  # noqa: E402

LOD2_DIR = os.path.expanduser("~/Library/Caches/luxtram-work/geo/lod2")
COMMUNES = tuple(os.environ.get("LUXDRIVE_COMMUNES", "luxembourg,niederanven").split(","))
NS_B = "{http://www.opengis.net/citygml/building/2.0}"
NS_G = "{http://www.opengis.net/gml}"
SIMPLIFY_M = 0.4          # m, the Douglas-Peucker tolerance of the footprint
MAX_PTS = 16              # a building with more corners than this is simplified harder
MIN_AREA = 8.0            # m2, smaller footprints are sheds, not buildings
FLAT_ROOF = 0.7           # m, a roof lower than this is flat


def rings_of(el):
    """Every (exterior, [interiors]) polygon of a surface element."""
    polys = []
    for poly in el.iter(NS_G + "Polygon"):
        ext = poly.find(NS_G + "exterior")
        if ext is None:
            continue
        ring = read_ring(ext)
        if ring is None:
            continue
        holes = []
        for it in poly.findall(NS_G + "interior"):
            h = read_ring(it)
            if h is not None:
                holes.append(h)
        polys.append((ring, holes))
    return polys


def read_ring(el):
    pl = el.find(".//" + NS_G + "posList")
    if pl is None or not pl.text:
        return None
    a = pl.text.split()
    ring = []
    for k in range(0, len(a) - 2, 3):
        # CityGML writes the national grid as (northing, easting, z)
        ring.append((float(a[k + 1]), float(a[k]), float(a[k + 2])))
    if len(ring) < 3:
        return None
    if abs(ring[0][0] - ring[-1][0]) < 1e-6 and abs(ring[0][1] - ring[-1][1]) < 1e-6:
        ring = ring[:-1]
    return ring if len(ring) >= 3 else None


def ring_area(r):
    s = 0.0
    for i in range(len(r)):
        x1, y1 = r[i][0], r[i][1]
        x2, y2 = r[(i + 1) % len(r)][0], r[(i + 1) % len(r)][1]
        s += x1 * y2 - x2 * y1
    return s * 0.5


def douglas_peucker(pts, tol):
    """Closed polygon simplification (a cyclic Douglas-Peucker on the ring)."""
    if len(pts) < 4:
        return list(pts)
    # split the ring at the two extreme points so the classic open algorithm can be used
    i0 = 0
    d0 = -1.0
    for i, p in enumerate(pts):
        d = p[0] * p[0] + p[1] * p[1]
        if d > d0:
            d0 = d
            i0 = i
    i1 = 0
    d1 = 1e30
    for i, p in enumerate(pts):
        d = p[0] * p[0] + p[1] * p[1]
        if d < d1:
            d1 = d
            i1 = i
    ring = pts[i0:] + pts[:i0]
    j1 = (i1 - i0) % len(pts)
    first = _dp_open(ring[:j1 + 1], tol)
    second = _dp_open(ring[j1:] + [ring[0]], tol)
    out = first[:-1] + second[:-1]
    return out if len(out) >= 3 else list(pts)


def _dp_open(pts, tol):
    if len(pts) < 3:
        return list(pts)
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        ax, ay = pts[i]
        bx, by = pts[j]
        dx, dy = bx - ax, by - ay
        ll = dx * dx + dy * dy
        best = -1.0
        bi = -1
        for k in range(i + 1, j):
            px, py = pts[k]
            if ll < 1e-12:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / ll))
                d = math.hypot(px - (ax + dx * t), py - (ay + dy * t))
            if d > best:
                best = d
                bi = k
        if best > tol:
            keep[bi] = True
            stack.append((i, bi))
            stack.append((bi, j))
    return [p for p, k in zip(pts, keep) if k]


def parse_building(b):
    ground, roof, wall = [], [], []
    for bb in b.iter(NS_B + "boundedBy"):
        for child in bb:
            tag = etree.QName(child).localname
            if tag == "GroundSurface":
                ground += rings_of(child)
            elif tag == "RoofSurface":
                roof += rings_of(child)
            elif tag == "WallSurface":
                wall += rings_of(child)
    if not (ground or roof or wall):
        return None
    fp = None
    if ground:
        fp = max(ground, key=lambda r: abs(ring_area(r[0])))[0]
    else:
        base = []
        for ring, _h in wall:
            if not ring:
                continue
            zmin = min(p[2] for p in ring)
            base += [p for p in ring if p[2] <= zmin + 0.3]
        if len(base) > 2:
            fp = base
    if not fp or len(fp) < 3:
        return None

    # the eave: the top of the walls, or the lowest point of the roof
    wall_z = [p[2] for r, _h in wall for p in r]
    roof_z = [p[2] for r, _h in roof for p in r]
    ground_z = [p[2] for r, _h in (ground or wall) for p in r]
    if not ground_z:
        return None
    z0 = min(ground_z)
    if wall_z:
        eave = max(wall_z)
    elif roof_z:
        eave = min(roof_z)
    else:
        eave = z0
    if roof_z:
        ridge = max(roof_z)
    else:
        ridge = eave
    # the direction of the ridge: the roof points that are at the top
    direction = None
    if roof_z and ridge - eave > FLAT_ROOF:
        top = [(p[0], p[1]) for r, _h in roof for p in r if p[2] > ridge - 0.35]
        if len(top) >= 2:
            cx = sum(p[0] for p in top) / len(top)
            cy = sum(p[1] for p in top) / len(top)
            sxx = sum((p[0] - cx) ** 2 for p in top)
            syy = sum((p[1] - cy) ** 2 for p in top)
            sxy = sum((p[0] - cx) * (p[1] - cy) for p in top)
            ang = 0.5 * math.atan2(2 * sxy, sxx - syy)     # the principal axis of the ridge
            direction = ang
    names = [n.text.strip() for n in b.iter(NS_G + "name")
             if n.text and n.text.strip() and n.text.strip() not in ("Commune Luxembourg", "Commune Niederanven")]
    return {"fp": fp, "z0": z0, "eave": eave, "ridge": ridge, "dir": direction,
            "name": names[0] if names else None}


def main():
    t0 = time.time()
    area = json.load(open(os.path.join(RAW_DIR, "area_luref.json"), encoding="utf-8"))
    polys = []
    for rings in area["polygons"]:
        p = Polygon(rings[0], rings[1:])
        polys.append(p if p.is_valid else p.buffer(0))
    clip = prep(unary_union(polys))

    # the terrain the game draws: the de-spiked DTM of terrain.bin
    blob = open(os.path.join(OUT_DIR, "terrain.bin"), "rb").read()
    grid = codec.decode_np(blob)
    nx, nz = grid.shape[1], grid.shape[0]
    flat = grid.astype(np.float64).ravel().tolist()

    def terrain(x, z):
        return sample_bicubic((nx, nz, flat), x / NEAR_STEP, z / NEAR_STEP)

    out = []
    names_out = {}
    stats = {"seen": 0, "in": 0, "kept": 0}
    for slug in COMMUNES:
        path = os.path.join(LOD2_DIR, slug + ".gml")
        if not os.path.exists(path):
            print("missing", path)
            continue
        print("parsing", path, flush=True)
        context = etree.iterparse(path, events=("end",), tag=NS_B + "Building", huge_tree=True)
        for _, elem in context:
            stats["seen"] += 1
            rec = parse_building(elem)
            elem.clear()
            while elem.getprevious() is not None:
                del elem.getparent()[0]
            if rec is None:
                continue
            fp = rec["fp"]
            xs = [p[0] for p in fp]
            ys = [p[1] for p in fp]
            cx = sum(xs) / len(xs)
            cy = sum(ys) / len(ys)
            if not clip.contains(Point(cx, cy)):
                continue
            stats["in"] += 1
            if abs(ring_area(fp)) < MIN_AREA:
                continue
            wx, wz = luref_to_world(xs, ys)
            pts = list(zip(wx.tolist(), wz.tolist()))
            pts = douglas_peucker(pts, SIMPLIFY_M)
            if len(pts) > MAX_PTS:
                pts = douglas_peucker(pts, SIMPLIFY_M * (len(pts) / MAX_PTS) ** 0.5)
                while len(pts) > MAX_PTS:
                    # drop the corner whose removal costs the least area
                    worst = None
                    for i in range(len(pts)):
                        a = pts[i - 1]; b = pts[i]; c = pts[(i + 1) % len(pts)]
                        cost = abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]))
                        if worst is None or cost < worst[0]:
                            worst = (cost, i)
                    pts.pop(worst[1])
            base = terrain(sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
            eave = rec["eave"] - base
            ridge = rec["ridge"] - base
            if eave < 2.0:
                continue                     # a ruin or a garage ramp: not a building
            if eave > 70.0:
                eave = 70.0
            if ridge > eave + 25.0:
                ridge = eave + 25.0
            if ridge < eave:
                ridge = eave
            d = rec["dir"]
            if d is None:
                # no roof: use the long axis of the footprint
                d = 0.0
                if len(pts) >= 2:
                    dxs = [p[0] for p in pts]
                    dzs = [p[1] for p in pts]
                    d = math.atan2(dzs[-1] - dzs[0], dxs[-1] - dxs[0])
            out.append({
                "pts": pts, "eave": eave, "ridge": ridge, "dir": d,
                "roof": 0 if (ridge - eave) < FLAT_ROOF else 1,
                "area": abs(ring_area(fp)), "name": rec["name"],
            })
            if rec["name"]:
                names_out[len(names_out)] = rec["name"]
        print("  %s: %d buildings seen (%.0fs)" % (slug, stats["seen"], time.time() - t0), flush=True)

    print("seen %d  in area %d  kept %d" % (stats["seen"], stats["in"], len(out)))
    print("height: min %.1f max %.1f mean %.1f" %
          (min(o["eave"] for o in out), max(o["eave"] for o in out),
           sum(o["eave"] for o in out) / len(out)))

    blob = bytearray()
    blob += (len(out)).to_bytes(4, "little")
    for o in out:
        pts = o["pts"]
        style = 0
        area = o["area"]
        if area > 900:
            style = 1
        blob += o["roof"].to_bytes(1, "little")
        blob += style.to_bytes(1, "little")
        blob += (int(round((o["dir"] % (2 * math.pi)) / (2 * math.pi) * 256)) % 256).to_bytes(1, "little")
        blob += min(255, max(0, int(round(o["eave"] / 3.0)))).to_bytes(1, "little")
        blob += int(round(o["eave"] * 10)).to_bytes(2, "little")
        blob += int(round(o["ridge"] * 10)).to_bytes(2, "little")
        blob += len(pts).to_bytes(2, "little")
        px, pz = round(pts[0][0] * 10), round(pts[0][1] * 10)
        blob += px.to_bytes(4, "little", signed=True)
        blob += pz.to_bytes(4, "little", signed=True)
        for x, z in pts[1:]:
            qx, qz = round(x * 10), round(z * 10)
            varint(zigzag(qx - px), blob)
            varint(zigzag(qz - pz), blob)
            px, pz = qx, qz

    with open(os.path.join(OUT_DIR, "buildings.bin"), "wb") as fh:
        fh.write(blob)
    with open(os.path.join(OUT_DIR, "building-names.json"), "w", encoding="utf-8") as fh:
        json.dump(names_out, fh, ensure_ascii=False, separators=(",", ":"))
    print("buildings.bin %.2f MB" % (len(blob) / 1048576.0))
    print("total %.0fs" % (time.time() - t0))


def varint(n, out):
    while n >= 0x80:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    out.append(n)


def zigzag(n):
    return (n << 1) ^ (n >> 63)


if __name__ == "__main__":
    main()
