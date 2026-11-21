#!/usr/bin/env python3
"""Before / after sheets for the look rounds: per view a label bar, the real photo (optional, reference only, Wikimedia Commons, never
shipped), the earlier shot and the new one, stacked one under the other at phone-readable width.

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/ski/before_after.py OUT.png "label|before.png|after.png[|photo.jpg]" ...
    a "-" for before means: only the new shot (a new view)
"""
import sys

from PIL import Image, ImageDraw, ImageFont

W = 1000


def font(size):
    for f in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()


def fit(path):
    im = Image.open(path).convert("RGB")
    return im.resize((W, int(im.height * W / im.width)), Image.LANCZOS)


def bar(text, sub, colour):
    b = Image.new("RGB", (W, 60), (22, 23, 26))
    d = ImageDraw.Draw(b)
    d.text((16, 12), text, font=font(30), fill=(255, 255, 255))
    d.text((W - 16, 16), sub, font=font(26), fill=colour, anchor="ra")
    return b


def main():
    out, items = sys.argv[1], sys.argv[2:]
    blocks = []
    for it in items:
        parts = it.split("|")
        label, before, after = parts[0], parts[1], parts[2]
        photo = parts[3] if len(parts) > 3 else None
        if photo:
            blocks += [bar(label, "Foto (Wikimedia Commons)", (170, 200, 180)), fit(photo)]
        if before != "-":
            blocks += [bar(label, "VIRDRUN (Phase 1)", (240, 150, 120)), fit(before)]
        blocks += [bar(label, "ELO (Ronn 2C)", (130, 220, 150)), fit(after), Image.new("RGB", (W, 22), (246, 246, 243))]
    H = sum(x.height for x in blocks)
    sheet = Image.new("RGB", (W, H), (246, 246, 243))
    y = 0
    for x in blocks:
        sheet.paste(x, (0, y))
        y += x.height
    sheet.save(out, optimize=True)
    print(out, sheet.size)


if __name__ == "__main__":
    main()
