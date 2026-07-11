#!/usr/bin/env python3
"""Generate the static trail pages at /trails from the curated dataset.

Inputs (all under data/trails/):
  trails.json    — hand-curated trail facts + trilingual texts (source of truth)
  computed.json  — machine facts from fetch_trails.py (length, bbox, bus stops)
  geo/*.geojson  — route geometry, copied verbatim for the Leaflet maps
  affiliate.json — optional gear links; the gear block renders only when set

Outputs:
  trails/index.html                    — language chooser (x-default)
  trails/{de,fr,en}/index.html         — per-language listing
  trails/{de,fr,en}/<slug>.html        — per-language trail pages
  trails/geo/<slug>.geojson, trails/trails.css
  sitemap-trails.xml                   — at repo root, all generated URLs

Usage: python3 scripts/trails/build.py
"""
from __future__ import annotations

import html
import json
import os
import shutil
import sys
from datetime import date
from string import Template

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from strings import DIFFICULTIES, REGIONS, UI  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DATA_DIR = os.path.join(REPO, "data", "trails")
OUT_DIR = os.path.join(REPO, "trails")
TEMPLATE_DIR = os.path.join(HERE, "templates")

BASE_URL = "https://ian.lu/trails"
LANGS = ("de", "fr", "en")
WALK_SPEED_KMH = 4.0
GEAR_TITLES = {"de": "Ausrüstung", "fr": "Équipement", "en": "Gear"}
AFFILIATE_DISCLOSURE = {
    "de": "Hinweis: Links können Partnerlinks sein.",
    "fr": "Remarque : certains liens peuvent être affiliés.",
    "en": "Note: links may be affiliate links.",
}


def esc(text: str) -> str:
    return html.escape(str(text), quote=True)


def load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_template(name: str) -> Template:
    with open(os.path.join(TEMPLATE_DIR, name), encoding="utf-8") as f:
        return Template(f.read())


def validate(trails: list, computed: dict) -> None:
    seen = set()
    for trail in trails:
        slug = trail.get("slug") or "<missing slug>"
        where = f"trails.json entry '{slug}'"
        if slug in seen:
            raise SystemExit(f"{where}: duplicate slug")
        seen.add(slug)
        for key in ("osm_rel", "name", "commune", "region", "difficulty", "descriptions", "highlights"):
            if key not in trail:
                raise SystemExit(f"{where}: missing key '{key}'")
        if trail["region"] not in REGIONS:
            raise SystemExit(f"{where}: unknown region '{trail['region']}'")
        if trail["difficulty"] not in DIFFICULTIES:
            raise SystemExit(f"{where}: unknown difficulty '{trail['difficulty']}'")
        for lang in LANGS:
            paragraphs = trail["descriptions"].get(lang) or []
            if not paragraphs or not all(p.strip() for p in paragraphs):
                raise SystemExit(f"{where}: descriptions.{lang} missing or empty")
            if not trail["highlights"].get(lang):
                raise SystemExit(f"{where}: highlights.{lang} missing")
        entry = computed.get(slug)
        if not entry or not all(k in entry for k in ("length_km", "center", "bbox", "bus_stops")):
            raise SystemExit(f"{where}: no computed data — run scripts/trails/fetch_trails.py")
        if not os.path.exists(os.path.join(DATA_DIR, "geo", f"{slug}.geojson")):
            raise SystemExit(f"{where}: geo/{slug}.geojson missing — run scripts/trails/fetch_trails.py")


def duration_label(length_km: float) -> str:
    """Half-hour-rounded walking time as a locale-neutral string like '2½'."""
    halves = max(1, round(length_km / WALK_SPEED_KMH * 2))
    whole, half = divmod(halves, 2)
    if whole == 0:
        return "½"
    return f"{whole}½" if half else str(whole)


def alternate_links(path_of) -> str:
    lines = [f'  <link rel="alternate" hreflang="{lang}" href="{path_of(lang)}" />' for lang in LANGS]
    lines.append(f'  <link rel="alternate" hreflang="x-default" href="{BASE_URL}/" />')
    return "\n".join(lines)


def lang_switcher(current: str, href_of) -> str:
    parts = []
    for lang in LANGS:
        cls = ' class="on"' if lang == current else ""
        parts.append(f'<a href="{href_of(lang)}"{cls}>{lang.upper()}</a>')
    return "".join(parts)


