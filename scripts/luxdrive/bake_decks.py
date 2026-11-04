#!/usr/bin/env python3
"""Bake the bridge decks of Lux Drive into pb/lux-drive/data/decks.bin.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/luxdrive/bake_decks.py

A bridge is NOT carved into the terrain: the LiDAR DTM under a bridge is the ground below it, and
the road surface of the bridge is the LiDAR DSM (the deck).  So every OSM way tagged bridge=yes
becomes a solid deck: a polyline with the real deck height at every point (from the 2 m DSM),
pinned to the ground at its two ends so the deck meets the approach road exactly.

decks.bin layout (little endian):
    u32 count
    per deck:
      u16 flags        bit0 = has a parapet
      u16 width        (decimetres, the width of the solid deck)
      u16 npts
      i32 x0 (decimetres), i32 z0 (decimetres)
      varint zigzag deltas of x and z (decimetres)
      f32[] tops       (the deck surface height at every point, metres)
"""
import json
import math
import os
import sys

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (OUT_DIR, RAW_DIR, ORIGIN_E, ORIGIN_N_TOP, world_to_luref)  # noqa: E402
from roads_io import FLAG_OVER, FLAG_TUNNEL, decode_roads, road_length  # noqa: E402

COG_BASE = ("https://download.data.public.lu/resources/bd-l-lidar2024-releve-3d-du-territoire-"
            "luxembourgeois/20241223-093912/")
COG = COG_BASE + "MNS_Lidar2024.tif"
DSM_STEP = 2.0            # m, the resolution the deck heights are read at
SAMPLE_M = 4.0            # m, the spacing of the deck centre line points
MAX_CLEARANCE = 40.0      # m: a DSM value further above the ground is a tree, not a deck
LIFT = 0.05               # m: the deck sits this far above the ground where it meets it
STRIP_ROWS = 2048         # rows of the 2 m DSM read at once (memory)


def resample(pts, step):
    """Points along the polyline, every `step` metres (plus the last point)."""
    out = [pts[0]]
    for i in range(1, len(pts)):
        ax, az = pts[i - 1]
        bx, bz = pts[i]
        seg = math.hypot(bx - ax, bz - az)
        if seg < 1e-9:
            continue
        last = out[-1]
        d = step - math.hypot(ax - last[0], az - last[1])
        while d <= seg:
            t = d / seg
            out.append((ax + (bx - ax) * t, az + (bz - az) * t))
            d += step
    if out[-1] != pts[-1]:
        out.append(pts[-1])
    return out


def sample_dsm_median(grid, west, north, step, px, py, radius=2.5):
    """The middle DSM value within `radius` metres of the LUREF point (px, py).

    The median, not the maximum: a tree that stands beside the bridge is higher than the deck, and
    the maximum would lift the whole bridge to the top of the tree (a slab floating in the air).  The
    middle value is the deck itself, as long as the canopy covers less than the half of the window.
    """
    gx = (px - west) / step
    gy = (north - py) / step
    i0 = int(math.floor(gx - radius / step))
    i1 = int(math.ceil(gx + radius / step))
    j0 = int(math.floor(gy - radius / step))
    j1 = int(math.ceil(gy + radius / step))
    i0 = max(0, i0); j0 = max(0, j0)
    i1 = min(grid.shape[1] - 1, i1); j1 = min(grid.shape[0] - 1, j1)
    if i1 < i0 or j1 < j0:
        return None
    return float(np.median(grid[j0:j1 + 1, i0:i1 + 1]))


def smooth(values, window):
    """Moving average with the ends pinned (a deck must not wobble at the abutments)."""
    n = len(values)
    if n < 3:
        return list(values)
    out = list(values)
    half = window // 2
    for i in range(1, n - 1):
        a = max(0, i - half)
        b = min(n, i + half + 1)
        out[i] = sum(values[a:b]) / (b - a)
    out[0] = values[0]
    out[-1] = values[-1]
    return out


def median_filter(values, window):
    """A median filter along the deck: the deck is a ramp, a tree over it is a local bump.

    A median filter keeps a straight ramp (the middle of a straight line is the line) and it removes
    a bump that is shorter than the half of the window, which is what a canopy is.  The ends are
    pinned: the deck meets the ground there.
    """
    n = len(values)
    if n < 3:
        return list(values)
    out = list(values)
    half = window // 2
    for i in range(n):
        a = max(0, i - half)
        b = min(n, i + half + 1)
        out[i] = float(np.median(values[a:b]))
    out[0] = values[0]
    out[-1] = values[-1]
    return out


