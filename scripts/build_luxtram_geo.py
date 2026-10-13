#!/usr/bin/env python3
"""Build the shipped Luxtram geodata (orthophoto tiles, LiDAR terrain, LOD2 buildings, trees, rail-level profile).

Run after scripts/fetch_luxtram_geo.py and scripts/luxtram_lod2.py, with the venv python:
  /Users/Ian/Library/Caches/luxtram-work/.venv/bin/python scripts/build_luxtram_geo.py [profile] [tiles] [buildings] [trees] [far] [index]

Writes pb/train-sim/data/luxtram/:
  index.json        tile table (resolution, node step, building / tree counts), far tiles, credits
  o/<i>_<j>.webp    orthophoto, (N+2)^2 px (one px padding on every side), N = 128 m / res
  h/<i>_<j>.bin     LiDAR terrain (DTM) nodes: header + zig-zag varint residuals of a planar predictor, 2 cm units from 150 m
  b/<i>_<j>.json    LOD2 buildings of the tile (see pack_building)
  t/<i>_<j>.bin     trees from the LiDAR canopy (DSM - DTM outside buildings)
  f/<i>_<j>.webp|bin|json   far ring: orthophoto 2.5 m/px, 16 m terrain, simplified buildings
and geo/profile.json (rail level, bare-earth level every 6 m; consumed by build_luxtram.py).
"""
import json
import math
import os
import pickle
import struct
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter1d, median_filter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import luxtram_geo as G  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pb", "train-sim", "data", "luxtram")
H0 = 150.0         # height offset of the terrain encoding
HQ = 50.0          # 1 / 0.02 m
Q5 = 20.0          # building vertices: 5 cm
WEBP_Q = int(os.environ.get("LUXTRAM_WEBP_Q", "70"))
R_FULL = 170.0     # LOD2 buildings kept with all roof/wall polygons within this distance of the line
R_SIMPLE = 420.0   # ... as simplified extrusions (far ring) up to here


def out(*p):
    d = os.path.join(OUT, *p)
    os.makedirs(os.path.dirname(d), exist_ok=True)
    return d


# ----------------------------------------------------------------------------------------------------------------------------- height grids
class HGrid:
    def __init__(self, kind):
        self.t = {}
        d = os.path.join(G.RAW_GEO, "h")
        for f in os.listdir(d):
            if f.endswith(".npz"):
                i, j = map(int, f[:-4].split("_"))
                self.t[(i, j)] = np.load(os.path.join(d, f))[kind]

    def tile(self, i, j):
        return self.t.get((i, j))

    def at(self, x, z):
        x = np.asarray(x, float)
        z = np.asarray(z, float)
        res = np.full(x.shape, np.nan)
        fi = np.floor(x / G.TILE).astype(int)
        fj = np.floor(z / G.TILE).astype(int)
        for key in set(zip(fi.ravel().tolist(), fj.ravel().tolist())):
            a = self.t.get(key)
            if a is None:
                continue
            m = (fi == key[0]) & (fj == key[1])
            u = x[m] - key[0] * G.TILE
            v = z[m] - key[1] * G.TILE
            iu = np.clip(np.floor(u).astype(int), 0, 127)
            iv = np.clip(np.floor(v).astype(int), 0, 127)
            fu, fv = u - iu, v - iv
            res[m] = a[iv, iu] * (1 - fu) * (1 - fv) + a[iv, iu + 1] * fu * (1 - fv) + a[iv + 1, iu] * (1 - fu) * fv + a[iv + 1, iu + 1] * fu * fv
        return res


# ----------------------------------------------------------------------------------------------------------------------------- profile
def overpass_mask(X, Z, kinds):
    """True for chain samples that lie under an OSM road/footway/rail bridge (bridge=yes, not the tram's own)."""
    import build_luxtram as B
    from shapely.geometry import LineString, Point
    from shapely.strtree import STRtree
    lines, buf = [], []
    seen = set()
    for el in B.load_many(B.RAW_DEFAULT, "road"):
        if el["type"] != "way" or el["id"] in seen:
            continue
        seen.add(el["id"])
        t = el.get("tags", {})
        if t.get("bridge") not in ("yes", "viaduct") or not el.get("geometry"):
            continue
        pts = [B.proj(p["lat"], p["lon"]) for p in el["geometry"]]
        w = B.parse_height(t.get("width")) or B.ROAD_WIDTH.get(B.ROAD_CLASS.get(t.get("highway"), 4), 5.0)
        lines.append(LineString(pts).buffer(w / 2 + 1.5, cap_style=2))
    tree = STRtree(lines)
    mask = np.zeros(len(X), dtype=bool)
    for k in range(len(X)):
        if kinds[k]:
            continue
        for q in tree.query(Point(X[k], Z[k])):
            if lines[q].contains(Point(X[k], Z[k])):
                mask[k] = True
                break
    return mask


