#!/usr/bin/env python3
"""Build the data files behind the Luxembourg trail maps (/kaart/ and /geoportal/).

Reads the SAME pipeline data the trail pages are generated from — registry.json,
computed.json and geo/*.geojson per category (see config.py) — and emits three
compact JSON files that both map pages fetch:

  kaart/data/routes.json      metadata for every route (facts, bus, centre, url)
  kaart/data/geo-hiking.json  {slug: ["<encoded polyline>", ...]}  one per ring
  kaart/data/geo-mtb.json     same, for the MTB loops

Geometry is split per category so a map can lazily load only what is toggled on.
Coordinates are flipped to Leaflet order (lat, lon) here so the browser never has
to, simplified, then packed as Google encoded polylines — ian.lu runs on nginx
with gzip off, so shrinking the bytes themselves is the only lever available.

The page assets (index.html / map.css / map.js) are hand-written source files and
are NOT generated — only data/ is. That keeps this script small and means editing
the map UI never means editing generated output.

Usage:
    python3 scripts/trails/build_map.py
"""
from __future__ import annotations

import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from composer import auto_difficulty, duration_label  # noqa: E402
from config import CATEGORIES, REPO  # noqa: E402

OUT_DIR = os.path.join(REPO, "kaart", "data")

# Only the nearest few stops are useful in a map popup; the trail page has them all.
MAX_BUS_STOPS = 3
# A stop this close is effectively "on the route" (mirrors composer.BUS_ON_ROUTE_M).
BUS_ON_ROUTE_M = 150
# Douglas-Peucker tolerance in degrees (~8 m at this latitude). The detail pages
# keep the full geometry; an overview map of the whole country does not need it,
# and this roughly halves the payload.
SIMPLIFY_DEG = 0.00008


def load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def encode_polyline(points: list, precision: int = 5) -> str:
    """Google encoded-polyline format for a (lat, lon) list.

    ian.lu is served by nginx with compression switched off, so raw coordinate
    arrays would ship uncompressed. This packs the same 5-decimal precision into
    roughly a fifth of the bytes; map.js decodes it.
    """
    factor = 10 ** precision
    out, prev_lat, prev_lon = [], 0, 0
    for lat, lon in points:
        ilat, ilon = round(lat * factor), round(lon * factor)
        for delta in (ilat - prev_lat, ilon - prev_lon):
            value = ~(delta << 1) if delta < 0 else (delta << 1)
            while value >= 0x20:
                out.append(chr((0x20 | (value & 0x1f)) + 63))
                value >>= 5
            out.append(chr(value + 63))
        prev_lat, prev_lon = ilat, ilon
    return "".join(out)


def _perp_dist(pt: list, start: list, end: list) -> float:
    """Perpendicular distance of pt from the start-end segment, in degrees."""
    (y0, x0), (y1, x1), (y2, x2) = pt, start, end
    dy, dx = y2 - y1, x2 - x1
    if dy == 0 and dx == 0:
        return ((y0 - y1) ** 2 + (x0 - x1) ** 2) ** 0.5
    # |cross product| / |segment|
    return abs(dx * (y1 - y0) - dy * (x1 - x0)) / ((dx * dx + dy * dy) ** 0.5)


def simplify(points: list, tolerance: float = SIMPLIFY_DEG) -> list:
    """Iterative Douglas-Peucker — recursion would blow the stack on long routes."""
    if len(points) < 3:
        return list(points)

    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        worst_dist, worst = 0.0, None
        for i in range(first + 1, last):
            dist = _perp_dist(points[i], points[first], points[last])
            if dist > worst_dist:
                worst_dist, worst = dist, i
        if worst is not None and worst_dist > tolerance:
            keep[worst] = True
            stack.append((first, worst))
            stack.append((worst, last))

    return [pt for pt, kept in zip(points, keep) if kept]


