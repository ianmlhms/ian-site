#!/usr/bin/env python3
"""Validate a station patch JSON (format: scripts/zuch/STATION-PATCH-FORMAT.md) and print a short summary.

    /Users/Ian/Library/Caches/luxtram-work/.venv/bin/python scripts/zuch/check_station_patch.py pb/train-sim/data/stations/munsbach.json

Exit code 1 if any ERROR was found (warnings do not fail).  Needs numpy + pillow.
"""
import base64
import io
import json
import math
import os
import struct
import sys

import numpy as np
from PIL import Image

XMIN, XMAX, ZMIN, ZMAX = -160.0, 160.0, -320.0, 320.0
TOL = 0.51                       # roads/rails/platforms are clipped to the extent (rounded to 0.01 m)
MAX_BYTES = 1_500_000
ROAD_CLS = {"primary", "secondary", "tertiary", "residential", "service", "track", "path", "footway", "cycleway", "steps"}
BLD_KIND = {"house", "apartments", "commercial", "industrial", "retail", "garage", "shed", "church", "other"}
ROOF = {"gable", "hip", "flat", "other"}
POI = {"tree", "bench", "bus_stop", "lamp", "bin", "parking", "bike_parking", "shelter", "ticket"}
RAIL_KIND = {"main", "siding", "yard"}
WATER_KIND = {"river", "pond"}

errors, warnings = [], []


def err(msg):
    if len(errors) < 60:
        errors.append(msg)


def warn(msg):
    warnings.append(msg)


def finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def check_pts(name, pts, n, inside=True, tol=TOL):
    if not isinstance(pts, list) or len(pts) < 2:
        err("%s: needs >= 2 points" % name)
        return
    for p in pts:
        if not (isinstance(p, list) and len(p) == n and all(finite(c) for c in p)):
            err("%s: bad point %r" % (name, p))
            return
        if inside and not (XMIN - tol <= p[0] <= XMAX + tol and ZMIN - tol <= p[1] <= ZMAX + tol):
            err("%s: point outside the extent %r" % (name, p))
            return


def ring_area(r):
    a = 0.0
    for i in range(len(r)):
        x0, y0 = r[i]
        x1, y1 = r[(i + 1) % len(r)]
        a += x0 * y1 - x1 * y0
    return abs(a) / 2