def build_profile(dtm, dsm, line, segs):
    """Rail level + bare earth along the OSM chain every 2 m, returned as keys every 6 m."""
    pts = np.array(line.pts)
    cum = np.array(line.cum)
    s = np.arange(0, cum[-1] + 1.0, 2.0)
    X = np.interp(s, cum, pts[:, 0])
    Z = np.interp(s, cum, pts[:, 1])
    dx, dz = np.gradient(X), np.gradient(Z)
    nl = np.hypot(dx, dz)
    nx, nz = -dz / nl, dx / nl
    ground = dtm.at(X, Z)
    deck = np.min([dsm.at(X + nx * o, Z + nz * o) for o in (-1.2, -0.6, 0, 0.6, 1.2)], axis=0)
    rail = ground.copy()
    kinds = np.zeros(len(s), dtype=np.uint8)    # 1 bridge 2 tunnel
    for a, b, spd, surf, flags, elec in segs:
        m = (s >= a) & (s <= b)
        if flags & 1:
            kinds[m] |= 1
        if flags & 2:
            kinds[m] |= 2
    # a viaduct often starts before the OSM bridge way does (ramp on structure): grow each bridge while the surface stays above the bare earth
    bidx = np.where(kinds & 1)[0]
    if len(bidx):
        for r in np.split(bidx, np.where(np.diff(bidx) > 1)[0] + 1):
            a, b = r[0], r[-1]
            for _ in range(50):
                if a > 0 and deck[a - 1] - ground[a - 1] > 0.5:
                    a -= 1
                else:
                    break
            for _ in range(50):
                if b < len(s) - 1 and deck[b + 1] - ground[b + 1] > 0.5:
                    b += 1
                else:
                    break
            kinds[a:b + 1] |= 1
    # bridges: the deck (surface model), median filtered against vehicles / wires
    deckf = median_filter(deck, size=9, mode="nearest")
    diff = deck - ground
    isb = (kinds & 1) > 0
    rail[isb] = np.where(diff[isb] > 0.8, deckf[isb], ground[isb])
    # a deck that the LiDAR sees as ground (embankment / OSM line a metre off the structure): where the bare earth dives >1.5 m below the straight
    # line between the span ends it is the valley under the bridge, not the deck
    bidx = np.where(isb)[0]
    if len(bidx):
        for r in np.split(bidx, np.where(np.diff(bidx) > 1)[0] + 1):
            a, b = max(0, r[0] - 1), min(len(s) - 1, r[-1] + 1)
            lin = np.linspace(rail[a], rail[b], b - a + 1)
            seg = slice(a, b + 1)
            bad = (diff[seg] <= 0.8) & (lin - rail[seg] > 1.5)
            rail[seg] = np.where(bad, lin, rail[seg])
    # tunnels: straight between the portals, taken a little outside the OSM tunnel extent
    idx = np.where(kinds & 2)[0]
    if len(idx):
        runs = np.split(idx, np.where(np.diff(idx) > 1)[0] + 1)
        for r in runs:
            a, b = max(0, r[0] - 6), min(len(s) - 1, r[-1] + 6)
            rail[a:b + 1] = np.linspace(ground[a], ground[b], b - a + 1)
            # cut-and-cover: the roof (5.7 m clearance + 0.7 m slab) must lie under the ground above it, which the LiDAR shows as bare earth
            roof = median_filter(ground, size=7, mode="nearest")
            rail[a:b + 1] = np.minimum(rail[a:b + 1], roof[a:b + 1] - 6.4)
    # road / footway bridges crossing OVER the line: the bare earth there is interpolated across the deck -> straight between the abutment-side levels
    over = overpass_mask(X, Z, kinds)
    oidx = np.where(over)[0]
    n_over = 0
    if len(oidx):
        for r in np.split(oidx, np.where(np.diff(oidx) > 1)[0] + 1):
            a, b = max(0, r[0] - 3), min(len(s) - 1, r[-1] + 3)
            rail[a:b + 1] = np.linspace(rail[a], rail[b], b - a + 1)
            n_over += 1
    print("profile: %d road bridges over the line flattened" % n_over)
    # plateaus left by overpasses OSM does not know: a step up of >1 m within 4 m, then a step down again within 80 m -> straight across
    free = kinds == 0
    n_plat = 0
    k = 2
    while k < len(s) - 2:
        if free[k] and rail[k + 2] - rail[k - 2] > 1.0:
            for m_ in range(k + 2, min(len(s) - 3, k + 40)):
                if rail[m_ - 2] - rail[m_ + 2] > 1.0 and free[m_ - 2:m_ + 3].all():
                    a, b = k - 2, m_ + 2
                    lin = np.linspace(rail[a], rail[b], b - a + 1)
                    if np.all(rail[a:b + 1] >= lin - 0.3) and free[a:b + 1].all():
                        rail[a:b + 1] = lin
                        n_plat += 1
                        k = b
                    break
        k += 1
    print("profile: %d overpass plateaus flattened" % n_plat)
    # spikes in the bare earth (overpasses over the line interpolate across): a 40 m median
    med = median_filter(rail, size=21, mode="nearest")
    spike = (np.abs(rail - med) > 0.9) & (kinds == 0)
    rail[spike] = med[spike]
    rail = uniform_filter1d(uniform_filter1d(rail, 5, mode="nearest"), 5, mode="nearest")
    ground_s = uniform_filter1d(median_filter(ground, size=5, mode="nearest"), 7, mode="nearest")
    for _ in range(30):          # grade limit (relaxation both ways), 7 %
        for k in range(1, len(rail)):
            d = rail[k] - rail[k - 1]
            if abs(d) > 0.14:
                rail[k] = rail[k - 1] + math.copysign(0.14, d)
        for k in range(len(rail) - 2, -1, -1):
            d = rail[k] - rail[k + 1]
            if abs(d) > 0.14:
                rail[k] = rail[k + 1] + math.copysign(0.14, d)
    rail = uniform_filter1d(rail, 5, mode="nearest")
    grade = np.abs(np.gradient(rail, 2.0))
    print("profile: max grade %.1f %% at s=%d (mean %.2f %%)" % (grade.max() * 100, s[grade.argmax()], grade.mean() * 100))
    step = 3
    keys = [[round(float(s[k]), 1), round(float(rail[k]), 2)] for k in range(0, len(s), step)]
    gkeys = [[round(float(s[k]), 1), round(float(ground_s[k]), 2)] for k in range(0, len(s), step)]
    return {"elev": keys, "ground": gkeys, "s": s, "X": X, "Z": Z, "rail": rail, "ground_raw": ground, "kinds": kinds, "deckmin": deck}


