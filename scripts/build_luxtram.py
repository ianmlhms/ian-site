#!/usr/bin/env python3
"""Build the shipped Luxtram T1 data for Lokféierer from cached Overpass dumps (stdlib only).

Data (c) OpenStreetMap contributors, ODbL 1.0.  Ground elevation guide: EU-DEM v1.1 (Copernicus) via opentopodata.org.

  python3 scripts/build_luxtram.py [RAW_DIR] [OUT_DIR]

Reads   RAW_DIR  (see scripts/fetch_luxtram_osm.py)
Writes  OUT_DIR/luxtram-track.json   route geometry, stops, limits, surfaces, elevation, bridges (small, loaded with the route)
        OUT_DIR/luxtram-world.json   buildings / roads / trees / land per 200 m chunk of the line (streamed by the world module)

Coordinates: local metres, x = east, z = south (three.js: heading 0 looks along -z), origin = LAT0/LON0, rounded to 0.1 m.
World objects are bucketed by the chunk (CHUNK m of line, 'nearest s') they belong to and stored delta-coded
as integers in decimetres, which keeps the JSON small and gzip friendly.
"""
import glob
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
CHUNK = 200.0          # metres of line per world chunk
CORR_BUILD = 125.0     # buildings are kept within this distance of the line
CORR_ROAD = 135.0
CORR_TREE = 95.0
CORR_LAND = 130.0
DM = 10                # decimetre integer scale

# Stop names as shown in the game (OSM names are bilingual; keep the Luxembourgish part, shortened).
STOP_NAMES = {
    "Findel - Luxembourg Airport": "Findel-Aéroport",
    "Héienhaff P+R": "Héienhaff",
    "Luxexpo": "Luxexpo",
    "Alphonse Weicker": "Alphonse Weicker",
    "Nationalbibliothéik / Bibliothèque nationale": "Nationalbibliothéik",
    "Universitéit": "Universitéit",
    "Coque": "Coque",
    "Europaparlament / Parlement européen": "Europaparlament",
    "Philharmonie - MUDAM": "Philharmonie",
    "Rout Bréck - Pafendall": "Rout Bréck",
    "Theater": "Theater",
    "Faïencerie": "Faïencerie",
    "Stäreplaz / Étoile": "Stäreplaz",
    "Hamilius": "Hamilius",
    "Place de Metz": "Place de Metz",
    "Paräisser Plaz / Place de Paris": "Paräisser Plaz",
    "Gare Centrale": "Gare Centrale",
    "Leschte Steiwer / Dernier Sol": "Leschte Steiwer",
    "Lycée Bouneweg": "Lycée Bouneweg",
    "Scillas": "Scillas",
    "Gare Howald": "Gare Howald",
    "Lycée Vauban": "Lycée Vauban",
    "Waassertuerm": "Waassertuerm",
    "Stadion": "Stadion",
}

SURF_CODE = {"grass": 0, "concrete": 1, "asphalt": 2, "paving_stones": 3, "paved": 3, "metal": 1, "plastic": 1, None: 1}


def proj(lat, lon):
    return ((lon - LON0) * M_LON, -(lat - LAT0) * M_LAT)


def unproj(x, z):
    return (LAT0 - z / M_LAT, LON0 + x / M_LON)


def r1(v):
    return round(v, 1)


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def load(raw, name):
    path = os.path.join(raw, name)
    with open(path) as fh:
        return json.load(fh)


def load_many(raw, prefix):
    out = []
    for path in sorted(glob.glob(os.path.join(raw, prefix + "_*.json"))):
        with open(path) as fh:
            out.extend(json.load(fh)["elements"])
    return out


# --------------------------------------------------------------------------- geometry helpers
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


