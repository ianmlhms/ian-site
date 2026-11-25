#!/usr/bin/env python3
"""Put ian.lu's own counter (count.js) on every page that carries the GoatCounter script tag. Idempotent.

    python3 scripts/add_count_js.py          # edit the files, print what changed
    python3 scripts/add_count_js.py --check  # change nothing; exit 1 when a page still lacks it

The tag goes right after GoatCounter's, as an absolute, versioned path. Bump COUNT_VERSION (and run this again) when count.js
changes: the service worker serves versioned scripts cache-first. Also covers the page generators' templates
(scripts/trails/templates/*.html), so a regenerate keeps it. Also removes the old visit-org.js include (count.js replaced it).
"""
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COUNT_VERSION = 1
TAG = '<script defer src="/count.js?v=%d"></script>' % COUNT_VERSION
SKIP_DIRS = {".git", "node_modules"}
GOATCOUNTER = re.compile(r'([ \t]*)<script\b[^>]*data-goatcounter[^>]*>\s*</script>', re.S)
COUNT_TAG = re.compile(r'<script\b[^>]*src="/count\.js(\?v=\d+)?"[^>]*>\s*</script>')
OLD_VISIT_ORG = re.compile(r'[ \t]*<script\b[^>]*src="visit-org\.js[^"]*"[^>]*>\s*</script>[ \t]*\n?')


def html_files():
    for root, dirs, files in os.walk(REPO):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            if name.endswith(".html"):
                yield os.path.join(root, name)


def patch(text):
    """The page's new text, or the same text when nothing is to do."""
    text = OLD_VISIT_ORG.sub("", text)
    match = GOATCOUNTER.search(text)
    if not match:
        return text
    found = COUNT_TAG.search(text)
    if found:
        return text[:found.start()] + TAG + text[found.end():] if found.group(0) != TAG else text
    return text[:match.end()] + "\n" + match.group(1) + TAG + text[match.end():]


def main(argv):
    check = "--check" in argv
    changed = []
    for path in html_files():
        with open(path, encoding="utf-8") as handle:
            old = handle.read()
        new = patch(old)
        if new == old:
            continue
        changed.append(os.path.relpath(path, REPO))
        if not check:
            with open(path, "w", encoding="utf-8", newline="") as handle:
                handle.write(new)
    print("%s %d file(s)" % ("would change" if check else "changed", len(changed)))
    for name in changed[:20]:
        print("  " + name)
    return 1 if (check and changed) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
