#!/usr/bin/env python3
"""Generate the static trail pages at /trails from the trail dataset.

Data flow (all under data/trails/):
  registry.json  — every Auto-Pédestre, auto-discovered (discover_trails.py)
  computed.json  — machine facts (fetch_trails.py + enrich.py): length, bbox,
                   region, bus stops, elevation profile, POIs, Commons photos
  curated.json   — optional per-slug overrides: hand-written texts, region /
                   place / difficulty fixes. Curated always beats composed.
  geo/*.geojson  — route lines, copied for the Leaflet maps
  affiliate.json — optional gear links; block renders only when filled

Trails without curated text get fact-driven descriptions from composer.py.

Outputs: trails/** (chooser, 3×index, 3×N trail pages, geo, css) and
sitemap-trails.xml at the repo root.

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
from composer import auto_difficulty, compose, duration_label  # noqa: E402
from strings import DIFFICULTIES, EXTRA, REGIONS, UI  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DATA_DIR = os.path.join(REPO, "data", "trails")
OUT_DIR = os.path.join(REPO, "trails")
TEMPLATE_DIR = os.path.join(HERE, "templates")

BASE_URL = "https://ian.lu/trails"
LANGS = ("de", "fr", "en")
GEAR_TITLES = {"de": "Ausrüstung", "fr": "Équipement", "en": "Gear"}
AFFILIATE_DISCLOSURE = {
    "de": "Hinweis: Links können Partnerlinks sein.",
    "fr": "Remarque : certains liens peuvent être affiliés.",
    "en": "Note: links may be affiliate links.",
}
PROFILE_W, PROFILE_H, PROFILE_PAD = 600, 130, 14


def esc(text: str) -> str:
    return html.escape(str(text), quote=True)


def load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_template(name: str) -> Template:
    with open(os.path.join(TEMPLATE_DIR, name), encoding="utf-8") as f:
        return Template(f.read())


def merge_trails() -> list:
    """Registry + computed + curated overrides → render-ready trail dicts."""
    registry = load_json(os.path.join(DATA_DIR, "registry.json"))["trails"]
    computed = load_json(os.path.join(DATA_DIR, "computed.json"))
    curated_list = load_json(os.path.join(DATA_DIR, "curated.json")).get("trails", [])
    curated = {t["slug"]: t for t in curated_list}

    merged = []
    for base in registry:
        slug = base["slug"]
        entry = computed.get(slug)
        if not entry or not os.path.exists(os.path.join(DATA_DIR, "geo", f"{slug}.geojson")):
            print(f"  ! {slug}: missing computed data/geometry — skipped", file=sys.stderr)
            continue
        override = curated.get(slug, {})
        region = override.get("region") or entry.get("region") or "center"
        if region not in REGIONS:
            raise SystemExit(f"{slug}: unknown region '{region}'")
        difficulty = override.get("difficulty") or auto_difficulty(entry["length_km"], entry.get("elev_gain") or 0)
        trail = {
            "slug": slug,
            "name": override.get("name") or base["name"],
            "place": override.get("commune") or base["place"],
            "region": region,
            "difficulty": difficulty,
            "descriptions": override.get("descriptions"),
            "highlights": override.get("highlights"),
            "entry": entry,
        }
        merged.append(trail)
    return merged


def texts_for(trail: dict, lang: str) -> dict:
    if trail["descriptions"] and trail["highlights"]:
        return {"paragraphs": trail["descriptions"][lang], "highlights": trail["highlights"][lang]}
    return compose({"slug": trail["slug"], "place": trail["place"]}, trail["entry"], trail["region"], lang)


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


def gallery_html(images: list, lang: str) -> str:
    if not images:
        return ""
    figures = []
    for img in images:
        credit = f'{esc(img["artist"])} · {esc(img["license"])} · <a href="{esc(img["page"])}" rel="noopener">{EXTRA[lang]["photo_via"]}</a>'
        figures.append(
            f'      <figure><img src="{esc(img["src"])}" alt="" loading="lazy" />'
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


def trail_jsonld(trail: dict, lang: str, meta_desc: str, canonical: str, ui: dict) -> str:
    entry = trail["entry"]
    attraction = {
        "@type": "TouristAttraction",
        "name": trail["name"],
        "description": meta_desc,
        "url": canonical,
        "isAccessibleForFree": True,
        "address": {"@type": "PostalAddress", "addressLocality": trail["place"], "addressCountry": "LU"},
        "geo": {"@type": "GeoCoordinates", "latitude": entry["center"][0], "longitude": entry["center"][1]},
    }
    images = [img["src"] for img in entry.get("images") or []]
    if images:
        attraction["image"] = images
    graph = {
        "@context": "https://schema.org",
        "@graph": [
            attraction,
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


def load_geojson(slug: str) -> dict:
    return load_json(os.path.join(DATA_DIR, "geo", f"{slug}.geojson"))


def start_point(geo: dict) -> tuple:
    lon, lat = geo["geometry"]["coordinates"][0][0]
    return lat, lon


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
    komoot = f"https://www.komoot.com/plan/@{lat:.5f},{lon:.5f},14z"
    gmaps = f"https://maps.google.com/?q={lat:.5f},{lon:.5f}"
    return (
        '    <nav class="actions">\n'
        f'      <a class="act" href="../gpx/{trail["slug"]}.gpx" download>⬇ {labels["dl_gpx"]}</a>\n'
        f'      <a class="act" href="{komoot}" rel="noopener" target="_blank">{labels["open_komoot"]}</a>\n'
        f'      <a class="act" href="{gmaps}" rel="noopener" target="_blank">📍 {labels["open_start"]}</a>\n'
        "    </nav>"
    )


def gain_fact_html(entry: dict, lang: str) -> str:
    gain = entry.get("elev_gain")
    if not gain:
        return ""
    return (f'      <div class="fact"><span class="k">{EXTRA[lang]["fact_gain"]}</span>'
            f'<span class="v">{gain} m</span></div>')


def render_trail(tpl: Template, trail: dict, lang: str, affiliate: dict) -> str:
    ui = UI[lang]
    entry = trail["entry"]
    slug = trail["slug"]
    region_label = REGIONS[trail["region"]][lang]
    length = fmt_len(entry["length_km"], lang)
    canonical = f"{BASE_URL}/{lang}/{slug}.html"
    meta_desc = ui["trail_meta"].format(name=trail["name"], length=length, commune=trail["place"], region=region_label)
    texts = texts_for(trail, lang)
    bbox = entry["bbox"]
    geo = load_geojson(slug)
    images = entry.get("images") or []
    og_image = images[0]["src"] if images else "https://ian.lu/apple-touch-icon.png"
    return tpl.substitute(
        lang=lang,
        slug=slug,
        title=esc(ui["trail_title"].format(name=trail["name"], commune=trail["place"])),
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
        gain_fact=gain_fact_html(entry, lang),
        actions=actions_html(trail, geo, lang),
        length=length,
        duration=esc(ui["duration_fmt"].format(duration_label(entry["length_km"], entry.get("elev_gain") or 0))),
        difficulty=esc(DIFFICULTIES[trail["difficulty"]][lang]),
        map_title=esc(ui["map_title"]),
        map_note=esc(ui["map_note"]),
        profile_html=profile_svg(entry, lang),
        description_html="\n".join(f"      <p>{esc(p)}</p>" for p in texts["paragraphs"]),
        highlights_title=esc(ui["highlights_title"]),
        highlights_html="\n".join(f"        <li>{esc(h)}</li>" for h in texts["highlights"]),
        gallery_html=gallery_html(images, lang),
        bus_title=esc(ui["bus_title"]),
        bus_intro=esc(ui["bus_intro"]),
        bus_html=bus_stops_html(entry["bus_stops"], ui),
        bus_live=esc(ui["bus_live"]),
        gear_html=gear_html(affiliate, lang),
        footer_note=esc(ui["footer_note"]),
        bbox_sw=f"{bbox[0]}, {bbox[1]}",
        bbox_ne=f"{bbox[2]}, {bbox[3]}",
    )


def render_index(tpl: Template, trails: list, lang: str) -> str:
    ui = UI[lang]
    canonical = f"{BASE_URL}/{lang}/"
    intro_html = "\n".join(f"      <p>{esc(p)}</p>" for p in ui["index_intro"])
    regions_used = sorted({t["region"] for t in trails}, key=lambda r: REGIONS[r][lang])
    filter_buttons = "\n".join(
        f'      <button class="filter" data-region="{r}">{esc(REGIONS[r][lang])}</button>' for r in regions_used
    )
    cards = []
    for trail in sorted(trails, key=lambda t: t["name"]):
        entry = trail["entry"]
        length = fmt_len(entry["length_km"], lang)
        teaser = texts_for(trail, lang)["highlights"][0]
        cards.append(
            f'      <a class="card" href="{trail["slug"]}.html" data-region="{trail["region"]}">\n'
            f'        <span class="region">{esc(REGIONS[trail["region"]][lang])}</span>\n'
            f"        <h3>{esc(trail['name'])}</h3>\n"
            f'        <span class="badges"><span class="badge">{length} km</span>'
            f'<span class="badge">{esc(ui["duration_fmt"].format(duration_label(entry["length_km"], entry.get("elev_gain") or 0)))}</span>'
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
    trails = merge_trails()
    if not trails:
        raise SystemExit("No renderable trails.")
    affiliate_path = os.path.join(DATA_DIR, "affiliate.json")
    affiliate = load_json(affiliate_path) if os.path.exists(affiliate_path) else {}

    trail_tpl = load_template("trail.html")
    index_tpl = load_template("index.html")
    chooser_tpl = load_template("chooser.html")

    for lang in LANGS:
        for trail in trails:
            write(os.path.join(OUT_DIR, lang, f"{trail['slug']}.html"), render_trail(trail_tpl, trail, lang, affiliate))
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

    write(os.path.join(REPO, "sitemap-trails.xml"), build_sitemap(trails))

    with_photos = sum(1 for t in trails if t["entry"].get("images"))
    print(f"Built {len(trails) * len(LANGS) + len(LANGS) + 1} pages for {len(trails)} trails "
          f"({with_photos} with photos) → {OUT_DIR}")


if __name__ == "__main__":
    main()
