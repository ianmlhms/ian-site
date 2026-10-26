#!/usr/bin/env python3
"""Bake the buildings of the two built-up places the game shows (the Berdorf village and the Beaufort castles with the houses around them) into pb/mtb/data/buildings.json.
Needs fetch_osm.py and fetch_lidar.py first.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/mtb/bake_buildings.py [--preview]

Every OSM footprint becomes 1 to 3 rectangles (a house with a wing is two): the minimum rotated rectangle when it fills >= 80 % of the footprint, otherwise the largest rectangles that fit inside it
(found on a 0.5 m raster in the rectangle's frame). The height comes from the LiDAR: DSM - DTM inside the footprint (the 90th percentile is the ridge, the eave is derived from it).
Output (compact, rounded): { "houses": [[cx, cz, hx, hz, yaw, eave, ridge, flags, seed], ...], "castles": [...], "churches": [...] }
  (cx, cz) world metres of the rectangle centre, hx >= hz the half sizes along the axis at angle `yaw` (radians, x towards z), eave / ridge heights above the ground (m),
  flags: 1 flat roof, 2 hip roof (squarish), 4 dormer, 8 outbuilding (shed / garage), 16 church, 32 Beaufort Renaissance castle (wings), 64 Beaufort medieval ruin (wings)
The castles are listed with their footprint polygons and the LiDAR height statistics so cascade-like landmark code (castle.js) can build them at their real positions."""
import json
import math
import os
import sys

import numpy as np
from shapely.geometry import Polygon, Point
from shapely import affinity

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OSM_DIR, OUT_DIR, RAW_DIR, lonlat_to_world  # noqa: E402

PLAY_INSET = 192.0
WORLD_W, WORLD_H = 5632.0, 6144.0
VILLAGES = {"Berdorf": 650.0, "Beaufort": 430.0}          # radius (m) around the village centre that is built
CASTLE_IDS = {121100746: "medieval", 294907664: "renaissance", 121100759: "pavilion"}
CHURCH_NAMES = ("church",)
MIN_AREA = 14.0
MIN_RECT = 2.4
GRID = 0.5
SKIP_BUILDINGS = ("ruins", "roof", "greenhouse", "service", "hut", "shrine")


def load_buildings():
    seen, out = set(), []
    for name in ("buildings.json", "buildings_s.json", "buildings_s2.json"):
        path = os.path.join(OSM_DIR, name)
        if not os.path.exists(path):
            continue
        for el in json.load(open(path, encoding="utf-8"))["elements"]:
            if el["id"] in seen or not el.get("geometry") or len(el["geometry"]) < 4:
                continue
            seen.add(el["id"])
            lon = [p["lon"] for p in el["geometry"]]
            lat = [p["lat"] for p in el["geometry"]]
            x, z = lonlat_to_world(np.array(lon), np.array(lat))
            out.append({"id": el["id"], "tags": el.get("tags", {}), "pts": list(zip(map(float, x), map(float, z)))})
    return out


