#!/usr/bin/env python3
"""Photo | game montages for the look check: each pair is stacked (real photo on top, the game below, a label bar on each), all pairs
side by side or stacked into one phone-readable sheet. The photos are reference only (Wikimedia Commons, kept in $SKI_WORK/refs,
never shipped).

    ~/Library/Caches/luxtram-work/.venv/bin/python scripts/ski/compare.py OUT.png "label|photo.jpg|shot.png" ...
    ... "label|photo.jpg|before.png|after.png"   (three stacked: the photo, the game before and after a fix)
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


def bar(text, sub):
    b = Image.new("RGB", (W, 56), (22, 23, 26))
    d = ImageDraw.Draw(b)
    d.text((14, 8), text, font=font(26), fill=(255, 255, 255))
    d.text((W - 14, 14), sub, font=font(20), fill=(170, 200, 180), anchor="ra")
    return b


def main():
    out, pairs = sys.argv[1], sys.argv[2:]
    blocks = []
    for p in pairs:
        parts = p.split("|")
        label, photo, shots = parts[0], parts[1], parts[2:]
        blocks += [bar(label, "Foto (Wikimedia Commons)"), fit(photo)]
        subs = ["Ski Alpen"] if len(shots) == 1 else ["Ski Alpen: virdrun", "Ski Alpen: duerno"]
        for sub, shot in zip(subs, shots):
            blocks += [bar(label, sub), fit(shot)]
        blocks.append(Image.new("RGB", (W, 18), (246, 246, 243)))
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
