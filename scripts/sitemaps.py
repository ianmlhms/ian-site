#!/usr/bin/env python3
"""ian.lu sitemaps: one index, one sitemap per part, lastmod from git.

  sitemap.xml          the index Search Console and robots.txt point at
  sitemap-pages.xml    the hand-made public pages (PAGES below)
  sitemap-trails.xml   written by scripts/trails/build.py
  sitemap-mtb.xml      written by scripts/trails/build.py --cat mtb

Only final, indexable, self-canonical URLs belong in here: no redirects, no
noindex pages, no ?query variants, no URL in two sitemaps. check_site.py
enforces it.

lastmod is the date of the last commit that changed the page's file, or
today when the file has uncommitted changes, so it moves only when the
content does. (A date that changes on every build teaches Google to ignore
it.)

    python3 scripts/sitemaps.py      # rewrite sitemap-pages.xml + the index
"""
from __future__ import annotations

import os
import re
import subprocess
from datetime import date

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGIN = "https://ian.lu"
INDEX = os.path.join(REPO, "sitemap.xml")
PAGES_SITEMAP = os.path.join(REPO, "sitemap-pages.xml")
CHILDREN = ("sitemap-pages.xml", "sitemap-trails.xml", "sitemap-mtb.xml")

# Public, indexable pages outside the generated trail directories.
PAGES = (
    ("/", "index.html"),
    ("/about.html", "about.html"),
    ("/pixelbreak.html", "pixelbreak.html"),
    ("/skylens.html", "skylens.html"),
    ("/countries.html", "countries.html"),
    ("/kaart/", "kaart/index.html"),
    ("/geoportal/", "geoportal/index.html"),
    ("/privacy.html", "privacy.html"),
    ("/slf.html", "slf.html"),
)


def _git(*args: str) -> str:
    return subprocess.run(["git", "-C", REPO, *args], capture_output=True, text=True, check=True).stdout


def lastmods(files: list) -> dict:
    """{repo-relative file: YYYY-MM-DD}, today for files with local changes."""
    today = date.today().isoformat()
    dirs = sorted({f.split("/")[0] if "/" in f else f for f in files})
    dirty = set()
    for line in _git("status", "--porcelain", "--untracked-files=all", "--", *dirs).splitlines():
        path = line[3:].strip().strip('"')
        dirty.add(path.split(" -> ")[-1])
    dates: dict = {}
    current = None
    for line in _git("log", "--format=>%cs", "--name-only", "--", *dirs).splitlines():
        if line.startswith(">"):
            current = line[1:]
        elif line and line not in dates:
            dates[line] = current
    return {f: today if (f in dirty or f not in dates) else dates[f] for f in files}


def write_urlset(path: str, urls: list) -> None:
    """urls = [(absolute url, repo-relative file)]."""
    mods = lastmods([f for _, f in urls])
    entries = "\n".join(
        f"  <url>\n    <loc>{u}</loc>\n    <lastmod>{mods[f]}</lastmod>\n  </url>" for u, f in urls
    )
    with open(path, "w", encoding="utf-8") as fh:
        fh.write('<?xml version="1.0" encoding="UTF-8"?>\n'
                 '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                 f"{entries}\n</urlset>\n")


def write_pages() -> None:
    write_urlset(PAGES_SITEMAP, [(ORIGIN + u, f) for u, f in PAGES])


def write_index() -> None:
    parts = []
    for name in CHILDREN:
        path = os.path.join(REPO, name)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            mods = re.findall(r"<lastmod>([^<]+)</lastmod>", fh.read())
        newest = max(mods) if mods else date.today().isoformat()
        parts.append(f"  <sitemap>\n    <loc>{ORIGIN}/{name}</loc>\n    <lastmod>{newest}</lastmod>\n  </sitemap>")
    with open(INDEX, "w", encoding="utf-8") as fh:
        fh.write('<?xml version="1.0" encoding="UTF-8"?>\n'
                 '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                 + "\n".join(parts) + "\n</sitemapindex>\n")


def main() -> None:
    write_pages()
    write_index()
    print(f"Wrote {PAGES_SITEMAP} ({len(PAGES)} URLs) and the index {INDEX}")


if __name__ == "__main__":
    main()
