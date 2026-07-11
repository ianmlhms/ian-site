#!/usr/bin/env python3
"""Fetch route geometry for every registry trail from OSM via Overpass.

Reads data/trails/registry.json (from discover_trails.py) and writes:

  data/trails/geo/<slug>.geojson  : simplified route line for the Leaflet map
  data/trails/computed.json       : per slug — length_km, center, bbox, region,
                                    natural_pct (share on paths/tracks),
                                    bus_stops [{id,name,lat,lon,dist_m,lines[]}]

Existing computed entries are merged, so enrich.py additions (elevation,
POIs, images) survive a re-fetch. Relations are fetched in chunks to keep
Overpass happy; segments are chained into walking order where endpoints
match, then Douglas-Peucker-simplified (~4 m tolerance).

Usage:
    python3 scripts/trails/fetch_trails.py            # all trails
    python3 scripts/trails/fetch_trails.py <slug>...  # only these slugs
"""
from __future__ import annotations

import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(REPO, "data", "trails")
GEO_DIR = os.path.join(DATA_DIR, "geo")
REGISTRY_JSON = os.path.join(DATA_DIR, "registry.json")
COMPUTED_JSON = os.path.join(DATA_DIR, "computed.json")
STOPS_JSON = os.path.join(REPO, "moien-stops.json")
LINES_JSON = os.path.join(REPO, "moien-lines.json")

OVERPASS_MIRRORS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
USER_AGENT = "ian.lu-trails/1.0 (https://ian.lu)"
SKIP_ROLES = {"alternate", "excursion", "approach", "connection", "link"}
NATURAL_HIGHWAYS = {"path", "track", "footway", "bridleway", "steps"}
CHUNK_SIZE = 15
NEAR_M = 500
FAR_M = 1200
MAX_STOPS = 4
SIMPLIFY_EPS_DEG = 0.00004  # ≈ 4 m
EARTH_R = 6371000.0


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
    last_err: Exception = RuntimeError("no mirror configured")
    for url in OVERPASS_MIRRORS:
        for attempt in (1, 2):
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=200) as r:
                    return json.load(r)
            except Exception as err:
                print(f"  ! {url} (try {attempt}) failed: {err}", file=sys.stderr)
                last_err = err
                time.sleep(5)
    raise SystemExit(f"All Overpass mirrors failed: {last_err}")


def fetch_chunk(rel_ids: list) -> dict:
    ids = ",".join(str(i) for i in rel_ids)
    return overpass(f"[out:json][timeout:180];relation(id:{ids});out geom;way(r);out tags;")


# --- geometry ---------------------------------------------------------------

def member_segments(rel: dict, way_tags: dict) -> list:
    """[(coords [[lon,lat],...], is_natural), ...] for the main route ways."""
    segments = []
    for member in rel.get("members", []):
        if member.get("type") != "way" or member.get("role", "") in SKIP_ROLES:
            continue
        geometry = member.get("geometry") or []
        if len(geometry) < 2:
            continue
        coords = [[pt["lon"], pt["lat"]] for pt in geometry]
        highway = way_tags.get(member.get("ref"), {}).get("highway", "")
        segments.append((coords, highway in NATURAL_HIGHWAYS))
    return segments


def chain_segments(segments: list) -> list:
    """Greedily chain segments into walking order by matching endpoints."""
    if not segments:
        return []
    remaining = list(segments)
    chained = [remaining.pop(0)]
    while remaining:
        end = chained[-1][0][-1]
        hit = None
        for i, (coords, natural) in enumerate(remaining):
            if coords[0] == end:
                hit = (i, coords, natural)
                break
            if coords[-1] == end:
                hit = (i, list(reversed(coords)), natural)
                break
        if hit is None:
            chained.append(remaining.pop(0))  # gap in the relation — start a new run
            continue
        i, coords, natural = hit
        remaining.pop(i)
        chained.append((coords, natural))
    return chained


