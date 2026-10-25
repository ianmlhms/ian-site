#!/usr/bin/env python3
"""Side-by-side montage of screenshots / photos with captions.

  montage.py out.png [--cols 2] [--w 960] "caption A=path/a.png" "caption B=path/b.png" ...

Every image is scaled to the same width, laid out in a grid (default 2 columns: e.g. photo | screenshot, or before | after), captions under each tile.
"""
import sys
from PIL import Image, ImageDraw, ImageFont


def main(argv):
    cols, width = 2, 960
    args = []
    i = 0
    while i < len(argv):
        if argv[i] == '--cols':
            cols = int(argv[i + 1]); i += 2
        elif argv[i] == '--w':
            width = int(argv[i + 1]); i += 2
        else:
            args.append(argv[i]); i += 1
    out, items = args[0], args[1:]
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 22)
    except OSError:
        font = ImageFont.load_default()
    tiles = []
    for it in items:
        cap, _, path = it.rpartition('=')
        im = Image.open(path).convert('RGB')
        h = round(im.height * width / im.width)
        tiles.append((cap, im.resize((width, h), Image.LANCZOS)))
    rows = [tiles[k:k + cols] for k in range(0, len(tiles), cols)]
    cap_h = 34
    gap = 8
    total_h = sum(max(t[1].height for t in r) + cap_h for r in rows) + gap * (len(rows) + 1)
    sheet = Image.new('RGB', (cols * width + gap * (cols + 1), total_h), (24, 26, 30))
    d = ImageDraw.Draw(sheet)
    y = gap
    for r in rows:
        rh = max(t[1].height for t in r)
        for c, (cap, im) in enumerate(r):
            x = gap + c * (width + gap)
            sheet.paste(im, (x, y))
            d.text((x + 6, y + rh + 5), cap, fill=(235, 235, 235), font=font)
        y += rh + cap_h + gap
    sheet.save(out)
    print(out, sheet.size)


if __name__ == '__main__':
    main(sys.argv[1:])