def build_dem(dtm, line, ground_keys):
    """Lateral relief grid for luxtram.js (props, passengers): half-metre ints of DTM(s, lat) - bare earth on the line, every 20 m."""
    pts = np.array(line.pts)
    cum = np.array(line.cum)
    offs = [-120, -60, -30, -15, -6, 0, 6, 15, 30, 60, 120]
    gs = np.array([k[0] for k in ground_keys])
    gh = np.array([k[1] for k in ground_keys])
    rows = []
    step = 20.0
    for s in np.arange(0, cum[-1] + step, step):
        sc = min(s, cum[-1])
        x, z = np.interp(sc, cum, pts[:, 0]), np.interp(sc, cum, pts[:, 1])
        x2, z2 = np.interp(min(sc + 2, cum[-1]), cum, pts[:, 0]), np.interp(min(sc + 2, cum[-1]), cum, pts[:, 1])
        dx, dz = x2 - x, z2 - z
        nl = math.hypot(dx, dz) or 1.0
        nx, nz = -dz / nl, dx / nl
        base = float(np.interp(sc, gs, gh))
        h = dtm.at(np.array([x + nx * o for o in offs]), np.array([z + nz * o for o in offs]))
        h = np.where(np.isnan(h), base, h)
        rows.append([int(round(max(-95, min(45, v - base)) * 2)) for v in h])
    return {"step": int(step), "offsets": offs, "rows": rows}


# ----------------------------------------------------------------------------------------------------------------------------- tiles
def zigzag(v):
    return (v << 1) ^ (v >> 31)


def varint(n, outb):
    while n >= 0x80:
        outb.append((n & 0x7F) | 0x80)
        n >>= 7
    outb.append(n)


def encode_heights(nodes):
    """nodes: float (n, n) array -> bytes: u8 n | residual stream.  Predictor: left + up - upleft."""
    q = np.round((nodes - H0) * HQ).astype(np.int64)
    n = q.shape[0]
    b = bytearray([n])
    varint(zigzag(int(q[0, 0])), b)
    for r in range(n):
        for c in range(n):
            if r == 0 and c == 0:
                continue
            if r == 0:
                pred = q[0, c - 1]
            elif c == 0:
                pred = q[r - 1, 0]
            else:
                pred = q[r, c - 1] + q[r - 1, c] - q[r - 1, c - 1]
            varint(zigzag(int(q[r, c] - pred)), b)
    return bytes(b)


def decode_heights(buf):
    n = buf[0]
    pos = 1
    vals = []
    while pos < len(buf):
        x = 0
        sh = 0
        while True:
            by = buf[pos]
            pos += 1
            x |= (by & 0x7F) << sh
            sh += 7
            if by < 0x80:
                break
        vals.append((x >> 1) ^ -(x & 1))
    q = np.zeros((n, n), dtype=np.int64)
    k = 0
    for r in range(n):
        for c in range(n):
            v = vals[k]
            k += 1
            if r == 0 and c == 0:
                q[0, 0] = v
            else:
                if r == 0:
                    pred = q[0, c - 1]
                elif c == 0:
                    pred = q[r - 1, 0]
                else:
                    pred = q[r, c - 1] + q[r - 1, c] - q[r - 1, c - 1]
                q[r, c] = pred + v
    return q / HQ + H0


