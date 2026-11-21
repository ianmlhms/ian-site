#!/usr/bin/env python3
"""Bake one resort for the game: pb/ski/data/<resort>/

    nice -n 10 ~/Library/Caches/luxtram-work/.venv/bin/python scripts/ski/bake.py killy

Needs fetch_osm.py and fetch_dem.py first (both cached). Rerunnable; the output depends only on the cached downloads.

Writes
    resort.json        everything vector: pistes (the selectable runs, top -> bottom), the painted piste network, lifts + pylons, peaks,
                       places, the tile index, credits, map placement
    far.bin            MBG1 grid, FAR_STEP m, box + FAR_MARGIN (distant mountains, and the fallback everywhere)
    t/<tx>_<tz>.bin    MBG1 grids, NEAR_STEP m, (TILE_CELLS+1)^2 nodes: only tiles within NEAR_KEEP of a piste, lift or village are shipped.
                       Pistes are groomed in (heights smoothed under the piste mask)
    classes.bin        RLE raster, CLASS_STEP m over the box, bit field (see CLASS_BITS)
    buildings.json     one row per building: [cx, cz, length, width, angle, eave, ridge, ground, kind, footprint, roof, levels]
                       (oriented box, kind 0 chalet / 1 block / 2 chapel / 3 hut; footprint = [dx, dz, ...] in dm from the centre;
                       roof = ROOF_CODE or -1 unknown)
    map.webp           the painted base of the piste map (pistes, lifts and labels are drawn on top in the browser)

Piste difficulty (France): novice = green, easy = blue, intermediate = red, advanced / expert = black. freeride itineraries are not pistes.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import struct
import sys
import time
import unicodedata

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from codec import encode  # noqa: E402
from common import (CLASS_STEP, FAR_MARGIN, FAR_STEP, NEAR_KEEP, NEAR_STEP, OSM_CREDIT, RESORTS, SOURCE_CREDITS, TILE_CELLS, TILE_SIZE, Frame, out_dir,  # noqa: E402
                    resort_arg, work_dir)

DIFF_OF = {"novice": "green", "easy": "blue", "intermediate": "red", "advanced": "black", "expert": "black"}
DIFF_LETTER = {"green": "g", "blue": "b", "red": "r", "black": "k"}
HALF_WIDTH = {"green": 17, "blue": 18, "red": 15, "black": 13}
CLASS_BITS = {"forest": 1, "scrub": 2, "rock": 4, "water": 8, "built": 16, "piste": 32, "glacier": 64, "scree": 128}
TREE_LINE = 2450.0                 # m: no forest above this, whatever the map says
DERIVED_FOREST = 2150.0            # m: open stands are added below this on shady slopes (150 m lower on sunny ones) where OSM maps no forest
MIN_RUN_LENGTH = 350.0
MIN_RUN_DROP = 70.0
SLALOM_COUNT = 4
BUILDING_NEAR = 160.0              # m: with RESORTS[rid]["buildings"] == "villages", buildings this close to a piste or lift stay
H_STEP = 0.1                       # height quantum of the baked grids (m)
MAP_W = 1600
GROOM_SIGMA = 1.6                  # nodes (8 m): how much a piste smooths the terrain under it
GROOM_EDGE = 9.0                   # m of soft edge of the groomed band
BENCH_EDGE = 11.0                  # m beyond a piste's edge over which the bench cut fades back into the slope
BENCH_MAX = 8.0                    # m: never cut / fill more than this (a line that is off on the map must not dig a trench)
BENCH_STRENGTH = 0.85
def credits(rid):
    """The credit lines of the DEM sources this resort's data came from (fetch_dem.py records them in dem/sources.json), then OSM."""
    path = os.path.join(work_dir(rid, "dem"), "sources.json")
    used = []
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            used = json.load(fh)
    else:
        used = RESORTS[rid]["dem"] + RESORTS[rid]["far"]
    out = []
    for src in used:
        line = SOURCE_CREDITS.get(src)
        if line and line not in out:
            out.append(line)
    return out + [OSM_CREDIT]


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def slug(text):
    t = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"[^a-z0-9]+", "-", t).strip("-")
    return t[:28] or "piste"


# ---------------------------------------------------------------- loading
def load_osm(rid, name):
    with open(os.path.join(work_dir(rid, "osm"), name + ".json"), encoding="utf-8") as fh:
        return json.load(fh)["elements"]


def load_mosaic(rid, frame):
    n = TILE_CELLS
    big = np.zeros((frame.tiles_z * n + 1, frame.tiles_x * n + 1), np.float32)
    for tz in range(frame.tiles_z):
        for tx in range(frame.tiles_x):
            a = np.load(os.path.join(work_dir(rid, "dem"), "near_%d_%d.npy" % (tx, tz)))
            big[tz * n:tz * n + n + 1, tx * n:tx * n + n + 1] = a
    if np.isnan(big).any():
        raise SystemExit("near mosaic has %d NaN nodes: add a fallback DEM source" % int(np.isnan(big).sum()))
    return big


class Dem:
    """Bilinear read of the near mosaic in world metres."""

    def __init__(self, grid):
        self.g = grid

    def __call__(self, x, z):
        x = np.clip(np.asarray(x, np.float64) / NEAR_STEP, 0, self.g.shape[1] - 1.001)
        z = np.clip(np.asarray(z, np.float64) / NEAR_STEP, 0, self.g.shape[0] - 1.001)
        i, j = np.floor(x).astype(int), np.floor(z).astype(int)
        fx, fz = x - i, z - j
        g = self.g
        return (g[j, i] * (1 - fx) + g[j, i + 1] * fx) * (1 - fz) + (g[j + 1, i] * (1 - fx) + g[j + 1, i + 1] * fx) * fz


def way_xz(frame, geom):
    lons = np.array([p["lon"] for p in geom])
    lats = np.array([p["lat"] for p in geom])
    x, z = frame.to_world_many(lons, lats)
    return np.stack([x, z], axis=1)