def sampler():
    dsm = np.load(os.path.join(RAW_DIR, "dsm2.npy"), mmap_mode="r")
    dtm = np.load(os.path.join(RAW_DIR, "dtm2.npy"), mmap_mode="r")

    def stats(poly, shrink=0.8):
        inner = poly.buffer(-shrink) if poly.buffer(-shrink).area > 4 else poly
        x0, z0, x1, z1 = inner.bounds
        vals = []
        for j in range(max(0, int(z0 // 2)), min(dsm.shape[0] - 1, int(z1 // 2) + 2)):
            for i in range(max(0, int(x0 // 2)), min(dsm.shape[1] - 1, int(x1 // 2) + 2)):
                if inner.contains(Point(i * 2.0, j * 2.0)):
                    vals.append(float(dsm[j, i] - dtm[j, i]))
        return np.array(vals)

    def ground(x, z):
        i, j = int(round(x / 2)), int(round(z / 2))
        return float(dtm[j, i])

    return stats, ground, dsm, dtm


def max_rect(mask):
    """Largest axis-aligned rectangle of True cells: (area, r0, c0, r1, c1) by the histogram method."""
    best = (0, 0, 0, 0, 0)
    h = np.zeros(mask.shape[1], dtype=int)
    for r in range(mask.shape[0]):
        h = np.where(mask[r], h + 1, 0)
        stack = []
        for c in range(mask.shape[1] + 1):
            cur = h[c] if c < mask.shape[1] else 0
            start = c
            while stack and stack[-1][1] >= cur:
                s, hh = stack.pop()
                area = hh * (c - s)
                if area > best[0]:
                    best = (area, r - hh + 1, s, r, c - 1)
                start = s
            stack.append((start, cur))
    return best


def rectangles(poly, min_frac=0.2, count=3, force=False):
    """The polygon as 1 to 3 rectangles: [(cx, cz, hx, hz, yaw)] with hx >= hz."""
    obb = poly.minimum_rotated_rectangle
    ratio = poly.area / max(obb.area, 1e-6)
    pts = list(obb.exterior.coords)[:4]
    e0 = (pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]); e1 = (pts[2][0] - pts[1][0], pts[2][1] - pts[1][1])
    l0, l1 = math.hypot(*e0), math.hypot(*e1)
    long_e, long_l, short_l = (e0, l0, l1) if l0 >= l1 else (e1, l1, l0)
    yaw = math.atan2(long_e[1], long_e[0])
    cx, cz = obb.centroid.x, obb.centroid.y
    if (ratio >= 0.8 and not force) or poly.area < 60:
        return [(cx, cz, long_l / 2, short_l / 2, yaw)]
    # raster in the rectangle's frame
    local = affinity.rotate(affinity.translate(poly, -cx, -cz), -math.degrees(yaw), origin=(0, 0))
    x0, z0, x1, z1 = local.bounds
    nx, nz = int((x1 - x0) / GRID) + 1, int((z1 - z0) / GRID) + 1
    xs = x0 + (np.arange(nx) + 0.5) * GRID; zs = z0 + (np.arange(nz) + 0.5) * GRID
    from shapely import contains_xy
    mask = contains_xy(local, np.tile(xs, (nz, 1)), np.repeat(zs[:, None], nx, axis=1))
    total = mask.sum(); out = []
    for _ in range(count):
        area, r0, c0, r1, c1 = max_rect(mask)
        if area < max(min_frac * total, (MIN_RECT / GRID) ** 2):
            break
        lx0, lx1, lz0, lz1 = x0 + c0 * GRID, x0 + (c1 + 1) * GRID, z0 + r0 * GRID, z0 + (r1 + 1) * GRID
        mx, mz = (lx0 + lx1) / 2, (lz0 + lz1) / 2
        wx, wz = (lx1 - lx0) / 2, (lz1 - lz0) / 2
        wxw = cx + mx * math.cos(yaw) - mz * math.sin(yaw); wzw = cz + mx * math.sin(yaw) + mz * math.cos(yaw)
        if wx >= wz:
            out.append((wxw, wzw, wx, wz, yaw))
        else:
            out.append((wxw, wzw, wz, wx, yaw + math.pi / 2))
        mask[r0:r1 + 1, c0:c1 + 1] = False
    return out or [(cx, cz, long_l / 2, short_l / 2, yaw)]


def main():
    preview = "--preview" in sys.argv
    stats, ground, dsm, dtm = sampler()
    allb = load_buildings()
    centres = {}
    for b in allb:
        t = b["tags"]
        if t.get("building") == "church" and "Berdorf" in t.get("addr:city", ""):
            centres["Berdorf"] = (np.mean([p[0] for p in b["pts"]]), np.mean([p[1] for p in b["pts"]]))
        if b["id"] == 121100746:
            centres["Beaufort"] = (np.mean([p[0] for p in b["pts"]]), np.mean([p[1] for p in b["pts"]]))
    print("village centres", {k: (round(v[0]), round(v[1])) for k, v in centres.items()})
    houses, castles, churches = [], [], []
    rng = np.random.default_rng(7)
    for b in allb:
        t = b["tags"]
        poly = Polygon(b["pts"])
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty or poly.geom_type != "Polygon":
            continue
        cx, cz = poly.centroid.x, poly.centroid.y
        if cx < PLAY_INSET or cz < PLAY_INSET or cx > WORLD_W - PLAY_INSET or cz > WORLD_H - PLAY_INSET:
            continue
        if b["id"] in CASTLE_IDS:
            v = stats(poly, 0.5)
            kind = CASTLE_IDS[b["id"]]
            castles.append({"id": b["id"], "kind": kind, "name": t.get("name", ""), "ground": round(ground(cx, cz), 1),
                            "h": [round(float(np.percentile(v, q)), 1) for q in (10, 50, 90, 99)] if len(v) else []})
            if kind == "pavilion":
                pass                                               # a small house like the others (handled below)
            else:                                                  # the castles: wings as rectangles with their own style flags (32 renaissance castle, 64 medieval ruin)
                eave, ridge = (10.5, 16.5) if kind == "renaissance" else (12.0, 12.0)
                for (rx, rz, hx, hz, yaw) in rectangles(poly, 0.07, 5, True):
                    if hz < MIN_RECT / 2:
                        continue
                    houses.append([round(rx, 1), round(rz, 1), round(hx, 2), round(hz, 2), round(yaw % math.pi, 3), eave, ridge, 32 if kind == "renaissance" else 64, int(rng.integers(0, 1000))])
                continue
        near = [k for k, r in VILLAGES.items() if k in centres and math.hypot(cx - centres[k][0], cz - centres[k][1]) < r]
        if not near:
            continue
        kind = t.get("building", "yes")
        if kind in SKIP_BUILDINGS or poly.area < MIN_AREA:
            continue
        v = stats(poly)
        outbuilding = kind in ("shed", "garage", "garages", "carport", "cabin", "farm_auxiliary", "barn") or poly.area < 38
        if len(v) >= 3:
            ridge = float(np.percentile(v, 90)); low = float(np.percentile(v, 10))
        else:
            ridge, low = (3.2 if outbuilding else 8.5), 0.0
        ridge = min(max(ridge, 2.6), 17.0)
        flat = (ridge - low < 0.9 and ridge < 6.5) or kind in ("garage", "garages", "carport") or (outbuilding and ridge < 3.8)
        eave = ridge if flat else max(2.4, min(ridge * 0.64, ridge - 1.6))
        if kind == "church":
            eave, ridge = max(eave, 7.0), max(ridge, 14.0)
        rects = rectangles(poly)
        church = kind == "church" or t.get("amenity") == "place_of_worship"
        if church:
            churches.append({"id": b["id"], "name": t.get("name", ""), "village": near[0], "h": [round(eave, 1), round(ridge, 1)]})
        for (rx, rz, hx, hz, yaw) in rects:
            if hz < MIN_RECT / 2:
                continue
            squarish = hx / hz < 1.3 and hx * hz * 4 < 140
            flags = (1 if flat else 0) | (2 if squarish and not flat else 0) | (4 if (not flat and hx > 4.5 and hz > 3.2 and rng.random() < 0.55) else 0) | (8 if outbuilding else 0) | (16 if church else 0)
            houses.append([round(rx, 1), round(rz, 1), round(hx, 2), round(hz, 2), round(yaw % math.pi, 3), round(eave, 1), round(ridge, 1), flags, int(rng.integers(0, 1000))])
    out = {"houses": houses, "castles": castles, "churches": churches, "centres": {k: [round(v[0], 1), round(v[1], 1)] for k, v in centres.items()}}
    path = os.path.join(OUT_DIR, "buildings.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print("buildings.json: %d rectangles, %d castles, %d churches, %.1f KB" % (len(houses), len(castles), len(churches), os.path.getsize(path) / 1024))
    if preview:
        from PIL import Image, ImageDraw
        for name, (cx, cz), r in (("beaufort", centres["Beaufort"], 120), ("berdorf", centres["Berdorf"], 300)):
            S = 4
            img = Image.new("RGB", (int(2 * r * S), int(2 * r * S)), (20, 30, 20)); d = ImageDraw.Draw(img)
            j0, j1, i0, i1 = int((cz - r) // 2), int((cz + r) // 2), int((cx - r) // 2), int((cx + r) // 2)
            hh = np.clip((np.asarray(dsm[j0:j1, i0:i1]) - np.asarray(dtm[j0:j1, i0:i1])) / 20.0, 0, 1)
            g = Image.fromarray((hh * 255).astype("uint8")).resize((int(2 * r * S), int(2 * r * S)), Image.NEAREST); img.paste(g.convert("RGB"), (0, 0))
            for h in houses:
                if abs(h[0] - cx) < r and abs(h[1] - cz) < r:
                    c, s = math.cos(h[4]), math.sin(h[4])
                    pts = [((h[0] - cx + r + (a * c - b * s)) * S, (h[1] - cz + r + (a * s + b * c)) * S) for a, b in ((-h[2], -h[3]), (h[2], -h[3]), (h[2], h[3]), (-h[2], h[3]))]
                    d.polygon(pts, outline=(255, 120, 60))
            for cst in castles:
                d.polygon([((p[0] - cx + r) * S, (p[1] - cz + r) * S) for p in cst["pts"]], outline=(80, 200, 255))
            img.save(os.path.join(os.path.expanduser("~/Library/Caches/mtb-work"), "preview-%s.png" % name))


if __name__ == "__main__":
    main()
