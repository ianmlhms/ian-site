#!/usr/bin/env python3
"""Measure what each route actually runs through, from OpenStreetMap.

One Overpass query per trail (its bbox plus a margin), then everything is
measured locally against the route line, sampled every SAMPLE_M metres:

  forest_pct / vineyard_pct / orchard_pct / open_pct
              share of the route inside landuse=forest|natural=wood,
              landuse=vineyard, landuse=orchard, farmland/meadow
  surface     share of the route on paved roads, on tracks and on paths,
              from the nearest OSM way (highway + surface tags); "unknown"
              where no way is within WAY_NEAR_M
  steps       number of highway=steps ways the route uses
  villages    town/village/hamlet nodes within PLACE_NEAR_M, in walking
              order, with names per language (name:lb etc. when tagged)
  waters      named rivers and streams the route follows (km within
              WATER_NEAR_M) or crosses, with names per language
  amenities   benches, picnic tables/sites, shelters, drinking water,
              playgrounds, toilets within AMENITY_NEAR_M
  food        named restaurants / cafés within FOOD_NEAR_M, walking order
  churches    named churches and chapels within CHURCH_NEAR_M

Writes data/<cat>/context.json {slug: {...}}. Resumable: trails already in
the file are skipped unless --force; slugs on the command line limit the run.

    python3 scripts/trails/fetch_context.py [--cat mtb] [--force] [slug ...]
"""
from __future__ import annotations

import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import pick_category  # noqa: E402

OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
USER_AGENT = "ian.lu-trails/1.1 (https://ian.lu)"
VERSION = 1
SAMPLE_M = 25
MARGIN_DEG = 0.004  # ≈ 300–450 m around the bbox
WAY_NEAR_M = 22
PLACE_NEAR_M = 450
WATER_NEAR_M = 60
WATER_FOLLOW_KM = 0.4
AMENITY_NEAR_M = 60
FOOD_NEAR_M = 120
CHURCH_NEAR_M = 150
PAUSE_S = 4
EARTH_R = 6371000.0
LANGS = ("de", "fr", "en", "lb")

PAVED_SURFACES = {"asphalt", "paved", "concrete", "concrete:plates", "paving_stones", "sett", "cobblestone",
                  "concrete:lanes", "chipseal", "metal", "wood"}
UNPAVED_SURFACES = {"unpaved", "gravel", "fine_gravel", "compacted", "dirt", "earth", "ground", "grass", "mud",
                    "sand", "pebblestone", "rock", "woodchips", "grass_paver"}
ROAD_HIGHWAYS = {"primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service",
                 "primary_link", "secondary_link", "tertiary_link", "pedestrian", "cycleway", "road"}
PATH_HIGHWAYS = {"path", "footway", "bridleway", "steps"}


def haversine_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


def load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def overpass(query: str) -> dict:
    body = urllib.parse.urlencode({"data": query}).encode()
    last_err: Exception = RuntimeError("no mirror")
    for attempt in range(5):
        for url in OVERPASS_MIRRORS:
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=240) as r:
                    return json.load(r)
            except Exception as err:
                print(f"    ! {url.split('/')[2]} (try {attempt + 1}): {err}", file=sys.stderr)
                last_err = err
                time.sleep(15 * (attempt + 1))
    raise RuntimeError(f"all Overpass mirrors failed: {last_err}")


