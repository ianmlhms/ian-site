#!/usr/bin/env python3
"""Normalize the PWA/iOS head meta across the top-level HTML pages.

Adds only tags that are missing (idempotent), inserted just before </head>:
theme-color, web-app-capable metas, apple-touch-icon, favicon and a
site.webmanifest link (never overriding a page's own dedicated manifest,
e.g. pixelbreak/skylens/messenger).

Deliberately NOT added: apple-mobile-web-app-status-bar-style — with
black-translucent, pages that don't pad their header with
safe-area-inset-top would underlap the clock.

Skips the Google verification stub and generated/embedded content
(trails/, mtb/, pb/ are not top-level pages). Run from anywhere:

    python3 scripts/normalize_head.py
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP = {"googled2bde022f66de7b9.html"}

# (marker that means "already present", tag to insert when missing)
RULES = [
    ('name="theme-color"', '<meta name="theme-color" content="#0d0d1a">'),
    ('name="mobile-web-app-capable"',
     '<meta name="mobile-web-app-capable" content="yes">'),
    ('name="apple-mobile-web-app-capable"',
     '<meta name="apple-mobile-web-app-capable" content="yes">'),
    ('rel="apple-touch-icon"',
     '<link rel="apple-touch-icon" href="apple-touch-icon.png">'),
    ('rel="icon"', '<link rel="icon" href="favicon.svg" type="image/svg+xml">'),
    ('rel="manifest"', '<link rel="manifest" href="site.webmanifest">'),
]


def normalizedHtml(html: str) -> str:
    closeAt = html.find("</head>")
    if closeAt < 0:
        return html
    head = html[:closeAt]
    missing = [tag for marker, tag in RULES if marker not in head]
    if not missing:
        return html
    block = "".join(f"  {tag}\n" for tag in missing)
    return html[:closeAt] + block + html[closeAt:]


def main() -> None:
    changed = 0
    for page in sorted(ROOT.glob("*.html")):
        if page.name in SKIP:
            continue
        html = page.read_text(encoding="utf-8")
        result = normalizedHtml(html)
        if result != html:
            page.write_text(result, encoding="utf-8")
            changed += 1
            print(f"updated {page.name}")
    print(f"{changed} page(s) updated")


if __name__ == "__main__":
    main()
