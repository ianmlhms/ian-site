#!/usr/bin/env python3
"""Fetch every named point of interest in Luxembourg that trails can pass.

One country-wide Overpass query (cheap, ~a few thousand elements) written to
data/trails/pois.json as [{ "name", "kind", "lat", "lon" }]. enrich.py then
matches POIs to trails locally by distance — no per-trail API calls.

Kinds, in the priority order the composer uses:
  castle ruins waterfall viewpoint museum nature_reserve

Usage: python3 scripts/trails/fetch_pois.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
POIS_JSON = os.path.join(REPO, "data", "trails", "pois.json")

OVERPASS_MIRRORS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
USER_AGENT = "ian.lu-trails/1.0 (https://ian.lu)"

QUERY = """
[out:json][timeout:180];
area["ISO3166-1"="LU"][admin_level=2]->.lu;
(
  nwr["historic"~"^(castle|ruins|fort)$"]["name"](area.lu);
  nwr["tourism"~"^(viewpoint|museum)$"]["name"](area.lu);
  nwr["waterway"="waterfall"]["name"](area.lu);
  nwr["leisure"="nature_reserve"]["name"](area.lu);
);
out center tags;
"""

KIND_OF = [
    ("historic", {"castle": "castle", "fort": "castle", "ruins": "ruins"}),
    ("waterway", {"waterfall": "waterfall"}),
    ("tourism", {"viewpoint": "viewpoint", "museum": "museum"}),
    ("leisure", {"nature_reserve": "nature_reserve"}),
]


def element_kind(tags: dict) -> str:
    for key, mapping in KIND_OF:
        kind = mapping.get(tags.get(key, ""))
        if kind:
            return kind
    return ""


def element_coords(el: dict):
    if "lat" in el and "lon" in el:
        return el["lat"], el["lon"]
    center = el.get("center") or {}
    if "lat" in center and "lon" in center:
        return center["lat"], center["lon"]
    return None


def main() -> None:
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    data = None
    for url in OVERPASS_MIRRORS:
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=200) as r:
                data = json.load(r)
            break
        except Exception as err:
            print(f"  ! {url} failed: {err}", file=sys.stderr)
    if data is None:
        raise SystemExit("All Overpass mirrors failed.")

    pois, seen = [], set()
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        kind = element_kind(tags)
        coords = element_coords(el)
        name = tags.get("name", "").strip()
        if not kind or not coords or not name:
            continue
        key = (name, kind)
        if key in seen:
            continue
        seen.add(key)
        pois.append({"name": name, "kind": kind,
                     "lat": round(coords[0], 5), "lon": round(coords[1], 5)})

    with open(POIS_JSON, "w", encoding="utf-8") as f:
        json.dump(pois, f, ensure_ascii=False, indent=0)
    counts = {}
    for p in pois:
        counts[p["kind"]] = counts.get(p["kind"], 0) + 1
    print(f"{len(pois)} POIs → {POIS_JSON}  {counts}")


if __name__ == "__main__":
    main()
