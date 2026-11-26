#!/usr/bin/env python3
"""Generate the static trail pages at /trails (or /mtb) from the dataset.

Data flow (all under data/trails/ or data/mtb/):
  registry.json  — every circuit, auto-discovered (discover_trails.py)
  computed.json  — machine facts (fetch_trails.py + enrich.py): length, bbox,
                   region, bus stops, elevation profile, POIs, Commons photos
  context.json   — what the route runs through (fetch_context.py): woodland,
                   vineyards, surface, villages, streams, benches, food
  curated.json   — optional per-slug overrides: hand-written texts, region /
                   place / difficulty fixes. Curated text replaces the
                   overview paragraph only; the measured sections stay.
  moved.json     — optional {old_slug: new_slug} for renamed circuits
  geo/*.geojson  — route lines, copied for the Leaflet maps
  affiliate.json — optional gear links; block renders only when filled

Outputs: trails/** or mtb/** (chooser, 4×index, 4×region pages, 4×N route
pages, geo, gpx, css, .htaccess redirects), the category sitemap with
lastmod from git, and the sitemap index (scripts/sitemaps.py).

Usage: python3 scripts/trails/build.py [--cat mtb]
"""
from __future__ import annotations

import html
import json
import math
import os
import shutil
import sys
from string import Template

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from composer import (BUS_ON_ROUTE_M, auto_difficulty, build_facts, compose,  # noqa: E402
                      duration_label, lb_fix_numbers, num, pct)
from config import REPO, pick_category  # noqa: E402
from strings import (DIFFICULTIES, EXTRA, FACT_LABELS, HUB, REGION_ABOUT,  # noqa: E402
                     REGION_IN_SHORT, REGIONS, TITLE_NOUN, TITLE_SUFFIX, UI_BY_CAT)
import sitemaps  # noqa: E402  (scripts/sitemaps.py)

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_DIR = os.path.join(HERE, "templates")

# set per category in main()
CAT: dict = {}
UI: dict = {}
DATA_DIR = OUT_DIR = BASE_URL = ""

LANGS = ("de", "fr", "en", "lb")
TITLE_MAX = 65
GEAR_TITLES = {"de": "Ausrüstung", "fr": "Équipement", "en": "Gear", "lb": "Ausrëschtung"}
AFFILIATE_DISCLOSURE = {
    "de": "Hinweis: Links können Partnerlinks sein.",
    "fr": "Remarque : certains liens peuvent être affiliés.",
    "en": "Note: links may be affiliate links.",
    "lb": "Hiweis: Verschidde Linke kënne Partnerlinke sinn.",
}
PROFILE_W, PROFILE_H, PROFILE_PAD = 600, 130, 14
NEARBY_COUNT = 5
TEXT_CACHE: dict = {}  # (slug, lang) -> composed texts, filled lazily per build
GALLERY_W, GALLERY_H = 960, 720


def esc(text: str) -> str:
    return html.escape(str(text), quote=True)


def load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_template(name: str) -> Template:
    with open(os.path.join(TEMPLATE_DIR, name), encoding="utf-8") as f:
        return Template(f.read())


def merge_trails() -> list:
    """Registry + computed + context + curated overrides → render-ready dicts."""
    registry = load_json(os.path.join(DATA_DIR, "registry.json"))["trails"]
    computed = load_json(os.path.join(DATA_DIR, "computed.json"))
    context_path = os.path.join(DATA_DIR, "context.json")
    context = load_json(context_path) if os.path.exists(context_path) else {}
    curated_list = load_json(os.path.join(DATA_DIR, "curated.json")).get("trails", [])
    curated = {t["slug"]: t for t in curated_list}

    merged = []
    for base in registry:
        slug = base["slug"]
        # Cut from the official network (fetch_official.py). Its pages are
        # deleted by prune_removed() and redirected by write_redirects().
        if base.get("retired"):
            continue
        entry = computed.get(slug)
        if not entry or not os.path.exists(os.path.join(DATA_DIR, "geo", f"{slug}.geojson")):
            print(f"  ! {slug}: missing computed data/geometry, skipped", file=sys.stderr)
            continue
        override = curated.get(slug, {})
        if override.get("exclude"):
            continue
        region = override.get("region") or entry.get("region") or "center"
        if region not in REGIONS:
            raise SystemExit(f"{slug}: unknown region '{region}'")
        difficulty = override.get("difficulty") or auto_difficulty(
            entry["length_km"], entry.get("elev_gain") or 0, CAT["difficulty"])
        if slug not in context:
            print(f"  ! {slug}: no context.json entry (run fetch_context.py), measured sections skipped",
                  file=sys.stderr)
        merged.append({
            "slug": slug,
            "name": override.get("name") or base["name"],
            "place": override.get("commune") or base["place"],
            "region": region,
            "difficulty": difficulty,
            "descriptions": override.get("descriptions"),
            "highlights": override.get("highlights"),
            "entry": entry,
            "ctx": context.get(slug),
        })
    return merged