def query_for(bbox: list) -> str:
    s, w, n, e = bbox[0] - MARGIN_DEG, bbox[1] - MARGIN_DEG, bbox[2] + MARGIN_DEG, bbox[3] + MARGIN_DEG
    b = f"({s:.5f},{w:.5f},{n:.5f},{e:.5f})"
    return f"""[out:json][timeout:200];
(
  way["landuse"~"^(forest|vineyard|orchard|farmland|meadow|grass)$"]{b};
  way["natural"~"^(wood|scrub|heath)$"]{b};
  relation["landuse"~"^(forest|vineyard|orchard|farmland|meadow)$"]{b};
  relation["natural"="wood"]{b};
)->.land;
.land out geom;
way["highway"]{b};
out tags geom;
node["place"~"^(town|village|hamlet|suburb)$"]{b};
out;
way["waterway"~"^(river|stream)$"]["name"]{b};
out tags geom;
(
  node["amenity"~"^(bench|shelter|drinking_water|toilets|restaurant|cafe|place_of_worship|bbq)$"]{b};
  way["amenity"~"^(shelter|restaurant|cafe|place_of_worship)$"]{b};
  node["leisure"~"^(picnic_table|playground)$"]{b};
  way["leisure"="playground"]{b};
  node["tourism"="picnic_site"]{b};
  way["tourism"="picnic_site"]{b};
  node["building"~"^(chapel|church)$"]["name"]{b};
  way["building"~"^(chapel|church)$"]["name"]{b};
  node["historic"="wayside_shrine"]["name"]{b};
);
out center tags;
"""


# --- geometry ---------------------------------------------------------------

def route_samples(geo: dict) -> list:
    """[(lat, lon, km)] every SAMPLE_M metres along the walking-ordered line."""
    pts = []
    for seg in geo["geometry"]["coordinates"]:
        for lon, lat in seg:
            pts.append((lat, lon))
    samples = [(pts[0][0], pts[0][1], 0.0)]
    dist = 0.0
    carry = 0.0
    for (la1, lo1), (la2, lo2) in zip(pts, pts[1:]):
        d = haversine_m(la1, lo1, la2, lo2)
        if d > 400:  # a gap between segments: do not invent ground in between
            dist += d
            samples.append((la2, lo2, dist / 1000))
            carry = 0.0
            continue
        pos = SAMPLE_M - carry
        while pos <= d:
            f = pos / d
            samples.append((la1 + (la2 - la1) * f, lo1 + (lo2 - lo1) * f, (dist + pos) / 1000))
            pos += SAMPLE_M
        carry = d - (pos - SAMPLE_M)
        dist += d
    return samples


def assemble_rings(ways: list) -> list:
    """Join open way geometries into closed rings by shared endpoints."""
    rings, open_ = [], []
    for coords in ways:
        if len(coords) < 2:
            continue
        if coords[0] == coords[-1] and len(coords) >= 4:
            rings.append(coords)
        else:
            open_.append(list(coords))
    while open_:
        current = open_.pop()
        changed = True
        while changed and current[0] != current[-1]:
            changed = False
            for i, other in enumerate(open_):
                if other[0] == current[-1]:
                    current += other[1:]
                elif other[-1] == current[-1]:
                    current += list(reversed(other))[1:]
                elif other[-1] == current[0]:
                    current = other[:-1] + current
                elif other[0] == current[0]:
                    current = list(reversed(other))[:-1] + current
                else:
                    continue
                open_.pop(i)
                changed = True
                break
        if current[0] == current[-1] and len(current) >= 4:
            rings.append(current)
    return rings


class Polygon:
    def __init__(self, outers: list, inners: list):
        self.outers = [self._prep(r) for r in outers]
        self.inners = [self._prep(r) for r in inners]

    @staticmethod
    def _prep(ring: list) -> tuple:
        lats = [p[0] for p in ring]
        lons = [p[1] for p in ring]
        return (min(lats), min(lons), max(lats), max(lons)), ring

    @staticmethod
    def _inside(ring_info: tuple, lat: float, lon: float) -> bool:
        (s, w, n, e), ring = ring_info
        if not (s <= lat <= n and w <= lon <= e):
            return False
        inside = False
        j = len(ring) - 1
        for i in range(len(ring)):
            yi, xi = ring[i]
            yj, xj = ring[j]
            if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
        return inside

    def contains(self, lat: float, lon: float) -> bool:
        if not any(self._inside(r, lat, lon) for r in self.outers):
            return False
        return not any(self._inside(r, lat, lon) for r in self.inners)


