#!/usr/bin/env python3
"""Generate static, noindex client preview sites from data/pro JSON files.

Usage: python3 scripts/pro/build.py
"""
from __future__ import annotations

import html
import json
import os
import re
import shutil
import sys
from functools import lru_cache
from pathlib import Path
from string import Template
from typing import Any
from urllib.parse import quote, urlparse

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
DATA_DIR = REPO / "data" / "pro"
OUT_DIR = REPO / "pro"
TEMPLATE_DIR = HERE / "templates"
BASE_URL = "https://ian.lu"
CONFIG = {"data_dir": DATA_DIR, "out_dir": OUT_DIR, "template_dir": TEMPLATE_DIR, "base_url": BASE_URL}
SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$")
ASSET_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")
COLOUR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
LANG_RE = re.compile(r"^[a-z]{2,3}$")
DEFAULT_THEME = {"brand": "#7A2E2E", "ground": "#FBF8F4", "ink": "#1B1917", "accent": "#C9A227"}
MIN_TEXT_CONTRAST = 4.5
LICENSE_NAMES = {"BY": "CC BY", "CC0": "CC0", "PDM": "Public Domain Mark"}
STOCK_PHOTO_CSS = " .stock-photo-notice { width: min(100% - 2rem, 70rem); margin: 1rem auto 0; color: var(--muted); font-size: .88rem; } .photo-credits { width: min(100% - 2rem, 70rem); margin: 2rem auto; padding-top: 1.5rem; border-top: 1px solid var(--line); } .photo-credits h2 { margin: 0 0 .75rem; font: 700 1.35rem/1.2 var(--display); } .photo-credits ul { margin: 0; padding-left: 1.2rem; } .photo-credits li + li { margin-top: .45rem; }"

sys.path.insert(0, str(HERE))
from imagesize import image_size  # noqa: E402
from strings import UI  # noqa: E402


class ValidationError(ValueError):
    """A clear content boundary error."""


def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def load_template(name: str) -> Template:
    return Template((TEMPLATE_DIR / name).read_text(encoding="utf-8"))


def fail(path: Path, key: str, message: str) -> None:
    raise ValidationError(f"{path}: {key}: {message}")


def require(data: dict, key: str, path: Path) -> Any:
    if key not in data:
        fail(path, key, "missing required key")
    return data[key]


def valid_asset(path: Path, key: str, value: Any) -> None:
    if not isinstance(value, str) or not ASSET_RE.fullmatch(value) or value.startswith("/") or ".." in value.split("/"):
        fail(path, key, "must be a relative asset path without '..'")


def relative_luminance(colour: str) -> float:
    channels = tuple(int(colour[index:index + 2], 16) / 255 for index in (1, 3, 5))
    linear = tuple(channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4 for channel in channels)
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def contrast_ratio(first: str, second: str) -> float:
    light, dark = sorted((relative_luminance(first), relative_luminance(second)), reverse=True)
    return (light + 0.05) / (dark + 0.05)


