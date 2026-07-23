#!/usr/bin/env python3
"""Static integrity check for ian.lu — run before pushing.

Catches the classes of bug that are invisible until someone hits the page:

  links      internal href/src targets that do not exist on disk
  anchors    #fragment links pointing at an id no page defines
  i18n       data-i18n keys missing from i18n-dict.js (they render as the raw
             key, e.g. a footer that literally reads "footer.privacy")
  sitemap    sitemap URLs whose file is missing, or that are noindex'd
  orphans    public pages nothing links to (how /kaart/ shipped unreachable)
  meta       pages missing title / description / canonical

Everything is checked against the working tree, so it is fast and needs no
network. Exit status is 1 when any error-level problem is found.

    python3 scripts/check_site.py            # human report
    python3 scripts/check_site.py --quiet    # only problems
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Directories that are generated in bulk; scanned, but sampled for orphan checks.
GENERATED = ("trails/", "mtb/", "pb/")
SKIP_DIRS = {".git", "node_modules", "scripts", "data"}

EXTERNAL = re.compile(r"^(https?:)?//|^(mailto|tel|javascript|data):", re.I)


def html_files() -> list:
    out = []
    for root, dirs, files in os.walk(REPO):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith(".")]
        for f in files:
            if f.endswith(".html"):
                out.append(os.path.relpath(os.path.join(root, f), REPO))
    return sorted(out)


def read(path: str) -> str:
    with open(os.path.join(REPO, path), encoding="utf-8", errors="ignore") as fh:
        return fh.read()


def resolve(src_page: str, target: str) -> str | None:
    """Repo-relative path a link points at, or None if it is external/in-page."""
    target = target.strip()
    if not target or target.startswith("#") or EXTERNAL.match(target):
        return None
    target = target.split("#")[0].split("?")[0]
    if not target:
        return None
    if target.startswith("/"):
        path = target.lstrip("/")
    else:
        path = os.path.normpath(os.path.join(os.path.dirname(src_page), target))
    if path.endswith("/") or path == "":
        path = os.path.join(path, "index.html")
    elif os.path.isdir(os.path.join(REPO, path)):
        path = os.path.join(path, "index.html")
    return path


def check_links(pages: list, problems: list) -> dict:
    """Verify every internal href/src exists. Returns inbound-link counts."""
    inbound = defaultdict(int)
    pattern = re.compile(r'(?:href|src)\s*=\s*["\']([^"\']+)["\']', re.I)
    # Many pages build links in JS template literals; those are not static paths.
    dynamic = re.compile(r"\$\{|\+\s*\w|^\s*$")

    for page in pages:
        html = read(page)
        for raw in pattern.findall(html):
            if dynamic.search(raw):
                continue
            path = resolve(page, raw)
            if path is None:
                continue
            full = os.path.join(REPO, path)
            if os.path.exists(full):
                inbound[path] += 1
            else:
                problems.append(("error", "links", f"{page} -> {raw} (missing {path})"))
    return inbound


def js_referenced(pages: list) -> set:
    """Pages named inside JS strings, e.g. PixelBreak's GAMES/ONLINE arrays.

    These are real entry points even though no static href points at them, so
    they must not be reported as orphans.
    """
    found = set()
    quoted = re.compile(r'["\']([\w./-]+\.html)["\']')
    for page in pages:
        for target in quoted.findall(read(page)):
            path = resolve(page, target)
            if path and os.path.exists(os.path.join(REPO, path)):
                found.add(path)
    return found


def check_i18n(pages: list, problems: list) -> None:
    """data-i18n keys must exist, or t() renders the raw key to the user.

    Only pages that actually load i18n-dict.js are checked against it —
    /geoportal/ and /kaart/ ship their own dictionaries.
    """
    dict_path = os.path.join(REPO, "i18n-dict.js")
    if not os.path.exists(dict_path):
        return
    src = open(dict_path, encoding="utf-8").read()
    keys = set(re.findall(r'"([\w.]+)"\s*:\s*\{', src))
    used = re.compile(r'data-i18n(?:-html)?\s*=\s*["\']([^"\']+)["\']')

    for page in pages:
        html = read(page)
        if "i18n-dict.js" not in html:
            continue
        for key in set(used.findall(html)):
            if key not in keys:
                problems.append(("error", "i18n", f"{page}: '{key}' missing from i18n-dict.js"))


def check_sitemap(problems: list) -> set:
    listed = set()
    path = os.path.join(REPO, "sitemap.xml")
    if not os.path.exists(path):
        return listed
    for loc in re.findall(r"<loc>([^<]+)</loc>", open(path, encoding="utf-8").read()):
        rel = loc.replace("https://ian.lu/", "").split("?")[0]
        rel = rel or "index.html"
        if rel.endswith("/"):
            rel += "index.html"
        listed.add(rel)
        full = os.path.join(REPO, rel)
        if not os.path.exists(full):
            problems.append(("error", "sitemap", f"{loc} -> missing file {rel}"))
        elif re.search(r'name=["\']robots["\'][^>]*noindex', read(rel), re.I):
            problems.append(("error", "sitemap", f"{loc} is in the sitemap but marked noindex"))
    return listed


def check_meta(pages: list, problems: list) -> None:
    for page in pages:
        if page.startswith(GENERATED) or page.startswith("google"):
            continue                        # generated pages / Search Console token file
        html = read(page)
        if re.search(r'name=["\']robots["\'][^>]*noindex', html, re.I):
            continue                        # not indexed, so meta tags are moot
        if not re.search(r"<title>.*?</title>", html, re.S | re.I):
            problems.append(("error", "meta", f"{page}: no <title>"))
        if not re.search(r'name=["\']description["\']', html, re.I):
            problems.append(("warn", "meta", f"{page}: no meta description"))
        if not re.search(r'rel=["\']canonical["\']', html, re.I):
            problems.append(("warn", "meta", f"{page}: no canonical link"))


def load_ignores() -> set:
    """Known-intentional findings, one path per line, '#' for comments."""
    path = os.path.join(REPO, "scripts", "check_site_ignore.txt")
    if not os.path.exists(path):
        return set()
    out = set()
    for line in open(path, encoding="utf-8"):
        line = line.split("#")[0].strip()
        if line:
            out.add(line)
    return out


def check_orphans(pages: list, inbound: dict, listed: set, js_refs: set, problems: list) -> None:
    """Public pages nothing links to — how /kaart/ shipped unreachable."""
    ignored = load_ignores()
    for page in pages:
        if page in ignored:
            continue
        if page.startswith(GENERATED) or page == "index.html" or page.startswith("google"):
            continue
        html = read(page)
        if re.search(r'name=["\']robots["\'][^>]*noindex', html, re.I):
            continue
        if inbound.get(page, 0) == 0 and page not in listed and page not in js_refs:
            problems.append(("warn", "orphans", f"{page}: nothing links here and it is not in the sitemap"))


def check_jsonld(pages: list, problems: list) -> None:
    """Malformed JSON-LD costs rich-result eligibility and is otherwise invisible."""
    block = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
    for page in pages:
        for raw in block.findall(read(page)):
            try:
                json.loads(raw)
            except Exception as exc:
                problems.append(("error", "jsonld", f"{page}: invalid JSON-LD ({str(exc)[:50]})"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quiet", action="store_true", help="only print problems")
    args = ap.parse_args()

    pages = html_files()
    problems: list = []

    inbound = check_links(pages, problems)
    check_i18n(pages, problems)
    check_jsonld(pages, problems)
    listed = check_sitemap(problems)
    check_meta(pages, problems)
    check_orphans(pages, inbound, listed, js_referenced(pages), problems)

    errors = [p for p in problems if p[0] == "error"]
    warns = [p for p in problems if p[0] == "warn"]

    if not args.quiet:
        print(f"Scanned {len(pages)} HTML files, {len(listed)} sitemap URLs.\n")

    for level, group in (("error", errors), ("warn", warns)):
        if not group:
            continue
        print(f"--- {level.upper()} ({len(group)}) ---")
        by_kind = defaultdict(list)
        for _, kind, msg in group:
            by_kind[kind].append(msg)
        for kind, msgs in sorted(by_kind.items()):
            print(f"  [{kind}] {len(msgs)}")
            for msg in msgs[:25]:
                print(f"    {msg}")
            if len(msgs) > 25:
                print(f"    … and {len(msgs) - 25} more")
        print()

    if not problems:
        print("No problems found.")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