def duration_of(entry: dict) -> str:
    return duration_label(entry["length_km"], entry.get("elev_gain") or 0, CAT["speed_kmh"], CAT["climb_m_per_h"])


def texts_for(trail: dict, lang: str) -> dict:
    """Composed sections; a curated overview replaces the composed one."""
    key = (trail["slug"], lang)
    if key not in TEXT_CACHE:
        facts = build_facts(trail, trail["entry"], trail["ctx"], trail.get("nearby") or [])
        texts = compose(facts, lang, CAT["key"], duration_of(trail["entry"]))
        if lang == "lb":
            for section in texts["sections"]:
                section["paras"] = [lb_fix_numbers(p) for p in section["paras"]]
        desc = trail["descriptions"] or {}
        hl = trail["highlights"] or {}
        if desc.get(lang):
            texts["sections"][0] = {"key": "overview", "title": "",
                                    "paras": [esc(p) for p in desc[lang]] + texts["sections"][0]["paras"][-1:]}
        if hl.get(lang):
            texts = {**texts, "highlights": [esc(h) for h in hl[lang]]}
        TEXT_CACHE[key] = texts
    return TEXT_CACHE[key]


def fmt_len(length_km: float, lang: str) -> str:
    return f"{length_km:g}".replace(".", "," if lang != "en" else ".")


def alternate_links(path_of) -> str:
    lines = [f'  <link rel="alternate" hreflang="{lang}" href="{path_of(lang)}" />' for lang in LANGS]
    lines.append(f'  <link rel="alternate" hreflang="x-default" href="{BASE_URL}/" />')
    return "\n".join(lines)


def lang_switcher(current: str, href_of) -> str:
    parts = []
    for lang in LANGS:
        cls = ' class="on"' if lang == current else ""
        parts.append(f'<a href="{href_of(lang)}"{cls} data-lang="{lang}">{lang.upper()}</a>')
    return "".join(parts)


def region_file(region: str) -> str:
    return f"region-{region}.html"


def bus_stops_html(stops: list, ui: dict) -> str:
    items = []
    for stop in stops:
        lines = stop.get("lines") or []
        chips = "".join(f'<span class="line-chip">{esc(line)}</span>' for line in lines[:8])
        lines_html = chips if chips else esc(ui["bus_no_lines"])
        items.append(
            "        <li>"
            f'<span class="stop-name">{esc(stop["name"])}</span>'
            f'<span class="stop-meta">{esc(ui["bus_dist"].format(stop["dist_m"]))}</span>'
            f'<span class="stop-lines">{lines_html}</span>'
            "</li>"
        )
    return "\n".join(items)


def gallery_html(images: list, lang: str, alt_base: str = "") -> str:
    if not images:
        return ""
    figures = []
    for i, img in enumerate(images, 1):
        credit = f'{esc(img["artist"])} · {esc(img["license"])} · <a href="{esc(img["page"])}" rel="noopener">{EXTRA[lang]["photo_via"]}</a>'
        # Descriptive alt for image search + accessibility, and an onerror that
        # hides the figure so a rotted Wikimedia hotlink degrades to nothing.
        # width/height reserve the box before the photo arrives (no layout shift).
        alt = esc(f"{alt_base} ({i})" if alt_base else "")
        figures.append(
            f'      <figure><img src="{esc(img["src"])}" alt="{alt}" width="{GALLERY_W}" height="{GALLERY_H}"'
            f' loading="lazy" decoding="async" style="aspect-ratio:4/3;object-fit:cover"'
            f' onerror="this.closest(&#39;figure&#39;).style.display=&#39;none&#39;" />'
            f"<figcaption>{credit}</figcaption></figure>"
        )
    return (
        f'    <section class="gallery">\n      <h2>{EXTRA[lang]["photos_title"]}</h2>\n'
        + "\n".join(figures) + "\n    </section>\n"
    )


def profile_svg(entry: dict, lang: str) -> str:
    profile = entry.get("profile") or []
    if len(profile) < 5:
        return ""
    kms = [p[0] for p in profile]
    ms = [p[1] for p in profile]
    km_max = kms[-1] or 1
    m_min, m_max = min(ms), max(ms)
    span = max(m_max - m_min, 40)
    inner_w = PROFILE_W - 2 * PROFILE_PAD
    inner_h = PROFILE_H - 2 * PROFILE_PAD
    pts = " ".join(
        f"{PROFILE_PAD + km / km_max * inner_w:.1f},{PROFILE_PAD + (1 - (m - m_min) / span) * inner_h:.1f}"
        for km, m in profile
    )
    base = PROFILE_H - PROFILE_PAD
    first_x = PROFILE_PAD
    last_x = PROFILE_PAD + inner_w
    return (
        f'    <figure class="profile"><figcaption>{EXTRA[lang]["profile_title"]} '
        f'({m_min}–{m_max} m)</figcaption>\n'
        f'    <svg viewBox="0 0 {PROFILE_W} {PROFILE_H}" role="img" preserveAspectRatio="none">'
        f'<polygon points="{first_x},{base} {pts} {last_x},{base}" class="p-fill"/>'
        f'<polyline points="{pts}" class="p-line"/></svg></figure>\n'
    )