def polyline_len(p):
    return float(np.sum(np.hypot(*(np.diff(p, axis=0).T)))) if len(p) > 1 else 0.0


def resample(p, step):
    seg = np.hypot(*(np.diff(p, axis=0).T))
    s = np.concatenate([[0], np.cumsum(seg)])
    if s[-1] < step:
        return p.copy()
    t = np.linspace(0, s[-1], int(math.ceil(s[-1] / step)) + 1)
    return np.stack([np.interp(t, s, p[:, 0]), np.interp(t, s, p[:, 1])], axis=1)


def smooth_line(p, radius_pts):
    if len(p) < 2 * radius_pts + 3:
        return p
    out = p.copy()
    k = np.ones(2 * radius_pts + 1) / (2 * radius_pts + 1)
    for c in range(2):
        padded = np.concatenate([np.full(radius_pts, p[0, c]), p[:, c], np.full(radius_pts, p[-1, c])])
        out[:, c] = np.convolve(padded, k, mode="valid")
    out[0], out[-1] = p[0], p[-1]
    return out


def dp_simplify(p, tol):
    """Douglas-Peucker (iterative)."""
    if len(p) < 3:
        return p
    keep = np.zeros(len(p), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(p) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ab = p[b] - p[a]
        L = math.hypot(*ab) or 1e-9
        d = np.abs((p[a + 1:b, 0] - p[a, 0]) * ab[1] - (p[a + 1:b, 1] - p[a, 1]) * ab[0]) / L
        i = int(np.argmax(d))
        if d[i] > tol:
            m = a + 1 + i
            keep[m] = True
            stack.append((a, m))
            stack.append((m, b))
    return p[keep]


def flat(p, nd=1):
    return [round(float(v), nd) for v in p.reshape(-1)]


# ---------------------------------------------------------------- pistes
def build_pistes(frame, dem):
    els = load_osm(frame.rid, "pistes")
    lines, areas = [], []
    for e in els:
        if e["type"] != "way" or "geometry" not in e:
            continue
        t = e.get("tags", {})
        diff = DIFF_OF.get(t.get("piste:difficulty", ""))
        if not diff or t.get("abandoned") or t.get("piste:abandoned") == "yes" or e["id"] in RESORTS[frame.rid].get("skip_ways", ()):
            continue
        p = way_xz(frame, e["geometry"])
        closed = len(p) > 3 and math.hypot(*(p[0] - p[-1])) < 0.5
        if t.get("area") == "yes" or (closed and t.get("area") != "no" and polyline_len(p) < 4000 and not t.get("name")):
            areas.append({"diff": diff, "poly": p})
            continue
        name = (t.get("piste:name") or t.get("name") or "").strip()
        h = dem(p[:, 0], p[:, 1])
        if h[0] < h[-1]:                      # orient downhill
            p, h = p[::-1].copy(), h[::-1].copy()
        width = None
        for key in ("piste:width", "width"):
            try:
                width = float(str(t.get(key, "")).replace("m", "").strip())
                break
            except ValueError:
                pass
        hw = max(6.0, min(40.0, width / 2)) if width else HALF_WIDTH[diff]
        lines.append({"id": e["id"], "name": name, "ref": t.get("piste:ref") or t.get("ref") or "", "diff": diff, "p": p, "h": h, "hw": hw, "tagged": bool(width)})
    log("piste ways", len(lines), "areas", len(areas))
    widen_from_areas(frame, lines, areas)

    # chain the named ways of one name + colour into runs (end of one ~ start of the next)
    groups = {}
    for ln in lines:
        if ln["name"]:
            groups.setdefault((ln["name"].lower(), ln["diff"]), []).append(ln)
    runs = []
    for (_, diff), segs in groups.items():
        chains = [[s] for s in segs]
        merged = True
        while merged:
            merged = False
            for a in chains:
                for b in chains:
                    if a is b:
                        continue
                    if math.hypot(*(a[-1]["p"][-1] - b[0]["p"][0])) < 25:
                        a.extend(b)
                        chains.remove(b)
                        merged = True
                        break
                if merged:
                    break
        for ch in chains:
            p = np.concatenate([ch[0]["p"]] + [s["p"][1:] for s in ch[1:]])
            p = resample(p, 5.0)
            p = smooth_line(p, 3)
            h = dem(p[:, 0], p[:, 1])
            # the run goes from its highest point (in the first third) to its lowest (in the last third): OSM lines often run on
            # over a flat or up the far side of a dip to the next lift, which would be a skate uphill at the finish
            n3 = max(1, len(h) // 3)
            i0 = int(np.argmax(h[:n3]))
            i1 = len(h) - n3 + int(np.argmin(h[-n3:]))
            p, h = p[i0:i1 + 1], h[i0:i1 + 1]
            if len(p) < 3:
                continue
            length = polyline_len(p)
            drop = float(h[0] - h[-1])
            if length < MIN_RUN_LENGTH or drop < MIN_RUN_DROP:
                continue
            runs.append({"name": ch[0]["name"], "ref": ch[0]["ref"], "diff": diff, "p": p, "h": h, "len": length, "drop": drop,
                         "hw": float(np.median([s["hw"] for s in ch]))})
    # one run per name + colour (the longest), unique ids
    best = {}
    for r in runs:
        k = (r["name"].lower(), r["diff"])
        if k not in best or r["len"] > best[k]["len"]:
            best[k] = r
    runs = sorted(best.values(), key=lambda r: (-r["drop"]))
    used = set()
    for r in runs:
        base = slug(r["name"])
        rid = base if base not in used else slug(r["name"] + "-" + r["diff"])
        n = 2
        while rid in used:
            rid = "%s-%d" % (base, n)
            n += 1
        used.add(rid)
        r["id"] = rid
    # slalom pistes: blue / red runs of 0.8 .. 2.2 km with a steady gradient, the steadiest first
    cand = [r for r in runs if r["diff"] in ("blue", "red") and 800 <= r["len"] <= 2200]
    cand.sort(key=lambda r: abs(r["drop"] / r["len"] - 0.2))
    for r in cand[:SLALOM_COUNT]:
        r["slalom"] = True
    log("runs", len(runs), "slalom", [r["id"] for r in runs if r.get("slalom")])
    return lines, areas, runs


def widen_from_areas(frame, lines, areas):
    """A piste line without a width tag that runs inside a mapped piste area takes its half width from the area (the median distance
    from the line to the area's edge), so wide slopes get wide groomed bands, poles at the real edge and the right shading."""
    if not areas:
        return
    s = NEAR_STEP
    shape = (int(frame.depth / s) + 1, int(frame.width / s) + 1)
    inside = raster_draw(shape, s, lambda d, sc: [d.polygon([(float(x) / sc, float(z) / sc) for x, z in a["poly"]], fill=255) for a in areas])
    dist_in = ndimage.distance_transform_edt(inside) * s
    n = 0
    for ln in lines:
        if ln["tagged"]:
            continue
        q = resample(ln["p"], 10.0)
        i = np.clip((q[:, 0] / s).astype(int), 0, shape[1] - 1)
        j = np.clip((q[:, 1] / s).astype(int), 0, shape[0] - 1)
        d = dist_in[j, i]
        if (d > 0).mean() < 0.6:
            continue
        hw = float(np.median(d[d > 0]))
        if hw > ln["hw"]:
            ln["hw"] = min(45.0, hw)
            n += 1
    log("piste half widths from areas:", n, "lines")


def bench(mosaic, lines):
    """Cuts every piste line flat across (a traverse gets its bench: cut into the slope above, fill below), the way pistes are built
    and groomed. Each node within a line's half width takes the height of the nearest point of the (along-line smoothed) centre line;
    the change fades out over BENCH_EDGE m beyond the edge, is capped at BENCH_MAX m and softened at the seams between lines."""
    s = NEAR_STEP
    seed = np.zeros(mosaic.shape, np.float32)
    seed_hw = np.zeros(mosaic.shape, np.float32)
    has = np.zeros(mosaic.shape, bool)
    for ln in lines:
        q = resample(ln["p"], s * 0.5)
        if len(q) < 3:
            continue
        i = np.clip(np.round(q[:, 0] / s).astype(int), 0, mosaic.shape[1] - 1)
        j = np.clip(np.round(q[:, 1] / s).astype(int), 0, mosaic.shape[0] - 1)
        h = mosaic[j, i].astype(np.float64)
        k = 9
        hs = np.convolve(np.pad(h, k, mode="edge"), np.ones(2 * k + 1) / (2 * k + 1), mode="same")[k:-k]
        seed[j, i] = hs
        seed_hw[j, i] = ln["hw"]
        has[j, i] = True
    dist, (jy, ix) = ndimage.distance_transform_edt(~has, return_indices=True)
    dist = dist * s
    target = seed[jy, ix]
    hw = seed_hw[jy, ix]
    t = np.clip((hw + BENCH_EDGE - dist) / BENCH_EDGE, 0, 1)
    w = t * t * (3 - 2 * t) * BENCH_STRENGTH
    delta = np.clip(target - mosaic, -BENCH_MAX, BENCH_MAX) * w
    delta = ndimage.gaussian_filter(delta, 1.0, mode="nearest")
    log("bench: mean |cut/fill| under pistes %.2f m, max %.1f m" % (float(np.abs(delta)[w > 0.5].mean()), float(np.abs(delta).max())))
    return (mosaic + delta).astype(np.float32)


# ---------------------------------------------------------------- rasters
def raster_draw(shape, scale, draw_fn):
    img = Image.new("L", (shape[1], shape[0]), 0)
    draw_fn(ImageDraw.Draw(img), scale)
    return np.asarray(img) > 0


def piste_mask(shape, step, lines, areas):
    """Soft 0..1 mask of every piste (lines with their half width, plus piste areas) on a grid of `step` m."""
    def draw(d, s):
        for ln in lines:
            pts = [(float(x) / s, float(z) / s) for x, z in ln["p"]]
            if len(pts) > 1:
                d.line(pts, fill=255, width=max(1, int(round(2 * ln["hw"] / s))), joint="curve")
            r = ln["hw"] / s
            for x, z in (pts[0], pts[-1]):
                d.ellipse([x - r, z - r, x + r, z + r], fill=255)
        for a in areas:
            d.polygon([(float(x) / s, float(z) / s) for x, z in a["poly"]], fill=255)
    inside = raster_draw(shape, step, draw)
    dist_out = ndimage.distance_transform_edt(~inside) * step
    dist_in = ndimage.distance_transform_edt(inside) * step
    signed = np.where(inside, -dist_in, dist_out)             # < 0 inside
    t = np.clip((GROOM_EDGE / 2 - signed) / GROOM_EDGE, 0, 1)
    return (t * t * (3 - 2 * t)).astype(np.float32)


def groom(mosaic, mask):
    smooth = ndimage.gaussian_filter(mosaic.astype(np.float64), GROOM_SIGMA, mode="nearest")
    return (mosaic + mask * (smooth - mosaic)).astype(np.float32)


def classes_raster(frame, dem_raw, areas_osm, piste_lines, piste_areas, buildings):
    nx, nz = int(frame.width / CLASS_STEP), int(frame.depth / CLASS_STEP)
    s = CLASS_STEP
    out = np.zeros((nz, nx), np.uint8)

    def poly_pts(p):
        return [(float(x) / s, float(z) / s) for x, z in p]

    def fill(bit, polys, lines=(), line_w=0):
        img = Image.new("L", (nx, nz), 0)
        d = ImageDraw.Draw(img)
        for p in polys:
            if len(p) > 2:
                d.polygon(poly_pts(p), fill=255)
        for p in lines:
            if len(p) > 1:
                d.line(poly_pts(p), fill=255, width=max(1, int(round(line_w / s))))
        m = np.asarray(img) > 0
        out[m] |= bit
        return m

    groups = {k: [] for k in CLASS_BITS}
    cliff_lines = []
    holes = {k: [] for k in CLASS_BITS}
    for e in areas_osm:
        t = e.get("tags", {})
        kind = None
        nat, lu = t.get("natural"), t.get("landuse")
        if nat == "wood" or lu == "forest":
            kind = "forest"
        elif nat in ("scrub", "heath"):
            kind = "scrub"
        elif nat in ("bare_rock", "rock"):
            kind = "rock"
        elif nat in ("scree", "shingle"):
            kind = "scree"
        elif nat == "glacier":
            kind = "glacier"
        elif nat == "water" or lu in ("reservoir", "basin") or t.get("waterway") == "riverbank":
            kind = "water"
        elif lu in ("residential", "commercial", "retail", "construction"):
            kind = "built"
        elif nat == "cliff":
            if e["type"] == "way" and "geometry" in e:
                cliff_lines.append(way_xz(frame, e["geometry"]))
            continue
        if not kind:
            continue
        if e["type"] == "way" and "geometry" in e:
            p = way_xz(frame, e["geometry"])
            if len(p) > 2 and math.hypot(*(p[0] - p[-1])) < 1:
                groups[kind].append(p)
        elif e["type"] == "relation":
            # outer rings: join the member ways into rings (simple greedy join); inner rings punch holes
            for role in ("outer", "inner"):
                parts = [way_xz(frame, m["geometry"]) for m in e.get("members", []) if m.get("role") == role and m.get("geometry")]
                for ring in join_rings(parts):
                    (groups if role == "outer" else holes)[kind].append(ring)
    for kind in ("glacier", "scree", "rock", "scrub", "forest", "water", "built"):
        fill(CLASS_BITS[kind], groups[kind], cliff_lines if kind == "rock" else (), 14)
        if holes[kind]:
            img = Image.new("L", (nx, nz), 0)
            d = ImageDraw.Draw(img)
            for p in holes[kind]:
                d.polygon(poly_pts(p), fill=255)
            out[np.asarray(img) > 0] &= ~np.uint8(CLASS_BITS[kind])
    # buildings are built-up land too (a little wider than the house)
    bimg = Image.new("L", (nx, nz), 0)
    d = ImageDraw.Draw(bimg)
    for b in buildings:
        d.polygon(poly_pts(b["poly"]), fill=255)
    bm = ndimage.binary_dilation(np.asarray(bimg) > 0, iterations=1)
    out[bm] |= CLASS_BITS["built"]
    # piste areas
    area_m = fill(CLASS_BITS["piste"], [a["poly"] for a in piste_areas])
    area_m = ndimage.binary_dilation(area_m, iterations=2)       # no trees on piste areas / runways, nor within 20 m of them
    # no forest on pistes, above the tree line, on water, or on very steep ground
    pm = piste_mask((nz, nx), s, piste_lines, [])
    zz, xx = np.mgrid[0:nz, 0:nx]
    h = dem_raw(xx * s + s / 2, zz * s + s / 2)
    gz, gx = np.gradient(h, s)
    slope = np.degrees(np.arctan(np.hypot(gx, gz)))
    tree_bits = np.uint8(CLASS_BITS["forest"] | CLASS_BITS["scrub"])
    # OSM maps only part of the larch and spruce stands of the valleys: below DERIVED_FOREST m (Tignes le Lac, 2100 m, stays bare), on slopes of 12..38 degrees, away from
    # pistes, villages and water, the gaps get open stands (scrub bit = sparse trees) in patches, the way the real lower slopes look
    rng = np.random.default_rng(11)
    patches = ndimage.gaussian_filter(rng.random((nz, nx)), 6)
    patches = (patches - patches.mean()) / (patches.std() + 1e-9)
    north = gz   # dh/dz > 0: the ground rises to the south, i.e. the slope faces north (shady, where the real stands are densest)
    shady = np.clip(north / np.maximum(np.hypot(gx, gz), 1e-6), -1, 1)
    derived = (h < DERIVED_FOREST - 150 + 150 * np.clip(shady, 0, 1)) & (slope > 16) & (slope < 42) & (patches > -0.35 + (h - 1700) / 450 - 0.35 * shady)
    dense = derived & (patches > 0.35 - 0.3 * shady)
    free = (out & CLASS_BITS["forest"]) == 0
    out[derived & free & ~dense] |= CLASS_BITS["scrub"]
    out[dense & free] |= CLASS_BITS["forest"]
    no_tree = (pm > 0.15) | area_m | (h > TREE_LINE) | ((out & CLASS_BITS["water"]) > 0) | (slope > 42) | ((out & CLASS_BITS["built"]) > 0)
    out[no_tree] &= ~tree_bits
    log("classes", {k: int(((out & v) > 0).sum()) for k, v in CLASS_BITS.items()})
    return out, nx, nz


def join_rings(parts):
    parts = [p for p in parts if len(p) > 1]
    rings = []
    while parts:
        cur = parts.pop(0)
        changed = True
        while changed and math.hypot(*(cur[0] - cur[-1])) > 1:
            changed = False
            for i, q in enumerate(parts):
                if math.hypot(*(cur[-1] - q[0])) < 1:
                    cur = np.concatenate([cur, q[1:]])
                elif math.hypot(*(cur[-1] - q[-1])) < 1:
                    cur = np.concatenate([cur, q[::-1][1:]])
                else:
                    continue
                parts.pop(i)
                changed = True
                break
        if len(cur) > 2:
            rings.append(cur)
    return rings


def rle(raster):
    flat_r = raster.reshape(-1)
    out = bytearray(struct.pack("<HH", raster.shape[1], raster.shape[0]))
    change = np.flatnonzero(np.diff(flat_r)) + 1
    starts = np.concatenate([[0], change])
    ends = np.concatenate([change, [flat_r.size]])
    for a, b in zip(starts.tolist(), ends.tolist()):
        out.append(int(flat_r[a]))
        run = b - a
        while True:
            byte = run & 0x7F
            run >>= 7
            if run:
                out.append(byte | 0x80)
            else:
                out.append(byte)
                break
    return bytes(out)


# ---------------------------------------------------------------- buildings, lifts, peaks
def build_buildings(frame, dem_raw):
    out = []
    # villages flagged "chalet" (Méribel, Courchevel: a building code that wants wood and stone) paint even big blocks as chalets
    chalet = [(*frame.to_world(v[1], v[2]), v[3]) for v in RESORTS[frame.rid].get("villages", ()) if len(v) > 4 and v[4] == "chalet"]
    for e in load_osm(frame.rid, "buildings"):
        if e["type"] != "way" or "geometry" not in e:
            continue
        t = e.get("tags", {})
        if t.get("building") in ("roof", "ruins", "construction") or t.get("location") == "underground":
            continue
        p = way_xz(frame, e["geometry"])
        if len(p) < 4:
            continue
        p = p[:-1] if math.hypot(*(p[0] - p[-1])) < 0.5 else p
        if not (0 <= p[:, 0].min() and p[:, 0].max() <= frame.width and 0 <= p[:, 1].min() and p[:, 1].max() <= frame.depth):
            continue
        area = 0.5 * abs(np.dot(p[:, 0], np.roll(p[:, 1], 1)) - np.dot(p[:, 1], np.roll(p[:, 0], 1)))
        if area < 12:
            continue
        # oriented box from the longest edge direction that gives the smallest box
        bestb = None
        for i in range(len(p)):
            d = p[(i + 1) % len(p)] - p[i]
            if math.hypot(*d) < 1:
                continue
            ang = math.atan2(d[1], d[0])
            c, s_ = math.cos(ang), math.sin(ang)
            u = p[:, 0] * c + p[:, 1] * s_
            v = -p[:, 0] * s_ + p[:, 1] * c
            boxa = (u.max() - u.min()) * (v.max() - v.min())
            if bestb is None or boxa < bestb[0]:
                bestb = (boxa, ang, u.min(), u.max(), v.min(), v.max())
        if bestb is None:
            continue
        boxa, ang, u0, u1, v0, v1 = bestb
        L, W = u1 - u0, v1 - v0
        k = math.sqrt(min(1.0, area / max(boxa, 1)))          # an L-shaped block: a box of the same area
        L, W = L * k, W * k
        if W > L:
            L, W, ang = W, L, ang + math.pi / 2
        cu, cv = (u0 + u1) / 2, (v0 + v1) / 2
        c, s_ = math.cos(bestb[1]), math.sin(bestb[1])
        cx, cz = cu * c - cv * s_, cu * s_ + cv * c
        lv = t.get("building:levels")
        try:
            levels = float(lv)
        except (TypeError, ValueError):
            levels = 2 if area < 140 else 3 if area < 420 else 5 if area < 1300 else 7
        kind = 0
        if t.get("building") in ("church", "chapel") or t.get("amenity") == "place_of_worship":
            kind = 2
        elif area > 420 or t.get("building") in ("apartments", "hotel", "commercial", "retail"):
            kind = 1
        elif area < 60 or t.get("building") in ("shed", "hut", "cabin", "service"):
            kind = 3
        if kind == 1 and any(math.hypot(cx_ - vx, cz_ - vz) < vr for vx, vz, vr in chalet for cx_, cz_ in [p.mean(axis=0)]):
            kind = 0
        try:
            eave = float(str(t.get("height", "")).replace("m", "")) * 0.8
        except ValueError:
            eave = levels * 2.9 + 0.6
        ridge = eave + min(W * 0.42, 6.5) if kind != 1 or W < 26 else eave + 2.5
        ground = float(np.min(dem_raw(np.r_[p[:, 0], cx], np.r_[p[:, 1], cz])))
        # the footprint itself (simplified, relative to the centre, decimetres) and what OSM says about the roof, for the renderer's
        # stepped blocks and L-shapes; appended to the row so older readers (the box) keep working
        q = dp_simplify(p, 0.6) if len(p) > 4 else p          # open ring: first and last vertex are kept
        foot = [int(round(v * 10)) for xy in (q - np.array([cx, cz])) for v in xy]
        roof = ROOF_CODE.get(t.get("roof:shape", ""), -1)
        out.append({"poly": p, "row": [round(cx, 1), round(cz, 1), round(L, 1), round(W, 1), round(ang % math.pi, 3), round(eave, 1), round(ridge, 1), round(ground, 1), kind,
                                       foot, roof, int(round(levels))]})
    log("buildings", len(out))
    return out


def build_aeroways(frame):
    """Runways, aprons, taxiways (OSM aeroway, optional layer) as piste-like polygons: [{"poly"}]. In winter the altiport runway is
    groomed snow, so it is smoothed like a piste and painted as one (never listed as a run)."""
    path = os.path.join(work_dir(frame.rid, "osm"), "aeroway.json")
    if not os.path.exists(path):
        return []
    out = []
    for e in load_osm(frame.rid, "aeroway"):
        if e["type"] != "way" or "geometry" not in e:
            continue
        t = e.get("tags", {})
        p = way_xz(frame, e["geometry"])
        if len(p) > 3 and math.hypot(*(p[0] - p[-1])) < 1:
            out.append({"poly": p})
            continue
        try:
            hw = float(str(t.get("width", "")).replace("m", "").strip()) / 2
        except ValueError:
            hw = 20.0 if t.get("aeroway") == "runway" else 8.0
        for a, b in zip(p[:-1], p[1:]):                       # a line: one rectangle per segment
            d = b - a
            L = math.hypot(*d)
            if L < 0.5:
                continue
            nrm = np.array([-d[1], d[0]]) / L * hw
            out.append({"poly": np.array([a + nrm, b + nrm, b - nrm, a - nrm])})
    log("aeroway polygons", len(out))
    return out

ROOF_CODE = {"gabled": 0, "flat": 1, "hipped": 2, "skillion": 3, "half-hipped": 2, "pyramidal": 4, "gambrel": 0, "mansard": 2}

LIFT_KIND = {"chair_lift": "chair", "gondola": "gondola", "cable_car": "cable", "mixed_lift": "gondola", "drag_lift": "drag", "t-bar": "drag",
             "j-bar": "drag", "platter": "drag", "rope_tow": "drag", "magic_carpet": "carpet"}
PYLON_GAP = {"chair": 110, "gondola": 220, "cable": 600, "drag": 70, "carpet": 0}


def build_lifts(frame, dem_raw):
    els = load_osm(frame.rid, "lifts")
    pylons = np.array([frame.to_world(e["lon"], e["lat"]) for e in els if e["type"] == "node" and e.get("tags", {}).get("aerialway") == "pylon"]) if els else np.zeros((0, 2))
    out = []
    for e in els:
        if e["type"] != "way" or "geometry" not in e:
            continue
        t = e.get("tags", {})
        kind = LIFT_KIND.get(t.get("aerialway", ""))
        if not kind or t.get("tunnel") == "yes" or t.get("layer", "0").startswith("-"):
            continue
        p = way_xz(frame, e["geometry"])
        h = dem_raw(p[:, 0], p[:, 1])
        if h[0] > h[-1]:
            p, h = p[::-1].copy(), h[::-1].copy()
        length = polyline_len(p)
        if length < 30:
            continue
        # pylons: the mapped ones near the line, else evenly spaced
        tow = []
        if len(pylons) and kind != "carpet":
            seg_pts = resample(p, 2.0)
            for q in pylons:
                d = np.hypot(seg_pts[:, 0] - q[0], seg_pts[:, 1] - q[1])
                if d.min() < 4:
                    tow.append(int(np.argmin(d)) * 2.0)
        if len(tow) < 2 and PYLON_GAP[kind]:
            n = max(1, int(length // PYLON_GAP[kind]))
            tow = [length * (i + 0.5) / n for i in range(n)] if n > 1 else [length / 2]
        tow = sorted(set(round(s, 1) for s in tow if 8 < s < length - 8))
        seats = t.get("aerialway:occupancy")
        try:
            seats = int(seats)
        except (TypeError, ValueError):
            seats = {"chair": 4, "gondola": 10, "cable": 120, "drag": 1, "carpet": 0}[kind]
        out.append({"name": t.get("name", ""), "kind": kind, "seats": seats, "pts": flat(dp_simplify(p, 0.8)), "pylons": tow, "len": round(length)})
    log("lifts", len(out))
    return out


def build_poi(frame):
    peaks, places = [], []
    for e in load_osm(frame.rid, "poi"):
        t = e.get("tags", {})
        if "lat" not in e or not t.get("name"):
            continue
        x, z = frame.to_world(e["lon"], e["lat"])
        if t.get("natural") == "peak":
            try:
                ele = float(str(t.get("ele", "")).replace(",", "."))
            except ValueError:
                ele = None
            peaks.append({"name": t["name"], "ele": ele, "x": round(x), "z": round(z)})
        elif t.get("place") in ("village", "town", "hamlet", "suburb"):
            places.append({"name": t["name"], "kind": t["place"], "x": round(x), "z": round(z)})
    return peaks, places


# ---------------------------------------------------------------- map
def paint_map(frame, mosaic, classes, outp):
    """The painted base of the piste map: snow light and shade, rock on steep faces, forests, lakes, villages. No pistes (drawn live)."""
    W = MAP_W
    H = int(round(W * frame.depth / frame.width))
    step = frame.width / W
    zz, xx = np.mgrid[0:H, 0:W]
    dem = Dem(mosaic)
    h = dem(xx * step + step / 2, zz * step + step / 2)
    h = ndimage.gaussian_filter(h, 0.7)
    gz, gx = np.gradient(h, step)
    nrm = np.stack([-gx, np.ones_like(h), -gz], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    def lam(az, el):
        a, e = math.radians(az), math.radians(el)
        L = np.array([math.sin(a) * math.cos(e), math.sin(e), -math.cos(a) * math.cos(e)])
        return np.clip(nrm @ L, 0, 1)
    light = 0.62 * lam(300, 38) + 0.25 * lam(250, 55) + 0.13 * lam(20, 60)
    light = np.round(light * 7) / 7 * 0.35 + light * 0.65                       # a hint of gouache banding
    slope = np.degrees(np.arctan(np.hypot(gx, gz)))
    snow_hi, snow_lo = np.array([0.985, 0.985, 0.97]), np.array([0.50, 0.58, 0.76])
    col = snow_lo + (snow_hi - snow_lo) * light[..., None]
    rock = np.clip((slope - 36) / 10, 0, 1)
    cls = np.asarray(Image.fromarray(classes).resize((W, H), Image.NEAREST))
    rock = np.maximum(rock, ((cls & CLASS_BITS["rock"]) > 0) * 0.55 * np.clip((slope - 25) / 12, 0, 1))
    rock_col = np.array([0.42, 0.38, 0.37]) * (0.55 + 0.6 * light[..., None])
    col = col * (1 - rock[..., None]) + rock_col * rock[..., None]
    rng = np.random.default_rng(7)
    noise = ndimage.gaussian_filter(rng.random((H, W)), 1.2)
    noise = (noise - noise.mean()) / (noise.std() + 1e-9)
    forest = ((cls & CLASS_BITS["forest"]) > 0).astype(float) + 0.45 * ((cls & CLASS_BITS["scrub"]) > 0)
    forest = ndimage.gaussian_filter(forest, 0.8)
    dots = np.clip(forest * (0.75 + 0.35 * noise), 0, 1)
    fcol = np.array([0.16, 0.30, 0.25]) * (0.6 + 0.6 * light[..., None])
    col = col * (1 - dots[..., None] * 0.9) + fcol * dots[..., None] * 0.9
    water = ndimage.gaussian_filter(((cls & CLASS_BITS["water"]) > 0).astype(float), 0.8)
    col = col * (1 - water[..., None] * 0.6) + np.array([0.72, 0.82, 0.9]) * water[..., None] * 0.6
    built = ndimage.gaussian_filter(((cls & CLASS_BITS["built"]) > 0).astype(float), 0.7)
    col = col * (1 - built[..., None] * 0.55) + np.array([0.78, 0.62, 0.48]) * built[..., None] * 0.55
    col = col * (1 + 0.025 * noise[..., None])
    img = Image.fromarray(np.clip(col * 255, 0, 255).astype(np.uint8), "RGB").filter(ImageFilter.SMOOTH_MORE)
    img.save(outp, "WEBP", quality=80, method=6)
    return W, H


# ---------------------------------------------------------------- mountain shadows
# The sun of the three times of day, the same numbers as TIMES in pb/ski/env.js (azimuth from north, clockwise; elevation; degrees).
SUNS = {"morning": (128, 16), "midday": (182, 29), "evening": (236, 7)}


def sun_shadows(far, out):
    """One soft shadow raster per time of day on the far grid (40 m): 255 = in the sun, 0 = in a mountain's shadow. The browser reads
    the one of the current time (shadow-<time>.webp), so the valleys lie in the shade of the ridges like the real ones."""
    from scipy.ndimage import map_coordinates
    nz, nx = far.shape
    jj, ii = np.mgrid[0:nz, 0:nx].astype(np.float32)
    for name, (az, el) in SUNS.items():
        a, e = math.radians(az), math.radians(el)
        dx, dz = math.sin(a), -math.cos(a)                 # towards the sun in grid steps (x east, z south)
        tan_e = math.tan(e)
        shade = np.zeros_like(far, dtype=np.float32)
        for k in range(1, 260):
            d = k * 1.0
            sample = map_coordinates(far, [jj + dz * d, ii + dx * d], order=1, mode="nearest")
            over = sample - (far + d * FAR_STEP * tan_e)
            shade = np.maximum(shade, np.clip(over / (12.0 + d * 1.5), 0, 1))
        lit = 1 - ndimage.gaussian_filter(shade, 0.8)
        Image.fromarray(np.clip(lit * 255, 0, 255).astype(np.uint8), "L").save(os.path.join(out, "shadow-%s.webp" % name), "WEBP", quality=72, method=6)
        log("shadow", name, "%.0f %% of the area in shade" % (100 * float((lit < 0.5).mean())))


# ---------------------------------------------------------------- main
def main():
    rid = resort_arg()
    cfg = RESORTS[rid]
    frame = Frame(rid)
    frame.rid = rid
    out = out_dir(rid)
    os.makedirs(os.path.join(out, "t"), exist_ok=True)
    log("frame", frame.tiles_x, "x", frame.tiles_z, "tiles", frame.width, frame.depth)
    raw = load_mosaic(rid, frame)
    dem_raw = Dem(raw)
    lines, areas, runs = build_pistes(frame, dem_raw)
    buildings = build_buildings(frame, dem_raw)
    lifts = build_lifts(frame, dem_raw)
    peaks, places = build_poi(frame)

    # groom the pistes into the 5 m mosaic
    strips = build_aeroways(frame)                            # snow-covered runways (the Courchevel altiport): groomed, no trees
    mask = piste_mask(raw.shape, NEAR_STEP, lines, areas + strips)
    groomed = groom(bench(raw, lines), mask)
    log("groomed: mean |change| under pistes %.2f m" % float(np.abs(groomed - raw)[mask > 0.5].mean()))

    # which height tiles are shipped
    interest = np.zeros((frame.tiles_z * 32, frame.tiles_x * 32), bool)        # 40 m cells
    def mark(p):
        q = resample(p, 20.0)
        i = np.clip((q[:, 0] / 40).astype(int), 0, interest.shape[1] - 1)
        j = np.clip((q[:, 1] / 40).astype(int), 0, interest.shape[0] - 1)
        interest[j, i] = True
    for ln in lines:
        mark(ln["p"])
    for a in areas:
        mark(a["poly"])
    for lf in lifts:
        mark(np.array(lf["pts"]).reshape(-1, 2))
    if cfg.get("buildings") == "villages":
        # a big area (3 Vallées): only the buildings of the listed villages and those next to a piste or lift (huts, stations)
        # are kept, so the valley towns below the ski area (Bozel, Saint-Jean, Moûtiers' outskirts) do not pull in height tiles
        lift_d = ndimage.distance_transform_edt(~interest) * 40
        vill = [(*frame.to_world(v[1], v[2]), v[3]) for v in cfg.get("villages", ())]
        def wanted(b):
            cx, cz = b["poly"].mean(axis=0)
            i = min(max(int(cx / 40), 0), interest.shape[1] - 1)
            j = min(max(int(cz / 40), 0), interest.shape[0] - 1)
            return lift_d[j, i] <= BUILDING_NEAR or any(math.hypot(cx - vx, cz - vz) <= vr for vx, vz, vr in vill)
        before = len(buildings)
        buildings = [b for b in buildings if wanted(b)]
        log("buildings kept near the villages / pistes", len(buildings), "of", before)
    for b in buildings:
        mark(b["poly"])
    for _, lon, lat, radius in cfg.get("keep", ()):            # landmarks far from the pistes (the Matterhorn) get their 5 m tiles too
        kx, kz = frame.to_world(lon, lat)
        jj, ii = np.mgrid[0:interest.shape[0], 0:interest.shape[1]]
        interest |= np.hypot(ii * 40 + 20 - kx, jj * 40 + 20 - kz) <= radius
    near = ndimage.distance_transform_edt(~interest) * 40 <= cfg.get("near_keep", NEAR_KEEP)
    shipped = []
    for tz in range(frame.tiles_z):
        for tx in range(frame.tiles_x):
            if near[tz * 32:(tz + 1) * 32, tx * 32:(tx + 1) * 32].any():
                shipped.append((tx, tz))
    log("shipped tiles", len(shipped), "of", frame.tiles_x * frame.tiles_z)
    for f in os.listdir(os.path.join(out, "t")):
        os.remove(os.path.join(out, "t", f))
    tile_bytes = 0
    n = TILE_CELLS
    tile_meta = []
    for tx, tz in shipped:
        g = groomed[tz * n:tz * n + n + 1, tx * n:tx * n + n + 1]
        blob, _ = encode(g, H_STEP, float(np.floor(g.min())))
        with open(os.path.join(out, "t", "%d_%d.bin" % (tx, tz)), "wb") as fh:
            fh.write(blob)
        tile_bytes += len(blob)
        tile_meta.append([tx, tz, len(blob)])
    log("tiles: %.2f MB" % (tile_bytes / 1e6))

    far = np.load(os.path.join(work_dir(rid, "dem"), "far.npy"))
    # the WMS answers at 40 m repeat about one column in six and carry a few single-node spikes: despike, soften, and inside the box
    # replace it by the (groomed) 5 m mosaic averaged down, so near and far agree where they meet
    if "ign-rgealti" in cfg["far"]:                           # (only the WMS answers have the spikes: elsewhere it would blunt real peaks)
        med = ndimage.median_filter(far, 3)
        far = np.where(np.abs(far - med) > 120, med, far)
    far = ndimage.gaussian_filter(far, 0.7, mode="nearest")
    k = int(round(FAR_STEP / NEAR_STEP))
    o = int(round(FAR_MARGIN / FAR_STEP))
    down = ndimage.gaussian_filter(groomed.astype(np.float64), k * 0.45, mode="nearest")[::k, ::k]
    far[o:o + down.shape[0], o:o + down.shape[1]] = down
    fj, fi = np.unravel_index(int(np.nanargmax(far)), far.shape)
    log("far grid %dx%d, highest %.0f m at world x %.0f z %.0f" % (far.shape[1], far.shape[0], far[fj, fi], fi * FAR_STEP - FAR_MARGIN, fj * FAR_STEP - FAR_MARGIN))
    far_blob, far_dec = encode(far, 0.25, float(np.floor(np.nanmin(far))))
    sun_shadows(far_dec.astype(np.float32), out)
    with open(os.path.join(out, "far.bin"), "wb") as fh:
        fh.write(far_blob)
    log("far.bin %.2f MB" % (len(far_blob) / 1e6))

    classes, cnx, cnz = classes_raster(frame, dem_raw, load_osm(rid, "areas"), lines, areas + strips, buildings)
    cblob = rle(classes)
    with open(os.path.join(out, "classes.bin"), "wb") as fh:
        fh.write(cblob)
    log("classes.bin %.2f MB" % (len(cblob) / 1e6))

    with open(os.path.join(out, "buildings.json"), "w", encoding="utf-8") as fh:
        json.dump([b["row"] for b in buildings], fh, separators=(",", ":"))

    mw, mh = paint_map(frame, groomed, classes, os.path.join(out, "map.webp"))

    network = []
    for ln in lines:
        q = dp_simplify(ln["p"], 1.5)
        network.append({"d": DIFF_LETTER[ln["diff"]], "w": round(ln["hw"], 1), "p": flat(q)})
    for a in areas:
        network.append({"d": DIFF_LETTER[a["diff"]], "a": 1, "p": flat(dp_simplify(a["poly"], 1.5))})
    pistes = []
    for r in runs:
        q = resample(r["p"], 10.0)
        pistes.append({"id": r["id"], "name": r["name"], "ref": r["ref"], "diff": r["diff"], "len": round(r["len"]), "drop": round(r["drop"]),
                       "top": round(float(r["h"][0])), "bottom": round(float(r["h"][-1])), "hw": round(r["hw"], 1),
                       "slalom": bool(r.get("slalom")), "line": flat(q)})
    lon0, lat0 = frame.to_lonlat(0, 0)
    resort = {
        "v": 1, "id": rid, "name": cfg["name"], "short": cfg["short"], "country": cfg["country"], "crs": frame.crs,
        "origin": {"east": frame.east0, "north": frame.north0, "lon": round(lon0, 5), "lat": round(lat0, 5)},
        "width": frame.width, "depth": frame.depth,
        "tiles": {"cells": TILE_CELLS, "step": NEAR_STEP, "nx": frame.tiles_x, "nz": frame.tiles_z, "list": tile_meta},
        "far": {"step": FAR_STEP, "margin": FAR_MARGIN, "nx": int(far.shape[1]), "nz": int(far.shape[0])},
        "classes": {"step": CLASS_STEP, "nx": cnx, "nz": cnz, "bits": CLASS_BITS},
        "map": {"file": "map.webp", "w": mw, "h": mh},
        "shadows": {"file": "shadow-{time}.webp", "suns": SUNS},
        "pistes": pistes, "network": network, "lifts": lifts, "peaks": peaks, "places": places, "start": cfg.get("start"),
        "credits": credits(rid),
        "bake": {"date": time.strftime("%Y-%m-%d"), "script": "scripts/ski/bake.py"},
    }
    with open(os.path.join(out, "resort.json"), "w", encoding="utf-8") as fh:
        json.dump(resort, fh, ensure_ascii=False, separators=(",", ":"))
    sizes = {f: os.path.getsize(os.path.join(out, f)) for f in os.listdir(out) if os.path.isfile(os.path.join(out, f))}
    log("sizes", {k: "%.0f KB" % (v / 1024) for k, v in sizes.items()}, "total %.2f MB" % ((sum(sizes.values()) + tile_bytes) / 1e6))
    log("pistes", len(pistes), "network", len(network), "lifts", len(lifts), "peaks", len(peaks), "buildings", len(buildings))
    log("next: python3 scripts/ski/make_sql.py (leaderboard floors in scripts/ski-v1.sql)")

if __name__ == "__main__":
    main()
