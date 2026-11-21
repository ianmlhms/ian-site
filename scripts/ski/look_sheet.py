#!/usr/bin/env python3
"""Round 5 look sheets: stacked, labelled before / after shots (phone-readable: one column, big labels).

    look_sheet.py OUT.jpg "label|image" "label|image" ... [--width 1400] [--crop x0,y0,x1,y1 (fractions)] [--cols 1]

Each image is scaled to the sheet width; a label bar sits on top of each. --crop cuts the same part out of every image first (close-ups
at full pixel size)."""
import sys
from PIL import Image, ImageDraw, ImageFont


def font(size):
    for path in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/SFNS.ttf"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main():
    args = sys.argv[1:]
    out = args.pop(0)
    width, crop, cols = 1400, None, 1
    items = []
    while args:
        a = args.pop(0)
        if a == "--width":
            width = int(args.pop(0))
        elif a == "--crop":
            crop = [float(v) for v in args.pop(0).split(",")]
        elif a == "--cols":
            cols = int(args.pop(0))
        else:
            items.append(a.split("|", 1))
    cell_w = width // cols
    bar = max(34, cell_w // 22)
    f = font(int(bar * 0.62))
    cells = []
    for label, path in items:
        im = Image.open(path).convert("RGB")
        if crop:
            w, h = im.size
            im = im.crop((int(crop[0] * w), int(crop[1] * h), int(crop[2] * w), int(crop[3] * h)))
        h = round(im.size[1] * cell_w / im.size[0])
        im = im.resize((cell_w, h), Image.LANCZOS if im.size[0] > cell_w else Image.NEAREST)
        cell = Image.new("RGB", (cell_w, h + bar), (18, 20, 26))
        cell.paste(im, (0, bar))
        ImageDraw.Draw(cell).text((12, bar * 0.14), label, fill=(255, 255, 255), font=f)
        cells.append(cell)
    rows = [cells[i:i + cols] for i in range(0, len(cells), cols)]
    heights = [max(c.size[1] for c in r) for r in rows]
    sheet = Image.new("RGB", (cell_w * cols, sum(heights)), (18, 20, 26))
    y = 0
    for r, hh in zip(rows, heights):
        for i, c in enumerate(r):
            sheet.paste(c, (i * cell_w, y))
        y += hh
    sheet.save(out, quality=90)
    print(out, sheet.size)


if __name__ == "__main__":
    main()
