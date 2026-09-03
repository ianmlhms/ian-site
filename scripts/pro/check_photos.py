#!/usr/bin/env python3
"""Gate the photographs on the pro/ preview sites. Run before every push.

Checking file size and licence said forty images were fine. Opening them said
otherwise: a competitor's chocolate bar, a US price tag, two strangers' faces,
a "FIXTURE SALE" sign, a colour-calibration chart, a cinema foyer sold as a
cafe, and a hero cropped to a baker's back.

Pixels still need a human eye. Everything here is what a machine *can* catch:
a brand name in the metadata, an image with no attribution, a declared size
that does not match the file, and the same photograph used twice on one page.
"""
import json
import os
import re
import sys
import glob
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from imagesize import image_size  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    os.pardir, os.pardir))
RATIO_TOLERANCE = 0.01

# Words that, in a photo's own Commons metadata, mean it does not belong on
# somebody else's shop page. Each was found on a page that had already shipped.
SUSPECT_WORDS = (
    "feastables", "marabou", "japp", "nestle", "cadbury", "hershey", "lindt",
    "milka", "toblerone", "kitkat", "snickers", "oreo", "ferrero", "nutella",
    "rakhat", "starbucks", "mcdonald", "coca-cola", "pepsi", "heineken",
    "carlsberg", "budweiser", "reese",
    "logo", "brand", "trademark", "packaging", "wrapper", "advertis",
    "colorchecker", "color checker", "calibration", "test chart", "hdri",
    "panorama", "render", "screenshot", "poster", "postcard",
    "cinema", "kino", "for sale", "clearance", "closing down",
)

IMG_TAG = re.compile(r'<img\s+src="(img/[^"]+)"'
                     r'(?:[^>]*?width="(\d+)"\s+height="(\d+)")?', re.S)


def problems_for_site(slug):
    found = []
    site_dir = os.path.join(REPO, "pro", slug)
    img_dir = os.path.join(site_dir, "img")
    credits_path = os.path.join(img_dir, "credits.json")

    credits = []
    if os.path.exists(credits_path):
        try:
            with open(credits_path, encoding="utf-8") as handle:
                credits = json.load(handle)
        except ValueError as error:
            found.append("%s: credits.json is not valid JSON (%s)" % (slug, error))

    images = {os.path.basename(p) for p in glob.glob(os.path.join(img_dir, "*.webp"))}
    credited = {c.get("file") for c in credits}

    # No credits file at all means the photographs are the client's own or
    # generated placeholders, which need no attribution. Once a file exists,
    # every image beside it must be accounted for.
    if credits:
        for name in sorted(images - credited):
            found.append("%s: %s has no attribution" % (slug, name))
    for name in sorted(credited - images):
        found.append("%s: credit for missing file %s" % (slug, name))

    for credit in credits:
        blob = " ".join([credit.get("title", ""), credit.get("description", ""),
                         credit.get("categories", "")]).lower()
        for word in SUSPECT_WORDS:
            if word in blob:
                found.append("%s: %s looks wrong for a client page (%r in %r)"
                             % (slug, credit.get("file"), word,
                                credit.get("title", "")[:50]))
                break
        if not credit.get("license"):
            found.append("%s: %s has no licence recorded" % (slug, credit.get("file")))

    for page in sorted(glob.glob(os.path.join(site_dir, "index.html"))
                       + glob.glob(os.path.join(site_dir, "*", "index.html"))):
        with open(page, encoding="utf-8") as handle:
            markup = handle.read()
        rel = os.path.relpath(page, REPO)
        used = []
        for match in IMG_TAG.finditer(markup):
            src = match.group(1)
            used.append(src)
            path = os.path.join(site_dir, src)
            if not os.path.exists(path):
                found.append("%s: references missing %s" % (rel, src))
                continue
            if not match.group(2):
                continue
            size = image_size(Path(path))
            if not size:
                continue
            declared = int(match.group(2)) / int(match.group(3))
            if abs(size[0] / size[1] - declared) > RATIO_TOLERANCE:
                found.append("%s: %s is %dx%d but declared %sx%s"
                             % (rel, src, size[0], size[1],
                                match.group(2), match.group(3)))
        for src in {s for s in used if used.count(s) > 1}:
            found.append("%s: %s appears %d times on one page"
                         % (rel, src, used.count(src)))
    return found


def main():
    slugs = sorted(os.path.basename(os.path.dirname(p))
                   for p in glob.glob(os.path.join(REPO, "pro", "*", "index.html")))
    problems = []
    for slug in slugs:
        problems += problems_for_site(slug)
    for problem in problems:
        print("ERROR " + problem)
    print("Checked %d preview sites." % len(slugs))
    print("No problems found." if not problems
          else "%d problem(s)." % len(problems))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