def land_class(tags: dict) -> str:
    landuse, natural = tags.get("landuse"), tags.get("natural")
    if landuse == "forest" or natural == "wood":
        return "forest"
    if landuse == "vineyard":
        return "vineyard"
    if landuse == "orchard":
        return "orchard"
    if landuse in ("farmland", "meadow", "grass") or natural in ("scrub", "heath"):
        return "open"
    return ""


def polygons_of(elements: list) -> list:
    out = []
    for el in elements:
        cls = land_class(el.get("tags", {}))
        if not cls:
            continue
        if el["type"] == "way" and el.get("geometry"):
            ring = [(p["lat"], p["lon"]) for p in el["geometry"]]
            if ring[0] == ring[-1] and len(ring) >= 4:
                out.append((cls, Polygon([ring], [])))
        elif el["type"] == "relation":
            outers, inners = [], []
            for m in el.get("members", []):
                if m.get("type") != "way" or not m.get("geometry"):
                    continue
                coords = [(p["lat"], p["lon"]) for p in m["geometry"] if p]
                (inners if m.get("role") == "inner" else outers).append(coords)
            rings_out = assemble_rings(outers)
            if rings_out:
                out.append((cls, Polygon(rings_out, assemble_rings(inners))))
    return out


class SegmentIndex:
    """Grid of way segments for nearest-way lookups."""
    CELL = 0.0006

    def __init__(self, ways: list):
        self.grid = {}
        for idx, (_tags, coords) in enumerate(ways):
            for (la1, lo1), (la2, lo2) in zip(coords, coords[1:]):
                for ci in range(int(min(la1, la2) / self.CELL), int(max(la1, la2) / self.CELL) + 1):
                    for cj in range(int(min(lo1, lo2) / self.CELL), int(max(lo1, lo2) / self.CELL) + 1):
                        self.grid.setdefault((ci, cj), []).append((idx, la1, lo1, la2, lo2))
        self.ways = ways

    def nearest(self, lat: float, lon: float, max_m: float):
        ci, cj = int(lat / self.CELL), int(lon / self.CELL)
        best, best_d = None, max_m
        kx = math.cos(math.radians(lat)) * 111320.0
        ky = 110540.0
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for idx, la1, lo1, la2, lo2 in self.grid.get((ci + di, cj + dj), ()):
                    ax, ay = (lo1 - lon) * kx, (la1 - lat) * ky
                    bx, by = (lo2 - lon) * kx, (la2 - lat) * ky
                    dx, dy = bx - ax, by - ay
                    seg2 = dx * dx + dy * dy
                    t = 0.0 if seg2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / seg2))
                    px, py = ax + t * dx, ay + t * dy
                    d = math.hypot(px, py)
                    if d < best_d:
                        best, best_d = idx, d
        return best


def surface_class(tags: dict) -> str:
    highway = tags.get("highway", "")
    surface = tags.get("surface", "")
    if highway == "steps":
        return "path"
    if surface in PAVED_SURFACES:
        return "paved"
    if highway in PATH_HIGHWAYS:
        return "path"
    if highway == "track":
        return "track"
    if surface in UNPAVED_SURFACES:
        return "track"
    if highway in ROAD_HIGHWAYS:
        return "paved"
    return "unknown"


def names_of(tags: dict) -> dict:
    base = tags.get("name", "")
    return {lang: tags.get(f"name:{lang}", base) for lang in LANGS} | {"name": base}


def nearest_sample(samples: list, lat: float, lon: float) -> tuple:
    best_i, best_d = 0, float("inf")
    for i, (la, lo, _km) in enumerate(samples):
        d = haversine_m(la, lo, lat, lon)
        if d < best_d:
            best_i, best_d = i, d
    return best_i, best_d


def pct(count: int, total: int) -> int:
    return round(100 * count / total) if total else 0


