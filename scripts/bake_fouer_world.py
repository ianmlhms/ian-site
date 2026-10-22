#!/usr/bin/env python3
"""Schueberfouer Tycoon, Wave W2 ("Ground"): bakes the Glacis-only world bundle  pb/fouer/data/glacis-world.bin.

Everything comes from the data the Luxtram sim already ships (CC0 / ODbL, see data/luxtram/index.json "credit"):
  h/  LiDAR 2024 terrain tiles     g/  painted ground (class map + AO + OSM vector layers)
  bf/ national LOD 2.2 buildings   t/  LiDAR canopy trees    f/  far ring (coarse terrain, class map, far buildings)
  luxtram-track.json               the Luxtram T1 centre line (stops Theater s 8481, Faiencerie s 8903)
  luxtram-landmarks.js             Grand Theatre / Institut / Red Bridge, run once in a headless browser
                                   (scripts/bake_fouer_landmarks.mjs) and stored as plain geometry + a 128 px atlas.
What the bake changes for the fair:
  - the Glacis (OSM way 9647317) and the bus park annex (49905042): NO parked cars (vec.pk emptied), bay lines kept but
    thinner (vec.m kind 5 width x0.55) so they read as faint paint between the rides; the class map is already asphalt there.
  - the LOD2 "ghost" building (the 20 m block captured while the fair stood on the field): every LOD2 record whose ground
    centre lies on the field polygons is dropped from bf/; LiDAR trees on the field are dropped too (those were tents).
  - tiles are cropped to a window around the field + the Theatre; the far ring (640 m tiles) covers the rest to ~2.4 km.
  - the whole bundle is one raw-deflate stream (FGWZ), decoded in the browser by pb/fouer/world/inflate.js.

Game frame (DESIGN 4.1): u along the tram toward NE, w toward Boulevard de la Foire (SE); anchor lat 49.6167784, lon 6.1237435
= (u 140, w 62), yaw -0.7335 rad.  The bundle keeps the Luxtram local metres (x east, z south from 49.6055 N / 6.164 E) because
the reused ground / facade modules paint in that frame; the runtime rotates one root group by -0.7335 rad (world/frame.js).

Run:  /Users/Ian/Library/Caches/luxtram-work/.venv/bin/python scripts/bake_fouer_world.py      (needs numpy + Pillow; node for the landmarks)
      add --refresh-landmarks to re-run the headless landmark bake (needs network once for three.js).
"""
import argparse
import base64
import io
import json
import math
import struct
import subprocess
import sys
import zlib
from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parent.parent
LUX = REPO / "pb/train-sim/data/luxtram"
OUT = REPO / "pb/fouer/data/glacis-world.bin"
WORK = Path("/Users/Ian/Library/Caches/luxtram-work/fouer")
OSM = Path("/Users/Ian/Library/Caches/fouer-refs/osm/glacis_bbox.json")

LAT0, LON0 = 49.6055, 6.164                       # Luxtram local origin
M_LAT = 111194.93
M_LON = M_LAT * math.cos(LAT0 * math.pi / 180)
ANCHOR = (49.6167784, 6.1237435)                 # = (u 140, w 62)
YAW = 0.7335
CY, SY = math.cos(YAW), math.sin(YAW)
U_ANCHOR, W_ANCHOR = 140.0, 62.0
TILE = 128
FAR_TILE, FAR_NODE = 640, 20

# window of high-detail tiles: within NEAR_D metres of the field polygon or LM_D of a landmark that must look right
NEAR_D = 165.0                                   # high-detail tile window (terrain + painted ground + trees): metres around the field
ZONE_D = 125.0                                   # LOD2 buildings (facade atlas) are kept within this distance of the field / the Theatre
LANDMARKS = [("theatre", "hi"), ("institut", "lo"), ("rouge", "lo")]
LM_NEAR = {"theatre": 150.0}                     # tiles within this distance of the Theatre are kept (buildings behind it)
FAR_CLS_N = 80                                   # far class maps are downsampled 160 -> 80 px (8 m per px)
FAR_R = 2300.0                                   # far ring radius around the field centre (metres)
BAY_WIDTH_K = 0.55
TRAM_S0, TRAM_S1 = 8250.0, 9060.0                # centre-line cut (Theater stop 8481, Faiencerie stop 8903)