def gear_html(affiliate: dict, lang: str) -> str:
    items = affiliate.get("gear") or []
    links = "".join(
        f'<li><a href="{esc(item["url"])}" rel="sponsored noopener">{esc(item["label"].get(lang, ""))}</a></li>'
        for item in items
        if item.get("url") and item.get("label", {}).get(lang)
    )
    if not links:
        return ""
    return (
        f'    <section class="gear">\n      <h2>{GEAR_TITLES[lang]}</h2>\n'
        f"      <ul>{links}</ul>\n"
        f'      <p class="map-note">{AFFILIATE_DISCLOSURE[lang]}</p>\n    </section>\n'
    )


def index_url(lang: str) -> str:
    return f"{BASE_URL}/{lang}/"


def trail_jsonld(trail: dict, lang: str, meta_desc: str, canonical: str, ui: dict) -> str:
    entry = trail["entry"]
    region_label = REGIONS[trail["region"]][lang]
    place = {
        "@type": "TouristAttraction",
        "@id": f"{canonical}#place",
        "name": trail["name"],
        "description": meta_desc,
        "url": canonical,
        "isAccessibleForFree": True,
        "publicAccess": True,
        "address": {"@type": "PostalAddress", "addressLocality": trail["place"], "addressCountry": "LU"},
        "geo": {"@type": "GeoCoordinates", "latitude": entry["center"][0], "longitude": entry["center"][1]},
    }
    images = [img["src"] for img in entry.get("images") or []]
    if images:
        place["image"] = images
    villages = [v["names"]["name"] for v in (trail["ctx"] or {}).get("villages", [])]
    trip = {
        "@type": "TouristTrip",
        "@id": f"{canonical}#trip",
        "name": trail["name"],
        "description": meta_desc,
        "url": canonical,
        "inLanguage": lang,
        "touristType": "Mountain biking" if CAT["key"] == "mtb" else "Hiking",
        "itinerary": {
            "@type": "ItemList",
            "itemListElement": [
                {"@type": "ListItem", "position": i, "item": {"@type": "Place", "name": name}}
                for i, name in enumerate([trail["place"]] + [v for v in villages if v != trail["place"]], 1)
            ],
        },
        "about": {"@id": f"{canonical}#place"},
    }
    crumbs = {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": ui["breadcrumb_home"], "item": index_url(lang)},
            {"@type": "ListItem", "position": 2, "name": region_label,
             "item": f"{BASE_URL}/{lang}/{region_file(trail['region'])}"},
            {"@type": "ListItem", "position": 3, "name": trail["name"], "item": canonical},
        ],
    }
    return json.dumps({"@context": "https://schema.org", "@graph": [place, trip, crumbs]}, ensure_ascii=False)


def load_geojson(slug: str) -> dict:
    return load_json(os.path.join(DATA_DIR, "geo", f"{slug}.geojson"))


def start_point(geo: dict) -> tuple:
    lon, lat = geo["geometry"]["coordinates"][0][0]
    return lat, lon


def route_samples(geo: dict, spacing_km: float = 0.8, max_points: int = 18) -> list:
    """Evenly spaced (lat, lon) along the walking-ordered route, loop closed."""
    points, cum = [], 0.0
    for seg in geo["geometry"]["coordinates"]:
        for lon, lat in seg:
            if points:
                d_lat = lat - points[-1][0]
                d_lon = lon - points[-1][1]
                cum += (d_lat ** 2 + d_lon ** 2) ** 0.5 * 111  # ~km, fine for spacing
            points.append((lat, lon, cum))
    total = points[-1][2] or 1
    count = max(6, min(max_points, int(total / spacing_km)))
    targets = [total * i / count for i in range(count)]
    samples, j = [], 0
    for target in targets:
        while j < len(points) - 1 and points[j][2] < target:
            j += 1
        samples.append((points[j][0], points[j][1]))
    samples.append((points[0][0], points[0][1]))  # close the loop
    return samples


def komoot_url(geo: dict) -> str:
    """Planner link pre-filled with the whole route as waypoints. On the
    phone this opens the Komoot app with the trail ready to save/start."""
    parts = [f"p%5B{i}%5D%5Bloc%5D={lat:.5f}%2C{lon:.5f}"
             for i, (lat, lon) in enumerate(route_samples(geo))]
    return f"https://www.komoot.com/plan/?sport={CAT['komoot_sport']}&" + "&".join(parts)


