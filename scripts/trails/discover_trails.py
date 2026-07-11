#!/usr/bin/env python3
"""Auto-discover every Auto-Pédestre route relation in Luxembourg from OSM.

Writes data/trails/registry.json — the machine-generated trail list that
fetch_trails.py / build.py run from:

  { "trails": [ { "slug", "osm_rel", "name", "place" }, ... ] }

Matching rule: relation name starts with "Auto-Pédestre" / "Auto Pédestre" /
"Autopédestre" / "Autopedestre" (case-insensitive). "Old Auto-Pédestre ..."
relations are decommissioned routes and are skipped.

Slugs are stable: if data/trails/curated.json already contains an entry for
the same osm_rel, its slug (and place/region overrides) win, so live URLs
never change once published.

Usage:
    python3 scripts/trails/discover_trails.py [cached_overpass_tags.json]

The optional argument is a cached Overpass response (out tags) to avoid
re-querying while iterating.
"""
from __future__ import annotations

import json
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(REPO, "data", "trails")
REGISTRY_JSON = os.path.join(DATA_DIR, "registry.json")
CURATED_JSON = os.path.join(DATA_DIR, "curated.json")

OVERPASS_MIRRORS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
USER_AGENT = "ian.lu-trails/1.0 (https://ian.lu)"
NAME_RE = re.compile(r"^auto[ -]?p[ée]destre\b", re.IGNORECASE)

QUERY = """
[out:json][timeout:180];
area["ISO3166-1"="LU"][admin_level=2]->.lu;
relation["route"="hiking"](area.lu);
out tags;
"""


def load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def overpass_tags() -> dict:
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    last_err: Exception = RuntimeError("no mirror configured")
    for url in OVERPASS_MIRRORS:
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=200) as r:
                return json.load(r)
        except Exception as err:
            print(f"  ! {url} failed: {err}", file=sys.stderr)
            last_err = err
    raise SystemExit(f"All Overpass mirrors failed: {last_err}")


def slugify(name: str) -> str:
    stripped = re.sub(NAME_RE, "", name).strip(" -–")
    ascii_name = unicodedata.normalize("NFKD", stripped).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")
    return slug or "trail"


def extract_place(name: str) -> str:
    """'Auto-Pédestre Leudelange-Gare (anc.Roedgen)' -> 'Leudelange-Gare'."""
    place = re.sub(NAME_RE, "", name).strip(" -–")
    place = place.split("(")[0].split("/")[0]
    place = re.sub(r"\b(?:[0-9]+|I{1,3}|IV|V)\s*$", "", place.strip())
    return place.strip(" -–") or place


def main() -> None:
    if len(sys.argv) > 1:
        print(f"Using cached Overpass response: {sys.argv[1]}")
        data = load_json(sys.argv[1])
    else:
        print("Querying Overpass for all hiking relations in Luxembourg ...")
        data = overpass_tags()

    curated = load_json(CURATED_JSON).get("trails", []) if os.path.exists(CURATED_JSON) else []
    slug_by_rel = {t["osm_rel"]: t["slug"] for t in curated if "osm_rel" in t and "slug" in t}

    matches = []
    for el in data.get("elements", []):
        name = el.get("tags", {}).get("name", "")
        if NAME_RE.match(name):
            matches.append((name, el["id"]))
    matches.sort()

    trails, used = [], set()
    for name, rel_id in matches:
        slug = slug_by_rel.get(rel_id) or slugify(name)
        base, n = slug, 2
        while slug in used:
            slug, n = f"{base}-{n}", n + 1
        used.add(slug)
        trails.append({"slug": slug, "osm_rel": rel_id, "name": name, "place": extract_place(name)})

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(REGISTRY_JSON, "w", encoding="utf-8") as f:
        json.dump({"trails": trails}, f, ensure_ascii=False, indent=1)
    print(f"Registry: {len(trails)} Auto-Pédestres → {REGISTRY_JSON}")


if __name__ == "__main__":
    main()
