#!/usr/bin/env python3
"""Stage 2 of the real-line pipeline: the scenery of every leg in GAME coordinates (s = metres from the leg start in the compressed leg, lat = metres to the
right of the track axis, unchanged), from OSM + the DEM:

  land    raster of land classes (real_line_land) with ROW_M metres along the leg and COL_M metres across (LAT0 .. LAT0 + COLS * COL_M)
  water   windows where a river runs beside the line: side, lateral offset, half width, name
  roads   polylines of the roads near the line (class, width), cut where they come closer than ROAD_CLEAR to the track
  relief  per RELIEF_STEP metres: the terrain height 200 m left / right of the track relative to the track (valley shape)
  places  villages near the line (name, s, lat)
  crossings  the real level crossings of the leg: s, barrier type, the roads on both sides (hints for the crossing planner)

Writes pb/train-sim/data/real/mosel-features.json (compact).
"""
import math

import numpy as np
import shapely
from shapely import STRtree
from shapely.geometry import LineString, Point

import real_line_land as land_mod

ROW_M = 20.0
COL_M = 15.0
COLS = 44                 # -330 .. +330
LAT0 = -330.0
ROAD_CLEAR = 11.0
ROAD_MAX_LAT = 330.0
RELIEF_STEP = 50.0
RELIEF_LAT = 220.0
WATER_MAX = 330.0
RIVER_HALF = {"Mosel": 55.0, "Sauer": 28.0, "Saar": 40.0, "Syre": 7.0, "Kyll": 11.0, "Alzette": 12.0, "Salm": 8.0, "Lieser": 7.0, "Ruwer": 6.0, "Moselle": 55.0}
RIVER_MIN_OFFSET = 30.0   # clear water edge from the track corridor
ROAD_CLASSES = {"motorway": 14.0, "motorway_link": 5.0, "trunk": 7.0, "trunk_link": 4.5, "primary": 7.0, "primary_link": 4.5, "secondary": 6.4, "secondary_link": 4.2, "tertiary": 6.0,
                "tertiary_link": 4.0, "unclassified": 5.0, "residential": 5.2}
CLASS_CODE = "0123456789abcdef"


def clamp(v, a, b):
    return max(a, min(b, v))


class LegGeom:
    """Mapping between the real stretch of a leg and its game metres, plus the real centre line."""

    def __init__(self, attrs, meta):
        self.attrs = attrs
        self.a = meta["real"][0]
        self.b = meta["real"][1]
        m = np.array(meta["mapping"], float)
        self.real = m[:, 0]
        self.game = m[:, 1]
        self.length = float(self.game[-1])

    def real_of(self, sg):
        return self.a + np.interp(sg, self.game, self.real)

    def game_of(self, sr):
        return np.interp(np.asarray(sr) - self.a, self.real, self.game)

    def frame(self, sr):
        """Points and right-normals of the real centre line at real arc lengths sr."""
        xy, step = self.attrs.xy, self.attrs.step
        f = np.clip(np.asarray(sr, float) / step, 0, len(xy) - 1.001)
        i = f.astype(int)
        t = (f - i)[:, None]
        p = xy[i] * (1 - t) + xy[i + 1] * t
        d = xy[np.minimum(i + 2, len(xy) - 1)] - xy[np.maximum(i - 1, 0)]
        d /= np.hypot(d[:, 0], d[:, 1])[:, None] + 1e-9
        return p, np.c_[d[:, 1], -d[:, 0]], d


def land_raster(g, land):
    n = max(2, int(round(g.length / ROW_M)))
    sg = (np.arange(n) + 0.5) * g.length / n
    p, r, _ = g.frame(g.real_of(sg))
    rows = []
    for j in range(COLS):
        lat = LAT0 + (j + 0.5) * COL_M
        q = p + r * lat
        rows.append(land.at(q[:, 0], q[:, 1]))
    grid = np.array(rows).T                    # (n, COLS)
    text = ["".join(CLASS_CODE[int(c)] for c in row) for row in grid]
    return {"rows": text, "n": n, "ds": round(g.length / n, 3)}