def inpaint_bridges(im, i, j, res, masks):
    """The orthophoto shows the tram bridge deck on the ground below it (motorway, valley): paint those pixels with the colour around them."""
    if not masks:
        return im
    from PIL import ImageDraw
    from shapely.geometry import box
    rect = box(i * G.TILE - 3, j * G.TILE - 3, (i + 1) * G.TILE + 3, (j + 1) * G.TILE + 3)
    hit = [m for m in masks if m.intersects(rect)]
    if not hit:
        return im
    arr = np.asarray(im).copy()
    x0, z0 = i * G.TILE - res, j * G.TILE - res
    mk = Image.new("L", im.size, 0)
    ring = Image.new("L", im.size, 0)
    dm, dr = ImageDraw.Draw(mk), ImageDraw.Draw(ring)
    for m in hit:
        geoms = list(m.geoms) if hasattr(m, "geoms") else [m]
        for g in geoms:
            dr.polygon([((x - x0) / res, (z - z0) / res) for x, z in g.buffer(7).exterior.coords], fill=255)
    for m in hit:
        geoms = list(m.geoms) if hasattr(m, "geoms") else [m]
        for g in geoms:
            dm.polygon([((x - x0) / res, (z - z0) / res) for x, z in g.exterior.coords], fill=255)
    maskb = np.asarray(mk) > 0
    ringb = (np.asarray(ring) > 0) & ~maskb
    if maskb.sum() < 10 or ringb.sum() < 10:
        return im
    col = np.median(arr[ringb], axis=0)
    noise = np.random.default_rng(abs(i * 131 + j)).normal(0, 4, (int(maskb.sum()), 1))
    arr[maskb] = np.clip(col + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def build_tiles(tiles, dtm):
    total_o = total_h = 0
    meta = {}
    from shapely import wkt as _wkt
    mp = os.path.join(G.RAW_GEO, "bridge_masks.json")
    masks = [_wkt.loads(w) for w in json.load(open(mp))] if os.path.exists(mp) else []
    for c, (i, j, d, res) in enumerate(tiles):
        step = 2 if d <= G.R_MID else 4
        grid = dtm.tile(i, j)
        if grid is None:
            print("no heights for", i, j)
            continue
        nodes = grid[::step, ::step]
        hb = encode_heights(nodes)
        with open(out("h", "%d_%d.bin" % (i, j)), "wb") as fh:
            fh.write(hb)
        total_h += len(hb)
        src = os.path.join(G.RAW_GEO, "ortho", "%d_%d.png" % (i, j))
        im = Image.open(src).convert("RGB")
        im = inpaint_bridges(im, i, j, res, masks)
        im.save(out("o", "%d_%d.webp" % (i, j)), "WEBP", quality=WEBP_Q, method=6)
        total_o += os.path.getsize(out("o", "%d_%d.webp" % (i, j)))
        meta["%d_%d" % (i, j)] = {"res": round(res, 4), "px": im.size[0], "step": step, "d": round(d)}
        if c % 50 == 0:
            print("tiles", c, "/", len(tiles), "ortho %.1f MB heights %.2f MB" % (total_o / 1e6, total_h / 1e6))
    print("ortho total %.2f MB, heights total %.2f MB" % (total_o / 1e6, total_h / 1e6))
    return meta


# ----------------------------------------------------------------------------------------------------------------------------- buildings
def load_osm_buildings():
    """OSM building polygons with tags (for the kind / levels / colour of the LOD2 buildings)."""
    import build_luxtram as B
    from shapely.geometry import Polygon
    from shapely.strtree import STRtree
    els = B.load_many(B.RAW_DEFAULT, "bld")
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
                    tags.append((el["type"][0] + str(el["id"]), t))
    return STRtree(polys), polys, tags


def triangulate(ring3):
    """ring3: (n, 3) array of one planar polygon (x, z, y) -> list of index triples (earcut in the dominant plane)."""
    import mapbox_earcut as earcut
    n = len(ring3)
    if n == 3:
        return [(0, 1, 2)]
    # Newell normal in (x, z, y)
    nx = nz = ny = 0.0
    for k in range(n):
        a, b = ring3[k], ring3[(k + 1) % n]
        nx += (a[2] - b[2]) * (a[1] + b[1])
        ny += (a[1] - b[1]) * (a[0] + b[0])
        nz += (a[0] - b[0]) * (a[2] + b[2])
    ax = np.abs([nx, nz, ny])
    drop = int(ax.argmax())
    cols = [c for c in (0, 1, 2) if c != [0, 1, 2][drop]]
    p2 = np.ascontiguousarray(ring3[:, cols], dtype=np.float64)
    idx = earcut.triangulate_float64(p2, np.array([n], dtype=np.uint32))
    return [tuple(int(v) for v in idx[k:k + 3]) for k in range(0, len(idx), 3)]


def roof_colour(rec, ortho_cache, tiles_meta):
    """Median ortho colour under the roof (shrunk footprint of the roof polygons); None when the tile has no ortho."""
    from PIL import ImageDraw
    cx, cz = rec["c"]
    i, j = int(math.floor(cx / G.TILE)), int(math.floor(cz / G.TILE))
    key = "%d_%d" % (i, j)
    if key not in tiles_meta:
        return None
    if key not in ortho_cache:
        ortho_cache.clear()
        ortho_cache[key] = np.asarray(Image.open(os.path.join(G.RAW_GEO, "ortho", key + ".png")).convert("RGB"))
    arr = ortho_cache[key]
    res = tiles_meta[key]["res"]
    x0 = i * G.TILE - res
    z0 = j * G.TILE - res
    h, w = arr.shape[:2]
    mask = Image.new("L", (w, h), 0)
    dr = ImageDraw.Draw(mask)
    for ring in rec["roofs"]:
        if len(ring) < 3:
            continue
        # shrink a little towards the polygon centre so edges / walls are not sampled
        c = ring[:, :2].mean(axis=0)
        sh = c + (ring[:, :2] - c) * 0.8
        poly = [((p[0] - x0) / res, (p[1] - z0) / res) for p in sh]
        dr.polygon(poly, fill=255)
    m = np.asarray(mask) > 0
    if m.sum() < 4:
        return None
    px = arr[m].astype(float)
    return tuple(int(v) for v in np.median(px, axis=0))


def pack_building(rec, osm_info, rgb, anchor_round=10.0):
    """One building -> compact list.
    [gid8, kindCode, roofRGB(int), wallRGB(int), levels, ax, az, ay, nv, V, nR, R, nW, W, B]
      a* = anchor in decimetres (x, z) and decimetres of height; V = x,z,y per vertex in 5 cm relative to the anchor;
      R / W = triangle index lists (roof / wall); B = indices of wall vertices on the ground (pushed down to the terrain by the game)."""
    verts, vkey = [], {}

    def vid(p):
        k = (int(round(p[0] * Q5)), int(round(p[1] * Q5)), int(round(p[2] * Q5)))
        if k not in vkey:
            vkey[k] = len(verts)
            verts.append(k)
        return vkey[k]

    roof_t, wall_t = [], []
    for ring in rec["roofs"]:
        ids = [vid(p) for p in ring]
        for t in triangulate(ring):
            tri = (ids[t[0]], ids[t[1]], ids[t[2]])
            if len(set(tri)) == 3:
                roof_t.extend(tri)
    for ring in rec["walls"]:
        ids = [vid(p) for p in ring]
        for t in triangulate(ring):
            tri = (ids[t[0]], ids[t[1]], ids[t[2]])
            if len(set(tri)) == 3:
                wall_t.extend(tri)
    if not verts:
        return None
    ground_keys = set()
    for ring in rec["ground"]:
        for p in ring:
            ground_keys.add((int(round(p[0] * Q5)), int(round(p[1] * Q5)), int(round(p[2] * Q5))))
    bottom = [i for i, k in enumerate(verts) if k in ground_keys]
    if not bottom:                                  # walls start at the lowest wall vertices
        zlow = min(v[2] for v in verts)
        bottom = [i for i, k in enumerate(verts) if k[2] <= zlow + 4]
    ax = int(round(rec["c"][0] * 10))
    az = int(round(rec["c"][1] * 10))
    ay = int(round(min(v[2] for v in verts) / Q5 * 10))
    V = []
    for x, z, y in verts:
        V.extend([x - ax * 2, z - az * 2, y - ay * 2])
    kind, levels, wcol = osm_info
    return [rec["gid"][-8:], kind, (rgb[0] << 16 | rgb[1] << 8 | rgb[2]) if rgb else -1, wcol, levels, ax, az, ay, len(verts), V,
            len(roof_t) // 3, roof_t, len(wall_t) // 3, wall_t, bottom]


def pack_buildings_bin(lst):
    """b/<i>_<j>.bin: u16 count, then per building
       u8 kind, u8 levels, u8 flags (1 = roof colour, 2 = wall colour), u8 roof rgb x3, u8 wall rgb x3, i32 ax, az, ay (dm), u16 nv nR nW nB,
       i16 V[nv*3] (5 cm from the anchor), u16 R[nR*3], u16 W[nW*3], u16 B[nB]."""
    b = bytearray(struct.pack("<H", len(lst)))
    for gid, kind, roof, wall, levels, ax, az, ay, nv, V, nR, R, nW, W, B in lst:
        flags = (1 if roof >= 0 else 0) | (2 if wall else 0)
        rr = (roof >> 16 & 255, roof >> 8 & 255, roof & 255) if roof >= 0 else (0, 0, 0)
        ww = (wall >> 16 & 255, wall >> 8 & 255, wall & 255) if wall else (0, 0, 0)
        b += struct.pack("<BBB6B3i4H", kind, min(levels, 255), flags, *rr, *ww, ax, az, ay, nv, nR, nW, len(B))
        b += struct.pack("<%dh" % len(V), *V)
        b += struct.pack("<%dH" % len(R), *R)
        b += struct.pack("<%dH" % len(W), *W)
        b += struct.pack("<%dH" % len(B), *B)
    return bytes(b)


def osm_lookup(tree, polys, tags, rec):
    from shapely.geometry import Point
    import build_luxtram as B
    p = Point(rec["c"])
    best = None
    for k in tree.query(p):
        if polys[k].contains(p):
            best = k
            break
    if best is None:
        return (0, 0, 0, None)
    el, t = tags[best]
    b = t.get("building") or t.get("building:part") or "yes"
    kind = B.KIND.get(b, 0)
    lv = t.get("building:levels", "")
    levels = int(float(lv)) if lv.replace(".", "", 1).isdigit() else 0
    wcol = B.hex_color(t.get("building:colour"))
    return (kind, levels, wcol, el)


def build_buildings(meta):
    from shapely.geometry import Polygon
    from collections import defaultdict
    with open(os.path.join(G.RAW_GEO, "lod2_corridor.pkl"), "rb") as fh:
        blds = pickle.load(fh)
    tree, polys, tags = load_osm_buildings()
    ortho_cache = {}
    per_tile = defaultdict(list)
    far = defaultdict(list)
    covered_osm = set()
    n_full = n_simple = 0
    for rec in sorted(blds, key=lambda r: (int(math.floor(r["c"][0] / G.TILE)), int(math.floor(r["c"][1] / G.TILE)))):
        i, j = int(math.floor(rec["c"][0] / G.TILE)), int(math.floor(rec["c"][1] / G.TILE))
        info = osm_lookup(tree, polys, tags, rec)
        if info[3]:
            covered_osm.add(info[3])
        if rec["d"] <= R_FULL and "%d_%d" % (i, j) in meta:
            rgb = roof_colour(rec, ortho_cache, meta)
            pk = pack_building(rec, info[:3], rgb)
            if pk:
                per_tile["%d_%d" % (i, j)].append(pk)
                n_full += 1
        else:
            # far ring: footprint extrusion  [ringDm..., groundY, roofY, rgb]
            gp = rec["ground"][0] if rec["ground"] else None
            if gp is None or len(gp) < 3:
                continue
            ring = gp[:, :2]
            if Polygon(ring).area < 40:
                continue
            ring = [(round(p[0], 1), round(p[1], 1)) for p in ring[:: max(1, len(ring) // 10)]]
            far["%d_%d" % (math.floor(rec["c"][0] / 640), math.floor(rec["c"][1] / 640))].append(
                [rec["zmin"], rec["zmax"], [v for p in ring for v in p], info[0]])
            n_simple += 1
    total = 0
    for fn in os.listdir(out("b")):
        os.remove(os.path.join(OUT, "b", fn))
    for key, lst in per_tile.items():
        path = out("b", key + ".bin")
        with open(path, "wb") as fh:
            fh.write(pack_buildings_bin(lst))
        total += os.path.getsize(path)
    for key, lst in far.items():
        with open(out("f", "b_" + key + ".json"), "w") as fh:
            json.dump(lst, fh, separators=(",", ":"))
    print("buildings: %d full (%d tiles, %.2f MB), %d simplified" % (n_full, len(per_tile), total / 1e6, n_simple))
    # OSM footprints that overlap the LOD2 buildings by more than a third are dropped as well
    from shapely.ops import unary_union
    lod_polys = []
    for rec in blds:
        for ring in rec["ground"] or rec["roofs"]:
            if len(ring) >= 3:
                pg = Polygon(ring[:, :2])
                if pg.is_valid:
                    lod_polys.append(pg)
    union = unary_union(lod_polys)
    for k, pg in enumerate(polys):
        if tags[k][0] in covered_osm:
            continue
        try:
            if pg.area > 0 and pg.intersection(union).area / pg.area > 0.34:
                covered_osm.add(tags[k][0])
        except Exception:  # noqa: BLE001
            pass
    print("OSM footprints replaced by LOD2:", len(covered_osm))
    with open(os.path.join(G.RAW_GEO, "osm_covered.json"), "w") as fh:
        json.dump(sorted(covered_osm), fh)
    return {k: len(v) for k, v in per_tile.items()}


def structure_polygons():
    """Shapely polygons (local frame) where a DSM > DTM is a bridge / overpass / tunnel roof, not a tree: OSM bridges + the tram's own, the line corridor."""
    import build_luxtram as B
    from shapely.geometry import LineString
    from shapely.ops import unary_union
    polys = []
    seen = set()
    for el in B.load_many(B.RAW_DEFAULT, "road"):
        if el["type"] != "way" or el["id"] in seen or not el.get("geometry"):
            continue
        seen.add(el["id"])
        tg = el.get("tags", {})
        if tg.get("bridge") in ("yes", "viaduct", "movable") or tg.get("tunnel") in ("yes", "building_passage"):
            w = B.parse_height(tg.get("width")) or B.ROAD_WIDTH.get(B.ROAD_CLASS.get(tg.get("highway"), 4), 5.0)
            polys.append(LineString([B.proj(p["lat"], p["lon"]) for p in el["geometry"]]).buffer(w / 2 + 2.0))
    return unary_union(polys)


def build_trees(meta, dtm, dsm):
    """Canopy trees from the LiDAR: local maxima of DSM - DTM (>2.5 m) outside buildings, structures and the line corridor."""
    from PIL import ImageDraw
    from scipy.ndimage import gaussian_filter, maximum_filter, binary_dilation
    from shapely.geometry import box, LineString
    with open(os.path.join(G.RAW_GEO, "lod2_corridor.pkl"), "rb") as fh:
        blds = pickle.load(fh)
    from shapely.strtree import STRtree
    from shapely.geometry import Polygon
    bp = []
    for rec in blds:
        for ring in rec["ground"] or rec["roofs"]:
            if len(ring) >= 3:
                pg = Polygon(ring[:, :2])
                if pg.is_valid:
                    bp.append(pg)
    btree = STRtree(bp)
    struct_geom = structure_polygons()
    line_ls = LineString(G.line_points())
    corridor = line_ls.buffer(5.5)
    from shapely import wkt as _wkt
    mp = os.path.join(G.RAW_GEO, "bridge_masks.json")
    masks8 = [_wkt.loads(w).buffer(8) for w in json.load(open(mp))] if os.path.exists(mp) else []
    total = 0
    rng = np.random.default_rng(5)
    for key, m in meta.items():
        i, j = map(int, key.split("_"))
        if m["d"] > 160:
            continue
        G0 = 6  # margin (m)
        n = int(G.TILE) + 2 * G0
        xs = i * G.TILE - G0 + np.arange(n) + 0.5
        zs = j * G.TILE - G0 + np.arange(n) + 0.5
        X, Z = np.meshgrid(xs, zs)
        h = dsm.at(X, Z) - dtm.at(X, Z)
        h = np.nan_to_num(h, nan=0.0)
        mask = Image.new("L", (n, n), 0)
        dr = ImageDraw.Draw(mask)
        rect = box(i * G.TILE - G0, j * G.TILE - G0, (i + 1) * G.TILE + G0, (j + 1) * G.TILE + G0)

        def raster(geom):
            gs = [geom] if geom.geom_type == "Polygon" else list(getattr(geom, "geoms", []))
            for g in gs:
                if g.geom_type != "Polygon" or g.is_empty:
                    continue
                dr.polygon([(x - (i * G.TILE - G0), z - (j * G.TILE - G0)) for x, z in g.exterior.coords], fill=255)
        for k in btree.query(rect):
            raster(bp[k].buffer(1.2))
        raster(struct_geom.intersection(rect))
        raster(corridor.intersection(rect))
        blocked = np.asarray(mask) > 0
        # decks, roofs and walls are smooth in the surface model, canopy is rough
        S = np.nan_to_num(dsm.at(X, Z), nan=0.0)
        from scipy.ndimage import uniform_filter
        rough = np.sqrt(np.maximum(uniform_filter(S * S, 3) - uniform_filter(S, 3) ** 2, 0))
        for g in masks8:
            if g.intersects(rect):
                raster(g.intersection(rect))
        blocked = np.asarray(mask) > 0
        canopy = np.where(blocked | (h < 2.0) | (h > 45) | (rough < 0.22), 0.0, h)
        sm = gaussian_filter(canopy, 1.1)
        mx = (maximum_filter(sm, size=5) == sm) & (sm > 2.2)
        ys, xs_ = np.nonzero(mx)
        sel = [(r, c) for r, c in zip(ys, xs_) if G0 <= c < G0 + G.TILE and G0 <= r < G0 + G.TILE]
        if not sel:
            continue
        ortho = np.asarray(Image.open(os.path.join(G.RAW_GEO, "ortho", key + ".png")).convert("RGB"))
        res = m["res"]
        buf = bytearray()
        for r, c in sel:
            lx, lz = c - G0 + 0.5, r - G0 + 0.5      # metres from the tile corner
            hh = float(canopy[max(0, r - 1):r + 2, max(0, c - 1):c + 2].max())
            px = int(np.clip((lx + res) / res, 1, ortho.shape[1] - 2))
            pz = int(np.clip((lz + res) / res, 1, ortho.shape[0] - 2))
            rgb = ortho[pz - 1:pz + 2, px - 1:px + 2].reshape(-1, 3).mean(axis=0)
            c565 = ((int(rgb[0]) >> 3) << 11) | ((int(rgb[1]) >> 2) << 5) | (int(rgb[2]) >> 3)
            rad = float(np.clip(0.2 * hh + 0.8 + rng.uniform(-0.3, 0.4), 1.0, 5.5))
            buf += struct.pack("<HHBBH", int(lx * 10), int(lz * 10), int(min(255, hh * 4)), int(min(255, rad * 20)), c565)
        with open(out("t", key + ".bin"), "wb") as fh:
            fh.write(buf)
        total += len(buf)
        meta[key]["trees"] = len(sel)
    print("trees: %d bytes, %d trees" % (total, sum(v.get("trees", 0) for v in meta.values())))


def build_structures(prof, dtm, dsm):
    """Overpasses over the line found in the LiDAR: spans where the surface model is >4.3 m above the rails (not the tram's own bridges / tunnels).
    Each gets the deck polygon (flood fill of smooth, raised DSM cells connected to the span, outside buildings) and its plane."""
    import pickle
    from PIL import ImageDraw
    from shapely.geometry import MultiPoint, Polygon
    s, X, Z, rail, kinds, deck = prof["s"], prof["X"], prof["Z"], prof["rail"], prof["kinds"], prof["deckmin"]
    head = deck - rail
    idx = np.where((head > 4.3) & (kinds == 0))[0]
    spans = []
    for k in idx:
        if spans and k - spans[-1][1] <= 4:
            spans[-1][1] = k
        else:
            spans.append([k, k])
    with open(os.path.join(G.RAW_GEO, "lod2_corridor.pkl"), "rb") as fh:
        blds = pickle.load(fh)
    bpolys = []
    for rec in blds:
        for ring in rec["ground"] or rec["roofs"]:
            if len(ring) >= 3:
                bpolys.append(ring[:, :2])
    res = []
    for a, b in spans:
        length = (b - a) * 2.0
        if length < 5 or length > 90:
            continue
        mid = (a + b) // 2
        cx, cz = float(X[mid]), float(Z[mid])
        H = 70
        xs = cx - H + np.arange(2 * H) + 0.5
        zs = cz - H + np.arange(2 * H) + 0.5
        XX, ZZ = np.meshgrid(xs, zs)
        S = dsm.at(XX, ZZ)
        D = dtm.at(XX, ZZ)
        chm = np.nan_to_num(S - D, nan=0.0)
        blocked = Image.new("L", (2 * H, 2 * H), 0)
        dr = ImageDraw.Draw(blocked)
        for ring in bpolys:
            if abs(ring[:, 0].mean() - cx) < H + 40 and abs(ring[:, 1].mean() - cz) < H + 40:
                dr.polygon([(x - (cx - H), z - (cz - H)) for x, z in ring], fill=255)
        blocked = np.asarray(blocked) > 0
        ok = (chm > 1.5) & ~blocked
        seen = np.zeros_like(ok)
        stack = []
        for k in range(a, b + 1):
            c = int(X[k] - (cx - H)); r = int(Z[k] - (cz - H))
            if 0 <= r < 2 * H and 0 <= c < 2 * H and ok[r, c] and not seen[r, c]:
                seen[r, c] = True
                stack.append((r, c))
        n = 0
        while stack and n < 9000:
            r, c = stack.pop()
            n += 1
            for dr_, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                r2, c2 = r + dr_, c + dc
                if 0 <= r2 < 2 * H and 0 <= c2 < 2 * H and ok[r2, c2] and not seen[r2, c2] and abs(S[r2, c2] - S[r, c]) <= 0.45:
                    seen[r2, c2] = True
                    stack.append((r2, c2))
        if n >= 9000 or n < 30:
            print("  overpass at s=%d: component of %d cells rejected" % (s[mid], n))
            continue
        rr, cc = np.nonzero(seen)
        px, pz, pz_h = xs[cc], zs[rr], S[rr, cc]
        hull = MultiPoint(list(zip(px, pz))).convex_hull.buffer(0.5, join_style=2)
        if hull.geom_type != "Polygon":
            continue
        hull = hull.simplify(0.4)
        A = np.c_[px, pz, np.ones(len(px))]
        coef, *_ = np.linalg.lstsq(A, pz_h, rcond=None)
        resid = float(np.sqrt(np.mean((A @ coef - pz_h) ** 2)))
        if resid > 0.7:
            coef = np.array([0.0, 0.0, float(np.median(pz_h))])
        ring = list(hull.exterior.coords)[:-1]
        # span extent along the line, widened to where the clearance drops under 2 m
        a2, b2 = a, b
        while a2 > 0 and head[a2 - 1] > 2.0 and kinds[a2 - 1] == 0:
            a2 -= 1
        while b2 < len(s) - 1 and head[b2 + 1] > 2.0 and kinds[b2 + 1] == 0:
            b2 += 1
        rect = hull.minimum_rotated_rectangle
        rc = list(rect.exterior.coords)
        e1 = math.hypot(rc[1][0] - rc[0][0], rc[1][1] - rc[0][1])
        e2 = math.hypot(rc[2][0] - rc[1][0], rc[2][1] - rc[1][1])
        res.append({"w": round(min(e1, e2), 1), "s0": round(float(s[a2]) - 1.0, 1), "s1": round(float(s[b2]) + 1.0, 1), "poly": [round(v, 1) for p in ring for v in p],
                    "plane": [round(float(coef[0]), 5), round(float(coef[1]), 5), round(float(coef[2]), 2)], "rms": round(resid, 2), "cells": int(n)})
        print("  overpass s=%d..%d deck %d cells, clearance %.1f m, fit rms %.2f" % (s[a2], s[b2], n, float(np.median(head[a:b + 1])), resid))
    return res


FAR_TILE = 640.0
FAR_NODE = 20.0
FAR_PX = 186


def build_far():
    """Far ring: 640 m tiles, terrain nodes every 20 m (bilinear from the 8 m LiDAR samples), orthophoto 3.5 m/px, simplified buildings (f/b_*.json)."""
    from scipy.ndimage import map_coordinates
    d = os.path.join(G.RAW_GEO, "far")
    meta = {}
    tot_o = tot_h = 0
    n = int(FAR_TILE / FAR_NODE) + 1
    k = np.arange(n) * (FAR_NODE / 8.0)
    R, C = np.meshgrid(k, k, indexing="ij")
    for fn in sorted(os.listdir(d)):
        if not fn.startswith("h_"):
            continue
        key = fn[2:-4]
        dtm = np.load(os.path.join(d, fn))["dtm"]
        nodes = map_coordinates(dtm, [R, C], order=1, mode="nearest")
        hb = encode_heights(nodes)
        with open(out("f", "h_" + key + ".bin"), "wb") as fh:
            fh.write(hb)
        im = Image.open(os.path.join(d, "o_" + key + ".png")).convert("RGB").resize((FAR_PX, FAR_PX), Image.LANCZOS)
        p = out("f", "o_" + key + ".webp")
        im.save(p, "WEBP", quality=58, method=6)
        tot_o += os.path.getsize(p)
        tot_h += len(hb)
        meta[key] = {"px": FAR_PX}
        if os.path.exists(out("f", "b_" + key + ".json")):
            meta[key]["b"] = 1   # the client only requests far-building files that exist
    print("far: %d tiles, ortho %.2f MB, heights %.2f MB" % (len(meta), tot_o / 1e6, tot_h / 1e6))
    return meta


def main():
    steps = sys.argv[1:] or ["profile", "tiles", "buildings", "index"]
    line = G.line_points()
    tiles = G.tile_list(line)
    dtm = HGrid("dtm")
    if "profile" in steps:
        import build_luxtram as B
        tr = B.build_track(B.RAW_DEFAULT)
        dsm = HGrid("dsm")
        prof = build_profile(dtm, dsm, tr["line"], tr["segs"])
        dem = build_dem(dtm, tr["line"], prof["ground"])
        structures = {"over": build_structures(prof, dtm, dsm)}
        from shapely.geometry import LineString
        masks = []
        isb = ((prof["kinds"] & 1) > 0) & (prof["deckmin"] - prof["ground_raw"] > 2.0)
        bi = np.where(isb)[0]
        for r in (np.split(bi, np.where(np.diff(bi) > 1)[0] + 1) if len(bi) else []):
            if len(r) >= 3:
                masks.append(LineString(list(zip(prof["X"][r], prof["Z"][r]))).buffer(5.2, cap_style=2).wkt)
        with open(os.path.join(G.RAW_GEO, "bridge_masks.json"), "w") as fh:
            json.dump(masks, fh)
        print("bridge ortho masks:", len(masks))
        with open(out("structures.json"), "w") as fh:
            json.dump(structures, fh, separators=(",", ":"))
        with open(os.path.join(G.RAW_GEO, "profile.json"), "w") as fh:
            json.dump({"elev": prof["elev"], "ground": prof["ground"], "dem": dem}, fh)
        print("profile keys", len(prof["elev"]))
    meta = {}
    if "tiles" in steps:
        meta = build_tiles(tiles, dtm)
        with open(os.path.join(G.RAW_GEO, "tiles_meta.json"), "w") as fh:
            json.dump(meta, fh)
    else:
        mp = os.path.join(G.RAW_GEO, "tiles_meta.json")
        if os.path.exists(mp):
            meta = json.load(open(mp))
    bcount = {}
    if "buildings" in steps:
        bcount = build_buildings(meta)
    if "trees" in steps:
        build_trees(meta, dtm, HGrid("dsm"))
        with open(os.path.join(G.RAW_GEO, "tiles_meta.json"), "w") as fh:
            json.dump(meta, fh)
    far = {}
    if "far" in steps:
        far = build_far()
        with open(os.path.join(G.RAW_GEO, "far_meta.json"), "w") as fh:
            json.dump(far, fh)
    elif os.path.exists(os.path.join(G.RAW_GEO, "far_meta.json")):
        far = json.load(open(os.path.join(G.RAW_GEO, "far_meta.json")))
    if "index" in steps:
        bdir = os.path.join(OUT, "b")
        if not bcount and os.path.isdir(bdir):
            bcount = {f[:-4]: struct.unpack("<H", open(os.path.join(bdir, f), "rb").read(2))[0] for f in os.listdir(bdir) if f.endswith(".bin")}
        idx = {"v": 1, "tile": G.TILE, "origin": [G.LAT0, G.LON0], "tiles": meta, "bld": bcount, "far": far, "farTile": FAR_TILE, "farNode": FAR_NODE,
               "credit": "Geodata © ACT Luxembourg (geoportail.lu), CC0"}
        with open(out("index.json"), "w") as fh:
            json.dump(idx, fh, separators=(",", ":"))
        print("index written", len(meta), "tiles")


if __name__ == "__main__":
    main()
