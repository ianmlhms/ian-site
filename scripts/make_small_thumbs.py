#!/usr/bin/env python3
"""Small arcade pictures for the home page's game wall.

pb/thumbs/<id>.webp (640 x 400) -> pb/thumbs/s/<id>.webp (320 x 200). A tile is 90-190 px wide, so the small one is sharp
on an iPad and the whole wall weighs a third. Run it after adding or changing a thumbnail:

    python3 scripts/make_small_thumbs.py            # only missing / out-of-date ones
    python3 scripts/make_small_thumbs.py --all

Needs cwebp (brew install webp). check_site.py fails when a game of arcade-catalogue.js has no small picture.
"""
import os
import re
import shutil
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_DIR = os.path.join(REPO, "pb", "thumbs")
TARGET_DIR = os.path.join(SOURCE_DIR, "s")
WIDTH, HEIGHT, QUALITY = 320, 200, 74


def game_ids():
    """The ids in arcade-catalogue.js: a game that is no longer in the arcade needs no small picture."""
    with open(os.path.join(REPO, "arcade-catalogue.js"), encoding="utf-8") as handle:
        source = handle.read()
    return re.findall(r'^\{id:"([^"]+)",(?!label)', source, re.M)


def is_outdated(source, target):
    return not os.path.exists(target) or os.path.getmtime(target) < os.path.getmtime(source)


def main():
    if not shutil.which("cwebp"):
        sys.exit("cwebp not found: brew install webp")
    os.makedirs(TARGET_DIR, exist_ok=True)
    rebuild_all = "--all" in sys.argv[1:]
    made = 0
    for name in sorted(game_id + ".webp" for game_id in game_ids()):
        if not os.path.exists(os.path.join(SOURCE_DIR, name)):
            print("missing: pb/thumbs/" + name)
            continue
        source, target = os.path.join(SOURCE_DIR, name), os.path.join(TARGET_DIR, name)
        if not rebuild_all and not is_outdated(source, target):
            continue
        subprocess.run(["cwebp", "-quiet", "-m", "6", "-q", str(QUALITY), "-resize", str(WIDTH), str(HEIGHT), source, "-o", target], check=True)
        made += 1
    total = sum(os.path.getsize(os.path.join(TARGET_DIR, n)) for n in os.listdir(TARGET_DIR))
    print("%d small thumbnails written, %d KB in pb/thumbs/s" % (made, total // 1024))


if __name__ == "__main__":
    main()