def water_windows(g, waters, tree):
    """Rivers beside the line: [{s0, s1, side, off, half, name}] in game coordinates."""
    step = 20.0
    sr = np.arange(g.a, g.b, step)
    p, r, _ = g.frame(sr)
    recs = []
    for k in range(len(sr)):
        pt = Point(p[k])
        idx = tree.query(pt.buffer(WATER_MAX))
        best = None
        for j in idx:
            w = waters[j]
            d = w["g"].distance(pt)
            if d < WATER_MAX and (best is None or d < best[0]):
                q = w["g"].interpolate(w["g"].project(pt))
                lat = (q.x - p[k][0]) * r[k][0] + (q.y - p[k][1]) * r[k][1]
                best = (d, lat, w["t"].get("name") or "", w["t"].get("waterway"))
        recs.append(best)
    out, cur = [], None
    for k, rec in enumerate(recs):
        side = int(np.sign(rec[1]) or 1) if rec is not None else 0
        if cur is not None and (rec is None or side != cur["side"] or abs(abs(rec[1]) - cur["last"]) > 90):
            out.append(cur)
            cur = None
        if rec is None:
            continue
        if cur is None:
            cur = {"s0": sr[k], "side": side, "lats": [], "names": [], "kinds": []}
        cur["lats"].append(abs(rec[1]))
        cur["names"].append(rec[2])
        cur["kinds"].append(rec[3])
        cur["last"] = abs(rec[1])
        cur["s1"] = sr[k] + step
    if cur is not None:
        out.append(cur)
    res = []
    for w in out:
        if w["s1"] - w["s0"] < 80:
            continue
        name = max(set(w["names"]), key=w["names"].count)
        kind = max(set(w["kinds"]), key=w["kinds"].count)
        half = RIVER_HALF.get(name, 6.0 if kind == "river" else 3.5)
        lat = float(np.median(w["lats"]))
        off = clamp(lat, half + RIVER_MIN_OFFSET, 260.0)
        res.append({"s0": round(float(g.game_of(w["s0"])), 1), "s1": round(float(g.game_of(w["s1"])), 1), "side": w["side"], "off": round(off, 1), "half": half, "name": name,
                    "kind": kind})
    return [w for w in res if w["s1"] - w["s0"] > 25]


def relief(g, dem):
    n = max(2, int(g.length / RELIEF_STEP) + 1)
    sg = np.linspace(0, g.length, n)
    sr = g.real_of(sg)
    p, r, _ = g.frame(sr)
    z0 = g.attrs.z[np.minimum((sr / g.attrs.step).astype(int), len(g.attrs.z) - 1)]
    left = dem.height(*(p + r * -RELIEF_LAT).T)
    right = dem.height(*(p + r * RELIEF_LAT).T)
    # smooth over 3 samples; heights relative to the track, clipped to what the generic hills can show
    def sm(a):
        pad = np.r_[a[0], a, a[-1]]
        return (pad[:-2] + pad[1:-1] * 2 + pad[2:]) / 4
    hl = np.clip(sm(left) - z0, -14, 70)
    hr = np.clip(sm(right) - z0, -14, 70)
    return {"step": round(g.length / (n - 1), 3), "l": [round(float(v), 1) for v in hl], "r": [round(float(v), 1) for v in hr]}


