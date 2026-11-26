#!/usr/bin/env python3
"""A contact sheet of screenshots (board-shots.mjs): python3 contact_sheet.py OUT.png a.png b.png ... (4 columns, half size, labelled)."""
import sys
from PIL import Image, ImageDraw

out, files = sys.argv[1], sys.argv[2:]
if not files:
    sys.exit(0)
ims = [Image.open(f).convert("RGB") for f in files]
w, h = ims[0].size
w2, h2 = w // 2, h // 2
cols = 4
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * w2, rows * h2), (255, 255, 255))
draw = ImageDraw.Draw(sheet)
for i, (im, f) in enumerate(zip(ims, files)):
    x, y = (i % cols) * w2, (i // cols) * h2
    sheet.paste(im.resize((w2, h2)), (x, y))
    draw.rectangle([x, y, x + 150, y + 18], fill=(0, 0, 0))
    draw.text((x + 4, y + 3), f.rsplit("-", 1)[-1].replace(".png", ""), fill=(255, 255, 255))
sheet.save(out)