def measure(samples: list, data: dict) -> dict:
    elements = data.get("elements", [])
    land = [el for el in elements if el["type"] in ("way", "relation") and land_class(el.get("tags", {}))
            and "highway" not in el.get("tags", {})]
    polys = polygons_of(land)
    ways = [(el.get("tags", {}), [(p["lat"], p["lon"]) for p in el.get("geometry", [])])
            for el in elements if el["type"] == "way" and "highway" in el.get("tags", {}) and el.get("geometry")]
    index = SegmentIndex(ways)
    total = len(samples)

    land_counts = {"forest": 0, "vineyard": 0, "orchard": 0, "open": 0}
    surf_counts = {"paved": 0, "track": 0, "path": 0, "unknown": 0}
    steps_ways = set()
    for lat, lon, _km in samples:
        classes = {cls for cls, poly in polys if poly.contains(lat, lon)}
        for cls in ("forest", "vineyard", "orchard", "open"):
            if cls in classes:
                land_counts[cls] += 1
                break
        idx = index.nearest(lat, lon, WAY_NEAR_M)
        cls = surface_class(ways[idx][0]) if idx is not None else "unknown"
        surf_counts[cls] += 1
        if idx is not None and ways[idx][0].get("highway") == "steps":
            steps_ways.add(idx)

    villages = []
    for el in elements:
        if el["type"] != "node" or "place" not in el.get("tags", {}) or not el["tags"].get("name"):
            continue
        i, d = nearest_sample(samples, el["lat"], el["lon"])
        if d <= PLACE_NEAR_M:
            villages.append({"names": names_of(el["tags"]), "type": el["tags"]["place"],
                             "km": round(samples[i][2], 1), "dist_m": round(d)})
    villages.sort(key=lambda v: v["km"])

    waters = {}
    for el in elements:
        tags = el.get("tags", {})
        if (el["type"] != "way" or tags.get("waterway") not in ("river", "stream") or not el.get("geometry")
                or not tags.get("name")):
            continue
        key = tags["name"]
        coords = [(p["lat"], p["lon"]) for p in el["geometry"]]
        rec = waters.setdefault(key, {"names": names_of(tags), "kind": tags["waterway"], "near": set(), "first_km": None})
        if tags["waterway"] == "river":
            rec["kind"] = "river"
        widx = SegmentIndex([({}, coords)])
        for i, (lat, lon, km) in enumerate(samples):
            if widx.nearest(lat, lon, WATER_NEAR_M) is not None:
                rec["near"].add(i)
                if rec["first_km"] is None or km < rec["first_km"]:
                    rec["first_km"] = km
    water_list = []
    for rec in waters.values():
        if not rec["near"]:
            continue
        along_km = len(rec["near"]) * SAMPLE_M / 1000
        water_list.append({"names": rec["names"], "kind": rec["kind"], "along_km": round(along_km, 1),
                           "first_km": round(rec["first_km"], 1),
                           "follows": along_km >= WATER_FOLLOW_KM})
    water_list.sort(key=lambda w: (-w["along_km"], w["first_km"]))

    amenities = {"bench": 0, "picnic": 0, "shelter": 0, "drinking_water": 0, "playground": 0, "toilets": 0}
    food, churches = [], []
    seen_food, seen_church = set(), set()
    for el in elements:
        tags = el.get("tags", {})
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None or lon is None:
            continue
        amenity, leisure, tourism = tags.get("amenity"), tags.get("leisure"), tags.get("tourism")
        building, historic = tags.get("building"), tags.get("historic")
        kind = None
        if amenity == "bench":
            kind = "bench"
        elif leisure == "picnic_table" or tourism == "picnic_site" or amenity == "bbq":
            kind = "picnic"
        elif amenity == "shelter":
            kind = "shelter"
        elif amenity in ("drinking_water", "toilets"):
            kind = amenity
        elif leisure == "playground":
            kind = "playground"
        if kind:
            if nearest_sample(samples, lat, lon)[1] <= AMENITY_NEAR_M:
                amenities[kind] += 1
            continue
        if amenity in ("restaurant", "cafe") and tags.get("name"):
            i, d = nearest_sample(samples, lat, lon)
            if d <= FOOD_NEAR_M and tags["name"] not in seen_food:
                seen_food.add(tags["name"])
                food.append({"name": tags["name"], "kind": amenity, "km": round(samples[i][2], 1), "dist_m": round(d)})
            continue
        is_church = (amenity == "place_of_worship" or building in ("church", "chapel") or historic == "wayside_shrine")
        if is_church and tags.get("name"):
            i, d = nearest_sample(samples, lat, lon)
            name = tags["name"]
            if d <= CHURCH_NEAR_M and name not in seen_church:
                seen_church.add(name)
                kind = "chapel" if (building == "chapel" or "chapel" in name.lower() or "kapell" in name.lower()
                                    or historic == "wayside_shrine") else "church"
                churches.append({"names": names_of(tags), "kind": kind, "km": round(samples[i][2], 1)})
    food.sort(key=lambda f: f["km"])
    churches.sort(key=lambda c: c["km"])

    return {
        "version": VERSION,
        "samples": total,
        "forest_pct": pct(land_counts["forest"], total),
        "vineyard_pct": pct(land_counts["vineyard"], total),
        "orchard_pct": pct(land_counts["orchard"], total),
        "open_pct": pct(land_counts["open"], total),
        "surface": {k: pct(v, total) for k, v in surf_counts.items()},
        "steps": len(steps_ways),
        "villages": villages,
        "waters": water_list[:6],
        "amenities": amenities,
        "food": food[:6],
        "churches": churches[:6],
    }