def ll2loc(lat, lon):
    return ((lon - LON0) * M_LON, -(lat - LAT0) * M_LAT)


AX, AZ = ll2loc(*ANCHOR)


def loc2game(x, z):
    e, n = x - AX, -(z - AZ)
    return (U_ANCHOR + CY * e + SY * n, W_ANCHOR + SY * e - CY * n)


def point_in(poly, x, z):
    ins = False
    n = len(poly)
    for k in range(n):
        x1, z1 = poly[k]
        x2, z2 = poly[(k + 1) % n]
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1:
            ins = not ins
    return ins


def dist_to_poly(poly, x, z):
    best = 1e18
    for k in range(len(poly)):
        x1, z1 = poly[k]
        x2, z2 = poly[(k + 1) % len(poly)]
        dx, dz = x2 - x1, z2 - z1
        t = max(0.0, min(1.0, ((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz + 1e-9)))
        best = min(best, math.hypot(x - x1 - dx * t, z - z1 - dz * t))
    return best


def decode_heights(buf, hq=200.0):
    n = buf[0]
    q = np.zeros(n * n, dtype=np.int64)
    pos = 1
    for k in range(n * n):
        x = 0
        sh = 0
        while True:
            b = buf[pos]
            pos += 1
            x += (b & 0x7F) << sh
            sh += 7
            if b < 0x80:
                break
        v = -(x + 1) // 2 if x % 2 == 1 else x // 2
        r, c = divmod(k, n)
        if r == 0 and c == 0:
            pred = 0
        elif r == 0:
            pred = q[k - 1]
        elif c == 0:
            pred = q[k - n]
        else:
            pred = q[k - 1] + q[k - n] - q[k - n - 1]
        q[k] = pred + v
    return n, q.astype(np.float64) / hq + 150.0


def douglas(pts, tol):
    if len(pts) < 5:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax_, az_ = pts[a]
        bx, bz = pts[b]
        dx, dz = bx - ax_, bz - az_
        l2 = dx * dx + dz * dz + 1e-12
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            t = max(0.0, min(1.0, ((pts[i][0] - ax_) * dx + (pts[i][1] - az_) * dz) / l2))
            d = math.hypot(pts[i][0] - ax_ - dx * t, pts[i][1] - az_ - dz * t)
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


class Blob:
    """Collects binary sections; the header refers to them as [offset, length]."""

    def __init__(self):
        self.parts = []
        self.size = 0

    def add(self, data):
        data = bytes(data)
        ref = [self.size, len(data)]
        self.parts.append(data)
        self.size += len(data)
        return ref

    def bytes(self):
        return b"".join(self.parts)


def load_polys():
    osm = json.loads(OSM.read_text())
    ways = {e["id"]: e for e in osm["elements"] if e["type"] == "way"}
    out = {}
    for name, wid in (("glacis", 9647317), ("bus", 49905042)):
        out[name] = [ll2loc(p["lat"], p["lon"]) for p in ways[wid]["geometry"]]
        if out[name][0] == out[name][-1]:
            out[name] = out[name][:-1]
    return out


def edit_ground(buf, i, j, fields):
    """Cars off the field, bay lines thinner.  Returns (bytes, n_cars_removed, n_bay_lines)."""
    if buf[:2] != b"LG":
        raise SystemExit("bad ground tile")
    pl, sl, jl = struct.unpack("<III", buf[4:16])
    head = buf[:16]
    png, shp = buf[16:16 + pl], buf[16 + pl:16 + pl + sl]
    vec = json.loads(buf[16 + pl + sl:16 + pl + sl + jl])
    x0, z0 = i * TILE, j * TILE
    removed = bays = 0
    pk = vec.get("pk")
    if pk:
        keep = []
        for k in range(0, len(pk), 3):
            x, z = x0 + pk[k] / 100.0, z0 + pk[k + 1] / 100.0
            if any(point_in(p, x, z) for p in fields):
                removed += 1
            else:
                keep += pk[k:k + 3]
        vec["pk"] = keep
        if not keep:
            del vec["pk"]
    # carriageway polygons (vec.a) that lie wholly on the field are the car park's own aisles: the class map is asphalt there already
    if "a" in vec:
        kept = []
        for poly in vec["a"]:
            ring = poly[0]
            pts = [(x0 + ring[q] / 100.0, z0 + ring[q + 1] / 100.0) for q in range(0, len(ring) - 1, 2)]
            if pts and all(any(point_in(f, *pt) for f in fields) for pt in pts):
                continue
            kept.append(poly)
        vec["a"] = kept
        if not kept:
            del vec["a"]
    for m in vec.get("m", []):
        if m[0] != 5:
            continue
        pts = [(x0 + m[q] / 100.0, z0 + m[q + 1] / 100.0) for q in range(2, len(m) - 1, 2)]
        if any(point_in(p, *pt) for p in fields for pt in pts[:3] + pts[-1:]):
            m[1] = max(3, int(round(m[1] * BAY_WIDTH_K)))
            bays += 1
    js = json.dumps(vec, separators=(",", ":")).encode()
    return head[:4] + struct.pack("<III", pl, sl, len(js)) + png + shp + js, removed, bays


def edit_buildings(buf, i, j, fields, zone):
    """Drops every LOD2 record whose ground centre is on a fair field (the ghost block).  Record layout: facades parseTile()."""
    n = struct.unpack("<H", buf[:2])[0]
    p = 2
    keep = []
    dropped = []
    for _ in range(n):
        start = p
        ax, az = struct.unpack("<ii", buf[p + 15:p + 23])
        nv, nR, nW, nB, nRR, nWR = struct.unpack("<6H", buf[p + 27:p + 39])
        p += 39
        verts = np.frombuffer(buf, dtype="<i2", count=nv * 3, offset=p).reshape(-1, 3)
        p += nv * 6 + nR * 6 + nW * 6
        bottom = np.frombuffer(buf, dtype="<u2", count=nB, offset=p)
        p += nB * 2 + nRR * 2 + nWR * 2 + nWR
        idx = np.unique(bottom)
        cx = ax / 10.0 + verts[idx, 0].mean() / 20.0 if len(idx) else ax / 10.0
        cz = az / 10.0 + verts[idx, 1].mean() / 20.0 if len(idx) else az / 10.0
        if any(point_in(f, cx, cz) for f in fields):
            dropped.append((round(float(cx), 1), round(float(cz), 1), int(verts[:, 2].max() - verts[:, 2].min()) / 20.0))
        elif zone(cx, cz):
            keep.append(buf[start:p])
    return struct.pack("<H", len(keep)) + b"".join(keep), dropped


def edit_trees(buf, i, j, fields, extra_polys):
    out = bytearray()
    removed = 0
    for k in range(len(buf) // 8):
        r = buf[k * 8:k * 8 + 8]
        x = i * TILE + struct.unpack("<H", r[:2])[0] / 10.0
        z = j * TILE + struct.unpack("<H", r[2:4])[0] / 10.0
        if any(point_in(f, x, z) for f in fields) or any(point_in(f, x, z) for f in extra_polys):
            removed += 1
        else:
            out += r
    return bytes(out), removed


def encode_far_buildings(path, x0, z0, skip, fcx0=0.0, fcz0=0.0):
    """Far-ring building boxes: kind u8, n u8, zmin u16, zmax u16 (0.1 m above 100 m), first vertex int16 pair (0.1 m, tile origin - 1000 m),
    then int8 steps of 0.5 m (long edges get extra vertices).  `skip(x, z)` drops the ones the LOD2 zone already draws."""
    data = json.loads(path.read_text())
    kept = 0
    body = bytearray()
    for zmin, zmax, flat, kind in data:
        ring = [(flat[k], flat[k + 1]) for k in range(0, len(flat), 2)]
        cx = sum(p[0] for p in ring) / len(ring)
        cz = sum(p[1] for p in ring) / len(ring)
        if skip(cx, cz) or zmax - zmin < 3.0:
            continue
        area = 0.0
        for k in range(len(ring)):
            area += ring[k][0] * ring[(k + 1) % len(ring)][1] - ring[(k + 1) % len(ring)][0] * ring[k][1]
        dist = math.hypot(cx - fcx0, cz - fcz0)
        if dist > 1200 and abs(area) / 2 < 900 and zmax - zmin < 30:
            continue
        if dist > 600 and abs(area) / 2 < 400 and zmax - zmin < 20:     # small low houses far away are noise (and triangles)
            continue
        ring = douglas(ring + [ring[0]], 1.3)[:-1] if len(ring) > 5 else ring
        if len(ring) < 3:
            continue
        pts = []
        for k, (x, z) in enumerate(ring):
            pts.append((round(x * 2) / 2.0, round(z * 2) / 2.0))
            nx, nz = ring[(k + 1) % len(ring)]
            steps = int(math.hypot(nx - x, nz - z) // 60)
            for m in range(1, steps + 1):
                pts.append((round((x + (nx - x) * m / (steps + 1)) * 2) / 2.0, round((z + (nz - z) * m / (steps + 1)) * 2) / 2.0))
        if len(pts) > 255:
            continue
        body += struct.pack("<BBHH", kind, len(pts), int(round((zmin - 100) * 10)), int(round((zmax - 100) * 10)))
        body += struct.pack("<hh", int(round((pts[0][0] - x0 + 1000) * 10)), int(round((pts[0][1] - z0 + 1000) * 10)))
        for a, b in zip(pts, pts[1:]):
            body += struct.pack("<bb", int(round((b[0] - a[0]) * 2)), int(round((b[1] - a[1]) * 2)))
        kept += 1
    return struct.pack("<H", kept) + bytes(body), kept


def encode_far_heights(buf):
    """Far terrain, 0.25 m steps, the same 2-D predictor as the near tiles, zigzag uint16 residuals (deflate squeezes the zero high bytes)."""
    n, h = decode_heights(buf, 50.0)          # the far files keep the old 2 cm steps (Luxtram index v6 kept them for the far ring)
    q = np.round((h - 100.0) * 4.0).astype(np.int64)
    out = bytearray([n])
    for k in range(n * n):
        r, c = divmod(k, n)
        pred = 0 if r == 0 and c == 0 else q[k - 1] if r == 0 else q[k - n] if c == 0 else q[k - 1] + q[k - n] - q[k - n - 1]
        d = int(q[k] - pred)
        out += struct.pack("<H", ((d << 1) ^ (d >> 63)) & 0xFFFF)
    return bytes(out)


def tram_polyline():
    tr = json.loads((REPO / "pb/train-sim/data/luxtram-track.json").read_text())
    p = tr["path"]
    x, z = p[0], p[1]
    pts = [(x / 10.0, z / 10.0)]
    for k in range(2, len(p), 2):
        x += p[k]
        z += p[k + 1]
        pts.append((x / 10.0, z / 10.0))
    cum = [0.0]
    for k in range(1, len(pts)):
        cum.append(cum[-1] + math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]))
    # the file's s is the arc length of this polyline (stops: Theater 8481.0, Faiencerie 8902.8)
    cut = [[round(a, 2), round(b, 2), round(s, 2)] for (a, b), s in zip(pts, cum) if TRAM_S0 <= s <= TRAM_S1]
    stops = [{"name": s["name"], "s": s["s"], "side": s.get("side", "right")} for s in tr["stops"] if s["name"] in ("Theater", "Faïencerie")]
    return cut, stops


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh-landmarks", action="store_true")
    ap.add_argument("--near", type=float, default=NEAR_D)
    ap.add_argument("--far-r", type=float, default=FAR_R)
    args = ap.parse_args()
    WORK.mkdir(parents=True, exist_ok=True)

    idx = json.loads((LUX / "index.json").read_text())
    polys = load_polys()
    fields = [polys["glacis"], polys["bus"]]
    field_game = [[loc2game(*p) for p in poly] for poly in fields]
    fcx = sum(p[0] for p in polys["glacis"]) / len(polys["glacis"])
    fcz = sum(p[1] for p in polys["glacis"]) / len(polys["glacis"])

    # ---- landmarks (headless browser, cached)
    lm_json = WORK / "lm.json"
    if args.refresh_landmarks or not lm_json.exists():
        subprocess.check_call(["node", str(REPO / "scripts/bake_fouer_landmarks.mjs"), str(lm_json)] + [f"{k}:{l}" for k, l in LANDMARKS], cwd=REPO)
    lm = json.loads(lm_json.read_text())

    # ---- tile window
    theatre = (lm["landmarks"]["theatre:hi"]["x"], lm["landmarks"]["theatre:hi"]["z"])
    near = []
    for key in idx["tiles"]:
        i, j = map(int, key.split("_"))
        corners = [(i * TILE + a, j * TILE + b) for a in (0, 64, 128) for b in (0, 64, 128)]
        d = min(min(dist_to_poly(f, *c) for f in fields) for c in corners)
        inside = any(point_in(f, *c) for f in fields for c in corners)
        dt = min(math.hypot(c[0] - theatre[0], c[1] - theatre[1]) for c in corners)
        if inside or d <= args.near or dt <= LM_NEAR["theatre"]:
            near.append(key)
    near.sort(key=lambda k: tuple(map(int, k.split("_"))))

    def in_zone(x, z):
        return min(dist_to_poly(f, x, z) for f in fields) <= ZONE_D or math.hypot(x - theatre[0], z - theatre[1]) <= LM_NEAR["theatre"] + 10

    blob = Blob()
    cat = {}                                    # category -> raw bytes (to report the compressed share of each)
    tiles = {}
    stats = {"cars": 0, "bays": 0, "ghost": [], "trees": 0, "h": 0, "g": 0, "bf": 0, "t": 0}
    # trees must not stand in the Theatre / Institut footprints (the landmark models carry their own greenery)
    lm_foot = []
    for f in lm.get("footprints", []):
        lm_foot.append([ll2loc(a, b) for a, b in f["ring"]])
    elev = []
    for key in near:
        i, j = map(int, key.split("_"))
        meta = idx["tiles"][key]
        ent = {"step": meta["step"]}
        hb = (LUX / "h" / f"{key}.bin").read_bytes()
        ent["h"] = blob.add(hb)
        cat["h"] = cat.get("h", b"") + hb
        stats["h"] += len(hb)
        n, h = decode_heights(hb)
        gb = (LUX / "g" / f"{key}.bin").read_bytes()
        gb, rc, rb = edit_ground(gb, i, j, fields)
        stats["cars"] += rc
        stats["bays"] += rb
        ent["g"] = blob.add(gb)
        cat["g"] = cat.get("g", b"") + gb
        stats["g"] += len(gb)
        bpath = LUX / "bf" / f"{key}.bin"
        if bpath.exists():
            bb, dropped = edit_buildings(bpath.read_bytes(), i, j, fields, in_zone)
            stats["ghost"] += dropped
            ent["bf"] = blob.add(bb)
            cat["bf"] = cat.get("bf", b"") + bb
            stats["bf"] += len(bb)
        tpath = LUX / "t" / f"{key}.bin"
        if tpath.exists():
            tb, rt = edit_trees(tpath.read_bytes(), i, j, fields, [])
            stats["trees"] += rt
            if tb:
                ent["t"] = blob.add(tb)
                stats["t"] += len(tb)
        tiles[key] = ent
        # field elevation statistics
        for r in range(0, n, 4):
            for c in range(0, n, 4):
                x, z = i * TILE + c * (TILE / (n - 1)), j * TILE + r * (TILE / (n - 1))
                if point_in(polys["glacis"], x, z):
                    elev.append(h[r * n + c])
    oy = float(round(np.mean(elev)))
    # avenue trees: the OSM tree nodes (Allee Scheffer's double row of planes, Boulevard de la Foire) that the LiDAR canopy missed (leaf-off flight)
    osm = json.loads(OSM.read_text())
    lidar = []
    for key in near:
        i, j = map(int, key.split("_"))
        tb = (LUX / "t" / f"{key}.bin")
        if not tb.exists():
            continue
        buf = tb.read_bytes()
        for k in range(len(buf) // 8):
            lidar.append((i * TILE + struct.unpack("<H", buf[k * 8:k * 8 + 2])[0] / 10.0, j * TILE + struct.unpack("<H", buf[k * 8 + 2:k * 8 + 4])[0] / 10.0))
    lid = np.array(lidar) if lidar else np.zeros((0, 2))
    osm_trees = []
    for e in osm["elements"]:
        if e["type"] != "node" or e.get("tags", {}).get("natural") != "tree":
            continue
        x, z = ll2loc(e["lat"], e["lon"])
        if f"{int(math.floor(x / TILE))}_{int(math.floor(z / TILE))}" not in tiles:
            continue
        if any(point_in(f, x, z) for f in fields):
            continue
        if len(lid) and np.min(np.hypot(lid[:, 0] - x, lid[:, 1] - z)) < 3.5:
            continue
        osm_trees.append([round(x, 1), round(z, 1)])
    print(f"avenue trees from OSM: {len(osm_trees)} (LiDAR trees in the window: {len(lidar)})")
    print(f"near tiles {len(near)}: h {stats['h']} g {stats['g']} bf {stats['bf']} t {stats['t']} bytes raw; cars removed {stats['cars']}, bay lines thinned {stats['bays']}, trees on field {stats['trees']}")
    print("ghost buildings dropped:", stats["ghost"])
    print(f"field elevation mean {oy} m, min {min(elev):.1f}, max {max(elev):.1f}")

    # ---- far ring
    far = {}
    fk = []
    for key, meta in idx["far"].items():
        i, j = map(int, key.split("_"))
        cx, cz = (i + 0.5) * FAR_TILE, (j + 0.5) * FAR_TILE
        if math.hypot(cx - fcx, cz - fcz) <= args.far_r + FAR_TILE * 0.7:
            fk.append(key)
    nfb = 0
    for key in sorted(fk):
        i, j = map(int, key.split("_"))
        meta = idx["far"][key]
        ent = {}
        hb = encode_far_heights((LUX / "f" / f"h_{key}.bin").read_bytes())
        ent["h"] = blob.add(hb)
        cat["far-h"] = cat.get("far-h", b"") + hb
        png = Image.open(LUX / "f" / f"c_{key}.png").convert("L")
        cls = np.minimum(7, (np.array(png).astype(np.int32) + 16) >> 5).astype(np.uint8)
        f = cls.shape[0] // FAR_CLS_N                       # 2x2 blocks -> the class that wins (ties: the first)
        blocks = cls.reshape(FAR_CLS_N, f, FAR_CLS_N, f).transpose(0, 2, 1, 3).reshape(FAR_CLS_N, FAR_CLS_N, f * f)
        counts = np.stack([(blocks == c).sum(axis=2) for c in range(8)], axis=2)
        cls = counts.argmax(axis=2).astype(np.uint8)
        ent["c"] = blob.add(cls.tobytes())
        cat["far-c"] = cat.get("far-c", b"") + cls.tobytes()
        ent["cn"] = FAR_CLS_N
        bp = LUX / "f" / f"b_{key}.json"
        if meta.get("b") and bp.exists():
            fb, kept = encode_far_buildings(bp, i * FAR_TILE, j * FAR_TILE, in_zone, fcx, fcz)
            if kept:
                ent["b"] = blob.add(fb)
                cat["far-b"] = cat.get("far-b", b"") + fb
                ent["nb"] = kept
                nfb += kept
        far[key] = ent
    print(f"far tiles {len(far)}, far buildings {nfb}")
    print("deflated share:", {k: f"{len(v)}->{len(zlib.compress(v, 9))}" for k, v in cat.items()})

    # ---- landmarks + atlas
    lm_header = []
    for name, item in lm["landmarks"].items():
        if not item:
            raise SystemExit("landmark missing: " + name)
        key = name.split(":")[0]
        parts = []
        for pt in item["parts"]:
            parts.append({
                "n": pt["n"], "tris": pt["tris"], "ctr": [round(v, 4) for v in pt["ctr"]], "half": round(pt["half"], 4), "i32": pt["i32"],
                "pos": pt["pos"], "spin": pt["spin"],
                "P": blob.add(base64.b64decode(pt["P"])), "N": blob.add(base64.b64decode(pt["N"])), "UV": blob.add(base64.b64decode(pt["UV"])),
                "C": blob.add(base64.b64decode(pt["C"])), "I": blob.add(base64.b64decode(pt["I"])),
            })
        lm_header.append({"key": key, "lod": name.split(":")[1], "x": round(item["x"], 2), "z": round(item["z"], 2), "y": round(item["y"], 2), "parts": parts})
    atlas = lm["atlas"]
    day = Image.open(io.BytesIO(base64.b64decode(atlas["day"].split(",")[1]))).convert("RGB")
    lit = Image.open(io.BytesIO(base64.b64decode(atlas["lit"].split(",")[1]))).convert("RGB")
    bd, bl = io.BytesIO(), io.BytesIO()
    day.save(bd, "WEBP", quality=80, method=6)
    lit.save(bl, "WEBP", quality=80, method=6)
    atlas_h = {"day": blob.add(bd.getvalue()), "lit": blob.add(bl.getvalue()), "dayPx": list(day.size), "litPx": list(lit.size)}
    tris = sum(p["tris"] for l in lm_header for p in l["parts"])
    print(f"landmarks: {[(l['key'], l['lod'], sum(p['tris'] for p in l['parts'])) for l in lm_header]} = {tris} tris; atlas webp day {len(bd.getvalue())} lit {len(bl.getvalue())} bytes")

    # ---- tram
    pts, stops = tram_polyline()

    header = {
        "v": 1,
        "credit": "Geodata (c) ACT Luxembourg (geoportail.lu), CC0; (c) OpenStreetMap contributors, ODbL",
        "origin": {"lat0": LAT0, "lon0": LON0, "mLat": M_LAT, "mLon": M_LON},
        "frame": {"anchor": ANCHOR, "anchorLocal": [round(AX, 3), round(AZ, 3)], "yaw": YAW, "u": U_ANCHOR, "w": W_ANCHOR},
        "oy": oy,
        "tile": TILE, "farTile": FAR_TILE, "farNode": FAR_NODE,
        "tiles": tiles,
        "far": far,
        "polys": {"glacis": [[round(a, 2), round(b, 2)] for a, b in polys["glacis"]], "bus": [[round(a, 2), round(b, 2)] for a, b in polys["bus"]]},
        "polysGame": {"glacis": [[round(a, 2), round(b, 2)] for a, b in field_game[0]], "bus": [[round(a, 2), round(b, 2)] for a, b in field_game[1]]},
        "landmarks": lm_header,
        "footprints": [{"key": f["key"], "role": f["role"], "ring": [[round(a, 2), round(b, 2)] for a, b in [ll2loc(p[0], p[1]) for p in f["ring"]]]} for f in lm.get("footprints", [])],
        "atlas": atlas_h,
        "osmTrees": osm_trees,
        "tram": {"pts": pts, "stops": stops, "s0": TRAM_S0, "s1": TRAM_S1},
    }
    hjson = json.dumps(header, separators=(",", ":")).encode()
    raw = b"FGW1" + struct.pack("<I", len(hjson)) + hjson + blob.bytes()
    comp = zlib.compressobj(9, zlib.DEFLATED, -15)
    z = comp.compress(raw) + comp.flush()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(b"FGWZ" + struct.pack("<I", len(raw)) + z)
    print(f"raw {len(raw)} bytes (header {len(hjson)}), bundle {OUT.stat().st_size} bytes -> {OUT.relative_to(REPO)}")
    if OUT.stat().st_size > 700 * 1024:
        print("WARNING: bundle exceeds 700 KB", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