def bus_stops_html(stops: list, ui: dict) -> str:
    items = []
    for stop in stops:
        lines = stop.get("lines") or []
        chips = "".join(f'<span class="line-chip">{esc(l)}</span>' for l in lines[:8])
        lines_html = chips if chips else esc(ui["bus_no_lines"])
        items.append(
            "        <li>"
            f'<span class="stop-name">{esc(stop["name"])}</span>'
            f'<span class="stop-meta">{esc(ui["bus_dist"].format(stop["dist_m"]))}</span>'
            f'<span class="stop-lines">{lines_html}</span>'
            "</li>"
        )
    return "\n".join(items)


def gear_html(affiliate: dict, lang: str) -> str:
    items = affiliate.get("gear") or []
    if not items:
        return ""
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


def trail_jsonld(trail: dict, entry: dict, lang: str, meta_desc: str, canonical: str, ui: dict) -> str:
    graph = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "TouristAttraction",
                "name": trail["name"],
                "description": meta_desc,
                "url": canonical,
                "isAccessibleForFree": True,
                "address": {"@type": "PostalAddress", "addressLocality": trail["commune"], "addressCountry": "LU"},
                "geo": {"@type": "GeoCoordinates", "latitude": entry["center"][0], "longitude": entry["center"][1]},
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": ui["breadcrumb_home"], "item": f"{BASE_URL}/{lang}/"},
                    {"@type": "ListItem", "position": 2, "name": trail["name"], "item": canonical},
                ],
            },
        ],
    }
    return json.dumps(graph, ensure_ascii=False)


def render_trail(tpl: Template, trail: dict, entry: dict, lang: str, affiliate: dict) -> str:
    ui = UI[lang]
    slug = trail["slug"]
    region_label = REGIONS[trail["region"]][lang]
    length = f'{entry["length_km"]:g}'.replace(".", "," if lang != "en" else ".")
    canonical = f"{BASE_URL}/{lang}/{slug}.html"
    meta_desc = ui["trail_meta"].format(name=trail["name"], length=length, commune=trail["commune"], region=region_label)
    bbox = entry["bbox"]
    description_html = "\n".join(f"      <p>{esc(p)}</p>" for p in trail["descriptions"][lang])
    highlights_html = "\n".join(f"        <li>{esc(h)}</li>" for h in trail["highlights"][lang])
    return tpl.substitute(
        lang=lang,
        slug=slug,
        title=esc(ui["trail_title"].format(name=trail["name"], commune=trail["commune"])),
        og_title=esc(trail["name"]),
        meta_desc=esc(meta_desc),
        canonical=canonical,
        alternates=alternate_links(lambda l: f"{BASE_URL}/{l}/{slug}.html"),
        jsonld=trail_jsonld(trail, entry, lang, meta_desc, canonical, ui),
        site_name=esc(ui["site_name"]),
        lang_switch_label=esc(ui["lang_switch_label"]),
        lang_links=lang_switcher(lang, lambda l: f"../{l}/{slug}.html"),
        breadcrumb_home=esc(ui["breadcrumb_home"]),
        name=esc(trail["name"]),
        region_label=esc(region_label),
        commune=esc(trail["commune"]),
        facts_title=esc(ui["facts_title"]),
        fact_length=esc(ui["fact_length"]),
        fact_duration=esc(ui["fact_duration"]),
        fact_difficulty=esc(ui["fact_difficulty"]),
        fact_commune=esc(ui["fact_commune"]),
        fact_type=esc(ui["fact_type"]),
        fact_type_value=esc(ui["fact_type_value"]),
        length=length,
        duration=esc(ui["duration_fmt"].format(duration_label(entry["length_km"]))),
        difficulty=esc(DIFFICULTIES[trail["difficulty"]][lang]),
        map_title=esc(ui["map_title"]),
        map_note=esc(ui["map_note"]),
        description_html=description_html,
        highlights_title=esc(ui["highlights_title"]),
        highlights_html=highlights_html,
        bus_title=esc(ui["bus_title"]),
        bus_intro=esc(ui["bus_intro"]),
        bus_html=bus_stops_html(entry["bus_stops"], ui),
        bus_live=esc(ui["bus_live"]),
        gear_html=gear_html(affiliate, lang),
        footer_note=esc(ui["footer_note"]),
        bbox_sw=f"{bbox[0]}, {bbox[1]}",
        bbox_ne=f"{bbox[2]}, {bbox[3]}",
    )