def validate(data: Any, path: Path) -> dict:
    if not isinstance(data, dict):
        fail(path, "$", "must be a JSON object")
    for key in ("schema", "slug", "name", "languages", "defaultLanguage", "sections"):
        require(data, key, path)
    if data["schema"] != 1:
        fail(path, "schema", "must be 1")
    if not isinstance(data["slug"], str) or not SLUG_RE.fullmatch(data["slug"]):
        fail(path, "slug", "must match ^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$")
    if not isinstance(data["name"], str) or not data["name"].strip():
        fail(path, "name", "must be a non-empty string")
    languages = data["languages"]
    if not isinstance(languages, list) or not languages or any(not isinstance(lang, str) or not LANG_RE.fullmatch(lang) for lang in languages):
        fail(path, "languages", "must be a non-empty array of language codes")
    if len(set(languages)) != len(languages):
        fail(path, "languages", "must not contain duplicates")
    if data["defaultLanguage"] not in languages:
        fail(path, "defaultLanguage", "must be included in languages")
    if any(lang not in UI for lang in languages):
        fail(path, "languages", "only fr, de and en have UI strings")
    if not isinstance(data["sections"], list):
        fail(path, "sections", "must be an array")
    theme = data.get("theme", {})
    if not isinstance(theme, dict):
        fail(path, "theme", "must be an object")
    for key in ("brand", "ground", "ink", "accent"):
        if key in theme and (not isinstance(theme[key], str) or not COLOUR_RE.fullmatch(theme[key])):
            fail(path, f"theme.{key}", "must be a six-digit hex colour")
    resolved_theme = {key: theme.get(key, fallback) for key, fallback in DEFAULT_THEME.items()}
    if contrast_ratio(resolved_theme["ink"], resolved_theme["ground"]) < MIN_TEXT_CONTRAST:
        fail(path, "theme.ink", "must have WCAG AA contrast against theme.ground")
    if contrast_ratio(resolved_theme["brand"], "#FFFFFF") < MIN_TEXT_CONTRAST:
        fail(path, "theme.brand", "must have WCAG AA contrast with white action text")
    if theme.get("display", "serif") not in ("serif", "sans"):
        fail(path, "theme.display", "must be 'serif' or 'sans'")
    for index, section in enumerate(data["sections"]):
        if not isinstance(section, dict):
            fail(path, f"sections[{index}]", "must be an object")
        if not isinstance(section.get("type"), str):
            fail(path, f"sections[{index}].type", "must be a string")
        for image_key in ("image", "src"):
            if image_key in section:
                valid_asset(path, f"sections[{index}].{image_key}", section[image_key])
        for image_index, image in enumerate(section.get("images", [])):
            if not isinstance(image, dict):
                fail(path, f"sections[{index}].images[{image_index}]", "must be an object")
            if "src" in image:
                valid_asset(path, f"sections[{index}].images[{image_index}].src", image["src"])
    return data


def text(value: Any, data: dict, language: str) -> str:
    """Choose a translation without exposing missing content to the page."""
    if not isinstance(value, dict):
        return ""
    preferred = (language, data["defaultLanguage"], *data["languages"])
    for code in preferred:
        candidate = value.get(code)
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    for candidate in value.values():
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return ""


def paragraph_html(value: str) -> str:
    paragraphs = [line.strip() for line in value.split("\n") if line.strip()]
    return "".join(f"<p>{esc(paragraph)}</p>" for paragraph in paragraphs)


def output_url(data: dict, language: str) -> str:
    suffix = "" if language == data["defaultLanguage"] else f"{language}/"
    return f"{BASE_URL}/pro/{data['slug']}/{suffix}"


def output_path(data: dict, language: str) -> Path:
    base = OUT_DIR / data["slug"]
    return base if language == data["defaultLanguage"] else base / language


def relative_page_href(data: dict, current: str, target: str) -> str:
    current_dir = output_path(data, current)
    target_dir = output_path(data, target)
    return os.path.relpath(target_dir, current_dir).replace(os.sep, "/") + "/"


def relative_asset(asset: str, data: dict, language: str) -> str:
    prefix = "" if language == data["defaultLanguage"] else "../"
    return prefix + quote(asset, safe="/._-")


WARNED_IMAGE_PATHS: set[Path] = set()


@lru_cache(maxsize=None)
def read_image_size(path: Path) -> tuple[int, int] | None:
    """Cache trusted file dimensions while rendering each language variant."""
    return image_size(path)


def dimensions_attributes(data: dict, asset: str) -> str:
    """Return safe HTML dimensions, warning once when a source is unreadable."""
    path = OUT_DIR / data["slug"] / asset
    dimensions = read_image_size(path)
    if dimensions is None:
        if path not in WARNED_IMAGE_PATHS:
            try:
                display_path = path.relative_to(REPO)
            except ValueError:
                display_path = path
            print(f"warning: {display_path}: cannot read image dimensions; omitting width and height", file=sys.stderr)
            WARNED_IMAGE_PATHS.add(path)
        return ""
    width, height = dimensions
    return f' width="{esc(width)}" height="{esc(height)}"'