# --- local source: a Geofabrik extract instead of Overpass ---------------------

NODE_KEYS = ("place", "amenity", "leisure", "tourism", "building", "historic")


def _wanted_node(t: dict) -> bool:
    if t.get("place") in ("town", "village", "hamlet", "suburb") and t.get("name"):
        return True
    if t.get("amenity") in ("bench", "shelter", "drinking_water", "toilets", "restaurant", "cafe",
                            "place_of_worship", "bbq"):
        return True
    if t.get("leisure") in ("picnic_table", "playground") or t.get("tourism") == "picnic_site":
        return True
    if t.get("building") in ("chapel", "church") and t.get("name"):
        return True
    return t.get("historic") == "wayside_shrine" and bool(t.get("name"))


def _wanted_way_center(t: dict) -> bool:
    return (t.get("amenity") in ("shelter", "restaurant", "cafe", "place_of_worship")
            or t.get("leisure") == "playground" or t.get("tourism") == "picnic_site"
            or (t.get("building") in ("chapel", "church") and bool(t.get("name"))))


def load_pbf(path: str) -> list:
    """[(bbox, element)] in the Overpass JSON shape, from an .osm.pbf extract.

    Needs pyosmium (`pip install osmium`, Python <= 3.13 wheels). Used when
    Overpass is overloaded: one local pass over Luxembourg instead of 200
    remote queries.
    """
    import osmium  # optional dependency, only for --pbf

    out = []

    def bbox_of(coords):
        lats = [c[0] for c in coords]
        lons = [c[1] for c in coords]
        return (min(lats), min(lons), max(lats), max(lons))

    def geom(coords):
        return [{"lat": la, "lon": lo} for la, lo in coords]

    class Handler(osmium.SimpleHandler):
        def node(self, n):
            if not any(k in n.tags for k in NODE_KEYS):
                return
            t = {tag.k: tag.v for tag in n.tags}
            if _wanted_node(t) and n.location.valid():
                lat, lon = n.location.lat, n.location.lon
                out.append(((lat, lon, lat, lon), {"type": "node", "lat": lat, "lon": lon, "tags": t}))

        def way(self, w):
            t = {tag.k: tag.v for tag in w.tags}
            is_line = "highway" in t or (t.get("waterway") in ("river", "stream") and t.get("name"))
            if not is_line and not _wanted_way_center(t):
                return
            coords = [(nd.location.lat, nd.location.lon) for nd in w.nodes if nd.location.valid()]
            if len(coords) < 2:
                return
            bb = bbox_of(coords)
            if is_line:
                out.append((bb, {"type": "way", "tags": t, "geometry": geom(coords)}))
            else:
                center = {"lat": sum(c[0] for c in coords) / len(coords), "lon": sum(c[1] for c in coords) / len(coords)}
                out.append((bb, {"type": "way", "tags": t, "center": center}))

        def area(self, a):
            t = {tag.k: tag.v for tag in a.tags}
            if not land_class(t) or "highway" in t:
                return
            members = []
            for outer in a.outer_rings():
                ring = [(n.lat, n.lon) for n in outer]
                members.append({"type": "way", "role": "outer", "geometry": geom(ring)})
                for inner in a.inner_rings(outer):
                    members.append({"type": "way", "role": "inner", "geometry": geom([(n.lat, n.lon) for n in inner])})
            if members:
                pts = [(p["lat"], p["lon"]) for m in members if m["role"] == "outer" for p in m["geometry"]]
                out.append((bbox_of(pts), {"type": "relation", "tags": t, "members": members}))

    Handler().apply_file(path, locations=True)
    return out


