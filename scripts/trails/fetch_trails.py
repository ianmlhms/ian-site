#!/usr/bin/env python3
"""Fetch Auto-Pédestre route geometry from OpenStreetMap via Overpass.

Reads the curated trail list (slug + osm_rel) from data/trails/trails.json
and writes, per trail:

  data/trails/geo/<slug>.geojson  : MultiLineString of the route ways
  data/trails/computed.json       : { "<slug>": { "length_km", "center",
                                      "bbox", "bus_stops": [ {id, name, lat,
                                      lon, dist_m, lines[]} ] } }

Bus stops come from the repo's moien-stops.json (all ~2800 national stops)
and the line index moien-lines.json — a stop qualifies when it lies within
NEAR_M of any point of the route (widened to FAR_M when nothing is close).

Usage:
    python3 scripts/trails/fetch_trails.py            # all trails
    python3 scripts/trails/fetch_trails.py <slug>...  # only these slugs

Overpass is queried once per run (all relations in one request). Re-run
whenever a trail is added to trails.json or OSM geometry improves.
"""
from __future__ import annotations

import json
import math
import os
import sys
import urllib.parse
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(REPO, "data", "trails")
GEO_DIR = os.path.join(DATA_DIR, "geo")
TRAILS_JSON = os.path.join(DATA_DIR, "trails.json")
COMPUTED_JSON = os.path.join(DATA_DIR, "computed.json")
STOPS_JSON = os.path.join(REPO, "moien-stops.json")
LINES_JSON = os.path.join(REPO, "moien-lines.json")

OVERPASS_MIRRORS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
USER_AGENT = "ian.lu-trails/1.0 (https://ian.lu)"
# member roles that are not part of the main walking loop
SKIP_ROLES = {"alternate", "excursion", "approach", "connection", "link"}
NEAR_M = 500       # a stop this close to the route counts as direct access
FAR_M = 1200       # fallback radius when no stop is within NEAR_M
MAX_STOPS = 4      # stops listed per trail
EARTH_R = 6371000.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


def load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def overpass_fetch(rel_ids: list) -> dict:
    ids = ",".join(str(i) for i in rel_ids)
    query = f"[out:json][timeout:180];relation(id:{ids});out geom;"
    body = urllib.parse.urlencode({"data": query}).encode()
    last_err: Exception = RuntimeError("no Overpass mirror configured")
    for url in OVERPASS_MIRRORS:
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=200) as r:
                return json.load(r)
        except Exception as err:  # try the next mirror
            print(f"  ! {url} failed: {err}", file=sys.stderr)
            last_err = err
    raise SystemExit(f"All Overpass mirrors failed: {last_err}")


def relation_lines(rel: dict) -> list:
    """Ordered list of way geometries (each a list of [lon, lat]) for the route."""
    segments = []
    for member in rel.get("members", []):
        if member.get("type") != "way" or member.get("role", "") in SKIP_ROLES:
            continue
        geometry = member.get("geometry") or []
        if len(geometry) >= 2:
            segments.append([[pt["lon"], pt["lat"]] for pt in geometry])
    return segments


def segments_length_km(segments: list) -> float:
    total = 0.0
    for seg in segments:
        for (lon1, lat1), (lon2, lat2) in zip(seg, seg[1:]):
            total += haversine_m(lat1, lon1, lat2, lon2)
    return round(total / 1000, 1)


def segments_bbox(segments: list) -> list:
    lons = [lon for seg in segments for lon, _ in seg]
    lats = [lat for seg in segments for _, lat in seg]
    return [round(min(lats), 5), round(min(lons), 5), round(max(lats), 5), round(max(lons), 5)]


def sample_points(segments: list, step: int = 5) -> list:
    """Every step-th vertex as (lat, lon) — enough resolution for stop distances."""
    points = []
    for seg in segments:
        points.extend((lat, lon) for lon, lat in seg[::step])
        points.append((seg[-1][1], seg[-1][0]))
    return points


def build_line_index(lines: dict) -> dict:
    """stop name -> sorted list of line names serving it."""
    index: dict = {}
    for line_name, directions in lines.items():
        for direction in directions:
            for stop_name in direction.get("s", []):
                index.setdefault(stop_name, set()).add(line_name)
    return {name: sorted(v, key=lambda s: (len(s), s)) for name, v in index.items()}


def nearest_stops(points: list, stops: list, line_index: dict) -> list:
    """Bus stops close to any route point, nearest first, deduped by name."""
    if not points:
        return []
    lat_c = sum(p[0] for p in points) / len(points)
    lon_c = sum(p[1] for p in points) / len(points)
    ranked = []
    for stop_id, name, lat, lon in stops:
        if haversine_m(lat_c, lon_c, lat, lon) > 8000:  # cheap prefilter
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
            picked.append({
                "id": stop_id,
                "name": name,
                "lat": lat,
                "lon": lon,
                "dist_m": int(round(dist / 10) * 10),
                "lines": line_index.get(name, []),
            })
        if len(picked) >= 2:
            break
    return picked


def main() -> None:
    trails = load_json(TRAILS_JSON)["trails"]
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

    print(f"Fetching {len(trails)} relation(s) from Overpass ...")
    result = overpass_fetch([t["osm_rel"] for t in trails])
    by_id = {el["id"]: el for el in result.get("elements", []) if el.get("type") == "relation"}

    os.makedirs(GEO_DIR, exist_ok=True)
    updated = dict(computed)
    for trail in trails:
        slug, rel_id = trail["slug"], trail["osm_rel"]
        rel = by_id.get(rel_id)
        if rel is None:
            print(f"  ! {slug}: relation {rel_id} not returned — skipped", file=sys.stderr)
            continue
        segments = relation_lines(rel)
        if not segments:
            print(f"  ! {slug}: relation {rel_id} has no way geometry — skipped", file=sys.stderr)
            continue
        geojson = {
            "type": "Feature",
            "properties": {"name": rel.get("tags", {}).get("name", slug), "osm_rel": rel_id},
            "geometry": {"type": "MultiLineString", "coordinates": segments},
        }
        geo_path = os.path.join(GEO_DIR, f"{slug}.geojson")
        with open(geo_path, "w", encoding="utf-8") as f:
            json.dump(geojson, f, ensure_ascii=False, separators=(",", ":"))
        points = sample_points(segments)
        bbox = segments_bbox(segments)
        entry = {
            "length_km": segments_length_km(segments),
            "center": [round((bbox[0] + bbox[2]) / 2, 5), round((bbox[1] + bbox[3]) / 2, 5)],
            "bbox": bbox,
            "bus_stops": nearest_stops(points, stops, line_index),
        }
        updated = {**updated, slug: entry}
        stops_txt = ", ".join(f'{s["name"]} ({s["dist_m"]} m)' for s in entry["bus_stops"]) or "NONE"
        print(f"  ✓ {slug}: {entry['length_km']} km, stops: {stops_txt}")

    with open(COMPUTED_JSON, "w", encoding="utf-8") as f:
        json.dump(updated, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(f"Wrote {COMPUTED_JSON}")


if __name__ == "__main__":
    main()