def main():
    roads, names = decode_roads()
    ground = np.load(os.path.join(RAW_DIR, "dtm4.npy")).astype(np.float64)

    def ground_at(x, z):
        """The game's terrain height (the 4 m DTM, bilinear)."""
        gx = min(ground.shape[1] - 1.001, max(0.0, x / 4.0))
        gz = min(ground.shape[0] - 1.001, max(0.0, z / 4.0))
        i = int(gx); j = int(gz)
        tx = gx - i; tz = gz - j
        a = ground[j, i] * (1 - tx) + ground[j, i + 1] * tx
        b = ground[j + 1, i] * (1 - tx) + ground[j + 1, i + 1] * tx
        return a * (1 - tz) + b * tz

    bridges = [r for r in roads if r["flags"] & FLAG_OVER and not (r["flags"] & FLAG_TUNNEL)]
    # group the ways of one bridge: parallel ways of the same bridge (a road and its footpath)
    # are separate decks; they share the DSM profile, so they are read together.
    prepared = []
    for r in bridges:
        pts = r["pts"]
        if len(pts) < 2:
            continue
        line = resample(pts, SAMPLE_M)
        if len(line) < 2:
            continue
        e, n = world_to_luref([p[0] for p in line], [p[1] for p in line])
        e = np.asarray(e); n = np.asarray(n)
        prepared.append({"road": r, "line": line, "e": e, "n": n,
                         "g": [ground_at(p[0], p[1]) for p in line]})
    if not prepared:
        print("no bridges")
        return

    east = max(p["e"].max() for p in prepared)
    north = max(p["n"].max() for p in prepared)
    west = min(p["e"].min() for p in prepared)
    south = min(p["n"].min() for p in prepared)
    print("bridges %d  window %.0f x %.0f m" % (len(prepared), east - west, north - south))

    # read the DSM at 2 m in strips and sample every bridge that falls into the strip
    tops = [[None] * len(p["line"]) for p in prepared]
    rows = int((north - south) / DSM_STEP) + 1
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", VSI_CACHE="TRUE",
                       VSI_CACHE_SIZE="134217728", GDAL_HTTP_MAX_RETRY="6"):
        with rasterio.open("/vsicurl/" + COG) as ds:
            for r0 in range(0, rows, STRIP_ROWS):
                nr = min(STRIP_ROWS, rows - r0)
                top = north - r0 * DSM_STEP
                bot = top - nr * DSM_STEP
                win = from_bounds(west, bot, east, top, ds.transform)
                grid = ds.read(1, window=win, out_shape=(nr, int((east - west) / DSM_STEP) + 1),
                               resampling=Resampling.average)
                for pi, p in enumerate(prepared):
                    for k, (px, py) in enumerate(zip(p["e"], p["n"])):
                        if bot <= py <= top:
                            v = sample_dsm_median(grid, west, top, DSM_STEP, px, py)
                            if v is not None:
                                tops[pi][k] = v
                print("  strip %d / %d" % (r0 + nr, rows), flush=True)

    decks = []
    skipped = 0
    for pi, p in enumerate(prepared):
        r = p["road"]
        line = p["line"]
        g = p["g"]
        raw = tops[pi]
        # the DSM at the ends is the approach road (on the ground), in the middle the deck
        vals = []
        for k in range(len(line)):
            v = raw[k]
            if v is None or (v - g[k]) > MAX_CLEARANCE or (v - g[k]) < -2.0:
                v = g[k]
            vals.append(max(v, g[k]))
        # a tree over the bridge is a bump in the profile, the deck is a ramp: the median filter
        # takes the bump away and keeps the ramp
        vals = median_filter(vals, 9)
        vals = smooth(vals, 5)
        # the deck meets the ground at its two ends
        vals[0] = g[0] + LIFT
        vals[-1] = g[-1] + LIFT
        # and it never dips below the ground in between
        for k in range(len(vals)):
            if vals[k] < g[k] + LIFT:
                vals[k] = g[k] + LIFT
        clear = max(vals[k] - g[k] for k in range(len(vals)))
        if clear < 1.2:
            skipped += 1        # not really a bridge: the road runs on the ground
            continue
        length = sum(math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])
                     for i in range(1, len(line)))
        if clear > 0.7 * max(length, 1.0):
            # a deck that stands higher than the half of its own length is not a bridge: the DSM
            # read something else (a tree, a roof).  It would float in the air.
            skipped += 1
            continue
        w = r["width"] + 1.2
        decks.append({"road": r, "pts": line, "tops": vals, "w": w,
                      "clear": clear, "kind": r["kind"], "name": r["name"]})

    print("decks %d  skipped %d" % (len(decks), skipped))
    decks.sort(key=lambda d: -d["clear"])
    for d in decks[:8]:
        print("  %-22s %-14s len %5.0f  clearance %4.1f m  width %4.1f" %
              (d["name"][:22], d["kind"], sum(math.hypot(d["pts"][i][0] - d["pts"][i - 1][0],
                                                         d["pts"][i][1] - d["pts"][i - 1][1])
                                             for i in range(1, len(d["pts"]))),
               d["clear"], d["w"]))

    blob = bytearray()
    blob += (len(decks)).to_bytes(4, "little")
    total_pts = 0
    for d in decks:
        pts = d["pts"]
        flags = 1 if d["kind"] in ("motorway", "trunk", "primary", "secondary") else 0
        blob += flags.to_bytes(2, "little")
        blob += int(round(d["w"] * 10)).to_bytes(2, "little")
        blob += len(pts).to_bytes(2, "little")
        px, pz = round(pts[0][0] * 10), round(pts[0][1] * 10)
        blob += px.to_bytes(4, "little", signed=True)
        blob += pz.to_bytes(4, "little", signed=True)
        for x, z in pts[1:]:
            qx, qz = round(x * 10), round(z * 10)
            varint(zigzag(qx - px), blob)
            varint(zigzag(qz - pz), blob)
            px, pz = qx, qz
        for h in d["tops"]:
            blob += np.float32(h).tobytes()
        total_pts += len(pts)

    with open(os.path.join(OUT_DIR, "decks.bin"), "wb") as fh:
        fh.write(blob)
    meta = {"count": len(decks), "points": total_pts, "bytes": len(blob)}
    with open(os.path.join(OUT_DIR, "decks.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=1)
    print("decks.bin %.1f kB" % (len(blob) / 1024.0))


def varint(n, out):
    while n >= 0x80:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    out.append(n)


def zigzag(n):
    return (n << 1) ^ (n >> 63)


if __name__ == "__main__":
    main()
