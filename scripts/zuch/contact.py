#!/usr/bin/env python3
"""Contact sheet of the reference photos of one station:  contact.py <Station> out.png [--cols 3] [--w 640] [--pick 1,2,5]
Tiles are numbered by their position in the sorted file list of ~/Library/Caches/zuch-refs/<Station>/ (the number is printed in the tile)."""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

args = sys.argv[1:]
cols, width, pick = 3, 640, None
for flag in ("--cols", "--w", "--pick"):
    if flag in args:
        i = args.index(flag)
        v = args[i + 1]
        del args[i:i + 2]
        if flag == "--cols":
            cols = int(v)
        elif flag == "--w":
            width = int(v)
        else:
            pick = [int(x) for x in v.split(",")]
station, out = args[0], args[1]
d = os.path.expanduser("~/Library/Caches/zuch-refs/" + station)
files = sorted(f for f in os.listdir(d) if f.lower().endswith((".jpg", ".jpeg", ".png")))
idx = list(range(len(files))) if pick is None else pick
font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 26)
tiles = []
for i in idx:
    im = Image.open(os.path.join(d, files[i])).convert("RGB")
    im = im.resize((width, int(im.height * width / im.width)))
    dr = ImageDraw.Draw(im)
    dr.rectangle([0, 0, 90, 38], fill=(0, 0, 0))
    dr.text((8, 4), str(i), fill=(255, 255, 0), font=font)
    tiles.append(im)
rows = (len(tiles) + cols - 1) // cols
h = max(t.height for t in tiles)
sheet = Image.new("RGB", (cols * width, rows * h), (20, 20, 24))
for k, t in enumerate(tiles):
    sheet.paste(t, ((k % cols) * width, (k // cols) * h))
sheet.save(out)
print(out, sheet.size, [(i, files[i]) for i in idx])