def route_rings(geo: dict) -> list:
    """GeoJSON (lon, lat) geometry -> Leaflet (lat, lon) rings."""
    geometry = geo.get("geometry") or {}
    kind = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if kind == "LineString":
        parts = [coords]
    elif kind == "MultiLineString":
        parts = coords
    else:
        return []
    rings = [[[pt[1], pt[0]] for pt in part] for part in parts if part]
    return [encode_polyline(simplify(ring)) for ring in rings]


def bus_summary(entry: dict) -> list:
    """The few nearest stops, each as {name, lines, on_route}."""
    stops = sorted(entry.get("bus_stops") or [], key=lambda s: s.get("dist_m", 99999))
    return [
        {
            "name": stop["name"],
            "lines": stop.get("lines") or [],
            "on_route": stop.get("dist_m", 99999) <= BUS_ON_ROUTE_M,
        }
        for stop in stops[:MAX_BUS_STOPS]
    ]


def build_category(cat: dict) -> tuple:
    """Return (routes list, {slug: rings}) for one category."""
    data_dir, out_dir = cat["data_dir"], cat["out_dir"]
    registry = load_json(os.path.join(data_dir, "registry.json"))["trails"]
    computed = load_json(os.path.join(data_dir, "computed.json"))
    curated_path = os.path.join(data_dir, "curated.json")
    curated = load_json(curated_path).get("trails", []) if os.path.exists(curated_path) else []
    excluded = {t["slug"] for t in curated if t.get("exclude")}

    base_url = cat["base_url"]
    geo_root = os.path.join(out_dir, "geo")

    routes, geometry = [], {}
    for trail in registry:
        slug = trail["slug"]
        entry = computed.get(slug)
        if slug in excluded or not entry:
            continue

        geo_path = os.path.join(geo_root, f"{slug}.geojson")
        if not os.path.exists(geo_path):
            continue
        rings = route_rings(load_json(geo_path))
        if not rings:
            continue

        length_km = entry.get("length_km") or 0
        gain = entry.get("elev_gain") or 0
        geometry[slug] = rings
        routes.append({
            "slug": slug,
            "cat": cat["key"],
            "name": trail["name"],
            "place": trail.get("place") or "",
            "region": entry.get("region") or "center",
            "km": length_km,
            "gain": gain,
            "duration": duration_label(length_km, gain, cat["speed_kmh"], cat["climb_m_per_h"]),
            "difficulty": auto_difficulty(length_km, gain, cat["difficulty"]),
            "natural": entry.get("natural_pct") or 0,
            "center": entry.get("center"),
            "bbox": entry.get("bbox"),
            "bus": bus_summary(entry),
            "pois": [p["name"] for p in (entry.get("pois") or [])[:3]],
            "photo": (entry.get("images") or [{}])[0].get("src"),
            # Language is chosen in the browser, so links point at the DE page and
            # map.js rewrites /de/ to the active language.
            "url": f"{base_url}/de/{slug}.html",
            "gpx": f"{base_url}/gpx/{slug}.gpx",
        })

    return routes, geometry


def write_json(path: str, payload) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  {os.path.relpath(path, REPO)}  {os.path.getsize(path) // 1024} KB")


def main() -> None:
    all_routes = []
    print("Building map data ...")
    for key in ("hiking", "mtb"):
        routes, geometry = build_category(CATEGORIES[key])
        all_routes.extend(routes)
        write_json(os.path.join(OUT_DIR, f"geo-{key}.json"), geometry)
        print(f"  {key}: {len(routes)} routes")

    write_json(os.path.join(OUT_DIR, "routes.json"), {
        "generated": datetime.datetime.now(datetime.timezone.utc)
                             .replace(microsecond=0).isoformat(),
        "routes": sorted(all_routes, key=lambda r: (r["cat"], r["name"])),
    })
    print(f"Total: {len(all_routes)} routes")


if __name__ == "__main__":
    main()