def gpx_content(trail: dict, geo: dict) -> str:
    name = esc(trail["name"])
    segs = []
    for seg in geo["geometry"]["coordinates"]:
        pts = "".join(f'<trkpt lat="{lat}" lon="{lon}"/>' for lon, lat in seg)
        segs.append(f"<trkseg>{pts}</trkseg>")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<gpx version="1.1" creator="ian.lu/trails" xmlns="http://www.topografix.com/GPX/1/1">\n'
        f'<metadata><name>{name}</name><link href="{BASE_URL}/"/></metadata>\n'
        f'<trk><name>{name}</name>{"".join(segs)}</trk>\n</gpx>\n'
    )


def actions_html(trail: dict, geo: dict, lang: str) -> str:
    lat, lon = start_point(geo)
    labels = EXTRA[lang]
    komoot = komoot_url(geo)
    gmaps = f"https://maps.google.com/?q={lat:.5f},{lon:.5f}"
    return (
        '    <nav class="actions">\n'
        f'      <a class="act" href="../gpx/{trail["slug"]}.gpx" download>⬇ {labels["dl_gpx"]}</a>\n'
        f'      <a class="act js-komoot" href="{komoot}" rel="noopener" target="_blank">{labels["open_komoot"]}</a>\n'
        f'      <a class="act" href="{gmaps}" rel="noopener" target="_blank">📍 {labels["open_start"]}</a>\n'
        "    </nav>"
    )


def fact_html(label: str, value: str) -> str:
    return f'      <div class="fact"><span class="k">{esc(label)}</span><span class="v">{esc(value)}</span></div>'


def extra_facts_html(trail: dict, lang: str) -> str:
    entry, ctx = trail["entry"], trail["ctx"] or {}
    labels = FACT_LABELS[lang]
    rows = []
    if entry.get("elev_gain"):
        rows.append(fact_html(EXTRA[lang]["fact_gain"], f"{entry['elev_gain']} m"))
    if entry.get("elev_max") is not None:
        rows.append(fact_html(labels["high"], f"{entry['elev_max']} m"))
    if ctx.get("forest_pct") is not None:
        rows.append(fact_html(labels["forest"], pct(ctx["forest_pct"], lang)))
    if ctx.get("surface"):
        rows.append(fact_html(labels["paved"], pct(ctx["surface"]["paved"], lang)))
    return "\n".join(rows)


def _haversine_km(a: list, b: list) -> float:
    """Great-circle distance in km between two [lat, lon] points."""
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6371.0 * math.asin(min(1.0, math.sqrt(h)))


def attach_nearby(trails: list) -> list:
    """Each trail's nearest neighbours by centre point, with the facts the
    comparison paragraph needs. Returns new dicts; the inputs stay as they are."""
    located = [t for t in trails if t["entry"].get("center")]
    out = []
    for trail in trails:
        here = trail["entry"].get("center")
        nearby = []
        if here:
            others = sorted(((_haversine_km(here, o["entry"]["center"]), o) for o in located
                             if o["slug"] != trail["slug"]), key=lambda pair: pair[0])
            for dist, o in others[:NEARBY_COUNT]:
                ctx = o["ctx"] or {}
                stops = o["entry"].get("bus_stops") or []
                nearby.append({
                    "slug": o["slug"], "name": o["name"], "difficulty": o["difficulty"], "dist": dist,
                    "length": o["entry"]["length_km"], "gain": o["entry"].get("elev_gain") or 0,
                    "forest": ctx.get("forest_pct"), "paved": (ctx.get("surface") or {}).get("paved"),
                    "bus_on_route": bool(stops) and min(s["dist_m"] for s in stops) <= BUS_ON_ROUTE_M,
                })
        out.append({**trail, "nearby": nearby})
    return out


def nearby_html(trail: dict, lang: str) -> str:
    nearby = trail.get("nearby") or []
    if not nearby:
        return ""
    ui = UI[lang]
    rows = []
    for n in nearby:
        dist = num(n["dist"], lang)
        diff = DIFFICULTIES[n["difficulty"]][lang]
        rows.append(
            f'      <li><a href="{esc(n["slug"])}.html">{esc(n["name"])}</a>'
            f' <span class="near-meta">{fmt_len(n["length"], lang)} km · {esc(diff)} · '
            f'{esc(ui["nearby_dist"].format(d=dist))}</span></li>'
        )
    return (
        f'    <section class="nearby">\n      <h2>{esc(ui["nearby_title"])}</h2>\n'
        f'      <ul class="near-list">\n' + "\n".join(rows) + "\n      </ul>\n    </section>\n"
    )