def render_index(tpl: Template, trails: list, computed: dict, lang: str) -> str:
    ui = UI[lang]
    canonical = f"{BASE_URL}/{lang}/"
    intro_html = "\n".join(f"      <p>{esc(p)}</p>" for p in ui["index_intro"])
    regions_used = sorted({t["region"] for t in trails}, key=lambda r: REGIONS[r][lang])
    filter_buttons = "\n".join(
        f'      <button class="filter" data-region="{r}">{esc(REGIONS[r][lang])}</button>' for r in regions_used
    )
    cards = []
    for trail in sorted(trails, key=lambda t: t["name"]):
        entry = computed[trail["slug"]]
        length = f'{entry["length_km"]:g}'.replace(".", "," if lang != "en" else ".")
        teaser = trail["highlights"][lang][0]
        cards.append(
            f'      <a class="card" href="{trail["slug"]}.html" data-region="{trail["region"]}">\n'
            f'        <span class="region">{esc(REGIONS[trail["region"]][lang])}</span>\n'
            f"        <h3>{esc(trail['name'])}</h3>\n"
            f'        <span class="badges"><span class="badge">{length} km</span>'
            f'<span class="badge">{esc(ui["duration_fmt"].format(duration_label(entry["length_km"])))}</span>'
            f'<span class="badge">{esc(DIFFICULTIES[trail["difficulty"]][lang])}</span></span>\n'
            f'        <p class="teaser">{esc(teaser)}</p>\n'
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
        filter_all=esc(ui["filter_all"]),
        filter_buttons=filter_buttons,
        cards_html="\n".join(cards),
        footer_note=esc(ui["footer_note"]),
    )


def write(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def build_sitemap(trails: list) -> str:
    today = date.today().isoformat()
    urls = [f"{BASE_URL}/"]
    urls.extend(f"{BASE_URL}/{lang}/" for lang in LANGS)
    urls.extend(f"{BASE_URL}/{lang}/{t['slug']}.html" for lang in LANGS for t in trails)
    entries = "\n".join(
        f"  <url>\n    <loc>{u}</loc>\n    <lastmod>{today}</lastmod>\n  </url>" for u in urls
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{entries}\n</urlset>\n"
    )


def main() -> None:
    trails = load_json(os.path.join(DATA_DIR, "trails.json"))["trails"]
    computed = load_json(os.path.join(DATA_DIR, "computed.json"))
    affiliate_path = os.path.join(DATA_DIR, "affiliate.json")
    affiliate = load_json(affiliate_path) if os.path.exists(affiliate_path) else {}
    validate(trails, computed)

    trail_tpl = load_template("trail.html")
    index_tpl = load_template("index.html")
    chooser_tpl = load_template("chooser.html")

    for lang in LANGS:
        for trail in trails:
            page = render_trail(trail_tpl, trail, computed[trail["slug"]], lang, affiliate)
            write(os.path.join(OUT_DIR, lang, f"{trail['slug']}.html"), page)
        write(os.path.join(OUT_DIR, lang, "index.html"), render_index(index_tpl, trails, computed, lang))

    write(
        os.path.join(OUT_DIR, "index.html"),
        chooser_tpl.substitute(alternates=alternate_links(lambda l: f"{BASE_URL}/{l}/")),
    )

    os.makedirs(os.path.join(OUT_DIR, "geo"), exist_ok=True)
    for trail in trails:
        shutil.copyfile(
            os.path.join(DATA_DIR, "geo", f"{trail['slug']}.geojson"),
            os.path.join(OUT_DIR, "geo", f"{trail['slug']}.geojson"),
        )
    shutil.copyfile(os.path.join(TEMPLATE_DIR, "trails.css"), os.path.join(OUT_DIR, "trails.css"))

    write(os.path.join(REPO, "sitemap-trails.xml"), build_sitemap(trails))

    total = len(trails) * len(LANGS) + len(LANGS) + 1
    print(f"Built {total} pages for {len(trails)} trails → {OUT_DIR}")
    print(f"Sitemap: sitemap-trails.xml ({len(trails) * len(LANGS) + len(LANGS) + 1} URLs)")


if __name__ == "__main__":
    main()