def check_ring(name, r, dims):
    """Rings are implicitly closed (first vertex is not repeated); need >= 3 finite vertices, no duplicate neighbours, non-zero area."""
    if not isinstance(r, list) or len(r) < 3:
        err("%s: ring needs >= 3 vertices" % name)
        return False
    for p in r:
        if not (isinstance(p, list) and len(p) == dims and all(finite(c) for c in p)):
            err("%s: bad vertex %r" % (name, p))
            return False
    if r[0] == r[-1]:
        err("%s: ring repeats its first vertex (rings are implicitly closed)" % name)
        return False
    return True


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    path = sys.argv[1]
    size = os.path.getsize(path)

    def bad_const(c):
        raise ValueError("non-finite number literal " + c)
    try:
        with open(path) as fh:
            d = json.load(fh, parse_constant=bad_const)
    except Exception as e:  # noqa: BLE001
        print("ERROR: cannot parse JSON:", e)
        return 1
    if size > MAX_BYTES:
        warn("file is %.2f MB (> 1.5 MB)" % (size / 1e6))
    for k in ("v", "key", "name", "origin", "side", "extent", "dem", "classes", "roads", "rails", "platforms", "water", "buildings", "trees", "poi"):
        if k not in d:
            err("missing key " + k)
    if errors:
        return report(path, size, d)
    if d["v"] != 1:
        err("v must be 1")
    base = os.path.basename(path)[:-5]
    if d["key"] != base:
        warn("key %r differs from the file name %r" % (d["key"], base))
    o = d["origin"]
    for k in ("lat", "lon", "headingDeg"):
        if not finite(o.get(k)):
            err("origin." + k)
    if not (isinstance(o.get("epsg2169"), list) and len(o["epsg2169"]) == 2 and all(finite(c) for c in o["epsg2169"])):
        err("origin.epsg2169")
    elif not (45 < o["lat"] < 55 and 4 < o["lon"] < 9 and 0 <= o["headingDeg"] < 360):
        err("origin lat/lon/heading out of range")
    if d["side"] not in ("left", "right"):
        err("side must be left|right")
    if d["extent"] != {"x": [-160, 160], "z": [-320, 320]}:
        err("extent must be x[-160,160] z[-320,320]")
    # ---- DEM
    dm = d["dem"]
    nx, nz = dm.get("nx"), dm.get("nz")
    dem = None
    if (dm.get("res"), nx, nz, dm.get("x0"), dm.get("z0")) != (2, 161, 321, -160, -320):
        err("dem header must be res 2, nx 161, nz 321, x0 -160, z0 -320")
    else:
        raw = base64.b64decode(dm["dm"])
        if len(raw) != nx * nz * 2:
            err("dem byte length %d != %d" % (len(raw), nx * nz * 2))
        else:
            dem = np.frombuffer(raw, "<i2").reshape(nz, nx) / 10.0
            if dem.min() < -40 or dem.max() > 60:
                err("DEM outside -40..+60 m: %.1f .. %.1f" % (dem.min(), dem.max()))
            xs = -160 + 2 * np.arange(nx)
            cor = dem[:, np.abs(xs) <= 4]
            ty = d.get("trackY")
            if ty and max(abs(p[1]) for p in ty) > 0.5:
                warn("track gradient kept in the heights (trackY range %.2f m)" % (max(p[1] for p in ty) - min(p[1] for p in ty)))
            if np.abs(cor).max() > 0.31 and not (ty and max(abs(p[1]) for p in ty) > 0.5):
                err("track corridor (|x|<=4) not flat near 0: max |y| = %.2f m" % np.abs(cor).max())
            if np.abs(np.diff(cor, axis=1)).max() > 0.11:
                err("track corridor not flat across x")
            if np.abs(np.diff(dem, axis=0)).max() > 12:
                warn("DEM has a step > 12 m between rows (cliff or bad data)")
    # ---- class PNG
    cl = d["classes"]
    cls_hist = {}
    if (cl.get("res"), cl.get("nx"), cl.get("nz"), cl.get("x0"), cl.get("z0")) != (1, 320, 640, -160, -320):
        err("classes header must be res 1, nx 320, nz 640, x0 -160, z0 -320")
    else:
        png = base64.b64decode(cl["png"])
        if png[:8] != b"\x89PNG\r\n\x1a\n":
            err("classes.png is not a PNG")
        else:
            chunks, pos = [], 8
            while pos < len(png):
                ln = struct.unpack(">I", png[pos:pos + 4])[0]
                chunks.append(png[pos + 4:pos + 8].decode("latin1"))
                pos += 12 + ln
            bad = [c for c in chunks if c in ("PLTE", "gAMA", "iCCP", "sRGB", "cHRM")]
            if bad:
                err("class PNG has forbidden chunks %s (need plain 8-bit grayscale)" % bad)
            im = Image.open(io.BytesIO(png))
            if im.mode != "L" or im.size != (320, 640):
                err("class PNG must be mode L 320x640, got %s %s" % (im.mode, im.size))
            else:
                a = np.asarray(im)
                if (a % 16).any() or a.max() > 128:
                    err("class PNG values must be class*16 (0..128)")
                cls_hist = {int(k) // 16: int((a == k).sum()) for k in np.unique(a)}
                if cls_hist.get(7, 0) < 100:
                    warn("almost no building pixels in the class map")
    # ---- vectors
    for i, r in enumerate(d["roads"]):
        if r.get("cls") not in ROAD_CLS or not (finite(r.get("w")) and r["w"] > 0) or r.get("oneway") not in (0, 1) or r.get("bridge") not in (0, 1) or not isinstance(r.get("name"), str):
            err("road %d: bad fields" % i)
        check_pts("road %d" % i, r.get("pts"), 3)
        if any(not (-45 <= p[2] <= 65) for p in r.get("pts", []) if isinstance(p, list) and len(p) == 3 and finite(p[2])):
            err("road %d: y out of range" % i)
    for i, r in enumerate(d["rails"]):
        if r.get("kind") not in RAIL_KIND or r.get("main") not in (0, 1):
            err("rail %d: bad fields" % i)
        check_pts("rail %d" % i, r.get("pts"), 3)
    for i, p in enumerate(d["platforms"]):
        if check_ring("platform %d" % i, p.get("ring"), 2):
            for q in p["ring"]:
                if not (XMIN - TOL <= q[0] <= XMAX + TOL and ZMIN - TOL <= q[1] <= ZMAX + TOL):
                    err("platform %d outside the extent" % i)
                    break
    for i, w in enumerate(d["water"]):
        if w.get("kind") not in WATER_KIND or not finite(w.get("y")) or not -45 <= w["y"] <= 65:
            err("water %d: bad fields" % i)
        check_ring("water %d" % i, w.get("ring"), 2)
    nst = 0
    nroof = nwall = 0
    for i, b in enumerate(d["buildings"]):
        nm = "building %d (%s)" % (i, b.get("id"))
        if b.get("kind") not in BLD_KIND or b.get("roof") not in ROOF or b.get("station") not in (0, 1) or not isinstance(b.get("levels"), int) or b["levels"] < 1:
            err(nm + ": bad kind/roof/station/levels")
        if not (finite(b.get("h")) and 0.3 <= b["h"] <= 80) or not (finite(b.get("base")) and -45 <= b["base"] <= 65):
            err(nm + ": bad h/base")
        nst += b.get("station", 0) == 1
        if not check_ring(nm + " ground", b.get("ground"), 2):
            continue
        g = np.array(b["ground"])
        if ring_area(b["ground"]) < 1.0:
            err(nm + ": footprint area < 1 m2")
        if g[:, 0].max() < XMIN or g[:, 0].min() > XMAX or g[:, 1].max() < ZMIN or g[:, 1].min() > ZMAX:
            err(nm + ": footprint does not touch the patch")
        for kind in ("roofs", "walls"):
            for r in b.get(kind, []):
                if check_ring("%s %s" % (nm, kind), r, 3):
                    if any(not (-45 <= p[1] <= 90) for p in r):
                        err("%s %s: y out of range" % (nm, kind))
        nroof += len(b.get("roofs", []))
        nwall += len(b.get("walls", []))
    if nst == 0:
        warn("no building flagged station=1")
    tr = d["trees"]
    if len(tr) > 1500:
        err("more than 1500 trees")
    for i, t in enumerate(tr):
        if not (isinstance(t, list) and len(t) == 4 and all(finite(c) for c in t) and XMIN <= t[0] <= XMAX and ZMIN <= t[1] <= ZMAX and 1 <= t[2] <= 50 and 0.5 <= t[3] <= 12):
            err("tree %d bad: %r" % (i, t))
            break
    for i, p in enumerate(d["poi"]):
        if p.get("t") not in POI or not all(finite(p.get(k)) for k in ("x", "z", "y")) or not (XMIN <= p["x"] <= XMAX and ZMIN <= p["z"] <= ZMAX) or not -45 <= p["y"] <= 65:
            err("poi %d bad: %r" % (i, p))
            break
    d["_stats"] = {"dem": dem, "cls_hist": cls_hist, "nroof": nroof, "nwall": nwall, "nst": nst}
    return report(path, size, d)


def report(path, size, d):
    st = d.pop("_stats", {})
    print("== %s  (%.0f kB)" % (os.path.basename(path), size / 1024))
    if "origin" in d and isinstance(d["origin"], dict):
        o = d["origin"]
        print("origin lat/lon %.6f, %.6f  heading %.1f deg  side %s  EPSG:2169 %s" % (o.get("lat", 0), o.get("lon", 0), o.get("headingDeg", 0), d.get("side"), o.get("epsg2169")))
    if st.get("dem") is not None:
        dem = st["dem"]
        print("DEM %.1f .. %.1f m, corridor |x|<=4: max |y| %.2f m" % (dem.min(), dem.max(), np.abs(dem[:, 78:83]).max()))
    if st.get("cls_hist"):
        print("class pixels:", st["cls_hist"])
    print("roads %d  rails %d  platforms %d  water %d  buildings %d (roof faces %d, wall faces %d, station-flagged %d)  trees %d  poi %d" % (
        len(d.get("roads", [])), len(d.get("rails", [])), len(d.get("platforms", [])), len(d.get("water", [])), len(d.get("buildings", [])),
        st.get("nroof", 0), st.get("nwall", 0), st.get("nst", 0), len(d.get("trees", [])), len(d.get("poi", []))))
    for w in warnings:
        print("WARNING:", w)
    for e in errors:
        print("ERROR:", e)
    print("RESULT:", "FAIL (%d errors)" % len(errors) if errors else "OK")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