def sections_html(texts: dict) -> str:
    out = []
    for section in texts["sections"][1:]:
        paras = "\n".join(f"      <p>{p}</p>" for p in section["paras"] if p.strip())
        out.append(f'    <section class="detail detail-{section["key"]}">\n      <h2>{esc(section["title"])}</h2>\n'
                   f"{paras}\n    </section>")
    return "\n".join(out) + "\n" if out else ""


def trail_title(trail: dict, lang: str) -> str:
    name = trail["name"]
    if trail["place"].casefold() not in name.casefold():
        name = f"{name} ({trail['place']})"
    noun = TITLE_NOUN[CAT["key"]][lang].format(l=fmt_len(trail["entry"]["length_km"], lang))
    sep = " : " if lang == "fr" else ": "
    title = f"{name}{sep}{noun}"
    if len(title) > TITLE_MAX:
        title = f"{trail['name']}{sep}{noun}"
    if len(title) + len(TITLE_SUFFIX[lang]) <= TITLE_MAX:
        title += TITLE_SUFFIX[lang]
    return title


def render_trail(tpl: Template, trail: dict, lang: str, affiliate: dict) -> str:
    ui = UI[lang]
    entry = trail["entry"]
    slug = trail["slug"]
    region_label = REGIONS[trail["region"]][lang]
    length = fmt_len(entry["length_km"], lang)
    canonical = f"{BASE_URL}/{lang}/{slug}.html"
    texts = texts_for(trail, lang)
    meta_desc = html.unescape(texts["meta"])
    bbox = entry["bbox"]
    geo = load_geojson(slug)
    images = entry.get("images") or []
    og_image = images[0]["src"] if images else "https://ian.lu/apple-touch-icon.png"
    region_more = HUB[CAT["key"]][lang]["more"].format(rin=REGION_IN_SHORT[lang][trail["region"]])
    return tpl.substitute(
        lang=lang,
        slug=slug,
        title=esc(trail_title(trail, lang)),
        og_title=esc(trail["name"]),
        og_image=esc(og_image),
        meta_desc=esc(meta_desc),
        canonical=canonical,
        alternates=alternate_links(lambda l: f"{BASE_URL}/{l}/{slug}.html"),
        jsonld=trail_jsonld(trail, lang, meta_desc, canonical, ui),
        site_name=esc(ui["site_name"]),
        lang_switch_label=esc(ui["lang_switch_label"]),
        lang_links=lang_switcher(lang, lambda l: f"../{l}/{slug}.html"),
        breadcrumb_home=esc(ui["breadcrumb_home"]),
        region_href=region_file(trail["region"]),
        region_more=esc(region_more),
        name=esc(trail["name"]),
        region_label=esc(region_label),
        commune=esc(trail["place"]),
        facts_title=esc(ui["facts_title"]),
        fact_length=esc(ui["fact_length"]),
        fact_duration=esc(ui["fact_duration"]),
        fact_difficulty=esc(ui["fact_difficulty"]),
        fact_commune=esc(ui["fact_commune"]),
        fact_type=esc(ui["fact_type"]),
        fact_type_value=esc(ui["fact_type_value"]),
        extra_facts=extra_facts_html(trail, lang),
        actions=actions_html(trail, geo, lang),
        length=length,
        duration=esc(ui["duration_fmt"].format(duration_of(entry))),
        difficulty=esc(DIFFICULTIES[trail["difficulty"]][lang]),
        map_title=esc(ui["map_title"]),
        map_note=esc(ui["map_note_official"] if entry.get("source") == "geoportail"
                     else ui["map_note"]),
        profile_html=profile_svg(entry, lang),
        description_html="\n".join(f"      <p>{p}</p>" for p in texts["sections"][0]["paras"]),
        sections_html=sections_html(texts),
        highlights_title=esc(ui["highlights_title"]),
        highlights_html="\n".join(f"        <li>{h}</li>" for h in texts["highlights"]),
        gallery_html=gallery_html(images, lang, ui["photo_alt"].format(
            name=trail["name"], commune=trail["place"], region=region_label)),
        nearby_html=nearby_html(trail, lang),
        bus_title=esc(ui["bus_title"]),
        bus_intro=esc(ui["bus_intro"].split(". ")[0].rstrip(".") + "."),  # "public transport is free" only
        bus_text=lb_fix_numbers(texts["bus_html"]) if lang == "lb" else texts["bus_html"],
        bus_html=bus_stops_html(entry["bus_stops"], ui),
        bus_live=esc(ui["bus_live"]),
        gear_html=gear_html(affiliate, lang),
        footer_note=esc(ui["footer_note"]),
        privacy=privacy_link(lang),
        bbox_sw=f"{bbox[0]}, {bbox[1]}",
        bbox_ne=f"{bbox[2]}, {bbox[3]}",
    )