class Polyline:
    """Arc-length parametrised polyline in local metres with nearest-point queries (grid accelerated)."""

    CELL = 60.0

    def __init__(self, pts):
        self.pts = pts
        self.cum = [0.0]
        for a, b in zip(pts, pts[1:]):
            self.cum.append(self.cum[-1] + dist(a, b))
        self.length = self.cum[-1]
        self.grid = {}
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            n = max(1, int(dist(a, b) / (self.CELL / 2)))
            for k in range(n + 1):
                t = k / n
                key = (int((a[0] + (b[0] - a[0]) * t) // self.CELL), int((a[1] + (b[1] - a[1]) * t) // self.CELL))
                self.grid.setdefault(key, set()).add(i)

    def nearest(self, x, z, max_r=400.0):
        """-> (s, distance, signed lateral (+ = right of travel), tangent_x, tangent_z) or None."""
        cx, cz = int(x // self.CELL), int(z // self.CELL)
        best = None
        rings = int(max_r // self.CELL) + 1
        for r in range(rings + 1):
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
                    lat = (x - px) * (-tz) + (z - pz) * tx  # right normal of (tx,tz) in x-east / z-south coords is (-tz, tx)
                    best = (self.cum[i] + t * math.sqrt(ln2), d, lat, tx, tz)
            if best is not None and best[1] <= r * self.CELL:
                break
        return best if best and best[1] <= max_r else None


# --------------------------------------------------------------------------- the line
def build_chain(raw):
    rel = load(raw, "t1_full.json")["elements"][0]
    ways = {e["id"]: e for e in load(raw, "tram_ways.json")["elements"] if e["type"] == "way"}
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
    # wid[i] = way that ends at point i (segment i-1 -> i belongs to that way)
    return rel, ways, pts, wid


def surface_of(tags):
    return tags.get("surface") or tags.get("tram:surface")


def build_track(raw):
    rel, ways, pts, wid = build_chain(raw)
    line = Polyline(pts)
    nodes = {e["id"]: e for e in load(raw, "t1_nodes.json")["elements"]}
    plat_ways = [m for m in rel["members"] if m["type"] == "way" and m.get("role") == "platform"]

    # ---- per-way attribute segments along s
    segs = []
    for i in range(1, len(pts)):
        tags = ways[wid[i]]["tags"]
        s0, s1 = line.cum[i - 1], line.cum[i]
        ms = tags.get("maxspeed")
        speed = int(ms) if ms and ms.isdigit() else 0
        elec = {"contact_line": 1, "no": 0, "ground-level_power_supply": 2}.get(tags.get("electrified"), 1)
        flags = 0
        if tags.get("bridge") == "yes":
            flags |= 1
        if tags.get("tunnel") == "yes":
            flags |= 2
        seg = [round(s0, 1), round(s1, 1), speed, SURF_CODE.get(surface_of(tags), 1), flags, elec]
        if segs and segs[-1][2:] == seg[2:]:
            segs[-1][1] = seg[1]
        else:
            segs.append(seg)

    # ---- stops
    stops = []
    for m in rel["members"]:
        if m["type"] != "node":
            continue
        n = nodes[m["ref"]]
        name = n["tags"]["name"]
        x, z = proj(m["lat"], m["lon"])
        near = line.nearest(x, z, 40)
        s, d, lat, tx, tz = near
        # side: nearest platform way centroid, sign of its lateral offset
        side = None
        best = 1e9
        for pm in plat_ways:
            c = [proj(p["lat"], p["lon"]) for p in pm["geometry"]]
            cx = sum(p[0] for p in c) / len(c)
            cz = sum(p[1] for p in c) / len(c)
            q = line.nearest(cx, cz, 60)
            if q and abs(q[0] - s) < 40 and q[1] < best:
                best = q[1]
                side = "right" if q[2] > 0 else "left"
        stops.append({"id": m["ref"], "name": STOP_NAMES.get(name, name), "osm": name, "s": r1(s), "side": side or "right", "platDist": r1(best if best < 1e8 else -1)})
    stops.sort(key=lambda st: st["s"])

    # ---- the other direction's track(s), for scenery (both tracks are drawn)
    chain_ids = set(wid)
    other = []
    for wy in ways.values():
        t = wy["tags"]
        if wy["id"] in chain_ids or t.get("service") or t.get("railway") != "tram":
            continue
        g = [proj(p["lat"], p["lon"]) for p in wy["geometry"]]
        near = [line.nearest(p[0], p[1], 40) for p in g]
        if all(q is None for q in near):
            continue
        other.append((g, near, t))

    return {"line": line, "stops": stops, "segs": segs, "other": other, "ways": ways, "pts": pts, "wid": wid}



# --------------------------------------------------------------------------- elevation
def smooth_series(vals, radius):
    out = []
    for i in range(len(vals)):
        a, b = max(0, i - radius), min(len(vals), i + radius + 1)
        out.append(sum(vals[a:b]) / (b - a))
    return out


def median(vals):
    v = sorted(vals)
    return v[len(v) // 2]


def elevation_profile(raw, line, bridges):
    """Hand-tunable elevation keys along the line.

    Starting point = EU-DEM 25 m along the line (smoothed hard: it is a surface model and contains roofs),
    then the Grand-Duchess-Charlotte bridge deck is held level between its abutments, and the grade is limited.
    """
    dem = load(raw, os.environ.get("LUXTRAM_DEM_FILE", "dem_grid.json"))
    rows = dem["rows"]
    offs = dem["offsets"]
    mid = offs.index(0)
    base = [median([r["h"][mid - 1], r["h"][mid], r["h"][mid + 1]]) for r in rows]
    ss = [r["s"] for r in rows]
    # across a bridge the DEM shows the valley floor: replace it by a straight deck between the two abutments
    for br in bridges:
        i0 = max(0, int((br[0] - 40) // 40))
        i1 = min(len(ss) - 1, int((br[1] + 40) // 40) + 1)
        a_h, b_h = base[i0], base[i1]
        for i in range(i0, i1 + 1):
            t = (ss[i] - ss[i0]) / max(1.0, ss[i1] - ss[i0])
            base[i] = a_h + (b_h - a_h) * t
    prof = smooth_series(base, 3)          # +-120 m window: the DEM is a surface model with roofs and trees
    # keep the deck straight after smoothing
    for br in bridges:
        i0 = max(0, int((br[0] - 40) // 40))
        i1 = min(len(ss) - 1, int((br[1] + 40) // 40) + 1)
        a_h, b_h = prof[i0], prof[i1]
        for i in range(i0, i1 + 1):
            prof[i] = a_h + (b_h - a_h) * (ss[i] - ss[i0]) / max(1.0, ss[i1] - ss[i0])
    # limit grades (tram: ~6 % max in the city, mostly far below)
    for _ in range(40):
        for i in range(1, len(prof)):
            d = prof[i] - prof[i - 1]
            lim = 0.058 * 40
            if abs(d) > lim:
                prof[i] = prof[i - 1] + math.copysign(lim, d)
        for i in range(len(prof) - 2, -1, -1):
            d = prof[i] - prof[i + 1]
            lim = 0.058 * 40
            if abs(d) > lim:
                prof[i] = prof[i + 1] + math.copysign(lim, d)
    keys = [[r1(s), r1(h)] for s, h in zip(ss, prof)]
    return keys, base, dem


ADOLPHE = proj(49.6091, 6.1265)
ROUGE = proj(49.6176, 6.1306)


def bridge_name(line, a, b):
    mid0 = line.pts[min(len(line.pts) - 1, max(0, bisect_s(line, (a + b) / 2)))]
    if dist(mid0, ROUGE) < 220 and b - a > 200:
        return "Pont Grande-Duchesse Charlotte"
    # the arch bridge over the Pétrusse between Hamilius and Place de Metz
    mid = line.pts[min(len(line.pts) - 1, max(0, bisect_s(line, (a + b) / 2)))]
    return "Pont Adolphe" if dist(mid, ADOLPHE) < 230 else ""


def bisect_s(line, s):
    lo, hi = 0, len(line.cum) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if line.cum[mid] < s:
            lo = mid + 1
        else:
            hi = mid
    return lo


def ground_deltas(dem, prof_keys, bridges):
    """Lateral terrain relief (deadbanded so roofs in the surface model do not become hills)."""
    rows = dem["rows"]
    offs = dem["offsets"]
    mid = offs.index(0)
    out = []
    for r, key in zip(rows, prof_keys):
        ref = r["h"][mid]
        in_bridge = any(b[0] - 10 <= r["s"] <= b[1] + 10 for b in bridges)
        row = []
        for j, h in enumerate(r["h"]):
            if in_bridge:
                # on a bridge: valley floor below the (level) deck
                d = h - key[1]
            else:
                d = h - ref
                if abs(d) < 7:
                    d *= 0.15
                else:
                    d = math.copysign(abs(d) - 7 * 0.85, d)
            row.append(int(round(max(-95, min(45, d)) * 2)))   # half metres
        out.append(row)
    return out


# --------------------------------------------------------------------------- scenery
def ring_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x0, z0 = pts[i]
        x1, z1 = pts[(i + 1) % len(pts)]
        a += x0 * z1 - x1 * z0
    return a / 2.0


def centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def hex_color(tag):
    if not tag:
        return 0
    t = tag.strip().lower()
    named = {"white": 0xE8E4DA, "grey": 0x9A9A98, "gray": 0x9A9A98, "red": 0xA9473A, "brown": 0x7A5A44, "black": 0x3A3A3C,
             "yellow": 0xDCC47A, "beige": 0xD8C9A8, "orange": 0xC8793A, "green": 0x6A8A5A, "blue": 0x5A7A9A}
    if t in named:
        return named[t]
    if t.startswith("#") and len(t) == 7:
        try:
            return int(t[1:], 16)
        except ValueError:
            return 0
    return 0


def parse_height(v):
    if not v:
        return None
    try:
        return float(v.replace("m", "").replace(",", ".").strip().split()[0])
    except (ValueError, IndexError):
        return None


KIND = {"apartments": 0, "residential": 0, "house": 0, "detached": 0, "terrace": 0, "semidetached_house": 0, "dormitory": 0,
        "office": 1, "commercial": 5, "retail": 5, "supermarket": 5, "kiosk": 3, "hotel": 6,
        "public": 2, "civic": 2, "government": 2, "school": 2, "university": 2, "college": 2, "hospital": 2, "museum": 2,
        "church": 4, "chapel": 4, "cathedral": 4, "garage": 3, "garages": 3, "roof": 3, "shed": 3, "carport": 3, "service": 3,
        "industrial": 3, "warehouse": 3, "parking": 3, "train_station": 2, "stadium": 7, "sports_hall": 2, "sports_centre": 2, "concert_hall": 2, "theatre": 2, "cinema": 5, "mall": 5}
LEVEL_DEFAULT = {"apartments": 5, "residential": 4, "house": 2, "detached": 2, "terrace": 3, "office": 5, "commercial": 4, "retail": 2,
                 "hotel": 6, "public": 3, "civic": 3, "school": 3, "church": 2, "garage": 1, "garages": 1, "roof": 1, "carport": 1,
                 "shed": 1, "kiosk": 1, "industrial": 2, "warehouse": 1, "parking": 4}
ROOF = {"flat": 1, "gabled": 2, "hipped": 3, "pyramidal": 4, "skillion": 1, "dome": 4, "half-hipped": 3, "mansard": 3, "gambrel": 2}
LANDMARKS = [
    ("philharmonie", "philharmonie"), ("gare", "gare"), ("hamilius", "hamilius"), ("stade de luxembourg", "stade"), ("stadion", "stade"),
    ("cloche d", "clochedor"), ("grand théâtre", "theatre"), ("villa louvigny", "villa"), ("mudam", "mudam"), ("kirchberg", "kirchberg"),
    ("lycée", "lycee"), ("tour ", "tower"), ("european court", "cjue"), ("cour de justice", "cjue"), ("parlement européen", "ep"),
]


def ring_from_way(el):
    g = el.get("geometry")
    if not g or len(g) < 4:
        return None
    pts = [proj(p["lat"], p["lon"]) for p in g]
    if dist(pts[0], pts[-1]) > 0.5:
        return None
    return pts[:-1]


def relation_rings(el):
    """outer rings of a multipolygon (members already carry geometry)."""
    rings = []
    for m in el.get("members", []):
        if m.get("role") != "outer" or m.get("type") != "way" or not m.get("geometry"):
            continue
        g = [proj(p["lat"], p["lon"]) for p in m["geometry"]]
        if len(g) >= 4 and dist(g[0], g[-1]) < 0.5:
            rings.append(g[:-1])
    return rings


def _covered_osm():
    path = os.path.join(os.environ.get("LUXTRAM_WORK", "/Users/Ian/Library/Caches/luxtram-work"), "geo", "osm_covered.json")
    if os.path.exists(path):
        with open(path) as fh:
            return set(json.load(fh))
    return set()


COVERED_OSM = _covered_osm()


def build_buildings(raw, line):
    els = load_many(raw, "bld")
    items = []
    seen = set()
    for el in els:
        key = (el["type"], el["id"])
        if key in seen:
            continue
        seen.add(key)
        tags = el.get("tags", {})
        rings = relation_rings(el) if el["type"] == "relation" else [ring_from_way(el)]
        for ring in rings:
            if not ring or len(ring) < 3:
                continue
            cx, cz = centroid(ring)
            near = line.nearest(cx, cz, CORR_BUILD)
            for vx, vz in ring[::max(1, len(ring) // 12)]:   # big buildings (Philharmonie): any part near the line counts
                q = line.nearest(vx, vz, CORR_BUILD)
                if q and (near is None or q[1] < near[1]):
                    near = q
            if not near:
                continue
            area = abs(ring_area(ring))
            if area < 14 or (area < 30 and near[1] > 30):
                continue
            items.append({"tags": tags, "ring": ring, "c": (cx, cz), "near": near, "area": area, "part": "building:part" in tags and "building" not in tags,
                          "id": el["type"][0] + str(el["id"])})
    for el in load_many(raw, "land"):
        t = el.get("tags", {})
        if el["type"] == "way" and t.get("leisure") == "stadium":
            ring = ring_from_way(el)
            if ring and len(ring) >= 3:
                cx, cz = centroid(ring)
                near = line.nearest(cx, cz, 300)
                if near:
                    items.append({"tags": {"building": "stadium", "name": t.get("name", "Stade"), "height": "19"}, "ring": ring, "c": (cx, cz), "near": near, "area": abs(ring_area(ring)), "part": False})
    # building:part: drop the outline it sits in if the outline has no explicit height (the part carries the shape)
    # (kept simple: parts are rendered, outlines are rendered; parts that lie inside an outline replace it)
    parts = [it for it in items if it["part"]]
    outlines = [it for it in items if not it["part"]]
    covered = set()
    for pt in parts:
        for i, ol in enumerate(outlines):
            if parse_height(ol["tags"].get("height")) is None and point_in_poly(pt["c"], ol["ring"]):
                covered.add(i)
    items = parts + [ol for i, ol in enumerate(outlines) if i not in covered]
    # neighbourhood level estimate for buildings without levels
    known = [(it["c"], float(it["tags"]["building:levels"])) for it in items
             if it["tags"].get("building:levels", "").replace(".", "", 1).isdigit() and it["tags"].get("building") not in ("garage", "garages", "roof", "shed", "carport")]
    out = []
    for it in items:
        t = it["tags"]
        b = t.get("building") or t.get("building:part") or "yes"
        h = parse_height(t.get("height")) or parse_height(t.get("building:height"))
        levels = None
        lv = t.get("building:levels")
        if lv and lv.replace(".", "", 1).isdigit():
            levels = float(lv)
        roof_levels = float(t["roof:levels"]) if t.get("roof:levels", "").replace(".", "", 1).isdigit() else 0.0
        kind = KIND.get(b, 0)
        if h is None:
            if levels is None:
                near_lv = sorted(known, key=lambda k: dist(k[0], it["c"]))[:6]
                near_lv = [k for k in near_lv if dist(k[0], it["c"]) < 90]
                base = LEVEL_DEFAULT.get(b)
                if base is None:
                    base = median([k[1] for k in near_lv]) if near_lv else 3
                elif b in ("apartments", "residential", "office", "commercial", "yes") and near_lv:
                    base = (base + median([k[1] for k in near_lv])) / 2
                levels = max(1.0, round(base))
            h = levels * 3.1 + (roof_levels * 1.6 if roof_levels else 0)
        h = max(2.6, min(h, 190))
        roof = ROOF.get(t.get("roof:shape", ""), 0)
        if roof == 0 and roof_levels >= 1 and b not in ("garage", "garages"):
            roof = 2
        ring = it["ring"]
        if ring_area(ring) > 0:          # make all rings clockwise in (x, z)
            ring = ring[::-1]
        # simplify
        eps = 0.45
        simp = douglas_peucker(ring + [ring[0]], eps)[:-1]
        while len(simp) > 28:
            eps *= 1.6
            simp = douglas_peucker(ring + [ring[0]], eps)[:-1]
        if len(simp) < 3:
            continue
        name = t.get("name", "")
        lm = None
        low = name.lower()
        for needle, tag in LANDMARKS:
            if needle in low:
                lm = tag
                break
        if lm is None and (b in ("train_station",) or t.get("railway") == "station" or t.get("public_transport") == "station"):
            lm = "gare"
        if it.get("id") in COVERED_OSM:      # the LOD2 3D building (scripts/build_luxtram_geo.py) replaces this footprint
            continue
        out.append({"s": it["near"][0], "d": it["near"][1], "kind": kind, "roof": roof, "h": h, "min": parse_height(t.get("min_height")) or 0.0,
                    "col": hex_color(t.get("building:colour")), "rcol": hex_color(t.get("roof:colour")), "ring": simp, "lm": lm, "name": name})
    return out


def point_in_poly(p, ring):
    x, z = p
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, zi = ring[i]
        xj, zj = ring[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


ROAD_CLASS = {"motorway": 0, "motorway_link": 0, "trunk": 0, "trunk_link": 0, "primary": 1, "primary_link": 1, "secondary": 2, "secondary_link": 2,
              "tertiary": 3, "tertiary_link": 3, "unclassified": 4, "residential": 4, "living_street": 4, "service": 5, "pedestrian": 6,
              "cycleway": 7, "track": 8}
ROAD_WIDTH = {0: 11.0, 1: 8.5, 2: 7.2, 3: 6.4, 4: 5.4, 5: 3.4, 6: 5.0, 7: 2.4, 8: 3.0}


def build_roads(raw, line):
    out = []
    seen = set()
    for el in load_many(raw, "road"):
        if el["id"] in seen or el["type"] != "way":
            continue
        seen.add(el["id"])
        t = el["tags"]
        cls = ROAD_CLASS.get(t.get("highway"))
        if cls is None or t.get("area") == "yes":
            continue
        if t.get("tunnel") in ("yes", "building_passage", "culvert") and cls > 2:
            continue
        pts = [proj(p["lat"], p["lon"]) for p in el["geometry"]]
        width = parse_height(t.get("width"))
        if not width:
            lanes = t.get("lanes")
            width = ROAD_WIDTH[cls]
            if lanes and lanes.isdigit() and cls <= 3:
                width = max(width, 3.2 * int(lanes) + (0.6 if cls <= 1 else 0.3))
        flags = 0
        if t.get("bridge") in ("yes", "viaduct"):
            flags |= 1
        if t.get("tunnel") in ("yes", "building_passage"):
            flags |= 2
        if t.get("oneway") in ("yes", "1"):
            flags |= 4
        layer = int(t["layer"]) if t.get("layer", "").lstrip("-").isdigit() else 0
        simp = douglas_peucker(pts, 0.6)
        # cut into runs of vertices inside the corridor, tagged with the chunk of their nearest line point
        run = []
        for p in simp:
            q = line.nearest(p[0], p[1], CORR_ROAD)
            if q is None:
                if len(run) >= 2:
                    out.append((run, cls, flags, layer, width))
                run = []
                continue
            run.append((p[0], p[1], q[0]))
        if len(run) >= 2:
            out.append((run, cls, flags, layer, width))
    return out


def build_trees(raw, line, land_polys):
    trees = []
    seen = set()
    for el in load_many(raw, "tree"):
        if el["type"] != "node" or el["id"] in seen:
            continue
        seen.add(el["id"])
        t = el.get("tags", {})
        x, z = proj(el["lat"], el["lon"])
        q = line.nearest(x, z, CORR_TREE)
        if not q:
            continue
        kind = 1 if t.get("leaf_type") == "needleleaved" else 0
        h = parse_height(t.get("height")) or 0
        trees.append((x, z, q[0], kind, h))
    # tree rows
    for el in load_many(raw, "land"):
        if el["type"] == "way" and el["tags"].get("natural") == "tree_row":
            pts = [proj(p["lat"], p["lon"]) for p in el["geometry"]]
            for a, b in zip(pts, pts[1:]):
                n = max(1, int(dist(a, b) / 7.5))
                for k in range(n + 1):
                    x, z = a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n
                    q = line.nearest(x, z, CORR_TREE)
                    if q:
                        trees.append((x, z, q[0], 0, 0))
    # forest / wood fill
    import random
    rnd = random.Random(7)
    for poly in land_polys:
        if poly["code"] not in (1, 2):   # forest, scrub
            continue
        ring = poly["ring"]
        xs = [p[0] for p in ring]
        zs = [p[1] for p in ring]
        step = 9.0 if poly["code"] == 1 else 11.0
        x = min(xs)
        while x < max(xs):
            z = min(zs)
            while z < max(zs):
                px, pz = x + rnd.uniform(-3, 3), z + rnd.uniform(-3, 3)
                if point_in_poly((px, pz), ring):
                    q = line.nearest(px, pz, CORR_TREE)
                    if q:
                        trees.append((px, pz, q[0], 1 if rnd.random() < 0.35 else 0, 0))
                z += step
            x += step
    return trees


LAND_CODE = {  # 0 grass, 1 forest, 2 scrub, 3 water, 4 pitch, 5 cemetery, 6 dirt, 7 farm, 8 gravel(railway), 9 rock
    ("landuse", "grass"): 0, ("landuse", "meadow"): 0, ("landuse", "village_green"): 0, ("landuse", "recreation_ground"): 0, ("landuse", "greenfield"): 0,
    ("leisure", "park"): 0, ("leisure", "garden"): 0, ("leisure", "playground"): 0, ("leisure", "golf_course"): 0, ("natural", "grassland"): 0,
    ("landuse", "forest"): 1, ("natural", "wood"): 1, ("natural", "scrub"): 2, ("natural", "heath"): 2,
    ("natural", "water"): 3, ("waterway", "riverbank"): 3, ("leisure", "pitch"): 4, ("leisure", "sports_centre"): 4,
    ("landuse", "cemetery"): 5, ("landuse", "construction"): 6, ("landuse", "brownfield"): 6, ("landuse", "farmland"): 7, ("landuse", "orchard"): 7,
    ("landuse", "allotments"): 7, ("landuse", "railway"): 8, ("natural", "cliff"): 9, ("natural", "bare_rock"): 9,
}


def build_land(raw, line):
    polys = []
    waterways = []
    seen = set()
    for el in load_many(raw, "land"):
        key = (el["type"], el["id"])
        if key in seen:
            continue
        seen.add(key)
        t = el.get("tags", {})
        if el["type"] == "way" and t.get("waterway") in ("river", "stream", "canal"):
            pts = [proj(p["lat"], p["lon"]) for p in el["geometry"]]
            waterways.append((douglas_peucker(pts, 1.0), 14.0 if t["waterway"] == "river" else (8.0 if t["waterway"] == "canal" else 2.0), t.get("bridge") == "yes" or t.get("tunnel") == "yes"))
            continue
        code = None
        for k in ("landuse", "leisure", "natural", "waterway"):
            if k in t and (k, t[k]) in LAND_CODE:
                code = LAND_CODE[(k, t[k])]
                break
        if code is None:
            continue
        rings = relation_rings(el) if el["type"] == "relation" else [ring_from_way(el)]
        for ring in rings:
            if not ring or len(ring) < 3:
                continue
            ds = [line.nearest(p[0], p[1], CORR_LAND) for p in ring]
            if all(d is None for d in ds):
                # polygon may still overlap the corridor (large forest): test its centroid and a few edge samples
                cx, cz = centroid(ring)
                if not any(line.nearest(*p, CORR_LAND) for p in [(cx, cz)] + ring[::max(1, len(ring) // 6)]):
                    continue
            if ring_area(ring) > 0:
                ring = ring[::-1]
            simp = douglas_peucker(ring + [ring[0]], 1.0)[:-1]
            if len(simp) < 3 or abs(ring_area(simp)) < 40:
                continue
            ss = [d[0] for d in ds if d is not None]
            polys.append({"code": code, "ring": simp, "s0": min(ss) if ss else 0, "s1": max(ss) if ss else 0})
    return polys, waterways


def build_signals(raw, line):
    out = []
    for el in load_many(raw, "poi"):
        t = el.get("tags", {})
        if el["type"] == "node" and t.get("highway") == "traffic_signals":
            x, z = proj(el["lat"], el["lon"])
            q = line.nearest(x, z, 45)
            if q:
                out.append((x, z, q[0]))
    return out


# --------------------------------------------------------------------------- output
def delta_flat(pts):
    """[(x, z), ...] metres -> flat int list in decimetres: first absolute, then deltas."""
    flat = []
    px = pz = 0
    for k, (x, z) in enumerate(pts):
        ix, iz = int(round(x * DM)), int(round(z * DM))
        flat.extend([ix - px, iz - pz])
        px, pz = ix, iz
    return flat


def chunk_of(s):
    return max(0, int(s // CHUNK))


def build_world(raw, tr):
    line = tr["line"]
    blds = build_buildings(raw, line)
    roads = build_roads(raw, line)
    polys, waterways = build_land(raw, line)
    trees = build_trees(raw, line, polys)
    signals = build_signals(raw, line)
    chunks = {}

    def ck(s):
        return chunks.setdefault(chunk_of(s), {"b": [], "r": [], "t": [], "l": [], "w": [], "x": [], "g": []})

    for b in blds:
        c = ck(b["s"])
        meta = b["kind"] | (b["roof"] << 3)
        if b["lm"]:
            meta |= 1 << 8
        entry = [meta, int(round(b["h"] * 10)), int(round(b["min"] * 10)), b["col"], b["rcol"], delta_flat(b["ring"])]
        if b["lm"]:
            entry.append(b["lm"])
        c["b"].append(entry)
    for run, cls, flags, layer, width in roads:
        # split into per-chunk pieces; consecutive pieces share their joint vertex
        cur = [run[0]]
        cur_c = chunk_of(run[0][2])
        for p in run[1:]:
            pc = chunk_of(p[2])
            if pc != cur_c:
                cur.append(p)
                ck(cur[0][2])["r"].append([cls, flags, layer, int(round(width * 10)), delta_flat([(q[0], q[1]) for q in cur])])
                cur = [p]
                cur_c = pc
            else:
                cur.append(p)
        if len(cur) >= 2:
            ck(cur[0][2] if chunk_of(cur[0][2]) == cur_c else cur[-1][2])["r"].append([cls, flags, layer, int(round(width * 10)), delta_flat([(q[0], q[1]) for q in cur])])
    for x, z, s, kind, h in trees:
        ck(s)["t"].append([int(round(x * DM)), int(round(z * DM)), kind, int(round(h))])
    for poly in polys:
        c0, c1 = chunk_of(poly["s0"]), chunk_of(poly["s1"])
        for ci in range(c0, min(c1, c0 + 9) + 1):
            ck(ci * CHUNK + 1)["l"].append([poly["code"], delta_flat(poly["ring"])])
    for pts, width, culvert in waterways:
        run = []
        for p in pts:
            q = line.nearest(p[0], p[1], CORR_LAND + 40)
            if q:
                run.append((p[0], p[1], q[0]))
            elif len(run) >= 2:
                ck(run[0][2])["w"].append([int(round(width * 10)), 1 if culvert else 0, delta_flat([(a[0], a[1]) for a in run])])
                run = []
            else:
                run = []
        if len(run) >= 2:
            ck(run[0][2])["w"].append([int(round(width * 10)), 1 if culvert else 0, delta_flat([(a[0], a[1]) for a in run])])
    for x, z, s in signals:
        ck(s)["x"].append([int(round(x * DM)), int(round(z * DM))])
    # other tracks (opposite direction, yards): pieces by chunk
    for pts, near, t in tr["other"]:
        surf = SURF_CODE.get(surface_of(t), 1)
        svc = 1 if t.get("service") else 0
        run = []
        for p, q in zip(pts, near):
            if q is None:
                if len(run) >= 2:
                    ck(run[0][2])["g"].append([surf, svc, delta_flat([(a[0], a[1]) for a in run])])
                run = []
            else:
                run.append((p[0], p[1], q[0]))
        if len(run) >= 2:
            ck(run[0][2])["g"].append([surf, svc, delta_flat([(a[0], a[1]) for a in run])])
    return chunks


def write_json(path, obj):
    with open(path, "w") as fh:
        json.dump(obj, fh, separators=(",", ":"), ensure_ascii=False)
    print("wrote", os.path.basename(path), os.path.getsize(path) // 1024, "KB")


def main():
    raw = sys.argv[1] if len(sys.argv) > 1 else RAW_DEFAULT
    out = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else OUT_DEFAULT)
    os.makedirs(out, exist_ok=True)
    tr = build_track(raw)
    line = tr["line"]
    print("length", round(line.length), "stops", len(tr["stops"]), "segs", len(tr["segs"]), "other ways", len(tr["other"]))
    bridges = [(s[0], s[1]) for s in tr["segs"] if s[4] & 1]
    tunnels = [[s[0], s[1]] for s in tr["segs"] if s[4] & 2]
    # merge touching bridge segments
    merged = []
    for b in bridges:
        if merged and b[0] - merged[-1][1] < 1.5:
            merged[-1] = (merged[-1][0], b[1])
        else:
            merged.append(b)
    big = [b for b in merged if b[1] - b[0] > 90]     # Pont Rouge, Pont Adolphe, the Gare bridge: level decks
    geo_profile = os.path.join(os.environ.get("LUXTRAM_WORK", "/Users/Ian/Library/Caches/luxtram-work"), "geo", "profile.json")
    if os.path.exists(geo_profile):
        # real rail level + bare earth from the LiDAR 2024 models (scripts/build_luxtram_geo.py profile)
        gp = json.load(open(geo_profile))
        keys, ground_keys, lidar_dem = gp["elev"], gp["ground"], gp["dem"]
        deltas = None
        print("elevation: LiDAR profile,", len(keys), "keys")
    else:
        keys, base, dem = elevation_profile(raw, line, big)
        deltas = ground_deltas(dem, keys, big)
    path = douglas_peucker(tr["pts"], 0.12)
    track = {
        "v": 1,
        "attribution": "© OpenStreetMap contributors (ODbL). Elevation guide: EU-DEM v1.1 (Copernicus) via opentopodata.org.",
        "origin": [LAT0, LON0],
        "length": r1(line.length),
        "path": delta_flat(path),
        "stops": [{"name": st["name"], "s": st["s"], "side": st["side"]} for st in tr["stops"]],
        "segs": tr["segs"],
        "elev": keys,
        "bridges": [{"s0": r1(a), "s1": r1(b), "name": bridge_name(line, a, b)} for a, b in merged],
        "tunnels": tunnels,
        "dem": {"step": 40, "offsets": dem["offsets"], "rows": deltas} if deltas is not None else lidar_dem,
    }
    if deltas is None:
        track["elevReal"] = True        # elev = real rail level (LiDAR), ground = bare earth along the line (no structures)
        track["ground"] = ground_keys
        track["attribution"] = "© OpenStreetMap contributors (ODbL). Heights: LiDAR 2024 © ACT Luxembourg (geoportail.lu, CC0)."
    write_json(os.path.join(out, "luxtram-track.json"), track)
    chunks = build_world(raw, tr)
    n_b = sum(len(c["b"]) for c in chunks.values())
    n_r = sum(len(c["r"]) for c in chunks.values())
    n_t = sum(len(c["t"]) for c in chunks.values())
    print("chunks", len(chunks), "buildings", n_b, "road pieces", n_r, "trees", n_t)
    world = {"v": 1, "chunk": CHUNK, "origin": [LAT0, LON0], "chunks": {str(k): v for k, v in sorted(chunks.items())}}
    write_json(os.path.join(out, "luxtram-world.json"), world)
    for st in tr["stops"]:
        print(st["s"], st["name"], st["side"], st["platDist"])
    print("bridges", merged, "tunnels", tunnels)


if __name__ == "__main__":
    main()