def rdp(points: list, eps: float) -> list:
    """Iterative Douglas-Peucker on [lon, lat] points (degree-space epsilon)."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        ax, ay = points[start]
        bx, by = points[end]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy) or 1e-12
        max_d, max_i = 0.0, -1
        for i in range(start + 1, end):
            px, py = points[i]
            d = abs(dx * (ay - py) - dy * (ax - px)) / norm
            if d > max_d:
                max_d, max_i = d, i
        if max_d > eps:
            keep[max_i] = True
            stack.extend([(start, max_i), (max_i, end)])
    return [p for p, k in zip(points, keep) if k]


def simplify(segments: list) -> list:
    return [[[round(lon, 5), round(lat, 5)] for lon, lat in rdp(coords, SIMPLIFY_EPS_DEG)]
            for coords, _ in segments]


def length_km(segments: list) -> float:
    total = 0.0
    for coords, _ in segments:
        for (lon1, lat1), (lon2, lat2) in zip(coords, coords[1:]):
            total += haversine_m(lat1, lon1, lat2, lon2)
    return round(total / 1000, 1)


def natural_pct(segments: list) -> int:
    total = nat = 0.0
    for coords, natural in segments:
        seg_len = sum(haversine_m(a[1], a[0], b[1], b[0]) for a, b in zip(coords, coords[1:]))
        total += seg_len
        if natural:
            nat += seg_len
    return int(round(100 * nat / total)) if total else 0


def bbox_of(segments: list) -> list:
    lons = [lon for coords, _ in segments for lon, _ in coords]
    lats = [lat for coords, _ in segments for _, lat in coords]
    return [round(min(lats), 5), round(min(lons), 5), round(max(lats), 5), round(max(lons), 5)]


def classify_region(lat: float, lon: float) -> str:
    if lat >= 49.83:
        return "eislek"
    if lat >= 49.70 and lon >= 6.28:
        return "mullerthal"
    if lon >= 6.33:
        return "moselle"
    if lat <= 49.535 and lon <= 6.25:
        return "minett"
    return "center"


# --- bus stops ---------------------------------------------------------------

def build_line_index(lines: dict) -> dict:
    index: dict = {}
    for line_name, directions in lines.items():
        for direction in directions:
            for stop_name in direction.get("s", []):
                index.setdefault(stop_name, set()).add(line_name)
    return {name: sorted(v, key=lambda s: (len(s), s)) for name, v in index.items()}


def sample_points(segments: list, step: int = 5) -> list:
    points = []
    for coords, _ in segments:
        points.extend((lat, lon) for lon, lat in coords[::step])
        points.append((coords[-1][1], coords[-1][0]))
    return points


def nearest_stops(points: list, stops: list, line_index: dict) -> list:
    if not points:
        return []
    lat_c = sum(p[0] for p in points) / len(points)
    lon_c = sum(p[1] for p in points) / len(points)
    ranked = []
    for stop_id, name, lat, lon in stops:
        if haversine_m(lat_c, lon_c, lat, lon) > 8000:
            continue
        dist = min(haversine_m(lat, lon, p_lat, p_lon) for p_lat, p_lon in points)
        ranked.append((dist, stop_id, name, lat, lon))
    ranked.sort()
    picked, seen = [], set()
    for radius in (NEAR_M, FAR_M):
        for dist, stop_id, name, lat, lon in ranked:
            if dist > radius or name in seen or len(picked) >= MAX_STOPS:
                continue
            seen.add(name)
            picked.append({"id": stop_id, "name": name, "lat": lat, "lon": lon,
                           "dist_m": int(round(dist / 10) * 10),
                           "lines": line_index.get(name, [])})
        if len(picked) >= 2:
            break
    return picked


# --- main --------------------------------------------------------------------

def process_relation(trail: dict, rel: dict, way_tags: dict, stops: list, line_index: dict):
    segments = chain_segments(member_segments(rel, way_tags))
    if not segments:
        return None, None
    bbox = bbox_of(segments)
    entry = {
        "length_km": length_km(segments),
        "center": [round((bbox[0] + bbox[2]) / 2, 5), round((bbox[1] + bbox[3]) / 2, 5)],
        "bbox": bbox,
        "region": classify_region((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2),
        "natural_pct": natural_pct(segments),
        "bus_stops": nearest_stops(sample_points(segments), stops, line_index),
    }
    geojson = {
        "type": "Feature",
        "properties": {"name": trail["name"], "osm_rel": trail["osm_rel"]},
        "geometry": {"type": "MultiLineString", "coordinates": simplify(segments)},
    }
    return entry, geojson


def main() -> None:
    trails = load_json(REGISTRY_JSON)["trails"]
    wanted = set(sys.argv[1:])
    if wanted:
        trails = [t for t in trails if t["slug"] in wanted]
        missing = wanted - {t["slug"] for t in trails}
        if missing:
            raise SystemExit(f"Unknown slugs: {', '.join(sorted(missing))}")
    if not trails:
        raise SystemExit("No trails to fetch.")

    stops = load_json(STOPS_JSON)
    line_index = build_line_index(load_json(LINES_JSON))
    computed = load_json(COMPUTED_JSON) if os.path.exists(COMPUTED_JSON) else {}
    os.makedirs(GEO_DIR, exist_ok=True)

    updated = dict(computed)
    failed = []
    for start in range(0, len(trails), CHUNK_SIZE):
        chunk = trails[start:start + CHUNK_SIZE]
        print(f"Chunk {start // CHUNK_SIZE + 1}: fetching {len(chunk)} relations ...")
        result = fetch_chunk([t["osm_rel"] for t in chunk])
        rels = {el["id"]: el for el in result.get("elements", []) if el.get("type") == "relation"}
        way_tags = {el["id"]: el.get("tags", {}) for el in result.get("elements", [])
                    if el.get("type") == "way"}
        for trail in chunk:
            rel = rels.get(trail["osm_rel"])
            entry, geojson = process_relation(trail, rel, way_tags, stops, line_index) if rel else (None, None)
            if entry is None:
                failed.append(trail["slug"])
                print(f"  ! {trail['slug']}: no usable geometry", file=sys.stderr)
                continue
            merged = {**computed.get(trail["slug"], {}), **entry}
            updated = {**updated, trail["slug"]: merged}
            with open(os.path.join(GEO_DIR, f"{trail['slug']}.geojson"), "w", encoding="utf-8") as f:
                json.dump(geojson, f, ensure_ascii=False, separators=(",", ":"))
            print(f"  ✓ {trail['slug']}: {entry['length_km']} km, {entry['natural_pct']}% paths, "
                  f"{len(entry['bus_stops'])} stops")
        time.sleep(2)

    with open(COMPUTED_JSON, "w", encoding="utf-8") as f:
        json.dump(updated, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(f"Wrote {COMPUTED_JSON} — {len(trails) - len(failed)} ok, {len(failed)} failed"
          + (f" ({', '.join(failed)})" if failed else ""))


if __name__ == "__main__":
    main()