PRIVACY_LABEL = {"de": "Datenschutz", "fr": "Confidentialité", "en": "Privacy", "lb": "Dateschutz"}


def privacy_link(lang: str) -> str:
    """Footer link to the privacy policy, required under the GDPR."""
    label = PRIVACY_LABEL.get(lang, PRIVACY_LABEL["en"])
    return f'<a href="https://ian.lu/privacy.html" rel="noopener">{label}</a>'


def map_link_html(lang: str) -> str:
    """Entry point to /kaart/; without this the maps are unreachable from here."""
    return f'<a href="https://ian.lu/kaart/">{esc(EXTRA[lang]["map_link"])}</a>'


def sister_html(lang: str) -> str:
    if CAT["key"] == "hiking":
        return f'<a href="../../mtb/{lang}/">{esc(EXTRA[lang]["sister_mtb"])}</a>'
    return f'<a href="../../trails/{lang}/">{esc(EXTRA[lang]["sister_hiking"])}</a>'


def regions_used(trails: list, lang: str) -> list:
    return sorted({t["region"] for t in trails}, key=lambda r: REGIONS[r][lang])


def region_links_html(trails: list, lang: str, skip: str = "") -> str:
    counts = {}
    for t in trails:
        counts[t["region"]] = counts.get(t["region"], 0) + 1
    return "".join(
        f'<a href="{region_file(r)}">{esc(REGIONS[r][lang])} ({counts[r]})</a>'
        for r in regions_used(trails, lang) if r != skip
    )


def render_index(tpl: Template, trails: list, lang: str) -> str:
    ui = UI[lang]
    canonical = f"{BASE_URL}/{lang}/"
    # {n} is the live trail count, so the intro can never drift from the list
    # below it. Plain replace rather than str.format: the banks are prose and
    # a stray brace in a future sentence should not raise.
    intro_html = "\n".join(
        f"      <p>{esc(p.replace('{n}', str(len(trails))))}</p>" for p in ui["index_intro"]
    )
    filter_buttons = "\n".join(
        f'      <button class="filter" data-region="{r}">{esc(REGIONS[r][lang])}</button>'
        for r in regions_used(trails, lang)
    )
    cards = []
    for trail in sorted(trails, key=lambda t: t["name"]):
        entry = trail["entry"]
        length = fmt_len(entry["length_km"], lang)
        teaser = texts_for(trail, lang)["teaser"]
        cards.append(
            f'      <a class="card" href="{trail["slug"]}.html" data-region="{trail["region"]}">\n'
            f'        <span class="region">{esc(REGIONS[trail["region"]][lang])}</span>\n'
            f"        <h3>{esc(trail['name'])}</h3>\n"
            f'        <span class="badges"><span class="badge">{length} km</span>'
            f'<span class="badge">{esc(ui["duration_fmt"].format(duration_of(entry)))}</span>'
            f'<span class="badge">{esc(DIFFICULTIES[trail["difficulty"]][lang])}</span></span>\n'
            f'        <p class="teaser">{teaser}</p>\n'
            f'        <span class="cta">{esc(ui["card_cta"])} ›</span>\n'
            "      </a>"
        )
    return tpl.substitute(
        lang=lang,
        title=esc(ui["index_title"]),
        og_title=esc(ui["index_h1"]),
        meta_desc=esc(ui["index_meta"]),
        canonical=canonical,
        alternates=alternate_links(lambda l: f"{BASE_URL}/{l}/"),
        site_name=esc(ui["site_name"]),
        lang_switch_label=esc(ui["lang_switch_label"]),
        lang_links=lang_switcher(lang, lambda l: f"../{l}/"),
        index_h1=esc(ui["index_h1"]),
        intro_html=intro_html,
        regions_label=esc(UI[lang]["fact_region"]),
        region_links=region_links_html(trails, lang),
        filter_all=esc(ui["filter_all"]),
        filter_buttons=filter_buttons,
        search_placeholder=esc(EXTRA[lang]["search_placeholder"]),
        search_label=esc(EXTRA[lang]["search_label"]),
        map_button=esc(EXTRA[lang]["map_button"]),
        no_results=esc(EXTRA[lang]["no_results"]),
        cards_html="\n".join(cards),
        sister_html=sister_html(lang),
        map_link=map_link_html(lang),
        footer_note=esc(ui["footer_note"]),
        privacy=privacy_link(lang),
    )


