#!/usr/bin/env python3
"""Reconcile the trail registry with Luxembourg's official Auto-Pédestre list.

The ministry cut the network from 201 circuits to 154; OpenStreetMap still
carries relations for routes that no longer exist, and has never had relations
for dozens that do. So OSM alone can neither tell us which circuits are real
nor supply the missing ones. Geoportail's CC0 layer is the authority on both.

Reads <data_dir>/registry.json and <data_dir>/computed.json, then writes:

  <data_dir>/official.geojson      : cached raw Geoportail download (gitignored)
  <data_dir>/geo/<slug>.geojson    : route lines for official-only circuits
  <data_dir>/computed.json         : length, center, bbox, region, bus stops
  <data_dir>/registry.json         : every circuit, each one either
                                     backed by OSM, official-only, or retired

Every official circuit is matched against the published routes by **overlap**
(route_match.py), never by name — the official list says "Schwebsingen" where
the site says "schwebsange", and "Roodt/Syre" where it says "roodt-sur-syre".
A circuit that matches a published route keeps that route's slug, geometry and
enrichment, so live URLs never change. A published route that matches no
official circuit is marked `"retired": true`; build.py then skips it and
deletes the pages it left behind.

Usage:
    python3 scripts/trails/fetch_official.py [--cat hiking] [--refresh]
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
import unicodedata
import urllib.request
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import pick_category  # noqa: E402
from discover_trails import slugify  # noqa: E402
from route_match import overlap, shape_of  # noqa: E402
from fetch_trails import (  # noqa: E402
    LINES_JSON,
    SIMPLIFY_EPS_DEG,
    STOPS_JSON,
    bbox_of,
    build_line_index,
    classify_region,
    haversine_m,
    length_km,
    nearest_stops,
    rdp,
    sample_points,
)

OFFICIAL_URL = "https://data.geoportail.lu/mymaps?category=11&format=geojson"
USER_AGENT = "ian.lu-trails/1.0 (https://ian.lu)"
SOURCE = "geoportail"
# A pair scoring at least SURE_OVERLAP is the same circuit whatever it is
# called. Between LIKELY_OVERLAP and SURE_OVERLAP the routes differ enough that
# the place names have to agree too — that is what separates a rerouted loop
# (boulaide-1 / Boulaide, 66%) from two neighbouring ones (oetrange / Moutfort,
# 47%, which centre-and-length matching wrongly called a match).
SURE_OVERLAP = 0.75
LIKELY_OVERLAP = 0.55
# The layer held 154 circuits in Sep 2026. Far fewer means a truncated download
# rather than a shrunken network, and acting on it would retire real trails.
MIN_CIRCUITS = 120
ALLOWED_GEOMETRIES = {"LineString", "Point", "Polygon"}
LUX_LON_RANGE = (5.6, 6.7)
LUX_LAT_RANGE = (49.4, 50.3)
BERDORF_EXPECTED_CENTER = (49.82, 6.35)
BERDORF_MAX_ERROR_M = 5000
PREFIX_RE = re.compile(r"^auto-?p[ée]destres?\s*:?\s*", re.IGNORECASE)
# "< >" is an artefact of the Geoportail export and is not always trailing:
# "Autopedestres : Lieler < > (ex Weiswampach 1)" carries it mid-name, which
# shipped verbatim into that page's <title> and <h1>.
MARKER_RE = re.compile(r"\s*<\s*>\s*")
# Editorial notes about what a circuit used to be called. Useful provenance,
# but not part of the walk's name, and they make an unreadable slug.
ASIDE_RE = re.compile(r"\s*\((?:ex|anc\.?|ancien|ancienne)\b[^)]*\)", re.IGNORECASE)
NO_PREFIX_RE = re.compile(r"(?!)")


def load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def validate_position(value, context: str) -> list:
    if not isinstance(value, list) or len(value) < 2:
        raise ValueError(f"{context}: expected a [longitude, latitude] position")
    lon, lat = value[:2]
    if (not isinstance(lon, (int, float)) or isinstance(lon, bool)
            or not isinstance(lat, (int, float)) or isinstance(lat, bool)
            or not math.isfinite(lon) or not math.isfinite(lat)):
        raise ValueError(f"{context}: longitude and latitude must be finite numbers")
    if not (LUX_LON_RANGE[0] <= lon <= LUX_LON_RANGE[1]
            and LUX_LAT_RANGE[0] <= lat <= LUX_LAT_RANGE[1]):
        raise ValueError(
            f"{context}: coordinate [{lon}, {lat}] is not lon,lat in Luxembourg"
        )
    return [float(lon), float(lat)]


def validate_geojson(data) -> list:
    if not isinstance(data, dict) or data.get("type") != "FeatureCollection":
        raise ValueError("root: expected a GeoJSON FeatureCollection")
    features = data.get("features")
    if not isinstance(features, list):
        raise ValueError("root.features: expected a list")

    # One circuit can be drawn as several line features — the Geoportail layer
    # splits one of them in two — so group by the map they belong to rather
    # than treating every feature as its own circuit.
    by_map: dict = {}
    for index, feature in enumerate(features):
        context = f"feature {index}"
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            raise ValueError(f"{context}: expected a GeoJSON Feature")
        geometry = feature.get("geometry")
        properties = feature.get("properties")
        if not isinstance(geometry, dict) or not isinstance(properties, dict):
            raise ValueError(f"{context}: missing geometry or properties object")
        kind = geometry.get("type")
        if kind not in ALLOWED_GEOMETRIES:
            raise ValueError(f"{context}: unexpected geometry type {kind!r}")
        coordinates = geometry.get("coordinates")
        if kind == "Point":
            validate_position(coordinates, context)
            continue
        if kind == "Polygon":
            if not isinstance(coordinates, list) or not coordinates:
                raise ValueError(f"{context}: polygon has no rings")
            for ring_index, ring in enumerate(coordinates):
                if not isinstance(ring, list) or len(ring) < 4:
                    raise ValueError(f"{context}: polygon ring {ring_index} is malformed")
                for point_index, point in enumerate(ring):
                    validate_position(point, f"{context}, ring {ring_index}, point {point_index}")
            continue
        if not isinstance(coordinates, list) or len(coordinates) < 2:
            raise ValueError(f"{context}: LineString needs at least two positions")
        name = properties.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"{context}: LineString has no name")
        points = [validate_position(point, f"{context}, point {point_index}")
                  for point_index, point in enumerate(coordinates)]
        map_id = properties.get("map_id")
        if not isinstance(map_id, str) or not map_id:
            raise ValueError(f"{context}: LineString has no map_id to group by")
        circuit = by_map.get(map_id, {"map_id": map_id, "raw_name": name, "lines": []})
        by_map = {**by_map, map_id: {**circuit, "lines": circuit["lines"] + [points]}}

    circuits = list(by_map.values())
    if len(circuits) < MIN_CIRCUITS:
        raise ValueError(
            f"only {len(circuits)} circuits in the download, expected at least "
            f"{MIN_CIRCUITS} — refusing to act on what looks like a partial response"
        )
    return circuits


def read_official(cache_path: str, refresh: bool) -> list:
    if os.path.exists(cache_path) and not refresh:
        print(f"Using cached Geoportail response: {cache_path}")
        try:
            data = load_json(cache_path)
        except (OSError, json.JSONDecodeError) as err:
            raise SystemExit(f"Cannot read cached GeoJSON {cache_path}: {err}") from err
    else:
        print("Downloading official Auto-Pedestre circuits from Geoportail ...")
        try:
            request = urllib.request.Request(OFFICIAL_URL, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=180) as response:
                raw = response.read()
            data = json.loads(raw)
        except (OSError, json.JSONDecodeError) as err:
            raise SystemExit(f"Official GeoJSON download failed: {err}") from err
        try:
            validate_geojson(data)
        except ValueError as err:
            raise SystemExit(f"Official GeoJSON validation failed: {err}") from err
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        with open(cache_path, "wb") as f:
            f.write(raw)
        print(f"Cached {len(raw):,} bytes → {cache_path}")

    try:
        return validate_geojson(data)
    except ValueError as err:
        raise SystemExit(f"Official GeoJSON validation failed: {err}") from err


def clean_place(raw_name: str) -> str:
    """'Autopedestres : Berdorf < >' → 'Berdorf'.

    The prefix is optional because the layer is not consistent: 153 circuits
    carry one ("Autopedestres :" or "Auto-Pédestre"), Oberpallen carries none.
    """
    place = PREFIX_RE.sub("", raw_name.strip(), count=1)
    place = ASIDE_RE.sub("", MARKER_RE.sub(" ", place)).strip(" -–:")
    place = re.sub(r"\s{2,}", " ", place)
    if not place:
        raise ValueError(f"empty place after cleaning {raw_name!r}")
    return place


def circuit_facts(lines: list, stops: list, line_index: dict) -> tuple:
    """Machine facts and a simplified route line for one official circuit.

    `natural_pct` is deliberately absent: the share of a route on paths and
    tracks comes from OSM way tags, and this layer has none. Composing a number
    we cannot measure would be worse than the sentence composer.py drops.
    """
    segments = [(coords, False) for coords in lines]
    bbox = bbox_of(segments)
    center = [round((bbox[0] + bbox[2]) / 2, 5), round((bbox[1] + bbox[3]) / 2, 5)]
    entry = {
        "length_km": length_km(segments),
        "center": center,
        "bbox": bbox,
        "region": classify_region(center[0], center[1]),
        "bus_stops": nearest_stops(sample_points(segments), stops, line_index),
        "source": SOURCE,
    }
    simplified = [[[round(lon, 5), round(lat, 5)] for lon, lat in rdp(coords, SIMPLIFY_EPS_DEG)]
                  for coords in lines]
    return entry, simplified


def name_tokens(place: str) -> set:
    """Fold a place name to comparable words: 'Rumelange - Gare' → {rumelange, gare}."""
    ascii_name = unicodedata.normalize("NFKD", place).encode("ascii", "ignore").decode()
    return {word for word in re.split(r"[^a-z0-9]+", ascii_name.lower()) if len(word) > 2}


def is_same_circuit(score: float, official_place: str, published_place: str) -> bool:
    if score >= SURE_OVERLAP:
        return True
    if score < LIKELY_OVERLAP:
        return False
    return bool(name_tokens(official_place) & name_tokens(published_place))


def assign(circuits: list, published: list) -> dict:
    """Greedy best-first pairing of official circuits to published trails.

    Best-first rather than first-come because two published trails can both
    overlap one circuit (nospelt and nospelt-2 do); the better fit should win
    it, and the loser should fall through to retirement rather than to an
    arbitrary second circuit.
    """
    pairs = []
    for circuit in circuits:
        for trail in published:
            score = overlap(circuit["shape"], trail["shape"])
            if is_same_circuit(score, circuit["place"], trail["place"]):
                pairs.append((score, circuit["map_id"], trail["slug"]))
    pairs.sort(reverse=True)

    taken_circuits: set = set()
    taken_slugs: set = set()
    matched: dict = {}
    for score, map_id, slug in pairs:
        if map_id in taken_circuits or slug in taken_slugs:
            continue
        taken_circuits.add(map_id)
        taken_slugs.add(slug)
        matched = {**matched, map_id: (slug, score)}
    return matched


def load_published(registry: list, computed: dict, geo_dir: str) -> list:
    """Every trail that currently has a page, with its route shape loaded."""
    published = []
    for trail in registry:
        path = os.path.join(geo_dir, f"{trail['slug']}.geojson")
        if not os.path.exists(path):
            print(f"  ! {trail['slug']}: no geometry on disk — treated as unpublished",
                  file=sys.stderr)
            continue
        geometry = load_json(path).get("geometry", {})
        coordinates = geometry.get("coordinates") or []
        lines = coordinates if geometry.get("type") == "MultiLineString" else [coordinates]
        try:
            shape = shape_of(lines)
        except ValueError as err:
            print(f"  ! {trail['slug']}: {err} — treated as unpublished", file=sys.stderr)
            continue
        published.append({
            "slug": trail["slug"],
            "place": trail.get("place") or trail["slug"],
            "shape": shape,
            "length_km": computed.get(trail["slug"], {}).get("length_km"),
        })
    return published


def available_slug(place: str, used: set) -> str:
    base = slugify(place, NO_PREFIX_RE)
    slug, number = base, 2
    while slug in used:
        slug, number = f"{base}-{number}", number + 1
    return slug


def resolve_name_clashes(trails: list, official_place: dict) -> list:
    """No two published trails may carry the same title.

    OSM and Geoportail disagree about which village some loops belong to: the
    route OSM calls "Auto-Pédestre Wormeldange" is Geoportail's Ahn circuit,
    and Geoportail has a different loop of its own at Wormeldange. Keeping both
    OSM names would publish two pages under one name. The official name wins
    those, since it is the list being reconciled against — the slug, and so the
    live URL, stays as it was.
    """
    clashing = {name for name, count in Counter(t["name"] for t in trails).items() if count > 1}
    resolved = []
    for trail in trails:
        place = official_place.get(trail["slug"])
        if trail["name"] in clashing and place:
            print(f"  ~ {trail['slug']}: renamed to Auto-Pédestre {place} "
                  f"(was {trail['name']}, which another circuit also claims)")
            resolved.append({**trail, "name": f"Auto-Pédestre {place}", "place": place})
            continue
        resolved.append(trail)
    return resolved


def write_json(path: str, value, *, compact: bool = False, sort_keys: bool = True) -> None:
    with open(path, "w", encoding="utf-8") as f:
        if compact:
            json.dump(value, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(value, f, ensure_ascii=False, indent=1, sort_keys=sort_keys)


def check_berdorf(circuits: list) -> None:
    """Berdorf is the circuit that started all this, and it doubles as a
    coordinate-order check: read lat,lon as lon,lat and the centre lands in
    the North Sea, so a silent axis swap cannot reach the published pages."""
    for circuit in circuits:
        if circuit["place"] != "Berdorf":
            continue
        center = circuit["shape"]["center"]
        error = haversine_m(center[0], center[1], *BERDORF_EXPECTED_CENTER)
        if error > BERDORF_MAX_ERROR_M:
            raise SystemExit(
                f"Berdorf sanity check failed: centre {center} is {error / 1000:.0f} km "
                "from Berdorf — the coordinates are probably lat,lon not lon,lat"
            )
        print(f"  ✓ Berdorf found, centre ({center[0]:.3f}, {center[1]:.3f})")
        return
    raise SystemExit("Berdorf sanity check failed: the circuit is not in the download")


def main() -> None:
    cat, args = pick_category(sys.argv[1:])
    refresh = "--refresh" in args
    unknown = [arg for arg in args if arg != "--refresh"]
    if unknown:
        raise SystemExit(f"Unknown arguments: {', '.join(unknown)}")

    data_dir = cat["data_dir"]
    registry_path = os.path.join(data_dir, "registry.json")
    computed_path = os.path.join(data_dir, "computed.json")
    geo_dir = os.path.join(data_dir, "geo")
    raw_circuits = read_official(os.path.join(data_dir, "official.geojson"), refresh)
    registry = load_json(registry_path)["trails"]
    computed = load_json(computed_path) if os.path.exists(computed_path) else {}

    stops = load_json(STOPS_JSON)
    line_index = build_line_index(load_json(LINES_JSON))
    os.makedirs(geo_dir, exist_ok=True)

    circuits = []
    for circuit in raw_circuits:
        entry, simplified = circuit_facts(circuit["lines"], stops, line_index)
        circuits.append({
            "map_id": circuit["map_id"],
            "place": clean_place(circuit["raw_name"]),
            "entry": entry,
            "lines": simplified,
            "shape": shape_of(circuit["lines"]),
        })
    check_berdorf(circuits)

    published = load_published(registry, computed, geo_dir)
    matched = assign(circuits, published)
    print(f"\nMatching {len(circuits)} official circuits against {len(published)} published "
          f"routes ({LIKELY_OVERLAP:.0%} overlap + name, or {SURE_OVERLAP:.0%} overlap alone):")

    kept_slugs = {slug for slug, _ in matched.values()}
    used = {trail["slug"] for trail in registry}
    trails, updated = [], dict(computed)
    by_slug = {trail["slug"]: trail for trail in registry}
    official_place = {}

    for circuit in sorted(circuits, key=lambda c: c["place"]):
        pair = matched.get(circuit["map_id"])
        if pair:
            slug, score = pair
            print(f"  = {circuit['place']:<28} already published as {slug} ({score:.0%} overlap)")
            trails.append({key: value for key, value in by_slug[slug].items() if key != "retired"})
            official_place = {**official_place, slug: circuit["place"]}
            continue
        slug = available_slug(circuit["place"], used)
        used.add(slug)
        # A slug that was already in the registry keeps whatever enrichment it
        # has, minus the one fact this source cannot supply.
        prior = {key: value for key, value in computed.get(slug, {}).items()
                 if key != "natural_pct"}
        updated = {**updated, slug: {**prior, **circuit["entry"]}}
        write_json(
            os.path.join(geo_dir, f"{slug}.geojson"),
            {"type": "Feature",
             "properties": {"name": f"Auto-Pédestre {circuit['place']}", "source": SOURCE},
             "geometry": {"type": "MultiLineString", "coordinates": circuit["lines"]}},
            compact=True,
        )
        trails.append({"slug": slug, "osm_rel": None, "name": f"Auto-Pédestre {circuit['place']}",
                       "place": circuit["place"], "source": SOURCE})
        print(f"  + {circuit['place']:<28} new as {slug} "
              f"({circuit['entry']['length_km']} km, {len(circuit['entry']['bus_stops'])} stops)")

    trails = resolve_name_clashes(trails, official_place)
    retired = [trail for trail in registry if trail["slug"] not in kept_slugs]
    for trail in sorted(retired, key=lambda t: t["slug"]):
        print(f"  - {trail['slug']:<28} matches no official circuit — retired")
        trails.append({**trail, "retired": True})

    write_json(registry_path, {"trails": trails}, sort_keys=False)
    write_json(computed_path, updated)
    live = len(trails) - len(retired)
    print(f"\nOfficial circuits: {len(circuits)} · published now: {live} "
          f"({len(matched)} kept, {live - len(matched)} added) · retired: {len(retired)}")
    if live != len(circuits):
        print("  ! published count does not equal the official count", file=sys.stderr)


if __name__ == "__main__":
    main()
