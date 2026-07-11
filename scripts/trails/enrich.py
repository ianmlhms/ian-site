#!/usr/bin/env python3
"""Enrich computed.json with elevation, nearby POIs and real Commons photos.

For every trail in data/trails/registry.json (needs fetch_trails.py output):

  elevation — samples the route at ~100 points, queries opentopodata.org
              (EU-DEM 25 m), stores smoothed profile [[km, m], ...] plus
              elev_min / elev_max / elev_gain
  pois      — named castles/ruins/waterfalls/viewpoints/museums/reserves
              within POI_NEAR_M of the route (from data/trails/pois.json)
  images    — geolocated Wikimedia Commons photos taken near the route,
              CC-licensed only, stored with attribution (artist + license +
              file page) so build.py can render a credited gallery

Already-enriched trails are skipped unless --force is given, so the script
is resumable (elevation API is rate-limited to 1 req/s).

Usage:
    python3 scripts/trails/enrich.py [--force] [slug ...]
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(REPO, "data", "trails")
GEO_DIR = os.path.join(DATA_DIR, "geo")
REGISTRY_JSON = os.path.join(DATA_DIR, "registry.json")
COMPUTED_JSON = os.path.join(DATA_DIR, "computed.json")
POIS_JSON = os.path.join(DATA_DIR, "pois.json")

USER_AGENT = "ian.lu-trails/1.0 (https://ian.lu; konto@ian.lu)"
ELEVATION_URL = "https://api.opentopodata.org/v1/eudem25m"
COMMONS_URL = "https://commons.wikimedia.org/w/api.php"
ELEV_SAMPLES = 100
ELEV_SMOOTH = 5
POI_NEAR_M = 400
MAX_POIS = 5
IMAGE_RADIUS_M = 1500
MAX_IMAGES = 3
MIN_IMAGE_WIDTH = 800
LICENSE_OK = re.compile(r"^(cc0|cc[ -]by|public domain|pd)", re.IGNORECASE)
TITLE_BAD = re.compile(r"map|karte|plan|wappen|coat|logo|diagram|panneau|schild", re.IGNORECASE)
EARTH_R = 6371000.0


def haversine_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


def load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def http_json(url: str, data: bytes = None, headers: dict = None) -> dict:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


# --- route line --------------------------------------------------------------

def route_points(slug: str) -> list:
    """Walking-ordered (lat, lon, cum_km) from the chained geojson."""
    geo = load_json(os.path.join(GEO_DIR, f"{slug}.geojson"))
    points, cum = [], 0.0
    for seg in geo["geometry"]["coordinates"]:
        for lon, lat in seg:
            if points:
                cum += haversine_m(points[-1][0], points[-1][1], lat, lon) / 1000
            points.append((lat, lon, round(cum, 3)))
    return points


def resample(points: list, count: int) -> list:
    if len(points) <= count:
        return points
    total = points[-1][2]
    targets = [total * i / (count - 1) for i in range(count)]
    out, j = [], 0
    for target in targets:
        while j < len(points) - 1 and points[j][2] < target:
            j += 1
        out.append(points[j])
    return out


# --- elevation ---------------------------------------------------------------

def fetch_elevation(samples: list) -> list:
    locations = "|".join(f"{lat:.5f},{lon:.5f}" for lat, lon, _ in samples)
    body = json.dumps({"locations": locations}).encode()
    data = http_json(ELEVATION_URL, data=body, headers={"Content-Type": "application/json"})
    if data.get("status") != "OK":
        raise RuntimeError(f"opentopodata: {data.get('status')} {data.get('error', '')}")
    return [r.get("elevation") for r in data.get("results", [])]


def smooth(values: list, window: int) -> list:
    half = window // 2
    out = []
    for i in range(len(values)):
        chunk = [v for v in values[max(0, i - half):i + half + 1] if v is not None]
        out.append(sum(chunk) / len(chunk) if chunk else None)
    return out


def elevation_entry(samples: list) -> dict:
    raw = fetch_elevation(samples)
    values = smooth(raw, ELEV_SMOOTH)
    pairs = [(s[2], v) for s, v in zip(samples, values) if v is not None]
    if len(pairs) < 2:
        return {}
    elevations = [v for _, v in pairs]
    gain = sum(max(0.0, b - a) for a, b in zip(elevations, elevations[1:]))
    return {
        "elev_min": int(min(elevations)),
        "elev_max": int(max(elevations)),
        "elev_gain": int(round(gain / 10) * 10),
        "profile": [[round(km, 2), int(m)] for km, m in pairs],
    }


# --- POIs ---------------------------------------------------------------------

def match_pois(points: list, pois: list, bbox: list) -> list:
    pad = 0.01
    nearby = [p for p in pois
              if bbox[0] - pad <= p["lat"] <= bbox[2] + pad and bbox[1] - pad <= p["lon"] <= bbox[3] + pad]
    coarse = points[::3]
    found = []
    for poi in nearby:
        dist = min(haversine_m(poi["lat"], poi["lon"], lat, lon) for lat, lon, _ in coarse)
        if dist <= POI_NEAR_M:
            found.append({**poi, "dist_m": int(dist)})
    found.sort(key=lambda p: p["dist_m"])
    unique, seen = [], set()
    for poi in found:
        if poi["name"] in seen:
            continue
        seen.add(poi["name"])
        unique.append({"name": poi["name"], "kind": poi["kind"], "dist_m": poi["dist_m"]})
    return unique[:MAX_POIS]


# --- Commons images -----------------------------------------------------------

def strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def commons_search(lat: float, lon: float) -> list:
    params = urllib.parse.urlencode({
        "action": "query", "format": "json", "formatversion": "2",
        "generator": "geosearch", "ggscoord": f"{lat}|{lon}",
        "ggsradius": IMAGE_RADIUS_M, "ggslimit": 25, "ggsnamespace": 6,
        "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata", "iiurlwidth": 900,
    })
    data = http_json(f"{COMMONS_URL}?{params}")
    return data.get("query", {}).get("pages", [])


def pick_images(points: list) -> list:
    total = points[-1][2] if points else 0
    anchors = [points[0]] if points else []
    if total and len(points) > 2:
        mid = min(points, key=lambda p: abs(p[2] - total / 2))
        anchors.append(mid)
    picked, seen = [], set()
    for lat, lon, _ in anchors:
        try:
            pages = commons_search(lat, lon)
        except Exception as err:
            print(f"    ! commons: {err}", file=sys.stderr)
            continue
        for page in pages:
            infos = page.get("imageinfo") or []
            if not infos:
                continue
            info = infos[0]
            title = page.get("title", "")
            meta = info.get("extmetadata", {})
            license_name = meta.get("LicenseShortName", {}).get("value", "")
            if (info.get("mime") != "image/jpeg" or info.get("width", 0) < MIN_IMAGE_WIDTH
                    or TITLE_BAD.search(title) or not LICENSE_OK.match(license_name)
                    or title in seen):
                continue
            seen.add(title)
            picked.append({
                "src": info.get("thumburl") or info.get("url"),
                "page": info.get("descriptionshorturl") or info.get("descriptionurl"),
                "artist": strip_html(meta.get("Artist", {}).get("value", ""))[:80] or "Wikimedia Commons",
                "license": license_name,
            })
            if len(picked) >= MAX_IMAGES:
                return picked
        time.sleep(0.3)
    return picked


# --- main ----------------------------------------------------------------------

def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--force"]
    force = "--force" in sys.argv
    registry = load_json(REGISTRY_JSON)["trails"]
    if args:
        registry = [t for t in registry if t["slug"] in set(args)]
    computed = load_json(COMPUTED_JSON)
    pois = load_json(POIS_JSON) if os.path.exists(POIS_JSON) else []

    updated = dict(computed)
    done = 0
    for trail in registry:
        slug = trail["slug"]
        entry = computed.get(slug)
        if not entry:
            print(f"  ! {slug}: not in computed.json — run fetch_trails.py first", file=sys.stderr)
            continue
        if not force and all(k in entry for k in ("elev_gain", "pois", "images")):
            continue
        points = route_points(slug)
        additions = {}
        if force or "elev_gain" not in entry:
            try:
                additions.update(elevation_entry(resample(points, ELEV_SAMPLES)))
            except Exception as err:
                print(f"    ! {slug} elevation: {err}", file=sys.stderr)
            time.sleep(1.1)  # opentopodata public rate limit
        if force or "pois" not in entry:
            additions["pois"] = match_pois(points, pois, entry["bbox"])
        if force or "images" not in entry:
            additions["images"] = pick_images(points)
        updated = {**updated, slug: {**entry, **additions}}
        done += 1
        print(f"  ✓ {slug}: +{additions.get('elev_gain', entry.get('elev_gain', '?'))} m, "
              f"{len(updated[slug].get('pois', []))} POIs, {len(updated[slug].get('images', []))} photos")
        if done % 10 == 0:
            with open(COMPUTED_JSON, "w", encoding="utf-8") as f:
                json.dump(updated, f, ensure_ascii=False, indent=1, sort_keys=True)

    with open(COMPUTED_JSON, "w", encoding="utf-8") as f:
        json.dump(updated, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(f"Enriched {done} trails → {COMPUTED_JSON}")


if __name__ == "__main__":
    main()