def render_region(tpl: Template, trails: list, region: str, lang: str) -> str:
    ui = UI[lang]
    words = HUB[CAT["key"]][lang]
    members = sorted((t for t in trails if t["region"] == region), key=lambda t: t["entry"]["length_km"])
    rin = REGION_IN_SHORT[lang][region]
    lengths = [t["entry"]["length_km"] for t in members]
    bus = sum(1 for t in members if (t["entry"].get("bus_stops") or [])
              and min(s["dist_m"] for s in t["entry"]["bus_stops"]) <= BUS_ON_ROUTE_M)
    fill = {"rin": rin, "n": len(members), "min": fmt_len(min(lengths), lang), "max": fmt_len(max(lengths), lang),
            "sum": num(sum(lengths), lang, 0), "bus": bus}
    fix = lb_fix_numbers if lang == "lb" else (lambda text: text)
    canonical = f"{BASE_URL}/{lang}/{region_file(region)}"
    rows = []
    for t in members:
        entry, ctx = t["entry"], t["ctx"] or {}
        meta = words["row"].format(l=fmt_len(entry["length_km"], lang), g=entry.get("elev_gain") or 0,
                                   d=ui["duration_fmt"].format(duration_of(entry)))
        if ctx.get("forest_pct") is not None:
            meta += " · " + words["forest"].format(f=pct(ctx["forest_pct"], lang))
        via = texts_for(t, lang)["via"]
        rows.append(f'      <li><a href="{esc(t["slug"])}.html">{esc(t["name"])}</a>'
                    f'<span class="hub-meta">{esc(meta)}{" · " + via if via else ""}</span></li>')
    label = REGIONS[region][lang]
    jsonld = {
        "@context": "https://schema.org",
        "@graph": [
            {"@type": "CollectionPage", "name": words["h1"].format(**fill), "url": canonical, "inLanguage": lang,
             "mainEntity": {"@type": "ItemList", "numberOfItems": len(members), "itemListElement": [
                 {"@type": "ListItem", "position": i, "url": f"{BASE_URL}/{lang}/{t['slug']}.html", "name": t["name"]}
                 for i, t in enumerate(members, 1)]}},
            {"@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": ui["breadcrumb_home"], "item": index_url(lang)},
                {"@type": "ListItem", "position": 2, "name": label, "item": canonical}]},
        ],
    }
    return tpl.substitute(
        lang=lang,
        title=esc(fix(words["title"].format(**fill))),
        h1=esc(words["h1"].format(**fill)),
        meta_desc=esc(fix(words["meta"].format(**fill))),
        canonical=canonical,
        alternates=alternate_links(lambda l: f"{BASE_URL}/{l}/{region_file(region)}"),
        jsonld=json.dumps(jsonld, ensure_ascii=False),
        site_name=esc(ui["site_name"]),
        lang_switch_label=esc(ui["lang_switch_label"]),
        lang_links=lang_switcher(lang, lambda l: f"../{l}/{region_file(region)}"),
        breadcrumb_home=esc(ui["breadcrumb_home"]),
        region_label=esc(label),
        about=esc(REGION_ABOUT[region][lang]),
        stats=esc(fix(words["stats"].format(**fill))),
        sorted=esc(words["sorted"]),
        rows_html="\n".join(rows),
        other_title=esc(words["other"]),
        region_links=region_links_html(trails, lang, skip=region),
        all_label=esc(ui["all_trails"]),
        footer_note=esc(ui["footer_note"]),
        privacy=privacy_link(lang),
    )


def prune_removed(trails: list, regions: list) -> int:
    """Delete generated files for trails that are no longer published.

    The deploy mirrors with --delete, so removing them here is what actually
    takes them off the server.
    """
    published = {trail["slug"] for trail in trails} | {region_file(r)[:-5] for r in regions}
    stale = []
    for folder, suffix in [(lang, ".html") for lang in LANGS] + [("geo", ".geojson"), ("gpx", ".gpx")]:
        directory = os.path.join(OUT_DIR, folder)
        if not os.path.isdir(directory):
            continue
        for name in sorted(os.listdir(directory)):
            if not name.endswith(suffix) or name == "index.html":
                continue
            if name[: -len(suffix)] not in published:
                stale.append(os.path.join(directory, name))
    for path in stale:
        os.remove(path)
    if stale:
        print(f"Removed {len(stale)} files for trails no longer in the registry")
    return len(stale)


