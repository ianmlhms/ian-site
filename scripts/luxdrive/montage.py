#!/usr/bin/env python3
"""Lux Drive: a labelled montage of screenshots (and reference photos) for the reviewer.

    python3 scripts/luxdrive/montage.py out.jpg --cols 2 --width 1500 "label=path.png" "label2=path2.png" ...

Every tile is scaled to the same width, its label is drawn in a bar over it, the montage is written as a jpg (<= 300 kB: the quality
is lowered until it fits).  Pillow only."""
import argparse
import os
import sys
from PIL import Image, ImageDraw, ImageFont

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("tiles", nargs="+", help="label=path")
    ap.add_argument("--cols", type=int, default=2)
    ap.add_argument("--width", type=int, default=1500)
    ap.add_argument("--max-kb", type=int, default=300)
    a = ap.parse_args()
    tiles = []
    for t in a.tiles:
        label, _, path = t.partition("=")
        if not os.path.exists(path):
            sys.exit(f"missing {path}")
        tiles.append((label, Image.open(path).convert("RGB")))
    tw = a.width // a.cols
    scaled = []
    for label, im in tiles:
        h = round(im.height * tw / im.width)
        scaled.append((label, im.resize((tw, h), Image.LANCZOS)))
    rows = [scaled[i:i + a.cols] for i in range(0, len(scaled), a.cols)]
    heights = [max(im.height for _, im in r) for r in rows]
    sheet = Image.new("RGB", (tw * a.cols, sum(heights)), (24, 24, 26))
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
    except OSError:
        font = ImageFont.load_default()
    y = 0
    for r, h in zip(rows, heights):
        for c, (label, im) in enumerate(r):
            sheet.paste(im, (c * tw, y))
            d = ImageDraw.Draw(sheet, "RGBA")
            d.rectangle([c * tw, y, c * tw + tw, y + 28], fill=(0, 0, 0, 150))
            d.text((c * tw + 8, y + 4), label, fill=(255, 255, 255), font=font)
        y += h
    q = 86
    while True:
        sheet.save(a.out, "JPEG", quality=q, optimize=True)
        if os.path.getsize(a.out) <= a.max_kb * 1024 or q <= 40:
            break
        q -= 6
    print(a.out, sheet.size, os.path.getsize(a.out) // 1024, "kB, quality", q)

if __name__ == "__main__":
    main()
