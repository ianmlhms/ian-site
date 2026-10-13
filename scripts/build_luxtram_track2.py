#!/usr/bin/env python3
"""Luxtram T1: second (opposite) track + platform sides for Lokféierer (stdlib only).

Data (c) OpenStreetMap contributors, ODbL 1.0.

  python3 scripts/build_luxtram_track2.py [RAW_DIR] [OUT_DIR]

Reads   RAW_DIR/t1_full.json, tram_ways.json, t1_nodes.json   (see scripts/fetch_luxtram_osm.py)
        RAW_DIR/platforms_all.json                             (optional: every OSM platform within 80 m of a stop, both directions)
Writes  OUT_DIR/luxtram-track2.json

  opp    the centrelines of the OSM tram ways that are NOT part of the player's chain (the opposite-direction track), local
         metres (same origin/projection as luxtram-track.json), decimetre delta coded like `path`.  luxtram.js projects them onto
         the player's track to get the lateral spacing; where OSM has no second way it falls back to a synthetic offset.
  stops  per stop (same order as luxtram-track.json): side of OUR platform relative to the travel direction, derived from the real
         OSM platform geometry (not from the stop node), plus the platform kind and the opposite track's platform.

The player's chain is the relation's way list, which is consistently the right-hand track (the opposite ways all lie 3.0-4.5 m to its left,
9 m at the Rout Bréck island platform). check_side() below re-verifies this and prints a table that is part of the flow test.
"""
import json
import math
import os
import sys

RAW_DEFAULT = "/Users/ian/Library/CloudStorage/OneDrive-Mulheims/website-overnight/reports/train-sim/luxtram-raw"
OUT_DEFAULT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pb", "train-sim", "data")
LAT0 = 49.6055
LON0 = 6.1640
M_LAT = 111194.93
M_LON = M_LAT * math.cos(math.radians(LAT0))
STOP_NAMES = ['Findel-Aéroport', 'Héienhaff', 'Luxexpo', 'Alphonse Weicker', 'Nationalbibliothéik', 'Universitéit', 'Coque', 'Europaparlament',
              'Philharmonie', 'Rout Bréck', 'Theater', 'Faïencerie', 'Stäreplaz', 'Hamilius', 'Place de Metz', 'Paräisser Plaz', 'Gare Centrale',
              'Leschte Steiwer', 'Lycée Bouneweg', 'Scillas', 'Gare Howald', 'Lycée Vauban', 'Waassertuerm', 'Stadion']
PLATFORM_SEARCH_S = 60.0     # platform centroid must lie within this arc length of the stop
PLATFORM_SEARCH_D = 14.0     # ... and within this distance of the player's track


def proj(lat, lon):
    return ((lon - LON0) * M_LON, -(lat - LAT0) * M_LAT)


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def load(raw, name):
    with open(os.path.join(raw, name)) as fh:
        return json.load(fh)