def write_redirects(registry: list, computed: dict, trails: list) -> int:
    """301 retired and renamed circuits, per language.

    Retired circuits (cut from the official network) go to their region's
    page, the closest thing to what the visitor was looking for; renamed ones
    (moved.json) go to the new page. Generated from the data so this can never
    drift from what prune_removed() deleted.
    """
    moved_path = os.path.join(DATA_DIR, "moved.json")
    moved = load_json(moved_path) if os.path.exists(moved_path) else {}
    live = {t["slug"] for t in trails}
    regions = {t["region"] for t in trails}
    base = BASE_URL[len("https://ian.lu"):]
    lines = [
        "# Generated by scripts/trails/build.py, do not edit by hand.",
        "# Circuits retired from the official network go to their region page,",
        "# renamed circuits (moved.json) to their new page.",
    ]
    count = 0
    for slug in sorted(t["slug"] for t in registry if t.get("retired")):
        region = (computed.get(slug) or {}).get("region")
        for lang in LANGS:
            target = f"{base}/{lang}/{region_file(region)}" if region in regions else f"{base}/{lang}/"
            lines.append(f"Redirect 301 {base}/{lang}/{slug}.html {target}")
            count += 1
    for old, new in sorted(moved.items()):
        if new not in live:
            raise SystemExit(f"moved.json: {old} -> {new}, but {new} is not published")
        for lang in LANGS:
            lines.append(f"Redirect 301 {base}/{lang}/{old}.html {base}/{lang}/{new}.html")
            count += 1
    path = os.path.join(OUT_DIR, ".htaccess")
    if not count:
        if os.path.exists(path):
            os.remove(path)
        return 0
    write(path, "\n".join(lines) + "\n")
    print(f"Wrote {count} redirects → {path}")
    return count


def write(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def sitemap_urls(trails: list, regions: list) -> list:
    """(url, repo-relative file) for every indexable page of this category.

    The chooser at /trails/ is left out on purpose: it redirects visitors to a
    language with JavaScript and is only the hreflang x-default.
    """
    rel = OUT_DIR[len(REPO) + 1:]
    urls = [(f"{BASE_URL}/{lang}/", f"{rel}/{lang}/index.html") for lang in LANGS]
    urls += [(f"{BASE_URL}/{lang}/{region_file(r)}", f"{rel}/{lang}/{region_file(r)}") for lang in LANGS for r in regions]
    urls += [(f"{BASE_URL}/{lang}/{t['slug']}.html", f"{rel}/{lang}/{t['slug']}.html") for lang in LANGS for t in trails]
    return urls


def main() -> None:
    global CAT, UI, DATA_DIR, OUT_DIR, BASE_URL
    CAT, _ = pick_category(sys.argv[1:])
    UI = UI_BY_CAT[CAT["key"]]
    DATA_DIR, OUT_DIR, BASE_URL = CAT["data_dir"], CAT["out_dir"], CAT["base_url"]

    trails = attach_nearby(merge_trails())
    registry = load_json(os.path.join(DATA_DIR, "registry.json"))["trails"]
    computed = load_json(os.path.join(DATA_DIR, "computed.json"))
    if not trails:
        raise SystemExit("No renderable trails.")
    affiliate_path = os.path.join(DATA_DIR, "affiliate.json")
    affiliate = load_json(affiliate_path) if os.path.exists(affiliate_path) else {}

    trail_tpl = load_template("trail.html")
    index_tpl = load_template("index.html")
    region_tpl = load_template("region.html")
    chooser_tpl = load_template(CAT["chooser_template"])
    regions = regions_used(trails, "en")

    for lang in LANGS:
        for trail in trails:
            write(os.path.join(OUT_DIR, lang, f"{trail['slug']}.html"), render_trail(trail_tpl, trail, lang, affiliate))
        for region in regions:
            write(os.path.join(OUT_DIR, lang, region_file(region)), render_region(region_tpl, trails, region, lang))
        write(os.path.join(OUT_DIR, lang, "index.html"), render_index(index_tpl, trails, lang))

    write(
        os.path.join(OUT_DIR, "index.html"),
        chooser_tpl.substitute(alternates=alternate_links(lambda l: f"{BASE_URL}/{l}/")),
    )

    os.makedirs(os.path.join(OUT_DIR, "geo"), exist_ok=True)
    os.makedirs(os.path.join(OUT_DIR, "gpx"), exist_ok=True)
    for trail in trails:
        shutil.copyfile(
            os.path.join(DATA_DIR, "geo", f"{trail['slug']}.geojson"),
            os.path.join(OUT_DIR, "geo", f"{trail['slug']}.geojson"),
        )
        write(os.path.join(OUT_DIR, "gpx", f"{trail['slug']}.gpx"),
              gpx_content(trail, load_geojson(trail["slug"])))
    shutil.copyfile(os.path.join(TEMPLATE_DIR, "trails.css"), os.path.join(OUT_DIR, "trails.css"))
    prune_removed(trails, regions)
    write_redirects(registry, computed, trails)

    sitemaps.write_urlset(CAT["sitemap_file"], sitemap_urls(trails, regions))
    sitemaps.write_index()

    with_photos = sum(1 for t in trails if t["entry"].get("images"))
    pages = len(trails) * len(LANGS) + len(regions) * len(LANGS) + len(LANGS) + 1
    print(f"Built {pages} {CAT['key']} pages for {len(trails)} trails "
          f"({with_photos} with photos, {len(regions)} regions) → {OUT_DIR}")


if __name__ == "__main__":
    main()