def outbound_url(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    parsed = urlparse(value)
    return value if parsed.scheme in ("http", "https") and parsed.netloc else ""


def load_credits(data: dict) -> list[dict] | None:
    path = OUT_DIR / data["slug"] / "img" / "credits.json"
    try:
        credits = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return [credit for credit in credits if isinstance(credit, dict)] if isinstance(credits, list) else None


def map_url(data: dict) -> str:
    contact = data.get("contact") if isinstance(data.get("contact"), dict) else {}
    latitude, longitude = contact.get("lat"), contact.get("lon")
    if not isinstance(latitude, (int, float)) or not isinstance(longitude, (int, float)):
        return "https://www.openstreetmap.org/"
    return f"https://www.openstreetmap.org/?mlat={latitude:.5f}&mlon={longitude:.5f}#map=17/{latitude:.5f}/{longitude:.5f}"


def town(data: dict) -> str:
    contact = data.get("contact") if isinstance(data.get("contact"), dict) else {}
    address = contact.get("address")
    if not isinstance(address, str):
        return "Luxembourg"
    lines = [line.strip() for line in address.splitlines() if line.strip()]
    if not lines:
        return "Luxembourg"
    last = re.sub(r"^L-\d{4}\s+", "", lines[-1]).strip()
    return last or "Luxembourg"


def section_id(section: dict, number: int) -> str:
    return f"section-{number}-{re.sub(r'[^a-z0-9-]+', '-', section.get('type', 'section').lower()).strip('-')}"


def render_hero(section: dict, data: dict, language: str, ui: dict) -> str:
    title = text(section.get("title"), data, language) or data["name"]
    subtitle_text = text(section.get("subtitle"), data, language)
    subtitle = f"<p>{esc(subtitle_text)}</p>" if subtitle_text else ""
    image = section.get("image")
    image_html = relative_asset(image, data, language) if isinstance(image, str) else ""
    return load_template("section-hero.html").substitute(
        image=esc(image_html), image_alt=esc(title), dimensions=dimensions_attributes(data, image), name=esc(data["name"]), title=esc(title), subtitle=subtitle,
        phone_href=esc(phone_href(data)), map_href=esc(map_url(data)), call_label=esc(ui["call"]), directions_label=esc(ui["directions"]),
    ) if image_html else ""


def render_about(section: dict, data: dict, language: str, ui: dict, ident: str) -> str:
    title = text(section.get("title"), data, language)
    body = paragraph_html(text(section.get("body"), data, language))
    if not title and not body:
        return ""
    image_path = section.get("image")
    image = ""
    if isinstance(image_path, str):
        image = f'<figure><img src="{esc(relative_asset(image_path, data, language))}" alt="{esc(title or data["name"])}"{dimensions_attributes(data, image_path)} loading="lazy"><figcaption>{esc(data["name"])}</figcaption></figure>'
    return load_template("section-about.html").substitute(id=esc(ident), kicker=esc(ui["about"]), title=esc(title or data["name"]), body=body, image=image)


def render_menu(section: dict, data: dict, language: str, ui: dict, ident: str) -> str:
    groups = []
    for group in section.get("groups", []):
        if not isinstance(group, dict):
            continue
        items = []
        for item in group.get("items", []):
            if not isinstance(item, dict):
                continue
            name = text(item.get("name"), data, language)
            if not name:
                continue
            description = text(item.get("desc"), data, language)
            desc_html = f"<p>{esc(description)}</p>" if description else ""
            price = item.get("price") if isinstance(item.get("price"), str) else ""
            price_html = f'<span class="price">{esc(price)}</span>' if price else ""
            items.append(f'<li class="menu-item"><strong>{esc(name)}</strong>{price_html}{desc_html}</li>')
        if items:
            group_name = text(group.get("name"), data, language) or ui["menu"]
            groups.append(f'<section class="menu-group"><h3>{esc(group_name)}</h3><ul>{"".join(items)}</ul></section>')
    if not groups:
        return ""
    title = text(section.get("title"), data, language) or ui["menu"]
    return load_template("section-menu.html").substitute(id=esc(ident), kicker=esc(ui["menu"]), title=esc(title), groups="".join(groups))


def render_gallery(section: dict, data: dict, language: str, ui: dict, ident: str) -> str:
    images = []
    for image in section.get("images", []):
        if not isinstance(image, dict) or not isinstance(image.get("src"), str):
            continue
        alt = text(image.get("alt"), data, language) or data["name"]
        images.append(f'<figure><img src="{esc(relative_asset(image["src"], data, language))}" alt="{esc(alt)}"{dimensions_attributes(data, image["src"])} loading="lazy"><figcaption>{esc(alt)}</figcaption></figure>')
    if not images:
        return ""
    title = text(section.get("title"), data, language) or ui["gallery"]
    return load_template("section-gallery.html").substitute(id=esc(ident), kicker=esc(ui["gallery"]), title=esc(title), images="".join(images))


def render_hours(section: dict, data: dict, language: str, ui: dict, ident: str) -> str:
    rows = []
    for hours in data.get("hours", []):
        if not isinstance(hours, dict):
            continue
        days = text(hours.get("days"), data, language)
        timing = hours.get("time") if isinstance(hours.get("time"), str) else ""
        if not days or not timing:
            continue
        is_closed = timing == "closed"
        time_html = esc(ui["closed"] if is_closed else timing)
        rows.append(f'<div><dt>{esc(days)}</dt><dd class="{"is-closed" if is_closed else ""}">{time_html}</dd></div>')
    if not rows:
        return ""
    title = text(section.get("title"), data, language) or ui["hours"]
    return load_template("section-hours.html").substitute(id=esc(ident), kicker=esc(ui["hours"]), title=esc(title), rows="".join(rows))


def render_special(section: dict, data: dict, language: str, ui: dict, ident: str) -> str:
    title = text(section.get("title"), data, language)
    body = paragraph_html(text(section.get("body"), data, language))
    if not title and not body:
        return ""
    return load_template("section-special.html").substitute(id=esc(ident), kicker=esc(data["name"]), title=esc(title or data["name"]), body=body)


def phone_href(data: dict) -> str:
    contact = data.get("contact") if isinstance(data.get("contact"), dict) else {}
    phone = contact.get("phone") if isinstance(contact.get("phone"), str) else ""
    return "tel:" + re.sub(r"[^+0-9]", "", phone) if phone else "tel:"


def render_contact(section: dict, data: dict, language: str, ui: dict, ident: str) -> str:
    contact = data.get("contact") if isinstance(data.get("contact"), dict) else {}
    details = []
    phone = contact.get("phone") if isinstance(contact.get("phone"), str) else ""
    email = contact.get("email") if isinstance(contact.get("email"), str) else ""
    address = contact.get("address") if isinstance(contact.get("address"), str) else ""
    if phone:
        details.append(f'<div><dt>{esc(ui["call"])}</dt><dd><a href="{esc(phone_href(data))}">{esc(phone)}</a></dd></div>')
    if email:
        details.append(f'<div><dt>{esc(ui["email"])}</dt><dd><a href="mailto:{esc(email)}">{esc(email)}</a></dd></div>')
    if address:
        address_html = "<br>".join(esc(line) for line in address.splitlines())
        details.append(f'<div><dt>{esc(ui["address"])}</dt><dd>{address_html}</dd></div>')
    for key, label in (("facebook", "Facebook"), ("instagram", "Instagram")):
        value = contact.get(key)
        if isinstance(value, str) and value.startswith(("https://", "http://")):
            details.append(f'<div><dt>{label}</dt><dd><a href="{esc(value)}" rel="noopener">{label}</a></dd></div>')
    if not details:
        return ""
    map_html = ""
    if section.get("showMap") is True:
        map_html = f'<a class="map-link" href="{esc(map_url(data))}" target="_blank" rel="noopener">{esc(ui["map"])}</a>'
    title = text(section.get("title"), data, language) or ui["contact"]
    return load_template("section-contact.html").substitute(id=esc(ident), kicker=esc(ui["contact"]), title=esc(title), details=f'<dl class="contact-details">{"".join(details)}</dl>', map=map_html)


RENDERERS = {"hero": render_hero, "about": render_about, "menu": render_menu, "gallery": render_gallery, "hours": render_hours, "special": render_special, "contact": render_contact}


def stock_photo_notice(data: dict, ui: dict, credits: list[dict] | None) -> str:
    preview = data.get("preview") if isinstance(data.get("preview"), dict) else {}
    if credits is None or preview.get("isPreview") is not True:
        return ""
    return f'<p class="stock-photo-notice">{esc(ui["stock_photo_notice"].format(name=data["name"]))}</p>'


def render_sections(data: dict, language: str, ui: dict, credits: list[dict] | None) -> str:
    rendered = []
    for number, section in enumerate(data["sections"], 1):
        renderer = RENDERERS.get(section["type"])
        if renderer is None:
            print(f"warning: {data['slug']}: unknown section.type '{section['type']}' skipped", file=sys.stderr)
            continue
        ident = section_id(section, number)
        try:
            html_section = renderer(section, data, language, ui) if section["type"] == "hero" else renderer(section, data, language, ui, ident)
        except (KeyError, TypeError, ValueError) as error:
            print(f"warning: {data['slug']}: {section['type']} section skipped ({error})", file=sys.stderr)
            continue
        if html_section:
            rendered.append(html_section)
            if section["type"] == "hero":
                notice = stock_photo_notice(data, ui, credits)
                if notice:
                    rendered.append(notice)
    return "\n".join(rendered)


def preview_html(data: dict, language: str, ui: dict) -> str:
    preview = data.get("preview") if isinstance(data.get("preview"), dict) else {}
    if preview.get("isPreview") is not True:
        return ""
    email = preview.get("contact") if isinstance(preview.get("contact"), str) else ""
    help_html = f'<small>{esc(ui["preview_help"])} <a href="mailto:{esc(email)}">{esc(ui["preview_contact"])}</a></small>' if email else ""
    return (
        '<aside class="preview" id="preview-banner" role="status"><div><p>'
        + esc(ui["preview"].format(name=data["name"])) + f'</p>{help_html}</div>'
        + f'<button type="button" aria-label="{esc(ui["close_preview"])}" onclick="try{{sessionStorage.setItem(\'pro-preview\',\'dismissed\')}}catch(e){{}}this.parentElement.hidden=true">×</button></aside>'
        + '<script>try{if(sessionStorage.getItem("pro-preview")==="dismissed"){document.getElementById("preview-banner").hidden=true}}catch(e){}</script>'
    )


def legal_html(data: dict, ui: dict) -> str:
    legal = data.get("legal") if isinstance(data.get("legal"), dict) else {}
    fields = (("operator", ui["operator"]), ("address", ui["legal_address"]), ("email", ui["legal_email"]), ("phone", ui["legal_phone"]), ("rcs", ui["rcs"]), ("tva", ui["tva"]))
    rows = []
    for key, label in fields:
        value = legal.get(key) if isinstance(legal.get(key), str) and legal.get(key).strip() else ui["placeholder"]
        css = ' class="placeholder"' if value == ui["placeholder"] else ""
        rows.append(f'<dt>{esc(label)}</dt><dd{css}>{esc(value)}</dd>')
    return f'<footer class="legal"><h2>{esc(ui["legal"])}</h2><dl>{"".join(rows)}</dl></footer>'


def credit_link(label: str, url: Any) -> str:
    href = outbound_url(url)
    if not href:
        return esc(label)
    return f'<a href="{esc(href)}" target="_blank" rel="noopener">{esc(label)}</a>'


def photo_credits_html(credits: list[dict] | None, ui: dict) -> str:
    if credits is None:
        return ""
    rows = []
    for credit in credits:
        title = credit.get("title") if isinstance(credit.get("title"), str) and credit["title"].strip() else ""
        creator = credit.get("creator") if isinstance(credit.get("creator"), str) and credit["creator"].strip() else ""
        licence = credit.get("license") if isinstance(credit.get("license"), str) and credit["license"].strip() else ""
        version = credit.get("license_version") if isinstance(credit.get("license_version"), str) and credit["license_version"].strip() else ""
        licence_name = " ".join(part for part in (LICENSE_NAMES.get(licence, licence), version) if part)
        title_html = credit_link(title, credit.get("source_url")) if title else ""
        creator_html = credit_link(creator, credit.get("creator_url")) if creator else esc(ui["unknown_author"])
        line = f"{title_html} — {creator_html}" if title_html else creator_html
        if licence_name:
            line += f", {credit_link(licence_name, credit.get('license_url'))}"
        rows.append(f"<li>{line}</li>")
    if not rows:
        return ""
    return f'\n  <section class="photo-credits" aria-labelledby="photo-credits-title"><h2 id="photo-credits-title">{esc(ui["photo_credits"])}</h2><ul>{"".join(rows)}</ul></section>'


def render_page(data: dict, language: str, credits: list[dict] | None) -> str:
    ui = UI[language]
    switcher = []
    for target in data["languages"]:
        state = ' class="on" aria-current="page"' if target == language else ""
        switcher.append(f'      <a href="{esc(relative_page_href(data, language, target))}"{state}>{esc(target.upper())}</a>')
    theme = data.get("theme", {})
    display = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' if theme.get("display") == "sans" else 'Georgia, "Times New Roman", serif'
    theme_vars = "; ".join((f"--brand: {theme.get('brand', DEFAULT_THEME['brand'])}", f"--ground: {theme.get('ground', DEFAULT_THEME['ground'])}", f"--ink: {theme.get('ink', DEFAULT_THEME['ink'])}", f"--accent: {theme.get('accent', DEFAULT_THEME['accent'])}", f"--display: {display}")) + ";"
    canonical = output_url(data, language)
    alternates = "\n".join(f'  <link rel="alternate" hreflang="{esc(target)}" href="{esc(output_url(data, target))}">' for target in data["languages"])
    alternates += f'\n  <link rel="alternate" hreflang="x-default" href="{esc(output_url(data, data["defaultLanguage"]))}">'
    description = text(next((s.get("subtitle") for s in data["sections"] if s.get("type") == "hero"), {}), data, language) or data["name"]
    credits_html = photo_credits_html(credits, ui)
    return load_template("page.html").substitute(
        lang=esc(language), title=esc(f"{data['name']} — {town(data)}"), description=esc(description), canonical=esc(canonical), alternates=alternates,
        theme_vars=theme_vars, credits_style=STOCK_PHOTO_CSS if credits is not None else "", css_href="site.css" if language == data["defaultLanguage"] else "../site.css", skip_label=esc(ui["skip"]), preview=preview_html(data, language, ui),
        home_href=esc(relative_page_href(data, language, data["defaultLanguage"])), name=esc(data["name"]), language_switcher="\n".join(switcher), sections=render_sections(data, language, ui, credits), credits=credits_html, legal=legal_html(data, ui),
        mobile_actions_label=esc(data["name"]), phone_href=esc(phone_href(data)), map_href=esc(map_url(data)), call_label=esc(ui["call"]), directions_label=esc(ui["directions"]),
    )


def build_file(path: Path) -> None:
    try:
        data = validate(json.loads(path.read_text(encoding="utf-8")), path)
    except (json.JSONDecodeError, ValidationError) as error:
        raise SystemExit(f"error: {error}") from error
    site_dir = OUT_DIR / data["slug"]
    site_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(TEMPLATE_DIR / "site.css", site_dir / "site.css")
    credits = load_credits(data)
    for language in data["languages"]:
        destination = output_path(data, language)
        destination.mkdir(parents=True, exist_ok=True)
        (destination / "index.html").write_text(render_page(data, language, credits), encoding="utf-8")
    print(f"built pro/{data['slug']}/ ({', '.join(data['languages'])})")


def main() -> None:
    files = sorted(CONFIG["data_dir"].glob("*.json"))
    if not files:
        raise SystemExit(f"error: no JSON files found in {CONFIG['data_dir']}")
    for path in files:
        build_file(path)


if __name__ == "__main__":
    main()
