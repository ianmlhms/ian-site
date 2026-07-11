#!/usr/bin/env python3
"""Auto-discover every route relation of a category in Luxembourg from OSM.

Writes <data_dir>/registry.json — the machine-generated trail list that
fetch_trails.py / build.py run from:

  { "trails": [ { "slug", "osm_rel", "name", "place" }, ... ] }

Categories (see config.py):
  hiking — relations named "Auto-Pédestre …" ("Old Auto-Pédestre" = skipped)
  mtb    — every named route=mtb relation

Slugs are stable: if <data_dir>/curated.json already contains an entry for
the same osm_rel, its slug (and place/region overrides) win, so live URLs
never change once published.

Usage:
    python3 scripts/trails/discover_trails.py [--cat mtb] [cached_tags.json]
"""
from __future__ import annotations

import json
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import pick_category  # noqa: E402

OVERPASS_MIRRORS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
USER_AGENT = "ian.lu-trails/1.0 (https://ian.lu)"

QUERY_TMPL = """
[out:json][timeout:180];
area["ISO3166-1"="LU"][admin_level=2]->.lu;
(
{members}
);
out tags;
"""


def load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def overpass_tags(members: str) -> dict:
    query = QUERY_TMPL.format(members=members)
    body = urllib.parse.urlencode({"data": query}).encode()
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


def slugify(name: str, strip_re: re.Pattern) -> str:
    stripped = strip_re.sub("", name.strip(), count=1).strip(" -–")
    ascii_name = unicodedata.normalize("NFKD", stripped).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")
    # "1-steinsel" (from "MTB 1 (Steinsel)") reads better as "steinsel-1"
    m = re.match(r"^(\d+)-(.+)$", slug)
    if m:
        slug = f"{m.group(2)}-{m.group(1)}"
    return slug or "trail"


def extract_place(name: str, strip_re: re.Pattern) -> str:
    """'MTB 1 (Steinsel)' -> 'Steinsel'; 'Auto-Pédestre Eischen II' -> 'Eischen'."""
    place = strip_re.sub("", name.strip(), count=1).strip(" -–:")
    paren = re.search(r"\(([^)]+)\)", place)
    before = place.split("(")[0].strip(" -–")
    if paren and (not before or re.fullmatch(r"[0-9IVX ]+", before)):
        place = paren.group(1)
    else:
        place = before or place
    place = place.split("/")[0]
    place = re.sub(r"\b(?:[0-9]+[a-z]?|I{1,3}|IV|V)\s*$", "", place.strip())
    return place.strip(" -–") or name


def main() -> None:
    cat, args = pick_category(sys.argv[1:])
    include_re = re.compile(cat["name_include"], re.IGNORECASE)
    strip_re = re.compile(cat["name_strip"], re.IGNORECASE)
    registry_path = os.path.join(cat["data_dir"], "registry.json")
    curated_path = os.path.join(cat["data_dir"], "curated.json")

    if args:
        print(f"Using cached Overpass response: {args[0]}")
        data = load_json(args[0])
    else:
        print(f"Querying Overpass for {cat['key']} relations in Luxembourg ...")
        data = overpass_tags(cat["overpass_members"])

    curated = load_json(curated_path).get("trails", []) if os.path.exists(curated_path) else []
    slug_by_rel = {t["osm_rel"]: t["slug"] for t in curated if "osm_rel" in t and "slug" in t}

    matches = []
    for el in data.get("elements", []):
        name = el.get("tags", {}).get("name", "")
        if name and include_re.match(name):
            matches.append((name, el["id"]))
    matches.sort()

    trails, used = [], set()
    for name, rel_id in matches:
        slug = slug_by_rel.get(rel_id) or slugify(name, strip_re)
        base, n = slug, 2
        while slug in used:
            slug, n = f"{base}-{n}", n + 1
        used.add(slug)
        trails.append({"slug": slug, "osm_rel": rel_id, "name": name,
                       "place": extract_place(name, strip_re)})

    os.makedirs(cat["data_dir"], exist_ok=True)
    with open(registry_path, "w", encoding="utf-8") as f:
        json.dump({"trails": trails}, f, ensure_ascii=False, indent=1)
    print(f"Registry ({cat['key']}): {len(trails)} routes → {registry_path}")


if __name__ == "__main__":
    main()