def douglas(pts, tol):
    pts = np.asarray(pts, float)
    if len(pts) < 3:
        return pts
    keep = np.zeros(len(pts), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        a, b = pts[i], pts[j]
        ab = b - a
        L = np.hypot(*ab) + 1e-9
        d = np.abs(ab[0] * (pts[i + 1:j, 1] - a[1]) - ab[1] * (pts[i + 1:j, 0] - a[0])) / L
        if len(d):
            k = int(d.argmax())
            if d[k] > tol:
                keep[i + 1 + k] = True
                stack += [(i, i + 1 + k), (i + 1 + k, j)]
    return pts[keep]


def roads_of_leg(g, roads, rtree):
    """Road polylines in game coordinates (s, lat), cut near the track corridor."""
    a_path = LineString(g.attrs.xy[int(g.a // g.attrs.step):int(g.b // g.attrs.step) + 2])
    out = []
    for j in rtree.query(a_path.buffer(ROAD_MAX_LAT + 20)):
        w = roads[j]
        cls = w["t"].get("highway")
        if cls not in ROAD_CLASSES:
            continue
        geom = w["g"]
        parts = [geom] if geom.geom_type == "LineString" else list(geom.geoms)
        for ls in parts:
            n = max(2, int(ls.length // 8) + 1)
            pts = np.array([ls.interpolate(ls.length * i / (n - 1)).coords[0] for i in range(n)])
            # real (s, lat) of every vertex
            line = LineString(g.attrs.xy)
            s_real = np.array([line.project(Point(q)) for q in pts])
            keep = (s_real >= g.a - 40) & (s_real <= g.b + 40)
            if not keep.any():
                continue
            p, r, d = g.frame(np.clip(s_real, 0, g.attrs.length - 0.01))
            lat = np.einsum("ij,ij->i", pts - p, r)
            sg = g.game_of(np.clip(s_real, g.a, g.b))
            ok = (np.abs(lat) >= ROAD_CLEAR) & (np.abs(lat) <= ROAD_MAX_LAT) & keep
            # a road that crosses the corridor: keep the pieces on both sides (the crossing planner / bridge handles the crossing itself)
            run = []
            for k in range(len(pts)):
                if ok[k]:
                    run.append((float(sg[k]), float(lat[k])))
                if (not ok[k] or k == len(pts) - 1) and len(run) >= 2:
                    simp = douglas(run, 3.0)
                    # game s must increase monotonically along a stored polyline only for display; roads may run backwards, that is fine
                    if len(simp) >= 2:
                        out.append({"c": cls, "w": ROAD_CLASSES[cls], "p": [[round(x, 1), round(y, 1)] for x, y in simp], "n": (w["t"].get("name") or "")[:24], "ref": w["t"].get("ref", "")})
                    run = []
                elif not ok[k]:
                    run = []
    return out


def places_of_leg(g, places):
    res = []
    line = LineString(g.attrs.xy)
    for pl in places:
        t = pl["t"]
        if t.get("place") not in ("village", "town", "hamlet", "suburb", "city"):
            continue
        pt = pl["g"]
        sr = line.project(pt)
        if not (g.a - 200 <= sr <= g.b + 200):
            continue
        d = line.distance(pt)
        if d > 700:
            continue
        p, r, _ = g.frame(np.array([clamp(sr, 0, g.attrs.length - 0.01)]))
        lat = float(np.dot(np.array([pt.x, pt.y]) - p[0], r[0]))
        res.append({"name": t.get("name", ""), "kind": t["place"], "s": round(float(g.game_of(clamp(sr, g.a, g.b))), 1), "lat": round(lat, 1)})
    return res


def crossings_of_leg(g, feats_crossings, roads_out):
    out = []
    for c in feats_crossings:
        if not (g.a <= c["s"] <= g.b):
            continue
        sg = float(g.game_of(c["s"]))
        near = {"l": None, "r": None}
        for rd in roads_out:
            pts = np.array(rd["p"])
            m = np.abs(pts[:, 0] - sg) < 60
            if not m.any():
                continue
            lat = pts[m, 1]
            for side, sel in (("l", lat < 0), ("r", lat > 0)):
                if sel.any():
                    v = float(lat[sel][np.abs(lat[sel]).argmin()])
                    if near[side] is None or abs(v) < abs(near[side][0]):
                        near[side] = (v, rd["c"])
        out.append({"s": round(sg, 1), "barrier": c.get("barrier", ""), "l": near["l"], "r": near["r"]})
    return out