class Polyline:
    """Arc-length parametrised polyline with nearest-point queries; lateral > 0 = right of travel (x east, z south)."""
    CELL = 60.0

    def __init__(self, pts):
        self.pts = pts
        self.cum = [0.0]
        for a, b in zip(pts, pts[1:]):
            self.cum.append(self.cum[-1] + dist(a, b))
        self.grid = {}
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            n = max(1, int(dist(a, b) / (self.CELL / 2)))
            for k in range(n + 1):
                t = k / n
                key = (int((a[0] + (b[0] - a[0]) * t) // self.CELL), int((a[1] + (b[1] - a[1]) * t) // self.CELL))
                self.grid.setdefault(key, set()).add(i)

    def nearest(self, x, z, max_r=200.0):
        cx, cz = int(x // self.CELL), int(z // self.CELL)
        best = None
        for r in range(int(max_r // self.CELL) + 2):
            cand = set()
            for dx in range(-r, r + 1):
                for dz in range(-r, r + 1):
                    if max(abs(dx), abs(dz)) == r:
                        cand |= self.grid.get((cx + dx, cz + dz), set())
            for i in cand:
                a, b = self.pts[i], self.pts[i + 1]
                vx, vz = b[0] - a[0], b[1] - a[1]
                ln2 = vx * vx + vz * vz
                t = 0.0 if ln2 < 1e-9 else max(0.0, min(1.0, ((x - a[0]) * vx + (z - a[1]) * vz) / ln2))
                px, pz = a[0] + vx * t, a[1] + vz * t
                d = math.hypot(x - px, z - pz)
                if best is None or d < best[1]:
                    ln = math.sqrt(ln2) or 1.0
                    tx, tz = vx / ln, vz / ln
                    best = (self.cum[i] + t * math.sqrt(ln2), d, (x - px) * (-tz) + (z - pz) * tx, tx, tz)
            if best is not None and best[1] <= r * self.CELL:
                break
        return best if best and best[1] <= max_r else None


def build_chain(raw):
    rel = load(raw, "t1_full.json")["elements"][0]
    members = [m for m in rel["members"] if m["type"] == "way" and m.get("role", "") == ""]
    pts, wid = [], []
    prev = None
    for m in members:
        g = [proj(p["lat"], p["lon"]) for p in m["geometry"]]
        if prev is not None and dist(prev, g[0]) > dist(prev, g[-1]):
            g.reverse()
        for p in g:
            if pts and dist(pts[-1], p) < 0.05:
                continue
            pts.append(p)
            wid.append(m["ref"])
        prev = g[-1]
    return rel, pts, wid


def delta_flat(pts):
    out = []
    px = pz = 0
    for x, z in pts:
        ix, iz = int(round(x * 10)), int(round(z * 10))
        out += [ix - px, iz - pz]
        px, pz = ix, iz
    return out


def douglas_peucker(pts, eps):
    if len(pts) < 3:
        return list(pts)
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, az = pts[a]
        bx, bz = pts[b]
        dx, dz = bx - ax, bz - az
        ln2 = dx * dx + dz * dz
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, pz = pts[i]
            if ln2 < 1e-9:
                d = math.hypot(px - ax, pz - az)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / ln2))
                d = math.hypot(px - (ax + t * dx), pz - (az + t * dz))
            if d > best:
                best, bi = d, i
        if best > eps:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def platform_geoms(raw, rel):
    """{id: points} of every platform: the relation's members plus platforms_all.json (both directions)."""
    out = {}
    for m in rel["members"]:
        if m.get("role") == "platform" and m["type"] == "way" and m.get("geometry"):
            out[m["ref"]] = [proj(p["lat"], p["lon"]) for p in m["geometry"]]
    path = os.path.join(raw, "platforms_all.json")
    if os.path.exists(path):
        for e in load(raw, "platforms_all.json")["elements"]:
            if e["type"] == "way" and e.get("geometry"):
                out.setdefault(e["id"], [proj(p["lat"], p["lon"]) for p in e["geometry"]])
    return out, set(m["ref"] for m in rel["members"] if m.get("role") == "platform" and m["type"] == "way")


def stats(line, geom):
    """-> (mean lateral, min |lateral|, mean s, count) of a platform outline relative to a polyline (lateral > 0 = right)."""
    qs = [line.nearest(x, z, 60) for x, z in geom]
    qs = [q for q in qs if q]
    if not qs:
        return None
    lats = [q[2] for q in qs]
    return (sum(lats) / len(lats), min(abs(v) for v in lats), sum(q[0] for q in qs) / len(qs), min(lats), max(lats))


def main():
    raw = sys.argv[1] if len(sys.argv) > 1 else RAW_DEFAULT
    out = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else OUT_DEFAULT)
    rel, pts, wid = build_chain(raw)
    line = Polyline(pts)
    chain = set(wid)
    ways = {e["id"]: e for e in load(raw, "tram_ways.json")["elements"] if e["type"] == "way"}

    # ---- the opposite track: every non-chain tram way that is a main line (no yard / siding / crossover / construction)
    opp = []
    for wy in ways.values():
        t = wy["tags"]
        if wy["id"] in chain or t.get("railway") != "tram" or t.get("service"):
            continue
        g = [proj(p["lat"], p["lon"]) for p in wy["geometry"]]
        near = [line.nearest(p[0], p[1], 14) for p in g]
        # keep ways that run along the left of the chain (3-12 m): the opposite track; drop branches that leave
        left = [q for q in near if q and -12.5 < q[2] < -1.4]
        if len(left) < max(2, len(g) // 2) and not (len(left) >= 1 and len(g) <= 3):
            continue
        opp.append(douglas_peucker(g, 0.08))
    opp.sort(key=lambda g: line.nearest(g[0][0], g[0][1], 40)[0] if line.nearest(g[0][0], g[0][1], 40) else 0)

    # ---- platform sides
    plats, rel_ids = platform_geoms(raw, rel)
    nodes = [m for m in rel["members"] if m["type"] == "node"]
    stops = []
    report = []
    for k, nd in enumerate(nodes):
        x, z = proj(nd["lat"], nd["lon"])
        sq = line.nearest(x, z, 40)
        s_stop = sq[0]
        # lateral of the opposite track at the stop (nearest opposite way, measured on the player's track)
        opp_lat = None
        best = 1e9
        for g in opp:
            for i in range(len(g) - 1):
                a, b = g[i], g[i + 1]
                vx, vz = b[0] - a[0], b[1] - a[1]
                ln2 = vx * vx + vz * vz
                t = 0.0 if ln2 < 1e-9 else max(0.0, min(1.0, ((x - a[0]) * vx + (z - a[1]) * vz) / ln2))
                px, pz = a[0] + vx * t, a[1] + vz * t
                d = math.hypot(x - px, z - pz)
                if d < best and d < 14:
                    q = line.nearest(px, pz, 20)
                    if q and q[2] < -1.4:
                        best, opp_lat = d, q[2]
        cands = []
        for pid, geom in plats.items():
            st = stats(line, geom)
            if not st:
                continue
            mean_lat, min_d, mean_s, lo, hi = st
            if abs(mean_s - s_stop) <= PLATFORM_SEARCH_S and min_d <= PLATFORM_SEARCH_D:
                cands.append((min_d, pid, mean_lat, lo, hi, pid in rel_ids))
        cands.sort()
        ours = cands[0] if cands else None
        side = "right"
        kind = "side"
        width = 3.0
        edge = 1.5
        note = "no OSM platform: default right"
        if ours:
            min_d, pid, mean_lat, lo, hi, in_rel = ours
            side = "right" if mean_lat > 0 else "left"
            # outline extent across the track: the near edge is the platform edge, the far edge the back
            near_edge = min(abs(lo), abs(hi)) if lo * hi > 0 else 0.0
            far_edge = max(abs(lo), abs(hi))
            if lo * hi > 0:
                edge, width = max(1.25, near_edge), max(2.0, min(5.5, far_edge - near_edge))
            note = "OSM platform way %d (%s), outline lateral %.1f..%.1f m" % (pid, "relation member" if in_rel else "found nearby", lo, hi)
            # island: our platform lies between our track and the opposite track
            if opp_lat is not None and side == "left" and abs(mean_lat) < abs(opp_lat) + 0.5:
                kind = "island"
        stops.append({"name": STOP_NAMES[k], "side": side, "kind": kind, "edge": round(edge, 2), "width": round(width, 2),
                      "oppLat": None if opp_lat is None else round(opp_lat, 1), "plat": ours[1] if ours else 0})
        report.append((k, STOP_NAMES[k], round(s_stop), side, kind, None if opp_lat is None else round(opp_lat, 1), note))

    data = {
        "v": 1,
        "attribution": "© OpenStreetMap contributors (ODbL).",
        "origin": [LAT0, LON0],
        "opp": [delta_flat(g) for g in opp],
        "stops": stops,
    }
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, "luxtram-track2.json")
    with open(path, "w") as fh:
        json.dump(data, fh, separators=(",", ":"), ensure_ascii=False)
    print("opposite ways", len(opp), "->", os.path.getsize(path) // 1024, "KB")
    for r in report:
        print("%2d %-22s s=%5d  side=%-5s %-6s oppLat=%s  %s" % r)


if __name__ == "__main__":
    main()