def local_query(elements: list, bbox: list) -> dict:
    s, w, n, e = bbox[0] - MARGIN_DEG, bbox[1] - MARGIN_DEG, bbox[2] + MARGIN_DEG, bbox[3] + MARGIN_DEG
    hits = [el for (bs, bw, bn, be), el in elements if bs <= n and bn >= s and bw <= e and be >= w]
    return {"elements": hits}


def main() -> None:
    cat, rest = pick_category(sys.argv[1:])
    force = "--force" in rest
    pbf = None
    if "--pbf" in rest:
        i = rest.index("--pbf")
        pbf = rest[i + 1]
        rest = rest[:i] + rest[i + 2:]
    only = {a for a in rest if not a.startswith("--")}
    data_dir = cat["data_dir"]
    out_path = os.path.join(data_dir, "context.json")
    computed = load_json(os.path.join(data_dir, "computed.json"))
    registry = load_json(os.path.join(data_dir, "registry.json"))["trails"]
    context = load_json(out_path) if os.path.exists(out_path) else {}
    todo = [t for t in registry if not t.get("retired") and t["slug"] in computed
            and (not only or t["slug"] in only)
            and (force or context.get(t["slug"], {}).get("version") != VERSION)]
    print(f"{len(todo)} trails to measure ({cat['key']})")
    local = None
    if pbf and todo:
        print(f"Reading {pbf} …")
        local = load_pbf(pbf)
        print(f"  {len(local)} OSM elements kept")
    for n, trail in enumerate(todo, 1):
        slug = trail["slug"]
        geo_path = os.path.join(data_dir, "geo", f"{slug}.geojson")
        if not os.path.exists(geo_path):
            continue
        samples = route_samples(load_json(geo_path))
        if local is not None:
            data = local_query(local, computed[slug]["bbox"])
        else:
            try:
                data = overpass(query_for(computed[slug]["bbox"]))
            except RuntimeError as err:
                print(f"  ! {slug}: {err}", file=sys.stderr)
                continue
        entry = measure(samples, data)
        context = {**context, slug: entry}
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(context, f, ensure_ascii=False, indent=1, sort_keys=True)
        s = entry["surface"]
        print(f"  [{n}/{len(todo)}] {slug}: forest {entry['forest_pct']}%, vines {entry['vineyard_pct']}%, "
              f"paved {s['paved']}% track {s['track']}% path {s['path']}% ?{s['unknown']}%, "
              f"{len(entry['villages'])} places, {len(entry['waters'])} waters, {len(entry['food'])} food")
        if local is None:
            time.sleep(PAUSE_S)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
